import json
import os
import re
import sqlite3
import shutil
import threading
import time
import traceback
from datetime import datetime

import requests
from flask import Flask, jsonify, redirect, render_template, request, send_file, session, url_for
from PIL import Image
from werkzeug.security import check_password_hash

from database import (
    ensure_category_row,
    get_catalogue_setting,
    get_conn,
    get_setting,
    init_db,
    list_categories_with_counts,
    list_category_labels,
    set_catalogue_setting,
    set_setting,
)
from image_utils import process_photo
from import_excel import import_excel
from shopify import push_product, test_connection

import sys

if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
    DATA_DIR = os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "CatalogManager")
else:
    BASE_DIR = os.environ.get("CATALOG_BASE_DIR", os.path.dirname(os.path.abspath(__file__)))
    DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))

DB_PATH = os.path.join(DATA_DIR, "catalog.db")

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(DATA_DIR, "static"),
)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "catalog-manager-dev-secret-change-in-production")

UPLOAD_DIR = os.path.join(DATA_DIR, "static", "uploads")
INBOX_DIR = os.path.join(DATA_DIR, "camera_inbox")
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
ALLOWED_INBOX_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".cr2", ".nef", ".arw", ".dng"}
PHOTO_STATUS = {}
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


def generate_shopify_sku(category, stock_code):
    prefix = (category or "").strip()
    prefix = re.sub(r"[^A-Za-z]", "", prefix)
    prefix = (prefix[:3].upper() if prefix else "GEN")
    return f"{prefix}-{(stock_code or '').strip()}"


def slugify_text(value):
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


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
        "shopify_sku": row["shopify_sku"] or generate_shopify_sku(row["category"], row["stock_code"]),
        "shopify_id": row["shopify_id"] or "",
        "shopify_pushed": int(row["shopify_pushed"] or 0),
        "shopify_pushed_at": row["shopify_pushed_at"],
        "photo_count": len(photos),
        "updated_at": row["updated_at"],
    }


def list_catalogues():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name FROM catalogues ORDER BY name ASC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def get_current_catalogue_id():
    selected = (get_setting("current_catalogue_id") or "").strip()
    conn = get_conn()
    cur = conn.cursor()
    if selected.isdigit():
        cur.execute("SELECT id FROM catalogues WHERE id = ?", (int(selected),))
        exists = cur.fetchone()
        if exists:
            conn.close()
            return int(selected)
    cur.execute("SELECT id FROM catalogues ORDER BY id ASC LIMIT 1")
    row = cur.fetchone()
    if row:
        catalogue_id = int(row["id"])
        conn.close()
        set_setting("current_catalogue_id", str(catalogue_id))
        return catalogue_id
    cur.execute("INSERT INTO catalogues (name) VALUES (?)", ("Current Catalogue",))
    catalogue_id = cur.lastrowid
    conn.commit()
    conn.close()
    set_setting("current_catalogue_id", str(catalogue_id))
    return int(catalogue_id)


def is_admin_session():
    until = session.get("admin_until")
    try:
        return float(until) > time.time()
    except (TypeError, ValueError):
        return False


def get_counts(catalogue_id=None):
    conn = get_conn()
    cur = conn.cursor()
    if catalogue_id is None:
        cur.execute("SELECT COUNT(*) FROM products")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM products WHERE status='done'")
        done = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM products WHERE shopify_pushed=1")
        pushed = cur.fetchone()[0]
    else:
        cur.execute("SELECT COUNT(*) FROM products WHERE catalogue_id = ?", (catalogue_id,))
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM products WHERE catalogue_id = ? AND status='done'", (catalogue_id,))
        done = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM products WHERE catalogue_id = ? AND shopify_pushed=1", (catalogue_id,))
        pushed = cur.fetchone()[0]
    conn.close()
    pending = total - done
    percent = round((done / total) * 100, 2) if total else 0
    return {"total": total, "done": done, "pending": pending, "percent": percent, "pushed": pushed}


@app.context_processor
def inject_catalogue_state():
    catalogues = list_catalogues()
    current_id = get_current_catalogue_id()
    current = next((c for c in catalogues if c["id"] == current_id), None)
    shopify_ok = bool(
        (get_catalogue_setting(current_id, "shopify_store_url") or "").strip()
        and (get_catalogue_setting(current_id, "shopify_api_key") or "").strip()
    )
    return {
        "available_catalogues": catalogues,
        "current_catalogue_id": current_id,
        "current_catalogue_name": (current or {}).get("name", "Current Catalogue"),
        "shopify_configured": shopify_ok,
        "admin_unlocked": is_admin_session(),
    }


def clean_supplier_formulas():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE products SET supplier = '' WHERE supplier LIKE '=%'")
    conn.commit()
    conn.close()


def backfill_shopify_sku():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, category, stock_code FROM products WHERE shopify_sku IS NULL OR TRIM(shopify_sku) = ''")
    rows = cur.fetchall()
    for row in rows:
        cur.execute("UPDATE products SET shopify_sku = ? WHERE id = ?", (generate_shopify_sku(row["category"], row["stock_code"]), row["id"]))
    conn.commit()
    conn.close()


def process_photo_async(filename):
    final_path = os.path.join(UPLOAD_DIR, filename)
    tmp_out = os.path.join(UPLOAD_DIR, f"processed_{filename}")
    PHOTO_STATUS[filename] = {"status": "processing"}
    ok = process_photo(final_path, tmp_out)
    if os.path.exists(tmp_out):
        try:
            os.replace(tmp_out, final_path)
        except OSError:
            pass
    PHOTO_STATUS[filename] = {"status": "done", "url": f"/static/uploads/{filename}", "processed": ok}


def _process_uploaded_file_inplace(final_path):
    """Background removal to a temp file, then replace original."""
    tmp_out = f"{final_path}.proc.jpg"
    try:
        process_photo(final_path, tmp_out)
        if os.path.exists(tmp_out):
            os.replace(tmp_out, final_path)
    except Exception as exc:
        print(f"process_photo on upload: {exc}")
    finally:
        if os.path.exists(tmp_out):
            try:
                os.remove(tmp_out)
            except OSError:
                pass


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
    catalogue_id = get_current_catalogue_id()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM products WHERE catalogue_id = ? ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, stock_code ASC",
        (catalogue_id,),
    )
    products = [product_to_dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT DISTINCT category FROM products WHERE catalogue_id = ? AND category IS NOT NULL AND TRIM(category)!='' ORDER BY category",
        (catalogue_id,),
    )
    categories = [r[0] for r in cur.fetchall()]
    conn.close()
    stats = get_counts(catalogue_id)
    ready_to_push = len([p for p in products if p["status"] == "done" and not p["shopify_pushed"]])
    shown_count = len(products)
    return render_template(
        "index.html",
        products=products,
        categories=categories,
        stats=stats,
        ready_to_push=ready_to_push,
        shown_count=shown_count,
        target_total=int(get_catalogue_setting(catalogue_id, "products_total_target") or "2036"),
    )


@app.route("/products")
def products_hub():
    catalogue_id = get_current_catalogue_id()
    tab = (request.args.get("tab") or "products").strip().lower()
    if tab not in ("products", "categories"):
        tab = "products"
    selected_id = request.args.get("selected", type=int)
    is_new = request.args.get("new") == "1"
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM products WHERE catalogue_id = ? ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, stock_code ASC",
        (catalogue_id,),
    )
    products = [product_to_dict(r) for r in cur.fetchall()]
    conn.close()
    category_options = list_category_labels(catalogue_id)
    categories_full = list_categories_with_counts(catalogue_id) if tab == "categories" else []
    category_options_sorted = sorted(category_options, key=lambda x: (x or "").lower())
    ids = {p["id"] for p in products}
    if selected_id is not None and selected_id not in ids:
        selected_id = None

    catalogue_stats = get_counts(catalogue_id)
    ready_to_push = len([p for p in products if p["status"] == "done" and not p["shopify_pushed"]])
    target_total = int(get_catalogue_setting(catalogue_id, "products_total_target") or "2036")

    selected_product = None
    previous_item = None
    next_item = None
    position = 0
    needs_repush = False
    show_new_panel = request.args.get("new") == "1" and not selected_id
    if selected_id and not show_new_panel:
        for p in products:
            if p["id"] == selected_id:
                selected_product = p
                break
        if selected_product:
            all_nav = [{"id": p["id"], "stock_code": p["stock_code"]} for p in products]
            pos = next((i for i, x in enumerate(all_nav) if x["id"] == selected_id), 0)
            position = pos + 1
            previous_item = all_nav[pos - 1] if pos > 0 else all_nav[-1]
            next_item = all_nav[pos + 1] if pos < len(all_nav) - 1 else all_nav[0]
            needs_repush = bool(
                selected_product["shopify_pushed"]
                and selected_product.get("shopify_pushed_at")
                and selected_product.get("updated_at")
                and selected_product["updated_at"] > selected_product["shopify_pushed_at"]
            )

    # Always bind `stats` for the template. If `stats` is only assigned inside a branch,
    # Python still treats it as a local for the whole function → UnboundLocalError on render.
    stats = catalogue_stats

    return render_template(
        "products_hub.html",
        products=products,
        tab=tab,
        selected_id=selected_id,
        is_new=is_new and not selected_id,
        category_options=category_options,
        category_options_sorted=category_options_sorted,
        categories_full=categories_full,
        selected_product=selected_product,
        previous_item=previous_item,
        next_item=next_item,
        panel_position=position,
        panel_target_total=target_total,
        panel_stats=stats,
        panel_needs_repush=needs_repush,
        stats=stats,
        ready_to_push=ready_to_push,
        target_total=target_total,
    )


@app.route("/activity")
def activity_page():
    return render_template("activity.html")


@app.route("/api/admin/unlock", methods=["POST"])
def api_admin_unlock():
    payload = request.get_json(silent=True) or {}
    password = (payload.get("password") or "").strip()
    stored = (get_setting("admin_password_hash") or "").strip()
    if stored and check_password_hash(stored, password):
        session["admin_until"] = time.time() + 30 * 60
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Incorrect password"}), 401


@app.route("/api/admin/status")
def api_admin_status():
    until = session.get("admin_until")
    try:
        exp = max(0, float(until) - time.time())
    except (TypeError, ValueError):
        exp = 0
    return jsonify({"admin": is_admin_session(), "expires_in": exp})


@app.route("/api/products/create", methods=["POST"])
def api_create_product():
    if not is_admin_session():
        return jsonify({"success": False, "need_admin": True}), 403
    catalogue_id = get_current_catalogue_id()
    payload = request.get_json(silent=True) or {}
    stock_code = (payload.get("stock_code") or "").strip()
    name = (payload.get("name") or "").strip()
    category = (payload.get("category") or "").strip()
    if not stock_code or not name:
        return jsonify({"success": False, "error": "Stock code and name are required."}), 400
    conn = get_conn()
    cur = conn.cursor()
    try:
        handle = slugify_text(name) or slugify_text(stock_code)
        shopify_sku = generate_shopify_sku(category, stock_code)
        cur.execute(
            """
            INSERT INTO products (stock_code, name, category, shopify_handle, shopify_sku, status, photos, catalogue_id)
            VALUES (?, ?, ?, ?, ?, 'pending', '[]', ?)
            """,
            (stock_code, name, category, handle, shopify_sku, catalogue_id),
        )
        product_id = cur.lastrowid
        ensure_category_row(catalogue_id, category, conn=conn)
        conn.commit()
        conn.close()
        return jsonify({"success": True, "id": product_id})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"success": False, "error": "Stock code already exists"}), 400


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
def api_delete_product(product_id):
    if not is_admin_session():
        return jsonify({"success": False, "need_admin": True}), 403
    catalogue_id = get_current_catalogue_id()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT photos FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "error": "Product not found"}), 404
    photos = parse_photos(row["photos"])
    cur.execute("DELETE FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
    conn.commit()
    conn.close()
    for fname in photos:
        path = os.path.join(UPLOAD_DIR, os.path.basename(fname))
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
    return jsonify({"success": True})


@app.route("/api/categories", methods=["POST"])
def api_categories_add():
    if not is_admin_session():
        return jsonify({"success": False, "need_admin": True}), 403
    catalogue_id = get_current_catalogue_id()
    name = ((request.get_json(silent=True) or {}).get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "Name is required"}), 400
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO categories (catalogue_id, name) VALUES (?, ?)",
            (catalogue_id, name),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"success": False, "error": "Category already exists"}), 400
    conn.close()
    return jsonify({"success": True})


@app.route("/api/categories/<int:cat_id>", methods=["POST"])
def api_categories_update(cat_id):
    if not is_admin_session():
        return jsonify({"success": False, "need_admin": True}), 403
    catalogue_id = get_current_catalogue_id()
    payload = request.get_json(silent=True) or {}
    action = (payload.get("action") or "").strip().lower()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, catalogue_id FROM categories WHERE id = ?", (cat_id,))
    row = cur.fetchone()
    if not row or int(row["catalogue_id"]) != catalogue_id:
        conn.close()
        return jsonify({"success": False, "error": "Category not found"}), 404
    old_name = row["name"]
    if action == "rename":
        new_name = (payload.get("name") or "").strip()
        if not new_name:
            conn.close()
            return jsonify({"success": False, "error": "Name is required"}), 400
        try:
            cur.execute("UPDATE categories SET name = ? WHERE id = ?", (new_name, cat_id))
            cur.execute(
                "UPDATE products SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE catalogue_id = ? AND TRIM(IFNULL(category,'')) = ?",
                (new_name, catalogue_id, old_name),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            conn.close()
            return jsonify({"success": False, "error": "A category with that name already exists"}), 400
        conn.close()
        return jsonify({"success": True})
    if action == "delete":
        cur.execute(
            "SELECT COUNT(*) FROM products WHERE catalogue_id = ? AND TRIM(IFNULL(category,'')) = ?",
            (catalogue_id, old_name),
        )
        n = cur.fetchone()[0]
        if n > 0:
            conn.close()
            return jsonify({"success": False, "error": "Cannot delete a category that still has products"}), 400
        cur.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    conn.close()
    return jsonify({"success": False, "error": "Invalid action"}), 400


@app.route("/product/new", methods=["GET", "POST"])
def create_product():
    return redirect(url_for("products_hub", new="1"))


@app.route("/setup")
def setup():
    return render_template("setup.html")


@app.route("/help")
def help_page():
    return render_template("help.html")


@app.route("/catalogues", methods=["GET", "POST"])
def catalogues_page():
    if request.method == "POST":
        action = (request.form.get("action") or "").strip()
        conn = get_conn()
        cur = conn.cursor()
        if action == "rename_current":
            current_id = get_current_catalogue_id()
            new_name = (request.form.get("current_name") or "").strip()
            if new_name:
                try:
                    cur.execute("UPDATE catalogues SET name = ? WHERE id = ?", (new_name, current_id))
                    conn.commit()
                    set_setting("current_catalogue_id", str(current_id))
                except sqlite3.IntegrityError:
                    conn.close()
                    return redirect(url_for("catalogues_page", manage_error=f"Catalogue name '{new_name}' already exists."))
            else:
                conn.close()
                return redirect(url_for("catalogues_page", manage_error="Please enter a catalogue name."))
        elif action == "create":
            new_name = (request.form.get("new_name") or "").strip()
            if new_name:
                try:
                    cur.execute("INSERT INTO catalogues (name) VALUES (?)", (new_name,))
                    conn.commit()
                    new_catalogue_id = cur.lastrowid
                    set_setting("current_catalogue_id", str(new_catalogue_id))
                    set_catalogue_setting(new_catalogue_id, "shopify_store_url", "")
                    set_catalogue_setting(new_catalogue_id, "shopify_api_key", "")
                    set_catalogue_setting(new_catalogue_id, "products_total_target", "2036")
                except sqlite3.IntegrityError:
                    conn.close()
                    return redirect(url_for("catalogues_page", manage_error=f"Catalogue name '{new_name}' already exists."))
            else:
                conn.close()
                return redirect(url_for("catalogues_page", manage_error="Please enter a catalogue name."))
        conn.close()
        return redirect(url_for("catalogues_page", manage_message="Catalogue updated successfully."))

    return render_template(
        "catalogues.html",
        import_message=(request.args.get("import_message") or "").strip(),
        import_error=(request.args.get("import_error") or "").strip(),
        manage_message=(request.args.get("manage_message") or "").strip(),
        manage_error=(request.args.get("manage_error") or "").strip(),
    )


@app.route("/catalogues/switch", methods=["POST"])
def switch_catalogue():
    selected = (request.form.get("catalogue_id") or "").strip()
    if selected.isdigit():
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT id FROM catalogues WHERE id = ?", (int(selected),))
        row = cur.fetchone()
        conn.close()
        if row:
            set_setting("current_catalogue_id", str(row["id"]))
    return redirect(request.referrer or url_for("index"))


@app.route("/catalogues/import", methods=["POST"])
def import_catalogue_excel():
    tmp_path = None
    try:
        file = request.files.get("excel_file")
        if not file or not file.filename:
            return redirect(url_for("catalogues_page", import_error="Please select an Excel file."))
        incoming_name = os.path.basename(file.filename)
        tmp_path = os.path.join(DATA_DIR, f"catalogue_upload_{incoming_name}")
        file.save(tmp_path)
        catalogue_id = get_current_catalogue_id()
        import_mode = (request.form.get("import_mode") or "upsert").strip().lower()
        update_existing = import_mode != "insert_only"
        imported, skipped, summary = import_excel(tmp_path, catalogue_id=catalogue_id, update_existing=update_existing)
        updated = int(summary.get("updated", 0))
        backfill_shopify_sku()
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT OR IGNORE INTO categories (catalogue_id, name)
            SELECT DISTINCT catalogue_id, TRIM(category)
            FROM products
            WHERE catalogue_id = ? AND category IS NOT NULL AND TRIM(category) != ''
            """,
            (catalogue_id,),
        )
        conn.commit()
        conn.close()
        reason_parts = []
        if summary.get("missing_stock_code"):
            reason_parts.append(f"{summary['missing_stock_code']} missing stock code")
        if summary.get("duplicate_in_file"):
            reason_parts.append(f"{summary['duplicate_in_file']} duplicate in file")
        if summary.get("existing_stock_code"):
            reason_parts.append(f"{summary['existing_stock_code']} stock code already exists")
        if summary.get("other_catalogue_conflict"):
            reason_parts.append(f"{summary['other_catalogue_conflict']} exists in another catalogue")
        if summary.get("errors"):
            reason_parts.append(f"{summary['errors']} errors")
        reasons_text = "; ".join(reason_parts) if reason_parts else "No skipped-row reasons."
        mode_label = "Insert + Update" if update_existing else "Insert only"
        return redirect(url_for("catalogues_page", import_message=f"Import mode: {mode_label}. Inserted: {imported}, Updated: {updated}, Skipped: {skipped}. {reasons_text}"))
    except Exception as exc:
        print("\n[CATALOGUE IMPORT ERROR]")
        print(traceback.format_exc())
        return redirect(url_for("catalogues_page", import_error=f"Import failed: {str(exc) or 'Unknown error'}"))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


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
        imported, skipped, summary = import_excel(tmp_path)
        if imported == 0:
            return render_template("setup.html", error="Import failed or no valid rows found. Please confirm the Excel columns are: Stock Code, Description, Supplier, Category.")
        current_catalogue_id = get_current_catalogue_id()
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("UPDATE products SET catalogue_id = ? WHERE catalogue_id IS NULL", (current_catalogue_id,))
        cur.execute(
            """
            INSERT OR IGNORE INTO categories (catalogue_id, name)
            SELECT DISTINCT catalogue_id, TRIM(category)
            FROM products
            WHERE catalogue_id = ? AND category IS NOT NULL AND TRIM(category) != ''
            """,
            (current_catalogue_id,),
        )
        conn.commit()
        conn.close()
        backfill_shopify_sku()
        return redirect(url_for("index"))
    except Exception as exc:
        print("\n[SETUP IMPORT ERROR]")
        print(traceback.format_exc())
        return render_template("setup.html", error=f"Import failed with error: {str(exc) or 'Unknown error'}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.route("/product/<int:product_id>")
def product_page(product_id):
    catalogue_id = get_current_catalogue_id()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
    row = cur.fetchone()
    if not row:
        conn.close()
        return "Product not found", 404
    product = product_to_dict(row)
    cur.execute("SELECT id, stock_code FROM products WHERE catalogue_id = ? ORDER BY id ASC", (catalogue_id,))
    all_ids = [dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT COUNT(*) FROM products WHERE catalogue_id = ? AND status='done' AND IFNULL(shopify_pushed,0)=0",
        (catalogue_id,),
    )
    ready_to_push = cur.fetchone()[0]
    conn.close()
    pos = next((i for i, p in enumerate(all_ids) if p["id"] == product_id), 0)
    prev_item = all_ids[pos - 1] if pos > 0 else all_ids[-1]
    next_item = all_ids[pos + 1] if pos < len(all_ids) - 1 else all_ids[0]
    stats = get_counts(catalogue_id)
    configured = bool(
        (get_catalogue_setting(catalogue_id, "shopify_store_url") or "").strip()
        and (get_catalogue_setting(catalogue_id, "shopify_api_key") or "").strip()
    )
    groq_configured = bool((get_setting("groq_api_key") or "").strip())
    needs_repush = bool(product["shopify_pushed"] and product["shopify_pushed_at"] and product["updated_at"] and product["updated_at"] > product["shopify_pushed_at"])
    embed = request.args.get("embed") == "1"
    category_options = list_category_labels(catalogue_id)
    template_name = "product_embed.html" if embed else "product.html"
    return render_template(
        template_name,
        product=product,
        previous=prev_item,
        next_item=next_item,
        position=pos + 1,
        target_total=int(get_catalogue_setting(catalogue_id, "products_total_target") or "2036"),
        stats=stats,
        shopify_configured=configured,
        groq_configured=groq_configured,
        needs_repush=needs_repush,
        embed=embed,
        category_options=category_options,
        ready_to_push=ready_to_push,
    )


@app.route("/product/<int:product_id>/save", methods=["POST"])
def save_product(product_id):
    catalogue_id = get_current_catalogue_id()
    payload = request.get_json(silent=True) or {}
    photos = payload.get("photos", [])
    if isinstance(photos, str):
        try:
            photos = json.loads(photos)
        except (ValueError, TypeError):
            photos = []
    if not isinstance(photos, list):
        photos = []
    photo_paths = [os.path.basename(str(p)) for p in photos if p is not None and str(p).strip()]
    status = payload.get("status", "pending")
    if status not in ("pending", "done"):
        status = "pending"
    name = (payload.get("name") or "").strip()
    category = (payload.get("category") or "").strip()
    supplier = (payload.get("supplier") or "").strip()
    stock_code_new = (payload.get("stock_code") or "").strip()
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT stock_code, name FROM products WHERE id = ? AND catalogue_id = ?",
            (product_id, catalogue_id),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "error": "Product not found"}), 404
        old_code = row["stock_code"]
        old_name = row["name"]
        if not stock_code_new:
            stock_code_new = old_code
        if stock_code_new != old_code:
            cur.execute(
                "SELECT 1 FROM products WHERE stock_code = ? AND id != ?",
                (stock_code_new, product_id),
            )
            if cur.fetchone():
                return jsonify({"success": False, "error": "Stock code already exists"}), 400
        display_name = name if name else old_name
        handle = slugify_text(display_name) or slugify_text(stock_code_new)
        cur.execute(
            """
            UPDATE products
               SET stock_code = ?, name = ?, category = ?, supplier = ?,
                   web_description = ?, sell_price = ?, compare_price = ?, tags = ?, notes = ?,
                   status = ?, photos = ?, shopify_sku = ?, shopify_handle = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND catalogue_id = ?
            """,
            (
                stock_code_new,
                display_name,
                category,
                supplier,
                payload.get("web_description", ""),
                payload.get("sell_price") if payload.get("sell_price") not in ("", None) else None,
                payload.get("compare_price") if payload.get("compare_price") not in ("", None) else None,
                payload.get("tags", ""),
                payload.get("notes", ""),
                status,
                json.dumps(photo_paths),
                (payload.get("shopify_sku") or "").strip() or None,
                handle,
                product_id,
                catalogue_id,
            ),
        )
        ensure_category_row(catalogue_id, category, conn=conn)
        conn.commit()
        cur.execute("SELECT * FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        row_after = cur.fetchone()
        if not row_after:
            return jsonify({"success": False, "error": "Product not found"}), 404
        return jsonify({"success": True, "product": product_to_dict(row_after)})
    except sqlite3.IntegrityError as exc:
        conn.rollback()
        return jsonify({"success": False, "error": str(exc) or "Database constraint failed"}), 400
    except sqlite3.OperationalError as exc:
        conn.rollback()
        return jsonify({"success": False, "error": f"Database error: {exc}"}), 503
    except Exception as exc:
        conn.rollback()
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc) or "Save failed"}), 500
    finally:
        conn.close()


@app.route("/api/upload-photo", methods=["POST"])
def api_upload_photo():
    try:
        catalogue_id = get_current_catalogue_id()
        if "photo" not in request.files:
            return jsonify({"success": False, "error": "No photo file received"}), 400
        file = request.files["photo"]
        product_id = request.form.get("product_id")
        if not product_id or file.filename is None or file.filename == "":
            return jsonify({"success": False, "error": "Empty file"}), 400
        try:
            product_id = int(product_id)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "Invalid product_id"}), 400
        ensure_storage_dirs()
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT stock_code, photos FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "Product not found"}), 404
        safe_code = str(row["stock_code"]).replace("/", "_").replace(".", "_").replace(" ", "_")
        filename = f"{safe_code}_{int(time.time())}.jpg"
        final_path = os.path.join(UPLOAD_DIR, filename)
        file.save(final_path)
        _process_uploaded_file_inplace(final_path)
        photos = parse_photos(row["photos"])
        photos.append(filename)
        cur.execute(
            "UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id = ? AND catalogue_id = ?",
            (json.dumps(photos), product_id, catalogue_id),
        )
        conn.commit()
        conn.close()
        url = f"/static/uploads/{filename}"
        return jsonify({"success": True, "filename": filename, "url": url, "processing": False})
    except Exception as exc:
        print(f"Upload error: {exc}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/photo-status/<path:filename>")
def api_photo_status(filename):
    try:
        safe_name = os.path.basename(filename)
        info = PHOTO_STATUS.get(safe_name)
        if info and info.get("status") == "processing":
            return jsonify({"status": "processing"})
        return jsonify({"status": "done", "url": f"/static/uploads/{safe_name}"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/delete-photo", methods=["POST"])
def api_delete_photo():
    try:
        catalogue_id = get_current_catalogue_id()
        payload = request.get_json(silent=True) or {}
        filename = os.path.basename(payload.get("filename", ""))
        product_id = int(payload.get("product_id", 0))
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT photos FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        row = cur.fetchone()
        if row:
            photos = [f for f in parse_photos(row["photos"]) if f != filename]
            cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id = ? AND catalogue_id = ?", (json.dumps(photos), product_id, catalogue_id))
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
        catalogue_id = get_current_catalogue_id()
        payload = request.get_json(silent=True) or {}
        product_id = int(payload.get("product_id", 0))
        filenames = [os.path.basename(f) for f in payload.get("filenames", [])]
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id = ? AND catalogue_id = ?", (json.dumps(filenames), product_id, catalogue_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/check-inbox")
def api_check_inbox():
    try:
        os.makedirs(INBOX_DIR, exist_ok=True)
        extensions = {".jpg", ".jpeg", ".png", ".webp", ".cr2", ".nef", ".arw", ".dng"}
        files = [f for f in os.listdir(INBOX_DIR) if os.path.splitext(f)[1].lower() in extensions]
        files.sort()
        return jsonify({"files": files})
    except Exception as exc:
        return jsonify({"files": [], "error": str(exc)})


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
        catalogue_id = get_current_catalogue_id()
        payload = request.get_json(silent=True) or {}
        filename = os.path.basename(payload.get("filename", ""))
        product_id = int(payload.get("product_id", 0))
        source = os.path.join(INBOX_DIR, filename)
        if not os.path.exists(source):
            return jsonify({"success": False, "error": "File not found"}), 404
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT stock_code, photos FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "Product not found"}), 404
        new_name = f"{sanitize_stock_code(row['stock_code'])}_{datetime.now().strftime('%Y%m%d%H%M%S%f')}.jpg"
        final_path = os.path.join(UPLOAD_DIR, new_name)
        shutil.move(source, final_path)
        photos = parse_photos(row["photos"])
        photos.append(new_name)
        cur.execute("UPDATE products SET photos=?, updated_at=CURRENT_TIMESTAMP WHERE id = ? AND catalogue_id = ?", (json.dumps(photos), product_id, catalogue_id))
        conn.commit()
        conn.close()
        _process_uploaded_file_inplace(final_path)
        return jsonify({"success": True, "filename": new_name, "url": f"/static/uploads/{new_name}", "processing": False})
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
        catalogue_id = get_current_catalogue_id()
        current_id = int(request.args.get("current_id", "0"))
        direction = request.args.get("direction", "next")
        filter_mode = request.args.get("filter", "all")
        conn = get_conn()
        cur = conn.cursor()
        if filter_mode == "pending":
            cur.execute("SELECT id, stock_code, name FROM products WHERE catalogue_id = ? AND status='pending' ORDER BY id ASC", (catalogue_id,))
        else:
            cur.execute("SELECT id, stock_code, name FROM products WHERE catalogue_id = ? ORDER BY id ASC", (catalogue_id,))
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
        stats = get_counts(get_current_catalogue_id())
        return jsonify({"total": stats["total"], "done": stats["done"], "pending": stats["pending"], "percent": stats["percent"]})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/settings")
def settings_page():
    catalogue_id = get_current_catalogue_id()
    configured = bool(
        (get_catalogue_setting(catalogue_id, "shopify_store_url") or "").strip()
        and (get_catalogue_setting(catalogue_id, "shopify_api_key") or "").strip()
    )
    return render_template(
        "settings.html",
        shopify_store_url=get_catalogue_setting(catalogue_id, "shopify_store_url") or "",
        shopify_api_key=get_catalogue_setting(catalogue_id, "shopify_api_key") or "",
        groq_api_key=get_setting("groq_api_key") or "",
        products_total_target=get_catalogue_setting(catalogue_id, "products_total_target") or "2036",
        shopify_configured=configured,
    )


@app.route("/settings/save", methods=["POST"])
def settings_save():
    try:
        if not is_admin_session():
            return jsonify({"success": False, "need_admin": True}), 403
        catalogue_id = get_current_catalogue_id()
        payload = request.get_json(silent=True) or {}
        set_catalogue_setting(catalogue_id, "shopify_store_url", (payload.get("shopify_store_url") or "").strip())
        set_catalogue_setting(catalogue_id, "shopify_api_key", (payload.get("shopify_api_key") or "").strip())
        set_setting("groq_api_key", (payload.get("groq_api_key") or "").strip())
        if payload.get("products_total_target") is not None:
            set_catalogue_setting(catalogue_id, "products_total_target", str(payload.get("products_total_target") or "2036"))
        ok, message = test_connection(catalogue_id)
        return jsonify({"success": True, "connected": ok, "message": message})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/shopify-status")
def api_shopify_status():
    try:
        catalogue_id = get_current_catalogue_id()
        store = (get_catalogue_setting(catalogue_id, "shopify_store_url") or "").strip()
        token = (get_catalogue_setting(catalogue_id, "shopify_api_key") or "").strip()
        return jsonify({"configured": bool(store and token), "store": store})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/push-to-shopify/<int:product_id>", methods=["POST"])
def api_push_one(product_id):
    try:
        catalogue_id = get_current_catalogue_id()
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        row = cur.fetchone()
        conn.close()
        if not row:
            return jsonify({"success": False, "error": "Product not found"}), 404
        result = push_product(product_to_dict(row), catalogue_id)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


def _batch_push_worker():
    global PUSH_PROGRESS
    catalogue_id = get_current_catalogue_id()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM products WHERE catalogue_id = ? AND status='done' AND shopify_pushed=0 ORDER BY id ASC", (catalogue_id,))
    rows = cur.fetchall()
    conn.close()
    PUSH_PROGRESS = {"running": True, "total": len(rows), "pushed": 0, "failed": 0, "current": ""}
    for row in rows:
        product = product_to_dict(row)
        PUSH_PROGRESS["current"] = product["stock_code"]
        result = push_product(product, catalogue_id)
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


@app.route("/api/rembg-warmup", methods=["POST"])
def api_rembg_warmup():
    try:
        warmup_in = os.path.join(DATA_DIR, "_rembg_warmup_in.jpg")
        warmup_out = os.path.join(DATA_DIR, "_rembg_warmup_out.jpg")
        img = Image.new("RGB", (64, 64), (240, 240, 240))
        img.save(warmup_in, "JPEG", quality=85)
        ok = process_photo(warmup_in, warmup_out)
        for p in (warmup_in, warmup_out):
            if os.path.exists(p):
                os.remove(p)
        return jsonify({"success": True, "downloaded": True, "processed": ok})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/api/generate-description", methods=["POST"])
def api_generate_description():
    try:
        data = request.get_json(silent=True) or {}
        product_id = data.get("product_id")
        if product_id is None:
            return jsonify({"success": False, "error": "product_id required"}), 400
        try:
            product_id = int(product_id)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "Invalid product_id"}), 400

        catalogue_id = get_current_catalogue_id()
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM products WHERE id = ? AND catalogue_id = ?", (product_id, catalogue_id))
        product = cur.fetchone()
        conn.close()

        if not product:
            return jsonify({"success": False, "error": "Product not found"}), 404

        api_key = (get_setting("groq_api_key") or "").strip()
        if not api_key:
            return jsonify({"success": False, "error": "Groq API key not configured. Go to Settings."}), 400

        sku = (product["shopify_sku"] or "").strip() or generate_shopify_sku(product["category"], product["stock_code"])
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "max_tokens": 200,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a professional product copywriter for a South African trailer parts company. "
                            "Write clear accurate product descriptions for a Shopify store. English only. "
                            "60 to 120 words. No bullet points. No headings. "
                            "Focus on what the part is what it does and what trailers it suits."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Write a product description for: Name: {product['name']} "
                            f"Category: {product['category'] or ''} SKU: {sku}. "
                            "Write the description paragraph only."
                        ),
                    },
                ],
            },
            timeout=30,
        )
        try:
            result = response.json()
        except ValueError:
            print(f"AI description non-JSON response: {response.text[:500]}")
            return jsonify({"success": False, "error": "Groq returned an invalid response"}), 502

        if response.status_code != 200:
            err = ""
            if isinstance(result, dict):
                err = (result.get("error") or {}).get("message") if isinstance(result.get("error"), dict) else str(result.get("error", ""))
            print(f"AI description error: {response.status_code} {result}")
            return jsonify({"success": False, "error": err or response.text[:300] or f"HTTP {response.status_code}"}), 502

        try:
            description = result["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError, AttributeError) as exc:
            print(f"AI description parse error: {exc} body={result}")
            return jsonify({"success": False, "error": "Groq response missing description text"}), 502

        if not description:
            return jsonify({"success": False, "error": "Groq returned empty description"})

        return jsonify({"success": True, "description": description})
    except Exception as e:
        print(f"AI description error: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    ensure_storage_dirs()
    init_db()
    clean_supplier_formulas()
    backfill_shopify_sku()
    print("\n=============================")
    print("  Catalog Manager is running")
    print("  http://localhost:5001")
    print(f"  Data directory: {os.path.abspath(DATA_DIR)}")
    print("=============================\n")
    app.run(debug=True, host="0.0.0.0", port=5001)
