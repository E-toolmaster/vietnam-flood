"use client";
import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import {
  Droplets, CloudRain, AlertTriangle, Info, Search, Menu, X, 
  ExternalLink, ChevronRight, Waves, ShieldAlert, MapPin, Clock, Activity
} from 'lucide-react';

// === CẤU HÌNH LOGIC DỰ BÁO (Dựa trên dữ liệu lịch sử) ===
const FLOOD_ZONES = [
  {
    threshold: 8.0, // BĐ1
    type: 'river',
    level: 'warning',
    title: 'Nguy cơ ngập cục bộ',
    areas: ['Khu vực bãi bồi ven sông', 'Cồn Dê', 'Cồn Ngọc Thảo', 'Đường mép sông Vĩnh Ngọc']
  },
  {
    threshold: 9.5, // BĐ2
    type: 'river',
    level: 'danger',
    title: 'Ngập lụt diện rộng (Tương đương 2021)',
    areas: ['Xã Vĩnh Phương', 'Xã Vĩnh Ngọc', 'Xã Vĩnh Trung (vùng thấp)', 'Đường 23/10 (đoạn Cầu Dứa)', 'Khu vực Tháp Bà']
  },
  {
    threshold: 11.0, // BĐ3
    type: 'river',
    level: 'critical',
    title: 'KHẨN CẤP: Ngập sâu nguy hiểm (Đỉnh lũ 2025)',
    areas: ['Toàn bộ xã Vĩnh Thạnh', 'Phường Ngọc Hiệp', 'Khu vực Chợ Đầm', 'Trung tâm TP (vùng trũng)', 'Cô lập hoàn toàn các xã ven sông']
  },
  {
    threshold: 150, // Mưa > 150mm
    type: 'rain',
    level: 'warning',
    title: 'Cảnh báo sạt lở đất & Lũ quét',
    areas: ['Đèo Khánh Lê (QL27C)', 'Huyện Khánh Vĩnh', 'Vùng núi Cam Lâm']
  }
];

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
        const res = await fetch('/api/alerts');
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
    const interval = setInterval(fetchData, 600000); // 10 phút refresh 1 lần
    // Clock tick
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
  const riverLevel = monitorData?.river?.current || 0;
  const rain3day = monitorData?.rain?.rain_3day || [0, 0, 0];
  const rain3daySum = rain3day.reduce((a, b) => a + b, 0);
  const rainStations = monitorData?.rain_stations || [];

  // Xác định trạng thái nguy hiểm (0: Bình thường, 1: BĐ1, 2: BĐ2, 3: BĐ3)
  let dangerLevel = 0;
  if (riverLevel >= 11.0) dangerLevel = 3;
  else if (riverLevel >= 9.5) dangerLevel = 2;
  else if (riverLevel >= 8.0) dangerLevel = 1;

  // Theme màu theo trạng thái
  const theme = {
    bg: dangerLevel === 3 ? 'bg-red-600' : dangerLevel === 2 ? 'bg-orange-500' : 'bg-blue-600',
    heroGradient: dangerLevel === 3 
      ? 'from-red-600 via-red-500 to-red-700' 
      : dangerLevel === 2 
        ? 'from-orange-500 via-orange-400 to-orange-600' 
        : 'from-blue-600 via-blue-500 to-blue-700',
    textAccent: dangerLevel >= 2 ? 'text-red-600' : 'text-blue-600',
  };

  // Logic Dự báo điểm ngập (Filter forecast)
  const activeForecasts = FLOOD_ZONES.filter(zone => {
    if (zone.type === 'river') return riverLevel >= zone.threshold;
    if (zone.type === 'rain') return rain3daySum >= zone.threshold;
    return false;
  }).sort((a, b) => b.threshold - a.threshold); // Lấy cái nặng nhất lên đầu

  const chartData = [
    { name: 'Hôm kia', value: rain3day[0] },
    { name: 'Hôm qua', value: rain3day[1] },
    { name: 'Hôm nay', value: rain3day[2] },
  ];

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
        
        {/* 1. NOTE UPDATE (Dòng chữ chạy hoặc tĩnh) */}
        <div className="bg-white/90 backdrop-blur shadow-sm rounded-lg px-4 py-2 text-xs text-slate-500 flex justify-center items-center gap-2 border border-slate-200 mx-2 sm:mx-0">
          <Activity size={14} className="text-blue-500" />
          <span>Hệ thống tự động cập nhật chỉ số mỗi 10 phút từ các trạm đo & vệ tinh.</span>
        </div>

        {/* 2. HERO DASHBOARD (SÔNG + MƯA) */}
        <div className={`rounded-2xl shadow-xl overflow-hidden text-white bg-gradient-to-br ${theme.heroGradient} transition-all duration-700`}>
          <div className="p-6 md:p-8 grid md:grid-cols-2 gap-10 items-center relative">
            
            {/* Hiệu ứng nền nước (trang trí) */}
            <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
               <Waves size={300} />
            </div>

            {/* --- CỘT TRÁI: MỰC NƯỚC --- */}
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2 opacity-90">
                <MapPin size={18} />
                <span className="uppercase text-sm font-bold tracking-widest">Sông Cái (Đồng Trăng)</span>
              </div>
              
              <div className="flex items-end gap-3 mb-6">
                <span className="text-7xl font-black tracking-tighter leading-none">
                  {riverLevel.toFixed(2)}
                </span>
                <div className="mb-2">
                  <div className="text-2xl font-medium">mét</div>
                  <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold inline-block mt-1
                    ${dangerLevel >= 2 ? 'bg-white text-red-600 animate-pulse' : 'bg-white/20 text-white'}`}>
                    {dangerLevel === 3 ? 'BÁO ĐỘNG 3 (KHẨN CẤP)' : 
                     dangerLevel === 2 ? 'BÁO ĐỘNG 2 (NGUY HIỂM)' : 
                     dangerLevel === 1 ? 'Báo động 1 (Lưu ý)' : 'Mức an toàn'}
                  </div>
                </div>
              </div>

              {/* Thanh đo trực quan */}
              <div className="w-full bg-black/20 h-3 rounded-full overflow-hidden relative mb-2">
                <div className="absolute left-[62%] top-0 bottom-0 w-0.5 bg-white/30 z-20" title="BĐ1"></div>
                <div className="absolute left-[74%] top-0 bottom-0 w-0.5 bg-white/30 z-20" title="BĐ2"></div>
                <div className="absolute left-[86%] top-0 bottom-0 w-0.5 bg-white/50 z-20" title="BĐ3"></div>
                <div 
                  className={`h-full transition-all duration-1000 ease-out ${dangerLevel >= 2 ? 'bg-white animate-pulse' : 'bg-green-300'}`}
                  style={{ width: `${(riverLevel / 12.8) * 100}%` }} 
                ></div>
              </div>
              <div className="flex justify-between text-[10px] opacity-70 font-mono">
                <span>0m</span>
                <span>BĐ1: 8.0</span>
                <span>BĐ2: 9.5</span>
                <span>BĐ3: 11.0</span>
                <span>MAX: 12.8</span>
              </div>
            </div>

            {/* --- CỘT PHẢI: MƯA TÍCH LŨY --- */}
            <div className="relative z-10 bg-white/10 p-5 rounded-xl border border-white/10 backdrop-blur-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 opacity-90 mb-1">
                    <CloudRain size={18} />
                    <span className="uppercase text-sm font-bold tracking-widest">Mưa 3 Ngày</span>
                  </div>
                  <div className="text-3xl font-bold">{rain3daySum.toFixed(1)} <span className="text-base font-normal">mm</span></div>
                </div>
                <div className="text-right text-xs opacity-70">
                  Tại trạm đo<br/>Khánh Vĩnh
                </div>
              </div>

              {/* Chart Mini */}
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <Bar dataKey="value" radius={[4, 4, 4, 4]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.value > 100 ? '#ffffff' : 'rgba(255,255,255,0.6)'} />
                      ))}
                    </Bar>
                    <Tooltip 
                      cursor={{fill: 'transparent'}}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-slate-800 text-white text-xs p-2 rounded shadow-lg border-none">
                              {payload[0].value} mm
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* 3. PHÂN TÍCH & DỰ BÁO NGẬP LỤT (LUÔN HIỂN THỊ) */}
<section className={`rounded-xl shadow-sm border-l-4 overflow-hidden mb-6 transition-all
  ${activeForecasts.length > 0 ? 'bg-white border-red-500 shadow-red-100' : 'bg-white border-green-500 shadow-green-50'}`}>
  
  <div className={`p-4 border-b flex items-center justify-between
    ${activeForecasts.length > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
    <h2 className={`font-bold text-lg flex items-center gap-2
      ${activeForecasts.length > 0 ? 'text-red-800' : 'text-green-800'}`}>
      {activeForecasts.length > 0 ? <ShieldAlert className="animate-bounce" /> : <ShieldAlert />}
      DỰ BÁO TÁC ĐỘNG & ĐIỂM NGẬP
    </h2>
    <span className={`text-xs font-bold px-2 py-1 rounded uppercase
      ${activeForecasts.length > 0 ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'}`}>
      {activeForecasts.length > 0 ? 'CÓ NGUY CƠ CAO' : 'AN TOÀN'}
    </span>
  </div>

  <div className="p-5">
    {/* LOGIC HIỂN THỊ DANH SÁCH NGẬP HOẶC THÔNG BÁO AN TOÀN */}
    {activeForecasts.length > 0 ? (
      <div className="space-y-4">
        <div className="text-sm text-slate-600 bg-red-50 p-3 rounded border border-red-100">
          ⚠️ <strong>CẢNH BÁO:</strong> Dựa trên mực nước Sông Cái hiện tại ({riverLevel.toFixed(2)}m) 
          và lượng mưa tích lũy ({rain3daySum.toFixed(1)}mm), hệ thống dự báo các khu vực sau có nguy cơ ngập lụt:
        </div>
        {activeForecasts.map((forecast, idx) => (
          <div key={idx} className="bg-slate-50 p-4 rounded-lg border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2 text-sm uppercase">
              <div className={`w-2.5 h-2.5 rounded-full ${forecast.level === 'critical' ? 'bg-red-600 animate-ping' : 'bg-orange-500'}`}></div>
              {forecast.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {forecast.areas.map((area, i) => (
                <span key={i} className="bg-white text-slate-700 px-3 py-1.5 rounded border border-slate-200 text-sm font-medium shadow-sm flex items-center gap-1">
                  <MapPin size={12} className="text-red-500" /> {area}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col items-center text-center py-4 space-y-3">
        <div className="bg-green-100 p-3 rounded-full">
          <ShieldAlert size={32} className="text-green-600" />
        </div>
        <div>
          <h3 className="font-bold text-green-800 text-lg">Chưa phát hiện nguy cơ ngập lụt</h3>
          <p className="text-slate-500 text-sm mt-1 max-w-lg mx-auto leading-relaxed">
            Dựa vào lượng mưa ({rain3daySum.toFixed(1)}mm) và mực nước sông hiện tại ({riverLevel.toFixed(2)}m), 
            các chỉ số đều nằm trong <strong>ngưỡng an toàn (Dưới Báo động 1)</strong>.
            <br/>
            Chưa ghi nhận khả năng ngập lụt tại các vùng trũng thấp ven sông Cái Nha Trang.
          </p>
        </div>
        <div className="text-xs text-slate-400 mt-2 border-t border-slate-100 pt-3 w-full max-w-xs">
          Tiếp tục theo dõi, hệ thống sẽ cảnh báo ngay khi mực nước vượt ngưỡng 8.0m.
        </div>
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
                Trạm Đo Mưa Trọng Yếu
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
                  {rainStations.slice(0, isExpanded ? rainStations.length : 5).map((st, idx) => (
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
                          {st.mm > 50 ? 'Mưa lớn' : st.mm > 0 ? 'Mưa nhỏ' : 'Tạnh ráo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rainStations.length === 0 && (
                     <tr><td colSpan="3" className="p-8 text-center text-slate-400">Đang đồng bộ dữ liệu...</td></tr>
                  )}
                </tbody>
              </table>
              {rainStations.length > 5 && (
                <button 
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="w-full py-3 text-xs font-bold text-blue-600 bg-slate-50 hover:bg-blue-50 transition-colors border-t border-slate-100 uppercase tracking-wide"
                >
                  {isExpanded ? "Thu gọn" : `Xem thêm ${rainStations.length - 5} trạm khác`}
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
                  <Activity className="w-4 h-4 text-red-500" />
                  Giám Sát Hồ Chứa
                </h2>
                <p className="text-[10px] text-slate-500 mt-1 ml-6">
                  * Dữ liệu trích xuất tự động từ các thông báo điều tiết lũ trên 
                  <a href="https://baokhanhhoa.vn" target="_blank" className="text-blue-600 hover:underline font-medium ml-1">
                    Báo Khánh Hòa
                  </a>.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {[
                  { id: 'ho_da_ban', label: 'Hồ Đá Bàn', max: 50 },
                  { id: 'ho_suoi_dau', label: 'Hồ Suối Dầu', max: 30 },
                  { id: 'ho_cam_ranh', label: 'Hồ Cam Ranh', max: 30 },
                  { id: 'ho_ea_krong_rou', label: 'Ea Krong Rou', max: 20 },
                ].map((lake) => {
                  const data = monitorData?.[lake.id];
                  const isDischarging = data?.current > 0;
                  
                  // Dùng thẻ 'a' nếu có link, ngược lại dùng 'div'
                  const Wrapper = data?.link ? 'a' : 'div';
                  const wrapperProps = data?.link ? { 
                    href: data.link, 
                    target: "_blank", 
                    rel: "noreferrer",
                    title: "Xem bài viết gốc trên Báo Khánh Hòa"
                  } : {};

                  return (
                    <Wrapper key={lake.id} {...wrapperProps} className={`flex justify-between items-center p-3 rounded-lg border transition-all relative overflow-hidden group
                      ${isDischarging ? 'bg-red-50 border-red-200 shadow-sm hover:bg-red-100' : 'bg-slate-50 border-slate-100 opacity-70 hover:opacity-100'}`}>
                      
                      {/* Indicator Light */}
                      {isDischarging && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 animate-pulse"></div>}

                      <div className="pl-2">
                        <div className="font-bold text-sm text-slate-700 group-hover:text-blue-700 flex items-center gap-1">
                          {lake.label}
                          {data?.link && <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500" />}
                        </div>
                        {data?.news_time ? (
                          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                             <Clock size={10} /> Cập nhật: {data.news_time}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 italic mt-0.5">Chưa có tin mới</div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className={`font-mono font-bold text-lg leading-none ${isDischarging ? 'text-red-600' : 'text-slate-400'}`}>
                          {data?.current || 0}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase">m³/s</div>
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
            </section>

            {/* News Feed Compact */}
            <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-100 font-bold text-xs text-slate-500 uppercase tracking-wide">
                Tin Tức Hiện Trường
              </div>
              <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {alerts.slice(0, 5).map((news, i) => (
                  <a key={i} href={news.link} target="_blank" className="block p-3 hover:bg-blue-50 transition-colors">
                    <div className="flex gap-2">
                      <div className="mt-1 shrink-0">
                         {news.is_urgent ? <AlertTriangle size={14} className="text-red-500" /> : <div className="w-3 h-3 rounded-full bg-blue-200 mt-0.5"></div>}
                      </div>
                      <div>
                        <div className={`text-xs font-medium leading-snug ${news.is_urgent ? 'text-red-700' : 'text-slate-700'}`}>
                          {news.title}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">{news.time_crawled} • {news.source}</div>
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
          <p>DATA SOURCE: VRAIN.VN (REALTIME) • OPEN-METEO • BÁO KHÁNH HÒA</p>
          <p className="mt-1">Dự án hỗ trợ cộng đồng ứng phó thiên tai.</p>
        </footer>

      </main>
    </div>
  );
}
