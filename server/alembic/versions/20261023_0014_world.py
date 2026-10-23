"""雾里集 world: daily finds (collectibles → tokens, idempotent) and a small JSON state blob (plants, lore)

Revision ID: 20261023_0014_world
Revises: 20261022_0013_user_timezone
Create Date: 2026-10-23

"""

from alembic import op

revision = "20261023_0014_world"
down_revision = "20261022_0013_user_timezone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE world_finds (
            user_id uuid NOT NULL,
            find_id text NOT NULL,
            kind text NOT NULL,
            amount integer NOT NULL,
            found_on date NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, find_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE world_state (
            user_id uuid PRIMARY KEY,
            state jsonb NOT NULL DEFAULT '{}'::jsonb,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE world_state")
    op.execute("DROP TABLE world_finds")
