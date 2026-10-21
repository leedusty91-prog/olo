"""add check_ins

Revision ID: 20261010_0007_checkins
Revises: 20261010_0006_appearance
Create Date: 2026-10-19

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0007_checkins"
down_revision: str | None = "20261010_0006_appearance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE check_ins (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          kind text NOT NULL CHECK (kind IN ('text', 'call')),
          message text NOT NULL,
          scheduled_for timestamptz NOT NULL,
          recurrence text NOT NULL DEFAULT 'none'
            CHECK (recurrence IN ('none', 'daily')),
          status text NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'sent', 'cancelled')),
          sent_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_check_ins_due
          ON check_ins (status, scheduled_for)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS check_ins")
