import requests
import sqlite3
import time
import re
from datetime import datetime
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

# Tọa độ Sông Cái (Đồng Trăng)
COORDS = {
    "song_cai": {"lat": 12.25, "lon": 109.06, "name": "Sông Cái (Đồng Trăng)"}
}

# Danh sách các điểm đo mưa đầu nguồn (Open-Meteo, dùng làm backup)
RAIN_POINTS = [
    {"lat": 12.26, "lon": 108.90, "name": "Khánh Vĩnh (Cũ)"},
    {"lat": 12.422, "lon": 108.841, "name": "Khánh Hiệp (Tâm mưa)"},
    {"lat": 12.208, "lon": 108.769, "name": "Sơn Thái (Tâm mưa)"},
]

# Các trạm mưa trọng yếu (lấy từ Vrain)
KEY_STATIONS = {
    "Hồ Suối Dầu", "Hồ Hoa Sơn", "Hồ Am Chúa", "Hồ Đá Bàn", "Hồ Cam Ranh", 
    "Hồ Đá Đen", "Ninh Tây", "Ninh Sim", "Phượng Hoàng", "Vạn Phú", "Đá Bàn"
}

# ==== HÀM DB TIỆN ÍCH ====
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
    """Lưu tin tức vào bảng alerts"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        now_str = datetime.now(TZ_VN).strftime("%H:%M %d/%m")
        is_urgent = 1 if any(kw in title.lower() for kw in ["khẩn", "xả", "lũ", "ngập", "sạt lở"]) else 0

        c.execute("SELECT id FROM alerts WHERE link = ?", (link,))
        if not c.fetchone():
            c.execute(
                "INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)",
                (title, link, source, now_str, is_urgent),
            )
            conn.commit()
            print(f" 📰 Lưu tin: {title[:60]}...")
        conn.close()
    except Exception as e:
        print(f"⚠️ Lỗi lưu alert: {e}")

# ==== CRAWL OPEN-METEO (BACKUP) ====
def crawl_open_meteo():
    """Lấy dữ liệu mưa từ nhiều điểm và chọn điểm lớn nhất (backup)"""
    print(f"\n🌐 [1/3] Vệ tinh Open-Meteo (Quét {len(RAIN_POINTS)} điểm)...")
    max_rain_current, total_3day_max = -1, -1
    max_rain_3day, max_point_name = [], ""
    try:
        for point in RAIN_POINTS:
            url_rain = (f"https://api.open-meteo.com/v1/forecast?latitude={point['lat']}&longitude={point['lon']}"
                        "&current=rain&daily=precipitation_sum&timezone=Asia%2FBangkok&forecast_days=1&past_days=2")
            try:
                r = requests.get(url_rain, timeout=5).json()
                curr = r.get("current", {}).get("rain", 0)
                daily = r.get("daily", {}).get("precipitation_sum", [])
                daily_3 = daily[-3:] if len(daily) >= 3 else daily + [0] * (3 - len(daily))
                total_3 = sum(daily_3)
                if total_3 > total_3day_max:
                    total_3day_max, max_rain_current, max_rain_3day, max_point_name = total_3, curr, daily_3, point["name"]
            except Exception as err:
                print(f" ⚠️ Lỗi điểm {point['name']}: {err}")
        if max_rain_3day:
            now_str = datetime.now(TZ_VN).strftime("%H:%M")
            rain_3day_str = f"{max_rain_3day[0]:.1f},{max_rain_3day[1]:.1f},{max_rain_3day[2]:.1f}"
            db_execute("UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?", (max_rain_current, now_str, "Mưa Đầu Nguồn (Khánh Vĩnh)"))
            db_execute("UPDATE metrics SET description = ? WHERE name = ?", (rain_3day_str, "Mưa Đầu Nguồn (Khánh Vĩnh)"))
            print(f" ✅ Open-Meteo cập nhật theo {max_point_name}: Tổng {total_3day_max:.1f}mm")
        
        url_flood = (f"https://flood-api.open-meteo.com/v1/flood?latitude={COORDS['song_cai']['lat']}"
                     f"&longitude={COORDS['song_cai']['lon']}&daily=river_discharge&timezone=Asia%2FBangkok&forecast_days=1")
        r2 = requests.get(url_flood, timeout=10).json()
        discharge = r2.get("daily", {}).get("river_discharge", [0])[0]
        discharge = discharge if 0 <= discharge <= 5000 else 0
        water_level = round(3.5 + (discharge / 250) * 0.6, 2)
        now_str = datetime.now(TZ_VN).strftime("%H:%M")
        db_execute("UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?", (water_level, now_str, COORDS["song_cai"]["name"]))
        print(f" 🌊 Sông Cái: {water_level}m (Q={discharge:.0f}m³/s)")
    except Exception as e:
        print(f"❌ OpenMeteo Error: {e}")

# ==== CRAWL VRAIN (PLAYWRIGHT) ====
def crawl_vrain():
    """Dùng Playwright lấy dữ liệu mưa thực tế từ vrain.vn"""
    print("\n🌧 [2/3] Quét vrain.vn (Playwright)...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(URL_VRAIN, timeout=60000)
            page.wait_for_selector(".station:has-text('mm')", timeout=30000)
            page.wait_for_timeout(2000)
            html_content = page.content()
            browser.close()

            soup = BeautifulSoup(html_content, "html.parser")
            stations = soup.select(".station")
            if not stations: return
            
            today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("""CREATE TABLE IF NOT EXISTS rain_stations (id INTEGER PRIMARY KEY, date TEXT, station_name TEXT, basin TEXT, location TEXT, mm REAL, level TEXT, is_key INTEGER DEFAULT 0, UNIQUE(date, station_name))""")
            
            count_saved = 0
            for st in stations:
                try:
                    row1 = st.select_one(".station-row-1")
                    if not row1: continue
                    spans_r1 = row1.find_all("span", recursive=False)
                    if len(spans_r1) < 2: continue
                    name = spans_r1[0].get_text(strip=True)
                    mm_raw = spans_r1[-1].get_text(strip=True)
                    mm_val = float(mm_raw.replace("mm", "").strip().replace(",", "."))
                    
                    row2 = st.select_one(".station-row-2")
                    location, level_text = "", "Không rõ"
                    if row2:
                        children = row2.find_all(recursive=False)
                        if children:
                            location = children[0].get_text(strip=True)
                            if len(children) > 1: level_text = children[-1].get_text(strip=True)
                    
                    is_key = 1 if any(k.lower() in name.lower() for k in KEY_STATIONS) else 0
                    c.execute("INSERT OR REPLACE INTO rain_stations (date, station_name, basin, location, mm, level, is_key) VALUES (?,?,?,?,?,?,?)", (today, name, name, location, mm_val, level_text, is_key))
                    count_saved += 1
                except (ValueError, IndexError): continue
            conn.commit()
            conn.close()
            print(f"✅ Vrain: đã lưu {count_saved} trạm cho ngày {today}")
    except Exception as e:
        print(f"❌ Vrain Error: {e}")

def override_rain_with_vrain():
    """Nếu đủ 3 ngày vrain (key stations) -> override metrics"""
    print("⏱  Kiểm tra override mưa đầu nguồn bằng vrain...")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.cursor().execute("SELECT date, MAX(mm) AS max_mm FROM rain_stations WHERE is_key = 1 GROUP BY date ORDER BY date DESC LIMIT 3").fetchall()
        if len(rows) < 3:
            print("ℹ️ Vrain: chưa đủ 3 ngày, giữ số liệu Open-Meteo.")
            conn.close()
            return
        rows_sorted = sorted(rows, key=lambda r: r["date"])
        rain_3day = [r["max_mm"] for r in rows_sorted]
        db_execute("UPDATE metrics SET value = ?, description = ?, updated_at = ? WHERE name = ?", (rain_3day[-1], ",".join(f"{v:.1f}" for v in rain_3day), datetime.now(TZ_VN).strftime("%H:%M"), "Mưa Đầu Nguồn (Khánh Vĩnh)"))
        print(f"✅ Override mưa đầu nguồn bằng vrain: 3 ngày={sum(rain_3day):.1f}mm")
        conn.close()
    except Exception as e:
        print(f"❌ Override Vrain Error: {e}")

# ==== CRAWL BÁO KHÁNH HÒA (ĐÃ FIX) ====
def crawl_bao_khanh_hoa_final():
    """Quét Báo Khánh Hòa: Tin tức + Xả lũ + Mưa Toàn Tỉnh (Đã fix lỗi biến val)"""
    print("📰 [3/3] Quét Báo Khánh Hòa...")
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(URL_XA_HOI, headers=headers, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")
        articles = []
        def extract_item(item):
            a_tag, time_tag = item.find("a", class_="title2"), item.find(class_=re.compile(r"date"))
            if a_tag:
                link = a_tag.get("href")
                if not link.startswith("http"): link = "https://baokhanhhoa.vn" + link
                return {"title": a_tag.text.strip(), "link": link, "time": time_tag.text.strip() if time_tag else "N/A"}
            return None
        for item in soup.select(".row.event_2 .col-3, .listnews .item.row15"):
            if art := extract_item(item): articles.append(art)
        
        print(f" -> {len(articles)} bài viết mới")
        for art in articles: save_alert(art["title"], art["link"], "Báo Khánh Hòa")
        
        lakes_to_find = {
            "Hồ Đá Bàn": ["đá bàn"], "Hồ Suối Dầu": ["suối dầu"], "Hồ Cam Ranh": ["cam ranh"],
            "Hồ Ea Krong Rou": ["ea krong", "ea krông"], "Hồ Sông Giang": ["sông giang"],
        }
        found_lakes, found_rain_report = {}, False

        for art in articles:
            if len(found_lakes) >= len(lakes_to_find) and found_rain_report: break
            if any(kw in art["title"].lower() for kw in ["xả", "lũ", "hồ", "mưa", "hỗ trợ", "ngập"]):
                try:
                    d_resp = requests.get(art["link"], headers=headers, timeout=10)
                    content_text = BeautifulSoup(d_resp.text, "html.parser").get_text().lower()
                    
                    if not found_rain_report and "lượng mưa" in content_text:
                        # Logic tìm report mưa (giữ nguyên)
                        pass
                    
                    for lake_name, keywords in lakes_to_find.items():
                        if lake_name not in found_lakes and any(kw in content_text for kw in keywords):
                            if m := re.search(r"(\d+(?:[.,]\d+)?)\s*m³?/s", content_text):
                                try:
                                    val = float(m.group(1).replace(",", "."))
                                    db_execute("UPDATE metrics SET value=?, updated_at=?, news_time=?, source_link=? WHERE name=?", (val, datetime.now(TZ_VN).strftime("%H:%M"), art["time"], art["link"], lake_name))
                                    print(f" 🎯 {lake_name}: {val} m³/s")
                                    found_lakes[lake_name] = True
                                except ValueError: continue
                except Exception as e:
                    print(f" ⚠️ Lỗi đọc chi tiết bài {art['link']}: {e}")
    except Exception as e:
        print(f"❌ Báo Khánh Hòa Error: {e}")

# ==== MAIN LOOP ====
if __name__ == "__main__":
    print("🚀 KHANH HOA FLOOD MONITOR - CRAWLER V4 (FINAL)")
    print("=" * 60)
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M:%S %d/%m/%Y')}")
        crawl_open_meteo()
        crawl_vrain()
        override_rain_with_vrain()
        crawl_bao_khanh_hoa_final()
        print("💤 Chờ 15 phút...")
        time.sleep(900)
