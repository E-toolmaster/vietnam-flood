import sqlite3
import os

# Lấy thư mục chứa file script này (tức là thư mục 'crawl')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# File flood.db nằm NGAY TRONG thư mục crawl này luôn
DB_PATH = os.path.join(BASE_DIR, 'flood.db') 

print(f"Đang kết nối DB tại: {DB_PATH}")

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
try:
    c.execute("ALTER TABLE metrics ADD COLUMN news_time TEXT")
    print("✅ Đã thêm cột news_time thành công!")
except Exception as e:
    print(f"⚠️ Cột đã tồn tại hoặc lỗi: {e}")
conn.commit()
conn.close()
