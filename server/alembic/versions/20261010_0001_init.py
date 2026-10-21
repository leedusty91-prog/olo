"""create app tables

Revision ID: 20261010_0001_init
Revises:
Create Date: 2026-10-10

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261010_0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE users (
          id uuid PRIMARY KEY,
          display_name text NOT NULL,
          voiceprint_person_id text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE companion_personas (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          name text NOT NULL,
          stable_card text NOT NULL,
          version int NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE sessions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          started_at timestamptz NOT NULL DEFAULT now(),
          ended_at timestamptz,
          last_turn_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_sessions_user_open ON sessions (user_id, last_turn_at DESC)
          WHERE ended_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE messages (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id),
          client_msg_id text,
          role text NOT NULL CHECK (role IN ('user', 'assistant')),
          modality text NOT NULL CHECK (modality IN ('text', 'voice_note')),
          body text NOT NULL,
          audio_relpath text,
          emotion_label text,
          safety_hit boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Assistant rows store NULL client_msg_id. A unique constraint would not
    # treat those NULLs as conflicts, so idempotency lives on turn_requests.
    op.execute(
        """
        CREATE INDEX idx_messages_session_created ON messages (session_id, created_at)
        """
    )
    op.execute(
        """
        CREATE TABLE turn_requests (
          id uuid PRIMARY KEY,
          session_id uuid NOT NULL REFERENCES sessions(id),
          client_msg_id text NOT NULL,
          user_message_id uuid NOT NULL REFERENCES messages(id),
          assistant_message_id uuid REFERENCES messages(id),
          state text NOT NULL CHECK (state IN ('in_progress', 'completed', 'failed')),
          generation int NOT NULL DEFAULT 1,
          started_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (session_id, client_msg_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE turn_traces (
          id uuid PRIMARY KEY,
          user_message_id uuid NOT NULL REFERENCES messages(id),
          assistant_message_id uuid,
          retrieval_status text NOT NULL CHECK (retrieval_status IN (
            'ok', 'timeout', 'warming', 'unavailable', 'skipped_safety', 'skipped_asr')),
          consulted_left boolean NOT NULL,
          consulted_right boolean NOT NULL,
          left_count int NOT NULL,
          right_count int NOT NULL,
          timing_ms jsonb NOT NULL DEFAULT '{}',
          lock_held boolean NOT NULL DEFAULT false,
          degraded text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE memory_write_audit (
          id uuid PRIMARY KEY,
          user_message_id uuid NOT NULL REFERENCES messages(id),
          decision text NOT NULL CHECK (decision IN ('write', 'skip')),
          reason text NOT NULL,
          speaker_tag text NOT NULL CHECK (speaker_tag IN ('user', 'assistant')),
          voicemem_space text NOT NULL,
          voicemem_user_id text NOT NULL,
          left_memory_ids jsonb,
          status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'not_called')),
          error text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_audit_message ON memory_write_audit (user_message_id)
        """
    )
    op.execute(
        """
        CREATE TABLE commitments (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id),
          source_message_id uuid NOT NULL REFERENCES messages(id),
          body text NOT NULL,
          status text NOT NULL CHECK (status IN ('open', 'done')),
          done_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_commitments_open ON commitments (user_id, created_at)
          WHERE status = 'open'
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE commitments")
    op.execute("DROP TABLE memory_write_audit")
    op.execute("DROP TABLE turn_traces")
    op.execute("DROP TABLE turn_requests")
    op.execute("DROP TABLE messages")
    op.execute("DROP TABLE sessions")
    op.execute("DROP TABLE companion_personas")
    op.execute("DROP TABLE users")
