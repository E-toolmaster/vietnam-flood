import Database from 'better-sqlite3';
import path from 'path';
import { computeRisk, rainLabel } from '../risk-engine';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const KH_CODE = 'khanh-hoa';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const province = searchParams.get('province') || KH_CODE;

    const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), '../crawl/flood.db');
    const db = new Database(dbPath, { readonly: true });

    // 1. Tin tức (hiện chỉ Khánh Hòa có nguồn báo)
    const alerts = db
      .prepare('SELECT * FROM alerts WHERE province = ? ORDER BY id DESC LIMIT 20')
      .all(province);

    // 2. Metrics của tỉnh
    const metricsRows = db
      .prepare('SELECT * FROM metrics WHERE province = ?')
      .all(province);
    const metrics = {};

    metricsRows.forEach(row => {
      // 2.1. Trạm sông đại diện của tỉnh (type='river')
      if (row.type === 'river' && !metrics.river) {
        let historyChart = [];
        if (row.history_json) {
          try {
            const parsed = JSON.parse(row.history_json);
            if (parsed.water_levels && Array.isArray(parsed.water_levels)) {
              historyChart = parsed.water_levels.map(item => ({
                time: item.time, value: item.value,
              }));
            }
          } catch (e) { historyChart = []; }
        }

        metrics.river = {
          name: row.name,
          current: row.value,
          lat: row.lat ?? null,
          lon: row.lon ?? null,
          bd1: null, bd2: null, bd3: null, // ngưỡng riêng mỗi trạm — crawler sẽ ghi đè ở dưới
          history: historyChart,
          updated: row.updated_at,
          description: row.description,
          source_link: row.source_link,
          is_estimated: row.is_estimated,
          history_max: null,
          _row: row, // giữ tạm để lấy ngưỡng theo cấu hình crawler (nếu có trong description)
        };
      }

      // 2.2. Mưa thượng nguồn Khánh Hòa (giữ tên cũ)
      if (province === KH_CODE && (row.name === 'Mưa Thượng Nguồn (Max)' || row.name === 'Mưa Đầu Nguồn (Khánh Vĩnh)')) {
        const rain3dayStr = row.description || '0,0,0';
        metrics.rain = {
          current: row.value,
          rain_3day: rain3dayStr.split(',').map(v => parseFloat(v) || 0),
          updated: row.updated_at,
        };
      }

      // 2.3. Mưa toàn tỉnh (metric cũ, chỉ Khánh Hòa)
      if (province === KH_CODE && row.name === 'Mưa Toàn Tỉnh') {
        metrics.province_rain_legacy = { description: row.description, updated: row.updated_at };
      }

      // 2.4. Hồ chứa: trả key theo slug tên hồ (giống flow cũ)
      if (row.type === 'reservoir' && row.name && row.name.startsWith('Hồ ')) {
        const keyName = row.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/\s+/g, '_');
        metrics[keyName] = {
          name: row.name,
          type: row.type,
          current: row.value,
          updated: row.updated_at,
          news_time: row.news_time,
          source_link: row.source_link || null,
          q_in: row.q_in ?? null,
          q_out: row.q_out ?? null,
          level_now: row.level_now ?? null,
          volume_now: row.volume_now ?? null,
          max_capacity: row.max_capacity ?? 0,
          lat: row.lat ?? null,
          lon: row.lon ?? null,
          description: row.description || '',
        };
      }

      if (row.name === 'Du_Lieu_Thuong_Nguon') {
        metrics.Du_Lieu_Thuong_Nguon = { updated: row.updated_at, history_json: row.history_json };
      }

      // 2.5. Dự báo mưa 24h tới (Open-Meteo)
      if (row.name === 'Du_Bao_Mua_24h' && row.history_json) {
        try { metrics.forecast_rain = JSON.parse(row.history_json); } catch (e) { /* bỏ qua */ }
      }
    });

    // 3. Ngưỡng BĐ của trạm sông (crawler nhúng trong cấu hình — đọc từ registry)
    let provinceKind = 'river';
    try {
      const reg = db
        .prepare("SELECT history_json FROM metrics WHERE name='Danh_Sach_Tinh' AND province='__system__'")
        .get();
      const list = reg ? JSON.parse(reg.history_json) : [];
      const me = list.find(p => p.code === province);
      if (me) {
        provinceKind = me.kind || 'river';
        if (me.river && metrics.river) {
          metrics.river.bd1 = me.river.bd1 ?? null;
          metrics.river.bd2 = me.river.bd2 ?? null;
          metrics.river.bd3 = me.river.bd3 ?? null;
          metrics.river.history_max = me.river.history_max ?? null;
        }
      }
    } catch (e) { /* registry chưa có */ }
    if (metrics.river) delete metrics.river._row;
    metrics.province = { code: province, kind: provinceKind };

    // 4. Mưa tỉnh từ bảng province_rain (Vrain toàn quốc, 3 ngày)
    const rainDates = db
      .prepare('SELECT DISTINCT date FROM province_rain WHERE province = ? ORDER BY date DESC LIMIT 3')
      .all(province)
      .map(r => r.date)
      .reverse();
    let provinceRain = null;
    if (rainDates.length > 0) {
      const rows = db
        .prepare('SELECT * FROM province_rain WHERE province = ? AND date IN (' + rainDates.map(() => '?').join(',') + ') ORDER BY date')
        .all(province, ...rainDates);
      if (rows.length > 0) {
        const today = rows[rows.length - 1];
        provinceRain = {
          today: { max_mm: today.max_mm, station: today.station_name, level: today.level, as_of: today.as_of },
          rain3day: rows.map(r => r.max_mm || 0),
          daysPresent: rows.length,
        };
        metrics.province_rain = provinceRain;
      }
    }

    // 5. Trạm mưa chi tiết (deep pass Vrain)
    const today = new Date()
      .toLocaleString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 10);
    metrics.rain_stations = db
      .prepare('SELECT station_name, basin, location, mm, level, is_key FROM rain_stations WHERE date = ? AND province = ? ORDER BY mm DESC')
      .all(today, province);

    // 5.1 Ưu tiên max trạm hôm nay cho "Mưa lớn nhất tỉnh" — bảng tổng quan
    // trang chủ Vrain treo số cửa sổ cũ sau khi ngày thủy văn lấn 19h
    if (metrics.rain_stations.length > 0 && metrics.province_rain) {
      const sm = metrics.rain_stations[0];
      metrics.province_rain.today = {
        max_mm: sm.mm || 0,
        station: sm.station_name,
        level: sm.level || rainLabel(sm.mm || 0),
        as_of: metrics.province_rain.today?.as_of,
      };
    }

    // 6. Diễn biến mực nước 48h từ river_history
    let riverHistory48h = [];
    if (metrics.river) {
      try {
        riverHistory48h = db
          .prepare(
            `SELECT ts, level FROM river_history
             WHERE station = ? AND ts >= datetime('now', 'localtime', '-48 hours')
             ORDER BY ts`,
          )
          .all(metrics.river.name)
          .map(r => ({
            time: `${r.ts.slice(11, 16)} ${r.ts.slice(8, 10)}/${r.ts.slice(5, 7)}`,
            value: r.level,
          }));
        if (riverHistory48h.length >= 3) metrics.river.history = riverHistory48h;
        metrics.river.history48h = riverHistory48h;
      } catch (e) { /* bảng chưa tồn tại lần đầu */ }
    }

    // 7. Xu hướng dâng (~6 giờ gần nhất)
    let riverTrend = null;
    if (riverHistory48h.length >= 2) {
      const last = riverHistory48h[riverHistory48h.length - 1];
      const first = riverHistory48h[Math.max(0, riverHistory48h.length - 5)];
      const [h1, m1] = first.time.split(' ')[0].split(':').map(Number);
      const [h2, m2] = last.time.split(' ')[0].split(':').map(Number);
      let hoursSpan = (h2 + m2 / 60) - (h1 + m1 / 60);
      if (hoursSpan <= 0) hoursSpan = 0.25;
      riverTrend = { risePerHour: (last.value - first.value) / hoursSpan, hoursSpan };
    }

    // 8. Risk engine
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
        ? {
            hasData: metrics.river.current !== undefined && metrics.river.current !== null,
            current: metrics.river.current,
            bd1: metrics.river.bd1, bd2: metrics.river.bd2, bd3: metrics.river.bd3,
          }
        : null,
      riverTrend,
      reservoirs,
      provinceKind,
      provinceRain,
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
        },
      },
    );
  } catch (error) {
    console.error('API ERROR:', error);
    return Response.json({ error: 'Server Error' }, { status: 500 });
  }
}
