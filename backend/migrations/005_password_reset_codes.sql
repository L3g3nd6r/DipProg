CREATE TABLE IF NOT EXISTS password_reset_codes (
  email VARCHAR(255) PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_expires_at
  ON password_reset_codes(expires_at);
