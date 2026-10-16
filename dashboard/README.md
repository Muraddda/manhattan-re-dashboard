# M.Mardan & Co. — Agent match dashboard (PoC front end)

React 19 + TypeScript + Vite + MapLibre GL. Agents only. Builds against `POST /api/match` (see `../../back-end/api-contract-v1.md`).

## Run
```bash
npm install
cp .env.example .env.local  # set VITE_API_BASE=http://127.0.0.1:8787 for the local Back End (wrangler dev); empty = same origin
                            # VITE_API_BASE is baked in at build time: rebuild after changing it.
                            # Back End sends Access-Control-Allow-Origin: *, so no proxy is needed.
npm run dev                 # http://localhost:5174
npm run typecheck
npm run build && npm run preview   # http://localhost:4174
node scripts/geocode.mjs    # (re)geocode new addresses into scripts/geocode-cache.json (NYC GeoSearch / Census)
npm run mocks               # regenerate src/mocks/listings.json from all Data Analyst CSVs (trial-10 + poc-100 listings, browser-sites, batch2; deduped)
```

## Behaviour
- Form: **Hard rules** (budget, beds min/max, baths, move-in, pets 🔒, assistance animal asked separately, up to 3 destinations with max minutes 🔒) and **Agent preferences** (cook at home / eat out, stay in / go out) sent as `preferences.tags` for ranking only. No protected-trait fields.
- Submit → `POST ${VITE_API_BASE}/api/match`. If the API is unreachable / not JSON / 404 / 5xx, `src/mocks/match.ts` computes a contract-shaped `MatchResponse` from the 159 real listings and the UI shows a **Sample response** banner and badge. A 4xx with an `error` body is shown as an error, not masked.
- Map: OpenFreeMap Positron (no key), 2D only (pitch/rotate disabled, extrusions hidden), pastel recolour, OSM/OpenFreeMap attribution. `area_geojson` polygon = match area; one price pin per building for exact matches; destination stars.
- Results: Exact list and agent-only Stretch list (with `bent_rules` summary). Each card has a checklist (satisfied / not satisfied / adjusted / unknown), straight-line travel estimate (labelled), rent basis ("From $X lowest lease term" / "$X base rent before fees"), Available now and Unverified badges.
- Responsive: floating side panel ≥821px, bottom sheet (peek / half / full, tap the handle) below.
- Accessibility: labelled controls, skip link, keyboard tabs (arrow keys), visible focus, AA text contrast, reduced-motion.

## Sample-layer rules (contract v1 + Bill, Oct 16)
- Pets/commute locked; blank pet policy = allowed (`pets_assumed`, "Yes (assumed)").
- Move-in: available on/before move-in up to 30 days early = exact; up to 10 days late = stretch; blank date = `unknown` (not available now). "Now" → `available_date = checked_at`, `available_now: true`.
- Beds: more than asked = exact if within budget; fewer by ≤2 = stretch. Baths fewer by ≤1 = stretch. Beds and baths can both bend; each is listed.
- Budget ≤ +10% = stretch. Stale = checked_at older than 7 days (exactly 7 still matches).
- No coordinates → excluded (`no_geocode`) and shown in a "Needs location" list (rendered from `needs_location`).
- Map: exact area solid violet, stretch area light dashed amber.

## Rent labels and flags
- `rent_basis`: listed · lowest_term ("From $X") · base_before_fees · twelve_month · net_effective ("$G gross · $N net effective (after free months)", or a prominent "NET EFFECTIVE, gross not shown").
- `pets_assumed`: blank pet policy is treated as allowed; the Pets checklist line reads "Yes (assumed)" (satisfied). No extra badge.
- `unverified` (subtle badge, generic flag), `source_flags` (e.g. `owner_opposes_scraping`, subtle agent-only badge).
- Glenwood rows have no unit numbers; the listing ID stands in (`ID 5210`).

## Mock coordinates
`scripts/geocode-cache.json`: NYC Planning GeoSearch for NY, US Census for NJ. Stuyvesant Oval uses supplied GeoSearch coordinates. 110 River Drive (Aquablu) uses an OpenStreetMap override (Census matched the wrong street). `geocode_source` = nyc_geosearch | census | override.
