import requests
import json

# Danh sách các vùng ngập với tọa độ từ báo chí + wiki
FLOOD_ZONES = [
    {"name": "Phường Tây Nha Trang", "lat": 12.2611, "lon": 109.1570},
    {"name": "Phường Bắc Nha Trang", "lat": 12.3221, "lon": 109.1710},
    {"name": "Xã Diên Khánh", "lat": 12.2625, "lon": 109.0983},
    {"name": "Xã Diên Điền", "lat": 12.3022, "lon": 109.0960},
    {"name": "Xã Suối Dầu", "lat": 12.0500, "lon": 109.1500},  # Cam Lâm area
    {"name": "Xã Cam Lâm", "lat": 12.0017, "lon": 109.2233},
    {"name": "Thị xã Ninh Hòa", "lat": 12.3800, "lon": 109.0500},
    {"name": "Huyện Khánh Vĩnh", "lat": 12.2600, "lon": 108.9000},
]

def get_elevation(lat, lon):
    """Lấy độ cao từ Open-Elevation API"""
    try:
        url = f"https://api.open-elevation.com/api/v1/lookup?locations={lat},{lon}"
        response = requests.get(url, timeout=5)
        data = response.json()
        
        if data['results']:
            elevation = data['results'][0]['elevation']
            return elevation
        return None
    except Exception as e:
        print(f"❌ Error fetching elevation for ({lat},{lon}): {e}")
        return None

def main():
    print("🗺️ FETCHING ELEVATION DATA FOR FLOOD ZONES")
    print("=" * 70)
    
    zones_with_elevation = []
    
    for zone in FLOOD_ZONES:
        name = zone['name']
        lat = zone['lat']
        lon = zone['lon']
        
        print(f"\n🔍 {name} ({lat}, {lon})")
        elevation = get_elevation(lat, lon)
        
        if elevation is not None:
            print(f"   ✅ Elevation: {elevation:.1f}m")
            zone['base_elevation'] = round(elevation, 1)
            zones_with_elevation.append(zone)
        else:
            print(f"   ❌ Failed to fetch elevation")
    
    # Lưu ra file JSON
    output = {
        "timestamp": "2025-12-05",
        "source": "Open-Elevation API",
        "zones": zones_with_elevation
    }
    
    with open('zones_elevation.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print("\n" + "=" * 70)
    print(f"✅ Lưu {len(zones_with_elevation)} vùng vào zones_elevation.json")
    print("\n📊 Data for page.js:")
    print(json.dumps(zones_with_elevation, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
