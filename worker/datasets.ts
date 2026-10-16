// NYC Open Data (Socrata SoQL) queries refreshed daily into KV by the Worker cron.
// Each response must stay under ~8 MB (KV value limit is 25 MiB; keep headroom). Fallback copies live in public/data/<key>.json.
const soql = (id: string, q: Record<string, string>) =>
  `https://data.cityofnewyork.us/resource/${id}.json?` + new URLSearchParams(q).toString().replace(/\+/g, '%20');

export const DATASETS: Record<string, string> = {
  // DOF rolling sales, Manhattan, trailing 12 months (another agent validates/consumes this one).
  sales: soql('usep-8jbt', {
    $select: 'neighborhood,building_class_category,block,lot,address,apartment_number,zip_code,residential_units,total_units,gross_square_feet,year_built,building_class_at_time_of,sale_price,sale_date',
    $where: "borough='1' AND sale_price > 100000",
    $limit: '50000',
  }),
  // DCP Housing Database: Manhattan residential new buildings filed or completed since 2019, not withdrawn.
  devs: soql('br6q-ssj3', {
    $select: 'job_number,addressnum,addressst,latitude,longitude,job_status,classaprop,units_co,floorsprop,datefiled,datepermit,datecomplt,ownership,nta2020,ntaname20,schelmntry,schmiddle,bbl',
    $where: "boro='1' AND job_type='New Building' AND classaprop::number > 0 AND job_status != '9. Withdrawn' AND latitude IS NOT NULL AND (datefiled >= '2019-01-01' OR datecomplt >= '2019-01-01')",
    $order: 'datefiled DESC',
    $limit: '50000',
  }),
  // DOHMH inspections reduced to one row per (restaurant, graded inspection) over the last 18 months; client keeps the latest per camis.
  // Getter so the 18-month window is computed per request (Workers freeze the clock at module scope).
  get restaurants() {
    const since = new Date(Date.now() - 548 * 864e5).toISOString().slice(0, 10);
    return soql('43nn-pn8j', {
      $select: 'camis,dba,cuisine_description,grade,grade_date,building,street,latitude,longitude',
      $where: `boro='Manhattan' AND grade IN ('A','B','C') AND grade_date >= '${since}' AND latitude::number != 0`,
      $group: 'camis,dba,cuisine_description,grade,grade_date,building,street,latitude,longitude',
      $limit: '50000',
    });
  },
  // PLUTO soft sites: >15,000 sf of unused residential floor area, not landmarked, not parks (9) or public facilities (8).
  softsites: soql('64uk-42ks', {
    $select: 'bbl,address,latitude,longitude,zonedist1,lotarea,bldgarea,residfar,builtfar,yearbuilt,numfloors,histdist,ownername,landuse',
    $where: "borough='MN' AND landmark IS NULL AND landuse NOT IN ('8','9') AND latitude IS NOT NULL AND residfar::number * lotarea::number - bldgarea::number > 15000",
    $limit: '50000',
  }),
  // DOF annualized sales 2016-2025, aggregated per NTA / year / building class. gross_square_feet is text with commas;
  // sum_price_sqft sums prices only of rows that have sqft, so $/sf = sum_price_sqft / sum_sqft (co-op units carry no sqft).
  trends: soql('w2pb-icbu', {
    $select: "nta, date_extract_y(sale_date) AS year, building_class_category, count(*) AS n, avg(sale_price) AS avg_price, sum(sale_price) AS sum_price, sum(replace(gross_square_feet, ',', '')::number) AS sum_sqft, sum(case(replace(gross_square_feet, ',', '')::number > 0, sale_price, true, 0)) AS sum_price_sqft",
    $where: "borough='1' AND sale_price > 100000 AND sale_date >= '2016-01-01' AND sale_date < '2026-01-01' AND nta IS NOT NULL",
    $group: 'nta, year, building_class_category',
    $order: 'nta, year, building_class_category',
    $limit: '50000',
  }),
};
