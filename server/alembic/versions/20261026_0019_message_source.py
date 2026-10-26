"""messages.source: app | seed | test (NULL on old rows: olo.provenance classifies them)

Revision ID: 20261026_0019_message_source
Revises: 20261026_0018_memory_capture
Create Date: 2026-10-26

"""

from alembic import op

revision = "20261026_0019_message_source"
down_revision = "20261026_0018_memory_capture"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No backfill: old rows stay NULL and are classified at read time.
    op.execute("ALTER TABLE messages ADD COLUMN source text CHECK (source IN ('app', 'seed', 'test'))")


def downgrade() -> None:
    op.execute("ALTER TABLE messages DROP COLUMN source")
