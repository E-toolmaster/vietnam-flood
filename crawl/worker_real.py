import requests
import sqlite3
import time
import re
from datetime import datetime
import pytz
from bs4 import BeautifulSoup
import os

# === CẤU HÌNH ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'flood.db')
TZ_VN = pytz.timezone('Asia/Ho_Chi_Minh')
URL_XA_HOI = "https://baokhanhhoa.vn/xa-hoi/"

# Tọa độ Sông Cái (Đồng Trăng)
COORDS = {
    'song_cai': {'lat': 12.25, 'lon': 109.06, 'name': 'Sông Cái (Đồng Trăng)'}
}

# Danh sách các điểm đo mưa đầu nguồn (Lấy MAX của 3 điểm)
RAIN_POINTS = [
    {'lat': 12.26, 'lon': 108.90, 'name': 'Khánh Vĩnh (Cũ)'},
    {'lat': 12.422, 'lon': 108.841, 'name': 'Khánh Hiệp (Tâm mưa)'},
    {'lat': 12.208, 'lon': 108.769, 'name': 'Sơn Thái (Tâm mưa)'}
]

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
        now_str = datetime.now(TZ_VN).strftime('%H:%M %d/%m')
        is_urgent = 1 if any(kw in title.lower() for kw in ['khẩn', 'xả', 'lũ', 'ngập', 'sạt lở']) else 0
        
        c.execute("SELECT id FROM alerts WHERE link = ?", (link,))
        if not c.fetchone():
            c.execute("INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)",
                      (title, link, source, now_str, is_urgent))
            conn.commit()
            print(f" 📰 Lưu tin: {title[:60]}...")
        conn.close()
    except Exception as e:
        print(f"⚠️ Lỗi lưu alert: {e}")

def crawl_open_meteo():
    """Lấy dữ liệu mưa từ nhiều điểm và chọn điểm lớn nhất"""
    print(f"\n🌐 [1/2] Vệ tinh Open-Meteo (Quét {len(RAIN_POINTS)} điểm)...")
    
    max_rain_current = -1
    max_rain_3day = []
    max_point_name = ""
    total_3day_max = -1

    try:
        # 1. Quét mưa (Current + Forecast + Past)
        for point in RAIN_POINTS:
            url_rain = f"https://api.open-meteo.com/v1/forecast?latitude={point['lat']}&longitude={point['lon']}&current=rain&daily=precipitation_sum&timezone=Asia%2FBangkok&forecast_days=1&past_days=2"
            
            try:
                r = requests.get(url_rain, timeout=5).json()
                curr = r.get('current', {}).get('rain', 0)
                daily = r.get('daily', {}).get('precipitation_sum', [])
                daily_3 = daily[-3:] if len(daily) >= 3 else daily + [0]*(3-len(daily))
                total_3 = sum(daily_3)

                print(f"   📍 {point['name']}: 3 ngày={total_3:.1f}mm")

                if total_3 > total_3day_max:
                    total_3day_max = total_3
                    max_rain_current = curr
                    max_rain_3day = daily_3
                    max_point_name = point['name']
            
            except Exception as err:
                print(f"   ⚠️ Lỗi điểm {point['name']}: {err}")
                continue

        # 2. Cập nhật DB với dữ liệu lớn nhất
        if max_rain_3day:
            now_str = datetime.now(TZ_VN).strftime('%H:%M')
            
            # Update Value
            db_execute("UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?", 
                      (max_rain_current, now_str, 'Mưa Đầu Nguồn (Khánh Vĩnh)'))
            
            # Update Description (Biểu đồ)
            rain_3day_str = f"{max_rain_3day[0]:.1f},{max_rain_3day[1]:.1f},{max_rain_3day[2]:.1f}"
            db_execute("UPDATE metrics SET description = ? WHERE name = ?", 
                      (rain_3day_str, 'Mưa Đầu Nguồn (Khánh Vĩnh)'))
            
            print(f" ✅ Đã cập nhật theo {max_point_name}: Tổng {total_3day_max:.1f}mm")
        
        # 3. Lấy mực nước Sông Cái
        url_flood = f"https://flood-api.open-meteo.com/v1/flood?latitude={COORDS['song_cai']['lat']}&longitude={COORDS['song_cai']['lon']}&daily=river_discharge&timezone=Asia%2FBangkok&forecast_days=1"
        r2 = requests.get(url_flood, timeout=10).json()
        discharge = r2.get('daily', {}).get('river_discharge', [0])[0]
        water_level = round(3.5 + (discharge / 250) * 0.6, 2)
        
        now_str = datetime.now(TZ_VN).strftime('%H:%M')
        db_execute("UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?",
                  (water_level, now_str, COORDS['song_cai']['name']))
        print(f" 🌊 Sông Cái: {water_level}m (Q={discharge:.0f}m³/s)")

    except Exception as e:
        print(f"❌ OpenMeteo Error: {e}")

def crawl_bao_khanh_hoa_final():
    """Quét Báo Khánh Hòa: Tin tức + Xả lũ + Mưa Toàn Tỉnh"""
    print(f"📰 [2/2] Quét Báo Khánh Hòa...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        resp = requests.get(URL_XA_HOI, headers=headers, timeout=15)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        articles = []
        
        # Hàm trích xuất tin
        def extract_item(item):
            a_tag = item.find('a', class_='title2')
            time_tag = item.find(class_=re.compile(r'date'))
            if a_tag:
                link = a_tag.get('href')
                if not link.startswith('http'): link = 'https://baokhanhhoa.vn' + link
                return {
                    'title': a_tag.text.strip(),
                    'link': link,
                    'time': time_tag.text.strip() if time_tag else 'N/A'
                }
            return None

        # Quét 2 vùng tin
        for item in soup.select('.row.event_2 .col-3'):
            art = extract_item(item)
            if art: articles.append(art)
        for item in soup.select('.listnews .item.row15'):
            art = extract_item(item)
            if art: articles.append(art)
            
        print(f" -> {len(articles)} bài viết mới")

        # Lưu tin
        for art in articles:
            if art: save_alert(art['title'], art['link'], 'Báo Khánh Hòa')

        # === TÌM DỮ LIỆU CHI TIẾT ===
        lakes_to_find = {
            'Hồ Đá Bàn': ['đá bàn'], 'Hồ Suối Dầu': ['suối dầu'],
            'Hồ Cam Ranh': ['cam ranh', 'hồ cam ranh'],
            'Hồ Ea Krong Rou': ['ea krong', 'ea krông'], 'Hồ Sông Giang': ['sông giang']
        }
        
        found_lakes = {}
        found_rain_report = False

        for art in articles:
            if not art: continue
            # Nếu đã tìm đủ thông tin thì dừng sớm cho nhẹ
            if len(found_lakes) >= len(lakes_to_find) and found_rain_report: break
            
            title = art['title'].lower()
            link = art['link']
            
            if any(kw in title for kw in ['xả', 'lũ', 'hồ chứa', 'điều tiết', 'mưa', 'không khí lạnh']):
                try:
                    d_resp = requests.get(link, headers=headers, timeout=10)
                    content_soup = BeautifulSoup(d_resp.text, 'html.parser')
                    content_text = content_soup.get_text().lower()
                    
                    # 1. Tìm "Mưa Toàn Tỉnh" (lượng mưa phổ biến...mm)
                    if not found_rain_report and 'lượng mưa' in content_text:
                        paragraphs = content_soup.find_all('p')
                        for p in paragraphs:
                            p_text = p.get_text()
                            # Điều kiện: có chữ "lượng mưa" và đơn vị "mm" và số liệu
                            if "lượng mưa" in p_text.lower() and "mm" in p_text.lower():
                                now_str = datetime.now(TZ_VN).strftime('%H:%M')
                                
                                # --- SỬA ĐOẠN NÀY ---
                                # Thêm type='report' để route.js nhận diện được
                                db_execute("INSERT OR IGNORE INTO metrics (name, value, description, type) VALUES (?, ?, ?, ?)", 
                                        ('Mưa Toàn Tỉnh', 0, '...', 'report'))
                                
                                summary_text = (p_text[:150] + '...') if len(p_text) > 150 else p_text
                                
                                # Update cả description và updated_at
                                db_execute("UPDATE metrics SET description = ?, updated_at = ?, type = ? WHERE name = ?",
                                        (summary_text, now_str, 'report', 'Mưa Toàn Tỉnh'))
                                # --------------------
                                
                                print(f" 🌧️ Report Mưa: {summary_text[:60]}")
                                found_rain_report = True
                                break

                    # 2. Tìm "Xả Lũ" hồ chứa
                    for lake_name, keywords in lakes_to_find.items():
                        if lake_name not in found_lakes and any(kw in content_text for kw in keywords):
                            m = re.search(r'(\d+(?:[\.,]\d+)?)\s*(?:m3\/s|m³\/s)', content_text)
                            if m:
                                val = float(m.group(1).replace(',', '.'))
                                now_str = datetime.now(TZ_VN).strftime('%H:%M')
                                db_execute("UPDATE metrics SET value = ?, updated_at = ?, news_time = ? WHERE name = ?",
                                          (val, now_str, art['time'], lake_name))
                                print(f" 🎯 {lake_name}: {val} m³/s")
                                found_lakes[lake_name] = True

                except Exception as e:
                    print(f"   ⚠️ Lỗi đọc chi tiết bài {link}: {e}")
                    continue

    except Exception as e:
        print(f"❌ Báo Khánh Hòa Error: {e}")

if __name__ == "__main__":
    print("🚀 KHANH HOA FLOOD MONITOR - CRAWLER V2 (FIXED)")
    print("=" * 60)
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M:%S %d/%m/%Y')}")
        crawl_open_meteo()
        crawl_bao_khanh_hoa_final()
        print("💤 Chờ 15 phút...")
        time.sleep(900)
