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

# Mức báo động Sông Cái Nha Trang (trạm Đồng Trăng)
FLOOD_LEVELS = {
    "bao_dong_1": 8.0,
    "bao_dong_2": 9.5,
    "bao_dong_3": 10.5,
}

# Tọa độ Sông Cái (Đồng Trăng)
COORDS = {
    "song_cai": {"lat": 12.25, "lon": 109.06, "name": "Sông Cái (Đồng Trăng)"}
}

# Danh sách các điểm đo mưa đầu nguồn (Open-Meteo - Giữ nguyên location)
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
        
        # --- ĐÃ SỬA: Chỉ gắn cờ khẩn cấp nếu tiêu đề có từ 'khẩn cấp' ---
        is_urgent = 1 if "khẩn cấp" in title.lower() else 0
        # ---------------------------------------------------------------

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

# ==== CRAWL OPEN-METEO (BACKUP CHO MƯA) ====
# (Giữ nguyên logic cũ)
def crawl_open_meteo():
    """Lấy dữ liệu mưa từ nhiều điểm và chọn điểm lớn nhất (backup)"""
    print(f"\n🌐 [1/4] Vệ tinh Open-Meteo (Quét {len(RAIN_POINTS)} điểm)...")
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
    except Exception as e:
        print(f"❌ OpenMeteo Error: {e}")

# ==== CRAWL VRAIN (PLAYWRIGHT) - ĐÃ KHÔI PHỤC LOCATION ====
def crawl_vrain():
    """Dùng Playwright lấy dữ liệu mưa thực tế từ vrain.vn (FULL DATA)"""
    print("\n🌧 [2/4] Quét vrain.vn (Playwright)...")
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
            # Table structure cũ vẫn giữ nguyên
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

                    # Phần lấy LOCATION đã được khôi phục
                    row2 = st.select_one(".station-row-2")
                    location, level_text = "", "Không rõ"
                    if row2:
                        children = row2.find_all(recursive=False)
                        if children:
                            location = children[0].get_text(strip=True) # Location: Xã/Huyện
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


# ==== LOGIC MỚI: CHỈ SỬA PHẦN TÍNH TOÁN DƯỚI ĐÂY ====

def crawl_water_level_from_news():
    """Ưu tiên lấy mực nước từ báo Khánh Hòa"""
    print("🔍 Tìm mực nước Sông Cái từ Báo Khánh Hòa...")
    headers = {"User-Agent": "Mozilla/5.0"}
    SEARCH_URLS = ["https://baokhanhhoa.vn/xa-hoi/", "https://baokhanhhoa.vn/tim-kiem/?q=mực+nước+sông+cái"]
    
    try:
        for url in SEARCH_URLS:
            try:
                resp = requests.get(url, headers=headers, timeout=10)
                soup = BeautifulSoup(resp.text, "html.parser")
                links = soup.select("a.title2, .listnews .item a")
                
                for link in links:
                    title = link.get_text(strip=True).lower()
                    # Chỉ đọc bài có từ khóa liên quan
                    if any(k in title for k in ["sông cái", "đồng trăng", "mực nước"]):
                        href = link.get("href")
                        if not href.startswith("http"): href = "https://baokhanhhoa.vn" + href
                        
                        # Đọc chi tiết bài báo
                        content = requests.get(href, headers=headers, timeout=5).text.lower()
                        
                        # Regex tìm mực nước thực đo
                        m = re.search(r"(?:tại|trạm|mực nước).*?đồng trăng.*?(\d+[.,]\d+)\s*m", content)
                        if m:
                            level = float(m.group(1).replace(",", "."))
                            if 3.0 <= level <= 16.0:
                                time_str = "Mới nhất" # Có thể parse time chi tiết nếu cần
                                return level, href, time_str
            except: continue
    except: pass
    return None, None, None

def calculate_water_level_khanh_vinh_strict(rain_mm):
    """
    LOGIC TÍNH TOÁN NGHIÊM NGẶT THEO YÊU CẦU:
    - Phụ thuộc hoàn toàn vào mưa Khánh Vĩnh.
    - Mưa < 10mm -> Level = 4.0m - 4.5m (Tuyệt đối không quá 5m).
    - Mưa 10-30mm -> Level = 4.5m - 6.0m.
    """
    if rain_mm is None: rain_mm = 0
    
    if rain_mm < 10:
        # Mưa rất nhỏ hoặc không mưa: Mực nước cơ sở mùa khô
        # Biến thiên 0-10mm chỉ làm tăng 0.5m nước
        return 4.0 + (rain_mm / 10.0) * 0.5 
    
    elif rain_mm < 30:
        # Mưa nhỏ: Nước lên nhẹ, tối đa 6m
        return 4.5 + ((rain_mm - 10) / 20.0) * 1.5
        
    elif rain_mm < 70:
        # Mưa vừa: Bắt đầu lên nhanh hơn
        return 6.0 + ((rain_mm - 30) * 0.05) 
    
    else:
        # Mưa lớn: Công thức thoát lũ
        # Cứ mỗi mm mưa thêm sẽ tăng mực nước nhanh hơn
        level = 8.0 + ((rain_mm - 70) * 0.05)
        return min(level, 16.0)

def get_flood_status(water_level):
    if water_level >= FLOOD_LEVELS["bao_dong_3"]: return "🔴 Trên BĐ3"
    elif water_level >= FLOOD_LEVELS["bao_dong_2"]: return "🟠 BĐ2-BĐ3"
    elif water_level >= FLOOD_LEVELS["bao_dong_1"]: return "🟡 BĐ1-BĐ2"
    return "🟢 Dưới BĐ1"

def crawl_song_cai_water_level():
    """
    Cập nhật mực nước Sông Cái.
    Logic:
    1. Ưu tiên số liệu Báo Khánh Hòa.
    2. Nếu không có -> Tính toán dựa trên Mưa Khánh Vĩnh (Logic Strict).
    """
    print("\n🌊 [3/4] Cập nhật mực nước Sông Cái (Đồng Trăng)...")

    water_level = None
    source_link = None
    description = ""
    is_estimated = False

    # 1. Thử tìm trên báo
    news_level, news_link, news_time = crawl_water_level_from_news()
    
    if news_level is not None:
        print(f"✅ TÌM THẤY TRÊN BÁO: {news_level}m")
        water_level = news_level
        source_link = news_link
        is_estimated = False
        description = f"📰 Báo KH | {get_flood_status(water_level)}"
    else:
        # 2. Tính toán Strict (Chỉ dựa vào mưa Khánh Vĩnh)
        print("⚠️ Không có tin báo -> Tính toán theo Mưa Khánh Vĩnh...")
        
        # Lấy lượng mưa hiện tại từ DB
        try:
            conn = sqlite3.connect(DB_PATH)
            row = conn.cursor().execute("SELECT value FROM metrics WHERE name='Mưa Đầu Nguồn (Khánh Vĩnh)'").fetchone()
            rain_val = float(row[0]) if row else 0.0
            conn.close()
        except: rain_val = 0.0
        
        water_level = calculate_water_level_khanh_vinh_strict(rain_val)
        water_level = round(water_level, 2)
        
        is_estimated = True
        description = f"⚠️ Dự báo (Mưa KV {rain_val:.0f}mm) | {get_flood_status(water_level)}"
        print(f"📊 Kết quả tính: {water_level}m (Mưa={rain_val}mm)")

    # Lưu vào DB
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("PRAGMA table_info(metrics)")
        cols = [col[1] for col in c.fetchall()]
        if "is_estimated" not in cols: c.execute("ALTER TABLE metrics ADD COLUMN is_estimated INTEGER DEFAULT 0")
        if "source_link" not in cols: c.execute("ALTER TABLE metrics ADD COLUMN source_link TEXT")
        
        c.execute("""
            UPDATE metrics SET 
                value = ?, updated_at = ?, description = ?, source_link = ?, is_estimated = ?
            WHERE name = ?
        """, (
            water_level,
            datetime.now(TZ_VN).strftime("%H:%M"),
            description,
            source_link,
            1 if is_estimated else 0,
            COORDS["song_cai"]["name"]
        ))
        conn.commit()
        conn.close()
        print(f"💾 Đã lưu: {water_level}m")
    except Exception as e:
        print(f"❌ DB Error: {e}")

# ==== CRAWL BÁO KHÁNH HÒA (TIN TỨC + XẢ LŨ) - GIỮ NGUYÊN ====
def crawl_bao_khanh_hoa_news():
    """[4/4] Quét tin tức & xả lũ từ Báo Khánh Hòa (CHỈ LẤY TIN LŨ LỤT)"""
    print("\n📰 [4/4] Quét tin tức & xả lũ từ Báo Khánh Hòa...")
    headers = {"User-Agent": "Mozilla/5.0"}
    
    # Danh sách từ khóa bắt buộc phải có trong tiêu đề
    FLOOD_KEYWORDS = [
        "lũ", "lụt", "ngập", "mưa", "bão", "áp thấp", 
        "sạt lở", "thủy điện", "xả", "triều cường", 
        "thiên tai", "thời tiết", "nước dâng", "sông cái",
        "khẩn cấp", "di dời", "sơ tán"
    ]

    try:
        resp = requests.get(URL_XA_HOI, headers=headers, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")
        articles = []
        
        # Logic trích xuất bài viết
        for item in soup.select(".row.event_2 .col-3, .listnews .item"):
            a_tag = item.find("a", class_="title2") or item.find("a")
            if a_tag:
                title = a_tag.text.strip()
                link = a_tag.get("href")
                if not link.startswith("http"): link = "https://baokhanhhoa.vn" + link
                
                # --- BỘ LỌC TIN TỨC ---
                # Chỉ lấy bài nếu tiêu đề chứa từ khóa liên quan
                if any(k in title.lower() for k in FLOOD_KEYWORDS):
                    articles.append({"title": title, "link": link})
        
        # Lưu tin đã lọc
        count_saved = 0
        for art in articles: 
            # Gọi save_alert (hàm này đã có logic check trùng link rồi)
            save_alert(art["title"], art["link"], "Báo Khánh Hòa")
            count_saved += 1
            
        if count_saved > 0:
            print(f"✅ Đã quét và lưu {count_saved} tin liên quan lũ lụt.")
        else:
            print("ℹ️ Không có tin lũ lụt mới.")

    except Exception as e:
        print(f"❌ Báo Khánh Hòa Error: {e}")


# ==== MAIN LOOP ====
if __name__ == "__main__":
    print("🚀 KHANH HOA FLOOD MONITOR - REVERTED & FIXED LOGIC")
    print("=" * 60)
    
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M:%S %d/%m/%Y')}")
        
        crawl_open_meteo()          # Backup mưa
        crawl_vrain()               # Mưa thực tế (FULL LOCATION)
        override_rain_with_vrain()  # Ưu tiên mưa thực tế
        crawl_song_cai_water_level()# Logic mới: Ưu tiên báo -> Tính theo mưa Khánh Vĩnh
        crawl_bao_khanh_hoa_news()  # Tin tức
        
        print("\n" + "=" * 40)
        print("💤 Chờ 15 phút...")
        time.sleep(900)
