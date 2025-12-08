import requests
import json

def save_lakes_json():
    # URL API lấy toàn bộ hồ (không lọc trạng thái xả)
    url = "https://vndms.dmptc.gov.vn/pctt?dangxa=0"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    print(f"🚀 Đang tải dữ liệu từ API...")

    try:
        response = requests.get(url, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            features = data.get('features', [])
            
            # Danh sách từ khóa hồ cần lọc
            target_lakes = [
                "suối dầu", "suoi dau", 
                "hoa sơn", "hoa son", 
                "đá bàn", "da ban", 
                "am chúa", "am chua", 
                "láng nhớt", "lang nhot", 
                "cam ranh", "cam ranh", 
                "tà lương", "ta luong",
                "cây sung", "cay sung"
            ]
            
            filtered_features = []
            
            print("⏳ Đang lọc hồ theo danh sách mục tiêu...")
            for feature in features:
                props = feature.get('properties', {})
                name = props.get('tenho', 'Unknown')
                
                # Check tên hồ (case-insensitive)
                name_lower = str(name).lower()
                if any(kw in name_lower for kw in target_lakes):
                    filtered_features.append(feature)
            
            # Cấu trúc JSON kết quả
            output_data = {
                "type": "FeatureCollection",
                "total_found": len(filtered_features),
                "timestamp": response.headers.get('Date'), # Thời gian server trả về
                "features": filtered_features
            }
            
            # Lưu ra file json_response.json
            filename = "json_response.json"
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
                
            print(f"✅ Đã lưu xong! Tìm thấy {len(filtered_features)} hồ.")
            print(f"📂 File: {filename}")
            
        else:
            print(f"❌ Lỗi API: {response.status_code}")

    except Exception as e:
        print(f"❌ Lỗi: {e}")

if __name__ == "__main__":
    save_lakes_json()
