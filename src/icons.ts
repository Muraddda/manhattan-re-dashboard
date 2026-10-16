// Bubbly SVG pin icons (data URLs) for deck.gl IconLayer.
const pin = (fill: string, glyph: string, art = '') => `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="120" viewBox="0 0 96 120">
<defs><radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".45" stop-color="${fill}" stop-opacity="1"/><stop offset="1" stop-color="${fill}"/></radialGradient>
<filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#1b2a3a" flood-opacity=".35"/></filter></defs>
<g filter="url(#s)"><path d="M48 112 C40 96 12 76 12 48 a36 36 0 1 1 72 0 C84 76 56 96 48 112 Z" fill="url(#g)" stroke="#fff" stroke-width="5"/></g>
<text x="48" y="62" font-size="36" text-anchor="middle" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif" fill="#fff" font-weight="800">${glyph}</text>${art}</svg>`);
export const ICONS = {
  listing: { url: pin('#ff6f4f', '$'), color: [255, 111, 79] },
  development: { url: pin('#8a5cf6', '★'), color: [138, 92, 246] },
  grocery: { url: pin('#f59e0b', '', '<path d="M28 34h8l6 20h22l5-14H39" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="44" cy="62" r="4" fill="#fff"/><circle cx="62" cy="62" r="4" fill="#fff"/>'), color: [245, 158, 11] },
  schools: { url: pin('#0f9f95', '', '<path d="M48 30 L76 42 L48 54 L20 42 Z" fill="#fff"/><path d="M32 48v10c0 5 32 5 32 0V48l-16 7z" fill="#fff"/><path d="M72 44v14" stroke="#fff" stroke-width="3"/>'), color: [15, 159, 149] },
  parks: { url: pin('#4caf50', 'P'), color: [76, 175, 80] },
  subway: { url: pin('#2f7de1', 'M'), color: [47, 125, 225] },
} as const;
export type IconKey = keyof typeof ICONS;
export const iconSpec = (k: IconKey) => ({ url: ICONS[k].url, width: 96, height: 120, anchorY: 120, id: k });
