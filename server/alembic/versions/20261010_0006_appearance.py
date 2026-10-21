"""add persona appearance

Revision ID: 20261010_0006_appearance
Revises: 20261010_0005_persona_tone
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0006_appearance"
down_revision: str | None = "20261010_0005_persona_tone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE companion_personas
          ADD COLUMN appearance jsonb NOT NULL DEFAULT '{}'::jsonb
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE companion_personas DROP COLUMN IF EXISTS appearance")
