# Skyline Realty — Manhattan South 3D dashboard (test run)

Vite + React + TS, MapLibre GL (OpenFreeMap `positron` style, no API key) + deck.gl overlays (`MapboxOverlay`).
Cities: Skylines II-inspired look: light warm-gray ground, pastel extruded buildings with ambient + directional
lighting, green parks, blue water, ~58° pitch, rounded glass panels, round layer-toggle toolbar, bubbly pin icons,
cyan/teal selection highlight.

Area: Manhattan south of 59th St / Central Park (coarse polygon in `scripts/area.mjs`, inside bbox -74.03..-73.93, 40.70..40.77).

## Run
    npm install
    npm run dev        # http://localhost:5173
    npm run build
    node scripts/screenshot.mjs "http://localhost:5173/?static"   # -> screenshot.png
Amenities: hidden on load; they pop up within `NEARBY_RADIUS_M` (400 m, `src/App.tsx`) of the selected listing/building with a ring. Toolbar amenity buttons cycle nearby-only (default) → show all → off. Esc or empty click clears.
URL flags: `?static` stops the pulse animation (for headless/software GL), `?shadows` enables experimental deck.gl shadow maps.

## Data
| File | What |
|---|---|
| `public/listings.csv` | **SAMPLE** listings (fake). Swap in real data with the same columns. |
| `public/data/developments.json` | **SAMPLE** new developments (fake). |
| `public/data/buildings.json` | ~36.9k building footprints + heights (OSM via OpenFreeMap tiles). |
| `public/data/amenities.json` | Real OSM grocery/supermarkets, schools, parks, subway stations. |
| `public/data/overpass/*.json` | Raw Overpass caches (grocery, schools) captured when a mirror briefly responded. |

Regenerate: `node scripts/extract-tiles.mjs` (used, reliable) or `node scripts/fetch-osm.mjs` (Overpass, retries across
mirrors; Overpass was returning 500/502/504 during the build, so the tile extractor is the default source).

## Building IDs (design choice)
Buildings are rendered by us (deck.gl `SolidPolygonLayer`, extruded by `render_height`), not by the basemap, so we own the IDs.
OpenFreeMap z14 tiles merge neighbouring footprints into one multipolygon feature, so the tile feature id is not per-building.
Instead each footprint ring is one building; rings clipped at tile borders are re-joined, and the ID is
`bld-<lat 5dp>-<|lon| 5dp>` of the footprint centroid (~1 m), suffixed `-2`, `-3`… for stacked parts sharing a centroid.
Deterministic across reloads/rebuilds while the OSM geometry is unchanged.

Per-building data lives in a `BuildingStore = Record<buildingId, BuildingData>` (`src/types.ts`); listings are attached
automatically via point-in-polygon (`matchBuilding`). Click a building → teal highlight + side panel with ID and attached data.

## Walking minutes
Straight-line distance × 1.25 grid detour ÷ 80 m/min. Approximate only (no routing).

## Simplified city (default) vs detailed (`?detail`)
Default view loads `public/data/blocks.json` (≈3.7k features) built by `scripts/make-blocks.py`
(`node scripts/extract-streets.mjs && .venv/bin/python scripts/make-blocks.py`; needs `pip install shapely numpy`).
- Blocks = Manhattan-south polygon minus buffered OSM street centerlines (from the tiles). One extruded footprint per block at the
  area-weighted average height of its buildings; id `blk-<lat5>-<|lon|5>`. Blocks with <35% building coverage (parks, plazas) keep individual buildings.
- Landmarks stay detailed: height >200 m, or >2.5× block average and >120 m, or footprint contains a curated famous-building point
  (Empire State, One WTC, Chrysler, Flatiron, 432 Park, Woolworth, One Vanderbilt, …; tile data has no name/tourism/historic tags).
- Listing buildings are cut out of their block and drawn individually in pulsing coral (raised to block roof +4 m so they stay visible).
- Each block lists its `buildingIds`, and `buildingToBlock` maps detailed ids → block ids, so the per-building `BuildingStore` still works.
Open `http://localhost:5173/?detail` for the original per-footprint mode (`buildings.json`).
Listings have no pins: find them via the coral buildings or the Listings list in the stats panel.

## GitHub copy: what is not included
The GitHub repo was uploaded file-by-file through the GitHub API (the box had no git credentials), so:
- `public/data/buildings.json` (~12 MB) and `public/data/blocks.json` (~3.5 MB) are not committed. Regenerate them:
  `npm install && node scripts/extract-tiles.mjs && node scripts/extract-streets.mjs && python3 -m venv .venv && .venv/bin/pip install shapely numpy && .venv/bin/python scripts/make-blocks.py`
  (Note: `extract-tiles.mjs` also rewrites `amenities.json` from current tiles.)
- Binary images (`screenshot*.png`, `reference/shot-*`) are not included; `reference/NOTES.md` describes the style reference.
- Local git history was not transferred; the repo starts from a snapshot of the latest commit.
