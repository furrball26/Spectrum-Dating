import { describe, it, expect } from 'vitest';
import { coarseCity, distanceMiles, isGeocodable, metroKey } from '../src/utils/metros.js';

describe('coarseCity — strips ZIPs anywhere (E17)', () => {
  it('strips a trailing ZIP', () => {
    expect(coarseCity('Phoenix, AZ 85004')).toBe('Phoenix, AZ');
  });

  it('strips an EMBEDDED / leading ZIP, not just trailing runs', () => {
    // The bug the old per-copy regex missed: leading ZIP leaked through.
    expect(coarseCity('85004 Phoenix')).toBe('Phoenix');
  });

  it('strips a ZIP+4', () => {
    expect(coarseCity('Phoenix, AZ 85004-1234')).toBe('Phoenix, AZ');
  });

  it('leaves plain city/state text untouched', () => {
    expect(coarseCity('Phoenix, AZ')).toBe('Phoenix, AZ');
    expect(coarseCity('Seattle')).toBe('Seattle');
  });

  it('tolerates empty / nullish input', () => {
    expect(coarseCity('')).toBe('');
    expect(coarseCity(null)).toBe('');
    expect(coarseCity(undefined)).toBe('');
  });

  it('does not strip a short (<4 digit) number that is not a ZIP', () => {
    expect(coarseCity('Apt 12 Phoenix')).toBe('Apt 12 Phoenix');
  });
});

describe('metroKey', () => {
  it('maps same-metro cities to one key', () => {
    expect(metroKey('Phoenix, AZ 85004')).toBe('phoenix-az');
    expect(metroKey('Scottsdale, AZ 85251')).toBe('phoenix-az');
  });

  it('falls back to the exact city for unknown places', () => {
    expect(metroKey('Nowhere, ZZ')).toBe('nowhere');
  });

  it('disambiguates same-named cities by state', () => {
    expect(metroKey('Aurora, CO')).toBe('denver-co');
    expect(metroKey('Aurora, IL')).toBe('chicago-il');
  });
});

describe('isGeocodable / distanceMiles (E34 radius guard)', () => {
  it('geocodable metros compute a real distance', () => {
    expect(isGeocodable('Phoenix, AZ')).toBe(true);
    expect(isGeocodable('Scottsdale, AZ')).toBe(true);
    const d = distanceMiles('Phoenix, AZ', 'Scottsdale, AZ');
    expect(typeof d).toBe('number');
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(30); // same valley — a handful of miles apart
  });

  it('distance to self is 0', () => {
    expect(distanceMiles('Phoenix, AZ', 'Phoenix, AZ')).toBe(0);
  });

  it('non-geocodable location is not geocodable and yields null distance', () => {
    expect(isGeocodable('Smallville, KS')).toBe(false);
    expect(distanceMiles('Phoenix, AZ', 'Smallville, KS')).toBeNull();
    expect(distanceMiles('Smallville, KS', 'Phoenix, AZ')).toBeNull();
  });

  it('computes a large cross-country distance between two metros', () => {
    const d = distanceMiles('Phoenix, AZ', 'Boston, MA');
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(2700);
  });
});
