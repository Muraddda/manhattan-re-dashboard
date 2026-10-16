-- Skyline Rentals demo schema. Every table carries brokerage_id. No protected-trait fields anywhere.
CREATE TABLE brokerages (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE buildings (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('NY','NJ')), zip TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL, geocode_source TEXT, geocode_confidence TEXT,
  owner TEXT, source_flags TEXT NOT NULL DEFAULT '[]', /* JSON string array */
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE listings (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, building_id TEXT NOT NULL REFERENCES buildings(id),
  unit TEXT NOT NULL, rent INTEGER NOT NULL, gross_rent INTEGER, /* only when stated in the source (net_effective rows) */ beds INTEGER NOT NULL, baths REAL NOT NULL, sqft INTEGER,
  available_date TEXT, available_now INTEGER NOT NULL DEFAULT 0,
  rent_basis TEXT NOT NULL DEFAULT 'listed' CHECK (rent_basis IN ('lowest_term','base_before_fees','twelve_month','net_effective','listed')), pets_policy TEXT NOT NULL DEFAULT 'unknown' CHECK (pets_policy IN ('allowed','cats','dogs','none','unknown')),
  amenities TEXT NOT NULL DEFAULT '', fee_info TEXT, leasing_contact TEXT, source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL, needs_verification INTEGER NOT NULL DEFAULT 0, notes TEXT,
  source_flags TEXT NOT NULL DEFAULT '[]', unverified INTEGER NOT NULL DEFAULT 0, unverified_reason TEXT, -- manual broker-check flag (e.g. rent outlier)
  removed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX listings_brk ON listings(brokerage_id, removed_at);
CREATE TABLE clients (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
  hard_rules_json TEXT NOT NULL, destinations_json TEXT NOT NULL, preferences_json TEXT NOT NULL DEFAULT '{"tags":[]}',
  source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE match_runs (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, client_id TEXT, params_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE match_results (run_id TEXT NOT NULL REFERENCES match_runs(id), brokerage_id TEXT NOT NULL, listing_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('exact','stretch')), score REAL NOT NULL, checklist_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, listing_id));
CREATE TABLE settings (brokerage_id TEXT PRIMARY KEY, listing_stale_days INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE requests (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
  hard_rules_json TEXT NOT NULL, destinations_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE import_jobs (id TEXT PRIMARY KEY, brokerage_id TEXT NOT NULL, status TEXT NOT NULL, rows_ok INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO brokerages (id, brokerage_id, name) VALUES ('brk_demo','brk_demo','Demo Brokerage');
INSERT INTO settings (brokerage_id, listing_stale_days) VALUES ('brk_demo', 7);
