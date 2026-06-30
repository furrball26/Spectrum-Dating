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

export function metroKey(distCity) {
  const { city, state } = parse(distCity);
  if (!city) return '';
  if (state && BY_CITY_STATE[`${city}|${state}`]) return BY_CITY_STATE[`${city}|${state}`];
  return BY_CITY[city] || city; // fall back to the exact city name
}
