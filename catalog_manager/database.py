import os
import sqlite3

DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(DATA_DIR, "catalog.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stock_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            supplier TEXT,
            category TEXT,
            web_description TEXT,
            sell_price REAL,
            compare_price REAL,
            photos TEXT DEFAULT '[]',
            tags TEXT,
            status TEXT DEFAULT 'pending',
            notes TEXT,
            shopify_handle TEXT,
            shopify_id TEXT,
            shopify_pushed INTEGER DEFAULT 0,
            shopify_pushed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    cur.execute("PRAGMA table_info(products)")
    existing_columns = {row[1] for row in cur.fetchall()}
    migrations = [
        ("shopify_id", "ALTER TABLE products ADD COLUMN shopify_id TEXT"),
        ("shopify_pushed", "ALTER TABLE products ADD COLUMN shopify_pushed INTEGER DEFAULT 0"),
        ("shopify_pushed_at", "ALTER TABLE products ADD COLUMN shopify_pushed_at TIMESTAMP"),
    ]
    for col_name, ddl in migrations:
        if col_name not in existing_columns:
            cur.execute(ddl)
    default_settings = {
        "shopify_store_url": "",
        "shopify_api_key": "",
        "products_total_target": "2036",
    }
    for key, value in default_settings.items():
        cur.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


def get_setting(key):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cur.fetchone()
    conn.close()
    return row["value"] if row else None


def set_setting(key, value):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
