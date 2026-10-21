"""add subscriptions

Revision ID: 20261010_0004_subscription
Revises: 20261010_0003_notebook
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0004_subscription"
down_revision: str | None = "20261010_0003_notebook"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE subscriptions (
          user_id uuid PRIMARY KEY REFERENCES users(id),
          tier text NOT NULL DEFAULT 'free'
            CHECK (tier IN ('free', 'plus')),
          status text NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'canceled')),
          plan text,
          started_at timestamptz,
          renews_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        INSERT INTO subscriptions (user_id, tier, status)
        VALUES ('00000000-0000-4000-8000-000000000001', 'free', 'active')
        ON CONFLICT (user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS subscriptions")
