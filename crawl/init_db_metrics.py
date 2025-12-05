import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'flood.db')

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# Bảng Alerts
c.execute('''CREATE TABLE IF NOT EXISTS alerts
             (id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT, link TEXT UNIQUE, source TEXT, time_crawled TEXT, is_urgent INTEGER DEFAULT 0)''')

# Bảng Metrics - Thêm cột description và source_link
c.execute('''CREATE TABLE IF NOT EXISTS metrics
             (id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT, name TEXT UNIQUE, value REAL, unit TEXT, 
              updated_at TEXT, news_time TEXT, description TEXT, source_link TEXT)''')

# Reset data cũ
c.execute("DELETE FROM metrics")

# Data mẫu - 7 metrics chính
seed_data = [
    ('river', 'Sông Cái (Đồng Trăng)', 3.5, 'm', '06:00', None, 'Mực nước sông Cái Nha Trang', None),
    ('rain', 'Mưa Đầu Nguồn (Khánh Vĩnh)', 0.0, 'mm', '06:00', None, 'Lượng mưa tại đầu nguồn', None),
    
    # 5 Hồ Chứa
    ('lake', 'Hồ Đá Bàn', 0.0, 'm³/s', '06:00', None, 
     'Hồ chứa thủy lợi lớn nhất KH. Dung tích: 75-79.2 triệu m³. Vị trí: Ninh Hòa', 
     'https://baokhanhhoa.vn/phong-su-anh/201907/ngam-cong-vien-da-tuyet-dep-trong-long-ho-thuy-loi-da-ban-8122245/'),
    
    ('lake', 'Hồ Suối Dầu', 0.0, 'm³/s', '06:00', None, 
     'Hồ chứa thủy lợi quan trọng. Dung tích: 32-35 triệu m³. Vị trí: Cam Lâm-Diên Khánh. Ảnh hưởng trực tiếp Nha Trang', 
     'https://baokhanhhoa.vn/xa-hoi/202511/4144-ho-chua-nuoc-dang-xa-dieu-tiet-c9f1e24/'),
    
    ('lake', 'Hồ Cam Ranh', 0.0, 'm³/s', '06:00', None, 
     'Hồ chứa thủy lợi. Dung tích: 22 triệu m³. Vị trí: Cam Lâm. Cấp nước cho vùng Cam Ranh', 
     'https://dantri.com.vn/thoi-su/13-ho-xa-nuoc-don-lu-vung-nao-o-khanh-hoa-co-the-bi-anh-huong-20251105110916240.htm'),
    
    ('lake', 'Hồ Ea Krong Rou', 0.0, 'm³/s', '06:00', None, 
     'Thủy điện. Dung tích: 35.9 triệu m³. Công suất: 28 MW. Vị trí: Ninh Tây (Ninh Hòa)', 
     'https://baokhanhhoa.vn/kinh-te/201812/toan-tinh-khanh-hoa-co-4-du-an-nha-may-thuy-dien-8100428/'),
    
    ('lake', 'Hồ Sông Giang', 0.0, 'm³/s', '06:00', None, 
     'Thủy điện bậc thang. 2 nhà máy: Sông Giang 1 (12MW) + Sông Giang 2 (37MW). Vị trí: Khánh Vĩnh. Ảnh hưởng sông Cái', 
     'https://vi.wikipedia.org/wiki/Th%E1%BB%A7y_%C4%90i%E1%BB%87n_S%C3%B4ng_Giang'),
]



c.executemany("INSERT INTO metrics (type, name, value, unit, updated_at, news_time, description, source_link) VALUES (?,?,?,?,?,?,?,?)", seed_data)

conn.commit()
conn.close()
print("✅ DB Initialized with 5 lakes + River + Rain!")
