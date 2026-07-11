"""API de biblioteca personal: sencilla, autocontenida y persistente en SQLite."""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import AsyncGenerator, Generator, Iterator, Literal

import bcrypt
import jwt
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    delete,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("BOOKS_DATABASE_URL", "sqlite:////data/books.db")
STORAGE_PATH = Path(os.getenv("BOOKS_STORAGE_PATH", "/data/books")).resolve()
MAX_FILE_BYTES = int(os.getenv("BOOKS_MAX_FILE_MB", "200")) * 1024 * 1024
JWT_SECRET = os.getenv("BOOKS_JWT_SECRET", "cambia-este-secreto-en-produccion")
ADMIN_USERNAME = os.getenv("BOOKS_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("BOOKS_ADMIN_PASSWORD", "cambiar-esta-contrasena")

SUPPORTED = {"EPUB", "PDF", "CBZ", "TXT"}
MEDIA_TYPES = {
    "EPUB": "application/epub+zip",
    "PDF": "application/pdf",
    "CBZ": "application/vnd.comicbook+zip",
    "TXT": "text/plain",
}
READ_STATES = ("unread", "reading", "finished")
CHUNK_SIZE = 1024 * 1024

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), index=True)
    authors: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(String(500), default="")
    format: Mapped[str] = mapped_column(String(10))
    filename: Mapped[str] = mapped_column(String(255))
    storage_name: Mapped[str] = mapped_column(String(255), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    read_state: Mapped[str] = mapped_column(String(16), default="unread")
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    progress: Mapped["Progress | None"] = relationship(
        back_populates="book", cascade="all, delete-orphan", uselist=False
    )


class Progress(Base):
    __tablename__ = "progress"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), primary_key=True)
    position: Mapped[str] = mapped_column(String(500), default="")
    percent: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    book: Mapped[Book] = relationship(back_populates="progress")


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), index=True)
    position: Mapped[str] = mapped_column(String(500))
    label: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Highlight(Base):
    __tablename__ = "highlights"

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), index=True)
    position: Mapped[str] = mapped_column(String(500))
    text: Mapped[str] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(20), default="yellow")


class Shelf(Base):
    __tablename__ = "shelves"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="")


class ShelfBook(Base):
    __tablename__ = "shelf_books"

    shelf_id: Mapped[int] = mapped_column(ForeignKey("shelves.id"), primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), primary_key=True)


def db_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def serialize_book(book: Book) -> dict:
    progress = (
        {"position": book.progress.position, "percent": book.progress.percent}
        if book.progress
        else {"position": "", "percent": 0}
    )
    return {
        "id": book.id,
        "title": book.title,
        "authors": book.authors,
        "description": book.description,
        "tags": [tag for tag in book.tags.split(",") if tag],
        "format": book.format,
        "filename": book.filename,
        "size_bytes": book.size_bytes,
        "read_state": book.read_state,
        "favorite": book.favorite,
        "created_at": book.created_at.isoformat(),
        "progress": progress,
    }


def require_book(book_id: int, db: Session) -> Book:
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(404, "Libro no encontrado")
    return book


bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(db_session),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Debes iniciar sesión",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        user = None
    if not user:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida")
    return user


class LoginInput(BaseModel):
    username: str
    password: str


class ProgressInput(BaseModel):
    position: str = ""
    percent: float = Field(ge=0, le=100)


class BookmarkInput(BaseModel):
    position: str
    label: str = ""


class HighlightInput(BaseModel):
    position: str
    text: str
    note: str = ""
    color: str = "yellow"


class BookPatch(BaseModel):
    title: str | None = None
    authors: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    read_state: Literal["unread", "reading", "finished"] | None = None
    favorite: bool | None = None


class ShelfInput(BaseModel):
    name: str
    description: str = ""


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    STORAGE_PATH.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if not db.scalar(select(User).limit(1)):
            password_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
            db.add(User(username=ADMIN_USERNAME, password_hash=password_hash))
            db.commit()
    yield


app = FastAPI(title="Books API", version="1.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/auth/login")
def login(data: LoginInput, db: Session = Depends(db_session)) -> dict:
    user = db.scalar(select(User).where(User.username == data.username))
    if not user or not bcrypt.checkpw(data.password.encode(), user.password_hash.encode()):
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    token = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(days=30)},
        JWT_SECRET,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "username": user.username}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"id": user.id, "username": user.username}


@app.get("/api/books")
def list_books(
    query: str = "",
    format: str = "",
    read: str = "",
    favorite: bool | None = None,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> list[dict]:
    statement = select(Book).order_by(Book.created_at.desc())
    if query:
        statement = statement.where(
            Book.title.ilike(f"%{query}%") | Book.authors.ilike(f"%{query}%")
        )
    if format:
        statement = statement.where(Book.format == format.upper())
    if read:
        statement = statement.where(Book.read_state == read)
    if favorite is not None:
        statement = statement.where(Book.favorite == favorite)
    return [serialize_book(book) for book in db.scalars(statement).all()]


@app.post("/api/books", status_code=201)
def upload_book(
    file: UploadFile = File(...),
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    safe_name = Path(file.filename or "libro").name
    extension = Path(safe_name).suffix.lower().lstrip(".").upper()
    if extension not in SUPPORTED:
        raise HTTPException(
            415, f"Formato no compatible. Se aceptan: {', '.join(sorted(SUPPORTED))}"
        )

    temp = STORAGE_PATH / f".upload-{secrets.token_hex(8)}"
    digest, size = hashlib.sha256(), 0
    try:
        with temp.open("wb") as output:
            while chunk := file.file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "El archivo supera el tamaño máximo permitido")
                digest.update(chunk)
                output.write(chunk)
        sha = digest.hexdigest()
        if db.scalar(select(Book).where(Book.sha256 == sha)):
            raise HTTPException(409, "Este libro ya está en tu biblioteca")
        storage_name = f"{sha}.{extension.lower()}"
        temp.replace(STORAGE_PATH / storage_name)
    finally:
        temp.unlink(missing_ok=True)

    title = re.sub(r"[_-]+", " ", Path(safe_name).stem).strip() or "Sin título"
    book = Book(
        title=title,
        format=extension,
        filename=safe_name,
        storage_name=storage_name,
        sha256=sha,
        size_bytes=size,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return serialize_book(book)


@app.get("/api/books/{book_id}")
def get_book(
    book_id: int, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> dict:
    return serialize_book(require_book(book_id, db))


@app.put("/api/books/{book_id}")
def update_book(
    book_id: int,
    patch: BookPatch,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    book = require_book(book_id, db)
    for key, value in patch.model_dump(exclude_none=True).items():
        setattr(book, key, ",".join(value) if key == "tags" else value)
    db.commit()
    db.refresh(book)
    return serialize_book(book)


@app.delete("/api/books/{book_id}", status_code=204)
def delete_book(
    book_id: int, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> None:
    book = require_book(book_id, db)
    (STORAGE_PATH / book.storage_name).unlink(missing_ok=True)
    db.execute(delete(Bookmark).where(Bookmark.book_id == book_id))
    db.execute(delete(Highlight).where(Highlight.book_id == book_id))
    db.execute(delete(ShelfBook).where(ShelfBook.book_id == book_id))
    db.delete(book)
    db.commit()


def file_range(path: Path, start: int, end: int) -> Iterator[bytes]:
    remaining = end - start + 1
    with path.open("rb") as source:
        source.seek(start)
        while remaining > 0:
            chunk = source.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


@app.get("/api/books/{book_id}/file")
def download_book(
    book_id: int,
    request: Request,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
):
    book = require_book(book_id, db)
    path = STORAGE_PATH / book.storage_name
    if not path.exists():
        raise HTTPException(404, "El archivo físico no está disponible")

    size = path.stat().st_size
    media = MEDIA_TYPES[book.format]
    range_header = request.headers.get("range")
    if not range_header:
        return FileResponse(
            path, media_type=media, filename=book.filename, headers={"Accept-Ranges": "bytes"}
        )

    match = re.match(r"bytes=(\d*)-(\d*)", range_header)
    if not match:
        return JSONResponse(status_code=416, content={"detail": "Rango inválido"})
    start = int(match.group(1) or 0)
    end = min(int(match.group(2) or size - 1), size - 1)
    if start > end or start >= size:
        return JSONResponse(status_code=416, content={"detail": "Rango no satisfacible"})
    return StreamingResponse(
        file_range(path, start, end),
        status_code=206,
        media_type=media,
        headers={
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        },
    )


@app.get("/api/books/{book_id}/progress")
def get_progress(
    book_id: int, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> dict:
    require_book(book_id, db)
    progress = db.get(Progress, book_id)
    if not progress:
        return {"position": "", "percent": 0}
    return {"position": progress.position, "percent": progress.percent}


@app.post("/api/books/{book_id}/progress")
def save_progress(
    book_id: int,
    data: ProgressInput,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    book = require_book(book_id, db)
    progress = db.get(Progress, book_id) or Progress(book_id=book_id)
    progress.position, progress.percent = data.position, data.percent
    progress.updated_at = datetime.now(UTC)
    if data.percent >= 99:
        book.read_state = "finished"
    elif data.percent > 0 and book.read_state == "unread":
        book.read_state = "reading"
    db.add(progress)
    db.commit()
    return {"position": progress.position, "percent": progress.percent}


@app.get("/api/books/{book_id}/bookmarks")
def list_bookmarks(
    book_id: int, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> list[dict]:
    require_book(book_id, db)
    marks = db.scalars(select(Bookmark).where(Bookmark.book_id == book_id)).all()
    return [{"id": mark.id, "position": mark.position, "label": mark.label} for mark in marks]


@app.post("/api/books/{book_id}/bookmarks", status_code=201)
def add_bookmark(
    book_id: int,
    data: BookmarkInput,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    require_book(book_id, db)
    mark = Bookmark(book_id=book_id, **data.model_dump())
    db.add(mark)
    db.commit()
    db.refresh(mark)
    return {"id": mark.id, "position": mark.position, "label": mark.label}


@app.delete("/api/books/{book_id}/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(
    book_id: int,
    bookmark_id: int,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> None:
    mark = db.get(Bookmark, bookmark_id)
    if not mark or mark.book_id != book_id:
        raise HTTPException(404, "Marcador no encontrado")
    db.delete(mark)
    db.commit()


@app.get("/api/books/{book_id}/highlights")
def list_highlights(
    book_id: int, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> list[dict]:
    require_book(book_id, db)
    items = db.scalars(select(Highlight).where(Highlight.book_id == book_id)).all()
    return [
        {"id": item.id, "position": item.position, "text": item.text, "note": item.note, "color": item.color}
        for item in items
    ]


@app.post("/api/books/{book_id}/highlights", status_code=201)
def add_highlight(
    book_id: int,
    data: HighlightInput,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    require_book(book_id, db)
    item = Highlight(book_id=book_id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, **data.model_dump()}


@app.delete("/api/books/{book_id}/highlights/{highlight_id}", status_code=204)
def delete_highlight(
    book_id: int,
    highlight_id: int,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> None:
    item = db.get(Highlight, highlight_id)
    if not item or item.book_id != book_id:
        raise HTTPException(404, "Resaltado no encontrado")
    db.delete(item)
    db.commit()


@app.get("/api/shelves")
def list_shelves(
    db: Session = Depends(db_session), _: User = Depends(current_user)
) -> list[dict]:
    return [
        {
            "id": shelf.id,
            "name": shelf.name,
            "description": shelf.description,
            "book_ids": list(db.scalars(select(ShelfBook.book_id).where(ShelfBook.shelf_id == shelf.id))),
        }
        for shelf in db.scalars(select(Shelf)).all()
    ]


@app.post("/api/shelves", status_code=201)
def add_shelf(
    data: ShelfInput, db: Session = Depends(db_session), _: User = Depends(current_user)
) -> dict:
    if db.scalar(select(Shelf).where(Shelf.name == data.name)):
        raise HTTPException(409, "Ya existe una estantería con ese nombre")
    shelf = Shelf(**data.model_dump())
    db.add(shelf)
    db.commit()
    db.refresh(shelf)
    return {"id": shelf.id, "name": shelf.name, "description": shelf.description, "book_ids": []}


@app.post("/api/shelves/{shelf_id}/books/{book_id}", status_code=201)
def add_to_shelf(
    shelf_id: int,
    book_id: int,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict:
    if not db.get(Shelf, shelf_id):
        raise HTTPException(404, "Estantería no encontrada")
    require_book(book_id, db)
    if not db.get(ShelfBook, {"shelf_id": shelf_id, "book_id": book_id}):
        db.add(ShelfBook(shelf_id=shelf_id, book_id=book_id))
        db.commit()
    return {"shelf_id": shelf_id, "book_id": book_id}


@app.delete("/api/shelves/{shelf_id}/books/{book_id}", status_code=204)
def remove_from_shelf(
    shelf_id: int,
    book_id: int,
    db: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> None:
    item = db.get(ShelfBook, {"shelf_id": shelf_id, "book_id": book_id})
    if not item:
        raise HTTPException(404, "Libro no está en la estantería")
    db.delete(item)
    db.commit()
