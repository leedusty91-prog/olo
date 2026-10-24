"""remember onboarding per account (not per browser)

Revision ID: 20261025_0016_onboarded
Revises: 20261024_0015_postcards
Create Date: 2026-10-25

"""

from alembic import op

revision = "20261025_0016_onboarded"
down_revision = "20261024_0015_postcards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN onboarded_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN onboarded_at")
