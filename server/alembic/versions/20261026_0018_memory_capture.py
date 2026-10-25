"""batched LLM memory capture: one row per capture run (cursor + ops audit)

Revision ID: 20261026_0018_memory_capture
Revises: 20261025_0017_corners
Create Date: 2026-10-26

"""

from alembic import op

revision = "20261026_0018_memory_capture"
down_revision = "20261025_0017_corners"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE memory_capture_runs (
            id bigserial PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            upto timestamptz NOT NULL,
            n_messages integer NOT NULL,
            ops jsonb NOT NULL DEFAULT '[]'::jsonb,
            usage jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX memory_capture_runs_user ON memory_capture_runs (user_id, upto DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE memory_capture_runs")
