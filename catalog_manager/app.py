import json
import os
import re
import shutil
import threading
import traceback
from datetime import datetime

from flask import Flask, jsonify, redirect, render_template, request, send_file, url_for
from PIL import Image

from database import get_conn, get_setting, init_db, set_setting
from import_excel import import_excel
from shopify import push_product, test_connection

import sys

if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
    DATA_DIR = os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "CatalogManager")
else:
    BASE_DIR = os.environ.get("CATALOG_BASE_DIR", os.path.dirname(os.path.abspath(__file__)))
    DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(DATA_DIR, "static"),
)

UPLOAD_DIR = os.path.join(DATA_DIR, "static", "uploads")
INBOX_DIR = os.path.join(DATA_DIR, "camera_inbox")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
ALLOWED_INBOX_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".cr2", ".nef", ".arw", ".dng"}

PUSH_PROGRESS = {"running": False, "total": 0, "pushed": 0, "failed": 0, "current": ""}


def ensure_storage_dirs():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(INBOX_DIR, exist_ok=True)
    os.makedirs(EXPORT_DIR, exist_ok=True)


def parse_photos(raw):
    if not raw:
        return []
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [str(v) for v in value if v]
    except (ValueError, TypeError):
        pass
    return []


def sanitize_stock_code(stock_code):
    return re.sub(r"[./\s]+", "_", (stock_code or "").strip())


def resize_to_jpeg(source_path, target_path, max_side=2048):
    with Image.open(source_path) as image:
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        w, h = image.size
        longest = max(w, h)
        if longest > max_side:
            scale = max_side / float(longest)
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        image.save(target_path, "JPEG", quality=90)


def product_to_dict(row):
    photos = parse_photos(row["photos"])
    return {
        "id": row["id"],
        "stock_code": row["stock_code"],
        "name": row["name"],
        "supplier": row["supplier"] or "",
        "category": row["category"] or "",
        "web_description": row["web_description"] or "",
        "sell_price": row["sell_price"],
        "compare_price": row["compare_price"],
        "photos": photos,
        "tags": row["tags"] or "",
        "status": row["status"] or "pending",
        "notes": row["notes"] or "",
        "shopify_handle": row["shopify_handle"] or "",
        "shopify_id": row["shopify_id"] or "",
        "shopify_pushed": int(row["shopify_pushed"] or 0),
        "shopify_pushed_at": row["shopify_pushed_at"],
        "photo_count": len(photos),
        "updated_at": row["updated_at"],
    }


def get_counts():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM products")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM products WHERE status='done'")
    done = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM products WHERE shopify_pushed=1")
    pushed = cur.fetchone()[0]
    conn.close()
    pending = total - done
    percent = round((done / total) * 100, 2) if total else 0
    return {"total": total, "done": done, "pending": pending, "percent": percent, "pushed": pushed}


def clean_supplier_formulas():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE products SET supplier = '' WHERE supplier LIKE '=%'")
    conn.commit()
    conn.close()


@app.before_request
def first_run_redirect():
    if request.path.startswith("/static/") or request.path.startswith("/api/"):
        return None
    if request.path in ("/setup", "/setup/import"):
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM products")
    count = cur.fetchone()[0]
    conn.close()
    if count == 0:
        return redirect(url_for("setup"))
    return None


@app.route("/")
def index():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT * FROM products
        ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, stock_code ASC
        """
    )
    products = [product_to_dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category)!='' ORDER BY category"
    )
    categories = [r[0] for r in cur.fetchall()]
    conn.close()

    stats = get_counts()
    configured = bool((get_setting("shopify_store_url") or "").strip() and (get_setting("shopify_api_key") or "").strip())
    ready_to_push = len([p for p in products if p["status"] == "done" and not p["shopify_pushed"]])
    return render_template(
        "index.html",
        products=products,
        categories=categories,
        stats=stats,
        configured=configured,
        ready_to_push=ready_to_push,
    )


@app.route("/setup")
def setup():
    return render_template("setup.html")


@app.route("/setup/import", methods=["POST"])
def setup_import():
    tmp_path = None
    try:
        file = request.files.get("excel_file")
        if not file or not file.filename:
            return render_template("setup.html", error="Please select an Excel file.")

        incoming_name = os.path.basename(file.filename)
        tmp_path = os.path.join(DATA_DIR, f"setup_upload_{incoming_name}")
        file.save(tmp_path)

        imported, skipped = import_excel(tmp_path)
        if imported == 0:
            return render_template(
                "setup.html",
                error="Import failed or no valid rows found. Please confirm the Excel columns are: Stock Code, Description, Supplier, Category.",
            )
        return redirect(url_for("index"))
    except Exception as exc:
        # Show a friendly message in the browser, but print full traceback to console
        # so we can debug exactly what's failing on the target PC.
        print("\n[SETUP IMPORT ERROR]")
        print(traceback.format_exc())
        msg = str(exc) or "Unknown error"
        return render_template(
            "setup.html",
            error=f"Import failed with error: {msg}",
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.route("/product/<int:product_id>")
def product_page(product_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM products WHERE id=?", (product_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return "Product not found", 404
    product = product_to_dict(row)

    cur.execute("SELECT id, stock_code FROM products ORDER BY id ASC")
    all_ids = [dict(r) for r in cur.fetchall()]
    conn.close()
    pos = next((i for i, p in enumerate(all_ids) if p["id"] == product_id), 0)
    prev_item = all_ids[pos - 1] if pos > 0 else all_ids[-1]
    next_item = all_ids[pos + 1] if pos < len(all_ids) - 1 else all_ids[0]

    stats = get_counts()
    configured = bool((get_setting("shopify_store_url") or "").strip() and (get_setting("shopify_api_key") or "").strip())
    needs_repush = bool(product["shopify_pushed"] and product["shopify_pushed_at"] and product["updated_at"] and product["updated_at"] > product["shopify_pushed_at"])
    return render_template(
        "product.html",
        product=product,
        previous=prev_item,
        next_item=next_item,
        position=pos + 1,
        target_total=int(get_setting("products_total_target") or "2036"),
        stats=stats,
        shopify_configured=configured,
        needs_repush=needs_repush,
    )


@app.route("/product/<int:product_id>/save", methods=["POST"])
def save_product(product_id):
    payload = request.get_json(silent=True) or {}
    photos = payload.get("photos", [])
    if not isinstance(photos, list):
        photos = []
    status = payload.get("status", "pending")
    if status not in ("pending", "done"):
        status = "pending"

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE products
           SET web_description = ?, sell_price = ?, compare_price = ?, tags = ?, notes = ?,
               status = ?, photos = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
        """,
        (
            payload.get("web_description", ""),
            payload.get("sell_price") if payload.get("sell_price") not in ("", None) else None,
            payload.get("compare_price") if payload.get("compare_price") not in ("", None) else None,
            payload.get("tags", ""),
            payload.get("notes", ""),
            status,
            json.dumps([os.path.basename(p) for p in photos]),
            product_id,
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/upload-photo", methods=["POST"])
def api_upload_photo():
    try:
        if "photo" not in request.files:
            return jsonify({"success": False, "error": "No file uploaded"}), 400
        product_id = int(request.form.get("product_id", "0"))
        file = request.files["photo"]
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT stock_code, photos FROM products WHERE id=?", (product_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "Product not found"}), 404
        filename = f"{sanitize_stock_code(row['stock_code'])}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}.jpg"
        tmp_path = os.path.join(UPLOAD_DIR, f"tmp_{filename}")
        final_path = os.path.join(UPLOAD_DIR, filename)
        file.save(tmp_path)
        resize_to_jpeg(tmp_path, final_path, max_side=2048)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        photos = parse_photos(row["photos"])
        photos.append(filename)
        cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (json.dumps(photos), product_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "filename": filename, "url": f"/static/uploads/{filename}"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/delete-photo", methods=["POST"])
def api_delete_photo():
    try:
        payload = request.get_json(silent=True) or {}
        filename = os.path.basename(payload.get("filename", ""))
        product_id = int(payload.get("product_id", 0))
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT photos FROM products WHERE id=?", (product_id,))
        row = cur.fetchone()
        if row:
            photos = [f for f in parse_photos(row["photos"]) if f != filename]
            cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (json.dumps(photos), product_id))
        conn.commit()
        conn.close()
        path = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(path):
            os.remove(path)
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/reorder-photos", methods=["POST"])
def api_reorder_photos():
    try:
        payload = request.get_json(silent=True) or {}
        product_id = int(payload.get("product_id", 0))
        filenames = [os.path.basename(f) for f in payload.get("filenames", [])]
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (json.dumps(filenames), product_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/check-inbox")
def api_check_inbox():
    try:
        files = [f for f in os.listdir(INBOX_DIR) if os.path.splitext(f)[1].lower() in ALLOWED_INBOX_EXTS]
        files.sort()
        return jsonify({"files": files})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/inbox-preview/<path:filename>")
def api_inbox_preview(filename):
    try:
        safe_name = os.path.basename(filename)
        path = os.path.join(INBOX_DIR, safe_name)
        if not os.path.exists(path):
            return jsonify({"success": False, "error": "File not found"}), 404
        return send_file(path)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/claim-inbox", methods=["POST"])
def api_claim_inbox():
    try:
        payload = request.get_json(silent=True) or {}
        filename = os.path.basename(payload.get("filename", ""))
        product_id = int(payload.get("product_id", 0))
        source = os.path.join(INBOX_DIR, filename)
        if not os.path.exists(source):
            return jsonify({"success": False, "error": "File not found"}), 404
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT stock_code, photos FROM products WHERE id=?", (product_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "Product not found"}), 404
        new_name = f"{sanitize_stock_code(row['stock_code'])}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}.jpg"
        tmp_path = os.path.join(UPLOAD_DIR, f"tmp_{new_name}")
        final_path = os.path.join(UPLOAD_DIR, new_name)
        shutil.move(source, tmp_path)
        resize_to_jpeg(tmp_path, final_path, max_side=2048)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        photos = parse_photos(row["photos"])
        photos.append(new_name)
        cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (json.dumps(photos), product_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "filename": new_name, "url": f"/static/uploads/{new_name}"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/discard-inbox", methods=["POST"])
def api_discard_inbox():
    try:
        payload = request.get_json(silent=True) or {}
        filename = os.path.basename(payload.get("filename", ""))
        path = os.path.join(INBOX_DIR, filename)
        if os.path.exists(path):
            os.remove(path)
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/next-product")
def api_next_product():
    try:
        current_id = int(request.args.get("current_id", "0"))
        direction = request.args.get("direction", "next")
        filter_mode = request.args.get("filter", "all")
        conn = get_conn()
        cur = conn.cursor()
        if filter_mode == "pending":
            cur.execute("SELECT id, stock_code, name FROM products WHERE status='pending' ORDER BY id ASC")
        else:
            cur.execute("SELECT id, stock_code, name FROM products ORDER BY id ASC")
        items = [dict(r) for r in cur.fetchall()]
        conn.close()
        if not items:
            return jsonify({"success": False, "error": "No products found"}), 404
        idx = next((i for i, p in enumerate(items) if p["id"] == current_id), 0)
        target = items[idx - 1] if direction == "prev" and idx > 0 else (items[-1] if direction == "prev" else items[(idx + 1) % len(items)])
        return jsonify(target)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/stats")
def api_stats():
    try:
        stats = get_counts()
        return jsonify({"total": stats["total"], "done": stats["done"], "pending": stats["pending"], "percent": stats["percent"]})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/settings")
def settings_page():
    return render_template(
        "settings.html",
        shopify_store_url=get_setting("shopify_store_url") or "",
        shopify_api_key=get_setting("shopify_api_key") or "",
        products_total_target=get_setting("products_total_target") or "2036",
    )


@app.route("/settings/save", methods=["POST"])
def settings_save():
    try:
        payload = request.get_json(silent=True) or {}
        set_setting("shopify_store_url", (payload.get("shopify_store_url") or "").strip())
        set_setting("shopify_api_key", (payload.get("shopify_api_key") or "").strip())
        if payload.get("products_total_target") is not None:
            set_setting("products_total_target", str(payload.get("products_total_target") or "2036"))
        ok, message = test_connection()
        return jsonify({"success": True, "connected": ok, "message": message})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/shopify-status")
def api_shopify_status():
    try:
        store = (get_setting("shopify_store_url") or "").strip()
        token = (get_setting("shopify_api_key") or "").strip()
        return jsonify({"configured": bool(store and token), "store": store})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/push-to-shopify/<int:product_id>", methods=["POST"])
def api_push_one(product_id):
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM products WHERE id=?", (product_id,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({"success": False, "error": "Product not found"}), 404
        result = push_product(product_to_dict(row))
        return jsonify(result)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


def _batch_push_worker():
    global PUSH_PROGRESS
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM products WHERE status='done' AND shopify_pushed=0 ORDER BY id ASC")
    rows = cur.fetchall()
    conn.close()
    PUSH_PROGRESS = {"running": True, "total": len(rows), "pushed": 0, "failed": 0, "current": ""}
    for row in rows:
        product = product_to_dict(row)
        PUSH_PROGRESS["current"] = product["stock_code"]
        result = push_product(product)
        if result.get("success"):
            PUSH_PROGRESS["pushed"] += 1
        else:
            PUSH_PROGRESS["failed"] += 1
    PUSH_PROGRESS["running"] = False
    PUSH_PROGRESS["current"] = ""


@app.route("/api/push-all-to-shopify", methods=["POST"])
def api_push_all():
    try:
        if PUSH_PROGRESS.get("running"):
            return jsonify({"success": False, "error": "Batch push already running"})
        thread = threading.Thread(target=_batch_push_worker, daemon=True)
        thread.start()
        return jsonify({"success": True, "pushed": 0, "failed": 0})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/push-progress")
def api_push_progress():
    try:
        return jsonify(PUSH_PROGRESS)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


if __name__ == "__main__":
    ensure_storage_dirs()
    init_db()
    clean_supplier_formulas()
    print("\n=============================")
    print("  Catalog Manager is running")
    print("  http://localhost:5001")
    print(f"  Data directory: {os.path.abspath(DATA_DIR)}")
    print("=============================\n")
    app.run(debug=True, host="0.0.0.0", port=5001)
