import base64
import os
from datetime import datetime

import requests

from database import get_conn, get_setting

DATA_DIR = os.environ.get("CATALOG_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(DATA_DIR, "static", "uploads")
API_VERSION = "2024-01"


def get_headers():
    api_key = (get_setting("shopify_api_key") or "").strip()
    store = (get_setting("shopify_store_url") or "").strip().replace("https://", "").replace("http://", "")
    return store, {
        "X-Shopify-Access-Token": api_key,
        "Content-Type": "application/json",
    }


def _is_configured():
    store, headers = get_headers()
    token = headers.get("X-Shopify-Access-Token", "")
    return bool(store and token)


def test_connection():
    if not _is_configured():
        return False, "Missing Shopify store URL or API key."
    store, headers = get_headers()
    url = f"https://{store}/admin/api/{API_VERSION}/shop.json"
    try:
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code == 200:
            return True, "Connected successfully."
        return False, f"Shopify responded with {response.status_code}: {response.text[:160]}"
    except requests.RequestException as exc:
        return False, str(exc)


def upload_image_to_shopify(product_id, image_path, alt_text):
    store, headers = get_headers()
    with open(image_path, "rb") as file:
        encoded = base64.b64encode(file.read()).decode("utf-8")
    payload = {"image": {"attachment": encoded, "alt": alt_text or ""}}
    url = f"https://{store}/admin/api/{API_VERSION}/products/{product_id}/images.json"
    response = requests.post(url, headers=headers, json=payload, timeout=40)
    response.raise_for_status()
    data = response.json()
    return str(data["image"]["id"])


def _variant_payload(product_dict):
    return {
        "sku": product_dict["stock_code"],
        "price": str(product_dict["sell_price"] if product_dict["sell_price"] is not None else ""),
        "compare_at_price": (
            str(product_dict["compare_price"]) if product_dict["compare_price"] not in (None, "") else None
        ),
        "inventory_management": None,
        "fulfillment_service": "manual",
        "requires_shipping": True,
        "taxable": True,
    }


def create_product(product_dict):
    store, headers = get_headers()
    payload = {
        "product": {
            "title": product_dict["name"],
            "body_html": "<p>" + (product_dict.get("web_description") or "") + "</p>",
            "vendor": product_dict.get("supplier") or "",
            "product_type": product_dict.get("category") or "",
            "tags": product_dict.get("tags") or "",
            "status": "active" if product_dict.get("status") == "done" else "draft",
            "variants": [_variant_payload(product_dict)],
        }
    }
    response = requests.post(
        f"https://{store}/admin/api/{API_VERSION}/products.json",
        headers=headers,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return str(data["product"]["id"])


def update_product(shopify_id, product_dict):
    store, headers = get_headers()
    payload = {
        "product": {
            "id": int(shopify_id),
            "title": product_dict["name"],
            "body_html": "<p>" + (product_dict.get("web_description") or "") + "</p>",
            "vendor": product_dict.get("supplier") or "",
            "product_type": product_dict.get("category") or "",
            "tags": product_dict.get("tags") or "",
            "status": "active" if product_dict.get("status") == "done" else "draft",
            "variants": [_variant_payload(product_dict)],
        }
    }
    response = requests.put(
        f"https://{store}/admin/api/{API_VERSION}/products/{shopify_id}.json",
        headers=headers,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    return True


def push_product(product):
    if not _is_configured():
        return {
            "success": False,
            "error": "Shopify not configured. Go to Settings to add your API key.",
        }
    try:
        if product.get("shopify_id"):
            shopify_id = str(product["shopify_id"])
            update_product(shopify_id, product)
        else:
            shopify_id = create_product(product)

        for filename in (product.get("photos") or []):
            full_path = os.path.join(UPLOAD_DIR, os.path.basename(filename))
            if os.path.exists(full_path):
                upload_image_to_shopify(shopify_id, full_path, product.get("name") or "")

        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE products
               SET shopify_id = ?, shopify_pushed = 1, shopify_pushed_at = CURRENT_TIMESTAMP
             WHERE id = ?
            """,
            (shopify_id, product["id"]),
        )
        conn.commit()
        conn.close()
        return {"success": True, "shopify_id": shopify_id}
    except Exception as exc:  # pragma: no cover
        return {"success": False, "error": str(exc)}
