"""photo → pixel corners (walkable little scenes generated from a user's photo)

Revision ID: 20261025_0017_corners
Revises: 20261025_0016_onboarded
Create Date: 2026-10-25

"""

from alembic import op

revision = "20261025_0017_corners"
down_revision = "20261025_0016_onboarded"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE world_corners (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            layout jsonb NOT NULL
        )
        """
    )
    op.execute("CREATE INDEX world_corners_user ON world_corners (user_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE world_corners")
