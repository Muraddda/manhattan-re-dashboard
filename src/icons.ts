// Map markers for deck.gl IconLayer: a white disc with a soft shadow, a coloured core and a Lucide glyph (ISC).
// The UI uses the same icons through lucide-react, so map and panels speak one icon language.
const GLYPHS = {
  grocery: '<path d="m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18"/><path d="M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25"/><circle cx="18" cy="20" r="2"/><circle cx="8" cy="20" r="2"/>',
  schools: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  parks: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  subway: '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  development: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
} as const;
export type IconKey = keyof typeof GLYPHS;
export const COLORS: Record<IconKey, string> = { grocery: '#e8890c', schools: '#0d9488', parks: '#16a34a', subway: '#2563eb', development: '#7c3aed' };

const S = 96; // atlas px; drawn at ~28 px so it stays crisp on 3x screens
const marker = (k: IconKey) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0b1220" flood-opacity=".28"/></filter></defs>
<circle cx="48" cy="46" r="38" fill="#fff" filter="url(#s)"/><circle cx="48" cy="46" r="31" fill="${COLORS[k]}"/>
<g transform="translate(30 28) scale(1.5)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[k]}</g></svg>`);
const URLS = Object.fromEntries(Object.keys(GLYPHS).map(k => [k, marker(k as IconKey)])) as Record<IconKey, string>;
export const iconSpec = (k: IconKey) => ({ url: URLS[k], width: S, height: S, anchorY: S / 2, id: k });
