// A small JSON-file store for the application tracker (data/applications.json).
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './env.js';
import { UserError } from './errors.js';

// CVPILOT_DATA_DIR lets tests (or a deployment) keep data outside the project folder.
const DIR = process.env.CVPILOT_DATA_DIR || path.join(ROOT, 'data');
const FILE = path.join(DIR, 'applications.json');

export const STATUSES = ['kaydedildi', 'basvuruldu', 'mulakat', 'teklif', 'red'];
const FIELDS = {
  company: 120,
  position: 160,
  location: 120,
  url: 600,
  salary: 80,
  notes: 4000,
  appliedAt: 40,
  interviewAt: 40,
  contact: 160,
};

let cache = null;
let queue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, 'utf8'));
    if (!Array.isArray(cache)) cache = [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Başvuru verisi okunamadı, boş liste ile devam ediliyor:', err.message);
    cache = [];
  }
  return cache;
}

function persist() {
  // Serialise writes, and write to a temp file first so a crash never leaves a half-written file.
  queue = queue.then(async () => {
    await fs.mkdir(DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmp, FILE);
  });
  return queue;
}

function sanitize(input, { partial = false } = {}) {
  const out = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    out[key] = String(input[key] ?? '').trim().slice(0, max);
  }
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new UserError('Geçersiz başvuru durumu.');
    out.status = input.status;
  }
  if (input.matchScore !== undefined && input.matchScore !== null && input.matchScore !== '') {
    const n = Number(input.matchScore);
    if (Number.isFinite(n)) out.matchScore = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (!partial && !out.company && !out.position) throw new UserError('Şirket veya pozisyon adı gerekli.');
  return out;
}

export async function listApplications() {
  return [...(await load())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createApplication(input) {
  const list = await load();
  const now = new Date().toISOString();
  const data = sanitize(input);
  const status = data.status || 'kaydedildi';
  const app = {
    id: randomUUID(),
    company: '',
    position: '',
    location: '',
    url: '',
    salary: '',
    notes: '',
    appliedAt: '',
    interviewAt: '',
    contact: '',
    matchScore: null,
    ...data,
    status,
    history: [{ status, at: now }],
    createdAt: now,
    updatedAt: now,
  };
  list.push(app);
  await persist();
  return app;
}

export async function updateApplication(id, input) {
  const list = await load();
  const app = list.find((a) => a.id === id);
  if (!app) throw new UserError('Başvuru bulunamadı.', 404);
  const data = sanitize(input, { partial: true });
  const now = new Date().toISOString();
  if (data.status && data.status !== app.status) {
    app.history = [...(app.history || []), { status: data.status, at: now }];
    if (data.status === 'basvuruldu' && !app.appliedAt && !data.appliedAt) data.appliedAt = now.slice(0, 10);
  }
  Object.assign(app, data, { updatedAt: now });
  await persist();
  return app;
}

export async function deleteApplication(id) {
  const list = await load();
  const i = list.findIndex((a) => a.id === id);
  if (i === -1) throw new UserError('Başvuru bulunamadı.', 404);
  list.splice(i, 1);
  await persist();
}
