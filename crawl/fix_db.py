import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flood.db')

def fix_database():
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # 1. Xóa dòng lỗi nếu có (để tạo lại cho sạch)
        c.execute("DELETE FROM metrics WHERE name = 'Mưa Toàn Tỉnh'")
        
        # 2. Tạo lại dòng mới với đầy đủ thông tin (Quan trọng nhất là type='report')
        # Giả định cấu trúc bảng có cột: name, value, description, type, updated_at
        # Nếu bảng thiếu cột 'type', câu lệnh này sẽ lỗi, nhưng thường bảng metrics sẽ có cột này.
        print("Đang thêm row 'Mưa Toàn Tỉnh'...")
        
        c.execute("""
            INSERT INTO metrics (name, value, description, type, updated_at, unit)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ('Mưa Toàn Tỉnh', 0, 'Đang cập nhật dữ liệu từ báo...', 'report', 'Vừa xong', 'text'))
        
        conn.commit()
        print("✅ Đã sửa DB thành công! Dòng 'Mưa Toàn Tỉnh' đã có type='report'.")
        conn.close()
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        print("Có thể bảng 'metrics' của bạn không có cột 'type' hoặc 'unit'.")
        # Fallback nếu không có cột type
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("INSERT OR REPLACE INTO metrics (name, value, description) VALUES (?, ?, ?)",
                     ('Mưa Toàn Tỉnh', 0, 'Đang cập nhật...'))
            conn.commit()
            print("⚠️ Đã chèn kiểu fallback (không có type). Hãy kiểm tra route.js để lọc theo name.")
            conn.close()
        except:
            pass

if __name__ == "__main__":
    fix_database()
