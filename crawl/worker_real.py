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

# Các trạm ĐẦU NGUỒN SÔNG CÁI (Quan trọng để tính lũ)
UPSTREAM_STATIONS = ["Khánh Vĩnh", "Khánh Thượng", "Giang Ly", "Sơn Thái", "Hòn Bà", "Khánh Hiệp"]

# Cấu hình báo động
FLOOD_LEVELS = { "bao_dong_1": 8.0, "bao_dong_2": 9.5, "bao_dong_3": 10.5 }
COORDS = { "song_cai": {"lat": 12.25, "lon": 109.06, "name": "Sông Cái (Đồng Trăng)"} }

# Điểm đo vệ tinh backup
RAIN_POINTS = [
    {"lat": 12.26, "lon": 108.90, "name": "Khánh Vĩnh (Cũ)"},
    {"lat": 12.422, "lon": 108.841, "name": "Khánh Hiệp (Tâm mưa)"},
]

# Trạm Vrain hiển thị (Key)
KEY_STATIONS = {
    "Hồ Suối Dầu", "Hồ Hoa Sơn", "Hồ Đá Bàn", "Hồ Cam Ranh", 
    "Khánh Vĩnh", "Khánh Thượng", "Sơn Thái", "Giang Ly", "Hòn Bà"
}

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
    """Lưu tin tức - CHỈ BÔI ĐỎ KHI CÓ TỪ 'CẢNH BÁO'"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        now_str = datetime.now(TZ_VN).strftime("%H:%M %d/%m")
        
        # Logic mới: Chỉ urgent khi có từ "cảnh báo"
        is_urgent = 1 if "cảnh báo" in title.lower() else 0
        
        # Vẫn lưu các tin liên quan lũ lụt, hồ chứa, mưa để đọc
        keywords = ["lũ", "lụt", "ngập", "xả", "hồ", "mưa", "bão", "áp thấp", "cảnh báo", "sạt lở"]
        if not any(k in title.lower() for k in keywords):
            return

        c.execute("SELECT id FROM alerts WHERE link = ?", (link,))
        if not c.fetchone():
            c.execute(
                "INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)",
                (title, link, source, now_str, is_urgent),
            )
            conn.commit()
            print(f" 📰 [Tin] {title[:50]}... (Urgent: {is_urgent})")
        conn.close()
    except Exception as e:
        print(f"⚠️ Lỗi lưu alert: {e}")

def crawl_vrain():
    print("\n🌧 [2/5] Quét vrain.vn...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(URL_VRAIN, timeout=60000)
            try:
                page.wait_for_selector(".station:has-text('mm')", timeout=30000)
                page.wait_for_timeout(3000)
                html = page.content()
            except: 
                browser.close()
                return
            browser.close()

            soup = BeautifulSoup(html, "html.parser")
            stations = soup.select(".station")
            today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
            
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            count = 0

            for st in stations:
                try:
                    # 1. Lấy Tên Trạm (Row 1)
                    name_elem = st.select_one(".station-row-1 span")
                    name = name_elem.get_text(strip=True) if name_elem else "Unknown"

                    # 2. Lấy ĐỊA ĐIỂM (Row 2) - FIX CHUẨN HTML
                    # Selector: .station-row-2 tìm class .sub-title
                    loc_elem = st.select_one(".station-row-2 .sub-title")
                    real_location = loc_elem.get_text(strip=True) if loc_elem else ""

                    # 3. Lấy Lượng Mưa
                    val_elem = st.select_one(".station-row-1 span:last-child")
                    if val_elem:
                        mm_text = val_elem.get_text(strip=True)
                        # Xử lý xóa "mm" và thay dấu phẩy
                        mm = float(mm_text.replace("mm","").replace(",",".").strip())
                    else:
                        mm = 0.0

                    # 4. Lưu DB
                    is_key = 1 if any(k.lower() in name.lower() for k in KEY_STATIONS) else 0
                    
                    if is_key or mm > 0:
                        c.execute("INSERT OR REPLACE INTO rain_stations (date, station_name, basin, location, mm, level, is_key) VALUES (?,?,?,?,?,?,?)", 
                                 (today, name, name, real_location, mm, "", is_key))
                        count += 1
                except Exception: 
                    continue

            conn.commit()
            conn.close()
            print(f" ✅ Vrain: {count} trạm.")
    except Exception as e: 
        print(f"⚠️ Lỗi Vrain: {e}")

def get_upstream_rain_avg():
    """Chỉ lấy trung bình mưa các trạm ĐẦU NGUỒN (Khánh Vĩnh...)"""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
        
        # Tạo chuỗi điều kiện SQL: station_name LIKE '%Khánh Vĩnh%' OR ...
        conditions = " OR ".join([f"station_name LIKE '%{name}%'" for name in UPSTREAM_STATIONS])
        query = f"SELECT AVG(mm) FROM rain_stations WHERE date = ? AND ({conditions})"
        
        c.execute(query, (today,))
        row = c.fetchone()
        conn.close()
        
        val = float(row[0]) if row and row[0] is not None else 0.0
        print(f" 🌧 Mưa TB đầu nguồn (Khánh Vĩnh/Giang Ly...): {val:.1f}mm")
        return val
    except: return 0.0

def get_glofas_discharge():
    try:
        url = f"https://flood-api.open-meteo.com/v1/flood?latitude={COORDS['song_cai']['lat']}&longitude={COORDS['song_cai']['lon']}&daily=river_discharge&timezone=Asia%2FBangkok&forecast_days=1"
        return requests.get(url, timeout=5).json().get("daily", {}).get("river_discharge", [0])[0]
    except: return 0

def calculate_smart_water_level(discharge, upstream_rain):
    """Công thức tính mực nước dựa trên Lưu lượng vệ tinh + Mưa đầu nguồn"""
    if discharge is None: discharge = 0
    
    # Hiệu chỉnh: Nếu đầu nguồn không mưa hoặc mưa nhỏ (<10mm), 
    # thì dù vệ tinh báo discharge cao cũng giảm bớt (do vệ tinh hay sai số vùng núi)
    if upstream_rain < 10 and discharge > 200:
        discharge = discharge * 0.4 
    
    # Công thức Rating Curve ước lượng cho Sông Cái
    if discharge < 50: level = 3.5
    elif discharge < 200: level = 3.5 + (discharge/200)*0.8
    elif discharge < 600: level = 4.3 + ((discharge-200)/400)*3.7 # Lên 8.0m (BĐ1)
    else: level = 8.0 + ((discharge-600)/1000)*3.0
    
    return round(min(max(level, 3.2), 12.5), 2)

def crawl_news_water_level():
    # Logic crawl tin tức (Giả lập trả về None nếu không có tin)
    # Mày có thể thêm code regex crawl báo Khánh Hòa vào đây sau
    return None, None, None 

def update_song_cai_level():
    print("\n🌊 [4/5] Tính toán mực nước Sông Cái...")
    
    # 1. Ưu tiên 1: Báo Khánh Hòa (Chính xác nhất)
    news_val, news_time, news_link = crawl_news_water_level() 
    
    # --- ĐÃ BỎ DÒNG: news_val = None ---
    
    if news_val:
        final_val = news_val
        desc = f"Nguồn: Báo Khánh Hòa ({news_time})"
        is_est = 0
        src = "baokhanhhoa"
    else:
        # 2. Ưu tiên 2: Tính toán (DỰ BÁO)
        discharge = get_glofas_discharge()
        upstream_rain = get_upstream_rain_avg() # Chỉ lấy mưa Khánh Vĩnh
        
        final_val = calculate_smart_water_level(discharge, upstream_rain)
        
        # TEXT HIỂN THỊ RÕ RÀNG
        desc = f"DỰ ĐOÁN (Từ vệ tinh & mưa đầu nguồn Khánh Vĩnh {upstream_rain:.0f}mm)"
        is_est = 1
        src = "estimated"
        print(f" 🤖 Tính toán: {final_val}m (Q={discharge}, RainKV={upstream_rain})")

    now_str = datetime.now(TZ_VN).strftime("%H:%M")
    
    try:
        # Update DB
        db_execute("UPDATE metrics SET value=?, updated_at=?, description=?, source_link=?, is_estimated=? WHERE name=?",
                  (final_val, now_str, desc, src, is_est, COORDS["song_cai"]["name"]))
    except: pass

def crawl_news_and_lakes():
    # Hàm placeholder nếu mày có logic crawl hồ chứa
    pass

if __name__ == "__main__":
    print("🚀 FIXED WORKER: UPSTREAM RAIN ONLY + STRICT WARNING")
    while True:
        crawl_vrain()
        update_song_cai_level()
        # crawl_news_and_lakes()
        print("💤 Sleep 15m...")
        time.sleep(900)
