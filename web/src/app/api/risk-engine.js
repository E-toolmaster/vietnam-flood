// === RISK ENGINE — tính toán đánh giá rủi ro phía server, UI chỉ render ===
//
// Ngưỡng tham chiếu:
// - Phân loại mưa theo thuật ngữ bản tin KTTV (mm/24h): vừa 16–50, to 51–100,
//   rất to >100, cực to >250 (kttvtrungbo.vn / baochinhphu.vn).
// - Cấp độ rủi ro thiên tai do mưa lớn: Điều 44 QĐ 18/2021/QĐ-TTg
//   (mm/24h): 100–200 = cấp 1, 200–300 = cấp 2, >300 = cấp 3.
// - Ngưỡng "cảnh báo địa phương" Nha Trang: mưa TP ≥50mm/24h hoặc mưa đầu nguồn
//   ≥50mm/24h đã có nguy cơ ngập đô thị / lũ hạ du (kinh nghiệm địa phương,
//   NHẸ HƠN ngưỡng quốc gia vì địa hình trũng ven sông Cái).

const REF_KTTV = 'Phân loại mưa KTTV (mm/24h)';
const REF_QD18 = 'Điều 44 QĐ 18/2021/QĐ-TTg';
const REF_LOCAL = 'Khuyến nghị địa phương Nha Trang';

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

/**
 * @param {Object} input
 * @param {Array}  input.rainStations   rows rain_stations hôm nay (mm, level, is_key, station_name)
 * @param {Array}  input.upstreamList   Du_Lieu_Thuong_Nguon.history_json (today, total_3day, days_present)
 * @param {Object} input.forecast       Du_Bao_Mua_24h payload {max_mm, point_name, points}
 * @param {Object} input.river          {current, bd1, bd2, bd3, hasData}
 * @param {Object} input.riverTrend     {risePerHour, hoursSpan} từ river_history
 * @param {Array}  input.reservoirs     [{name, q_out, percentFull}]
 * @returns {{level: number, factors: Array, computedAt: string}}
 */
export function computeRisk({ rainStations = [], upstreamList = [], forecast = null, river = null, riverTrend = null, reservoirs = [] }) {
  const factors = [];

  // --- 1. MƯA QUAN TRẮC TẠI TP (từ 00h hôm nay) ---
  const cityStations = rainStations.filter(s => !s.is_key && s.mm >= 50);
  if (cityStations.length > 0) {
    const maxCity = Math.max(...cityStations.map(s => s.mm));
    const label = rainLabel(maxCity);
    const national = nationalRiskCap(maxCity);
    const level = national > 0 ? Math.max(2, national) : 2; // ≥50mm = ngập cục bộ đô thị tối thiểu mức 2
    factors.push({
      type: 'city_rain', source: 'observed', level,
      title: `${label} tại khu vực TP (${maxCity.toFixed(0)}mm từ 00h)`,
      desc: maxCity > 100
        ? `Tổng mưa ngày đã vượt 100mm — theo ${REF_KTTV} là mưa rất to. Nguy cơ ngập sâu các tuyến trũng, nên tránh di chuyển vùng ven sông.`
        : `Tổng mưa ngày vượt 50mm — đủ gây ngập úng cục bộ đô thị theo ${REF_LOCAL}.`,
      stations: cityStations.map(s => s.station_name),
      thresholds_ref: `${REF_KTTV}; ${REF_LOCAL} ≥50mm/24h`,
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
      desc: `Mưa thượng nguồn lưu vực sông Cái từ 00h. Tích lũy 3 ngày tại trạm nặng nhất ~${max3day.toFixed(0)}mm. `
          + (maxUp >= 100
              ? `Vượt ngưỡng ${REF_QD18} cấp ${national || 1} — nước về hạ du gây ngập vùng ven sông sau vài giờ.`
              : `Theo ${REF_LOCAL}, mưa đầu nguồn ≥50mm/24h cần theo dõi mực nước sông Cái chặt (lũ về hạ du trễ vài giờ).`),
      locations: 'Tây Nha Trang, H. Diên Khánh, H. Khánh Vĩnh',
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

  // --- 4. MỰC NƯỚC SÔNG CÁI (quan trắc + xu hướng dâng) ---
  if (river && river.hasData && typeof river.current === 'number') {
    const { current, bd1 = 8.0, bd2 = 9.5, bd3 = 10.5 } = river;
    if (current >= bd3) {
      factors.push({
        type: 'river_flood_3', source: 'observed', level: 3,
        title: `Lũ khẩn cấp — mực nước trên BĐ3 (${current.toFixed(2)}m)`,
        desc: `Mực nước sông Cái tại Đồng Trăng ${current.toFixed(2)}m, trên báo động 3 (${bd3}m). Ngập lụt nghiêm trọng diện rộng vùng ven sông.`,
        locations: 'Tây Nha Trang, H. Diên Khánh',
        thresholds_ref: `Ngưỡng báo động trạm Đồng Trăng (BĐ3 = ${bd3}m)`,
      });
    } else if (current >= bd2) {
      factors.push({
        type: 'river_flood_2', source: 'observed', level: 2,
        title: `Lũ báo động 2 (${current.toFixed(2)}m)`,
        desc: `Mực nước sông Cái ${current.toFixed(2)}m, đạt báo động 2 (${bd2}m). Ngập lụt vùng ven sông, cần sẵn sàng di chuyển.`,
        locations: 'Tây Nha Trang (Vĩnh Ngọc, Vĩnh Thạnh), H. Diên Khánh',
        thresholds_ref: `Ngưỡng báo động trạm Đồng Trăng (BĐ2 = ${bd2}m)`,
      });
    } else if (current >= bd1) {
      factors.push({
        type: 'river_flood_1', source: 'observed', level: 1,
        title: `Mực nước đạt báo động 1 (${current.toFixed(2)}m)`,
        desc: `Mực nước sông Cái ${current.toFixed(2)}m, đạt báo động 1 (${bd1}m). Theo dõi sát diễn biến, vùng trũng ven sông cần chú ý.`,
        locations: 'Vùng trũng ven sông Cái',
        thresholds_ref: `Ngưỡng báo động trạm Đồng Trăng (BĐ1 = ${bd1}m)`,
      });
    }

    // Xu hướng dâng nhanh (từ river_history tự tích lũy)
    if (riverTrend && riverTrend.risePerHour >= 0.05 && maxUp >= 25) {
      factors.push({
        type: 'river_rising', source: 'observed', level: riverTrend.risePerHour >= 0.15 ? 3 : 2,
        title: `Sông Cái đang dâng nhanh (+${riverTrend.risePerHour.toFixed(2)}m/giờ)`,
        desc: `Trong ${riverTrend.hoursSpan.toFixed(0)} giờ qua mực nước dâng liên tục kết hợp mưa đầu nguồn ≥25mm — nguy cơ lũ về hạ du trong vài giờ tới (ước tính heuristics, mang tính tham khảo).`,
        locations: 'Tây Nha Trang, H. Diên Khánh',
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
        desc: `Hồ đang xả trên 50 m³/s — nguy cơ ngập vùng trũng ven sông Cái hạ du.`,
        locations: 'H. Diên Khánh, Tây Nha Trang',
        thresholds_ref: 'Ngưỡng theo dõi vận hành hồ chứa (>50 m³/s)',
      });
    } else if (r.percentFull >= 90) {
      factors.push({
        type: 'reservoir_full', source: 'observed', level: 2,
        title: `${r.name} gần đầy (${r.percentFull}%)`,
        desc: `Hồ đạt ${r.percentFull}% dung tích — nếu mưa tiếp diễn hồ có thể phải xả lũ bổ sung, ảnh hưởng hạ du.`,
        locations: 'Ven sông Cái',
        thresholds_ref: 'Mực 90% dung tích',
      });
    }
  }

  const level = factors.reduce((m, f) => Math.max(m, f.level), 0);
  return { level, factors };
}
