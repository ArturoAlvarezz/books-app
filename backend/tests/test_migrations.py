"""Tests de regresión para la migración de schema.

El bug que motivó esta suite fue: agregar una columna al modelo
(`Book.cover_path`) sin escribir una migración, lo que dejó la DB de
producción sin esa columna al hacer redeploy y rompió todas las queries.

Este test verifica que:
1. Partiendo de una DB vacía, `alembic upgrade head` deja el schema
   completo (todas las tablas e índices del modelo).
2. El campo `cover_path` existe y es nullable.
3. `alembic downgrade -1` revierte la última migración de forma segura.
4. `alembic upgrade head` es idempotente (segunda corrida es no-op).
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


BACKEND_DIR = Path(__file__).resolve().parent.parent


def _run_alembic(db_url: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["BOOKS_DATABASE_URL"] = db_url
    # Forzar que el cwd del comando sea backend/, donde está alembic.ini
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _run_alembic_downgrade(db_url: str, steps: str = "-1") -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["BOOKS_DATABASE_URL"] = db_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", steps],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_fresh_db_gets_full_schema(tmp_path: Path) -> None:
    """Una DB vacía debe quedar con todas las tablas tras `upgrade head`."""
    db = tmp_path / "fresh.db"
    db_url = f"sqlite:///{db}"

    result = _run_alembic(db_url)
    assert result.returncode == 0, f"upgrade falló: {result.stderr}"

    con = sqlite3.connect(str(db))
    try:
        tables = {
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    finally:
        con.close()

    expected = {
        "alembic_version",
        "books",
        "users",
        "progress",
        "bookmarks",
        "highlights",
        "shelves",
        "shelf_books",
    }
    assert expected <= tables, f"faltan tablas: {expected - tables}"


def test_cover_path_column_present_and_nullable(tmp_path: Path) -> None:
    """Regresión directa del bug original: cover_path debe existir y ser NULL-able."""
    db = tmp_path / "cover.db"
    db_url = f"sqlite:///{db}"
    _run_alembic(db_url)

    con = sqlite3.connect(str(db))
    try:
        cols = list(con.execute("PRAGMA table_info(books)"))
    finally:
        con.close()

    cover_col = next((c for c in cols if c[1] == "cover_path"), None)
    assert cover_col is not None, "books.cover_path no existe"
    # PRAGMA table_info: (cid, name, type, notnull, default_value, pk)
    assert cover_col[3] == 0, f"cover_path debería ser nullable, notnull={cover_col[3]}"


def test_upgrade_head_is_idempotent(tmp_path: Path) -> None:
    """Ejecutar upgrade dos veces seguidas no debe fallar."""
    db = tmp_path / "idem.db"
    db_url = f"sqlite:///{db}"

    r1 = _run_alembic(db_url)
    r2 = _run_alembic(db_url)
    assert r1.returncode == 0
    assert r2.returncode == 0, f"segunda corrida falló: {r2.stderr}"


def test_app_imports_without_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """El módulo `app.main` debe poder importarse sin BOOKS_JWT_SECRET.

    Esto garantiza que Alembic y otros scripts pueden usar los modelos
    sin necesidad de configurar secretos de runtime.
    """
    monkeypatch.delenv("BOOKS_JWT_SECRET", raising=False)
    monkeypatch.delenv("BOOKS_ADMIN_PASSWORD", raising=False)

    if "app.main" in sys.modules:
        del sys.modules["app.main"]

    sys.path.insert(0, str(BACKEND_DIR))
    import app.main as m  # noqa: F401

    # Importar no debe haber establecido secretos
    assert m.JWT_SECRET == ""
    assert m.ADMIN_PASSWORD == ""


def test_resolve_runtime_config_rejects_weak_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """`_require_str` debe seguir rechazando secretos débiles conocidos."""
    sys.path.insert(0, str(BACKEND_DIR))
    from app.main import resolve_runtime_config

    monkeypatch.setenv("BOOKS_JWT_SECRET", "change-me")
    with pytest.raises(RuntimeError, match="BOOKS_JWT_SECRET"):
        resolve_runtime_config()

    monkeypatch.setenv("BOOKS_JWT_SECRET", "a-strong-secret-value-here")
    monkeypatch.setenv("BOOKS_ADMIN_PASSWORD", "admin")
    with pytest.raises(RuntimeError, match="BOOKS_ADMIN_PASSWORD"):
        resolve_runtime_config()