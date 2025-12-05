'use client';

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

// Fix Icon Leaflet
const iconUrl = 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

// Icon Cảnh báo Đỏ (Nhấp nháy)
const dangerIcon = new L.DivIcon({
    className: 'custom-danger-icon',
    html: `<div class="relative">
             <div class="absolute -top-3 -left-3 w-6 h-6 bg-red-500 rounded-full animate-ping opacity-75"></div>
             <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-600 rounded-full border-2 border-white shadow-lg"></div>
           </div>`,
    iconSize: [0, 0],
});

// Icon Cảnh báo Vàng (An toàn hơn)
const safeIcon = new L.DivIcon({
    className: 'custom-safe-icon',
    html: `<div class="relative">
             <div class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow-lg"></div>
           </div>`,
    iconSize: [0, 0],
});

function MapController({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center) map.flyTo(center, zoom, { animate: true, duration: 1.5 });
    }, [center, zoom, map]);
    return null;
}

export default function MapComponent({ center, zoom, markers }) {
    return (
        <MapContainer 
            center={[12.25, 109.10]} 
            zoom={11} 
            style={{ height: '100%', width: '100%', background: '#0f172a' }}
            scrollWheelZoom={true}
        >
            <MapController center={center} zoom={zoom} />
            
                         {/* Stamen Terrain (Địa hình nghệ thuật - Rất rõ sông suối) */}
                         <TileLayer
                url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                attribution="Google Maps Satellite"
            />


            {/* Nếu thích bản đồ đường phố (Carto Voyager) thì uncomment dòng dưới */}
            {/* <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            /> */}

            {markers.map((zone, idx) => (
                <Marker 
                    key={idx} 
                    position={zone.coords} 
                    icon={zone.level >= 2 ? dangerIcon : safeIcon}
                >
                    <Popup className="font-sans">
                        <div className="text-center min-w-[150px]">
                            <strong className={`block uppercase text-xs mb-1 ${zone.level >= 2 ? 'text-red-600' : 'text-blue-600'}`}>
                                {zone.name}
                            </strong>
                            <p className="text-xs text-gray-600 m-0">Độ cao nền: {zone.base_elevation}m</p>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
