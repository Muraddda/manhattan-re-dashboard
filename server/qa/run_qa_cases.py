#!/usr/bin/env python3
"""Run QA's matching-test-cases.json against a LOCAL wrangler dev (separate persist dir, port 8788).
Each case: wipe listings, insert that case's fixtures (listing id = QA alias), call the endpoint, compare.
Usage: start `npx wrangler dev --local --port 8788 --persist-to .wrangler/qa-state` then run this script."""
import csv, json, math, subprocess, sys, urllib.request, datetime as dt, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = json.load(open("/workspace/team/qa/matching-test-cases.json"))["cases"]
ROWS = list(csv.DictReader(open("/workspace/team/data-analyst/trial-10/listings.csv")))
GEO = json.load(open(f"{ROOT}/seed/geocodes.json"))
OVR = json.load(open(f"{ROOT}/seed/geocode-overrides.json"))
BASE = "http://localhost:8788"
RUN = "2026-10-16"
R = 6371.0088
sys.path.insert(0, ROOT)

def coords(r):
    addr = ", ".join(x for x in [r["address"], r["city"], " ".join(x for x in [r["state"], r["zip"]] if x)] if x)
    if r["address"] in OVR: return OVR[r["address"]]["lat"], OVR[r["address"]]["lng"]
    g = GEO.get(("geosearch|" + addr) if r["state"] == "NY" else addr)
    if g and g.get("lat") is not None and "PARK LN S" not in (g.get("matched") or "") or (g and r["address"].startswith("25 Park Lane South")):
        return g["lat"], g["lng"]
    return None, None

def real(b, u): return next(x for x in ROWS if x["building_name"].startswith(b) and x["unit"] == u)
def avail(s):
    s = s.strip()
    if s.lower() in ("now", "immediate", "available now"): return RUN, 1
    return (s or None), 0
REAL = {"PW-3007": ("Parkside West", "3007"), "PW-1106": ("Parkside West", "1106"), "PW-3003": ("Parkside West", "3003"),
        "H-11H": ("10 Hanover", "11H"), "H-21G": ("10 Hanover", "21G"), "V34-N07H": ("View 34", "N07H"), "PW-1515": ("Parkside West", "1515")}
def north(minutes):
    km = minutes / 3.0
    return 40.7270 + km / R * 180 / math.pi, -74.0340

def fixture(alias):
    """Returns dict(row fields) for a QA alias."""
    if alias in REAL: r = dict(real(*REAL[alias])); lat, lng = coords(r)
    else:
        r = dict(real("Parkside West", "3007")); lat, lng = coords(r)
        if alias.startswith("SYN-RENT-"): r["rent"] = alias.split("-")[-1]
        if alias.startswith("SYN-PET-"): r["pets_policy"] = alias.split("-")[-1]
        if alias.startswith("SYN-GEO-"): lat, lng = north(float(alias.split("-")[-1]))
        if alias == "SYN-NOGEO": lat, lng = None, None
        if alias.startswith("SYN-AGE-"): r["checked_at"] = str(dt.date.fromisoformat(RUN) - dt.timedelta(days=int(alias.split("-")[-1])))
    r.setdefault("checked_at", RUN)
    if not alias.startswith("SYN-AGE-"): r["checked_at"] = RUN
    return alias, r, lat, lng

def q(v): return "NULL" if v is None else (str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
def load(fixtures):
    sql = ["DELETE FROM match_results; DELETE FROM match_runs; DELETE FROM listings; DELETE FROM buildings; DELETE FROM clients; UPDATE settings SET listing_stale_days=7;"]
    items = []
    if fixtures == "ALL_SEED":
        for i, r in enumerate(ROWS): items.append((f"{r['building_name']} #{r['unit']}", r, *coords(r)))
    else: items = [fixture(a) for a in fixtures]
    for alias, r, lat, lng in items:
        bid = "b_" + alias
        sql.append(f"INSERT INTO buildings (id,brokerage_id,name,address,city,state,zip,lat,lng) VALUES ({q(bid)},'brk_demo',{q(r['building_name'])},{q(r['address'])},{q(r['city'])},{q(r['state'])},{q(r['zip'])},{q(lat)},{q(lng)});")
        ad, an = avail(r["available_date"])
        pets = (r.get("pets_policy") or "unknown").strip() or "unknown"
        sql.append(f"INSERT INTO listings (id,brokerage_id,building_id,unit,rent,beds,baths,available_date,available_now,pets_policy,source_url,checked_at) VALUES ({q(alias)},'brk_demo',{q(bid)},{q(r['unit'])},{int(float(r['rent']))},{int(r['beds'])},{float(r['baths'])},{q(ad)},{an},{q(pets)},{q(r['source_url'])},{q(r['checked_at'])});")
    open("/tmp/qa-case.sql", "w").write("\n".join(sql))
    subprocess.run(["npx", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/qa-state", "--file", "/tmp/qa-case.sql"], cwd=ROOT, check=True, capture_output=True)

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"null")

def ids(res, key): return [m["listing"]["id"] for m in res[key]]
def check_std(c, st, res):
    e = c["expected"]; errs = []
    if st != e["http_status"]: return [f"http {st} != {e['http_status']}"]
    if st != 200: return [] if isinstance(res, dict) and "error" in res and {"code", "message"} <= set(res["error"]) else ["bad error body"]
    ex, sx = ids(res, "exact"), ids(res, "stretch")
    if isinstance(e["exact_listing_fixtures"], list):
        if sorted(ex) != sorted(e["exact_listing_fixtures"]): errs.append(f"exact {sorted(ex)} != {sorted(e['exact_listing_fixtures'])}")
        if sorted(sx) != sorted(e["stretch_listing_fixtures"]): errs.append(f"stretch {sorted(sx)} != {sorted(e['stretch_listing_fixtures'])}")
        for a in e["excluded_fixtures"] if isinstance(e["excluded_fixtures"], list) else []:
            if a in ex or a in sx: errs.append(f"{a} should be excluded")
    got_b = sorted((b["rule"], sorted(b["listing_ids"])) for b in res["bent_rules"])
    exp_b = sorted((b["rule"], sorted(b["listing_ids"])) for b in e["bent_rules"])
    if e["bent_rules"] and got_b != exp_b: errs.append(f"bent_rules {got_b} != {exp_b}")
    if not e["bent_rules"] and isinstance(e["stretch_listing_fixtures"], list) and not e["stretch_listing_fixtures"] and got_b: errs.append(f"unexpected bent_rules {got_b}")
    allm = {m["listing"]["id"]: m for m in res["exact"] + res["stretch"]}
    for a, ck in (e.get("checklist") or {}).items():
        if a not in allm: continue
        got = {i["rule"]: i["status"] for i in allm[a]["checklist"]}
        diff = {k: (got.get(k), v) for k, v in ck.items() if got.get(k) != v}
        if diff: errs.append(f"{a} checklist got/exp {diff}")
    return errs

results = []
for c in CASES:
    cid, inp = c["id"], c["input"]
    try:
        if isinstance(inp, str) or (isinstance(inp, dict) and "A" in inp and isinstance(inp["A"], str)):
            results.append((cid, "NOT RUN", "static/descriptive case, not an endpoint call")); continue
        load(c["fixtures"])
        if cid == "COM-03":
            g = GEO["geosearch|95 Wall Street, New York, NY 10005"]; inp = json.loads(json.dumps(inp)); inp["destinations"][0].update(lat=g["lat"], lng=g["lng"])
        if isinstance(inp, dict) and "A" in inp:
            outs = []
            for k in [k for k in inp if len(k) == 1]:
                st, res = call("POST", "/api/match", inp[k]); outs.append((k, st, res))
            strip = lambda r: {k: v for k, v in r.items() if k not in ("run_id", "generated_at")} if isinstance(r, dict) else r
            errs = []
            if any(st != 200 for _, st, _ in outs): errs.append("non-200: " + str([(k, st) for k, st, _ in outs]))
            elif cid.startswith("FH"):
                if len({json.dumps(strip(r), sort_keys=True) for _, _, r in outs}) != 1: errs.append("results differ between variants")
            elif cid.startswith("PET-06") or cid.startswith("RNK"):
                sets = {(tuple(sorted(ids(r, "exact"))), tuple(sorted(ids(r, "stretch"))), json.dumps(r["excluded_count"])) for _, _, r in outs}
                if len(sets) != 1: errs.append(f"sets differ {sets}")
                ef = c["expected"]["exact_listing_fixtures"]
                if isinstance(ef, list) and sorted(ids(outs[0][2], "exact")) != sorted(ef): errs.append(f"exact {sorted(ids(outs[0][2], 'exact'))} != {sorted(ef)}")
                for _, _, r in outs:
                    sc = [m["score"] for m in r["exact"]]
                    if sc != sorted(sc, reverse=True): errs.append("exact not sorted by score")
            results.append((cid, "PASS" if not errs else "FAIL", "; ".join(errs))); continue
        if inp.get("endpoint") == "POST /api/clients/:id/match":
            st, cl = call("POST", "/api/clients", {"name": "QA", **inp["client"]})
            st, res = call("POST", f"/api/clients/{cl['id']}/match", inp.get("body", {}))
        else:
            if "settings" in inp: call("PATCH", "/api/settings", inp["settings"])
            if cid == "STL-03": call("PATCH", "/api/settings", {"listing_stale_days": 10})  # pre-step from purpose text
            if cid == "STL-04": call("PATCH", "/api/listings/SYN-AGE-8", {"checked_at": RUN})
            body = {k: v for k, v in inp.items() if k not in ("settings",)}
            st, res = call("POST", "/api/match", body)
        e = c["expected"]
        if isinstance(e["http_status"], str):
            ok = st in (200, 400); results.append((cid, "PASS" if ok else "FAIL", f"got {st} (accepts 200 or 400)")); continue
        if isinstance(e["stretch_listing_fixtures"], list) and e["stretch_listing_fixtures"] and " [" in e["stretch_listing_fixtures"][0]:
            exp = sorted(x.split(" [")[0] for x in e["stretch_listing_fixtures"])
            got = sorted(ids(res, "stretch")); ex = sorted(ids(res, "exact"))
            errs = [] if (got == exp and ex == sorted(e["exact_listing_fixtures"])) else [f"exact {len(ex)} vs {len(e['exact_listing_fixtures'])}; stretch {len(got)} vs {len(exp)}; missing {sorted(set(exp)-set(got))[:4]} extra {sorted(set(got)-set(exp))[:4]}"]
            results.append((cid, "PASS" if not errs else "FAIL", "; ".join(errs))); continue
        if cid == "PER-03":
            errs = [] if not res["exact"] and not res["stretch"] else [f"got exact {len(res['exact'])} stretch {len(res['stretch'])}, QA expects 0/0 (Q1 'exclude unknown' proposal)"]
            results.append((cid, "PASS" if not errs else "FAIL", "; ".join(errs))); continue
        if cid == "COM-04":  # QA: assert only SYN-NOGEO
            errs = [] if st == 200 and "SYN-NOGEO" not in ids(res, "exact") + ids(res, "stretch") and res["excluded_count"]["no_geocode"] >= 1 else ["SYN-NOGEO not excluded as no_geocode"]
            results.append((cid, "PASS" if not errs else "FAIL", "")); call("PATCH", "/api/settings", {"listing_stale_days": 7}); continue
        errs = check_std(c, st, res)
        if cid == "STL-03": call("PATCH", "/api/settings", {"listing_stale_days": 7})
        if cid == "SHP-05" and st == 200 and res["exact"]:
            m = res["exact"][0]["travel"][0]["minutes"]
            if not (29.4 <= m <= 29.6): errs.append(f"minutes {m}")
        if cid == "EMP-01" and st == 200 and res["area_geojson"]["features"]: errs.append("geojson not empty")
        if cid == "COM-04" and st == 200 and res["excluded_count"]["no_geocode"] < 1: errs.append("no_geocode < 1")
        if cid == "STL-01" and st == 200 and res["excluded_count"]["stale"] != 2: errs.append(f"excluded_count.stale={res['excluded_count']['stale']} (QA expects 2)")
        results.append((cid, "PASS" if not errs else "FAIL", "; ".join(errs)))
    except Exception as ex:
        results.append((cid, "ERROR", repr(ex)[:200]))
call("PATCH", "/api/settings", {"listing_stale_days": 7})
for r in results: print("\t".join(r))
from collections import Counter
print(Counter(r[1] for r in results))
