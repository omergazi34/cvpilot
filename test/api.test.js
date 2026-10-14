import { SAMPLE_CV, SAMPLE_JOB } from './helpers.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import app from '../app.js';

let base;
let server;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (url, body) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Reads an NDJSON stream into an array of events. */
async function events(response) {
  const text = await response.text();
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

describe('HTTP API', () => {
  it('serves the UI with security headers', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('reports that AI is off without an API key', async () => {
    const res = await fetch(`${base}/api/status`);
    assert.equal((await res.json()).ai, false);
  });

  it('streams a demo-mode analysis as NDJSON', async () => {
    const res = await post('/api/analyze', { cvText: SAMPLE_CV, jobText: SAMPLE_JOB });
    assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
    const list = await events(res);
    assert.deepEqual(list[0], { type: 'phase', phase: 'thinking' });
    const result = list.at(-1);
    assert.equal(result.type, 'result');
    assert.equal(result.data.mode, 'demo');
    assert.ok(result.data.missing_keywords.length > 0);
  });

  it('validates input before starting a stream', async () => {
    const res = await post('/api/analyze', { cvText: 'çok kısa' });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'CV metni çok kısa.' });
    const tooLong = await post('/api/analyze', { cvText: SAMPLE_CV, jobText: 'x'.repeat(30_001) });
    assert.equal(tooLong.status, 400);
  });

  it('explains that AI features need a key, inside the stream', async () => {
    const list = await events(await post('/api/optimize', { cvText: SAMPLE_CV }));
    const last = list.at(-1);
    assert.equal(last.type, 'error');
    assert.match(last.message, /API anahtarı gerekli/);
  });

  it('extracts an uploaded CV', async () => {
    const form = new FormData();
    form.append('cv', new Blob([SAMPLE_CV], { type: 'text/plain' }), 'Ayşe_CV.txt');
    const res = await fetch(`${base}/api/upload`, { method: 'POST', body: form });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.source, 'txt');
    assert.ok(body.words > 100);

    const empty = await fetch(`${base}/api/upload`, { method: 'POST', body: new FormData() });
    assert.equal(empty.status, 400);
  });

  it('exports a CV as a Word document with a safe file name', async () => {
    const res = await post('/api/export/cv', { cv: { name: 'Ayşe / Yılmaz', experience: [] } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /wordprocessingml/);
    assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''Ay%C5%9Fe_Y%C4%B1lmaz_CV\.docx/);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await post('/api/export/cv', {})).status, 400);
  });

  it('runs the application tracker CRUD cycle', async () => {
    const created = await post('/api/applications', { company: 'Gama', position: 'Frontend' });
    assert.equal(created.status, 201);
    const { id } = await created.json();

    const moved = await fetch(`${base}/api/applications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'mulakat' }),
    });
    assert.equal((await moved.json()).status, 'mulakat');

    const list = await (await fetch(`${base}/api/applications`)).json();
    assert.ok(list.some((a) => a.id === id));

    assert.equal((await fetch(`${base}/api/applications/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/applications/${id}`, { method: 'DELETE' })).status, 404);
  });

  it('returns JSON errors for unknown endpoints and oversized bodies', async () => {
    const missing = await fetch(`${base}/api/nope`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Bulunamadı.' });

    const huge = await post('/api/analyze', { cvText: 'x'.repeat(4 * 1024 * 1024) });
    assert.equal(huge.status, 413);
    assert.deepEqual(await huge.json(), { error: 'Gönderilen veri çok büyük.' });
  });
});

describe('error messages', () => {
  it('are Turkish and specific for malformed JSON', async () => {
    const res = await fetch(`${base}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"cvText": ',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Geçersiz JSON gönderildi.' });
  });
});
