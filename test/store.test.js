import { DATA_DIR } from './helpers.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import * as store from '../lib/store.js';

describe('application tracker store', () => {
  it('creates applications with defaults and a status history', async () => {
    const app = await store.createApplication({ company: '  Acme  ', position: 'Frontend Developer', matchScore: 87.6 });
    assert.equal(app.company, 'Acme');
    assert.equal(app.status, 'kaydedildi');
    assert.equal(app.matchScore, 88);
    assert.equal(app.history.length, 1);
    assert.match(app.id, /^[0-9a-f-]{36}$/);
  });

  it('validates input', async () => {
    await assert.rejects(store.createApplication({ notes: 'no company or position' }), /Şirket veya pozisyon adı gerekli/);
    await assert.rejects(store.createApplication({ company: 'X', status: 'hired' }), /Geçersiz başvuru durumu/);
    const long = await store.createApplication({ company: 'x'.repeat(500), matchScore: 500 });
    assert.equal(long.company.length, 120);
    assert.equal(long.matchScore, 100);
  });

  it('records status changes and fills in the application date', async () => {
    const app = await store.createApplication({ company: 'Beta', position: 'Backend' });
    const updated = await store.updateApplication(app.id, { status: 'basvuruldu' });
    assert.deepEqual(updated.history.map((h) => h.status), ['kaydedildi', 'basvuruldu']);
    assert.match(updated.appliedAt, /^\d{4}-\d{2}-\d{2}$/);
    const same = await store.updateApplication(app.id, { status: 'basvuruldu', notes: 'follow up' });
    assert.equal(same.history.length, 2, 'unchanged status adds no history entry');
  });

  it('lists newest first, deletes, and persists to disk atomically', async () => {
    const a = await store.createApplication({ company: 'Old' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createApplication({ company: 'New' });
    const list = await store.listApplications();
    assert.ok(list.findIndex((x) => x.id === b.id) < list.findIndex((x) => x.id === a.id));

    await store.deleteApplication(a.id);
    await assert.rejects(store.deleteApplication(a.id), { status: 404 });
    await assert.rejects(store.updateApplication('missing', {}), { status: 404 });

    const onDisk = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'applications.json'), 'utf8'));
    assert.ok(onDisk.some((x) => x.id === b.id));
    assert.ok(!onDisk.some((x) => x.id === a.id));
    await assert.rejects(fs.access(path.join(DATA_DIR, 'applications.json.tmp')));
  });
});
