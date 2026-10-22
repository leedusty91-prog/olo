"""add olo_chapters (unlocked 雾里集 story chapters) and mood_daily (per-day mood aggregate)

Revision ID: 20261022_0011_chapters_mood
Revises: 20261022_0010_user_gender
Create Date: 2026-10-22

"""

from alembic import op

revision = "20261022_0011_chapters_mood"
down_revision = "20261022_0010_user_gender"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE olo_chapters (
          user_id uuid NOT NULL REFERENCES users(id),
          idx int NOT NULL,
          title text NOT NULL,
          narration text NOT NULL,
          canon_count int NOT NULL DEFAULT 0,
          unlocked_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, idx)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE mood_daily (
          user_id uuid NOT NULL REFERENCES users(id),
          day date NOT NULL,
          score_sum double precision NOT NULL DEFAULT 0,
          turns int NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, day)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mood_daily")
    op.execute("DROP TABLE IF EXISTS olo_chapters")
