"""
Integration test: POST /product/<id>/save persists and avoid DB lock on category insert.

Run from repo:  python tests/test_product_save.py
"""
import json
import os
import sys
import tempfile

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def main():
    td = tempfile.mkdtemp()
    os.environ["CATALOG_DATA_DIR"] = td

    from database import get_conn, init_db  # noqa: E402

    init_db()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM catalogues ORDER BY id LIMIT 1")
    cid = cur.fetchone()["id"]
    cur.execute(
        """
        INSERT INTO products (stock_code, name, category, shopify_handle, shopify_sku, status, photos, catalogue_id)
        VALUES (?, ?, ?, ?, ?, 'pending', '[]', ?)
        """,
        ("TSTSAVE1", "Product A", "", "product-a", "GEN-TSTSAVE1", cid),
    )
    pid = cur.lastrowid
    conn.commit()
    conn.close()

    from app import app  # noqa: E402

    client = app.test_client()
    payload = {
        "stock_code": "TSTSAVE1",
        "name": "Product A",
        "category": "New Cat From Save",
        "supplier": "Sup",
        "web_description": "Persistence check line",
        "sell_price": "10",
        "compare_price": "",
        "tags": "t1,t2",
        "notes": "note",
        "status": "pending",
        "shopify_sku": "GEN-TSTSAVE1",
        "photos": [],
    }
    r = client.post(
        f"/product/{pid}/save",
        data=json.dumps(payload),
        content_type="application/json",
    )
    body = r.get_json()
    assert r.status_code == 200 and body.get("success"), (r.status_code, body)

    conn = get_conn()
    row = conn.execute(
        "SELECT web_description, category FROM products WHERE id = ?",
        (pid,),
    ).fetchone()
    conn.close()
    assert row["web_description"] == "Persistence check line"
    assert row["category"] == "New Cat From Save"

    conn = get_conn()
    cat = conn.execute(
        "SELECT 1 FROM categories WHERE catalogue_id = ? AND name = ?",
        (cid, "New Cat From Save"),
    ).fetchone()
    conn.close()
    assert cat is not None

    print("test_product_save: OK")


if __name__ == "__main__":
    main()
