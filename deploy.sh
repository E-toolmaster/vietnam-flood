#!/bin/bash

# --- CONFIG ---
PROJECT_ROOT="/var/www/khanhhoa-flood"
WEB_DIR="$PROJECT_ROOT/web"
CRAWL_DIR="$PROJECT_ROOT/crawl"
DB_PATH="$CRAWL_DIR/flood.db"

echo "🚀 Starting Deployment for Khanh Hoa Flood..."

# 1. Pull latest code
cd $PROJECT_ROOT
git pull origin main

# 2. Setup Crawler
echo "🐍 Updating Crawler..."
cd $CRAWL_DIR
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt || pip install requests beautifulsoup4 pytz playwright
playwright install-deps
playwright install chromium

# 3. Setup Web
echo "🌐 Updating Web..."
cd $WEB_DIR
npm install
npm run build

# 4. PM2 Management
echo "🔄 Restarting PM2 processes..."

# Restart Crawler
pm2 delete flood-crawler 2>/dev/null || true
pm2 start worker_real.py --name "flood-crawler" --interpreter ./venv/bin/python

# Restart Web with Absolute DB Path
pm2 delete flood-web 2>/dev/null || true
DATABASE_URL=$DB_PATH pm2 start npm --name "flood-web" -- start -- -p 3000

echo "✅ Deployment Finished!"
pm2 list
