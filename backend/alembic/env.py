"""Configuración de Alembic para books-app.

Usa `BOOKS_DATABASE_URL` del entorno (igual que el runtime) y autogenera
contra los modelos definidos en `app.main`.
"""
from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Esto importa `Base` y garantiza que todos los modelos estén registrados
# en Base.metadata antes de que Alembic los inspeccione.
from app.main import Base  # noqa: E402

config = context.config

# Logging del alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override del sqlalchemy.url: si BOOKS_DATABASE_URL existe en el entorno,
# úsala; si no, cae al valor del alembic.ini.
db_url = os.getenv("BOOKS_DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Modo offline: emite SQL sin conectarse. Útil para previsualizar."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite: necesario para ALTER TABLE
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Modo online: conecta al engine y aplica las migraciones."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite: necesario para ALTER TABLE
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()