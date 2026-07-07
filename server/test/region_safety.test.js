// Traveler / at-risk region alert — backend tests.
//
// Proves GET /profile/region-safety:
//   • returns atRisk:true for an IP that geoips to a HOSTILE (criminalising)
//     country, and atRisk:false for a SAFE one (lookupGeo mocked so the test is
//     deterministic and offline);
//   • returns the caller's OWN country code and nothing else;
//   • requires auth (401 anon);
//   • STORES NOTHING — the request runs ZERO mutating SQL, adds no table, and
//     adds no column (same privacy discipline as visitor telemetry).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Deterministic, offline geo — flip `mockGeo` per case to simulate the country
// the caller's IP resolves to.
let mockGeo = { country: 'US', region: '' };
vi.mock('../src/telemetry/geo.js', () => ({
  lookupGeo: () => mockGeo,
}));

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-regionsafety-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-region-safety-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;
const { isHostileRegion, HOSTILE_REGIONS } = await import('../src/data/hostileRegions.js');
const { isTransRiskState, isTransSpectrumGender } = await import('../src/data/transSafety.js');
const { stateFromCity } = await import('../src/utils/metros.js');

const db = getDb();

let server;
let baseUrl;

// Count any mutating SQL executed while a request is in flight, so we can prove
// the endpoint persists nothing. Wraps db.prepare and tallies run() calls whose
// SQL is an INSERT / UPDATE / DELETE.
let mutations = 0;
function makeSpyDb(realDb) {
  return new Proxy(realDb, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql) => {
          const stmt = target.prepare(sql);
          if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
            return new Proxy(stmt, {
              get(s, p) {
                if (p === 'run') return (...a) => { mutations++; return s.run(...a); };
                const v = s[p];
                return typeof v === 'function' ? v.bind(s) : v;
              },
            });
          }
          return stmt;
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function makeUser(email) {
  const id = `u_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version) VALUES (?,?,?,?,0)')
    .run(id, email, 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, 'Test', Date.now());
  return id;
}

async function api(path, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

let userId;
beforeAll(async () => {
  userId = makeUser('traveler@t.dev');
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  // Inject the mutation-spy db so we can assert the endpoint writes nothing.
  // NOTE: no lastActiveMiddleware here — that middleware legitimately writes;
  // it is not part of this endpoint, and its absence keeps the write-count clean.
  app.use(contextMiddleware(makeSpyDb(db)));
  app.use('/profile', profileRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('GET /profile/region-safety', () => {
  const token = () => signToken(userId, 0);

  it('flags atRisk:true when the caller geoips to a hostile country', async () => {
    mockGeo = { country: 'SA', region: '' }; // Saudi Arabia — in HOSTILE_REGIONS
    const res = await api('/profile/region-safety', { token: token() });
    expect(res.status).toBe(200);
    expect(res.json.atRisk).toBe(true);
    expect(res.json.country).toBe('SA');
  });

  it('flags atRisk:false when the caller geoips to a safe country', async () => {
    mockGeo = { country: 'US', region: '' }; // United States — NOT in the set
    const res = await api('/profile/region-safety', { token: token() });
    expect(res.status).toBe(200);
    expect(res.json.atRisk).toBe(false);
    expect(res.json.country).toBe('US');
  });

  it('treats an unresolved (empty) geo lookup as SAFE — never a false alarm', async () => {
    mockGeo = { country: '', region: '' }; // geoip miss
    const res = await api('/profile/region-safety', { token: token() });
    expect(res.status).toBe(200);
    expect(res.json.atRisk).toBe(false);
    expect(res.json.country).toBe('');
  });

  it('returns ONLY { atRisk, country, homeStateAtRisk, transAtRisk } — no other fields leak', async () => {
    mockGeo = { country: 'UG', region: '04' };
    const res = await api('/profile/region-safety', { token: token() });
    expect(Object.keys(res.json).sort()).toEqual(['atRisk', 'country', 'homeStateAtRisk', 'transAtRisk']);
  });

  it('requires auth (401 for anon)', async () => {
    mockGeo = { country: 'SA', region: '' };
    const res = await api('/profile/region-safety');
    expect(res.status).toBe(401);
  });

  it('STORES NOTHING — a hostile-country request runs zero mutating SQL', async () => {
    mockGeo = { country: 'IR', region: '' }; // Iran — hostile
    mutations = 0;
    const res = await api('/profile/region-safety', { token: token() });
    expect(res.json.atRisk).toBe(true);
    // No INSERT / UPDATE / DELETE ran anywhere while handling the request.
    expect(mutations).toBe(0);
  });

  it('adds NO new table and NO new profiles column (no storage surface)', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const name of tables) {
      expect(/region|hostile|geo|traveler|at_risk/i.test(name)).toBe(false);
    }
    const cols = db.prepare('PRAGMA table_info(profiles)').all().map((c) => c.name);
    for (const c of cols) {
      expect(/region|hostile|country|at_risk|geo/i.test(c)).toBe(false);
    }
  });
});

describe('GET /profile/region-safety — trans home-region alert (transAtRisk)', () => {
  // Country stays SAFE for all of these so the trans signal is isolated from the
  // IP/country signal.
  function makeProfiled(gender, distCity) {
    const id = makeUser(`t_${Math.random().toString(36).slice(2, 8)}@t.dev`);
    db.prepare('UPDATE profiles SET gender = ?, dist_city = ? WHERE user_id = ?').run(gender, distCity, id);
    return id;
  }
  const check = async (id) => (await api('/profile/region-safety', { token: signToken(id, 0) })).json.transAtRisk;
  const full = async (id) => (await api('/profile/region-safety', { token: signToken(id, 0) })).json;

  it('homeStateAtRisk is GENDER-INDEPENDENT (true for a cis member in a listed state)', async () => {
    mockGeo = { country: 'US', region: '' };
    const r = await full(makeProfiled('woman', 'Austin, TX'));
    expect(r.homeStateAtRisk).toBe(true);  // the state is flagged...
    expect(r.transAtRisk).toBe(false);     // ...but they aren't trans, so no load-banner
  });

  it('flags a trans member whose home state has enacted anti-trans law', async () => {
    mockGeo = { country: 'US', region: '' };
    expect(await check(makeProfiled('trans-woman', 'Austin, TX'))).toBe(true);
  });

  it('does NOT flag a trans member in a non-listed state', async () => {
    mockGeo = { country: 'US', region: '' };
    expect(await check(makeProfiled('trans-woman', 'Seattle, WA'))).toBe(false);
  });

  it('covers the broader nonbinary umbrella, not just binary trans', async () => {
    mockGeo = { country: 'US', region: '' };
    expect(await check(makeProfiled('nonbinary', 'Miami, FL'))).toBe(true);
  });

  it('does NOT flag a cis member even in a listed state', async () => {
    mockGeo = { country: 'US', region: '' };
    expect(await check(makeProfiled('woman', 'Austin, TX'))).toBe(false);
  });

  it('does NOT flag a trans member with no stated city', async () => {
    mockGeo = { country: 'US', region: '' };
    expect(await check(makeProfiled('trans-man', ''))).toBe(false);
  });
});

describe('transSafety + stateFromCity helpers', () => {
  it('isTransRiskState matches listed states case-insensitively, misses others', () => {
    expect(isTransRiskState('TX')).toBe(true);
    expect(isTransRiskState('tx')).toBe(true);
    expect(isTransRiskState('CA')).toBe(false);
    expect(isTransRiskState('')).toBe(false);
    expect(isTransRiskState(null)).toBe(false);
  });
  it('isTransSpectrumGender covers the umbrella but not cis/intersex/questioning', () => {
    for (const g of ['trans-man', 'trans-woman', 'nonbinary', 'genderfluid', 'agender']) {
      expect(isTransSpectrumGender(g)).toBe(true);
    }
    for (const g of ['woman', 'man', 'intersex', 'questioning', '', null]) {
      expect(isTransSpectrumGender(g)).toBe(false);
    }
  });
  it('stateFromCity parses the uppercase 2-letter state, else empty', () => {
    expect(stateFromCity('Austin, TX')).toBe('TX');
    expect(stateFromCity('Phoenix, AZ 85004')).toBe('AZ');
    expect(stateFromCity('Seattle')).toBe('');
    expect(stateFromCity('')).toBe('');
  });
});

describe('HOSTILE_REGIONS / isHostileRegion helper', () => {
  it('matches known criminalising countries, case-insensitively', () => {
    expect(isHostileRegion('SA')).toBe(true);
    expect(isHostileRegion('sa')).toBe(true);
    expect(isHostileRegion('UG')).toBe(true);
  });

  it('does not match safe countries or empty/garbage input', () => {
    expect(isHostileRegion('US')).toBe(false);
    expect(isHostileRegion('CA')).toBe(false);
    expect(isHostileRegion('')).toBe(false);
    expect(isHostileRegion(null)).toBe(false);
    expect(isHostileRegion(undefined)).toBe(false);
    expect(isHostileRegion(42)).toBe(false);
  });

  it('excludes recently-decriminalised states (no false alarms)', () => {
    // Singapore (2022), Mauritius (2023), Namibia (2024), Barbados (2022),
    // Antigua & Barbuda (2022), Bhutan (2021), Angola (2021).
    for (const c of ['SG', 'MU', 'NA', 'BB', 'AG', 'BT', 'AO']) {
      expect(HOSTILE_REGIONS.has(c)).toBe(false);
    }
  });
});
