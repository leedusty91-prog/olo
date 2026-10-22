"""add users.timezone (IANA name; per-user day boundaries and quiet hours)

Revision ID: 20261022_0013_user_timezone
Revises: 20261022_0012_chapters_mood
Create Date: 2026-10-22

"""

from alembic import op

revision = "20261022_0013_user_timezone"
down_revision = "20261022_0012_chapters_mood"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Shanghai'")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN timezone")
