import sqlite3
import os

if os.path.exists('flood.db'):
    os.remove('flood.db')

conn = sqlite3.connect('flood.db')
c = conn.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS alerts 
             (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, link TEXT, source TEXT, time_crawled TEXT, is_urgent INTEGER DEFAULT 0)''')

data = [
    ('KHẨN: Hồ Suối Dầu xả lũ 100m3/s', '#', 'Báo Khánh Hòa', '10:30', 1),
    ('Mực nước sông Cái Báo động 2', '#', 'VNDMS', '10:15', 1),
    ('Dự báo mưa lớn Diên Khánh', '#', 'KTV', '09:45', 0)
]
c.executemany('INSERT INTO alerts (title, link, source, time_crawled, is_urgent) VALUES (?,?,?,?,?)', data)
conn.commit()
conn.close()
print("✅ Tạo database thành công!")
