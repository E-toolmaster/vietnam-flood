import { readFile } from 'fs/promises';
import path from 'path';
export const dynamic = 'force-dynamic';

// Polyline sông chính theo tỉnh (crawler cache từ Overpass/OSM) — cho bản đồ dòng chảy
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const province = (searchParams.get('province') || 'khanh-hoa').replace(/[^a-z0-9-]/g, '');
    const file = path.join(process.cwd(), '../crawl/rivers', `${province}.json`);
    const data = await readFile(file, 'utf8');
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return Response.json({ type: 'FeatureCollection', features: [] }, { status: 200 });
  }
}
