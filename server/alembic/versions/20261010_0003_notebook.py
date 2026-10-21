"""add notebook entries and insights

Revision ID: 20261010_0003_notebook
Revises: 20261010_0002_seed
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0003_notebook"
down_revision: str | None = "20261010_0002_seed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE notebook_entries (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          entry_date date NOT NULL,
          kind text NOT NULL DEFAULT 'journal',
          title text NOT NULL,
          body text NOT NULL,
          image_prompt text,
          image_relpath text,
          source_session_id uuid REFERENCES sessions(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (user_id, entry_date, kind)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_notebook_user_date
          ON notebook_entries (user_id, entry_date DESC)
        """
    )
    op.execute(
        """
        CREATE TABLE insights (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          category text NOT NULL,
          body text NOT NULL,
          source_session_id uuid REFERENCES sessions(id),
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_insights_user_created
          ON insights (user_id, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS insights")
    op.execute("DROP TABLE IF EXISTS notebook_entries")
