"""olo's own days: one small happening + an ongoing little worry per user/day, so its life stays consistent

Revision ID: 20261024_0015_olo_days
Revises: 20261023_0014_world
Create Date: 2026-10-24

"""

from alembic import op

revision = "20261024_0015_olo_days"
down_revision = "20261023_0014_world"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE olo_days (
            user_id uuid NOT NULL,
            day date NOT NULL,
            happening text NOT NULL,
            ongoing text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, day)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE olo_days")
