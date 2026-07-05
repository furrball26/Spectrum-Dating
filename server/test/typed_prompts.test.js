// Typed (choice) profile prompts (§3b). Boots a minimal app wired like
// src/index.js against a throwaway on-disk SQLite DB and drives the prompt routes
// over HTTP, mirroring facets.test.js. Covers: the migration is additive (existing
// text answers unaffected), a choice answer validates against its options, a bad
// choice → 400, a text prompt still validates as before, the catalog exposes
// type/options, and listPrompts (via GET /profile/me) returns type + options.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dbDir = mkdtempSync(join(tmpdir(), 'spectrum-typed-prompts-'));
process.env.DB_PATH = join(dbDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-for-typed-prompts-suite';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { createServer } = await import('http');
const { getDb } = await import('../src/db.js');
const { optionalAuth, signToken } = await import('../src/middleware/auth.js');
const { contextMiddleware } = await import('../src/middleware/context.js');
const profileRouter = (await import('../src/routes/profile.js')).default;

const db = getDb();

let server;
let baseUrl;
let uid = 0;

function makeUser() {
  const id = `u${++uid}`;
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, token_version, suspended) VALUES (?,?,?,?,0,0)')
    .run(id, `${id}@t.dev`, 'x', Date.now());
  db.prepare(
    'INSERT INTO profiles (user_id, display_name, bio, date_of_birth, paused, updated_at) VALUES (?,?,?,?,0,?)'
  ).run(id, `Name ${id}`, 'A bio.', '1990-01-01', Date.now());
  return id;
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(optionalAuth);
  app.use(contextMiddleware(db));
  app.use('/profile', profileRouter);
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('057 migration is additive', () => {
  it('profile_prompts has prompt_type defaulting to text', () => {
    const cols = db.prepare('PRAGMA table_info(profile_prompts)').all();
    const col = cols.find((c) => c.name === 'prompt_type');
    expect(col).toBeTruthy();
    expect(col.notnull).toBe(1);
    // Existing (text) rows inserted without the column must default to 'text'.
    const id = makeUser();
    db.prepare('INSERT INTO profile_prompts (id, user_id, prompt_key, answer, position, created_at) VALUES (?,?,?,?,?,?)')
      .run(`pp${++uid}`, id, 'a_perfect_day', 'a quiet beach', 0, Date.now());
    const row = db.prepare('SELECT prompt_type FROM profile_prompts WHERE user_id = ?').get(id);
    expect(row.prompt_type).toBe('text');
  });
});

describe('GET /profile/prompt-catalog exposes typed prompts', () => {
  it('returns choice prompts with type + options', async () => {
    const { status, json } = await api('/profile/prompt-catalog');
    expect(status).toBe(200);
    const choice = json.prompts.find((p) => p.key === 'ch_time_of_day');
    expect(choice).toBeTruthy();
    expect(choice.type).toBe('choice');
    expect(choice.options).toEqual(['Mornings', 'Evenings', 'Depends on the day']);
    // Text prompts still present and typed 'text'.
    const text = json.prompts.find((p) => p.key === 'a_perfect_day');
    expect(text.type).toBe('text');
  });
});

describe('PUT /profile/prompts — choice validation', () => {
  it('accepts a valid choice pick and stores it, returning type + options', async () => {
    const id = makeUser();
    const token = signToken(id, 0);
    const put = await api('/profile/prompts', {
      token, method: 'PUT',
      body: { prompts: [{ promptKey: 'ch_time_of_day', answer: 'Evenings' }] },
    });
    expect(put.status).toBe(200);
    expect(put.json.prompts[0]).toMatchObject({
      promptKey: 'ch_time_of_day', answer: 'Evenings', promptType: 'choice',
    });
    expect(put.json.prompts[0].options).toEqual(['Mornings', 'Evenings', 'Depends on the day']);
    // Stored with prompt_type = 'choice'.
    const row = db.prepare('SELECT prompt_type, answer FROM profile_prompts WHERE user_id = ?').get(id);
    expect(row.prompt_type).toBe('choice');
    expect(row.answer).toBe('Evenings');

    // And it round-trips through GET /profile/me (the shared assembly).
    const me = await api('/profile/me', { token });
    expect(me.json.prompts[0]).toMatchObject({ promptKey: 'ch_time_of_day', answer: 'Evenings', promptType: 'choice' });
  });

  it('rejects a choice answer that is NOT one of the options (400) and stores nothing', async () => {
    const id = makeUser();
    const token = signToken(id, 0);
    const put = await api('/profile/prompts', {
      token, method: 'PUT',
      body: { prompts: [{ promptKey: 'ch_time_of_day', answer: 'Afternoons' }] },
    });
    expect(put.status).toBe(400);
    expect(put.json.error).toMatch(/one of the options/i);
    const count = db.prepare('SELECT COUNT(*) AS n FROM profile_prompts WHERE user_id = ?').get(id).n;
    expect(count).toBe(0);
  });

  it('still accepts a normal text prompt answer (≤200 chars) unchanged', async () => {
    const id = makeUser();
    const token = signToken(id, 0);
    const put = await api('/profile/prompts', {
      token, method: 'PUT',
      body: { prompts: [{ promptKey: 'a_perfect_day', answer: 'A slow morning with coffee.' }] },
    });
    expect(put.status).toBe(200);
    expect(put.json.prompts[0]).toMatchObject({
      promptKey: 'a_perfect_day', answer: 'A slow morning with coffee.', promptType: 'text',
    });
    expect(put.json.prompts[0].options).toBeUndefined(); // text prompts carry no options
  });

  it('still rejects an over-long text answer (>200), but the 200-cap does NOT apply to choice values', async () => {
    const id = makeUser();
    const token = signToken(id, 0);
    const tooLong = await api('/profile/prompts', {
      token, method: 'PUT',
      body: { prompts: [{ promptKey: 'a_perfect_day', answer: 'x'.repeat(201) }] },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.error).toMatch(/200 characters/i);
  });

  it('accepts a mixed set of a text prompt and a choice prompt together', async () => {
    const id = makeUser();
    const token = signToken(id, 0);
    const put = await api('/profile/prompts', {
      token, method: 'PUT',
      body: { prompts: [
        { promptKey: 'a_perfect_day', answer: 'A quiet beach' },
        { promptKey: 'ch_text_or_call', answer: 'Either is fine' },
      ] },
    });
    expect(put.status).toBe(200);
    expect(put.json.prompts.map((p) => p.promptType)).toEqual(['text', 'choice']);
  });
});
