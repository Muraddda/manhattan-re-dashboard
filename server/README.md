# Skyline Rentals API — local demo back end

Cloudflare Worker (TypeScript) + **local** D1 (SQLite under `.wrangler/`). Runs entirely on your machine with
`wrangler dev --local`: no Cloudflare login, no account resources, no cost. `database_id` in `wrangler.toml` is a placeholder.

Requires Node 20 (wrangler 3.x is pinned because wrangler 4 needs Node 22).

## Setup
```bash
npm install
npm run seed          # geocode (cached) + apply migrations + load all CSV rows into local D1
npm run dev           # wrangler dev --local on http://localhost:8787
npm test              # vitest unit tests (matching rules)
npm run typecheck
```
Reset the local DB: `rm -rf .wrangler/state && npm run seed`.

## Seeding (`seed/seed.mjs`)
```bash
node seed/seed.mjs                         # default sources (below)
node seed/seed.mjs a.csv b.csv             # any list of CSVs in listings-import-template.csv format
node seed/seed.mjs --no-load               # write seed/seed.sql only
node seed/seed.mjs --refresh-geocodes      # ignore the cache
node seed/seed.mjs --owners log.csv ...    # buildings-log CSV (building,owner,...) for owner + rent_basis
node seed/seed.mjs --exclude-owner=LeFrak  # drop every building of an owner and reseed (repeatable flag)
```
Default sources, in priority order: `data-analyst/poc-100/listings.csv`, `poc-100/browser-sites.csv`,
`poc-100/listings-batch2.csv`, `trial-10/listings.csv` (563 unique units; all 159 trial-10 rows are duplicates of poc-100).
Rows are de-duplicated by (building address, city, unit); the first file wins (trial-10 is fully covered by poc-100).

What it does:
- **Geocoding** per distinct building address. Order: `seed/geocode-overrides.json` (verified pins, always win) →
  NYC GeoSearch (`geosearch.planninglabs.nyc`, NY only) → US Census onelineaddress geocoder (NJ, and NY fallback) →
  `seed/building-coords.json` (building public address, still geocoded by Census; only if the CSV address fails).
  A hit is accepted only if house number + street match the input (e.g. Census "30 Park Lane North" → "30 PARK LN S" is rejected).
  Results are cached in `seed/geocodes.json`. Failures get lat/lng null, are printed, and show up in
  `GET /api/listings/needs-location`. `geocode_source` is stored per building.
- **pets_policy** normalized to `allowed|cats|dogs|none|unknown` (blank → unknown).
- **available_date**: `Now`/`Immediate`/`Immediately`/`Available Now` → `checked_at` with `available_now=true`;
  blank stays null; `Nov 3` → next occurrence on/after `checked_at`; `M/D/YYYY` accepted.
- **owner** per building from `poc-100/buildings-log.csv` ("Newport Rentals (LeFrak)" → `LeFrak`, "unknown (...)" → null).
- **source_flags**: `owner_opposes_scraping` on every LeFrak building and on any row whose notes say "owner opposes scraping" (any case).
  Rows stay loaded; flags are agent-only.
- **gross_rent**: for `net_effective` rows, parsed from notes only when stated ("gross rent $8,075"); otherwise null. Never guessed.
- **rent_basis**: row notes (net effective / net rent shown, incl. Halletts Point's "may reflect net-effective" → `net_effective`; lowest base rent → `lowest_term`, base rent + asterisked total → `base_before_fees`,
  12-month → `twelve_month`) > owner from buildings-log (UDR → lowest_term, Newport → base_before_fees) >
  name rule (StuyTown → `twelve_month`) > `listed`.
- **Glenwood** rows have no unit number: the unit is stored as `ID <listing id>` and the note says so.
- **unverified** flag: manual list in the seed (Parkside West #2412 rent outlier) OR pets_policy unknown.
- Writes `seed/seed-report.json` (counts, failures, needs_location, rent_basis per building).

## Routes (see `../api-contract-v1.md`)
`GET /api/health` · `GET /api/listings?state=&beds=&max_rent=&include_stale=` · `GET /api/listings/needs-location` ·
`GET|PATCH|DELETE /api/listings/:id` · `POST /api/listings` · `POST /api/listings/import` (multipart `file`) ·
`GET|POST /api/clients` · `GET|PATCH /api/clients/:id` · `POST /api/clients/:id/match` · `POST /api/match` ·
`GET|PATCH /api/settings` · `POST /public/requests` · `GET /api/requests?status=new`

Turnstile: `TURNSTILE_ENABLED="false"` (default in `wrangler.toml`) accepts any non-empty `turnstile_token`.
Set it to `"true"` and put `TURNSTILE_SECRET=...` in `.dev.vars` (gitignored) to verify for real. Never commit secrets.
`TODAY=YYYY-MM-DD` in `.dev.vars` pins "today" (default: today in America/New_York).

Example:
```bash
curl -s localhost:8787/api/health
curl -s -XPOST localhost:8787/api/match -H 'content-type: application/json' -d '{
  "hard_rules":{"budget_max":5000,"beds_min":1,"move_in_date":"2026-10-30","pets":"cat","assistance_animal":false},
  "destinations":[{"label":"FiDi","lat":40.7075,"lng":-74.0113,"max_minutes":30}]}'
```

## Matching rules (`src/match.ts`)
- Locked (never bent): **pets**, **destinations**. Assistance animals never exclude a no-pet building.
  Unknown pet policy → status `unknown`, never `satisfied`, not excluded, not a bend.
- Budget is checked on `gross_rent ?? rent`; the detail names the figure, e.g. "$4,500 gross ($4,125 net effective) vs budget $4,600".
  ≤ budget satisfied; ≤ +10% adjusted (integer math `rent*100 <= budget*110`).
- Beds: more beds than `beds_min` (no `beds_max`) satisfied; up to 2 fewer, or up to 2 above `beds_max`, adjusted.
- Baths: extra baths satisfied; up to 1 below `baths_min` adjusted (half baths count 0.5). Beds and baths may both bend.
- Move-in: past date / available_now → available today. On/before move-in up to 30 days early satisfied; >30 days early
  not_satisfied; 1–10 days late adjusted; >10 late not_satisfied. Null date → `unknown` "Move-in date not listed" (not a bend).
- Destinations: haversine straight-line at 20 km/h, raw float compared to `max_minutes` (exactly max passes).
- No coordinates → excluded (`excluded_count.no_geocode`) and returned in `needs_location`.
- Stale: `checked_at` MORE than `listing_stale_days` (default 7) days old; excluded unless `include_stale: true`.
- Exact = nothing adjusted (`unknown` allowed); stretch = ≥1 adjusted, all within limits, nothing locked failed.
- Score = 1000 × (preference tags found in amenities) + 100 × rent closeness to budget. Sorted by score desc.
- `area_geojson`: one convex-hull Polygon per tier (`properties.tier`, only if ≥3 distinct points) + a Point per listing
  (`properties.tier`, `properties.listing_id`).

## QA cases
`qa/run_qa_cases.py` runs `/workspace/team/qa/matching-test-cases.json` against a second local instance:
```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/qa-state
npx wrangler dev --local --port 8788 --inspector-port 9230 --persist-to .wrangler/qa-state &
python3 qa/run_qa_cases.py
```

## Layout
`src/index.ts` routes · `src/match.ts` rules · `src/normalize.ts` CSV/pets/dates/rent_basis · `src/types.ts` ·
`migrations/0001_init.sql` · `seed/` · `test/match.test.ts` · mocks in `../mocks/`.

## Running QA's 70 cases (separate server on 8788)
```bash
cd /workspace/team/back-end/server
rm -rf .wrangler/qa-state
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/qa-state
nohup npx wrangler dev --local --ip 127.0.0.1 --port 8788 --inspector-port 9231 --persist-to .wrangler/qa-state > /tmp/wrangler-qa-8788.log 2>&1 &
sleep 12 && curl -s http://localhost:8788/api/health
python3 qa/run_qa_cases.py | tee qa/last-results.txt
```
