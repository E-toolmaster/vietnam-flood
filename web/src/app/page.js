"use client";
import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid
} from 'recharts';
import {
  Droplets, CloudRain, AlertTriangle, Menu, X, CheckCircle,
  ExternalLink, Waves, ShieldAlert, MapPin, Clock, Activity, FileText
} from 'lucide-react';

// === CẤU HÌNH LOGIC DỰ BÁO ===

// MAP ĐỊA GIỚI HÀNH CHÍNH CHUẨN (Quy hoạch mới TP. Nha Trang + Vùng lân cận)
const ZONE_MAP = {
  // --- TP. NHA TRANG (4 Phường lớn sau sáp nhập) ---
  
  // 1. TÂY NHA TRANG (Vùng ven sông Cái - Rủi ro ngập cao nhất)
  // Gồm: Ngọc Hiệp, Phương Sài + xã Vĩnh Ngọc, Vĩnh Thạnh, Vĩnh Hiệp, Vĩnh Trung
  'Vĩnh Ngọc': 'Tây Nha Trang',
  'Vĩnh Thạnh': 'Tây Nha Trang',
  'Vĩnh Hiệp': 'Tây Nha Trang',
  'Vĩnh Trung': 'Tây Nha Trang',
  'Ngọc Hiệp': 'Tây Nha Trang',
  'Phương Sài': 'Tây Nha Trang',

  // 2. BẮC NHA TRANG (Vùng phía Bắc)
  // Gồm: Vĩnh Hòa, Vĩnh Hải, Vĩnh Phước, Vĩnh Thọ + xã Vĩnh Lương, Vĩnh Phương
  'Vĩnh Lương': 'Bắc Nha Trang',
  'Vĩnh Phương': 'Bắc Nha Trang',
  'Vĩnh Hòa': 'Bắc Nha Trang',
  'Vĩnh Hải': 'Bắc Nha Trang',
  'Vĩnh Phước': 'Bắc Nha Trang',
  'Vĩnh Thọ': 'Bắc Nha Trang',

  // 3. NAM NHA TRANG (Vùng phía Nam - Cửa sông & Vùng trũng)
  // Gồm: Phước Hải, Phước Long, Vĩnh Trường + xã Phước Đồng, Vĩnh Thái
  'Phước Đồng': 'Nam Nha Trang',
  'Vĩnh Thái': 'Nam Nha Trang',
  'Phước Long': 'Nam Nha Trang',
  'Vĩnh Trường': 'Nam Nha Trang',
  'Phước Hải': 'Nam Nha Trang',

  // 4. TRUNG TÂM NHA TRANG (Phường Nha Trang mới)
  // Gồm: Vạn Thạnh, Lộc Thọ, Vĩnh Nguyên, Tân Tiến, Phước Hòa
  'Lộc Thọ': 'Trung Tâm Nha Trang',
  'Vạn Thạnh': 'Trung Tâm Nha Trang',
  'Tân Tiến': 'Trung Tâm Nha Trang',
  'Phước Hòa': 'Trung Tâm Nha Trang',
  'Vĩnh Nguyên': 'Trung Tâm Nha Trang',

  // --- HUYỆN DIÊN KHÁNH (Vùng tiếp giáp phía Tây - Thượng nguồn sông Cái) ---
  'Diên Khánh': 'H. Diên Khánh', // Thị trấn
  'Diên An': 'H. Diên Khánh',
  'Diên Toàn': 'H. Diên Khánh',
  'Diên Thạnh': 'H. Diên Khánh',
  'Diên Lạc': 'H. Diên Khánh',
  'Diên Phú': 'H. Diên Khánh',
  'Diên Điền': 'H. Diên Khánh', // Hay ngập
  'Diên Sơn': 'H. Diên Khánh',  // Hay ngập
  'Suối Hiệp': 'H. Diên Khánh',

  // --- HUYỆN KHÁNH VĨNH (Vùng núi - Đầu nguồn lũ) ---
  'Khánh Vĩnh': 'H. Khánh Vĩnh',
  'Khánh Hiệp': 'H. Khánh Vĩnh',
  'Khánh Đông': 'H. Khánh Vĩnh',
  'Giang Ly': 'H. Khánh Vĩnh',
  'Sông Cầu': 'H. Khánh Vĩnh',
};

// Hàm helper để gom nhóm địa điểm
const groupLocations = (stationNames) => {
  if (!stationNames || stationNames.length === 0) return '';
  
  let zones = new Set();
  let unknown = [];

  stationNames.forEach(name => {
    let found = false;
    for (const [key, zone] of Object.entries(ZONE_MAP)) {
      if (name.includes(key)) {
        zones.add(zone);
        found = true;
        break;
      }
    }
    if (!found) unknown.push(name);
  });

  const zoneList = Array.from(zones);
  
  if (zoneList.length > 0) {
    return zoneList.join(', ') + (unknown.length > 0 ? `, ${unknown.slice(0,2).join(', ')}...` : '');
  }
  
  return unknown.slice(0, 3).join(', ');
};

export default function FloodMonitor() {
  const [monitorData, setMonitorData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const t = new Date().getTime(); 
        const res = await fetch(`/api/alerts?t=${t}`, {
            cache: 'no-store',
            next: { revalidate: 0 }
        });
        
        if (!res.ok) throw new Error('Network response was not ok');
        
        const json = await res.json();
        setMonitorData(json.metrics);
        setAlerts(json.data || []);
        setLoading(false);
        setCurrentTime(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        console.error("Error fetching flood data:", error);
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 900000); // 15 phút, khớp chu kỳ crawler
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    }, 60000);
    return () => { clearInterval(interval); clearInterval(timer); };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <p className="animate-pulse">Đang kết nối vệ tinh & trạm đo...</p>
        </div>
      </div>
    );
  }

  // --- HELPERS & LOGIC ---
  const hasRiverData = monitorData?.river?.current !== undefined && monitorData?.river?.current !== null;
  const riverLevel = hasRiverData ? monitorData.river.current : 0;
  const isEstimated = monitorData?.river?.is_estimated === 1;

  // Ngưỡng báo động lấy từ API (single source of truth, crawler là nơi định nghĩa)
  const BD1 = monitorData?.river?.bd1 ?? 8.0;
  const BD2 = monitorData?.river?.bd2 ?? 9.5;
  const BD3 = monitorData?.river?.bd3 ?? 10.5;
  const RIVER_SCALE_MAX = 12.95; // Đỉnh lũ 2025

  // Phát hiện dữ liệu cũ: updated có dạng "HH:MM DD/MM" — nếu không phải hôm nay thì đang stale
  const riverUpdated = monitorData?.river?.updated || '';
  const isRiverStale = (() => {
    const m = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})$/.exec(riverUpdated.trim());
    if (!m) return false;
    const now = new Date();
    return +m[3] !== now.getDate() || +m[4] !== now.getMonth() + 1;
  })();

  // XỬ LÝ DỮ LIỆU MƯA THƯỢNG NGUỒN (Lấy từ description hoặc history_json)
  const rainStationList = monitorData?.rain_stations || [];

  const rainDesc = monitorData?.rain?.rain_3day || [0, 0, 0];
  const rainToday = rainDesc[2] || 0; 
  const rain3daySum = rainDesc.reduce((a, b) => a + b, 0);

  // Tạo data cho biểu đồ cột
  const chartData = [
    { name: 'Hôm kia', value: rainDesc[0] || 0 },
    { name: 'Hôm qua', value: rainDesc[1] || 0 },
    { name: 'Hôm nay', value: rainToday }
  ];

  const riverDescription = monitorData?.river?.description || '';
  const riverHistory = monitorData?.river?.history || [];

  // Xác định trạng thái nguy hiểm
  let dangerLevel = 0;
  if (riverLevel >= BD3) dangerLevel = 3;
  else if (riverLevel >= BD2) dangerLevel = 2;
  else if (riverLevel >= BD1) dangerLevel = 1;

  // Theme màu theo trạng thái
  const theme = {
    bg: dangerLevel === 3 ? 'bg-red-600' : dangerLevel === 2 ? 'bg-orange-500' : 'bg-blue-600',
    heroGradient: dangerLevel === 3 
      ? 'from-red-600 via-red-500 to-red-700' 
      : dangerLevel === 2 
        ? 'from-orange-500 via-orange-400 to-orange-600' 
        : 'from-blue-600 via-blue-500 to-blue-700',
  };

  // --- SMART FORECAST LOGIC (UPDATED) ---
  const analyzeRisk = () => {
    let risks = [];
    let riskLevel = 0; // 0: An toàn, 1: Chú ý, 2: Cảnh báo, 3: Nguy hiểm

    // 1. Check mưa cục bộ (Ngập lụt đô thị)
    const heavyRainStations = rainStationList.filter(s => s.mm >= 50);
    const moderateRainStations = rainStationList.filter(s => s.mm >= 25 && s.mm < 50);

    if (heavyRainStations.length > 0) {
      const affectedZones = groupLocations(heavyRainStations.map(s => s.station_name));
      risks.push({
        type: 'local_flood',
        level: 'high',
        title: 'Ngập úng cục bộ',
        desc: `Mưa rất to (>50mm). Nguy cơ ngập sâu các tuyến đường thấp trũng.`,
        locations: affectedZones // VD: Nam Nha Trang, H. Diên Khánh
      });
      riskLevel = Math.max(riskLevel, 2);
    } 
    else if (moderateRainStations.length > 3) {
      const affectedZones = groupLocations(moderateRainStations.map(s => s.station_name));
      risks.push({
        type: 'rain_wide',
        level: 'medium',
        title: 'Mưa diện rộng',
        desc: 'Mưa rải rác nhiều nơi. Đường trơn trượt, hạn chế tầm nhìn.',
        locations: affectedZones
      });
      riskLevel = Math.max(riskLevel, 1);
    }

    // 2. Check Mưa Thượng Nguồn -> Cảnh báo Lũ về Hạ Du (Tây Nha Trang)
    let upstreamStations = [];
    try { upstreamStations = JSON.parse(monitorData?.Du_Lieu_Thuong_Nguon?.history_json || '[]'); } catch(e){}
    
    // Tính max mưa hôm nay ở đầu nguồn
    const maxUpstreamToday = Math.max(...upstreamStations.map(s => s.today), 0);

    if (maxUpstreamToday > 100) {
      risks.push({
        type: 'flash_flood',
        level: 'high',
        title: 'Cảnh báo lũ về hạ du',
        desc: `Mưa thượng nguồn rất lớn (${maxUpstreamToday.toFixed(0)}mm). Nước sông Cái sẽ lên nhanh, gây ngập vùng ven sông.`,
        locations: 'Tây Nha Trang, H. Diên Khánh' 
      });
      riskLevel = Math.max(riskLevel, 3);
    } else if (maxUpstreamToday > 50) {
       risks.push({
        type: 'flash_flood_warn',
        level: 'medium',
        title: 'Mưa lớn đầu nguồn',
        desc: `Đầu nguồn đang mưa to. Cần theo dõi sát mực nước sông Cái.`,
        locations: 'Tây Nha Trang'
      });
      riskLevel = Math.max(riskLevel, 2);
    }

    // 3. Check Hồ xả lũ
    const reservoirs = Object.values(monitorData).filter(v => v.type === 'reservoir');
    const discharging = reservoirs.filter(r => r.q_out > 50); 
    if (discharging.length > 0) {
       risks.push({
        type: 'discharge',
        level: 'high',
        title: 'Hồ chứa xả lũ lớn',
        desc: `${discharging.length} hồ xả >50m³/s. Nguy cơ ngập vùng trũng ven sông Cái.`,
        locations: 'H. Diên Khánh, Tây Nha Trang'
      });
      riskLevel = Math.max(riskLevel, 3);
    }

    // 4. Check Lũ Sông Cái thực tế
    if (!hasRiverData) {
      risks.push({
        type: 'no_data', level: 'high', title: 'Không có dữ liệu mực nước',
        desc: 'Không lấy được số đo trạm Đồng Trăng. Hiện trạng "an toàn" ở trên không đáng tin — hãy kiểm tra nguồn chính thống.',
        locations: ''
      });
      riskLevel = Math.max(riskLevel, 2);
    } else if (riverLevel >= BD3) { // BĐ3
       risks.push({
        type: 'river_flood_3', level: 'high', title: 'Lũ khẩn cấp (Trên BĐ3)',
        desc: `Nước sông rất cao (${riverLevel.toFixed(2)}m). Ngập lụt nghiêm trọng diện rộng.`,
        locations: 'Tây Nha Trang, H. Diên Khánh'
      });
      riskLevel = 3;
    } else if (riverLevel >= BD2) { // BĐ2
       risks.push({
        type: 'river_flood_2', level: 'high', title: 'Lũ báo động 2',
        desc: `Nước sông dâng cao (${riverLevel}m). Ngập lụt vùng ven sông.`,
        locations: 'Tây Nha Trang (Vĩnh Ngọc, Vĩnh Thạnh)'
      });
      riskLevel = Math.max(riskLevel, 2);
    }

    return { risks, riskLevel };
  };

  const { risks, riskLevel } = analyzeRisk();

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-10">
      
      {/* --- HEADER --- */}
      <header className={`${theme.bg} text-white sticky top-0 z-50 shadow-2xl transition-colors duration-700`}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
              {dangerLevel >= 2 ? <AlertTriangle className="w-6 h-6 animate-pulse" /> : <Waves className="w-6 h-6" />}
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight uppercase tracking-wider">Nha Trang Flood Monitor</h1>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                </span>
                <span>Live Update | {currentTime}</span>
              </div>
            </div>
          </div>
          <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="md:hidden p-2 hover:bg-white/10 rounded">
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div> 
      </header>

      {/* --- MAIN CONTENT --- */}
      <main className="max-w-5xl mx-auto px-4 mt-4 relative z-10 space-y-6">

        {/* 0. CẢNH BÁO DỮ LIỆU CŨ / MẤT */}
        {(!hasRiverData || isRiverStale) && (
          <div className="bg-red-100 border border-red-300 rounded-lg px-4 py-3 text-sm text-red-800 flex items-start gap-3 shadow-sm">
            <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold uppercase text-xs mb-0.5">Dữ liệu mực nước {!hasRiverData ? 'không khả dụng' : 'đang lỗi thời'}</p>
              <p className="text-[13px] leading-relaxed">
                {!hasRiverData
                  ? 'Không lấy được số đo từ trạm Đồng Trăng (VNDMS). Mức hiển thị trên trang không đáng tin.'
                  : `Số đo mới nhất là lúc ${riverUpdated} — không phải hôm nay. Nguồn VNDMS có thể đang lỗi, hãy đối chiếu nguồn chính thống.`}
              </p>
            </div>
          </div>
        )}

        {/* 1. NOTE UPDATE */}
        <div className="bg-white/90 backdrop-blur shadow-sm rounded-lg px-4 py-2 text-xs text-slate-500 flex justify-center items-center gap-2 border border-slate-200 mx-2 sm:mx-0">
          <Activity size={14} className="text-blue-500" />
          <span>Hệ thống tự động cập nhật chỉ số mỗi 15 phút từ các trạm đo & vệ tinh.</span>
        </div>

        {/* 2. HERO DASHBOARD (SÔNG + MƯA) */}
        <div className={`rounded-2xl shadow-xl overflow-hidden text-white bg-gradient-to-br ${theme.heroGradient} transition-all duration-700`}>
          <div className="p-6 md:p-8 grid md:grid-cols-2 gap-10 items-center relative">
            
            <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
               <Waves size={300} />
            </div>

            {/* --- CỘT TRÁI: MỰC NƯỚC --- */}
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2 opacity-90">
                <MapPin size={18} />
                <span className="uppercase text-sm font-bold tracking-widest">Sông Cái (Đồng Trăng)</span>
              </div>
              
              <div className="flex items-end gap-3 mb-4">
                <span className="text-7xl font-black tracking-tighter leading-none">
                  {hasRiverData ? riverLevel.toFixed(2) : '--'}
                </span>
                <div className="mb-2">
                  <div className="text-2xl font-medium">mét</div>
                  <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold inline-block mt-1
                    ${dangerLevel >= 2 ? 'bg-white text-red-600 animate-pulse' : 'bg-white/20 text-white'}`}>
                    {!hasRiverData ? 'KHÔNG CÓ DỮ LIỆU' :
                     dangerLevel === 3 ? 'BÁO ĐỘNG 3 (KHẨN CẤP)' :
                     dangerLevel === 2 ? 'BÁO ĐỘNG 2 (NGUY HIỂM)' :
                     dangerLevel === 1 ? 'Báo động 1 (Lưu ý)' : 'Mức an toàn'}
                  </div>
                </div>
              </div>

              {/* THÔNG TIN NGUỒN & THỜI GIAN CẬP NHẬT */}
              {isEstimated ? (
                <div className="bg-yellow-300/20 border border-yellow-300/50 rounded-lg p-3 mb-6 backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className="text-yellow-300 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-yellow-200 uppercase mb-1">DỮ LIỆU DỰ ĐOÁN</p>
                      <p className="text-[11px] leading-relaxed text-white/90">
                        Mực nước được ước tính từ lượng mưa đầu nguồn và mô hình kinh nghiệm.
                        <br />
                        <b>Không phải số đo trực tiếp tại trạm Đồng Trăng.</b> Vui lòng tham khảo thêm nguồn chính thống.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-6 flex flex-col gap-1 bg-white/15 px-3 py-2 rounded-lg text-[11px] border border-white/10">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={14} />
                    <span className="font-semibold">DỮ LIỆU QUAN TRẮC THỰC TẾ</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-white/80">
                    <span>Nguồn: Hệ thống giám sát mực nước VNDMS (trạm Đồng Trăng).</span>
                    {riverUpdated && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> Cập nhật: {riverUpdated}
                      </span>
                    )}
                  </div>
                  {riverDescription && <p className="text-[10px] text-white/70 mt-1">{riverDescription}</p>}
                </div>
              )}

              {/* Thanh đo trực quan */}
              <div className="relative w-full mb-8 mt-4 px-1">
                 <div className="w-full bg-black/30 h-4 rounded-full overflow-hidden relative border border-white/10">
                    <div className="absolute top-0 bottom-0 w-[2px] bg-yellow-400 z-30 shadow-[0_0_8px_rgba(250,204,21,1)]" style={{ left: `${(BD1 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 1: ${BD1}m`}></div>
                    <div className="absolute top-0 bottom-0 w-[2px] bg-orange-500 z-30 shadow-[0_0_8px_rgba(249,115,22,1)]" style={{ left: `${(BD2 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 2: ${BD2}m`}></div>
                    <div className="absolute top-0 bottom-0 w-[2px] bg-red-600 z-30 shadow-[0_0_8px_rgba(220,38,38,1)] animate-pulse" style={{ left: `${(BD3 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 3: ${BD3}m`}></div>

                    <div
                      className={`h-full transition-all duration-1000 ease-out relative ${dangerLevel >= 2 ? 'bg-gradient-to-r from-orange-500 to-red-600' : 'bg-gradient-to-r from-cyan-400 to-green-400'}`}
                      style={{ width: `${Math.min((riverLevel / RIVER_SCALE_MAX) * 100, 100)}%` }}
                    >
                        <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_white]"></div>
                    </div>
                 </div>

                 <div className="relative h-6 text-[9px] font-mono font-bold mt-1.5 select-none w-full">
                    <span className="absolute left-0 text-white/50 -translate-x-1/4">0m</span>
                    <div className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2" style={{ left: `${(BD1 / RIVER_SCALE_MAX) * 100}%` }}>
                        <span className="text-yellow-300 leading-none">BĐ1</span>
                        <span className="text-yellow-300/50 text-[8px] leading-none">{BD1.toFixed(1)}</span>
                    </div>
                    <div className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2" style={{ left: `${(BD2 / RIVER_SCALE_MAX) * 100}%` }}>
                        <span className="text-orange-300 leading-none">BĐ2</span>
                        <span className="text-orange-300/50 text-[8px] leading-none">{BD2.toFixed(1)}</span>
                    </div>
                    <div className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2" style={{ left: `${(BD3 / RIVER_SCALE_MAX) * 100}%` }}>
                        <span className="text-red-400 leading-none">BĐ3</span>
                        <span className="text-red-400/50 text-[8px] leading-none">{BD3.toFixed(1)}</span>
                    </div>
                    <div className="absolute right-0 flex flex-col items-end gap-0.5 translate-x-1/4">
                        <span className="text-white/60 leading-none">Đỉnh lũ 2025</span>
                        <span className="text-white/40 text-[8px] leading-none">12.95m</span>
                    </div>
                 </div>
              </div>
              
              {/* Biểu đồ mực nước */}
              {riverHistory.length > 0 && (
                <div className="mt-4 bg-black/10 rounded-lg p-3 border border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-white/80 flex items-center gap-1">
                      <Waves size={12} /> Diễn biến mực nước
                    </span>
                    {riverUpdated && <span className="text-[10px] text-white/60">Cập nhật: {riverUpdated}</span>}
                  </div>
                  <div className="h-24 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={riverHistory}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.8)' }} tickLine={false} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.8)' }} width={30} />
                        <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid rgba(148,163,184,0.5)', fontSize: 11 }} labelStyle={{ color: '#e5e7eb' }} formatter={(val) => [`${val} m`, 'Mực nước']} labelFormatter={(label) => `Giờ: ${label}`} />
                        <Line type="monotone" dataKey="value" stroke="#ffffff" strokeWidth={2} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* --- CỘT PHẢI: MƯA THƯỢNG NGUỒN --- */}
            <div className="relative z-10 bg-white/10 p-5 rounded-xl border border-white/10 backdrop-blur-sm h-full flex flex-col">
              <div className="flex items-center gap-2 opacity-90 mb-4 border-b border-white/10 pb-2">
                <CloudRain size={18} className="text-cyan-300" />
                <span className="uppercase text-sm font-bold tracking-widest text-cyan-100">
                  Mưa Thượng Nguồn
                </span>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                {(() => {
                  let stations = [];
                  try {
                    const rawJson = monitorData?.Du_Lieu_Thuong_Nguon?.history_json;
                    if (rawJson) stations = JSON.parse(rawJson);
                  } catch (e) { stations = []; }

                  if (stations.length === 0) return <div className="text-sm opacity-50">Đang cập nhật dữ liệu...</div>;

                  return stations.map((st, idx) => {
                    const lv = st.level ? st.level.toLowerCase() : '';
                    let statusColor = 'bg-slate-700/50 text-slate-300 border-slate-600';
                    if (lv.includes('vừa')) statusColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
                    if (lv.includes('to') || lv.includes('lớn')) statusColor = 'bg-red-500/20 text-red-300 border-red-500/30';
                    if (lv.includes('nhỏ') || lv.includes('nho')) statusColor = 'bg-blue-500/20 text-blue-300 border-blue-500/30';

                    return (
                      <div key={idx} className="flex flex-col bg-slate-900/40 p-3 rounded-lg border border-white/5 hover:bg-slate-800/60 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-white text-[15px] leading-tight w-2/3">{st.name}</span>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${statusColor}`}>
                             {st.level || 'Chờ cập nhật'}
                          </span>
                        </div>
                        <div className="text-xs text-white/50 mb-2 italic truncate">{st.location || '...'}</div>
                        
                        <div className="flex justify-between items-end border-t border-white/5 pt-2">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase opacity-60">Hôm nay</span>
                            <span className={`text-xl font-mono font-bold ${st.today > 10 ? 'text-yellow-300' : 'text-cyan-300'}`}>
                              {st.today.toFixed(1)} <span className="text-xs font-normal opacity-70 text-white">mm</span>
                            </span>
                          </div>
                          {(st.has_enough_data || st.total_3day > st.today) && (
                            <div className="flex flex-col items-end pl-3">
                              <span className="text-[10px] uppercase opacity-60">Tổng 3 ngày</span>
                              <span className="text-lg font-mono font-semibold text-white/90">
                                {st.total_3day.toFixed(1)} <span className="text-xs font-normal opacity-50">mm</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="mt-2 text-right text-[10px] opacity-30">Dữ liệu tự động từ Vrain</div>
            </div>
          </div>
        </div>

        {/* 3. PHÂN TÍCH & DỰ BÁO THÔNG MINH (NEW LOGIC) */}
        <section className="mb-6">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <ShieldAlert className={riskLevel > 0 ? "text-yellow-500" : "text-green-600"} />
                ĐÁNH GIÁ RỦI RO & DỰ BÁO
            </h2>
              
            <div className={`rounded-xl border p-5 transition-all shadow-sm ${
                riskLevel === 3 ? 'bg-red-50 border-red-500/50' :
                riskLevel === 2 ? 'bg-orange-50 border-orange-500/50' :
                riskLevel === 1 ? 'bg-yellow-50 border-yellow-500/50' :
                'bg-green-50 border-green-500/30'
            }`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-3 rounded-full ${
                    riskLevel === 3 ? 'bg-red-500 text-white animate-pulse' :
                    riskLevel === 2 ? 'bg-orange-500 text-white' :
                    riskLevel === 1 ? 'bg-yellow-500 text-white' :
                    'bg-green-500 text-white'
                  }`}>
                    {riskLevel === 0 ? <CheckCircle size={24}/> : <AlertTriangle size={24}/>}
                  </div>
                  <div>
                    <div className={`text-xl font-black uppercase tracking-wide ${
                       riskLevel === 3 ? 'text-red-600' :
                       riskLevel === 2 ? 'text-orange-600' :
                       riskLevel === 1 ? 'text-yellow-600' :
                       'text-green-600'
                    }`}>
                      {riskLevel === 3 ? 'NGUY HIỂM - CẢNH BÁO LŨ' :
                       riskLevel === 2 ? 'CÓ NGUY CƠ CAO' :
                       riskLevel === 1 ? 'CẦN CHÚ Ý' :
                       'AN TOÀN'}
                    </div>
                    <div className="text-sm opacity-80 text-slate-600">
                      {riskLevel === 0 
                        ? "Hiện tại các chỉ số thủy văn đều ở mức bình thường." 
                        : "Hệ thống phát hiện các yếu tố rủi ro sau:"}
                    </div>
                  </div>
                </div>

                {risks.length > 0 ? (
                  <div className="space-y-3">
                    {risks.map((risk, index) => (
                      <div key={index} className="bg-white rounded-lg p-3 border-l-4 shadow-sm" style={{ borderColor: risk.level === 'high' ? '#dc2626' : '#facc15' }}>
                        <div className="flex justify-between items-center mb-1">
                          <strong className="text-slate-800">{risk.title}</strong>
                          {risk.locations && (
                              <span className="text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium border border-slate-200">
                                  <MapPin size={10} className="inline mr-1 text-red-500"/>{risk.locations}
                              </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600">{risk.desc}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-green-100/50 rounded-lg p-4 border border-green-200">
                     <p className="text-sm text-green-800">
                       {hasRiverData
                         ? `Dựa vào lượng mưa tích lũy 3 ngày (${rain3daySum.toFixed(1)}mm) và mực nước sông hiện tại (${riverLevel.toFixed(2)}m), chưa phát hiện nguy cơ ngập lụt diện rộng.`
                         : 'Không có dữ liệu mực nước sông để đánh giá. Vui lòng tham khảo nguồn chính thống.'}
                     </p>
                  </div>
                )}
            </div>
        </section>

        <div className="grid md:grid-cols-3 gap-6">
          
          {/* 4. BẢNG MƯA CHI TIẾT (VRAIN) */}
          <section className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-600" />
                Trạm Đo Mưa Toàn Tỉnh
              </h2>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Vrain Data</span>
            </div>
            
            <div className="flex-1 p-0 overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Trạm đo / Vị trí</th>
                    <th className="px-4 py-3 text-right">Mưa hiện tại</th>
                    <th className="px-4 py-3 text-right hidden sm:table-cell">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rainStationList.slice(0, isExpanded ? rainStationList.length : 5).map((st, idx) => (
                    <tr key={idx} className="hover:bg-blue-50 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-700 group-hover:text-blue-700">{st.station_name}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin size={10} /> {st.location}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-bold text-slate-800 text-base">{st.mm.toFixed(1)}</div>
                        <div className="text-[10px] text-slate-400">mm</div>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase
                          ${st.mm > 50 ? 'bg-blue-100 text-blue-700' : 
                            st.mm > 0 ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-400'}`}>
                          {st.level || (st.mm > 0 ? 'Mưa nhỏ' : 'Tạnh ráo')}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rainStationList.length === 0 && (
                     <tr><td colSpan="3" className="p-8 text-center text-slate-400">Đang đồng bộ dữ liệu...</td></tr>
                  )}
                </tbody>
              </table>
              {rainStationList.length > 5 && (
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-full py-3 text-xs font-bold text-blue-600 bg-slate-50 hover:bg-blue-50 transition-colors border-t border-slate-100 uppercase tracking-wide"
                >
                  {isExpanded ? "Thu gọn" : `Xem thêm ${rainStationList.length - 5} trạm khác`}
                </button>
              )}
            </div>
          </section>

          {/* 5. TIN TỨC & XẢ LŨ */}
          <div className="space-y-6">
            
            {/* Control Panel Xả Lũ */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="mb-3">
                <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm uppercase tracking-wide">
                  <Activity className="w-4 h-4 text-red-500" /> Giám Sát Hồ Chứa
                </h2>
                <p className="text-[10px] text-slate-500 mt-1 ml-6">* Số liệu Mực nước/Dung tích từ VNDMS.</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {[
                  { id: 'ho_suoi_dau', label: 'Hồ Suối Dầu' },
                  { id: 'ho_am_chua', label: 'Hồ Am Chúa' },
                  { id: 'ho_lang_nhot', label: 'Hồ Láng Nhớt' },
                  { id: 'ho_da_ban', label: 'Hồ Đá Bàn' },
                  { id: 'ho_hoa_son', label: 'Hồ Hoa Sơn' },
                ].map((lake) => {
                  const data = monitorData?.[lake.id];
                  const hasFreshData = data?.q_out !== null && data?.q_out !== undefined;
                  const isDischarging = hasFreshData && data.q_out > 0;
                  const maxCap = data?.max_capacity || 0;
                  const currentVol = data?.volume_now || 0;
                  const percentFull = maxCap > 0 ? Math.min(Math.round((currentVol / maxCap) * 100), 100) : 0;
                  
                  const Wrapper = data?.source_link ? 'a' : 'div';
                  const wrapperProps = data?.source_link ? { href: data.source_link, target: "_blank", rel: "noreferrer", className: "block hover:opacity-90 transition-opacity" } : {};

                  return (
                    <Wrapper key={lake.id} {...wrapperProps}>
                      <div className={`flex justify-between items-start p-3 rounded-lg border transition-all relative overflow-hidden group ${isDischarging ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-90'}`}>
                        {isDischarging && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 animate-pulse"></div>}

                        <div className="pl-2 flex-1 pr-2">
                          <div className="font-bold text-sm text-slate-800 flex items-center gap-1 mb-1">{lake.label} {data?.source_link && <ExternalLink size={10} className="text-blue-500" />}</div>
                          <div className="flex justify-between items-center text-[11px] mb-1">
                            <span className="text-slate-500">Mực nước:</span>
                            <span className="font-bold text-blue-700">{data?.level_now ? `${data.level_now.toFixed(2)} m` : '--'}</span>
                          </div>
                          <div className="mb-2">
                            <div className="flex justify-between items-center text-[11px] mb-1">
                               <span className="text-slate-500">Dung tích:</span>
                               <span className="font-bold text-cyan-700">{currentVol.toFixed(2)} / {maxCap > 0 ? maxCap.toFixed(2) : '?'} <span className="text-[9px] font-normal text-slate-400">tr.m³</span></span>
                            </div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden relative">
                               <div className="absolute left-[70%] top-0 bottom-0 w-[1px] bg-white/50 z-10" title="Mức 70%"></div>
                               <div className={`h-full rounded-full transition-all duration-700 ${percentFull >= 90 ? 'bg-red-600' : percentFull >= 70 ? 'bg-orange-400' : 'bg-cyan-500'}`} style={{ width: `${percentFull}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[9px] mt-1">
                               <span className="text-slate-400 italic">{data?.news_time || "Chờ cập nhật..."}</span>
                               <span className={`font-bold ${percentFull >= 85 ? 'text-red-600' : 'text-slate-500'}`}>Đạt {percentFull}%</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right pl-2 min-w-[70px] border-l border-slate-200/50 flex flex-col justify-center h-full">
                          {hasFreshData ? (
                            <>
                              <div className={`font-mono font-bold text-lg leading-none ${isDischarging ? 'text-red-600' : 'text-slate-400'}`}>{data.q_out}</div>
                              <div className="text-[9px] text-slate-500 font-bold mt-1">m³/s</div>
                              {isDischarging ? <span className="text-[8px] text-white bg-red-500 px-1.5 py-0.5 rounded mt-1 inline-block text-center mx-auto animate-pulse">ĐANG XẢ</span> : <span className="text-[8px] text-slate-400 mt-1">Không xả</span>}
                            </>
                          ) : (
                            <div className="flex flex-col items-end opacity-50"><span className="text-lg font-bold text-slate-300">--</span></div>
                          )}
                        </div>
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
            </section>

            {/* News Feed */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-100 font-bold text-xs text-slate-700 uppercase tracking-wide flex items-center gap-2">
                <FileText size={14} className="text-blue-600"/> Tin tức mới
              </div>
              <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {alerts.slice(0, 8).map((news, i) => (
                  <a key={i} href={news.link} target="_blank" rel="noreferrer" className="block p-3 transition-colors hover:bg-blue-50 group">
                    <div className="flex gap-3">
                      <div className="mt-1 shrink-0"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 group-hover:bg-blue-600 transition-colors"></div></div>
                      <div>
                        <div className="text-xs font-medium leading-snug text-slate-700 group-hover:text-blue-700 transition-colors">{news.title}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{news.time_crawled}</div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </section>

          </div>
        </div>

        {/* FOOTER */}
        <footer className="text-center text-slate-400 text-[10px] py-6">
          <p>DATA SOURCE: VRAIN.VN (REALTIME) • VNDMS • BÁO KHÁNH HÒA</p>
          <p className="mt-1">Dự án hỗ trợ cộng đồng ứng phó thiên tai.</p>
        </footer>

      </main>
    </div>
  );
}
