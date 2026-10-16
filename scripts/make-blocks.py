"""Simplified city geometry: one extruded footprint per street-bounded block.

Inputs : public/data/buildings.json, public/listings.csv, scripts/cache/streets.json (node scripts/extract-streets.mjs)
Output : public/data/blocks.json  (items with the same shape as buildings, kind = block|landmark|listing|building)
Run    : .venv/bin/python scripts/make-blocks.py   (pip install shapely numpy)

Rules
- Blocks = Manhattan-south polygon minus buffered street centerlines (minor 5 m half-width … motorway 12 m).
- A block is merged only if its building coverage >= MIN_COVERAGE; otherwise (parks, plazas) its buildings stay individual.
- Block height = area-weighted mean height of its non-landmark, non-listing buildings.
- Landmark = height > 250 m OR footprint contains a curated famous-building
  point (tile building data carries no name/tourism/historic tags, so the curated list stands in for those).
- Landmarks and listing buildings are cut out of the block (holes) and kept as individual features with their own ids.
"""
import csv, json, math
from shapely.geometry import Polygon, LineString, Point, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

LON0, LAT0 = -73.98, 40.735
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110574
to_m = lambda p: ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)
to_ll = lambda p: (round(p[0] / KX + LON0, 6), round(p[1] / KY + LAT0, 6))
HALF_W = {'minor': 5, 'tertiary': 7, 'secondary': 8, 'primary': 9, 'trunk': 12, 'motorway': 12}
MIN_COVERAGE = 0.35
LANDMARK_ABS_M, LANDMARK_REL, LANDMARK_REL_MIN_M = 250, None, None
FAMOUS = {  # name: (lon, lat)
  'Empire State Building': (-73.9857, 40.7484), 'One World Trade Center': (-74.0134, 40.7127), 'Chrysler Building': (-73.9755, 40.7516),
  'Flatiron Building': (-73.9897, 40.7411), '432 Park Avenue': (-73.9719, 40.7616), 'Woolworth Building': (-74.0083, 40.7124),
  'MetLife Building': (-73.9766, 40.7536), 'Bank of America Tower': (-73.9845, 40.7555), 'New York Times Building': (-73.9903, 40.7562),
  '8 Spruce Street': (-74.0056, 40.7111), 'One Vanderbilt': (-73.9787, 40.7530), '30 Rockefeller Plaza': (-73.9787, 40.7593),
  'Central Park Tower': (-73.9810, 40.7663), 'One57': (-73.9789, 40.7654), 'Grand Central Terminal': (-73.9772, 40.7527),
  'Met Life Tower': (-73.9873, 40.7414), '30 Hudson Yards': (-74.0010, 40.7537), '3 World Trade Center': (-74.0119, 40.7104),
}
AREA = [(-74.0195,40.7000),(-74.0185,40.7080),(-74.0160,40.7160),(-74.0140,40.7300),(-74.0118,40.7440),(-74.0095,40.7525),(-74.0045,40.7610),
 (-73.9975,40.7705),(-73.9925,40.7740),(-73.9585,40.7595),(-73.9685,40.7470),(-73.9715,40.7380),(-73.9735,40.7280),(-73.9720,40.7180),
 (-73.9760,40.7105),(-73.9900,40.7075),(-74.0000,40.7045),(-74.0100,40.7000)]

def poly_m(ring): return Polygon([to_m(p) for p in ring]).buffer(0)
def poly_out(g):
    polys = [g] if g.geom_type == 'Polygon' else [p for p in getattr(g, 'geoms', []) if p.geom_type == 'Polygon']
    out = []
    for p in polys:
        p = p.simplify(0.4)
        if p.is_empty or p.area < 4: continue
        out.append([[to_ll(c) for c in p.exterior.coords]] + [[to_ll(c) for c in h.coords] for h in p.interiors if Polygon(h).area > 4])
    return out
def cid(prefix, g):
    c = to_ll((g.centroid.x, g.centroid.y)); return f"{prefix}-{c[1]:.5f}-{abs(c[0]):.5f}"

blds = json.load(open('public/data/buildings.json'))['buildings']
geoms = []
for b in blds:
    g = unary_union([poly_m(r) for r in b['parts'] if len(r) >= 4]); geoms.append(g)
tree = STRtree(geoms)

# listing buildings (same rule as the app: footprint containing the point, else nearest centroid within 60 m)
listing_bld = {}
for r in csv.DictReader(open('public/listings.csv')):
    pt = Point(to_m((float(r['lon']), float(r['lat']))))
    hit = [i for i in tree.query(pt) if geoms[i].contains(pt)]
    if not hit:
        near = [i for i in tree.query(pt.buffer(60)) if geoms[i].centroid.distance(pt) < 60]
        hit = sorted(near, key=lambda i: geoms[i].centroid.distance(pt))[:1]
    if hit: listing_bld.setdefault(hit[0], []).append(r['id'])

famous_hits = {}
for name, ll in FAMOUS.items():
    pt = Point(to_m(ll)); hit = [i for i in tree.query(pt.buffer(15)) if geoms[i].distance(pt) < 15]
    if hit: famous_hits[max(hit, key=lambda i: blds[i]['height'])] = name

streets = json.load(open('scripts/cache/streets.json'))
street_poly = unary_union([LineString([to_m(p) for p in s['l']]).buffer(HALF_W[s['c']], cap_style=2) for s in streets if len(s['l']) > 1])
area = Polygon([to_m(p) for p in AREA])
blocks = area.difference(street_poly)
blocks = [b for b in getattr(blocks, 'geoms', [blocks]) if b.area > 300]
print('blocks', len(blocks))

items, used, building_to_block = [], set(), {}
def emit(i, kind, extra=None):
    b = blds[i]; used.add(i)
    it = {'id': b['id'], 'kind': kind, 'parts': poly_out(geoms[i]), 'height': b['height'], 'minHeight': b['minHeight'], 'centroid': b['centroid'], 'buildingIds': [b['id']]}
    if extra: it.update(extra)
    items.append(it)

for blk in blocks:
    idx = [i for i in tree.query(blk) if blk.contains(geoms[i].representative_point()) and i not in used]
    if not idx: continue
    cover = sum(geoms[i].intersection(blk).area for i in idx) / blk.area
    if cover < MIN_COVERAGE:
        for i in idx: emit(i, 'listing' if i in listing_bld else 'landmark' if i in famous_hits else 'building',
                           {'listings': listing_bld.get(i)} if i in listing_bld else ({'name': famous_hits[i]} if i in famous_hits else None))
        continue
    base = [i for i in idx if i not in listing_bld]
    a = sum(geoms[i].area for i in base) or 1
    avg = sum(geoms[i].area * blds[i]['height'] for i in base) / a
    marks = [i for i in base if i in famous_hits or blds[i]['height'] > LANDMARK_ABS_M]
    rest = [i for i in base if i not in marks]
    ra = sum(geoms[i].area for i in rest)
    h = (sum(geoms[i].area * blds[i]['height'] for i in rest) / ra) if ra else avg
    cut = unary_union([geoms[i].buffer(0.8) for i in marks + [i for i in idx if i in listing_bld]]) if (marks or any(i in listing_bld for i in idx)) else None
    g = blk.buffer(-1.5)
    if cut is not None: g = g.difference(cut)
    bid = cid('blk', blk)
    if rest and not g.is_empty:
        items.append({'id': bid, 'kind': 'block', 'parts': poly_out(g), 'height': round(h, 1), 'minHeight': 0,
                      'centroid': list(to_ll((blk.centroid.x, blk.centroid.y))), 'buildingIds': [blds[i]['id'] for i in rest]})
        for i in rest: used.add(i); building_to_block[blds[i]['id']] = bid
    for i in marks: emit(i, 'landmark', {'name': famous_hits.get(i), 'blockId': bid})
    for i in idx:
        if i in listing_bld: emit(i, 'listing', {'listings': listing_bld[i], 'blockId': bid})

# buildings not inside any block polygon (e.g. on piers / clipped by street buffers) stay individual
for i in range(len(blds)):
    if i not in used: emit(i, 'listing' if i in listing_bld else 'building', {'listings': listing_bld[i]} if i in listing_bld else None)

items = [it for it in items if it['parts']]
kinds = {}
for it in items: kinds[it['kind']] = kinds.get(it['kind'], 0) + 1
json.dump({'source': 'derived from buildings.json + OSM streets (OpenFreeMap tiles)', 'rules': __doc__, 'items': items, 'buildingToBlock': building_to_block},
          open('public/data/blocks.json', 'w'), separators=(',', ':'))
print(kinds, 'landmarks named:', sorted(set(it.get('name') for it in items if it.get('name'))))
