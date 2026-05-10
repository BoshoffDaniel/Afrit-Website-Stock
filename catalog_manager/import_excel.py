import os
import openpyxl, sqlite3, sys, re

DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(DATA_DIR, "catalog.db")


def slugify(text):
    text = str(text).lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def import_excel(filepath, db_path=None, catalogue_id=None, update_existing=True):
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
    imported = skipped = updated = 0
    skipped_missing_stock = 0
    skipped_duplicate_in_file = 0
    skipped_existing_stock = 0
    skipped_other_catalogue = 0
    skipped_errors = 0
    seen = set()
    cur.execute("SELECT id, stock_code, catalogue_id FROM products")
    existing_products = {}
    for row_existing in cur.fetchall():
        stock = str(row_existing[1]).strip() if row_existing[1] else ""
        if stock:
            existing_products[stock] = {
                "id": int(row_existing[0]),
                "catalogue_id": row_existing[2],
            }

    for row in rows[1:]:
        sc = row[col("Stock Code")] if col("Stock Code") is not None else None
        if not sc:
            skipped += 1
            skipped_missing_stock += 1
            continue
        sc = str(sc).strip()
        if sc in seen:
            skipped += 1
            skipped_duplicate_in_file += 1
            continue
        seen.add(sc)
        name = str(row[col("Description")] or "").strip() if col("Description") is not None else ""
        supplier = str(row[col("Supplier")] or "").strip() if col("Supplier") is not None else ""
        if supplier.startswith("="):
            supplier = ""
        category = str(row[col("Category")] or "").strip() if col("Category") is not None else ""
        handle = slugify(name) or slugify(sc)
        try:
            existing = existing_products.get(sc)
            if existing:
                if not update_existing:
                    skipped += 1
                    skipped_existing_stock += 1
                    continue
                existing_catalogue_id = existing.get("catalogue_id")
                if catalogue_id is not None and existing_catalogue_id not in (None, int(catalogue_id)):
                    skipped += 1
                    skipped_other_catalogue += 1
                    continue
                if catalogue_id is None:
                    cur.execute(
                        """
                        UPDATE products
                           SET name = ?, supplier = ?, category = ?, shopify_handle = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?
                        """,
                        (name, supplier, category, handle, existing["id"]),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE products
                           SET name = ?, supplier = ?, category = ?, shopify_handle = ?, catalogue_id = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?
                        """,
                        (name, supplier, category, handle, int(catalogue_id), existing["id"]),
                    )
                updated += 1
            else:
                if catalogue_id is None:
                    cur.execute(
                        "INSERT INTO products (stock_code, name, supplier, category, shopify_handle) VALUES (?,?,?,?,?)",
                        (sc, name, supplier, category, handle),
                    )
                else:
                    cur.execute(
                        "INSERT INTO products (stock_code, name, supplier, category, shopify_handle, catalogue_id) VALUES (?,?,?,?,?,?)",
                        (sc, name, supplier, category, handle, int(catalogue_id)),
                    )
                imported += 1
                existing_products[sc] = {"id": int(cur.lastrowid), "catalogue_id": int(catalogue_id) if catalogue_id is not None else None}
        except Exception as e:
            print(f"Error on {sc}: {e}")
            skipped += 1
            skipped_errors += 1

    conn.commit()
    conn.close()
    summary = {
        "updated": updated,
        "missing_stock_code": skipped_missing_stock,
        "duplicate_in_file": skipped_duplicate_in_file,
        "existing_stock_code": skipped_existing_stock,
        "other_catalogue_conflict": skipped_other_catalogue,
        "errors": skipped_errors,
    }
    print(f"Done. Imported: {imported}, Updated: {updated}, Skipped: {skipped}")
    print(f"Database: {final_db_path}")
    print(f"Skip summary: {summary}")
    return imported, skipped, summary


if __name__ == "__main__":
    import_excel(sys.argv[1] if len(sys.argv) > 1 else "products.xlsx")
