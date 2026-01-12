DROP TABLE IF EXISTS feedback;

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  urgency TEXT NOT NULL,
  theme TEXT NOT NULL,
  value TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
