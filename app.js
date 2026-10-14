// The Express application: static UI + JSON/NDJSON API. server.js only decides where to listen,
// so tests can mount this app on a random port.
import { ROOT } from './lib/env.js'; // loads .env before the other modules read process.env
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import * as ai from './lib/ai.js';
import { extractCv } from './lib/extract.js';
import { quickAtsCheck } from './lib/heuristic.js';
import { cvToDocx, letterToDocx } from './lib/docx.js';
import * as store from './lib/store.js';
import { UserError } from './lib/errors.js';

export const LIMITS = { cv: 60_000, job: 30_000, short: 2_000, jobs: 8 };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ---------- Helpers ----------

/** Validates a free-text field. Error messages are shown to users, hence Turkish. */
function text(value, max, name, { required = false, min = 0 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  // "Required" only when empty: text that is present but short gets "too short", not "required".
  if (required && !v) throw new UserError(`${name} gerekli.`);
  if (v && v.length < min) throw new UserError(`${name} çok kısa.`);
  if (v.length > max) throw new UserError(`${name} çok uzun (en fazla ${max.toLocaleString('tr-TR')} karakter).`);
  return v;
}

const cvTextFrom = (body) => text(body.cvText, LIMITS.cv, 'CV metni', { required: true, min: 80 });

/**
 * Streams a long-running AI job as NDJSON, one event per line:
 * {type:"phase"} → {type:"progress"|"delta"} … → {type:"result"} | {type:"error"}
 *
 * The browser shows progress while the model thinks and writes, and a closed tab aborts the
 * upstream request so no tokens are spent on an answer nobody will read.
 */
async function streamJob(req, res, work) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  const send = (obj) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
  };

  // Report the character count at most ~4 times per second.
  let chars = 0;
  let lastSent = 0;
  let writing = false;
  const onText = (delta) => {
    if (!writing) {
      writing = true;
      send({ type: 'phase', phase: 'writing' });
    }
    chars += delta.length;
    const now = Date.now();
    if (now - lastSent > 250) {
      lastSent = now;
      send({ type: 'progress', chars });
    }
  };

  send({ type: 'phase', phase: 'thinking' });
  try {
    const data = await work({ signal: controller.signal, onText, send });
    send({ type: 'result', data });
  } catch (err) {
    if (!controller.signal.aborted) console.error('[AI]', err.message);
    send({ type: 'error', message: err.expose ? err.message : 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.' });
  }
  res.end();
}

const sendDocx = (res, buffer, fileName) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="cv.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buffer);
};

export const safeName = (s, fallback) =>
  (s || fallback).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60) || fallback;

// ---------- API ----------
app.get('/api/status', (req, res) => {
  res.json({ ai: ai.isConfigured(), model: ai.MODEL });
});

app.post('/api/upload', (req, res, next) => {
  upload.single('cv')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new UserError('Dosya en fazla 10 MB olabilir.', 413));
    if (err) return next(err);
    if (!req.file) return next(new UserError('Dosya bulunamadı. Lütfen bir CV dosyası seçin.'));
    extractCv(req.file, { transcribe: ai.isConfigured() ? ai.transcribeDocument : undefined })
      .then((result) => res.json(result))
      .catch(next);
  });
});

app.post('/api/analyze', async (req, res) => {
  const cvText = cvTextFrom(req.body);
  const jobText = text(req.body.jobText, LIMITS.job, 'İlan metni');
  const notes = Array.isArray(req.body.notes) ? req.body.notes.slice(0, 10).map((n) => String(n.text ?? n).slice(0, 400)) : [];

  if (!ai.isConfigured()) {
    const fileNotes = Array.isArray(req.body.notes) ? req.body.notes.filter((n) => n && n.level).slice(0, 10) : [];
    return streamJob(req, res, async () => quickAtsCheck({ cvText, jobText, notes: fileNotes }));
  }
  await streamJob(req, res, async ({ signal, onText }) => ({
    mode: 'ai',
    ...(await ai.analyzeCv({ cvText, jobText, notes, signal, onText })),
  }));
});

app.post('/api/optimize', async (req, res) => {
  const cvText = cvTextFrom(req.body);
  const jobText = text(req.body.jobText, LIMITS.job, 'İlan metni');
  const instructions = text(req.body.instructions, LIMITS.short, 'Ek talimat');
  const language = ['tr', 'en'].includes(req.body.language) ? req.body.language : 'auto';
  await streamJob(req, res, ({ signal, onText }) =>
    ai.optimizeCv({ cvText, jobText, language, instructions, signal, onText }),
  );
});

app.post('/api/cover-letter', async (req, res) => {
  const cvText = cvTextFrom(req.body);
  const jobText = text(req.body.jobText, LIMITS.job, 'İlan metni', { required: true, min: 60 });
  const params = {
    cvText,
    jobText,
    tone: String(req.body.tone || 'otomatik'),
    length: String(req.body.length || 'orta'),
    language: ['tr', 'en'].includes(req.body.language) ? req.body.language : 'auto',
    company: text(req.body.company, 120, 'Şirket adı'),
    manager: text(req.body.manager, 120, 'Yetkili adı'),
    extra: text(req.body.extra, LIMITS.short, 'Ek not'),
  };
  await streamJob(req, res, async ({ signal, send }) => {
    const letter = await ai.writeCoverLetter({
      ...params,
      signal,
      onText: (delta) => send({ type: 'delta', text: delta }),
    });
    return { text: letter };
  });
});

app.post('/api/match', async (req, res) => {
  const cvText = cvTextFrom(req.body);
  const jobs = (Array.isArray(req.body.jobs) ? req.body.jobs : [])
    .map((j) => text(j, 15_000, 'İlan'))
    .filter((j) => j.length > 30)
    .slice(0, LIMITS.jobs);
  const p = req.body.preferences || {};
  const preferences = {
    'target roles': text(p.roles, 300, 'Hedef pozisyon'),
    location: text(p.location, 120, 'Lokasyon'),
    'work type': (Array.isArray(p.workType) ? p.workType : []).map(String).slice(0, 3),
    seniority: text(p.seniority, 60, 'Seviye'),
    'salary expectation': text(p.salary, 60, 'Maaş beklentisi'),
    'other notes': text(p.notes, 600, 'Not'),
  };
  await streamJob(req, res, ({ signal, onText }) => ai.matchJobs({ cvText, preferences, jobs, signal, onText }));
});

app.post('/api/export/cv', async (req, res) => {
  const cv = req.body?.cv;
  if (!cv || typeof cv !== 'object') throw new UserError('CV verisi eksik.');
  const buffer = await cvToDocx(cv);
  sendDocx(res, buffer, `${safeName(cv.name, 'CV')}_CV.docx`);
});

app.post('/api/export/letter', async (req, res) => {
  const letter = text(req.body?.text, 20_000, 'Ön yazı', { required: true });
  const buffer = await letterToDocx({ text: letter, title: 'Ön Yazı' });
  sendDocx(res, buffer, `${safeName(req.body?.name, 'On_Yazi')}_On_Yazi.docx`);
});

app.get('/api/applications', async (req, res) => {
  res.json(await store.listApplications());
});
app.post('/api/applications', async (req, res) => {
  res.status(201).json(await store.createApplication(req.body || {}));
});
app.put('/api/applications/:id', async (req, res) => {
  res.json(await store.updateApplication(req.params.id, req.body || {}));
});
app.delete('/api/applications/:id', async (req, res) => {
  await store.deleteApplication(req.params.id);
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));

// Express 5 forwards rejected promises from async handlers here.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !err.expose) console.error(err);
  // body-parser errors are marked expose=true but carry English messages; check them first.
  const message =
    err.type === 'entity.too.large'
      ? 'Gönderilen veri çok büyük.'
      : err.type === 'entity.parse.failed'
        ? 'Geçersiz JSON gönderildi.'
        : err instanceof UserError
          ? err.message
          : status < 500
            ? 'İstek işlenemedi.'
            : 'Sunucu hatası oluştu.';
  if (res.headersSent) return res.end();
  res.status(status).json({ error: message });
});

export default app;
