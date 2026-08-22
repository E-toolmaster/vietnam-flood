import Database from 'better-sqlite3';
import path from 'path';
import { rainLabel, provinceRainLevel } from '../risk-engine';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

// Tổng quan tất cả tỉnh: mưa hôm nay + cấp độ nhanh (cho selector/bảng tổng quan)
export async function GET() {
  try {
    const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), '../crawl/flood.db');
    const db = new Database(dbPath, { readonly: true });

    // registry tỉnh
    let registry = [];
    try {
      const reg = db
        .prepare("SELECT history_json FROM metrics WHERE name='Danh_Sach_Tinh' AND province='__system__'")
        .get();
      if (reg) registry = JSON.parse(reg.history_json);
    } catch (e) { /* chưa có */ }

    const today = new Date()
      .toLocaleString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 10);

    // mưa hôm nay + 3 ngày mỗi tỉnh
    const rainRows = db
      .prepare(
        `SELECT province, date, max_mm, station_name, level, as_of FROM province_rain
         WHERE date >= date(?, '-2 day') ORDER BY date`,
      )
      .all(today);

    const byProv = {};
    for (const r of rainRows) {
      if (!byProv[r.province]) byProv[r.province] = { days: [] };
      byProv[r.province].days.push(r);
    }

    // dự báo 24h mỗi tỉnh
    const forecastRows = db
      .prepare("SELECT province, value, history_json FROM metrics WHERE name='Du_Bao_Mua_24h'")
      .all();
    const forecastByProv = {};
    for (const r of forecastRows) {
      if (!r.province || r.province === '__system__') continue;
      let point = null;
      try { point = JSON.parse(r.history_json || '{}').point_name; } catch (e) {}
      forecastByProv[r.province] = { max_mm: r.value, point_name: point };
    }

    const provinces = registry.map(p => {
      const rain = byProv[p.code];
      const todayRow = rain?.days?.find(d => d.date === today);
      const d3 = (rain?.days || []).reduce((a, b) => a + (b.max_mm || 0), 0);
      const mm = todayRow?.max_mm || 0;
      const f = forecastByProv[p.code];
      return {
        code: p.code,
        name: p.name,
        kind: p.kind,
        has_river: !!p.river,
        rain_mm: mm,
        rain_station: todayRow?.station_name || null,
        rain_level_label: rainLabel(mm),
        rain_as_of: todayRow?.as_of || null,
        rain_3day: Math.round(d3 * 10) / 10,
        quick_level: provinceRainLevel(mm, d3),
        forecast_mm: f?.max_mm ?? null,
        forecast_point: f?.point_name || null,
      };
    });

    db.close();
    return Response.json(
      { provinces },
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
    console.error('PROVINCES API ERROR:', error);
    return Response.json({ error: 'Server Error' }, { status: 500 });
  }
}
