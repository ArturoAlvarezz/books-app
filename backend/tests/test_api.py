from io import BytesIO
import os

os.environ["BOOKS_DATABASE_URL"] = "sqlite:///./test.db"
os.environ["BOOKS_STORAGE_PATH"] = "./test-data"

from fastapi.testclient import TestClient

from app.main import app


def client() -> TestClient:
    return TestClient(app)


def login(c: TestClient) -> dict[str, str]:
    response = c.post("/api/auth/login", json={"username": "admin", "password": "cambiar-esta-" + "contrasena"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_health_and_login():
    with client() as c:
        assert c.get("/health").json()["status"] == "ok"
        headers = login(c)
        assert c.get("/api/auth/me", headers=headers).json()["username"] == "admin"


def test_upload_list_and_range_download():
    with client() as c:
        headers = login(c)
        response = c.post(
            "/api/books",
            headers=headers,
            files={"file": ("Historia.txt", BytesIO(b"un libro de prueba"), "text/plain")},
        )
        assert response.status_code == 201, response.text
        book = response.json()
        assert book["format"] == "TXT"
        assert c.get("/api/books", headers=headers).json()[0]["id"] == book["id"]
        ranged = c.get(f"/api/books/{book['id']}/file", headers={**headers, "Range": "bytes=0-4"})
        assert ranged.status_code == 206
        assert ranged.content == b"un li"


def test_progress_and_bookmark_roundtrip():
    with client() as c:
        headers = login(c)
        book = c.post(
            "/api/books", headers=headers,
            files={"file": ("lectura.txt", BytesIO(b"lectura"), "text/plain")},
        ).json()
        assert c.post(f"/api/books/{book['id']}/progress", headers=headers,
                      json={"position": "42", "percent": 35}).status_code == 200
        assert c.get(f"/api/books/{book['id']}/progress", headers=headers).json()["percent"] == 35
        mark = c.post(f"/api/books/{book['id']}/bookmarks", headers=headers,
                      json={"position": "42", "label": "Capítulo 2"})
        assert mark.status_code == 201
        assert c.get(f"/api/books/{book['id']}/bookmarks", headers=headers).json()[0]["label"] == "Capítulo 2"
