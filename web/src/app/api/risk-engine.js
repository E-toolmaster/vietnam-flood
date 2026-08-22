// === RISK ENGINE — tính toán đánh giá rủi ro phía server, UI chỉ render ===
//
// Ngưỡng tham chiếu:
// - Phân loại mưa theo thuật ngữ bản tin KTTV (mm/24h): vừa 16–50, to 51–100,
//   rất to >100, cực to >250 (kttvtrungbo.vn / baochinhphu.vn).
// - Cấp độ rủi ro thiên tai do mưa lớn: Điều 44 QĐ 18/2021/QĐ-TTg
//   (mm/24h): 100–200 = cấp 1, 200–300 = cấp 2, >300 = cấp 3.
// - Ngưỡng "cảnh báo địa phương": mưa trong tỉnh ≥50mm/24h hoặc mưa đầu nguồn
//   ≥50mm/24h đã có nguy cơ ngập đô thị / lũ hạ du (kinh nghiệm vùng trũng ven sông,
//   NHẸ HƠN ngưỡng quốc gia). Không gắn tên tỉnh — dùng chung mọi tỉnh.

const REF_KTTV = 'Phân loại mưa KTTV (mm/24h)';
const REF_QD18 = 'Điều 44 QĐ 18/2021/QĐ-TTg';
// Ngưỡng thực nghiệm cho vùng trũng/ven sông — dùng chung mọi tỉnh, không gắn tên tỉnh
const REF_LOCAL = 'Khuyến nghị thực nghiệm địa phương (vùng trũng ven sông, ≥50mm/24h)';

// Phân loại theo tổng mm/24h (dùng cho badge + cảnh báo quan trắc)
export function rainLabel(mm) {
  if (mm >= 250) return 'Mưa cực to';
  if (mm > 100) return 'Mưa rất to';
  if (mm > 50) return 'Mưa to';
  if (mm >= 16) return 'Mưa vừa';
  if (mm > 0) return 'Mưa nhỏ';
  return 'Không mưa';
}

// Cấp độ rủi ro thiên tai do mưa lớn theo Điều 44 QĐ 18/2021 (mm/24h)
function nationalRiskCap(mm24) {
  if (mm24 > 300) return 3;
  if (mm24 > 200) return 2;
  if (mm24 >= 100) return 1;
  return 0;
}

// Cấp độ mưa nhanh cho bảng tổng quan toàn quốc (dùng ở /api/provinces)
export function provinceRainLevel(mm, d3 = 0) {
  if (!(mm >= 50)) return 0;
  let level = mm >= 180 ? 3 : mm >= 100 ? 2 : 1;
  if (d3 >= 250 && level < 3) level += 1;
  return level;
}

/**
 * @param {Object} input
 * @param {Array}  input.rainStations   rows rain_stations hôm nay (mm, level, is_key, station_name)
 * @param {Array}  input.upstreamList   Du_Lieu_Thuong_Nguon.history_json (today, total_3day, days_present)
 * @param {Object} input.forecast       Du_Bao_Mua_24h payload {max_mm, point_name, points}
 * @param {Object} input.river          {current, bd1, bd2, bd3, hasData}
 * @param {Object} input.riverTrend     {risePerHour, hoursSpan} từ river_history
 * @param {Array}  input.reservoirs     [{name, q_out, percentFull}]
 * @param {string} input.provinceKind   'river' | 'mountain'
 * @param {Object} input.provinceRain   {today:{max_mm,station,level,as_of}, rain3day:[..], daysPresent}
 * @returns {{level: number, factors: Array, computedAt: string}}
 */
export function computeRisk({ rainStations = [], upstreamList = [], forecast = null, river = null, riverTrend = null, reservoirs = [], provinceKind = 'river', provinceRain = null }) {
  const factors = [];

  // --- 0. MƯA LỚN VÙNG NỎI: lũ quét / sạt lở (khuyến cáo KTTV + Điều 44 QĐ 18/2021) ---
  if (provinceKind === 'mountain' && provinceRain?.today) {
    const mm = provinceRain.today.max_mm || 0;
    const d3 = (provinceRain.rain3day || []).reduce((a, b) => a + (b || 0), 0);
    if (mm >= 50) {
      const label = rainLabel(mm);
      const national = nationalRiskCap(mm);
      let level = mm >= 180 ? 3 : mm >= 100 ? 2 : 1;
      if (d3 >= 250 && level < 3) level += 1; // đất đã bão hòa sau mưa nhiều ngày
      factors.push({
        type: 'flash_flood_landslide', source: 'observed', level,
        title: `${label} vùng núi: ${mm.toFixed(0)}mm/24h tại ${provinceRain.today.station}`,
        desc: mm >= 100
          ? `Mưa vượt 100mm/24h — theo khuyến cáo KTTV, vùng núi có nguy cơ LŨ QUÉT và SÁT LỞ ĐẤT cao. `
            + `Tích lũy 3 ngày ~${d3.toFixed(0)}mm${d3 >= 250 ? ' (đất bão hòa, nguy cơ tăng)' : ''}. `
            + `Tránh vùng suối, sườn dốc, đường đèo; sẵn sàng sơ tán khi có dấu hiệu.`
          : `Mưa đầu ngày vượt 50mm/24t — cần theo dõi suối nhỏ, khe mương và sườn núi dễ sạt lở. Tích lũy 3 ngày ~${d3.toFixed(0)}mm.`,
        locations: 'Vùng núi, suối, đèo trong tỉnh',
        thresholds_ref: `Khuyến cáo KTTV vùng núi (≥100mm/24h nguy cơ lũ quét, sạt lở); ${REF_QD18}${national ? ` (cấp ${national})` : ''}`,
      });
    }
  }

  // --- 1. MƯA QUAN TRẮC TẠI TP (từ 00h hôm nay) — không chạy cho tỉnh núi
  //     (miền núi đã có factor lũ quét/sạt lở riêng ở trên, tránh lặp) ---
  const cityStations = provinceKind === 'mountain'
    ? []
    : rainStations.filter(s => !s.is_key && s.mm >= 50);
  if (cityStations.length > 0) {
    const maxCity = Math.max(...cityStations.map(s => s.mm));
    const label = rainLabel(maxCity);
    const national = nationalRiskCap(maxCity);
    const level = national > 0 ? Math.max(2, national) : 2; // ≥50mm = ngập cục bộ đô thị tối thiểu mức 2
    factors.push({
      type: 'city_rain', source: 'observed', level,
      title: `${label} ghi nhận tại các trạm trong tỉnh (${maxCity.toFixed(0)}mm/24h)`,
      desc: maxCity > 100
        ? `Tổng mưa vượt 100mm/24h — theo ${REF_KTTV} là mưa rất to. Nguy cơ ngập sâu các tuyến trũng, hạn chế di chuyển vùng trũng/ven suối.`
        : `Tổng mưa vượt 50mm/24h — đủ gây ngập úng cục bộ theo ngưỡng thực nghiệm địa phương.`,
      stations: cityStations.map(s => s.station_name),
      thresholds_ref: `${REF_KTTV}; ${REF_LOCAL}`,
    });
  }

  // --- 2. MƯA QUAN TRẮC THƯỢNG NGUỒN (hôm nay + tích lũy 3 ngày) ---
  const withData = upstreamList.filter(s => (s.days_present ?? 3) >= 2);
  const maxUp = withData.length > 0 ? Math.max(...withData.map(s => s.today)) : 0;
  const max3day = withData.length > 0 ? Math.max(...withData.map(s => s.total_3day || 0)) : 0;
  if (maxUp >= 50) {
    const st = withData.find(s => s.today === maxUp);
    const national = nationalRiskCap(maxUp);
    const level = maxUp >= 100 ? 3 : 2;
    factors.push({
      type: 'upstream_rain', source: 'observed', level,
      title: maxUp >= 100 ? `Mưa rất to đầu nguồn (${st?.name}: ${maxUp.toFixed(0)}mm)` : `Mưa lớn đầu nguồn (${st?.name}: ${maxUp.toFixed(0)}mm)`,
      desc: `Mưa thượng nguồn lưu vực sông chính của tỉnh. Tích lũy 3 ngày tại trạm nặng nhất ~${max3day.toFixed(0)}mm. `
          + (maxUp >= 100
              ? `Vượt ngưỡng ${REF_QD18} cấp ${national || 1} — nước về hạ du gây ngập vùng ven sông sau vài giờ.`
              : `Theo ${REF_LOCAL}, mưa đầu nguồn ≥50mm/24h cần theo dõi mực nước sông chặt (lũ về hạ du trễ vài giờ).`),
      locations: 'Vùng ven sông, hạ du thượng nguồn',
      thresholds_ref: `${REF_KTTV}; ${REF_QD18}; ${REF_LOCAL} ≥50mm/24h`,
    });
  }

  // --- 3. DỰ BÁO MƯA 24H TỚI (Open-Meteo, mô hình — không phải cảnh báo chính thức) ---
  if (forecast && forecast.max_mm >= 50) {
    const cap = nationalRiskCap(forecast.max_mm);
    const level = cap > 0 ? cap : 1;
    factors.push({
      type: 'rain_forecast', source: 'forecast', level,
      title: `Dự báo mưa 24h tới: tới ${forecast.max_mm.toFixed(0)}mm (${forecast.point_name})`,
      desc: `Mô hình Open-Meteo cho thấy lượng mưa 24h tới tối đa ~${forecast.max_mm.toFixed(0)}mm tại ${forecast.point_name}. `
          + (cap > 0 ? `Vượt ngưỡng cảnh báo mưa lớn ${REF_QD18} (cấp ${cap}). ` : '')
          + `Đây là dự báo mô hình — hãy chờ bản tin cảnh báo chính thức của KTTV.`,
      locations: 'Khu vực dự báo điểm (thượng nguồn / TP)',
      thresholds_ref: REF_QD18,
    });
  }

  // --- 4. MỰC NƯỚC SÔNG (quan trắc + xu hướng dâng) ---
  if (river && river.hasData && typeof river.current === 'number') {
    const { current } = river;
    const bd1 = river.bd1 ?? null, bd2 = river.bd2 ?? null, bd3 = river.bd3 ?? null;
    // Chỉ đánh giá theo ngưỡng BĐ khi trạm có đủ BĐ1-3 (trạm không có ngưỡng
    // công khai thì tuyệt đối không so với 0 — từng gây cảnh báo giả)
    if (bd3 != null && bd2 != null && bd1 != null) {
      if (current >= bd3) {
        factors.push({
          type: 'river_flood_3', source: 'observed', level: 3,
          title: `Lũ khẩn cấp — mực nước trên BĐ3 (${current.toFixed(2)}m)`,
          desc: `Mực nước tại trạm ${current.toFixed(2)}m, trên báo động 3 (${bd3}m). Ngập lụt nghiêm trọng diện rộng vùng ven sông.`,
          locations: 'Vùng ven sông',
          thresholds_ref: `Ngưỡng báo động trạm quan trắc (BĐ3 = ${bd3}m)`,
        });
      } else if (current >= bd2) {
        factors.push({
          type: 'river_flood_2', source: 'observed', level: 2,
          title: `Lũ báo động 2 (${current.toFixed(2)}m)`,
          desc: `Mực nước tại trạm ${current.toFixed(2)}m, đạt báo động 2 (${bd2}m). Ngập lụt vùng ven sông, cần sẵn sàng di chuyển.`,
          locations: 'Vùng ven sông',
          thresholds_ref: `Ngưỡng báo động trạm quan trắc (BĐ2 = ${bd2}m)`,
        });
      } else if (current >= bd1) {
        factors.push({
          type: 'river_flood_1', source: 'observed', level: 1,
          title: `Mực nước đạt báo động 1 (${current.toFixed(2)}m)`,
          desc: `Mực nước tại trạm ${current.toFixed(2)}m, đạt báo động 1 (${bd1}m). Theo dõi sát diễn biến, vùng trũng ven sông cần chú ý.`,
          locations: 'Vùng trũng ven sông',
          thresholds_ref: `Ngưỡng báo động trạm quan trắc (BĐ1 = ${bd1}m)`,
        });
      }
    }

    // Xu hướng dâng nhanh (từ river_history tự tích lũy)
    if (riverTrend && riverTrend.risePerHour >= 0.05 && maxUp >= 25) {
      factors.push({
        type: 'river_rising', source: 'observed', level: riverTrend.risePerHour >= 0.15 ? 3 : 2,
        title: `Sông Cái đang dâng nhanh (+${riverTrend.risePerHour.toFixed(2)}m/giờ)`,
        desc: `Trong ${riverTrend.hoursSpan.toFixed(0)} giờ qua mực nước dâng liên tục kết hợp mưa đầu nguồn ≥25mm — nguy cơ lũ về hạ du trong vài giờ tới (ước tính heuristics, mang tính tham khảo).`,
        locations: 'Vùng ven sông, hạ du',
        thresholds_ref: 'Xu hướng quan trắc (≥0.05m/h + mưa đầu nguồn)',
      });
    }
  } else if (river && !river.hasData) {
    factors.push({
      type: 'no_data', source: 'observed', level: 2,
      title: 'Không có dữ liệu mực nước',
      desc: 'Không lấy được số đo trạm Đồng Trăng (VNDMS). Đánh giá "an toàn" không đáng tin — hãy kiểm tra nguồn chính thống.',
      locations: '',
      thresholds_ref: '',
    });
  }

  // --- 5. HỒ CHỨA (xả lũ + mức nước) ---
  for (const r of reservoirs) {
    if (r.q_out && r.q_out > 50) {
      factors.push({
        type: 'reservoir_discharge', source: 'observed', level: 3,
        title: `${r.name} xả lũ lớn (${r.q_out} m³/s)`,
        desc: `Hồ đang xả trên 50 m³/s — nguy cơ ngập vùng trũng ven sông ngay hạ du hồ.`,
        locations: 'Vùng trũng hạ du hồ',
        thresholds_ref: 'Ngưỡng theo dõi vận hành hồ chứa (>50 m³/s)',
      });
    } else if (r.percentFull >= 90) {
      factors.push({
        type: 'reservoir_full', source: 'observed', level: 2,
        title: `${r.name} gần đầy (${r.percentFull}%)`,
        desc: `Hồ đạt ${r.percentFull}% dung tích — nếu mưa tiếp diễn hồ có thể phải xả lũ bổ sung, ảnh hưởng hạ du.`,
        locations: 'Vùng hạ du hồ',
        thresholds_ref: 'Mực 90% dung tích',
      });
    }
  }

  const level = factors.reduce((m, f) => Math.max(m, f.level), 0);
  return { level, factors };
}
