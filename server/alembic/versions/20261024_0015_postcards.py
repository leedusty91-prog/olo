"""小窝「出门」明信片：olo 去广场/湖边/屋顶转一圈带回来的两句话小故事（每天有上限）

Revision ID: 20261024_0015_postcards
Revises: 20261023_0014_world
Create Date: 2026-10-24

"""

from alembic import op

revision = "20261024_0015_postcards"
down_revision = "20261024_0015_olo_days"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE postcards (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL,
            place text NOT NULL,
            title text NOT NULL,
            story text NOT NULL,
            made_on date NOT NULL,
            source text NOT NULL DEFAULT 'llm',
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX postcards_user_day ON postcards (user_id, made_on)")


def downgrade() -> None:
    op.execute("DROP TABLE postcards")
