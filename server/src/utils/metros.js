// Curated metro-area map. A "must be local" match treats every city in the same
// metro as one area — so a Phoenix user matches Scottsdale, Tempe, Mesa, etc.
//
// metroKey('Phoenix, AZ 85004')   -> 'phoenix-az'
// metroKey('Scottsdale, AZ 85251') -> 'phoenix-az'   (same metro)
// metroKey('Seattle')             -> 'seattle-wa'
// metroKey('Nowhere, ZZ')         -> 'nowhere'        (graceful: unknown cities
//                                                       fall back to exact city)
//
// To extend coverage, add cities to a metro below. Cities whose NAME is
// ambiguous across states (e.g. Aurora CO vs Aurora IL) go in BY_CITY_STATE,
// keyed "city|state"; everything else goes in BY_CITY (city name only).

const BY_CITY = {};
function add(metro, cities) {
  for (const c of cities) BY_CITY[c] = metro;
}

// Phoenix / "Valley of the Sun"
add('phoenix-az', [
  'phoenix', 'scottsdale', 'tempe', 'mesa', 'chandler', 'gilbert', 'glendale',
  'peoria', 'surprise', 'avondale', 'goodyear', 'buckeye', 'queen creek',
  'apache junction', 'fountain hills', 'paradise valley', 'sun city',
  'sun city west', 'el mirage', 'tolleson', 'guadalupe', 'cave creek',
  'carefree', 'litchfield park', 'youngtown', 'gila bend', 'anthem', 'laveen',
]);

// A few other US metros (covers the existing sample cities + common neighbours).
add('seattle-wa', ['seattle', 'bellevue', 'redmond', 'tacoma', 'kirkland', 'renton', 'everett', 'kent', 'bothell', 'sammamish', 'issaquah', 'shoreline', 'burien']);
add('portland-or', ['portland', 'beaverton', 'hillsboro', 'gresham', 'tigard', 'lake oswego', 'tualatin', 'milwaukie', 'oregon city', 'happy valley']);
add('austin-tx', ['austin', 'round rock', 'cedar park', 'georgetown', 'pflugerville', 'san marcos', 'leander', 'kyle', 'buda']);
add('chicago-il', ['chicago', 'evanston', 'naperville', 'schaumburg', 'oak park', 'cicero', 'joliet', 'skokie', 'oak lawn', 'berwyn', 'elgin']);
add('boston-ma', ['boston', 'cambridge', 'somerville', 'quincy', 'newton', 'brookline', 'medford', 'malden', 'waltham', 'revere']);
add('denver-co', ['denver', 'boulder', 'lakewood', 'arvada', 'westminster', 'centennial', 'littleton', 'thornton', 'englewood', 'wheat ridge', 'broomfield']);

// State-qualified for names that exist in multiple metros.
const BY_CITY_STATE = {
  'aurora|co': 'denver-co',
  'aurora|il': 'chicago-il',
  'vancouver|wa': 'portland-or', // Vancouver WA is in the Portland metro
  'columbia|sc': 'columbia',     // distinct from any metro above; keep its own
};

// Parse "City, ST 12345" → { city, state }. Tolerates "City" (no state/ZIP).
function parse(distCity) {
  const raw = (distCity || '').trim().toLowerCase();
  if (!raw) return { city: '', state: '' };
  const parts = raw.split(',').map((s) => s.trim());
  const city = parts[0];
  let state = '';
  if (parts[1]) {
    // "az 85004" → "az"; strip digits, take the first token.
    state = parts[1].replace(/[\d]/g, '').trim().split(/\s+/)[0] || '';
  }
  return { city, state };
}

// The UPPERCASE 2-letter state code from a stored "City, ST" string, or '' when
// there's no parseable 2-letter state. Used by the trans home-region alert to
// key off the member's stated home state. Only returns a value for a clean
// 2-letter code so partial/foreign locations never accidentally match a US set.
export function stateFromCity(distCity) {
  const { state } = parse(distCity);
  return /^[a-z]{2}$/.test(state) ? state.toUpperCase() : '';
}

// ── Coarse public location label ─────────────────────────────────────────────
// Strip any ZIP/postal code from a stored "City, ST 12345" value so strangers
// browsing Discover/matches see "Phoenix, AZ" but NEVER a precise ZIP (privacy
// rule: coarse location only).
//
// This is the ONE canonical implementation — every public surface must route
// through it rather than inlining its own regex (previously duplicated 5×, and
// each copy only stripped a *trailing* digit run, so "85004 Phoenix" leaked the
// ZIP). Here we remove ANY run of 4+ digits (with an optional ZIP+4 suffix)
// wherever it appears — leading, embedded, or trailing — then tidy up stray
// separators. 4+ digits (not 5) also catches partial/foreign postal codes while
// leaving normal city/state text (which has no long digit runs) untouched.
export function coarseCity(distCity) {
  return String(distCity || '')
    .replace(/\b\d{4,}(-\d+)?\b/g, ' ')   // drop any 4+ digit run anywhere
    .replace(/\s{2,}/g, ' ')               // collapse doubled spaces
    .replace(/\s+,/g, ',')                 // "Phoenix , AZ" -> "Phoenix, AZ"
    .replace(/,\s*(?=,|$)/g, '')           // drop empty ", ," / trailing comma
    .replace(/[\s,]+$/, '')                // strip trailing separators
    .replace(/^[\s,]+/, '')                // strip leading separators
    .trim();
}

export function metroKey(distCity) {
  const { city, state } = parse(distCity);
  if (!city) return '';
  if (state && BY_CITY_STATE[`${city}|${state}`]) return BY_CITY_STATE[`${city}|${state}`];
  return BY_CITY[city] || city; // fall back to the exact city name
}

// ── Approximate coordinates for radius (miles) matching ──────────────────────
// [lat, lng] per city. Cities not listed fall back to their metro's centroid;
// truly unknown locations return null (then radius simply doesn't filter them).
const CITY_COORDS = {
  // Phoenix metro (distinct points so a radius differentiates within the valley)
  'phoenix': [33.448, -112.074], 'scottsdale': [33.494, -111.926], 'tempe': [33.425, -111.940],
  'mesa': [33.415, -111.831], 'chandler': [33.306, -111.841], 'gilbert': [33.353, -111.789],
  'glendale': [33.539, -112.186], 'peoria': [33.580, -112.237], 'surprise': [33.629, -112.368],
  'avondale': [33.436, -112.349], 'goodyear': [33.435, -112.358], 'buckeye': [33.370, -112.584],
  'queen creek': [33.249, -111.634], 'apache junction': [33.415, -111.550], 'fountain hills': [33.612, -111.717],
  'paradise valley': [33.531, -111.943], 'el mirage': [33.613, -112.324], 'tolleson': [33.450, -112.259],
  // Other metros (city centroids)
  'seattle': [47.606, -122.332], 'bellevue': [47.610, -122.200], 'tacoma': [47.252, -122.444], 'redmond': [47.674, -122.121], 'kirkland': [47.681, -122.209], 'renton': [47.483, -122.217], 'everett': [47.979, -122.202],
  'portland': [45.515, -122.679], 'beaverton': [45.487, -122.803], 'hillsboro': [45.523, -122.990], 'gresham': [45.500, -122.430],
  'austin': [30.267, -97.743], 'round rock': [30.508, -97.679], 'cedar park': [30.505, -97.820], 'georgetown': [30.633, -97.677], 'san marcos': [29.883, -97.941],
  'chicago': [41.878, -87.630], 'evanston': [42.045, -87.688], 'naperville': [41.785, -88.147], 'schaumburg': [42.034, -88.083], 'oak park': [41.885, -87.785],
  'boston': [42.360, -71.058], 'cambridge': [42.373, -71.110], 'somerville': [42.388, -71.099], 'quincy': [42.253, -71.002], 'newton': [42.337, -71.209],
  'denver': [39.739, -104.990], 'boulder': [40.015, -105.270], 'aurora': [39.729, -104.832], 'lakewood': [39.705, -105.081], 'arvada': [39.803, -105.087],
  'tucson': [32.222, -110.974],
};
// Metro-centroid fallback for cities we didn't list individually.
const METRO_COORDS = {
  'phoenix-az': [33.448, -112.074], 'seattle-wa': [47.606, -122.332], 'portland-or': [45.515, -122.679],
  'austin-tx': [30.267, -97.743], 'chicago-il': [41.878, -87.630], 'boston-ma': [42.360, -71.058],
  'denver-co': [39.739, -104.990],
};

export function coordsFor(distCity) {
  const { city } = parse(distCity);
  if (!city) return null;
  if (CITY_COORDS[city]) return CITY_COORDS[city];
  return METRO_COORDS[metroKey(distCity)] || null;
}

// True iff we can place this location on the map (so distanceMiles() from it can
// return a real number). Cities outside the ~7 hardcoded US metros are NOT
// geocodable — see the E34 limitation note on distanceMiles below.
export function isGeocodable(distCity) {
  return coordsFor(distCity) !== null;
}

// Great-circle distance in miles. Returns null if either location is unknown.
//
// E34 LIMITATION: geocoding is a hardcoded lookup of ~7 US metros (Phoenix,
// Seattle, Portland, Austin, Chicago, Boston, Denver) plus a metro-centroid
// fallback. Any location outside those metros returns null here, so a true
// distance can't be computed for most of the world. A real fix needs a
// geocoding service (out of scope). Until then, callers MUST treat a null as
// "distance unknown" and decide explicitly whether to include or exclude —
// getCandidates() now uses isGeocodable() to only apply the radius filter when
// the VIEWER's location is geocodable, and in that case excludes candidates
// whose location isn't (so the radius no longer silently no-ops). See
// candidates.js.
export function distanceMiles(distCityA, distCityB) {
  const a = coordsFor(distCityA);
  const b = coordsFor(distCityB);
  if (!a || !b) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius, miles
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
