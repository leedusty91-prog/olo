"""users.gender: optional, chosen at onboarding; only used for third-person diary pronouns."""

from alembic import op

revision = "20261022_0010_user_gender"
down_revision = "20261022_0009_olo_canon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN gender text "
        "CHECK (gender IN ('male', 'female', 'unspecified'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN gender")
