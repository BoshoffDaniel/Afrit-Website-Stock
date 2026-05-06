# Build Instructions

## Dev setup
pip install flask pillow openpyxl requests rembg pyinstaller pystray

## Build exe
1. Run build.bat
2. Test: run dist/CatalogManager/CatalogManager.exe directly

## Build installer
1. Download Inno Setup FREE: https://jrsoftware.org/isinfo.php
2. Install Inno Setup
3. Right-click installer.iss -> Open with Inno Setup
4. Press F9 to compile
5. Find CatalogManager_Setup.exe in installer_output/

## Install on another PC
1. Copy CatalogManager_Setup.exe to USB
2. Double-click on target PC
3. Click Next, Next, Finish
4. Desktop shortcut appears
5. Double-click shortcut
6. Select Excel file on first run
7. Done - no Python needed

## Adding Shopify later
1. Open app -> click Settings (top right)
2. Enter your Shopify store URL and API key
3. Click Save and Test Connection
4. Green = connected
5. Go to any product -> click Push to Shopify
   OR on dashboard -> Push all done products

## Updating the app
1. Make code changes
2. Run build.bat
3. Compile installer.iss in Inno Setup
4. Distribute new CatalogManager_Setup.exe
5. Users install over old version
6. All data preserved (stored in C:\ProgramData\CatalogManager\)
