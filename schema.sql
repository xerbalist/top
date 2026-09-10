CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, mnemonic_hash TEXT NOT NULL,
  secret_moves JSONB NOT NULL DEFAULT '[]', avatar_data TEXT NOT NULL DEFAULT '',
  bio VARCHAR(280) NOT NULL DEFAULT '', country VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(80) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
CREATE TABLE IF NOT EXISTS friendships (
  id BIGSERIAL PRIMARY KEY, requester UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(requester, addressee)
);
CREATE TABLE IF NOT EXISTS statuses (
  id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body VARCHAR(280) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS status_likes (
  status_id BIGINT REFERENCES statuses(id) ON DELETE CASCADE, user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(status_id,user_id)
);
CREATE TABLE IF NOT EXISTS status_replies (
  id BIGSERIAL PRIMARY KEY, status_id BIGINT REFERENCES statuses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, body VARCHAR(280) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS status_reports (
  id BIGSERIAL PRIMARY KEY, status_id BIGINT REFERENCES statuses(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES users(id) ON DELETE CASCADE, reason VARCHAR(280) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(status_id, reporter_id)
);
CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY, challenger UUID REFERENCES users(id) ON DELETE CASCADE,
  opponent UUID REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee);
CREATE INDEX IF NOT EXISTS statuses_user_created_idx ON statuses(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_replies_status_idx ON status_replies(status_id, created_at ASC);
CREATE INDEX IF NOT EXISTS status_reports_status_idx ON status_reports(status_id, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_opponent_status_idx ON challenges(opponent, status, expires_at);
