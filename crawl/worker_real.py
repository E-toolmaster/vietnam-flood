import requests
import sqlite3
import time
import re
import unicodedata
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
URL_VRAIN_HOME = "https://vrain.vn/"

# VNDMS đã đổi tên miền từ vndms.dmptc.gov.vn -> vndms.gov.vn (domain cũ chỉ trả
# trang HTML "chuyển đổi tên miền"). Domain mới chặn 403 nếu thiếu UA/Referer trình duyệt.
VNDMS_BASE = "https://vndms.gov.vn"
VNDMS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": "https://vndms.gov.vn/",
    "Accept": "application/json, text/plain, */*",
}

# Mức báo động Sông Cái (Đồng Trăng) — trạm khác không có BĐ công khai trên VNDMS
FLOOD_LEVELS = {
    "bao_dong_1": 8.0,
    "bao_dong_2": 9.5,
    "bao_dong_3": 10.5,
}

# === DANH SÁCH TỈNH ===
# vrain_id: id trang vrain.vn/<id>/overview (khám phá bằng Playwright)
# vndms_places: giá trị "Địa điểm" trong popup VNDMS (giới hạn trạm sông + tên tỉnh hồ chứa)
# river_stations: trạm đại diện; metric = tên row trong bảng metrics (Khánh Hòa giữ tên cũ)
# kind: 'river' (sông trầm, flow Khánh Hòa) | 'mountain' (lũ quét/sạt lở theo mưa)
# always_deep: luôn quét trang trạm vrain (Khánh Hòa cần chi tiết thượng nguồn)
PROVINCES = {
    "khanh-hoa": {
        "name": "Khánh Hòa", "vrain_id": 37, "kind": "river", "always_deep": True,
        "vndms_places": ["Khánh Hòa"],
        "river_stations": [
            {"label": "Đồng Trăng", "metric": "Sông Cái (Đồng Trăng)",
             "bd1": 8.0, "bd2": 9.5, "bd3": 10.5},
        ],
        "forecast_points": [
            {"lat": 12.24, "lon": 109.15, "name": "Nha Trang (dự báo)"},
        ],
    },
    # --- Miền núi phía Bắc: lũ quét, sạt lở ---
        "lai-chau": {
            "name": "Lai Châu", "vrain_id": 7, "kind": "mountain",
            "vndms_places": ["Lai Châu"],
            "river_stations": [
                {"label": "Nà Hừ", "metric": "Sông Nậm Na (Nà Hừ)"},
                {"label": "Nậm Giàng", "metric": "Sông Đà (Nậm Giàng)"},
            ],
            "forecast_points": [{"lat": 22.39, "lon": 103.46, "name": "Lai Châu (dự báo)"}],
        },
    "dien-bien": {
        "name": "Điện Biên", "vrain_id": 6, "kind": "mountain",
        "vndms_places": ["Điện Biên"],
        "river_stations": [
            {"label": "Mường Lay", "metric": "Sông Nậm Na (Mường Lay)"},
        ],
        "forecast_points": [{"lat": 21.39, "lon": 103.02, "name": "Điện Biên (dự báo)"}],
    },
    "son-la": {
        "name": "Sơn La", "vrain_id": 8, "kind": "mountain",
        "vndms_places": ["Sơn La"],
        "river_stations": [
            {"label": "Tạ Hộc", "metric": "Sông Nậm Mư (Tạ Hộc)"},
            {"label": "Tạ Bú", "metric": "Sông Nậm Na (Tạ Bú)"},
        ],
        "forecast_points": [{"lat": 21.55, "lon": 104.05, "name": "Mường La (dự báo)"}],
    },
    "lao-cai": {
        "name": "Lào Cai", "vrain_id": 5, "kind": "mountain",
        "vndms_places": ["Lào Cai"],
        "river_stations": [
            {"label": "Ngòi Thia", "metric": "Ngòi Thia"},
            {"label": "Bảo Hà", "metric": "Sông Hồng (Bảo Hà)"},
        ],
        "forecast_points": [{"lat": 21.85, "lon": 104.09, "name": "Mù Cang Chải (dự báo)"}],
    },
    "tuyen-quang": {
        "name": "Tuyên Quang", "vrain_id": 4, "kind": "mountain",
        "vndms_places": ["Tuyên Quang"],
        "river_stations": [
            {"label": "Na Hang", "metric": "Sông Gâm (Na Hang)"},
            {"label": "Tuyên Quang", "metric": "Sông Lô (Tuyên Quang)"},
        ],
        "forecast_points": [{"lat": 22.16, "lon": 105.0, "name": "Hà Giang (dự báo)"}],
    },
    "cao-bang": {
        "name": "Cao Bằng", "vrain_id": 2, "kind": "mountain",
        "vndms_places": ["Cao Bằng"],
        "river_stations": [
            {"label": "Bảo Lạc", "metric": "Sông Gâm (Bảo Lạc)"},
        ],
        "forecast_points": [{"lat": 22.66, "lon": 106.26, "name": "Cao Bằng (dự báo)"}],
    },
    "lang-son": {
        "name": "Lạng Sơn", "vrain_id": 18, "kind": "mountain",
        "vndms_places": ["Lạng Sơn"],
        "river_stations": [
            {"label": "Lạng Sơn", "metric": "Sông Kỳ Cùng (Lạng Sơn)"},
        ],
        "forecast_points": [{"lat": 21.85, "lon": 106.76, "name": "Lạng Sơn (dự báo)"}],
    },
    "thai-nguyen": {
        "name": "Thái Nguyên", "vrain_id": 11, "kind": "mountain",
        "vndms_places": ["Thái Nguyên"],
        "river_stations": [
            {"label": "Đầu Đẳng", "metric": "Sông Cầu (Đầu Đẳng)"},
        ],
        "forecast_points": [{"lat": 21.85, "lon": 105.85, "name": "Thái Nguyên (dự báo)"}],
    },
    "phu-tho": {
        "name": "Phú Thọ", "vrain_id": 14, "kind": "mountain",
        "vndms_places": ["Phú Thọ"],
        "river_stations": [
            {"label": "Việt Trì", "metric": "Sông Hồng (Việt Trì)"},
            {"label": "Hòa Bình", "metric": "Sông Đà (Hòa Bình)"},
        ],
        "forecast_points": [{"lat": 21.32, "lon": 105.40, "name": "Việt Trì (dự báo)"}],
    },
    # --- Miền Trung: lũ lụt đầu nguồn + ngập hạ du ---
    "thanh-hoa": {
        "name": "Thanh Hóa", "vrain_id": 27, "kind": "river",
        "vndms_places": ["Thanh Hóa"],
        "river_stations": [
            {"label": "Bái Thượng", "metric": "Sông Chu (Bái Thượng)"},
        ],
        "forecast_points": [{"lat": 20.05, "lon": 105.15, "name": "Thượng nguồn Thanh Hóa (dự báo)"}],
    },
    "nghe-an": {
        "name": "Nghệ An", "vrain_id": 26, "kind": "river",
        "vndms_places": ["Nghệ An"],
        "river_stations": [
            {"label": "Con Cuông", "metric": "Sông Lam (Con Cuông)"},
            {"label": "Đô Lương", "metric": "Sông Lam (Đô Lương)"},
        ],
        "forecast_points": [{"lat": 19.15, "lon": 104.9, "name": "Thượng nguồn Nghệ An (dự báo)"}],
    },
    "ha-tinh": {
        "name": "Hà Tĩnh", "vrain_id": 28, "kind": "river",
        "vndms_places": ["Hà Tĩnh"],
        "river_stations": [
            {"label": "Linh Cảm", "metric": "Sông Ngân Sông (Linh Cảm)"},
        ],
        "forecast_points": [{"lat": 18.34, "lon": 105.91, "name": "Hà Tĩnh (dự báo)"}],
    },
    "quang-tri": {
        "name": "Quảng Trị", "vrain_id": 30, "kind": "river",
        "vndms_places": ["Quảng Trị"],
        "river_stations": [
            {"label": "Thạch Hãn", "metric": "Sông Thạch Hãn"},
        ],
        "forecast_points": [{"lat": 16.95, "lon": 107.0, "name": "Thượng nguồn Quảng Trị (dự báo)"}],
    },
    "hue": {
        "name": "Thừa Thiên Huế", "vrain_id": 31, "kind": "river",
        "vndms_places": ["TP. Huế"],
        "river_stations": [
            {"label": "Thượng Nhật", "metric": "Sông Hương (Thượng Nhật)"},
        ],
        "forecast_points": [{"lat": 16.46, "lon": 107.60, "name": "Huế (dự báo)"}],
    },
}

# Tên tỉnh hiển thị trên bảng Vrain toàn quốc -> mã tỉnh nội bộ
VRAIN_NAME_TO_CODE = {cfg["name"]: code for code, cfg in PROVINCES.items()}
VRAIN_NAME_TO_CODE["Thành phố Huế"] = "hue"  # Vrain ghi tên dài

# Ngưỡng mưa để quét sâu trang tỉnh (mm/ngày)
DEEP_PASS_THRESHOLD_MM = 25.0
DEEP_PASS_MAX = 12  # giới hạn số trang tỉnh mỗi chu kỳ

# === CẤU HÌNH RIÊNG KHÁNH HÒA (giữ flow cũ) ===
UPSTREAM_KEYS = [
    "Khánh Vĩnh", "Khánh Nam", "Khánh Đông", "Sông Cầu", "Giang Ly",
    "Khánh Hiệp", "Khánh Thượng", "Khánh Bình", "Liên Sang",
]

# (tên hiển thị, các pattern LIKE để tìm trạm trong DB)
UPSTREAM_TARGETS = [
    ("Khánh Đông", ["%Khánh Đông%"]),
    ("Khánh Nam", ["%Khánh Nam%"]),
    ("Sông Cầu", ["%Sông Cầu%"]),
    ("Hồ Am Chúa", ["%Am Chúa%"]),
    ("Hồ Suối Dầu", ["%Suối Dầu%", "%Hòn Bà%"]),
]

# Hồ Khánh Hòa theo dõi đích danh (các tỉnh khác tự lấy top hồ theo dung tích)
KH_RESERVOIR_MAP = {
    "suối dầu": "Hồ Suối Dầu",
    "am chúa": "Hồ Am Chúa",
    "láng nhớt": "Hồ Láng Nhớt",
    "hoa sơn": "Hồ Hoa Sơn",
    "đá bàn": "Hồ Đá Bàn",
}

# Alias "tentinh" trong pctt VNDMS (dùng cả tên tỉnh cũ trước sáp nhập + biến thể chính tả)
RESERVOIR_PLACES = {
    "khanh-hoa": ["Khánh Hòa", "Ninh Thuận"],
    "lai-chau": ["Lai Châu"],
    "dien-bien": ["Điện Biên"],
    "son-la": ["Sơn La"],
    "lao-cai": ["Lào Cai", "Yên Bái"],
    "tuyen-quang": ["Tuyên Quang", "Hà Giang"],
    "cao-bang": ["Cao Bằng"],
    "lang-son": ["Lạng Sơn"],
    "thai-nguyen": ["Thái Nguyên", "Bắc Kạn"],
    "phu-tho": ["Phú Thọ", "Vĩnh Phúc", "Hòa Bình"],
    "thanh-hoa": ["Thanh Hóa", "Thanh Hoá"],
    "nghe-an": ["Nghệ An"],
    "ha-tinh": ["Hà Tĩnh"],
    "quang-tri": ["Quảng Trị", "Quảng Bình"],
    "hue": ["Thừa Thiên Huế", "TP. Huế"],
}

def normalize_station_key(name):
    """Tạo khóa trạm ổn định từ tên Vrain (bỏ hậu tố 'Lưu vực...', '(xã ...)', dấu, hoa thường)."""
    s = (name or "").strip()
    s = re.split(r",", s)[0].strip()
    s = re.sub(r"\s*\(.*?\)\s*$", "", s).strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "d").lower()
    s = re.sub(r"\s+", " ", s)
    return s

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

def ensure_tables_and_columns():
    """Migrations đa tỉnh + các bảng mới."""
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS rain_stations (
                id INTEGER PRIMARY KEY,
                date TEXT,
                station_name TEXT,
                basin TEXT,
                location TEXT,
                mm REAL,
                level TEXT,
                is_key INTEGER DEFAULT 0,
                station_key TEXT,
                province TEXT DEFAULT 'khanh-hoa',
                UNIQUE(date, station_name)
            )
        """)

        # Bảng mưa theo tỉnh (từ trang chủ Vrain — 1 lần quét cho cả nước)
        c.execute("""
            CREATE TABLE IF NOT EXISTS province_rain (
                date TEXT,
                province TEXT,
                max_mm REAL,
                station_name TEXT,
                level TEXT,
                as_of TEXT,
                UNIQUE(date, province)
            )
        """)

        # river_history nhiều trạm: đổi PK sang (station, ts)
        tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        if "river_history" in tables:
            cols = [i[1] for i in c.execute("PRAGMA table_info(river_history)").fetchall()]
            if "station" not in cols:
                c.execute("ALTER TABLE river_history RENAME TO river_history_old")
                c.execute("CREATE TABLE river_history (station TEXT, ts TEXT, level REAL, PRIMARY KEY(station, ts))")
                c.execute("INSERT OR IGNORE INTO river_history SELECT 'Sông Cái (Đồng Trăng)', ts, level FROM river_history_old")
                c.execute("DROP TABLE river_history_old")
        else:
            c.execute("CREATE TABLE river_history (station TEXT, ts TEXT, level REAL, PRIMARY KEY(station, ts))")

        c.execute("""
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT, value REAL, updated_at TEXT, description TEXT, source_link TEXT,
                is_estimated INTEGER DEFAULT 0, history_json TEXT, news_time TEXT,
                q_in REAL, q_out REAL, level_now REAL, volume_now REAL, max_capacity REAL,
                type TEXT, province TEXT DEFAULT 'khanh-hoa',
                UNIQUE(name, province)
            )
        """)

        # metrics: đổi UNIQUE(name) cũ -> UNIQUE(name, province) để các tỉnh
        # dùng chung tên metric (Du_Bao_Mua_24h, trạm trùng tên...)
        sql_def = c.execute("SELECT sql FROM sqlite_master WHERE name='metrics'").fetchone()
        if sql_def and "name TEXT UNIQUE" in sql_def[0]:
            c.execute("""CREATE TABLE metrics_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT, value REAL, updated_at TEXT, description TEXT, source_link TEXT,
                is_estimated INTEGER DEFAULT 0, history_json TEXT, news_time TEXT,
                q_in REAL, q_out REAL, level_now REAL, volume_now REAL, max_capacity REAL,
                type TEXT, province TEXT DEFAULT 'khanh-hoa',
                UNIQUE(name, province))""")
            c.execute("""INSERT OR IGNORE INTO metrics_new
                SELECT id, name, value, updated_at, description, source_link, is_estimated,
                       history_json, news_time, q_in, q_out, level_now, volume_now, max_capacity,
                       type, province FROM metrics""")
            c.execute("DROP TABLE metrics")
            c.execute("ALTER TABLE metrics_new RENAME TO metrics")

        # metrics/alerts: thêm province, backfill khanh-hoa
        for tbl in ("metrics", "alerts"):
            cols = [i[1] for i in c.execute(f"PRAGMA table_info({tbl})").fetchall()]
            if tbl in tables and "province" not in cols:
                c.execute(f"ALTER TABLE {tbl} ADD COLUMN province TEXT DEFAULT 'khanh-hoa'")
                c.execute(f"UPDATE {tbl} SET province='khanh-hoa' WHERE province IS NULL")
        if "province" not in [i[1] for i in c.execute("PRAGMA table_info(rain_stations)").fetchall()]:
            c.execute("ALTER TABLE rain_stations ADD COLUMN province TEXT DEFAULT 'khanh-hoa'")
            c.execute("UPDATE rain_stations SET province='khanh-hoa' WHERE province IS NULL")

        # metrics: các cột phụ cho river & hồ (giữ từ bản cũ)
        cols = [i[1] for i in c.execute("PRAGMA table_info(metrics)").fetchall()]
        add_cols = {
            "is_estimated": "ALTER TABLE metrics ADD COLUMN is_estimated INTEGER DEFAULT 0",
            "source_link": "ALTER TABLE metrics ADD COLUMN source_link TEXT",
            "history_json": "ALTER TABLE metrics ADD COLUMN history_json TEXT",
            "news_time": "ALTER TABLE metrics ADD COLUMN news_time TEXT",
            "q_in": "ALTER TABLE metrics ADD COLUMN q_in REAL",
            "q_out": "ALTER TABLE metrics ADD COLUMN q_out REAL",
            "level_now": "ALTER TABLE metrics ADD COLUMN level_now REAL",
            "volume_now": "ALTER TABLE metrics ADD COLUMN volume_now REAL",
            "max_capacity": "ALTER TABLE metrics ADD COLUMN max_capacity REAL",
            "type": "ALTER TABLE metrics ADD COLUMN type TEXT",
            "lat": "ALTER TABLE metrics ADD COLUMN lat REAL",
            "lon": "ALTER TABLE metrics ADD COLUMN lon REAL",
        }
        for col, sql in add_cols.items():
            if col not in cols:
                try:
                    c.execute(sql)
                except Exception:
                    pass

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ ensure_tables_and_columns: {e}")

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
                "INSERT INTO alerts (title, link, source, time_crawled, is_urgent, province) VALUES (?,?,?,?,?,?)",
                (title, link, source, datetime.now(TZ_VN).strftime("%H:%M %d/%m"), is_urgent, "khanh-hoa"),
            )
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ Lỗi lưu alert: {e}")

# ==== CRAWL: VRain ====

def crawl_vrain_national():
    """Quét 1 lần trang chủ Vrain -> mưa max hôm nay của TẤT CẢ tỉnh.
    Trả về {code: {max_mm, station, level}} cho các tỉnh trong PROVINCES."""
    print("\n🌧 [VRain] Quét bảng mưa toàn quốc...")
    result = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(URL_VRAIN_HOME, timeout=60000)
            try:
                page.wait_for_selector("text=mm", timeout=45000)
                page.wait_for_timeout(6000)
            except Exception:
                print("⚠️ Vrain home timeout!")
            body = page.inner_text("body")
            browser.close()

        today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
        as_of = datetime.now(TZ_VN).strftime("%H:%M")
        pat = re.compile(r'([A-Za-zÀ-ỹà-ỹĂăÂâĐđÊêÔôƠơƯơ1 ]+?)\n([\d.,]+)mm\ntại ([^\n]+)\n(Mưa[^\n]*)')

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        cnt = 0
        for m in pat.finditer(body):
            vrain_name, mm_str, station, level = (
                m.group(1).strip(), m.group(2).replace(",", "."), m.group(3).strip(), m.group(4).strip(),
            )
            code = VRAIN_NAME_TO_CODE.get(vrain_name)
            if not code:
                continue
            try:
                mm = float(mm_str)
            except ValueError:
                continue
            c.execute(
                """INSERT OR REPLACE INTO province_rain (date, province, max_mm, station_name, level, as_of)
                   VALUES (?,?,?,?,?,?)""",
                (today, code, mm, station, level, as_of),
            )
            result[code] = {"max_mm": mm, "station": station, "level": level}
            cnt += 1
        conn.commit()
        conn.close()
        print(f"✅ Vrain toàn quốc: {cnt}/{len(PROVINCES)} tỉnh có trong bảng.")
    except Exception as e:
        print(f"❌ Vrain national: {e}")
    return result

def crawl_vrain_province(code):
    """Quét trang trạm chi tiết của 1 tỉnh (flow cũ của Khánh Hòa)."""
    cfg = PROVINCES[code]
    print(f"\n🌧 [VRain] Quét sâu {cfg['name']}...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"https://vrain.vn/{cfg['vrain_id']}/overview?public_map=windy", timeout=60000)
            try:
                page.wait_for_selector(".station:has-text('mm')", timeout=45000)
                page.wait_for_timeout(3000)
            except Exception:
                print(f"⚠️ Vrain {cfg['name']} timeout selector!")
            html_content = page.content()
            browser.close()

        soup = BeautifulSoup(html_content, "html.parser")
        stations = soup.select(".station")
        if not stations:
            print(f"❌ Vrain {cfg['name']}: không tìm thấy trạm.")
            return False

        today = datetime.now(TZ_VN).strftime("%Y-%m-%d")
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        cols = [i[1] for i in c.execute("PRAGMA table_info(rain_stations)").fetchall()]
        if "station_key" not in cols:
            c.execute("ALTER TABLE rain_stations ADD COLUMN station_key TEXT")
        for row in c.execute("SELECT id, station_name FROM rain_stations WHERE station_key IS NULL").fetchall():
            c.execute("UPDATE rain_stations SET station_key = ? WHERE id = ?",
                      (normalize_station_key(row[1]), row[0]))
        if not c.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_rain_date_key'").fetchone():
            c.execute("""DELETE FROM rain_stations WHERE id NOT IN
                         (SELECT MAX(id) FROM rain_stations GROUP BY date, station_key)""")
            c.execute("CREATE UNIQUE INDEX idx_rain_date_key ON rain_stations(date, station_key)")

        cnt = 0
        for st in stations:
            try:
                r1 = st.select_one(".station-row-1")
                if not r1: continue
                spans = r1.find_all("span", recursive=False)
                if len(spans) < 2: continue
                name = spans[0].get_text(strip=True)
                mm_str = spans[-1].get_text(strip=True).replace("mm", "").replace(",", ".").strip()
                mm = float(mm_str) if mm_str else 0.0

                r2 = st.select_one(".station-row-2")
                loc, lvl = "", ""
                if r2:
                    childs = r2.find_all(recursive=False)
                    if childs:
                        loc = childs[0].get_text(strip=True)
                        if len(childs) > 1:
                            lvl = childs[-1].get_text(strip=True)

                is_key = 1 if (code == "khanh-hoa" and any(k.lower() in name.lower() for k in UPSTREAM_KEYS)) else 0

                c.execute("""
                    INSERT OR REPLACE INTO rain_stations
                    (date, station_key, station_name, basin, location, mm, level, is_key, province)
                    VALUES (?,?,?,?,?,?,?,?,?)
                """, (today, normalize_station_key(name), name, name, loc, mm, lvl, is_key, code))
                cnt += 1
            except Exception:
                continue

        conn.commit()
        conn.close()
        print(f"✅ Vrain {cfg['name']}: đã lưu {cnt} trạm.")
        return cnt > 0

    except Exception as e:
        print(f"❌ Vrain {cfg['name']}: {e}")
        return False

# ==== CRAWL: VNDMS (toàn quốc, chia theo tỉnh) ====

def parse_vndms_station(ft):
    """Parse 1 feature water_level -> (level_now, source_time_str, water_levels[]) hoặc None."""
    props = ft.get("properties", {})
    popup_raw = props.get("popupInfo", "")
    popup_clean = html.unescape(popup_raw)

    level_now, source_time_str = None, ""
    m_info = re.search(r"Mực nước\s*\((-?\d+\.?\d*)\(m\)\s*([^)]+)\)", popup_clean)
    if m_info:
        level_now = float(m_info.group(1))
        raw_time = m_info.group(2).strip()
        try:
            parts = raw_time.split('-')
            hour = parts[0].strip()
            date_part = parts[1].strip()
            if len(hour) == 1: hour = "0" + hour
            source_time_str = f"{hour}:00 {date_part}"
        except Exception:
            source_time_str = raw_time

    water_levels = []
    if 'src="' in popup_clean:
        try:
            chart_url_part = popup_clean.split('src="')[1].split('"')[0]
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(chart_url_part).query)
            if 'c' in qs:
                cfg_raw = qs['c'][0]
                labels, values = [], []
                if "labels" in cfg_raw:
                    try:
                        start = cfg_raw.find("labels")
                        l_start = cfg_raw.find("[", start)
                        l_end = cfg_raw.find("]", l_start)
                        for item in cfg_raw[l_start+1:l_end].split(","):
                            clean = item.replace("'", "").replace('"', "").replace("\\n", " ").strip()
                            if clean: labels.append(clean)
                    except Exception: pass
                if "datasets" in cfg_raw:
                    try:
                        ds_idx = cfg_raw.find("datasets")
                        d_idx = cfg_raw.find("data", ds_idx)
                        d_start = cfg_raw.find("[", d_idx)
                        d_end = cfg_raw.find("]", d_start)
                        for val in cfg_raw[d_start+1:d_end].split(","):
                            try: values.append(float(val.strip()))
                            except Exception: pass
                    except Exception: pass
                for i in range(min(len(labels), len(values))):
                    water_levels.append({"time": labels[i], "value": values[i], "unit": "m"})
        except Exception: pass

    return level_now, source_time_str, water_levels

def parse_source_time_to_ts(source_time_str):
    """'07:00 22/08' -> 'YYYY-08-22 07:00' (xử lý lấn năm)."""
    m = re.match(r"(\d{1,2}):(\d{2})\s+(\d{1,2})/(\d{1,2})$", (source_time_str or "").strip())
    if not m:
        return None
    now = datetime.now(TZ_VN)
    hh, mi, day, month = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    try:
        ts = datetime(now.year, month, day, hh, mi)
    except ValueError:
        return None
    if (ts - now.replace(tzinfo=None)).total_seconds() > 30 * 86400:
        ts = datetime(now.year - 1, month, day, hh, mi)
    return ts.strftime("%Y-%m-%d %H:%M")

def save_river_history(station, level_now, source_time_str, water_levels):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        ts = parse_source_time_to_ts(source_time_str) or datetime.now(TZ_VN).strftime("%Y-%m-%d %H:%M")
        c.execute("INSERT OR REPLACE INTO river_history (station, ts, level) VALUES (?, ?, ?)", (station, ts, level_now))
        for item in water_levels:
            m = re.search(r"(\d{1,2})h\D+(\d{1,2})/(\d{1,2})", item.get("time", ""))
            if not m: continue
            now = datetime.now(TZ_VN)
            try:
                dt = datetime(now.year, int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError:
                continue
            if (dt - now.replace(tzinfo=None)).total_seconds() > 30 * 86400:
                dt = datetime(now.year - 1, int(m.group(3)), int(m.group(2)), int(m.group(1)))
            c.execute("INSERT OR IGNORE INTO river_history (station, ts, level) VALUES (?, ?, ?)",
                      (station, dt.strftime("%Y-%m-%d %H:%M"), item.get("value")))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ river_history: {e}")

def get_status(lvl):
    if lvl >= FLOOD_LEVELS["bao_dong_3"]: return "🔴 Trên BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_2"]: return "🟠 BĐ2-BĐ3"
    if lvl >= FLOOD_LEVELS["bao_dong_1"]: return "🟡 BĐ1-BĐ2"
    return "🟢 Dưới BĐ1"

def crawl_rivers_vndms():
    """Fetch water_level toàn quốc 1 lần, cập nhật mọi trạm đã cấu hình."""
    print("\n🌊 [VNDMS] Mực nước các trạm...")
    try:
        features = []
        for lv in [0, 1, 2, 3]:
            url = f"{VNDMS_BASE}/water_level?lv={lv}"
            try:
                r = requests.get(url, headers=VNDMS_HEADERS, timeout=15)
                if r.status_code != 200: continue
                features.extend(r.json().get("features", []))
            except Exception:
                continue

        # index theo label để match nhanh
        by_label = {}
        for ft in features:
            lab = ft.get("properties", {}).get("label", "")
            if lab:
                by_label.setdefault(lab, []).append(ft)

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        count = 0
        for code, cfg in PROVINCES.items():
            for st_cfg in cfg.get("river_stations", []):
                label = st_cfg["label"]
                metric_name = st_cfg.get("metric", label)
                # 1 feature có thể xuất hiện ở nhiều "lv" — duyệt hết các bản
                # trùng label, ưu tiên bản CÓ số đo (bản đầu có thể chưa cập nhật)
                level_now = source_time_str = None
                water_levels = []
                found = False
                for ft in by_label.get(label, []):
                    popup = html.unescape(ft.get("properties", {}).get("popupInfo", ""))
                    if not any(place in popup for place in cfg["vndms_places"]):
                        continue
                    lv_now, lv_time, wl = parse_vndms_station(ft)
                    if lv_now is not None:
                        level_now, source_time_str, water_levels = lv_now, lv_time, wl
                        found = True
                        break
                if not found or level_now is None:
                    continue

                # Tọa độ trạm (geometry [lon, lat]) cho bản đồ 2.5D
                coords = ft.get("geometry", {}).get("coordinates")
                st_lat = st_lon = None
                if coords and len(coords) >= 2:
                    st_lon, st_lat = coords[0], coords[1]

                result_obj = {"station_info": {}, "water_levels": water_levels}
                final_time = source_time_str or datetime.now(TZ_VN).strftime("%H:%M %d/%m")
                bd1, bd2, bd3 = (st_cfg.get("bd1"), st_cfg.get("bd2"), st_cfg.get("bd3"))
                if bd3 is not None:
                    desc = f"VNDMS | {get_status(level_now)}" if code == "khanh-hoa" else f"VNDMS | Cập nhật trạm {label}"
                else:
                    desc = f"VNDMS | Mực nước {label}"

                c.execute(
                    """UPDATE metrics SET value=?, updated_at=?, description=?, source_link='',
                             is_estimated=0, history_json=?, type='river', lat=?, lon=?
                       WHERE name=? AND province=?""",
                    (level_now, final_time, desc, json.dumps(result_obj, ensure_ascii=False),
                     st_lat, st_lon, metric_name, code),
                )
                if c.rowcount == 0:
                    c.execute(
                        """INSERT INTO metrics (name, type, value, updated_at, description, history_json, province, lat, lon)
                           VALUES (?, 'river', ?, ?, ?, ?, ?, ?, ?)""",
                        (metric_name, level_now, final_time, desc,
                         json.dumps(result_obj, ensure_ascii=False), code, st_lat, st_lon),
                    )
                count += 1
                # commit trước khi save_river_history mở connection khác,
                # tránh lỗi SQLite "database is locked"
                conn.commit()
                save_river_history(metric_name, level_now, source_time_str, water_levels)
                print(f"  ✅ {cfg['name']} | {label}: {level_now}m | {final_time}")

        conn.commit()
        conn.close()
        print(f"✅ VNDMS rivers: {count} trạm.")
    except Exception as e:
        print(f"❌ Lỗi rivers VNDMS: {e}")

def crawl_reservoirs_vndms():
    """Fetch pctt toàn quốc 1 lần. Khánh Hòa: map đích danh; tỉnh khác: top 3 hồ theo dung tích."""
    print("\n🏞 [VNDMS] Hồ chứa...")
    try:
        url = f"{VNDMS_BASE}/pctt?dangxa=0"
        r = requests.get(url, headers=VNDMS_HEADERS, timeout=20)
        geo = r.json()
        now = datetime.now(TZ_VN)

        # group hồ theo tỉnh (tentinh thường nằm trong properties)
        by_prov = {}
        for ft in geo.get("features", []):
            props = ft.get("properties", {})
            tentinh = props.get("tentinh", "")
            if tentinh:
                by_prov.setdefault(tentinh.strip(), []).append(props)

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        total = 0

        def upsert_ho(db_name, code, props, ft=None):
            nonlocal total
            data_list = props.get("data", [])
            latest = data_list[0] if data_list else {}
            level = latest.get("tdmucnuoc")
            volume = latest.get("tddungtich")
            if level is None: level = props.get("tdmucnuoc")
            if volume is None: volume = props.get("tddungtich")

            # Tọa độ hồ cho bản đồ 2.5D
            ho_lat = props.get("lat") or props.get("vido")
            ho_lon = props.get("lng") or props.get("kinhdo")
            geom = (ft or {}).get("geometry") or {}
            if geom.get("type") == "Point" and geom.get("coordinates"):
                ho_lon, ho_lat = geom["coordinates"][0], geom["coordinates"][1]
            try: ho_lat = float(ho_lat) if ho_lat is not None else None
            except Exception: ho_lat = None
            try: ho_lon = float(ho_lon) if ho_lon is not None else None
            except Exception: ho_lon = None

            tskt = props.get("thong_so_ky_thuat") or {}
            max_cap = tskt.get("dungtichtoanbo")
            if max_cap is None: max_cap = props.get("dungtichtoanbo")
            try: max_cap = float(max_cap)
            except Exception: max_cap = 0.0

            q_out = props.get("luuluong_xa")
            q_in = props.get("luuluong_den")

            time_src = latest.get("thoigian") or latest.get("thoigiancapnhat") or props.get("thoigian_ghinhan_luuluong")
            display_time = ""
            if time_src:
                try:
                    clean = time_src.replace("T", " ").split(".")[0]
                    dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
                    display_time = dt.strftime("%H:%M %d/%m")
                except Exception:
                    display_time = time_src

            final_q_out = None
            time_q = props.get("thoigian_ghinhan_luuluong")
            if q_out is not None and time_q:
                try:
                    clean_q = time_q.replace("T", " ").split(".")[0]
                    dt_q = datetime.strptime(clean_q, "%Y-%m-%d %H:%M:%S")
                    if (now.replace(tzinfo=None) - dt_q).total_seconds()/3600 < 24:
                        final_q_out = q_out
                except Exception:
                    final_q_out = q_out
            elif q_out is not None:
                final_q_out = q_out

            desc = f"Mực nước: {level}m | Dung tích: {volume}/{max_cap} tr.m3"
            final_updated_at = display_time or now.strftime("%H:%M %d/%m")

            c.execute(
                """UPDATE metrics SET value=?, updated_at=?, description=?, q_in=?, q_out=?, news_time=?,
                         level_now=?, volume_now=?, max_capacity=?, lat=?, lon=?
                   WHERE name=? AND province=?""",
                (level or 0, final_updated_at, desc, q_in, final_q_out, final_updated_at,
                 level, volume, max_cap, ho_lat, ho_lon, db_name, code),
            )
            if c.rowcount == 0:
                c.execute(
                    """INSERT INTO metrics (name, type, value, updated_at, description, q_in, q_out,
                                            news_time, level_now, volume_now, max_capacity, province, lat, lon)
                       VALUES (?, 'reservoir', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (db_name, level or 0, final_updated_at, desc, q_in, final_q_out,
                     final_updated_at, level, volume, max_cap, code, ho_lat, ho_lon),
                )
            total += 1

        # Khánh Hòa: map đích danh (giữ nguyên flow cũ, kể cả hồ Đá Bàn trùng tên tỉnh khác)
        kh_props = {}
        for tentinh, props_list in by_prov.items():
            if tentinh.strip().lower() == "khánh hòa":
                kh_props = props_list
                break
        for props in kh_props:
            name_raw = props.get("tenho", "").lower()
            db_name = None
            for kw, target in KH_RESERVOIR_MAP.items():
                if kw in name_raw:
                    db_name = target
                    break
            if db_name:
                upsert_ho(db_name, "khanh-hoa", props)

        # Tỉnh khác: top 3 hồ theo dung tích tổng (dùng alias tên tỉnh, kể cả tỉnh cũ)
        for code, cfg in PROVINCES.items():
            if code == "khanh-hoa":
                continue
            places = RESERVOIR_PLACES.get(code, cfg["vndms_places"])
            props_list = []
            for place in places:
                for tentinh, pl in by_prov.items():
                    if place.lower() in tentinh.strip().lower():
                        props_list.extend(pl)
            def cap_of(props):
                try: return float((props.get("thong_so_ky_thuat") or {}).get("dungtichtoanbo") or props.get("dungtichtoanbo") or 0)
                except Exception: return 0
            top = sorted(props_list, key=cap_of, reverse=True)[:3]
            for props in top:
                tento = (props.get("tenho") or "").strip()
                if not tento: continue
                upsert_ho(f"Hồ {tento}", code, props)

        conn.commit()
        conn.close()
        print(f"✅ Hồ chứa: {total} hồ các tỉnh.")
    except Exception as e:
        print(f"❌ Lỗi crawl hồ: {e}")

# ==== CRAWL: Open-Meteo dự báo theo tỉnh ====

def crawl_open_meteo_forecast():
    print("\n🌐 [Open-Meteo] Dự báo mưa 24h tới theo tỉnh...")
    now = datetime.now(TZ_VN)
    now_iso = now.strftime("%Y-%m-%dT%H:00")
    end_iso = (now + timedelta(hours=24)).strftime("%Y-%m-%dT%H:00")

    for code, cfg in PROVINCES.items():
        points = []
        for point in cfg.get("forecast_points", []):
            url = (
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={point['lat']}&longitude={point['lon']}"
                "&hourly=precipitation&forecast_days=2&timezone=Asia%2FBangkok"
            )
            try:
                r = requests.get(url, timeout=8).json()
                times = r.get("hourly", {}).get("time", [])
                vals = r.get("hourly", {}).get("precipitation", [])
                next24 = sum(v for t, v in zip(times, vals) if v is not None and now_iso < t <= end_iso)
                points.append({"name": point["name"], "next24_mm": round(next24, 1)})
            except Exception:
                continue
        if not points:
            continue
        best = max(points, key=lambda p: p["next24_mm"])
        payload = {
            "source": "open-meteo", "fetched_at": now.strftime("%H:%M %d/%m"),
            "points": points, "max_mm": best["next24_mm"], "point_name": best["name"],
        }
        updated_at = now.strftime("%H:%M %d/%m")
        ok = db_execute(
            """UPDATE metrics SET value=?, updated_at=?, history_json=?
               WHERE name='Du_Bao_Mua_24h' AND province=?""",
            (best["next24_mm"], updated_at, json.dumps(payload, ensure_ascii=False), code),
        )
        if ok:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            if not c.execute("SELECT 1 FROM metrics WHERE name='Du_Bao_Mua_24h' AND province=?", (code,)).fetchone():
                c.execute(
                    """INSERT INTO metrics (name, type, value, updated_at, history_json, description, province)
                       VALUES ('Du_Bao_Mua_24h', 'forecast', ?, ?, ?, 'Dự báo mô hình Open-Meteo', ?)""",
                    (best["next24_mm"], updated_at, json.dumps(payload, ensure_ascii=False), code),
                )
                conn.commit()
            conn.close()
    print("✅ Open-Meteo: xong.")

# ==== KHÁNH HÒA RIÊNG (flow cũ) ====

def override_rain_with_vrain(is_success):
    print("⏱ [KH] Tính mưa tích lũy 3 ngày (Vrain)...")
    if not is_success:
        print("⚠️ Bỏ qua override vì Vrain crawl thất bại.")
        return
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        today = datetime.now(TZ_VN).date()
        dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(2, -1, -1)]
        placeholders = ",".join("?" for _ in dates)

        top = cur.execute(
            f"""SELECT station_name, SUM(mm) as total FROM rain_stations
                WHERE is_key=1 AND province='khanh-hoa' AND date IN ({placeholders})
                GROUP BY station_name ORDER BY total DESC LIMIT 1""",
            dates,
        ).fetchone()
        if top:
            name, total = top["station_name"], top["total"]
            rows = cur.execute(
                f"""SELECT date, mm FROM rain_stations
                    WHERE station_name=? AND date IN ({placeholders}) ORDER BY date""",
                (name, *dates),
            ).fetchall()
            rain_map = {r["date"]: r["mm"] for r in rows}
            vals = [rain_map.get(d, 0.0) for d in dates]
            desc = ",".join(f"{v:.1f}" for v in vals)
            db_execute(
                """UPDATE metrics SET value=?, description=?, updated_at=?
                   WHERE name='Mưa Thượng Nguồn (Max)' AND province='khanh-hoa'""",
                (vals[-1], desc, datetime.now(TZ_VN).strftime("%H:%M %d/%m")),
            )
            print(f"✅ [KH] Max Rain ({name}): 3 ngày {total:.1f}mm")
        conn.close()
    except Exception as e:
        print(f"❌ Calc Rain KH: {e}")

def calculate_upstream_list(is_success):
    print("⏱ [KH] Tổng hợp dữ liệu Thượng Nguồn...")
    if not is_success:
        return
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        today = datetime.now(TZ_VN).date()
        dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(2, -1, -1)]
        placeholders = ",".join("?" for _ in dates)
        as_of = datetime.now(TZ_VN).strftime("%H:%M")

        results = []
        for target, patterns in UPSTREAM_TARGETS:
            where = " OR ".join("station_name LIKE ?" for _ in patterns)
            rows = cur.execute(
                f"""SELECT date, mm, station_key, station_name, location, level FROM rain_stations
                    WHERE ({where}) AND date IN ({placeholders}) AND province='khanh-hoa'
                    ORDER BY date""",
                (*patterns, *dates),
            ).fetchall()
            if not rows:
                continue
            by_key = {}
            for r in rows:
                by_key.setdefault(r["station_key"], {})[r["date"]] = r
            best_map, best_val = None, -1
            for _, day_rows in by_key.items():
                row_today = day_rows.get(dates[2])
                val_today = row_today["mm"] if row_today else 0.0
                if val_today > best_val:
                    best_val, best_map = val_today, day_rows
            if best_map is None:
                continue
            vals, days_present = [], 0
            location_str, level_str, disp_name = "", "", target
            for d in dates:
                row = best_map.get(d)
                if row:
                    vals.append(row["mm"])
                    days_present += 1
                    if d == dates[2]:
                        location_str = row["location"] or ""
                        level_str = row["level"] or ""
                        disp_name = (row["station_name"].split(",")[0].strip()) or target
                else:
                    vals.append(0.0)
            results.append({
                "name": disp_name, "location": location_str, "level": level_str,
                "today": vals[2], "total_3day": sum(vals),
                "days_present": days_present, "has_enough_data": days_present >= 2, "as_of": as_of,
            })

        json_data = json.dumps(results, ensure_ascii=False)
        updated_at = datetime.now(TZ_VN).strftime("%H:%M %d/%m")
        c = conn.cursor()
        c.execute(
            "UPDATE metrics SET history_json=?, updated_at=? WHERE name='Du_Lieu_Thuong_Nguon' AND province='khanh-hoa'",
            (json_data, updated_at),
        )
        if c.rowcount == 0:
            c.execute(
                "INSERT INTO metrics (name, value, updated_at, history_json, description, province) VALUES ('Du_Lieu_Thuong_Nguon', 0, ?, ?, '', 'khanh-hoa')",
                (updated_at, json_data),
            )
        conn.commit()
        conn.close()
        print(f"✅ [KH] Thượng nguồn: {len(results)} trạm.")
    except Exception as e:
        print(f"❌ Calc Upstream: {e}")

def crawl_news():
    print("\n📰 [KH] Quét tin tức...")
    try:
        soup = BeautifulSoup(
            requests.get(URL_XA_HOI, headers={"User-Agent": "Mozilla/5.0"}, timeout=15).text,
            "html.parser",
        )
        for i in soup.select(".row.event_2 .col-3, .listnews .item"):
            a = i.find("a", class_="title2") or i.find("a")
            if a:
                href = a.get("href") or ""
                lnk = "https://baokhanhhoa.vn" + href if href and not href.startswith("http") else href
                save_alert(a.text.strip(), lnk, "Báo Khánh Hòa")
    except Exception:
        pass

def save_province_registry():
    """Ghi danh sách tỉnh + cấu hình meta (gồm ngưỡng BĐ trạm sông) xuống metrics cho API/web."""
    registry = []
    for code, cfg in PROVINCES.items():
        entry = {"code": code, "name": cfg["name"], "kind": cfg["kind"]}
        for st_cfg in cfg.get("river_stations", []):
            entry["river"] = {
                "name": st_cfg.get("metric", st_cfg["label"]),
                "bd1": st_cfg.get("bd1"), "bd2": st_cfg.get("bd2"), "bd3": st_cfg.get("bd3"),
            }
            break  # trạm đại diện đầu tiên
        registry.append(entry)
    db_execute(
        "UPDATE metrics SET history_json=?, updated_at=? WHERE name='Danh_Sach_Tinh' AND province='__system__'",
        (json.dumps(registry, ensure_ascii=False), datetime.now(TZ_VN).strftime("%H:%M %d/%m")),
    )
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if not c.execute("SELECT 1 FROM metrics WHERE name='Danh_Sach_Tinh' AND province='__system__'").fetchone():
        c.execute(
            "INSERT INTO metrics (name, type, value, history_json, province) VALUES ('Danh_Sach_Tinh', 'registry', 0, ?, '__system__')",
            (json.dumps(registry, ensure_ascii=False),),
        )
        conn.commit()
    conn.close()

if __name__ == "__main__":
    ensure_tables_and_columns()
    print("🚀 KHANH HOA FLOOD MONITOR - MULTI-PROVINCE (%d tỉnh)" % len(PROVINCES))
    while True:
        print(f"\n⏰ {datetime.now(TZ_VN).strftime('%H:%M %d/%m')}")
        save_province_registry()

        # 1. Vrain toàn quốc (1 lần Playwright) -> province_rain
        national = crawl_vrain_national()

        # 2. Deep pass: tỉnh đang mưa >= ngưỡng + tỉnh luôn quét sâu
        deep_codes = set(code for code, d in national.items() if d["max_mm"] >= DEEP_PASS_THRESHOLD_MM)
        deep_codes.add("khanh-hoa")
        ranked = sorted(
            deep_codes,
            key=lambda c: national.get(c, {}).get("max_mm", 0),
            reverse=True,
        )[:DEEP_PASS_MAX]
        kh_ok = False
        for code in ranked:
            ok = crawl_vrain_province(code)
            if code == "khanh-hoa":
                kh_ok = ok

        # 3. Khánh Hòa riêng
        override_rain_with_vrain(kh_ok)
        calculate_upstream_list(kh_ok)

        # 4. VNDMS toàn quốc 1 lần: sông + hồ mọi tỉnh
        crawl_rivers_vndms()
        crawl_reservoirs_vndms()

        # 5. Dự báo mỗi tỉnh + tin tức KH
        crawl_open_meteo_forecast()
        crawl_news()

        print("💤 Sleep 15m...")
        time.sleep(900)
