"""Proactive check-ins + nightly consolidation.

* users.checkins_enabled: user toggle for olo-initiated messages.
* check_ins.source ('manual' | 'proactive'), check_ins.seen_at (unread badge),
  check_ins.message_id (the assistant message it became).
* user_profiles: the short 「olo眼里的你」 profile, rebuilt by consolidation.
* consolidation_runs: one row per run (nightly or manual), with stats.
"""

from alembic import op

revision = "20261022_0011_checkin_profile"
down_revision = "20261022_0010_user_gender"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN checkins_enabled boolean NOT NULL DEFAULT true")
    op.execute(
        "ALTER TABLE check_ins ADD COLUMN source text NOT NULL DEFAULT 'manual' "
        "CHECK (source IN ('manual', 'proactive'))"
    )
    op.execute("ALTER TABLE check_ins ADD COLUMN seen_at timestamptz")
    op.execute("ALTER TABLE check_ins ADD COLUMN message_id uuid REFERENCES messages(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX idx_check_ins_source_sent ON check_ins (user_id, source, sent_at)")
    op.execute(
        """
        CREATE TABLE user_profiles (
          user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          profile text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE consolidation_runs (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          trigger text NOT NULL CHECK (trigger IN ('nightly', 'manual')),
          stats jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE consolidation_runs")
    op.execute("DROP TABLE user_profiles")
    op.execute("DROP INDEX idx_check_ins_source_sent")
    op.execute("ALTER TABLE check_ins DROP COLUMN message_id")
    op.execute("ALTER TABLE check_ins DROP COLUMN seen_at")
    op.execute("ALTER TABLE check_ins DROP COLUMN source")
    op.execute("ALTER TABLE users DROP COLUMN checkins_enabled")
