import os
import sys
import threading
import time
import webbrowser
import shutil

import pystray
from PIL import Image, ImageDraw

if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
    DATA_DIR = os.path.join(os.environ.get("PROGRAMDATA", "C:\\ProgramData"), "CatalogManager")
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DATA_DIR = BASE_DIR

os.makedirs(os.path.join(DATA_DIR, "static", "uploads"), exist_ok=True)
os.makedirs(os.path.join(DATA_DIR, "camera_inbox"), exist_ok=True)
os.makedirs(os.path.join(DATA_DIR, "exports"), exist_ok=True)

os.environ["CATALOG_DATA_DIR"] = DATA_DIR
os.environ["CATALOG_BASE_DIR"] = BASE_DIR


def seed_static_assets():
    """Copy bundled static files into ProgramData on first run/update."""
    source_static = os.path.join(BASE_DIR, "static")
    target_static = os.path.join(DATA_DIR, "static")
    if not os.path.isdir(source_static):
        return
    for root, _dirs, files in os.walk(source_static):
        rel = os.path.relpath(root, source_static)
        target_root = os.path.join(target_static, rel) if rel != "." else target_static
        os.makedirs(target_root, exist_ok=True)
        for name in files:
            src = os.path.join(root, name)
            dst = os.path.join(target_root, name)
            # Always overwrite css/js to keep installed app in sync with updates.
            try:
                shutil.copy2(src, dst)
            except OSError:
                pass


def start_flask():
    from app import app
    from database import init_db

    init_db()
    app.run(host="0.0.0.0", port=5001, debug=False, use_reloader=False)


def open_browser():
    time.sleep(2.5)
    webbrowser.open("http://localhost:5001")


def make_icon_image():
    img = Image.new("RGB", (64, 64), color="#2d8a4e")
    draw = ImageDraw.Draw(img)
    draw.rectangle([4, 4, 60, 60], fill="#2d8a4e")
    draw.text((14, 18), "CM", fill="white")
    return img


def create_tray():
    def on_open(icon, item):
        webbrowser.open("http://localhost:5001")

    def on_quit(icon, item):
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Open Catalog Manager", on_open),
        pystray.MenuItem("Quit", on_quit),
    )
    icon = pystray.Icon("CatalogManager", make_icon_image(), "Catalog Manager", menu)
    return icon


seed_static_assets()
threading.Thread(target=start_flask, daemon=True).start()
threading.Thread(target=open_browser, daemon=True).start()
create_tray().run()
