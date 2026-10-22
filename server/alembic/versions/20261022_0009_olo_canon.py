"""add olo_canon: olo's own per-user story facts

Revision ID: 20261022_0009_olo_canon
Revises: 20261010_0008_shop
Create Date: 2026-10-22

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261022_0009_olo_canon"
down_revision: str | None = "20261010_0008_shop"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE olo_canon (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          fact text NOT NULL,
          category text NOT NULL DEFAULT 'life',
          entities jsonb NOT NULL DEFAULT '[]'::jsonb,
          source_message_id uuid,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, fact)
        )
        """
    )
    op.execute("CREATE INDEX olo_canon_user_created ON olo_canon (user_id, created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS olo_canon")
