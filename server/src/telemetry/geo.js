// Offline coarse geo lookup via geoip-lite (bundled MaxMind country/region DB,
// zero network egress, synchronous). We keep ONLY country + region ISO codes —
// never city, lat/long, or the raw IP. The IP is passed in transiently and is
// never stored or logged by this module.

import geoip from 'geoip-lite';

export function lookupGeo(ip) {
  if (!ip || typeof ip !== 'string') return { country: '', region: '' };
  try {
    const g = geoip.lookup(ip);
    if (!g) return { country: '', region: '' };
    return { country: g.country || '', region: g.region || '' };
  } catch {
    return { country: '', region: '' };
  }
}
