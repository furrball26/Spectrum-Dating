// Admin Population / Demographics tests. Covers the aggregation endpoint
// (GET /admin/population) and the demographic member filters on GET /admin/members.
//
// Verifies the privacy-critical behaviours the report is reviewed on:
//   • multi-value comma-joined fields split + count once PER TOKEN (sum can
//     exceed totalMembers);
//   • k = 5 small-cell masking hides 1–4 buckets (count:null, masked:true) and
//     shows 5+ exactly;
//   • test/demo accounts are excluded from every aggregate;
//   • member filters match on a TOKEN boundary (seeking='man' must NOT match
//     'woman');
//   • age bands are computed correctly from DOB.
//
// Boots a minimal admin app over a throwaway on-disk DB, mirroring
// admin_members.test.js. The admin account uses a @spectrum-test.dev email so it
// is itself excluded from the real-member aggregates (keeping totals clean).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-population-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-population-suite';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@spectrum-test.dev';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const adminPopulationRouter = (await import('../src/routes/adminPopulation.js')).default;
const adminTelemetryRouter = (await import('../src/routes/adminTelemetry.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;
let adminId;

// DOB (Jan 1 of the birth year) that yields EXACTLY `age` today — a Jan-1
// birthday has always already passed this calendar year.
function dobForAge(age) {
  return `${new Date().getFullYear() - age}-01-01`;
}

// Insert a real (or test/demo) member with the given profile facets + interests.
function makeMember({
  email, gender = '', orientation = '', seeking = '', relationshipStructure = '',
  relationshipGoal = '', age = null, city = '', interests = [],
} = {}) {
  const id = `u${++uid}`;
  const em = email || `${id}@example.com`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, em, 'x', Date.now());
  db.prepare(
    `INSERT INTO profiles
       (user_id, display_name, gender, orientation, seeking, relationship_structure,
        relationship_goal, date_of_birth, dist_city, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, `Name ${id}`, gender, orientation, seeking, relationshipStructure,
    relationshipGoal, age === null ? '' : dobForAge(age), city, Date.now());
  const insInterest = db.prepare('INSERT INTO user_interests (user_id, interest) VALUES (?, ?)');
  for (const i of interests) insInterest.run(id, i);
  return id;
}

function makeAdmin() {
  const id = `admin${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, 'admin@spectrum-test.dev', 'x', Date.now());
  db.prepare('INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?,?,?)')
    .run(id, 'Admin', Date.now());
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

const adminToken = () => signToken(adminId, 0);

// Find a bucket by label in a breakdown array.
const bucket = (arr, label) => arr.find((b) => b.label === label);

// Seeded group ids (for the member-filter assertions).
const groups = { A: [], B: [], C: [], D: [] };

beforeAll(async () => {
  adminId = makeAdmin();

  // ── Real members ──────────────────────────────────────────────────────────
  // Group A: 6 × man / seeking woman / straight / monogamous / long-term / 30 / Portland
  for (let i = 0; i < 6; i++) {
    groups.A.push(makeMember({
      gender: 'man', seeking: 'woman', orientation: 'straight',
      relationshipStructure: 'monogamous', relationshipGoal: 'long-term',
      age: 30, city: 'Portland', interests: ['hiking', 'gaming'],
    }));
  }
  // Group B: 5 × woman / seeking man / bisexual,queer / open / friendship / 40 / Seattle
  for (let i = 0; i < 5; i++) {
    groups.B.push(makeMember({
      gender: 'woman', seeking: 'man', orientation: 'bisexual,queer',
      relationshipStructure: 'open', relationshipGoal: 'friendship',
      age: 40, city: 'Seattle', interests: ['hiking'],
    }));
  }
  // Group C: 3 × nonbinary / seeking '' (open to everyone) / queer / '' / '' / 22 / Bend
  for (let i = 0; i < 3; i++) {
    groups.C.push(makeMember({
      gender: 'nonbinary', seeking: '', orientation: 'queer',
      relationshipStructure: '', relationshipGoal: '',
      age: 22, city: 'Bend', interests: ['reading'],
    }));
  }
  // Group D: 2 × two-spirit / seeking nonbinary / pansexual / polyamorous / open / 60 / Bend
  for (let i = 0; i < 2; i++) {
    groups.D.push(makeMember({
      gender: 'two-spirit', seeking: 'nonbinary', orientation: 'pansexual',
      relationshipStructure: 'polyamorous', relationshipGoal: 'open',
      age: 60, city: 'Bend', interests: ['reading'],
    }));
  }

  // ── Test/demo members (must be EXCLUDED from every aggregate) ──────────────
  makeMember({ email: `seed@spectrum-test.dev`, gender: 'man', seeking: 'woman', orientation: 'straight', age: 30, city: 'Portland' });
  makeMember({ email: `demo@sample.spectrum-dating.app`, gender: 'man', seeking: 'woman', orientation: 'straight', age: 30, city: 'Portland' });

  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/admin', adminPopulationRouter);
  app.use('/admin', adminTelemetryRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  db.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('GET /admin/population — auth', () => {
  it('requires admin', async () => {
    const res = await api('/admin/population');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/population — totals & exclusion', () => {
  it('counts only real members (test/demo excluded)', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    // 6 + 5 + 3 + 2 = 16 real members; test/demo + admin excluded.
    expect(json.totalMembers).toBe(16);
    // The test/demo "man" rows did not inflate the man bucket (still 6).
    expect(bucket(json.gender, 'man').count).toBe(6);
  });
});

describe('GET /admin/population — single-value breakdowns', () => {
  it('gender groups exactly; empty → "Not specified"', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(bucket(json.gender, 'man').count).toBe(6);
    expect(bucket(json.gender, 'woman').count).toBe(5);
  });

  it('relationship goal groups; empty → "Not specified"', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(bucket(json.relationshipGoal, 'long-term').count).toBe(6);
    expect(bucket(json.relationshipGoal, 'friendship').count).toBe(5);
    // Group C left it unset (3) — masked under "Not specified" (1..4).
    const ns = bucket(json.relationshipGoal, 'Not specified');
    expect(ns.masked).toBe(true);
    expect(ns.count).toBe(null);
  });
});

describe('GET /admin/population — multi-value split', () => {
  it('counts once PER TOKEN so a member appears in every selected bucket', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    // Group B chose "bisexual,queer" → each B member counts in BOTH.
    expect(bucket(json.orientation, 'bisexual').count).toBe(5);
    // queer = B(5) + C(3) = 8.
    expect(bucket(json.orientation, 'queer').count).toBe(8);
    expect(bucket(json.orientation, 'straight').count).toBe(6);
    // Sum across the multi-select exceeds totalMembers (16) — that's expected.
    const sum = json.orientation.reduce((s, b) => s + (b.count ?? 0), 0);
    // straight 6 + bisexual 5 + queer 8 = 19 unmasked (pansexual 2 is masked).
    expect(sum).toBe(19);
  });

  it('seeking: empty column counts under "Open to everyone", tokens split', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(bucket(json.seeking, 'woman').count).toBe(6);
    expect(bucket(json.seeking, 'man').count).toBe(5);
    // Group C (3, seeking '') → "Open to everyone" bucket, masked (3 < 5).
    const open = bucket(json.seeking, 'Open to everyone');
    expect(open).toBeTruthy();
    expect(open.masked).toBe(true);
    expect(open.count).toBe(null);
    expect(open.value).toBe(''); // drills into members with empty seeking
  });
});

describe('GET /admin/population — k=5 small-cell masking', () => {
  it('hides 1–4 counts (count:null, masked:true) and shows 5+ exactly', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    // two-spirit = 2 → masked; the CATEGORY is still present.
    const twoSpirit = bucket(json.gender, 'two-spirit');
    expect(twoSpirit).toBeTruthy();
    expect(twoSpirit.masked).toBe(true);
    expect(twoSpirit.count).toBe(null);
    // nonbinary = 3 → masked.
    expect(bucket(json.gender, 'nonbinary').masked).toBe(true);
    // man = 6 → shown exactly, not masked.
    const man = bucket(json.gender, 'man');
    expect(man.masked).toBe(false);
    expect(man.count).toBe(6);
  });

  it('a 0-count bucket is NOT masked (0 is not identifying)', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    const empty = bucket(json.ageBands, '45–54'); // no members in this band
    expect(empty.count).toBe(0);
    expect(empty.masked).toBe(false);
  });
});

describe('GET /admin/population — age bands', () => {
  it('computes bands from DOB, in fixed order', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(json.ageBands.map((b) => b.label)).toEqual(['18–24', '25–34', '35–44', '45–54', '55+']);
    expect(bucket(json.ageBands, '25–34').count).toBe(6); // group A @30
    expect(bucket(json.ageBands, '35–44').count).toBe(5); // group B @40
    expect(bucket(json.ageBands, '18–24').masked).toBe(true); // group C @22 (3)
    expect(bucket(json.ageBands, '55+').masked).toBe(true);   // group D @60 (2)
  });
});

describe('GET /admin/population — location & interests', () => {
  it('groups location by coarse city', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(bucket(json.location, 'Portland').count).toBe(6);
    expect(bucket(json.location, 'Seattle').count).toBe(5);
    expect(bucket(json.location, 'Bend').count).toBe(5); // C(3) + D(2)
  });

  it('ranks top interests', async () => {
    const { json } = await api('/admin/population', { token: adminToken() });
    expect(bucket(json.interests, 'hiking').count).toBe(11); // A(6) + B(5)
    expect(bucket(json.interests, 'gaming').count).toBe(6);  // A
    expect(bucket(json.interests, 'reading').count).toBe(5); // C(3) + D(2)
  });
});

// ── Member filters (drill-down from a breakdown) ────────────────────────────
describe('GET /admin/members — demographic filters', () => {
  it("seeking='man' matches the token, NOT 'woman' (no man-in-woman bug)", async () => {
    const res = (await api('/admin/members?pageSize=100&seeking=man', { token: adminToken() })).json;
    const ids = res.members.map((m) => m.id).sort();
    expect(ids).toEqual([...groups.B].sort()); // the 5 seeking-'man' members only
    // Group A (seeking 'woman') must NOT leak in.
    for (const a of groups.A) expect(ids).not.toContain(a);
  });

  it("seeking='woman' returns the woman-seekers", async () => {
    const res = (await api('/admin/members?pageSize=100&seeking=woman', { token: adminToken() })).json;
    expect(res.total).toBe(6);
    expect(res.members.map((m) => m.id).sort()).toEqual([...groups.A].sort());
  });

  it('orientation token filter counts multi-select members', async () => {
    const res = (await api('/admin/members?pageSize=100&orientation=queer', { token: adminToken() })).json;
    // queer = B(5) + C(3) = 8.
    expect(res.total).toBe(8);
    const res2 = (await api('/admin/members?pageSize=100&orientation=bisexual', { token: adminToken() })).json;
    expect(res2.total).toBe(5); // group B only
  });

  it('gender + city + relationshipGoal filter exactly', async () => {
    const g = (await api('/admin/members?pageSize=100&gender=man', { token: adminToken() })).json;
    expect(g.total).toBe(6);
    const c = (await api('/admin/members?pageSize=100&city=Bend', { token: adminToken() })).json;
    expect(c.total).toBe(5); // C(3) + D(2)
    const rg = (await api('/admin/members?pageSize=100&relationshipGoal=friendship', { token: adminToken() })).json;
    expect(rg.total).toBe(5); // group B
  });

  it('relationshipStructure token filter matches', async () => {
    const res = (await api('/admin/members?pageSize=100&relationshipStructure=monogamous', { token: adminToken() })).json;
    expect(res.total).toBe(6); // group A
  });

  it('age band filter (ageMin/ageMax) selects by DOB', async () => {
    // 25..44 → group A (30) + group B (40) = 11; excludes C (22) and D (60).
    const res = (await api('/admin/members?pageSize=100&ageMin=25&ageMax=44', { token: adminToken() })).json;
    expect(res.total).toBe(11);
    // 18..24 → group C (22) only.
    const young = (await api('/admin/members?pageSize=100&ageMin=18&ageMax=24', { token: adminToken() })).json;
    expect(young.total).toBe(3);
    // 55+ → group D (60) only.
    const old = (await api('/admin/members?pageSize=100&ageMin=55', { token: adminToken() })).json;
    expect(old.total).toBe(2);
  });

  it('filters compose with existing status/pagination', async () => {
    const res = (await api('/admin/members?pageSize=100&gender=woman&status=active', { token: adminToken() })).json;
    expect(res.total).toBe(5); // group B, all active
  });
});
