"""add wallets and purchases

Revision ID: 20261010_0008_shop
Revises: 20261010_0007_checkins
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0008_shop"
down_revision: str | None = "20261010_0007_checkins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE wallets (
          user_id uuid PRIMARY KEY REFERENCES users(id),
          tokens int NOT NULL DEFAULT 0,
          last_claim_date date
        )
        """
    )
    op.execute(
        """
        CREATE TABLE purchases (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          item_id text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, item_id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO wallets (user_id, tokens)
        VALUES ('00000000-0000-4000-8000-000000000001', 100)
        ON CONFLICT (user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS purchases")
    op.execute("DROP TABLE IF EXISTS wallets")
