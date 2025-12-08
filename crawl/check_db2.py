import sqlite3
import os

# Đường dẫn tới DB
db_path = 'flood.db'

if not os.path.exists(db_path):
    print(f"❌ Không tìm thấy file {db_path}!")
else:
    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        print(f"--- ĐANG KIỂM TRA DB: {db_path} ---")
        
        # 1. Kiểm tra bảng metrics có tồn tại không
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='metrics';")
        if not c.fetchone():
            print("❌ Bảng 'metrics' KHÔNG tồn tại!")
        else:
            # 2. Liệt kê TẤT CẢ các dòng trong metrics để xem có gì
            print("\n📋 DANH SÁCH METRICS HIỆN CÓ:")
            rows = c.execute("SELECT id, name, value, updated_at, description FROM metrics").fetchall()
            
            if not rows:
                print("⚠️ Bảng metrics đang TRỐNG!")
            else:
                for r in rows:
                    print(f"ID: {r[0]} | Name: '{r[1]}' | Value: {r[2]} | Time: {r[3]}")
                    # In thử description xem có gì lạ không
                    if 'Sông Cái' in r[1]:
                        print(f"   -> Desc: {r[4]}")

            # 3. Tìm riêng Sông Cái
            print("\n🔍 CHECK SÔNG CÁI:")
            sc_rows = [r for r in rows if 'Sông Cái' in r[1] or 'Đồng Trăng' in r[1]]
            if len(sc_rows) == 0:
                print("❌ Không tìm thấy dòng nào tên 'Sông Cái' hoặc 'Đồng Trăng'.")
            elif len(sc_rows) > 1:
                print(f"⚠️ CẢNH BÁO: Có {len(sc_rows)} dòng trùng tên! API có thể đang lấy dòng sai.")
            else:
                print("✅ Chỉ có 1 dòng Sông Cái duy nhất (Tốt).")
                print(f"   -> Giá trị hiện tại trong DB là: {sc_rows[0][2]}")

        conn.close()
        
    except Exception as e:
        print(f"❌ Lỗi khi đọc DB: {e}")
