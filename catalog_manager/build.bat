@echo off
echo ================================
echo  Building Catalog Manager...
echo ================================
python make_icon.py
python -m PyInstaller -y --clean --noconsole ^
  --name=CatalogManager ^
  --icon=icon.ico ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "icon.ico;." ^
  --add-data "icon.png;." ^
  launch.py
echo ================================
echo  Build complete!
echo  Find output in dist/CatalogManager/
echo  Now open installer.iss in Inno Setup
echo ================================
pause
