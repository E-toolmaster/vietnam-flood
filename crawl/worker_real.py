import requests
import sqlite3
import time
import re
from datetime import datetime, timedelta
import pytz
from bs4 import BeautifulSoup
import os
from playwright.sync_api import sync_playwright

# === CẤU HÌNH ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "flood.db")
TZ_VN = pytz.timezone("Asia/Ho_Chi_Minh")

URL_XA_HOI = "https://baokhanhhoa.vn/xa-hoi/"
URL_VRAIN = "https://vrain.vn/37/overview?public_map=windy"

# Mức báo động Sông Cái
FLOOD_LEVELS = {"bao_dong_1": 8.0, "bao_dong_2": 9.5, "bao_dong_3": 10.5}
COORDS = {"song_cai": {"lat": 12.25, "lon": 109.06, "name": "Sông Cái (Đồng Trăng)"}}

# Backup Open-Meteo
RAIN_POINTS = [
    {"lat": 12.26, "lon": 108.90, "name": "Khánh Vĩnh (Cũ)"},
    {"lat": 12.422, "lon": 108.841, "name": "Khánh Hiệp (Tâm mưa)"},
    {"lat": 12.208, "lon": 108.769, "name": "Sơn Thái (Tâm mưa)"},
]

# === TRẠM TRỌNG YẾU (KEY STATIONS) ===
KEY_STATIONS = {
    # Thượng nguồn Sông Cái (Khánh Vĩnh)
    "Khánh Vĩnh", "Khánh Nam", "Khánh Đông", "Sông Cầu", "Giang Ly", 
    "Khánh Hiệp", "Khánh Thượng", "Khánh Bình", "Liên Sang",
    # Hồ chứa & Trung lưu
    "Hồ Suối Dầu", "Hồ Am Chúa", "Diên Khánh", "Suối Tiên", "Đồng Trăng"
}

# ==== DB UTILS ====
def db_execute(query, params=()):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(query, params)
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"❌ DB Error: {e}")
        return False

def save_alert(title, link, source):
    FLOOD_KEYWORDS = ["lũ", "lụt", "ngập", "mưa", "bão", "áp thấp", "sạt lở", "thủy điện", "xả", "triều cường", "thiên tai", "thời tiết", "khẩn cấp", "sơ tán"]
    try:
        if not any(k in title.lower() for k in FLOOD_KEYWORDS): return
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        is_urgent = 1 if "khẩn cấp" in title.lower() else 0
        c.execute("SELECT id FROM alerts WHERE link = ?", (link,))
        if not c.fetchone():
            c.execute("INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)",
                      (title, link, source, datetime.now(TZ_VN).strftime("%H:%M %d/%m"), is_urgent))
            conn.commit()
            print(f" 📰 Lưu tin: {title[:50]}...")
        conn.close()
    except Exception as e: print(f"⚠️ Lỗi lưu alert: {e}")

# ==== CRAWL FUNCTIONS ====
def crawl_open_meteo():
    print(f"\n🌐 [1/4] Open-Meteo Backup...")
    max_rain_current, total_3day_max = -1, -1
    max_rain_3day, max_point_name = [], ""
    try:
        for point in RAIN_POINTS:
            url = f"https://api.open-meteo.com/v1/forecast?latitude={point['lat']}&longitude={point['lon']}&current=rain&daily=precipitation_sum&timezone=Asia%2FBangkok&forecast_days=1&past_days=2"
            try:
                r = requests.get(url, timeout=5).json()
                curr = r.get("current", {}).get("rain", 0)
                daily = r.get("daily", {}).get("precipitation_sum", [])
                if len(daily) < 3: daily = [0]*(3-len(daily)) + daily
                daily_3 = daily[-3:]
                if sum(daily_3) > total_3day_max:
                    total_3day_max, max_rain_current, max_rain_3day, max_point_name = sum(daily_3), curr, daily_3, point["name"]
            except: continue
        if max_rain_3day:
            desc = ",".join(f"{v:.1f}" for v in max_rain_3day)
            db_execute("UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?", (max_rain_current, datetime.now(TZ_VN).strftime("%H:%M"), "Mưa Thượng Nguồn (Max)"))
            db_execute("UPDATE metrics SET description = ? WHERE name = ?", (desc, "Mưa Thượng Nguồn (Max)"))
            print(f" ✅ Open-Meteo: {max_point_name} (3 ngày: {total_3day_max:.1f}mm)")
    except Exception as e: print(f"❌ OpenMeteo: {e}")

def crawl_vrain():
    print("\n🌧 [2/4] Quét Vrain...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(URL_VRAIN, timeout=60000)
            page.wait_for_selector(".station:has-text('mm')", timeout=30000)
            page.wait_for_timeout(3000)
            html = page.content()
            browser.close()
            
            soup = BeautifulSoup(html, "html.parser")
            stations = soup.select(".station")
            if not stations: return

            today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""CREATE TABLE IF NOT EXISTS rain_stations (id INTEGER PRIMARY KEY, date TEXT, station_name TEXT, basin TEXT, location TEXT, mm REAL, level TEXT, is_key INTEGER DEFAULT 0, UNIQUE(date, station_name))""")
            
            cnt = 0
            for st in stations:
                try:
                    r1 = st.select_one(".station-row-1")
                    if not r1: continue
                    spans = r1.find_all("span", recursive=False)
                    if len(spans)<2: continue
                    name = spans[0].get_text(strip=True)
                    mm = float(spans[-1].get_text(strip=True).replace("mm","").replace(",",".").strip())
                    
                    r2 = st.select_one(".station-row-2")
                    loc, lvl = "", ""
                    if r2:
                        childs = r2.find_all(recursive=False)
                        if childs: loc = childs[0].get_text(strip=True)
                        if len(childs)>1: lvl = childs[-1].get_text(strip=True)
                    
                    is_key = 1 if any(k.lower() in name.lower() for k in KEY_STATIONS) else 0
                    c.execute("INSERT OR REPLACE INTO rain_stations (date, station_name, basin, location, mm, level, is_key) VALUES (?,?,?,?,?,?,?)", (today, name, name, loc, mm, lvl, is_key))
                    cnt+=1
                except: continue
            conn.commit()
            conn.close()
            print(f"✅ Vrain: đã lưu {cnt} trạm.")
    except Exception as e: print(f"❌ Vrain: {e}")

def override_rain_with_vrain():
    print("⏱  Tính mưa tích lũy 3 ngày (Vrain)...")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        today = datetime.now(TZ_VN).date()
        dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(2, -1, -1)]
        placeholders = ','.join('?' for _ in dates)
        
        # Tìm trạm KEY có tổng mưa 3 ngày lớn nhất
        query = f"SELECT station_name, SUM(mm) as total FROM rain_stations WHERE is_key=1 AND date IN ({placeholders}) GROUP BY station_name ORDER BY total DESC LIMIT 1"
        top = cur.execute(query, dates).fetchone()
        
        if top:
            name, total = top['station_name'], top['total']
            rows = cur.execute(f"SELECT date, mm FROM rain_stations WHERE station_name=? AND date IN ({placeholders}) ORDER BY date", (name, *dates)).fetchall()
            rain_map = {r['date']: r['mm'] for r in rows}
            vals = [rain_map.get(d, 0.0) for d in dates]
            desc = ",".join(f"{v:.1f}" for v in vals)
            
            # Cập nhật metric "Mưa Thượng Nguồn (Max)"
            db_execute("UPDATE metrics SET value = ?, description = ?, updated_at = ? WHERE name = ?", 
                       (vals[-1], desc, datetime.now(TZ_VN).strftime("%H:%M"), "Mưa Thượng Nguồn (Max)"))
            print(f"✅ Max Rain ({name}): {total:.1f}mm ({desc})")
        conn.close()
    except Exception as e: print(f"❌ Calc Rain: {e}")

def crawl_song_cai():
    print("\n🌊 [3/4] Mực nước Sông Cái...")
    # 1. Tìm báo
    headers = {"User-Agent": "Mozilla/5.0"}
    news_lvl, news_link = None, None
    try:
        for url in [URL_XA_HOI, "https://baokhanhhoa.vn/tim-kiem/?q=mực+nước+sông+cái"]:
            try:
                soup = BeautifulSoup(requests.get(url, headers=headers, timeout=10).text, "html.parser")
                for a in soup.select("a.title2, .listnews .item a"):
                    if any(k in a.text.lower() for k in ["sông cái", "đồng trăng", "mực nước"]):
                        href = "https://baokhanhhoa.vn" + a.get("href") if not a.get("href").startswith("http") else a.get("href")
                        ct = requests.get(href, headers=headers).text.lower()
                        m = re.search(r"(?:tại|trạm|mực nước).*?đồng trăng.*?(\d+[.,]\d+)\s*m", ct)
                        if m: 
                            lvl = float(m.group(1).replace(",", "."))
                            if 3.0<=lvl<=16.0: news_lvl, news_link = lvl, href; break
            except: continue
            if news_lvl: break
    except: pass

    # 2. Tính toán (nếu không có báo)
    lvl, desc, est, link = 0, "", 0, ""
    if news_lvl:
        lvl, link, est = news_lvl, news_link, 0
        desc = f"📰 Báo KH | {get_status(lvl)}"
        print(f"✅ Tìm thấy trên báo: {lvl}m")
    else:
        try:
            conn = sqlite3.connect(DB_PATH)
            row = conn.cursor().execute("SELECT value FROM metrics WHERE name='Mưa Thượng Nguồn (Max)'").fetchone()
            rain = float(row[0]) if row else 0.0
            conn.close()
        except: rain = 0.0
        
        # Logic tính toán (Strict)
        if rain < 10: lvl = 4.0 + (rain/10.0)*0.5
        elif rain < 30: lvl = 4.5 + ((rain-10)/20.0)*1.5
        elif rain < 70: lvl = 6.0 + ((rain-30)*0.05)
        else: lvl = min(8.0 + ((rain-70)*0.05), 16.0)
        
        lvl = round(lvl, 2)
        est = 1
        desc = f"⚠️ Dự báo (Mưa {rain:.0f}mm) | {get_status(lvl)}"
        print(f"📊 Tính toán: {lvl}m (Rain={rain}mm)")

    # 3. Lưu
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Add columns if missing
        cols = [i[1] for i in c.execute("PRAGMA table_info(metrics)").fetchall()]
        if "is_estimated" not in cols: c.execute("ALTER TABLE metrics ADD COLUMN is_estimated INTEGER DEFAULT 0")
        if "source_link" not in cols: c.execute("ALTER TABLE metrics ADD COLUMN source_link TEXT")
        
        c.execute("UPDATE metrics SET value=?, updated_at=?, description=?, source_link=?, is_estimated=? WHERE name=?", 
                 (lvl, datetime.now(TZ_VN).strftime("%H:%M"), desc, link, est, COORDS["song_cai"]["name"]))
        conn.commit()
        conn.close()
    except Exception as e: print(f"❌ DB Error: {e}")

def get_status(lvl):
    if lvl >= FLOOD_LEVELS["bao_dong_3"]: return "🔴 Trên BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_2"]: return "🟠 BĐ2-BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_1"]: return "🟡 BĐ1-BĐ2"
    return "🟢 Dưới BĐ1"

def crawl_news():
    print("\n📰 [4/4] Quét tin tức...")
    try:
        soup = BeautifulSoup(requests.get(URL_XA_HOI, headers={"User-Agent":"Mozilla/5.0"}).text, "html.parser")
        for i in soup.select(".row.event_2 .col-3, .listnews .item"):
            a = i.find("a", class_="title2") or i.find("a")
            if a:
                lnk = "https://baokhanhhoa.vn"+a.get("href") if not a.get("href").startswith("http") else a.get("href")
                save_alert(a.text.strip(), lnk, "Báo Khánh Hòa")
    except: pass

if __name__ == "__main__":
    print("🚀 KHANH HOA FLOOD MONITOR - FINAL")
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M %d/%m')}")
        crawl_open_meteo()
        crawl_vrain()
        override_rain_with_vrain()
        crawl_song_cai()
        crawl_news()
        print("💤 Sleep 15m..."); time.sleep(900)
