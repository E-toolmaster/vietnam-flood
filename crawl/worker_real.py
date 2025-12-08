import requests
import sqlite3
import time
import re
from datetime import datetime, timedelta
import pytz
from bs4 import BeautifulSoup
import os
from playwright.sync_api import sync_playwright
import urllib.parse, json, html

# === CẤU HÌNH ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "flood.db")
TZ_VN = pytz.timezone("Asia/Ho_Chi_Minh")

URL_XA_HOI = "https://baokhanhhoa.vn/xa-hoi/"
URL_VRAIN = "https://vrain.vn/37/overview?public_map=windy"

# Mức báo động Sông Cái
FLOOD_LEVELS = {
    "bao_dong_1": 8.0,
    "bao_dong_2": 9.5,
    "bao_dong_3": 10.5,
}

COORDS = {
    "song_cai": {
        "lat": 12.25,
        "lon": 109.06,
        "name": "Sông Cái (Đồng Trăng)",
    }
}

# Backup Open-Meteo (giữ lại để tính mưa tổng 3 ngày nếu cần)
RAIN_POINTS = [
    {"lat": 12.26, "lon": 108.90, "name": "Khánh Vĩnh (Cũ)"},
    {"lat": 12.422, "lon": 108.841, "name": "Khánh Hiệp (Tâm mưa)"},
    {"lat": 12.208, "lon": 108.769, "name": "Sơn Thái (Tâm mưa)"},
]

# === TRẠM TRỌNG YẾU (KEY STATIONS) ===
KEY_STATIONS = {
    "Khánh Vĩnh", "Khánh Nam", "Khánh Đông", "Sông Cầu", "Giang Ly",
    "Khánh Hiệp", "Khánh Thượng", "Khánh Bình", "Liên Sang",
    "Hồ Suối Dầu", "Hồ Am Chúa", "Diên Khánh", "Suối Tiên", "Đồng Trăng",
}

# === HỒ ẢNH HƯỞNG SÔNG CÁI (THEO DÕI VẬN HÀNH) ===
TARGET_RESERVOIRS = [
    "Hoa Sơn",
    "Láng Nhớt",
    "Suối Dầu",
    "Đá Bàn",
    "Am Chúa",
]

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


def ensure_metrics_columns():
    """Đảm bảo bảng metrics có đủ cột extra dùng cho river & hồ."""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        cols = [i[1] for i in c.execute("PRAGMA table_info(metrics)").fetchall()]
        add_cols = []
        if "is_estimated" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN is_estimated INTEGER DEFAULT 0")
        if "source_link" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN source_link TEXT")
        if "history_json" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN history_json TEXT")
        if "news_time" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN news_time TEXT")
        if "q_in" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN q_in REAL")
        if "q_out" not in cols:
            add_cols.append("ALTER TABLE metrics ADD COLUMN q_out REAL")
        if "level_now" not in cols:       # mực nước hồ (tdmucnuoc)
            add_cols.append("ALTER TABLE metrics ADD COLUMN level_now REAL")
        if "volume_now" not in cols:      # dung tích hiện tại (tddungtich)
            add_cols.append("ALTER TABLE metrics ADD COLUMN volume_now REAL")
        if "max_capacity" not in cols:
             add_cols.append("ALTER TABLE metrics ADD COLUMN max_capacity REAL")    

        for sql in add_cols:
            c.execute(sql)

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ ensure_metrics_columns: {e}")


def save_alert(title, link, source):
    FLOOD_KEYWORDS = [
        "lũ", "lụt", "ngập", "mưa", "bão", "áp thấp", "sạt lở",
        "thủy điện", "xả", "triều cường", "thiên tai", "thời tiết",
        "khẩn cấp", "sơ tán",
    ]
    try:
        if not any(k in title.lower() for k in FLOOD_KEYWORDS):
            return
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        is_urgent = 1 if "khẩn cấp" in title.lower() else 0
        c.execute("SELECT id FROM alerts WHERE link = ?", (link,))
        if not c.fetchone():
            c.execute(
                "INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)",
                (
                    title,
                    link,
                    source,
                    datetime.now(TZ_VN).strftime("%H:%M %d/%m"),
                    is_urgent,
                ),
            )
            conn.commit()
            print(f" 📰 Lưu tin: {title[:50]}...")
        conn.close()
    except Exception as e:
        print(f"⚠️ Lỗi lưu alert: {e}")


# ==== CRAWL FUNCTIONS ====
def crawl_open_meteo():
    print(f"\n🌐 [1/5] Open-Meteo Backup (mưa tổng 3 ngày)...")
    max_rain_current, total_3day_max = -1, -1
    max_rain_3day, max_point_name = [], ""
    try:
        for point in RAIN_POINTS:
            url = (
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={point['lat']}&longitude={point['lon']}"
                "&current=rain&daily=precipitation_sum&timezone=Asia%2FBangkok"
                "&forecast_days=1&past_days=2"
            )
            try:
                r = requests.get(url, timeout=5).json()
                curr = r.get("current", {}).get("rain", 0)
                daily = r.get("daily", {}).get("precipitation_sum", [])
                if len(daily) < 3:
                    daily = [0] * (3 - len(daily)) + daily
                daily_3 = daily[-3:]
                if sum(daily_3) > total_3day_max:
                    total_3day_max = sum(daily_3)
                    max_rain_current = curr
                    max_rain_3day = daily_3
                    max_point_name = point["name"]
            except:
                continue

        if max_rain_3day:
            desc = ",".join(f"{v:.1f}" for v in max_rain_3day)
            db_execute(
                "UPDATE metrics SET value = ?, updated_at = ? WHERE name = ?",
                (
                    max_rain_current,
                    datetime.now(TZ_VN).strftime("%H:%M"),
                    "Mưa Thượng Nguồn (Max)",
                ),
            )
            db_execute(
                "UPDATE metrics SET description = ? WHERE name = ?",
                (desc, "Mưa Thượng Nguồn (Max)"),
            )
            print(
                f" ✅ Open-Meteo: {max_rain_current:.1f}mm hiện tại, 3 ngày {total_3day_max:.1f}mm ({desc})"
            )
    except Exception as e:
        print(f"❌ OpenMeteo: {e}")


def crawl_vrain():
    print("\n🌧 [2/5] Quét Vrain...")
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
        if not stations:
            return

        today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS rain_stations (
                id INTEGER PRIMARY KEY,
                date TEXT,
                station_name TEXT,
                basin TEXT,
                location TEXT,
                mm REAL,
                level TEXT,
                is_key INTEGER DEFAULT 0,
                UNIQUE(date, station_name)
            )
            """
        )
        cnt = 0
        for st in stations:
            try:
                r1 = st.select_one(".station-row-1")
                if not r1:
                    continue
                spans = r1.find_all("span", recursive=False)
                if len(spans) < 2:
                    continue
                name = spans[0].get_text(strip=True)
                mm = float(
                    spans[-1]
                    .get_text(strip=True)
                    .replace("mm", "")
                    .replace(",", ".")
                    .strip()
                )
                r2 = st.select_one(".station-row-2")
                loc, lvl = "", ""
                if r2:
                    childs = r2.find_all(recursive=False)
                    if childs:
                        loc = childs[0].get_text(strip=True)
                    if len(childs) > 1:
                        lvl = childs[-1].get_text(strip=True)
                is_key = 1 if any(k.lower() in name.lower() for k in KEY_STATIONS) else 0
                c.execute(
                    """
                    INSERT OR REPLACE INTO rain_stations
                        (date, station_name, basin, location, mm, level, is_key)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (today, name, name, loc, mm, lvl, is_key),
                )
                cnt += 1
            except:
                continue

        conn.commit()
        conn.close()
        print(f"✅ Vrain: đã lưu {cnt} trạm.")
    except Exception as e:
        print(f"❌ Vrain: {e}")


def override_rain_with_vrain():
    print("⏱ Tính mưa tích lũy 3 ngày (Vrain)...")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        today = datetime.now(TZ_VN).date()
        dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(2, -1, -1)]
        placeholders = ",".join("?" for _ in dates)

        query = f"""
            SELECT station_name, SUM(mm) as total
            FROM rain_stations
            WHERE is_key=1 AND date IN ({placeholders})
            GROUP BY station_name
            ORDER BY total DESC
            LIMIT 1
        """
        top = cur.execute(query, dates).fetchone()
        if top:
            name, total = top["station_name"], top["total"]
            rows = cur.execute(
                f"""
                SELECT date, mm FROM rain_stations
                WHERE station_name=? AND date IN ({placeholders})
                ORDER BY date
                """,
                (name, *dates),
            ).fetchall()
            rain_map = {r["date"]: r["mm"] for r in rows}
            vals = [rain_map.get(d, 0.0) for d in dates]
            desc = ",".join(f"{v:.1f}" for v in vals)
            db_execute(
                """
                UPDATE metrics
                SET value = ?, description = ?, updated_at = ?
                WHERE name = ?
                """,
                (vals[-1], desc, datetime.now(TZ_VN).strftime("%H:%M"), "Mưa Thượng Nguồn (Max)"),
            )
            print(f"✅ Max Rain ({name}): {total:.1f}mm ({desc})")
        conn.close()
    except Exception as e:
        print(f"❌ Calc Rain: {e}")


def crawl_song_cai_from_vndms():
    print("\n🌊 [3/5] Mực nước Sông Cái (Time nguồn chính xác)...")
    try:
        ensure_metrics_columns()
        headers = {"User-Agent": "Mozilla/5.0"}
        
        result_obj = {"station_info": {}, "water_levels": []}
        level_now = None
        source_time_str = "" # Biến lưu thời gian từ nguồn
        found_data = False
        link_used = "https://vndms.dmptc.gov.vn/water_level?lv=0" # Default

        for lv in [0, 1, 2, 3]:
            url = f"https://vndms.dmptc.gov.vn/water_level?lv={lv}"
            try:
                r = requests.get(url, headers=headers, timeout=10)
                if r.status_code != 200: continue
                geo = r.json()
            except: continue

            for ft in geo.get("features", []):
                props = ft.get("properties", {})
                popup_raw = props.get("popupInfo", "")
                
                if "Đồng Trăng" not in props.get("label", "") and "Đồng Trăng" not in popup_raw:
                    continue

                popup_clean = html.unescape(popup_raw)
                
                # --- 1. LẤY MỰC NƯỚC & THỜI GIAN TỪ POPUP ---
                # Format: Mực nước (3.56(m) 7-08/12) -> Lấy số 3.56 và chuỗi 7-08/12
                # Regex bắt: (Số) (khoảng trắng/xuống dòng) (Giờ-Ngày/Tháng)
                m_info = re.search(r"Mực nước\s*\((-?\d+\.?\d*)\(m\)\s*([^)]+)\)", popup_clean)
                
                if m_info:
                    level_now = float(m_info.group(1))
                    raw_time = m_info.group(2).strip() # VD: "7-08/12" hoặc "13-08/12"
                    
                    # Format lại thời gian cho đẹp: "07:00 08/12"
                    try:
                        parts = raw_time.split('-')
                        hour = parts[0].strip()
                        date_part = parts[1].strip()
                        if len(hour) == 1: hour = "0" + hour
                        source_time_str = f"{hour}:00 {date_part}"
                    except:
                        source_time_str = raw_time # Fallback nếu format lạ
                
                # --- 2. XỬ LÝ CHART (ĐỂ LẤY HISTORY) ---
                # (Đoạn này giữ nguyên logic tách chuỗi như trước cho ổn định)
                if 'src="' in popup_clean:
                    chart_url_part = popup_clean.split('src="')[1].split('"')[0].replace("&amp;", "&")
                    parsed_url = urllib.parse.urlparse(chart_url_part)
                    qs = urllib.parse.parse_qs(parsed_url.query)
                    
                    if 'c' in qs:
                        cfg_raw = qs['c'][0]
                        labels, values = [], []
                        
                        # Bóc Labels
                        if "labels" in cfg_raw:
                            try:
                                start = cfg_raw.find("labels")
                                l_start = cfg_raw.find("[", start)
                                l_end = cfg_raw.find("]", l_start)
                                l_str = cfg_raw[l_start+1:l_end]
                                for item in l_str.split(","):
                                    clean = item.replace("'", "").replace('"', "").replace("\\n", " ").strip()
                                    if clean: labels.append(clean)
                            except: pass

                        # Bóc Data
                        if "datasets" in cfg_raw:
                            try:
                                ds_idx = cfg_raw.find("datasets")
                                d_idx = cfg_raw.find("data", ds_idx)
                                d_start = cfg_raw.find("[", d_idx)
                                d_end = cfg_raw.find("]", d_start)
                                d_str = cfg_raw[d_start+1:d_end]
                                for val in d_str.split(","):
                                    try: values.append(float(val.strip()))
                                    except: pass
                            except: pass
                        
                        final_levels = []
                        min_len = min(len(labels), len(values))
                        for i in range(min_len):
                            final_levels.append({"time": labels[i], "value": values[i], "unit": "m"})
                        result_obj["water_levels"] = final_levels

                found_data = True
                break
            if found_data: break

        if level_now is None:
            print("⚠️ Không tìm thấy mực nước Đồng Trăng.")
            return

        desc = f"VNDMS | {get_status(level_now)}"
        print(f"✅ Đồng Trăng: {level_now}m | Time nguồn: {source_time_str}")

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # QUAN TRỌNG: updated_at lưu source_time_str chứ ko phải giờ hiện tại
        final_time_for_db = source_time_str if source_time_str else datetime.now(TZ_VN).strftime("%H:%M %d/%m")

        c.execute(
            """
            UPDATE metrics
            SET value = ?, updated_at = ?, description = ?, source_link = ?, is_estimated = 0, history_json = ?
            WHERE name = ?
            """,
            (
                level_now,
                final_time_for_db, # <-- Lưu giờ nguồn vào đây
                desc,
                "", # Bỏ link ở đây luôn cho chắc, hoặc để link nhưng frontend ko render thẻ A
                json.dumps(result_obj, ensure_ascii=False),
                COORDS["song_cai"]["name"],
            ),
        )
        conn.commit()
        conn.close()

    except Exception as e:
        print(f"❌ Lỗi Sông Cái: {e}")



def crawl_reservoirs_from_vndms():
    print("\n🏞 [4/5] Hồ chứa (Dynamic Max Capacity)...")
    try:
        ensure_metrics_columns() # Đảm bảo có cột max_capacity
        
        TARGET_MAP = {
            "suối dầu": "Hồ Suối Dầu",
            "am chúa": "Hồ Am Chúa",
            "láng nhớt": "Hồ Láng Nhớt",
            "hoa sơn": "Hồ Hoa Sơn",
            "đá bàn": "Hồ Đá Bàn",
        }
        url = "https://vndms.dmptc.gov.vn/pctt?dangxa=0"
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, timeout=15)
        geo = r.json()
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        now = datetime.now(TZ_VN)
        count_updated = 0

        for ft in geo.get("features", []):
            props = ft.get("properties", {})
            name_raw = props.get("tenho", "").lower()
            
            # 1. LỌC HỒ
            db_name = None
            for kw, target_name in TARGET_MAP.items():
                if kw in name_raw:
                    if kw == "đá bàn":
                        matinh = str(props.get("matinh", ""))
                        tentinh = props.get("tentinh", "").lower()
                        if matinh != "56" and "khánh hòa" not in tentinh: continue 
                    db_name = target_name
                    break
            if not db_name: continue

            # 2. LẤY DATA
            data_list = props.get("data", [])
            latest_data = data_list[0] if data_list else {}
            
            level = latest_data.get("tdmucnuoc")
            volume = latest_data.get("tddungtich")
            if level is None: level = props.get("tdmucnuoc")
            if volume is None: volume = props.get("tddungtich")

            # --- LẤY MAX CAPACITY (DUNG TÍCH TOÀN BỘ) ---
            # Thường nằm trong thong_so_ky_thuat
            tskt = props.get("thong_so_ky_thuat", {})
            max_cap = tskt.get("dungtichtoanbo")
            
            # Fallback ra ngoài properties nếu không có trong object con
            if max_cap is None: max_cap = props.get("dungtichtoanbo")
            
            # Convert sang float
            try:
                max_cap = float(max_cap)
            except:
                max_cap = 0.0 # Nếu lỗi thì để 0

            q_out = props.get("luuluong_xa")
            q_in = props.get("luuluong_den")

            # 3. XỬ LÝ TIME (Giữ nguyên logic cũ)
            time_src = latest_data.get("thoigian") or latest_data.get("thoigiancapnhat") or props.get("thoigian_ghinhan_luuluong")
            display_time = ""
            if time_src:
                try:
                    clean = time_src.replace("T", " ").split(".")[0]
                    dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
                    display_time = dt.strftime("%H:%M %d/%m")
                except: display_time = time_src

            final_q_out = None
            time_q = props.get("thoigian_ghinhan_luuluong")
            if q_out is not None and time_q:
                try:
                    clean_q = time_q.replace("T", " ").split(".")[0]
                    dt_q = datetime.strptime(clean_q, "%Y-%m-%d %H:%M:%S")
                    if (now.replace(tzinfo=None) - dt_q).total_seconds()/3600 < 24:
                        final_q_out = q_out
                except: final_q_out = q_out
            elif q_out is not None: final_q_out = q_out

            desc = f"Mực nước: {level}m | Dung tích: {volume}/{max_cap} tr.m3"
            final_updated_at = display_time if display_time else now.strftime("%H:%M %d/%m")

            # 4. UPDATE DB (Thêm cột max_capacity)
            c.execute(
                """
                UPDATE metrics
                SET value=?, updated_at=?, description=?, q_in=?, q_out=?, news_time=?, level_now=?, volume_now=?, max_capacity=?
                WHERE name=?
                """,
                (level or 0, final_updated_at, desc, q_in, final_q_out, final_updated_at, level, volume, max_cap, db_name)
            )
            
            if c.rowcount == 0:
                c.execute(
                    """
                    INSERT INTO metrics (name, value, updated_at, description, q_in, q_out, news_time, level_now, volume_now, max_capacity, type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reservoir')
                    """,
                    (db_name, level or 0, final_updated_at, desc, q_in, final_q_out, final_updated_at, level, volume, max_cap)
                )

            count_updated += 1

        conn.commit()
        conn.close()
        print(f"✅ Hồ chứa: Đã update {count_updated} hồ (Kèm Max Capacity).")

    except Exception as e:
        print(f"❌ Lỗi crawl hồ: {e}")





def get_status(lvl):
    if lvl >= FLOOD_LEVELS["bao_dong_3"]:
        return "🔴 Trên BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_2"]:
        return "🟠 BĐ2-BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_1"]:
        return "🟡 BĐ1-BĐ2"
    return "🟢 Dưới BĐ1"


def crawl_news():
    print("\n📰 [5/5] Quét tin tức...")
    try:
        soup = BeautifulSoup(
            requests.get(URL_XA_HOI, headers={"User-Agent": "Mozilla/5.0"}).text,
            "html.parser",
        )
        for i in soup.select(".row.event_2 .col-3, .listnews .item"):
            a = i.find("a", class_="title2") or i.find("a")
            if a:
                href = a.get("href") or ""
                lnk = (
                    "https://baokhanhhoa.vn" + href
                    if href and not href.startswith("http")
                    else href
                )
                save_alert(a.text.strip(), lnk, "Báo Khánh Hòa")
    except Exception:
        pass


if __name__ == "__main__":
    print("🚀 KHANH HOA FLOOD MONITOR - VNDMS VERSION")
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M %d/%m')}")
        crawl_open_meteo()
        crawl_vrain()
        override_rain_with_vrain()
        crawl_song_cai_from_vndms()
        crawl_reservoirs_from_vndms()
        crawl_news()
        print("💤 Sleep 15m...")
        time.sleep(900)
