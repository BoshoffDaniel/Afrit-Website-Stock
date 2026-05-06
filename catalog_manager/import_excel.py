import os
import openpyxl, sqlite3, sys, re

DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(DATA_DIR, "catalog.db")


def slugify(text):
    text = str(text).lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def import_excel(filepath, db_path=None):
    if not os.path.exists(filepath):
        print(f"Excel file not found: {filepath}")
        return 0, 0

    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print("Excel file is empty.")
        return 0, 0
    headers = [str(h).strip() if h else "" for h in rows[0]]

    def col(name):
        try:
            return headers.index(name)
        except ValueError:
            return None

    required = ["Stock Code", "Description", "Supplier", "Category"]
    missing = [name for name in required if col(name) is None]
    if missing:
        print("Missing required columns:", ", ".join(missing))
        print("Found headers:", headers)
        return 0, 0

    final_db_path = db_path or DB_PATH
    conn = sqlite3.connect(final_db_path)
    cur = conn.cursor()
    imported = skipped = 0
    seen = set()

    for row in rows[1:]:
        sc = row[col("Stock Code")] if col("Stock Code") is not None else None
        if not sc:
            continue
        sc = str(sc).strip()
        if sc in seen:
            continue
        seen.add(sc)
        name = str(row[col("Description")] or "").strip() if col("Description") is not None else ""
        supplier = str(row[col("Supplier")] or "").strip() if col("Supplier") is not None else ""
        if supplier.startswith("="):
            supplier = ""
        category = str(row[col("Category")] or "").strip() if col("Category") is not None else ""
        handle = slugify(name) or slugify(sc)
        try:
            cur.execute(
                "INSERT OR IGNORE INTO products (stock_code, name, supplier, category, shopify_handle) VALUES (?,?,?,?,?)",
                (sc, name, supplier, category, handle),
            )
            if cur.rowcount > 0:
                imported += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"Error on {sc}: {e}")

    conn.commit()
    conn.close()
    print(f"Done. Imported: {imported}, Skipped: {skipped}")
    print(f"Database: {final_db_path}")
    return imported, skipped


if __name__ == "__main__":
    import_excel(sys.argv[1] if len(sys.argv) > 1 else "products.xlsx")
