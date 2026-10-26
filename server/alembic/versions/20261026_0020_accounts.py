"""accounts: users.email, one-time login codes, hashed session tokens

Revision ID: 20261026_0020_accounts
Revises: 20261026_0019_message_source
Create Date: 2026-10-26

"""

from alembic import op

revision = "20261026_0020_accounts"
down_revision = "20261026_0019_message_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN email text")
    op.execute("ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'en'))")
    op.execute("CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL")
    op.execute(
        """
        CREATE TABLE auth_codes (
          email text PRIMARY KEY,
          code_hash text NOT NULL,
          expires_at timestamptz NOT NULL,
          attempts int NOT NULL DEFAULT 0,
          sent_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE auth_tokens (
          token_hash text PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        )
        """
    )
    op.execute("CREATE INDEX auth_tokens_user ON auth_tokens (user_id)")
    op.execute(
        """
        CREATE TABLE reply_reports (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_id uuid,
          reason text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE reply_reports")
    op.execute("DROP TABLE auth_tokens")
    op.execute("DROP TABLE auth_codes")
    op.execute("DROP INDEX users_email_key")
    op.execute("ALTER TABLE users DROP COLUMN email")
    op.execute("ALTER TABLE users DROP COLUMN locale")
