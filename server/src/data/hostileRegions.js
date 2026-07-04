// Traveler / at-risk region list — a SAFETY tool, not a judgement of any place
// or its people. These are ISO-3166-1 alpha-2 country codes where consensual
// same-sex activity is criminalised in law, so an LGBTQ+ member who is
// travelling in — or living in — one of them may face real legal danger and
// may want to hide their profile.
//
// SOURCE / RATIONALE
// ------------------
// Compiled from the two most widely-cited, regularly-updated trackers of the
// legal status of LGBTQ+ people:
//   • ILGA World — "State-Sponsored Homophobia" / the ILGA World Database
//     (criminalisation map). https://database.ilga.org
//   • Human Dignity Trust — "Map of Countries that Criminalise LGBT People".
//     https://www.humandignitytrust.org/lgbt-the-law/map-of-criminalisation/
// This snapshot reflects those sources as of 2024-06. It is CONSERVATIVE: we
// include only jurisdictions with clear de jure criminalisation of same-sex
// intimacy, and we deliberately EXCLUDE states that have recently decriminalised
// (e.g. Angola 2021, Bhutan 2021, Singapore 2022, Antigua & Barbuda / Barbados /
// St Kitts & Nevis 2022, Mauritius / Dominica / Namibia 2023-2024) so we never
// wrongly flag a place as unsafe. It is intentionally NOT exhaustive of every
// sub-national nuance.
//
// THIS IS NOT LEGAL ADVICE and the legal landscape changes often (both ways).
// The set is a plain, reviewable literal ON PURPOSE — update it here as the
// sources above change; there is no other place it lives.
export const HOSTILE_REGIONS = new Set([
  // ── Africa ──
  'DZ', // Algeria
  'BI', // Burundi
  'CM', // Cameroon
  'TD', // Chad
  'KM', // Comoros
  'EG', // Egypt (de facto — prosecuted under "debauchery" laws)
  'ER', // Eritrea
  'SZ', // Eswatini
  'ET', // Ethiopia
  'GM', // Gambia
  'GH', // Ghana
  'GN', // Guinea
  'KE', // Kenya
  'LR', // Liberia
  'LY', // Libya
  'MW', // Malawi
  'MR', // Mauritania (death penalty on the books)
  'MA', // Morocco
  'NG', // Nigeria (federal + Sharia states; death penalty in some states)
  'SN', // Senegal
  'SL', // Sierra Leone
  'SO', // Somalia
  'SS', // South Sudan
  'SD', // Sudan
  'TZ', // Tanzania
  'TG', // Togo
  'TN', // Tunisia
  'UG', // Uganda (Anti-Homosexuality Act 2023; death penalty for "aggravated")
  'ZM', // Zambia
  'ZW', // Zimbabwe

  // ── Middle East & Asia ──
  'AF', // Afghanistan
  'BD', // Bangladesh
  'BN', // Brunei (death penalty on the books)
  'ID', // Indonesia (Aceh province + 2022 penal code)
  'IR', // Iran (death penalty)
  'IQ', // Iraq (2024 anti-LGBTQ law)
  'KW', // Kuwait
  'LB', // Lebanon (de facto — prosecuted under Art. 534)
  'MY', // Malaysia
  'MV', // Maldives
  'MM', // Myanmar
  'OM', // Oman
  'PK', // Pakistan
  'QA', // Qatar
  'SA', // Saudi Arabia (death penalty)
  'LK', // Sri Lanka
  'SY', // Syria
  'TM', // Turkmenistan
  'AE', // United Arab Emirates
  'UZ', // Uzbekistan
  'YE', // Yemen (death penalty)

  // ── Pacific & Caribbean ──
  'CK', // Cook Islands
  'GD', // Grenada
  'GY', // Guyana
  'JM', // Jamaica
  'KI', // Kiribati
  'PG', // Papua New Guinea
  'WS', // Samoa
  'SB', // Solomon Islands
  'LC', // St Lucia
  'VC', // St Vincent & the Grenadines
  'TO', // Tonga
  'TV', // Tuvalu
]);

// True iff `country` (an ISO-3166-1 alpha-2 code from lookupGeo) is in the set.
// Case-insensitive; an empty / unknown country (geoip miss) is treated as SAFE
// so we never alarm on a lookup we couldn't resolve.
export function isHostileRegion(country) {
  if (!country || typeof country !== 'string') return false;
  return HOSTILE_REGIONS.has(country.toUpperCase());
}
