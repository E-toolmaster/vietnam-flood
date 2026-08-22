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
import { rainLabel } from './api/risk-engine';

// === CẤU HÌNH ===

// MAP ĐỊA GIỚI KHÁNH HÒA (groupLocations cho trạm mưa TP)
const ZONE_MAP = {
  'Vĩnh Ngọc': 'Tây Nha Trang', 'Vĩnh Thạnh': 'Tây Nha Trang',
  'Vĩnh Hiệp': 'Tây Nha Trang', 'Vĩnh Trung': 'Tây Nha Trang',
  'Ngọc Hiệp': 'Tây Nha Trang', 'Phương Sài': 'Tây Nha Trang',
  'Vĩnh Lương': 'Bắc Nha Trang', 'Vĩnh Phương': 'Bắc Nha Trang',
  'Vĩnh Hòa': 'Bắc Nha Trang', 'Vĩnh Hải': 'Bắc Nha Trang',
  'Vĩnh Phước': 'Bắc Nha Trang', 'Vĩnh Thọ': 'Bắc Nha Trang',
  'Phước Đồng': 'Nam Nha Trang', 'Vĩnh Thái': 'Nam Nha Trang',
  'Phước Long': 'Nam Nha Trang', 'Vĩnh Trường': 'Nam Nha Trang',
  'Phước Hải': 'Nam Nha Trang',
  'Lộc Thọ': 'Trung Tâm Nha Trang', 'Vạn Thạnh': 'Trung Tâm Nha Trang',
  'Tân Tiến': 'Trung Tâm Nha Trang', 'Phước Hòa': 'Trung Tâm Nha Trang',
  'Vĩnh Nguyên': 'Trung Tâm Nha Trang',
  'Diên Khánh': 'H. Diên Khánh', 'Diên An': 'H. Diên Khánh', 'Diên Toàn': 'H. Diên Khánh',
  'Diên Thạnh': 'H. Diên Khánh', 'Diên Lạc': 'H. Diên Khánh', 'Diên Phú': 'H. Diên Khánh',
  'Diên Điền': 'H. Diên Khánh', 'Diên Sơn': 'H. Diên Khánh', 'Suối Hiệp': 'H. Diên Khánh',
  'Khánh Vĩnh': 'H. Khánh Vĩnh', 'Khánh Hiệp': 'H. Khánh Vĩnh', 'Khánh Đông': 'H. Khánh Vĩnh',
  'Giang Ly': 'H. Khánh Vĩnh', 'Sông Cầu': 'H. Khánh Vĩnh',
};

const groupLocations = (stationNames) => {
  if (!stationNames || stationNames.length === 0) return '';
  let zones = new Set();
  let unknown = [];
  stationNames.forEach(name => {
    let found = false;
    for (const [key, zone] of Object.entries(ZONE_MAP)) {
      if (name.includes(key)) { zones.add(zone); found = true; break; }
    }
    if (!found) unknown.push(name);
  });
  const zoneList = Array.from(zones);
  if (zoneList.length > 0) {
    return zoneList.join(', ') + (unknown.length > 0 ? `, ${unknown.slice(0, 2).join(', ')}...` : '');
  }
  return unknown.slice(0, 3).join(', ');
};

const RIVER_SCALE_MAX = 12.95; // Đỉnh lũ 2025 (chỉ dùng cho thanh đo Khánh Hòa)

export default function FloodMonitor() {
  const [province, setProvince] = useState('khanh-hoa');
  const [provincesList, setProvincesList] = useState([]);
  const [monitorData, setMonitorData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  // Danh sách tỉnh (1 lần)
  useEffect(() => {
    const fetchProvinces = async () => {
      try {
        const res = await fetch('/api/provinces', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          setProvincesList(json.provinces || []);
        }
      } catch (e) { /* bỏ qua */ }
    };
    fetchProvinces();
    const t = setInterval(fetchProvinces, 900000);
    return () => clearInterval(t);
  }, []);

  // Dữ liệu theo tỉnh
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const p = url.searchParams.get('p');
      if (p && p !== province) setProvince(p);
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const t = new Date().getTime();
        const res = await fetch(`/api/alerts?province=${province}&t=${t}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Network response was not ok');
        const json = await res.json();
        setMonitorData(json.metrics);
        setAlerts(json.data || []);
        setLoading(false);
        setCurrentTime(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        console.error('Error fetching flood data:', error);
        setLoading(false);
      }
    };
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 900000); // 15 phút, khớp chu kỳ crawler
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
    }, 60000);
    return () => { clearInterval(interval); clearInterval(timer); };
  }, [province]);

  const switchProvince = (code) => {
    setProvince(code);
    setIsMenuOpen(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('p', code);
      window.history.replaceState({}, '', url);
    }
  };

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
  const isMountain = monitorData?.province?.kind === 'mountain';
  const provinceRain = monitorData?.province_rain || null;

  const hasRiverData = monitorData?.river?.current !== undefined && monitorData?.river?.current !== null;
  const riverLevel = hasRiverData ? monitorData.river.current : 0;
  const isEstimated = monitorData?.river?.is_estimated === 1;

  const BD1 = monitorData?.river?.bd1 ?? null;
  const BD2 = monitorData?.river?.bd2 ?? null;
  const BD3 = monitorData?.river?.bd3 ?? null;
  const hasBD = BD1 !== null && BD2 !== null && BD3 !== null;

  const riverUpdated = monitorData?.river?.updated || '';
  const isRiverStale = (() => {
    const m = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})$/.exec(riverUpdated.trim());
    if (!m) return false;
    const now = new Date();
    return +m[3] !== now.getDate() || +m[4] !== now.getMonth() + 1;
  })();

  const rainDesc = monitorData?.rain?.rain_3day || [0, 0, 0];
  const rainToday = rainDesc[2] || 0;
  const rain3daySum = rainDesc.reduce((a, b) => a + b, 0);
  const chartData = [
    { name: 'Hôm kia', value: rainDesc[0] || 0 },
    { name: 'Hôm qua', value: rainDesc[1] || 0 },
    { name: 'Hôm nay', value: rainToday },
  ];

  const riverDescription = monitorData?.river?.description || '';
  const riverHistory = monitorData?.river?.history || [];

  // Mưa tỉnh núi hôm nay
  const mRain = provinceRain?.today || null;
  const mRainLevel = mRain ? (mRain.level || rainLabel(mRain.max_mm)) : '';
  const mRain3day = provinceRain?.rain3day || [];
  const mountainChartData = ['Hôm kia', 'Hôm qua', 'Hôm nay'].map((name, i) => ({
    name, value: mRain3day[i] || 0,
  }));

  // Trạng thái nguy hiểm tổng hợp (hero)
  const heroLevel = monitorData?.risk?.level ?? 0;
  let dangerLevel = 0;
  if (hasBD && hasRiverData) {
    if (riverLevel >= BD3) dangerLevel = 3;
    else if (riverLevel >= BD2) dangerLevel = 2;
    else if (riverLevel >= BD1) dangerLevel = 1;
  }
  const showLevel = isMountain || !hasRiverData ? heroLevel : dangerLevel;

  const theme = {
    bg: showLevel === 3 ? 'bg-red-600' : showLevel === 2 ? 'bg-orange-500' : 'bg-blue-600',
    heroGradient: showLevel === 3
      ? 'from-red-600 via-red-500 to-red-700'
      : showLevel === 2
        ? 'from-orange-500 via-orange-400 to-orange-600'
        : 'from-blue-600 via-blue-500 to-blue-700',
  };

  // --- RISK (server-computed) ---
  const riskData = monitorData?.risk || {};
  const risks = riskData.factors || [];
  const riskLevel = typeof riskData.level === 'number' ? riskData.level : 0;
  const observedRisks = risks.filter(r => r.source !== 'forecast');
  const forecastRisks = risks.filter(r => r.source === 'forecast');

  const rainStationList = monitorData?.rain_stations || [];
  const currentProvinceName =
    provincesList.find(p => p.code === province)?.name ||
    (monitorData?.province?.code === province ? '' : '') || 'Khánh Hòa';

  const reservoirs = Object.values(monitorData || {})
    .filter(v => v && typeof v === 'object' && v.type === 'reservoir')
    .sort((a, b) => (b.max_capacity || 0) - (a.max_capacity || 0));

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-10">

      {/* --- HEADER --- */}
      <header className={`${theme.bg} text-white sticky top-0 z-50 shadow-2xl transition-colors duration-700`}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm shrink-0">
              {showLevel >= 2 ? <AlertTriangle className="w-6 h-6 animate-pulse" /> : <Waves className="w-6 h-6" />}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight uppercase tracking-wider truncate">
                Flood Monitor
              </h1>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
                </span>
                <span>Live Update | {currentTime}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={province}
              onChange={(e) => switchProvince(e.target.value)}
              className="bg-white/15 border border-white/30 rounded-lg px-2 py-2 text-sm font-semibold text-white outline-none cursor-pointer hover:bg-white/25 [&>option]:text-slate-900"
              aria-label="Chọn tỉnh"
            >
              {provincesList.length === 0 && <option value={province}>{currentProvinceName}</option>}
              {provincesList.map(p => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="md:hidden p-2 hover:bg-white/10 rounded">
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {isMenuOpen && (
          <div className="md:hidden px-4 pb-3 grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {provincesList.map(p => (
              <button key={p.code} onClick={() => switchProvince(p.code)}
                className={`text-left text-xs px-3 py-2 rounded-lg font-medium ${p.code === province ? 'bg-white text-slate-900' : 'bg-white/15 hover:bg-white/25'}`}>
                {p.name}
                {p.rain_mm >= 50 && <span className="ml-1 text-red-200">({p.rain_mm.toFixed(0)}mm)</span>}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* --- MAIN --- */}
      <main className="max-w-5xl mx-auto px-4 mt-4 relative z-10 space-y-6">

        {/* 0. CẢNH BÁO DỮ LIỆU CŨ / MẤT */}
        {!isMountain && (!hasRiverData || isRiverStale) && (
          <div className="bg-red-100 border border-red-300 rounded-lg px-4 py-3 text-sm text-red-800 flex items-start gap-3 shadow-sm">
            <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold uppercase text-xs mb-0.5">Dữ liệu mực nước {!hasRiverData ? 'không khả dụng' : 'đang lỗi thời'}</p>
              <p className="text-[13px] leading-relaxed">
                {!hasRiverData
                  ? 'Không lấy được số đo từ trạm quan trắc (VNDMS). Mức hiển thị trên trang không đáng tin.'
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

        {/* 2. HERO DASHBOARD */}
        <div className={`rounded-2xl shadow-xl overflow-hidden text-white bg-gradient-to-br ${theme.heroGradient} transition-all duration-700`}>
          <div className="p-6 md:p-8 grid md:grid-cols-2 gap-10 items-center relative">

            <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
              {isMountain ? <CloudRain size={300} /> : <Waves size={300} />}
            </div>

            {/* --- CỘT TRÁI --- */}
            {isMountain ? (
              /* MIỀN NÚI: mưa lớn nhất tỉnh */
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2 opacity-90">
                  <MapPin size={18} />
                  <span className="uppercase text-sm font-bold tracking-widest">Mưa lớn nhất tỉnh</span>
                </div>
                {mRain ? (
                  <>
                    <div className="flex items-end gap-3 mb-2">
                      <span className="text-7xl font-black tracking-tighter leading-none">
                        {mRain.max_mm.toFixed(1)}
                      </span>
                      <div className="mb-2">
                        <div className="text-2xl font-medium">mm/24h</div>
                        <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold inline-block mt-1
                          ${mRain.max_mm >= 100 ? 'bg-white text-red-600 animate-pulse' : mRain.max_mm >= 50 ? 'bg-white text-orange-600' : 'bg-white/20 text-white'}`}>
                          {mRainLevel}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-white/90 mb-4 flex flex-wrap gap-2 items-center">
                      <span className="bg-white/15 px-2 py-1 rounded">📍 {mRain.station}</span>
                      {mRain.as_of && <span className="inline-flex items-center gap-1 text-xs"><Clock size={11} /> đến {mRain.as_of}</span>}
                    </div>
                    {provinceRain?.daysPresent >= 2 && (
                      <div className="mt-2 bg-black/10 rounded-lg p-3 border border-white/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-white/80">Tích lũy 3 ngày (trạm max mỗi ngày)</span>
                          <span className="text-[10px] text-white/60">{mRain3day.reduce((a, b) => a + b, 0).toFixed(1)}mm</span>
                        </div>
                        <div className="h-20 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={mountainChartData}>
                              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.8)' }} tickLine={false} />
                              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                contentStyle={{ backgroundColor: '#020617', border: '1px solid rgba(148,163,184,0.5)', fontSize: 11 }}
                                labelStyle={{ color: '#e5e7eb' }} formatter={(val) => [`${val} mm`, 'Mưa']} />
                              <Bar dataKey="value" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                    {hasRiverData && (
                      <div className="mt-3 bg-white/15 px-3 py-2 rounded-lg text-xs border border-white/10">
                        <span className="font-semibold">{monitorData.river.name}</span>
                        <span className="ml-2 font-mono font-bold">{riverLevel.toFixed(2)} m</span>
                        <span className="ml-2 text-white/70 inline-flex items-center gap-1"><Clock size={10} />{riverUpdated}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm opacity-70">Đang cập nhật dữ liệu mưa tỉnh...</p>
                )}
              </div>
            ) : (
              /* TỈNH SÔNG: mực nước (flow cũ) */
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2 opacity-90">
                  <MapPin size={18} />
                  <span className="uppercase text-sm font-bold tracking-widest">{monitorData?.river?.name || 'Trạm quan trắc'}</span>
                </div>

                <div className="flex items-end gap-3 mb-4">
                  <span className="text-7xl font-black tracking-tighter leading-none">
                    {hasRiverData ? riverLevel.toFixed(2) : '--'}
                  </span>
                  <div className="mb-2">
                    <div className="text-2xl font-medium">mét</div>
                    {hasBD && (
                      <div className={`text-xs px-2 py-0.5 rounded uppercase font-bold inline-block mt-1
                        ${dangerLevel >= 2 ? 'bg-white text-red-600 animate-pulse' : 'bg-white/20 text-white'}`}>
                        {!hasRiverData ? 'KHÔNG CÓ DỮ LIỆU' :
                          dangerLevel === 3 ? 'BÁO ĐỘNG 3 (KHẨN CẤP)' :
                          dangerLevel === 2 ? 'BÁO ĐỘNG 2 (NGUY HIỂM)' :
                          dangerLevel === 1 ? 'Báo động 1 (Lưu ý)' : 'Mức an toàn'}
                      </div>
                    )}
                  </div>
                </div>

                {isEstimated ? (
                  <div className="bg-yellow-300/20 border border-yellow-300/50 rounded-lg p-3 mb-6 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={20} className="text-yellow-300 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-yellow-200 uppercase mb-1">DỮ LIỆU DỰ ĐOÁN</p>
                        <p className="text-[11px] leading-relaxed text-white/90">
                          Mực nước được ước tính — <b>không phải số đo trực tiếp</b>. Vui lòng tham khảo nguồn chính thống.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 flex flex-col gap-1 bg-white/15 px-3 py-2 rounded-lg text-[11px] border border-white/10">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={14} />
                      <span className="font-semibold">DỮ LIỆU QUAN TRẮC THỰC TẾ (VNDMS)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-white/80">
                      <span>Nguồn: Hệ thống giám sát mực nước VNDMS.</span>
                      {riverUpdated && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} /> Cập nhật: {riverUpdated}
                        </span>
                      )}
                    </div>
                    {riverDescription && <p className="text-[10px] text-white/70 mt-1">{riverDescription}</p>}
                  </div>
                )}

                {/* Thanh đo chỉ vẽ khi có ngưỡng BĐ */}
                {hasBD && (
                  <div className="relative w-full mb-8 mt-4 px-1">
                    <div className="w-full bg-black/30 h-4 rounded-full overflow-hidden relative border border-white/10">
                      <div className="absolute top-0 bottom-0 w-[2px] bg-yellow-400 z-30" style={{ left: `${(BD1 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 1: ${BD1}m`}></div>
                      <div className="absolute top-0 bottom-0 w-[2px] bg-orange-500 z-30" style={{ left: `${(BD2 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 2: ${BD2}m`}></div>
                      <div className="absolute top-0 bottom-0 w-[2px] bg-red-600 z-30 animate-pulse" style={{ left: `${(BD3 / RIVER_SCALE_MAX) * 100}%` }} title={`Báo động 3: ${BD3}m`}></div>
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
                )}

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
            )}

            {/* --- CỘT PHẢI --- */}
            <div className="relative z-10 bg-white/10 p-5 rounded-xl border border-white/10 backdrop-blur-sm h-full flex flex-col">
              {monitorData?.Du_Lieu_Thuong_Nguon?.history_json ? (
                <>
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
                        const rawJson = monitorData.Du_Lieu_Thuong_Nguon.history_json;
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
                                <span className="text-[10px] uppercase opacity-60">Hôm nay{st.as_of ? ` (đến ${st.as_of})` : ''}</span>
                                <span className={`text-xl font-mono font-bold ${st.today > 10 ? 'text-yellow-300' : 'text-cyan-300'}`}>
                                  {st.today.toFixed(1)} <span className="text-xs font-normal opacity-70 text-white">mm</span>
                                </span>
                              </div>
                              {(st.days_present >= 2 || st.has_enough_data) && (
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
                    {Array.isArray(monitorData?.rain?.rain_3day) && monitorData.rain.rain_3day.length === 3 && (
                      <div className="mt-3 bg-black/10 rounded-lg p-3 border border-white/10">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-white/80">Mưa đầu nguồn 3 ngày (trạm nặng nhất — Vrain)</span>
                          {monitorData.rain.updated && <span className="text-[10px] text-white/60">Cập nhật: {monitorData.rain.updated}</span>}
                        </div>
                        <div className="h-24 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.8)' }} tickLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.8)' }} width={28} />
                              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                contentStyle={{ backgroundColor: '#020617', border: '1px solid rgba(148,163,184,0.5)', fontSize: 11 }}
                                labelStyle={{ color: '#e5e7eb' }} formatter={(val) => [`${val} mm`, 'Mưa']} />
                              <Bar dataKey="value" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                    <div className="mt-2 text-right text-[10px] opacity-30">Dữ liệu tự động từ Vrain</div>
                  </div>
                </>
              ) : (
                /* TỈNH KHÁC: danh sách trạm mưa trong tỉnh (deep pass) hoặc tổng quan */
                <>
                  <div className="flex items-center gap-2 opacity-90 mb-4 border-b border-white/10 pb-2">
                    <CloudRain size={18} className="text-cyan-300" />
                    <span className="uppercase text-sm font-bold tracking-widest text-cyan-100">
                      Trạm Đo Mưa Trong Tỉnh
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar max-h-[420px]">
                    {rainStationList.length > 0 ? (
                      rainStationList.slice(0, 12).map((st, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-slate-900/40 px-3 py-2 rounded-lg border border-white/5">
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate">{st.station_name}</div>
                            <div className="text-[11px] text-white/50 truncate">{st.location}</div>
                          </div>
                          <div className="text-right shrink-0 pl-2">
                            <div className={`font-mono font-bold text-lg leading-none ${st.mm >= 50 ? 'text-orange-300' : st.mm >= 16 ? 'text-cyan-300' : 'text-white/70'}`}>
                              {st.mm.toFixed(1)}
                            </div>
                            <div className="text-[9px] uppercase text-white/50 mt-0.5">{rainLabel(st.mm)}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm opacity-60 leading-relaxed">
                        {provinceRain ? (
                          <>
                            <p className="mb-2">Hôm nay trạm nặng nhất tỉnh: <b>{provinceRain.today.station}</b> — {provinceRain.today.max_mm.toFixed(1)}mm ({provinceRain.today.level}).</p>
                            <p className="text-xs opacity-70">Chi tiết từng trạm sẽ hiện khi tỉnh có mưa từ 25mm trở lên (hệ thống tự quét sâu).</p>
                          </>
                        ) : 'Đang cập nhật dữ liệu...'}
                      </div>
                    )}
                    <div className="mt-2 text-right text-[10px] opacity-30">Dữ liệu tự động từ Vrain</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3. ĐÁNH GIÁ RỦI RO & DỰ BÁO (server-computed) */}
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
                {riskLevel === 0 ? <CheckCircle size={24} /> : <AlertTriangle size={24} />}
              </div>
              <div>
                <div className={`text-xl font-black uppercase tracking-wide ${
                  riskLevel === 3 ? 'text-red-600' :
                  riskLevel === 2 ? 'text-orange-600' :
                  riskLevel === 1 ? 'text-yellow-600' :
                  'text-green-600'
                }`}>
                  {riskLevel === 3 ? 'NGUY HIỂM - CẢNH BÁO' :
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
              <div className="space-y-4">
                {observedRisks.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Activity size={12} className="text-red-500" /> Quan trắc thực tế
                    </div>
                    {observedRisks.map((risk, index) => (
                      <div key={index} className="bg-white rounded-lg p-3 border-l-4 shadow-sm"
                           style={{ borderColor: risk.level >= 3 ? '#dc2626' : risk.level === 2 ? '#f97316' : '#facc15' }}>
                        <div className="flex justify-between items-start mb-1 gap-2">
                          <strong className="text-slate-800">{risk.title}</strong>
                          <span className="shrink-0 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Đã đo</span>
                        </div>
                        <p className="text-sm text-slate-600">{risk.desc}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {risk.locations && (
                            <span className="text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium border border-slate-200">
                              <MapPin size={10} className="inline mr-1 text-red-500" />{risk.locations}
                            </span>
                          )}
                          {risk.stations && risk.stations.length > 0 && (
                            <span className="text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-medium border border-slate-200">
                              <MapPin size={10} className="inline mr-1 text-red-500" />{groupLocations(risk.stations)}
                            </span>
                          )}
                          {risk.thresholds_ref && (
                            <span className="text-[9px] text-slate-400 italic">Ngưỡng: {risk.thresholds_ref}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {forecastRisks.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <CloudRain size={12} className="text-blue-500" /> Dự báo 24h tới (mô hình — chưa phải cảnh báo chính thức)
                    </div>
                    {forecastRisks.map((risk, index) => (
                      <div key={index} className="bg-white rounded-lg p-3 border-l-4 border-blue-400 shadow-sm border-dashed">
                        <div className="flex justify-between items-start mb-1 gap-2">
                          <strong className="text-slate-800">{risk.title}</strong>
                          <span className="shrink-0 text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold uppercase">Dự báo</span>
                        </div>
                        <p className="text-sm text-slate-600">{risk.desc}</p>
                        {risk.thresholds_ref && (
                          <span className="text-[9px] text-slate-400 italic">Ngưỡng: {risk.thresholds_ref}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-green-100/50 rounded-lg p-4 border border-green-200">
                <p className="text-sm text-green-800">
                  {hasRiverData
                    ? `Mực nước sông hiện tại ${riverLevel.toFixed(2)}m và mưa trong ngày ở mức bình thường — chưa phát hiện nguy cơ ngập lụt, lũ quét diện rộng.`
                    : 'Các chỉ số mưa trong ngày ở mức bình thường — chưa phát hiện nguy cơ ngập lụt, lũ quét diện rộng.'}
                </p>
              </div>
            )}
          </div>
        </section>

        <div className="grid md:grid-cols-3 gap-6">

          {/* 4. BẢNG MƯA CHI TIẾT */}
          <section className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-600" />
                Trạm Đo Mưa {currentProvinceName ? `— ${currentProvinceName}` : 'Toàn Tỉnh'}
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
                          ${st.mm >= 100 ? 'bg-red-100 text-red-700' :
                            st.mm >= 50 ? 'bg-orange-100 text-orange-700' :
                            st.mm >= 16 ? 'bg-yellow-50 text-yellow-700' :
                            st.mm > 0 ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-400'}`}>
                          {rainLabel(st.mm)}
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

          {/* 5. HỒ CHỨA + TIN TỨC */}
          <div className="space-y-6">

            <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="mb-3">
                <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm uppercase tracking-wide">
                  <Activity className="w-4 h-4 text-red-500" /> Giám Sát Hồ Chứa
                </h2>
                <p className="text-[10px] text-slate-500 mt-1 ml-6">* Số liệu Mực nước/Dung tích từ VNDMS.</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {reservoirs.map((data) => {
                  const hasFreshData = data?.q_out !== null && data?.q_out !== undefined;
                  const isDischarging = hasFreshData && data.q_out > 0;
                  const maxCap = data?.max_capacity || 0;
                  const currentVol = data?.volume_now || 0;
                  const percentFull = maxCap > 0 ? Math.min(Math.round((currentVol / maxCap) * 100), 100) : 0;

                  const Wrapper = data?.source_link ? 'a' : 'div';
                  const wrapperProps = data?.source_link ? { href: data.source_link, target: "_blank", rel: "noreferrer", className: "block hover:opacity-90 transition-opacity" } : {};

                  return (
                    <Wrapper key={data.name} {...wrapperProps}>
                      <div className={`flex justify-between items-start p-3 rounded-lg border transition-all relative overflow-hidden group ${isDischarging ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-90'}`}>
                        {isDischarging && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 animate-pulse"></div>}
                        <div className="pl-2 flex-1 pr-2">
                          <div className="font-bold text-sm text-slate-800 flex items-center gap-1 mb-1">
                            {data.name} {data?.source_link && <ExternalLink size={10} className="text-blue-500" />}
                          </div>
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
                              {isDischarging
                                ? <span className="text-[8px] text-white bg-red-500 px-1.5 py-0.5 rounded mt-1 inline-block text-center mx-auto animate-pulse">ĐANG XẢ</span>
                                : <span className="text-[8px] text-slate-400 mt-1">Không xả</span>}
                            </>
                          ) : (
                            <div className="flex flex-col items-end opacity-50"><span className="text-lg font-bold text-slate-300">--</span></div>
                          )}
                        </div>
                      </div>
                    </Wrapper>
                  );
                })}
                {reservoirs.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-6">Đang cập nhật dữ liệu hồ chứa...</div>
                )}
              </div>
            </section>

            {/* News Feed (tỉnh có nguồn báo) */}
            {alerts.length > 0 && (
              <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-100 font-bold text-xs text-slate-700 uppercase tracking-wide flex items-center gap-2">
                  <FileText size={14} className="text-blue-600" /> Tin tức mới
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
            )}

          </div>
        </div>

        {/* FOOTER */}
        <footer className="text-center text-slate-400 text-[10px] py-6">
          <p>DATA SOURCE: VRAIN.VN (REALTIME) • VNDMS • OPEN-METEO • BÁO KHÁNH HÒA</p>
          <p className="mt-1">Dự án hỗ trợ cộng đồng ứng phó thiên tai — {provincesList.length > 0 ? provincesList.length : 15} tỉnh miền núi phía Bắc & miền Trung.</p>
        </footer>

      </main>
    </div>
  );
}
