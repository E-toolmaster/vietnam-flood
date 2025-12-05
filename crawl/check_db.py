import sqlite3

conn = sqlite3.connect('flood.db')
c = conn.cursor()

print("=" * 60)
print("🔍 CHECKING RAIN DATA IN DB")
print("=" * 60)

c.execute("SELECT name, value, description, updated_at FROM metrics WHERE type = 'rain'")
result = c.fetchall()

print(f"\n📊 Result: {result}")

if result:
    for row in result:
        name, value, description, updated_at = row
        print(f"\n✅ Found:")
        print(f"   Name: {name}")
        print(f"   Value (current): {value} mm")
        print(f"   Description (3 days): {description}")
        print(f"   Updated: {updated_at}")
        
        # Parse 3 days
        if description:
            rain_3day = description.split(',')
            print(f"\n   📈 3-Day breakdown:")
            print(f"      Day 1 (2 days ago): {rain_3day[0]} mm")
            print(f"      Day 2 (yesterday): {rain_3day[1]} mm")
            print(f"      Day 3 (today): {rain_3day[2]} mm")
            print(f"      Total: {sum(float(x) for x in rain_3day):.1f} mm")
else:
    print("❌ No rain data found!")

print("\n" + "=" * 60)
print("🔍 CHECKING ALL METRICS")
print("=" * 60)

c.execute("SELECT type, name, value, unit FROM metrics")
all_metrics = c.fetchall()

for row in all_metrics:
    type_, name, value, unit = row
    print(f"[{type_}] {name}: {value} {unit}")

conn.close()
