"""陪你学 Phase 0: learning goals, items and reviews (docs/learning.md §4)

Revision ID: 20261028_0021_learning
Revises: 20261026_0020_reflection_world
Create Date: 2026-10-28

"""

from alembic import op

revision = "20261028_0021_learning"
down_revision = "20261026_0020_reflection_world"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE learning_goals (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          topic text NOT NULL,
          why text,
          lang text NOT NULL DEFAULT 'zh',
          status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'dropped')),
          paused_until timestamptz,
          refusals int NOT NULL DEFAULT 0,
          last_asked_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_learning_goals_user ON learning_goals (user_id, status)")
    op.execute(
        """
        CREATE TABLE learning_items (
          id uuid PRIMARY KEY,
          goal_id uuid NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
          prompt text NOT NULL,
          answer text NOT NULL,
          source_message_id uuid,
          mastery real NOT NULL DEFAULT 0,
          ease real NOT NULL DEFAULT 2.5,
          interval_days real NOT NULL DEFAULT 1,
          due_at timestamptz NOT NULL,
          last_result text CHECK (last_result IN ('right', 'fuzzy', 'wrong', 'skipped')),
          reviews int NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_learning_items_due ON learning_items (goal_id, due_at)")
    op.execute(
        """
        CREATE TABLE learning_reviews (
          id uuid PRIMARY KEY,
          item_id uuid NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
          session_id uuid,
          asked_message_id uuid,
          result text NOT NULL CHECK (result IN ('asked', 'right', 'fuzzy', 'wrong', 'skipped', 'refused')),
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_learning_reviews_created ON learning_reviews (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE learning_reviews")
    op.execute("DROP TABLE learning_items")
    op.execute("DROP TABLE learning_goals")
