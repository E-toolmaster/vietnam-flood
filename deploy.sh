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

# Restart Crawler (đường dẫn tuyệt đối — CWD lúc này là web/ nên path tương đối sẽ không tìm thấy script)
pm2 delete flood-crawler 2>/dev/null || true
pm2 start "$CRAWL_DIR/worker_real.py" --name "flood-crawler" --interpreter "$CRAWL_DIR/venv/bin/python"

# Restart Web with Absolute DB Path
# Port 3003 khớp với nginx: /etc/nginx/sites-enabled/khanhhoa-flood (proxy_pass localhost:3003).
# Port 3000 đã bị task-api (ohstudio-manager) chiếm — dùng 3000 sẽ gây EADDRINUSE crash-loop.
pm2 delete flood-web 2>/dev/null || true
cd $WEB_DIR
DATABASE_URL=$DB_PATH pm2 start npm --name "flood-web" -- start -- -p 3003

pm2 save
echo "✅ Deployment Finished!"
pm2 list
