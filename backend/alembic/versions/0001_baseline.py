"""baseline: estado inicial de la DB en producción

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-11

Esta migración está VACÍA a propósito.

Cuando se introdujo Alembic, la base de datos de producción ya tenía
las tablas `books`, `users`, `bookmarks`, `highlights`, `progress` y
`book_progress` creadas (con la columna `cover_path` ya añadida mediante
un ALTER TABLE manual). En lugar de escribir una migración que intentara
crear esas tablas desde cero (y fallara al aplicarla sobre una DB que ya
las tiene), dejamos este baseline como punto de partida. Las próximas
migraciones que agreguen columnas, índices o tablas deben encadenar a
ésta mediante `down_revision = '0001_baseline'`.

Para inicializar una base de datos NUEVA (por ejemplo, en CI o en un
entorno de pruebas recién creado) se debe ejecutar primero:

    alembic upgrade head

Que aplicará este baseline (no-op) y luego las migraciones subsiguientes
sobre una base vacía; el código de aplicación además invoca
Base.metadata.create_all() como red de seguridad para tablas que Alembic
todavía no haya migrado.

Para inicializar una base de datos EXISTENTE (caso de producción):

    alembic stamp 0001_baseline

Que registra la versión sin ejecutar SQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: el schema ya existe en producción."""
    pass


def downgrade() -> None:
    """No-op: este baseline no tiene opuesto. Restaurar el schema previo
    requeriría DROP TABLE manual, lo cual está fuera del alcance."""
    pass