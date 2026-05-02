import sqlite3
import os

DB_PATH = 'flood.db'

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# 1. Bảng alerts
c.execute('''CREATE TABLE IF NOT EXISTS alerts 
             (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, link TEXT, source TEXT, time_crawled TEXT, is_urgent INTEGER DEFAULT 0)''')

# 2. Bảng metrics
c.execute('''CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                value REAL,
                updated_at TEXT,
                description TEXT,
                source_link TEXT,
                is_estimated INTEGER DEFAULT 0,
                history_json TEXT,
                news_time TEXT,
                q_in REAL,
                q_out REAL,
                level_now REAL,
                volume_now REAL,
                max_capacity REAL,
                type TEXT
             )''')

# 3. Bảng rain_stations
c.execute('''CREATE TABLE IF NOT EXISTS rain_stations (
                id INTEGER PRIMARY KEY,
                date TEXT,
                station_name TEXT,
                basin TEXT,
                location TEXT,
                mm REAL,
                level TEXT,
                is_key INTEGER DEFAULT 0,
                UNIQUE(date, station_name)
            )''')

# Dữ liệu mẫu
data_alerts = [
    ('KHẨN: Hồ Suối Dầu xả lũ 100m3/s', '#', 'Báo Khánh Hòa', '10:30', 1),
    ('Mực nước sông Cái Báo động 2', '#', 'VNDMS', '10:15', 1),
    ('Dự báo mưa lớn Diên Khánh', '#', 'KTV', '09:45', 0)
]
c.executemany('INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)', data_alerts)

# Khởi tạo các hàng metrics cần thiết
metrics_init = [
    ('Sông Cái (Đồng Trăng)', 0.0, '', '', 'river'),
    ('Mưa Thượng Nguồn (Max)', 0.0, '', '', 'rain'),
    ('Du_Lieu_Thuong_Nguon', 0.0, '', '', 'upstream_list'),
    ('Mưa Toàn Tỉnh', 0.0, '', '', 'rain')
]
for m in metrics_init:
    c.execute("INSERT INTO metrics (name, value, updated_at, description, type) VALUES (?,?,?,?,?)", m)

conn.commit()
conn.close()
print("✅ Tạo database với đầy đủ bảng metrics, alerts, rain_stations thành công!")
