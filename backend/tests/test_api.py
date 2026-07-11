"""Suite de pruebas del backend FastAPI.

Las pruebas se ejecutan contra una base SQLite y un directorio de
almacenamiento **temporales por sesión**, creados en ``tmp_path`` de
pytest. Esto garantiza que la suite es repetible y que no contamina el
``test.db`` ni ``test-data/`` del repositorio.
"""
from __future__ import annotations

import os
from io import BytesIO

os.environ.setdefault("BOOKS_JWT_SECRET", "test-secret-please-ignore")
os.environ.setdefault("BOOKS_ADMIN_PASSWORD", "test-password-please-ignore")

import pytest
from fastapi.testclient import TestClient

from app import main as app_main


@pytest.fixture
def fresh_app(tmp_path, monkeypatch):
    """Crea un cliente FastAPI con DB y almacenamiento limpios por test."""
    db_path = tmp_path / "test.db"
    storage = tmp_path / "data"
    monkeypatch.setenv("BOOKS_DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("BOOKS_STORAGE_PATH", str(storage))
    monkeypatch.setenv("BOOKS_JWT_SECRET", "test-secret-please-ignore")
    monkeypatch.setenv("BOOKS_ADMIN_PASSWORD", "test-password-please-ignore")

    import importlib
    importlib.reload(app_main)

    with TestClient(app_main.app) as client:
        yield client

    importlib.reload(app_main)


def login(c: TestClient) -> dict[str, str]:
    response = c.post(
        "/api/auth/login",
        json={"username": "admin", "password": "test-password-please-ignore"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_and_login(fresh_app: TestClient) -> None:
    assert fresh_app.get("/health").json()["status"] == "ok"
    headers = login(fresh_app)
    me = fresh_app.get("/api/auth/me", headers=headers).json()
    assert me["username"] == "admin"


def test_upload_list_and_range_download(fresh_app: TestClient) -> None:
    headers = login(fresh_app)
    response = fresh_app.post(
        "/api/books",
        headers=headers,
        files={"file": ("Historia.txt", BytesIO(b"un libro de prueba"), "text/plain")},
    )
    assert response.status_code == 201, response.text
    book = response.json()
    assert book["format"] == "TXT"

    listing = fresh_app.get("/api/books", headers=headers).json()
    assert any(b["id"] == book["id"] for b in listing)

    ranged = fresh_app.get(
        f"/api/books/{book['id']}/file",
        headers={**headers, "Range": "bytes=0-4"},
    )
    assert ranged.status_code == 206
    assert ranged.content == b"un li"


def test_progress_and_bookmark_roundtrip(fresh_app: TestClient) -> None:
    headers = login(fresh_app)
    book = fresh_app.post(
        "/api/books",
        headers=headers,
        files={"file": ("lectura.txt", BytesIO(b"lectura"), "text/plain")},
    ).json()

    progress = fresh_app.post(
        f"/api/books/{book['id']}/progress",
        headers=headers,
        json={"position": "42", "percent": 35},
    )
    assert progress.status_code == 200
    assert fresh_app.get(
        f"/api/books/{book['id']}/progress", headers=headers
    ).json()["percent"] == 35

    mark = fresh_app.post(
        f"/api/books/{book['id']}/bookmarks",
        headers=headers,
        json={"position": "42", "label": "Capítulo 2"},
    )
    assert mark.status_code == 201
    assert fresh_app.get(
        f"/api/books/{book['id']}/bookmarks", headers=headers
    ).json()[0]["label"] == "Capítulo 2"