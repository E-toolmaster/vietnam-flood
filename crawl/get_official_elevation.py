import requests
import json

ZONES = [
    {"name": "Bình Cạng, Bình Cạnh - Vĩnh Trung", "lat": 12.2580, "lon": 109.1580, "depth": 1.5},
    {"name": "Metro MM Mega Market 23/10 KM5", "lat": 12.2620, "lon": 109.1640, "depth": 1.2},
    {"name": "Đường 23/10 KM5 Vĩnh Trung", "lat": 12.2600, "lon": 109.1620, "depth": 1.0},
    {"name": "Ven sông Cái Vĩnh Thạnh", "lat": 12.2480, "lon": 109.1550, "depth": 1.8},
    {"name": "Khu Thủy Tú Vĩnh Thạnh", "lat": 12.2450, "lon": 109.1570, "depth": 1.5},
    {"name": "Khu Vĩnh Ngọc Nha Trang", "lat": 12.2650, "lon": 109.1880, "depth": 0.8},
    {"name": "Khu Liên Hoa Nha Trang", "lat": 12.2700, "lon": 109.1750, "depth": 0.7},
    {"name": "Diên Sơn Diên Khánh", "lat": 12.2520, "lon": 109.0800, "depth": 1.2},
    {"name": "Diên Lạc Diên Khánh", "lat": 12.2580, "lon": 109.0850, "depth": 1.3},
    {"name": "Diên Điền Diên Khánh", "lat": 12.3020, "lon": 109.0960, "depth": 1.1},
    {"name": "Diên An Diên Khánh", "lat": 12.2450, "lon": 109.0950, "depth": 0.9},
    {"name": "Thị xã Ninh Hòa", "lat": 12.2200, "lon": 109.1200, "depth": 0.6},
]

def get_elev(lat, lon):
    try:
        r = requests.get(f"https://api.open-elevation.com/api/v1/lookup?locations={lat},{lon}", timeout=5)
        return r.json()['results'][0]['elevation'] if r.json()['results'] else None
    except:
        return None

print("=" * 90)
print("🗺️  ELEVATION DATA - ĐỊM NGẬP LỤT LỊCH SỬ 20/11/2025")
print("=" * 90)

result = []
for z in ZONES:
    elev = get_elev(z['lat'], z['lon'])
    if elev:
        z['base_elevation'] = round(elev, 1)
        result.append(z)
        print(f"✅ {z['name']:40} | Tọa độ: ({z['lat']}, {z['lon']}) | Độ cao: {elev:.1f}m | Ngập 20/11: {z['depth']}m")
    else:
        print(f"❌ {z['name']:40} | Lỗi fetch")

with open('official_flood_zones.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print("\n" + "=" * 90)
print(f"✅ Lưu {len(result)}/12 vùng vào official_flood_zones.json\n")
print(json.dumps(result, indent=2, ensure_ascii=False))