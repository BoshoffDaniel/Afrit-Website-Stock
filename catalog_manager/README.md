# Catalog Manager

## Setup (first time only)
1. pip install flask pillow openpyxl
2. python import_excel.py your_spreadsheet.xlsx
3. python app.py
4. Open browser: http://localhost:5001

## Daily use
1. python app.py
2. Open browser: http://localhost:5001
3. Click any pending product
4. Add photos and write a description
5. Set the sell price
6. Click Done — next product loads automatically

## Adding photos
- Camera WiFi: point your camera software to save to the camera_inbox/ folder
- Design office files: drag and drop directly onto the product page
- See http://localhost:5001/help for detailed instructions

## Access from your phone
Run ipconfig (Windows) in terminal to find your PC's IP address
On your phone browser: http://[your-ip-address]:5001

## Export to Shopify
Click "Export to Shopify CSV" on the dashboard
Send the CSV file and the static/uploads/ folder to your web developer
