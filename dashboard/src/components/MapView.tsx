import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Destination, MatchResponse } from '../types';
import { rentLabel } from '../lib/format';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapView({ data, destinations, selected, onSelect }: { data: MatchResponse | null; destinations: Destination[]; selected: string | null; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<MLMap | null>(null); const markers = useRef<maplibregl.Marker[]>([]);
  const ready = useRef(false); const pending = useRef<() => void>(() => {});

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center: [-73.995, 40.738], zoom: 11.6, pitch: 0, maxPitch: 0, dragRotate: false, attributionControl: false });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' }), 'bottom-right');
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      // Muted pastel wash: tint water & land toward the palette.
      for (const l of m.getStyle().layers ?? []) {
        if (l.type === 'fill' && /water/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#d9e4f2');
        if (l.type === 'background') m.setPaintProperty(l.id, 'background-color', '#f6f3ef');
        if (l.type === 'fill' && /park|landcover|grass|wood/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#e3eddf');
        if (l.type === 'fill-extrusion') m.setLayoutProperty(l.id, 'visibility', 'none');
      }
      m.addSource('area', { type: 'geojson', data: EMPTY });
      const poly = (t: string): maplibregl.FilterSpecification => ['all', ['==', ['geometry-type'], 'Polygon'], t === 'exact' ? ['!=', ['get', 'tier'], 'stretch'] : ['==', ['get', 'tier'], 'stretch']];
      // Stretch area: lighter, dashed. Exact area: solid.
      m.addLayer({ id: 'stretch-fill', type: 'fill', source: 'area', filter: poly('stretch'), paint: { 'fill-color': '#f0a35e', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'stretch-line', type: 'line', source: 'area', filter: poly('stretch'), paint: { 'line-color': '#d9822b', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } });
      m.addLayer({ id: 'area-fill', type: 'fill', source: 'area', filter: poly('exact'), paint: { 'fill-color': '#8b7cf6', 'fill-opacity': 0.18 } });
      m.addLayer({ id: 'area-line', type: 'line', source: 'area', filter: poly('exact'), paint: { 'line-color': '#6a5ae6', 'line-width': 2.2 } });
      m.addLayer({ id: 'stretch-dots', type: 'circle', source: 'area', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'tier'], 'stretch']], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#d9822b', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'area-glow', type: 'circle', source: 'area', filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'tier'], 'exact']], paint: { 'circle-radius': 26, 'circle-color': '#f0a3c4', 'circle-opacity': 0.18, 'circle-blur': 0.8 } });
      ready.current = true; pending.current();
    });
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  useEffect(() => {
    const apply = () => {
      const m = map.current!; (m.getSource('area') as maplibregl.GeoJSONSource).setData(data?.area_geojson ?? EMPTY);
      markers.current.forEach((x) => x.remove()); markers.current = [];
      const b = new maplibregl.LngLatBounds();
      // Group exact matches by building (many units share one address).
      const byB = new Map<string, NonNullable<typeof data>['exact']>();
      for (const it of data?.exact ?? []) { if (it.listing.lat == null || it.listing.lng == null) continue; const k = it.listing.building_id; byB.set(k, [...(byB.get(k) ?? []), it]); }
      for (const items of byB.values()) {
        const l = items[0].listing; const min = Math.min(...items.map((i) => i.listing.rent));
        const btn = document.createElement('button'); btn.className = 'pin'; btn.type = 'button';
        btn.setAttribute('aria-label', `${l.building_name}, ${items.length} exact match${items.length > 1 ? 'es' : ''}, from $${min.toLocaleString()}`);
        btn.innerHTML = `<span>${rentLabel({ ...l, rent: min }).main.replace('From ', '')}</span>${items.length > 1 ? `<i>${items.length}</i>` : ''}`;
        btn.dataset.ids = items.map((i) => i.listing.id).join(',');
        btn.onclick = () => onSelect(items[0].listing.id);
        markers.current.push(new maplibregl.Marker({ element: btn }).setLngLat([l.lng!, l.lat!]).addTo(m)); b.extend([l.lng!, l.lat!]);
      }
      for (const d of destinations) {
        const e = document.createElement('div'); e.className = 'dest-pin'; e.setAttribute('role', 'img'); e.setAttribute('aria-label', `Destination: ${d.label}`); e.innerHTML = `<span>★</span><em>${d.label}</em>`;
        markers.current.push(new maplibregl.Marker({ element: e }).setLngLat([d.lng, d.lat]).addTo(m)); b.extend([d.lng, d.lat]);
      }
      if (!b.isEmpty()) m.fitBounds(b, { padding: fitPad(), maxZoom: 14.5, duration: 900 });
    };
    if (ready.current) apply(); else pending.current = apply;
  }, [data, destinations, onSelect]);

  useEffect(() => {
    markers.current.forEach((mk) => { const e = mk.getElement(); e.classList.toggle('sel', !!selected && (e.dataset.ids ?? '').split(',').includes(selected)); });
    const it = [...(data?.exact ?? []), ...(data?.stretch ?? [])].find((x) => x.listing.id === selected);
    if (it?.listing.lat != null && map.current) map.current.easeTo({ center: [it.listing.lng!, it.listing.lat!], duration: 600, padding: fitPad() });
  }, [selected, data]);

  return <div ref={el} className="map" role="region" aria-label="Map of matched listings" />;
}
function fitPad() { const mobile = window.matchMedia('(max-width: 820px)').matches;
  return mobile ? { top: 60, bottom: window.innerHeight * 0.5, left: 30, right: 30 } : { top: 70, bottom: 70, left: 520, right: 70 }; }
