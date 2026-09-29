CREATE TABLE IF NOT EXISTS cart_sessions (
  id TEXT PRIMARY KEY,
  customer_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('expired', 'recovered', 'completed', 'suppressed')),
  recovery_url TEXT NOT NULL,
  discount_code TEXT,
  stripe_created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  email_sent_at INTEGER,
  UNIQUE(customer_email, id)
);
CREATE INDEX IF NOT EXISTS idx_cart_sessions_email_status ON cart_sessions(customer_email, status);
CREATE INDEX IF NOT EXISTS idx_cart_sessions_updated_at ON cart_sessions(updated_at);
