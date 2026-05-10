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
            shopify_sku TEXT,
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
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS catalogues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS catalogue_settings (
            catalogue_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            PRIMARY KEY (catalogue_id, key),
            FOREIGN KEY (catalogue_id) REFERENCES catalogues(id)
        );
        """
    )
    cur.execute("PRAGMA table_info(products)")
    existing_columns = {row[1] for row in cur.fetchall()}
    migrations = [
        ("catalogue_id", "ALTER TABLE products ADD COLUMN catalogue_id INTEGER"),
        ("shopify_sku", "ALTER TABLE products ADD COLUMN shopify_sku TEXT"),
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
        "groq_api_key": "",
        "products_total_target": "2036",
    }
    for key, value in default_settings.items():
        cur.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))

    cur.execute("SELECT id FROM catalogues ORDER BY id ASC LIMIT 1")
    first_catalogue = cur.fetchone()
    if not first_catalogue:
        cur.execute("INSERT INTO catalogues (name) VALUES (?)", ("Current Catalogue",))
        default_catalogue_id = cur.lastrowid
    else:
        default_catalogue_id = first_catalogue["id"]

    cur.execute(
        "UPDATE products SET catalogue_id = ? WHERE catalogue_id IS NULL",
        (default_catalogue_id,),
    )
    cur.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
        ("current_catalogue_id", str(default_catalogue_id)),
    )

    for key in ("shopify_store_url", "shopify_api_key", "products_total_target"):
        cur.execute(
            """
            INSERT OR IGNORE INTO catalogue_settings (catalogue_id, key, value)
            SELECT ?, ?, COALESCE((SELECT value FROM settings WHERE key = ?), '')
            """,
            (default_catalogue_id, key, key),
        )
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


def get_catalogue_setting(catalogue_id, key):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT value FROM catalogue_settings WHERE catalogue_id = ? AND key = ?",
        (int(catalogue_id), key),
    )
    row = cur.fetchone()
    conn.close()
    return row["value"] if row else None


def set_catalogue_setting(catalogue_id, key, value):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO catalogue_settings (catalogue_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(catalogue_id, key) DO UPDATE SET value = excluded.value
        """,
        (int(catalogue_id), key, value),
    )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
