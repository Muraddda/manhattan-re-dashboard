# Skyline · Manhattan homes for independent agents

A map-first tool for showing Manhattan homes to clients and pricing them. Every number comes from public data
(NYC Open Data, MTA, OpenStreetMap). Nothing is sample data.

Live: https://manhattan-re-dashboard.aerkin.workers.dev

## What it does

**For a buyer** (pick *Buyer* at the top):
- **Homes:** every recorded Manhattan sale of the last 12 months (about 13,500), plus the agent's own listings.
  - Filter by status, type, price, size and recency.
  - Each home gets a value badge: its price per ft² against the neighborhood median for the same type.
- **Client needs:** dietary requirements, places the client must reach (office, school, family) and a minimum
  zoned-school score.
  - Every home in the list then shows "~18 min to 1 Liberty Plaza · Kosher ≤ 4 min · Zoned school 82%".
  - One switch keeps only the homes that meet all of the needs; you can also sort by commute.
- **Commute:** door-to-door subway + walking time to any address, computed in the browser from the MTA timetable
  (weekday-morning averages, including waits and transfers).
  - Each trip shows its legs with official line bullets and is drawn on the map.
  - **Time map** shades everywhere reachable in 15 / 30 / 45 minutes.
- **Schools:**
  - Zoned elementary and middle school (2024-25 zones) with 2026 reading and math proficiency against the NYC average.
  - District middle schools ranked by score, and nearby high schools by graduation rate.
- **Food & dietary:**
  - Kosher, halal, vegan, vegetarian, gluten-free and organic options, each with the nearest grocery and the
    restaurants within a 10-minute walk.
  - Nearest premium grocer, supermarket, and organic, Asian, Indian, Latin and Italian markets.
  - Dining by cuisine, share of health-grade-A restaurants, and Michelin-starred places within 20 minutes.
- **Area:**
  - Reported felonies and 311 noise near the home against the Manhattan average.
  - FEMA flood zone, parks and playgrounds, and live Citi Bike docks.

**For a seller:**
- **Value:**
  - A comps-based estimate: median $/ft² of the nearest same-type sales × size, with the middle-half range.
  - The comparable sales themselves.
  - Every recorded sale in the building since 2016.
  - The neighborhood's 12-month trend.
- **Market tab:** 12-month and 10-year Manhattan trends, plus a sortable neighborhood table (click a neighborhood to see its homes).

**For a developer:**
- **Develop tab, Pipeline:** every new residential building filed since 2019 (DCP Housing Database), with units and status.
- **Develop tab, Soft sites:** private lots whose building uses far less residential floor area than zoning allows.
- **Building section:** zoning, FAR built vs max, unused floor area, landmark or historic district, assessed value.

**For an agent** (Tour tab):
- **Tour:** shortlist homes (♥), see travel time between consecutive showings, and reorder them by travel time ("Best order").
- **Share:** copy a client link that opens the same profile and shortlist, or print a client report.
- **My listings:** import a CSV (address, unit, price, beds, baths, sqft, type, status, url, notes).
  - Addresses are located with the NYC geocoder, and rows that don't match are reported rather than guessed.
  - Listings stay in that browser.

Search any NYC address or building and you get the same analysis even if it never sold. Clicking any building on
the map resolves its tax lot (BBL).

## Why there are no "active listings" by default
There is no free, legal feed of Manhattan for-sale listings: REBNY RLS needs brokerage membership, and scraping
StreetEasy or Zillow breaks their terms. The map therefore shows recorded sales, and agents import their own listings.
An IDX or RLS feed can be added later as another data source.

## Data
| Data | Source | Refresh |
|---|---|---|
| Sales (12 months) | DOF Rolling Sales `usep-8jbt` | daily by the Worker cron (DOF publishes monthly) |
| 10-year price trend | DOF Annualized Sales `w2pb-icbu` | daily |
| New developments | DCP Housing Database `br6q-ssj3` | daily |
| Restaurants + grades | DOHMH inspections `43nn-pn8j` | daily |
| Soft sites | PLUTO `64uk-42ks` | daily |
| Lot positions, condo unit sizes | PLUTO + DOF assessment roll `8y4t-faws` → `public/data/lots.json` | weekly (GitHub Action) |
| Schools, zones, scores | DOE zones (`cmjf-yawu`, `t26j-jbq7`, `8ugf-3d8u`), locations `wg9x-4ke6`, InfoHub test results, graduation `mjm3-8dw8` → `schools.json` | weekly |
| Subway graph | MTA GTFS static → `transit.json` | weekly |
| Groceries, diets, parks | OpenStreetMap via Overpass → `places.json` | weekly |
| Michelin stars | Wikipedia list (2025 guide) → `dining.json` | weekly |
| Lot facts, building sales, crime, noise | PLUTO, `w2pb-icbu`, NYPD `5uac-w243`, 311 `erm2-nwe9` | live per click |
| Citi Bike | GBFS (proxied by the Worker) | live |

Known limits:
- DOF records no bedrooms and no co-op unit sizes, so co-ops are valued on price only.
- School locations are the 2019-20 file, and zones are 2024-25.
- Graduation rates are for the class of 2023.
- Commute times are typical weekday-morning averages from the timetable, not live arrivals.

## Architecture
- `src/`: React + MapLibre GL 6. The whole scene is one WebGL context: the basemap's building tiles for 3D,
  GeoJSON layers for everything else. It runs at 1× pixel ratio without MSAA on weak or software GPUs (`?lite` and `?hq` force it).
  - `src/lib/`: data logic.
    - `transit.ts`: Dijkstra over (station, line) states.
    - `value.ts`: comps.
    - `sales.ts`: DOF rows to placed homes.
    - `schools.ts`, `places.ts` and `area.ts`: live lookups.
  - `src/ui/`: panels.
  - `src/map/scene.ts`: map layers.
- `worker/`: Cloudflare Worker. It serves the static build, `/api/data/:key` from KV (filled on first request,
  refreshed daily by cron `23 9 * * *`; upstream bytes are streamed into KV unparsed, so CPU stays tiny) and
  `/api/citibike/*`. Its config is in `wrangler.jsonc`, with KV namespace `manhattan-re-dashboard-data`.
- `scripts/build-*.mjs`: static data builders. `.github/workflows/refresh-static.yml` runs them weekly and commits the results.
  The MTA timetable expires every few months, which this refresh covers.

## Run
    npm install
    npm run dev        # http://localhost:5173 (uses the committed snapshots in public/data)
    npm run worker     # production build behind the real Worker on :8787 (local KV)
    npm run build      # type-checks app + worker, then builds
    npm test           # sales placement + valuation self-check on the snapshot
    npm run data       # rebuild every static dataset (needs network; ~2 min)
URL flags: `?static` skips the intro flight (screenshots), `?lite` / `?hq` force the render tier.
`SOCRATA_APP_TOKEN` (env var for the scripts) or the Worker secret `SODA_APP_TOKEN` raises NYC Open Data rate limits.
