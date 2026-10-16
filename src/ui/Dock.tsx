// Map layer dock. Each persona starts with the layers it needs; everything is one tap away.
import { Building2, Construction, GraduationCap, Layers as LayersIcon, TrainFront, Utensils } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Persona } from '../state';

export interface Layers { homes: boolean; subway: boolean; schools: boolean; food: boolean; devs: boolean; soft: boolean }
export const DEFAULT_LAYERS: Record<Persona, Layers> = {
  buyer: { homes: true, subway: true, schools: false, food: true, devs: false, soft: false },
  seller: { homes: true, subway: false, schools: false, food: false, devs: false, soft: false },
  developer: { homes: false, subway: false, schools: false, food: false, devs: true, soft: true },
  agent: { homes: true, subway: true, schools: false, food: true, devs: false, soft: false },
};
const ITEMS: { key: keyof Layers; label: string; tip: string; Icon: LucideIcon; color: string }[] = [
  { key: 'homes', label: 'Homes', tip: 'Recent sales (green = below area $/ft², red = above) and your listings', Icon: Building2, color: '#f2643d' },
  { key: 'subway', label: 'Subway', tip: 'Subway lines and stations', Icon: TrainFront, color: '#2563eb' },
  { key: 'schools', label: 'Schools', tip: 'Public schools and elementary school zones (2024-25)', Icon: GraduationCap, color: '#0d9488' },
  { key: 'food', label: 'Food', tip: "Groceries, parks and the client's dietary matches around the selected home", Icon: Utensils, color: '#db2777' },
  { key: 'devs', label: 'New dev', tip: 'New residential buildings filed since 2019', Icon: Construction, color: '#7c3aed' },
  { key: 'soft', label: 'Soft sites', tip: 'Private lots with large unused residential floor area', Icon: LayersIcon, color: '#7c3aed' },
];

export function Dock({ layers, setLayers }: { layers: Layers; setLayers: (f: (l: Layers) => Layers) => void }) {
  return (
    <nav className="dock" aria-label="Map layers">
      {ITEMS.map(({ key, label, tip, Icon, color }) => (
        <button key={key} className={`dock-btn ${layers[key] ? 'on' : ''}`} style={{ ['--c' as string]: color }} aria-pressed={layers[key]} data-tip={tip} aria-label={`${label}: ${tip}`}
          onClick={() => setLayers(l => ({ ...l, [key]: !l[key] }))}>
          <span className="dock-ico"><Icon size={18} strokeWidth={2.1} /></span><span className="dock-label">{label}</span>
        </button>))}
    </nav>);
}
