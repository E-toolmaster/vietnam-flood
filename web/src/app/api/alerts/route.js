import Database from 'better-sqlite3';
import path from 'path';
import { computeRisk } from '../risk-engine';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    // Đường dẫn tới DB
    const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), '../crawl/flood.db');
    console.log('Connecting to DB at:', dbPath);
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
          type: row.type, // page.js lọc theo 'reservoir' để cảnh báo xả lũ
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

      // 2.5. Dự báo mưa 24h tới (Open-Meteo — metric riêng, không lẫn số đo)
      if (row.name === 'Du_Bao_Mua_24h' && row.history_json) {
        try {
          metrics.forecast_rain = JSON.parse(row.history_json);
        } catch (e) { /* bỏ qua */ }
      }

    });

    // 3. Lấy Trạm Mưa (Vrain)
    const today = new Date()
      .toLocaleString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 10);

    const rainStationRows = db
      .prepare(
        `
      SELECT station_name, basin, location, mm, level, is_key
      FROM rain_stations
      WHERE date = ?
      ORDER BY mm DESC
    `,
      )
      .all(today);

    metrics.rain_stations = rainStationRows;

    // 4. Diễn biến mực nước 48h từ river_history (crawler tự tích lũy mỗi chu kỳ)
    let riverHistory48h = [];
    try {
      riverHistory48h = db
        .prepare(
          `SELECT ts, level FROM river_history
           WHERE ts >= datetime('now', 'localtime', '-48 hours')
           ORDER BY ts`,
        )
        .all()
        .map(r => ({
          time: `${r.ts.slice(11, 16)} ${r.ts.slice(8, 10)}/${r.ts.slice(5, 7)}`,
          value: r.level,
        }));
    } catch (e) { /* bảng chưa tồn tại ở lần chạy đầu */ }
    if (metrics.river) {
      // Ưu tiên chuỗi tự tích lũy; fallback chart VNDMS parse cũ
      if (riverHistory48h.length >= 3) metrics.river.history = riverHistory48h;
      metrics.river.history48h = riverHistory48h;
    }

    // 5. Tính xu hướng dâng từ river_history (cửa sổ ~6 giờ gần nhất)
    let riverTrend = null;
    if (riverHistory48h.length >= 2) {
      const last = riverHistory48h[riverHistory48h.length - 1];
      const firstIdx = Math.max(0, riverHistory48h.length - 5); // ~6h với chu kỳ 15p
      const first = riverHistory48h[firstIdx];
      const [h1, m1] = first.time.split(' ')[0].split(':').map(Number);
      const [h2, m2] = last.time.split(' ')[0].split(':').map(Number);
      let hoursSpan = (h2 + m2 / 60) - (h1 + m1 / 60);
      if (hoursSpan <= 0) hoursSpan = 0.25; // lấn ngày/chưa đủ điểm
      riverTrend = {
        risePerHour: (last.value - first.value) / hoursSpan,
        hoursSpan,
      };
    }

    // 6. Risk engine — tính trên server, UI chỉ render
    const reservoirs = Object.values(metrics)
      .filter(v => v && v.type === 'reservoir')
      .map(v => ({
        name: v.name,
        q_out: v.q_out,
        percentFull: v.max_capacity > 0 ? Math.round((v.volume_now / v.max_capacity) * 100) : 0,
      }));

    let upstreamList = [];
    try {
      upstreamList = JSON.parse(metrics.Du_Lieu_Thuong_Nguon?.history_json || '[]');
    } catch (e) { /* bỏ qua */ }

    metrics.risk = computeRisk({
      rainStations: metrics.rain_stations,
      upstreamList,
      forecast: metrics.forecast_rain,
      river: metrics.river
        ? { hasData: metrics.river.current !== undefined && metrics.river.current !== null,
            current: metrics.river.current,
            bd1: metrics.river.bd1, bd2: metrics.river.bd2, bd3: metrics.river.bd3 }
        : { hasData: false },
      riverTrend,
      reservoirs,
    });

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
