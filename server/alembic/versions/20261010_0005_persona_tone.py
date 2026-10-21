"""add persona tone

Revision ID: 20261010_0005_persona_tone
Revises: 20261010_0004_subscription
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0005_persona_tone"
down_revision: str | None = "20261010_0004_subscription"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE companion_personas
          ADD COLUMN tone text NOT NULL DEFAULT 'curious'
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE companion_personas DROP COLUMN IF EXISTS tone")
