import Database from 'better-sqlite3';
import path from 'path';

export async function GET() {
  try {
    // Đường dẫn tới DB
    const dbPath = path.join(process.cwd(), '../crawl/flood.db');
    const db = new Database(dbPath, { readonly: true });

    // 1. Lấy 20 tin cảnh báo mới nhất
    const alerts = db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 20').all();

    // 2. Lấy Metrics
    const metricsRows = db.prepare('SELECT * FROM metrics').all();
    const metrics = {};

    metricsRows.forEach(row => {
      // 2.1. Sông Cái
      if (row.name === 'Sông Cái (Đồng Trăng)' || row.type === 'river') {
        metrics.river = {
          current: row.value,
          bd1: 8.0, bd2: 9.5, bd3: 10.5,
          history_max: 11.9,
          updated: row.updated_at,
          description: row.description,
          source_link: row.source_link,
          is_estimated: row.is_estimated
        };
      }
      
      // === [SỬA CHỖ NÀY] ===
      // 2.2. Mưa Thượng Nguồn (Tên mới: Mưa Thượng Nguồn (Max))
      else if (row.name === 'Mưa Đầu Nguồn (Khánh Vĩnh)' || row.name === 'Mưa Thượng Nguồn (Max)') {
        const rain3dayStr = row.description || '0,0,0';
        metrics.rain = {
          current: row.value,
          rain_3day: rain3dayStr.split(',').map(v => parseFloat(v) || 0),
          updated: row.updated_at
        };
      }
      // ====================
      
      // 2.3. Mưa Toàn Tỉnh
      else if (row.name === 'Mưa Toàn Tỉnh') {
        metrics.province_rain = {
          description: row.description || 'Đang cập nhật...',
          updated: row.updated_at
        };
      }
      
      // 2.4. Các Hồ Chứa
      else if (row.name.includes('Hồ')) {
        const keyName = row.name.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/\s+/g, '_');
        
        metrics[keyName] = {
          name: row.name,
          current: row.value,
          updated: row.updated_at,
          news_time: row.news_time,
          source_link: row.source_link
        };
      }
    });

    // 3. Lấy Trạm Mưa (Vrain)
    const today = new Date().toLocaleString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 10);
    const rainStationRows = db.prepare(`
      SELECT station_name, basin, location, mm, level
      FROM rain_stations
      WHERE date = ? AND is_key = 1
      ORDER BY mm DESC
    `).all(today);
    metrics.rain_stations = rainStationRows;

    db.close();
    return Response.json({ data: alerts, metrics: metrics });

  } catch (error) {
    console.error("API ERROR:", error);
    return Response.json({ error: 'Server Error' }, { status: 500 });
  }
}
