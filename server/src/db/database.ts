import BetterSqlite from 'better-sqlite3';

export type AppDatabase = BetterSqlite.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'kiosk')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS household (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  kiosk_token_hash TEXT
);

CREATE TABLE IF NOT EXISTS targets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  fiber REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  sodium REAL,
  hydration_ml REAL NOT NULL,
  units TEXT NOT NULL DEFAULT 'imperial' CHECK (units IN ('metric', 'imperial')),
  extras_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT,
  kind TEXT NOT NULL,
  serving_label TEXT NOT NULL,
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  fiber REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  sodium REAL NOT NULL,
  extras_json TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_drink INTEGER NOT NULL DEFAULT 0,
  drink_ml REAL,
  makes_servings REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  source_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS food_ingredients (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  servings REAL NOT NULL,
  source_ref TEXT,
  child_food_id TEXT REFERENCES foods(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  food_id TEXT REFERENCES foods(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  extracted_text TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id TEXT REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('meal', 'snack', 'dessert', 'drink')),
  eaten_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  servings REAL NOT NULL,
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  fiber REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  sodium REAL NOT NULL,
  extras_json TEXT NOT NULL,
  drink_ml REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hydration_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  amount_ml REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('water', 'drink')),
  meal_log_id TEXT REFERENCES meal_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS meal_logs_user_date ON meal_logs(user_id, local_date);
CREATE INDEX IF NOT EXISTS hydration_user_date ON hydration_logs(user_id, local_date);

-- Weight is personal. Family and kiosk queries must not read these tables.
CREATE TABLE IF NOT EXISTS weight_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  weekday INTEGER NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb', 'kg'))
);

CREATE TABLE IF NOT EXISTS weight_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  weight REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('lb', 'kg')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight_dismissals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  PRIMARY KEY (user_id, week_key)
);

CREATE INDEX IF NOT EXISTS weight_entries_user_date ON weight_entries(user_id, local_date);
`;

export function openDatabase(file: string): AppDatabase {
  const db = new BetterSqlite(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function migrate(db: AppDatabase): void {
  const columns = db.prepare('PRAGMA table_info(targets)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'units')) {
    db.exec(`ALTER TABLE targets ADD COLUMN units TEXT NOT NULL DEFAULT 'imperial' CHECK (units IN ('metric', 'imperial'))`);
  }
  const columnsAfter = db.prepare('PRAGMA table_info(targets)').all() as Array<{ name: string }>;
  if (!columnsAfter.some((column) => column.name === 'date_format')) {
    db.exec(`ALTER TABLE targets ADD COLUMN date_format TEXT NOT NULL DEFAULT 'mdy_long'`);
  }
}
