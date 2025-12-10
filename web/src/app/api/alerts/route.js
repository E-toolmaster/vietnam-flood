import Database from 'better-sqlite3';
import path from 'path';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

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
      // 2.1. Sông Cái (Đồng Trăng)
      if (row.name === 'Sông Cái (Đồng Trăng)' || row.type === 'river') {
        let historyChart = []; // Dữ liệu dành cho biểu đồ
        let fullData = null;   // Dữ liệu đầy đủ (station info...)

        if (row.history_json) {
          try {
            const parsed = JSON.parse(row.history_json);
            fullData = parsed;
            
            // Map lại để phù hợp với Recharts (cần key 'time' và 'value')
            if (parsed.water_levels && Array.isArray(parsed.water_levels)) {
              historyChart = parsed.water_levels.map(item => ({
                time: item.time,   // VD: "01h - 07/12"
                value: item.value  // VD: 3.78
              }));
            }
          } catch (e) {
            historyChart = [];
          }
        }

        metrics.river = {
          current: row.value,
          bd1: 8.0, bd2: 9.5, bd3: 10.5,
          history_max: 11.9,
          updated: row.updated_at,
          description: row.description,
          source_link: row.source_link,
          is_estimated: row.is_estimated,
          history: historyChart, // Frontend dùng cái này vẽ chart
          station_info: fullData?.station_info // Frontend dùng cái này nếu muốn hiển thị chi tiết
        };
      }

      // 2.2. Mưa Thượng Nguồn (Max)
      else if (
        row.name === 'Mưa Đầu Nguồn (Khánh Vĩnh)' ||
        row.name === 'Mưa Thượng Nguồn (Max)'
      ) {
        const rain3dayStr = row.description || '0,0,0';
        metrics.rain = {
          current: row.value,
          rain_3day: rain3dayStr.split(',').map(v => parseFloat(v) || 0),
          updated: row.updated_at,
        };
      }

      // 2.3. Mưa Toàn Tỉnh
      else if (row.name === 'Mưa Toàn Tỉnh') {
        metrics.province_rain = {
          description: row.description || 'Đang cập nhật...',
          updated: row.updated_at,
        };
      }

      

      // 2.4. Các Hồ Chứa
            // 2.4. Các Hồ Chứa (Tự động map mọi hồ có trong DB)
                  // 2.4. Các Hồ Chứa
      else if (row.name && row.name.startsWith('Hồ ')) {
        const keyName = row.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/\s+/g, '_');

        metrics[keyName] = {
          name: row.name,
          current: row.value,
          updated: row.updated_at,
          news_time: row.news_time,
          source_link: row.source_link || null,
          q_in: row.q_in ?? null,
          q_out: row.q_out ?? null,
          level_now: row.level_now ?? null,
          volume_now: row.volume_now ?? null,
          max_capacity: row.max_capacity ?? 0, // <-- Trả về cái này
          description: row.description || '',
        };
      }

      if (row.name === 'Du_Lieu_Thuong_Nguon') {
        metrics.Du_Lieu_Thuong_Nguon = {
            updated: row.updated_at,
            history_json: row.history_json // Quan trọng cái này
        };
      }

        
    });

    // 3. Lấy Trạm Mưa (Vrain)
    const today = new Date()
      .toLocaleString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 10);

    const rainStationRows = db
      .prepare(
        `
      SELECT station_name, basin, location, mm, level
      FROM rain_stations
      WHERE date = ?
      ORDER BY mm DESC
    `,
      )
      .all(today);

    metrics.rain_stations = rainStationRows;

    db.close();
    return Response.json(
        { data: alerts, metrics },
        { 
          status: 200,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          }
        }
      );
  } catch (error) {
    console.error('API ERROR:', error);
    return Response.json({ error: 'Server Error' }, { status: 500 });
  }
}
