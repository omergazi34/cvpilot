// CVPilot — Uygulama mantığı
(() => {
  'use strict';

  /* =========================================================
     Yardımcılar
     ========================================================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(`cvpilot.${key}`);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`cvpilot.${key}`, JSON.stringify(value)); } catch { /* depolama kapalı olabilir */ }
    },
    del(key) {
      try { localStorage.removeItem(`cvpilot.${key}`); } catch { /* yok say */ }
    },
    clearAll() {
      try { Object.keys(localStorage).filter((k) => k.startsWith('cvpilot.')).forEach((k) => localStorage.removeItem(k)); } catch { /* yok say */ }
    },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/icons.svg#${name}"/></svg>`;
  const withPlaceholders = (s) => esc(s).replace(/\[[^\]\n]{1,40}\]/g, (m) => `<mark class="ph">${m}</mark>`);
  const countWords = (t) => (String(t).match(/\S+/g) || []).length;
  const level = (s) => (s >= 80 ? 'good' : s >= 60 ? 'mid' : 'bad');
  const LEVEL_COLOR = { good: '#34d399', mid: '#fbbf24', bad: '#f87171' };
  const scoreColor = (s) => LEVEL_COLOR[level(s)];
  const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const hueOf = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

  function animateCount(el, to, duration = 1400) {
    to = Number(to) || 0;
    if (reduceMotion) { el.textContent = to; return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 4)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const runCounters = (root) => $$('[data-count]', root).forEach((el) => animateCount(el, el.dataset.count));
  const stagger = (root) => [...root.children].forEach((c, i) => c.style.setProperty('--i', i));

  function toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check-circle')}<span>${esc(message)}</span>`;
    $('#toasts').append(el);
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, type === 'error' ? 5200 : 3200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Panoya kopyalandı');
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `İstek başarısız (${res.status})`);
    return data;
  }

  /** NDJSON akışını okur; ara olayları onEvent'e iletir, sonucu döndürür. */
  async function streamRequest(url, body, { signal, onEvent } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error('Sunucuya bağlanılamadı. Sunucunun çalıştığından emin olun.', { cause: err });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Sunucu hatası (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'error') throw new Error(ev.message);
        if (ev.type === 'result') result = ev.data;
        else onEvent?.(ev);
      }
    }
    if (result === undefined) throw new Error('Bağlantı yarıda kesildi. Lütfen tekrar deneyin.');
    return result;
  }

  async function downloadFile(url, body, fallbackName) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Dosya oluşturulamadı.');
    }
    const blob = await res.blob();
    const match = (res.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/);
    const name = match ? decodeURIComponent(match[1]) : fallbackName;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${name} indirildi`);
  }

  function printPaper(innerHtml, paperClass, title) {
    const root = $('#printRoot');
    root.innerHTML = `<article class="paper ${paperClass}">${innerHtml}</article>`;
    const oldTitle = document.title;
    document.title = title;
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      root.innerHTML = '';
      document.title = oldTitle;
    };
    addEventListener('afterprint', done, { once: true });
    setTimeout(() => print(), 50);
  }

  /* ---------- Konfeti ---------- */
  function confetti() {
    if (reduceMotion) return;
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#a78bfa', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#818cf8'];
    const parts = Array.from({ length: innerWidth < 600 ? 90 : 150 }, (_, i) => ({
      x: innerWidth * (i % 2 ? 0.3 : 0.7),
      y: innerHeight * 0.55,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 6,
      w: Math.random() * 8 + 5,
      h: Math.random() * 4 + 3,
      c: colors[i % colors.length],
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
    }));
    const start = performance.now();
    const tick = (now) => {
      const t = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - t / 2800);
      for (const p of parts) {
        p.vy += 0.38;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (t < 2800) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(tick);
  }

  /* =========================================================
     Durum
     ========================================================= */
  const state = {
    ai: null,
    model: '',
    cv: store.get('cv'),
    job: store.get('job', ''),
    analysis: store.get('analysis'),
    optimized: store.get('optimized'),
    letter: store.get('letter'),
    match: store.get('match'),
    matchJobs: store.get('matchJobs', ['']),
    apps: [],
    uploading: false,
    busy: {},
  };

  /* =========================================================
     Sekmeler
     ========================================================= */
  const TABS = ['analiz', 'uyarla', 'onyazi', 'takip', 'eslesme'];
  let currentTab = null;

  function moveIndicators() {
    const sideLink = $(`.side-nav a[data-tab="${currentTab}"]`);
    const ind = $('.side-indicator');
    if (sideLink && ind && sideLink.offsetParent) {
      ind.style.transform = `translateY(${sideLink.offsetTop}px)`;
      ind.style.height = `${sideLink.offsetHeight}px`;
    }
    const tabLink = $(`.tabbar a[data-tab="${currentTab}"]`);
    const blob = $('.tab-blob');
    if (tabLink && blob && tabLink.offsetParent) {
      blob.style.width = `${tabLink.offsetWidth}px`;
      blob.style.transform = `translateX(${tabLink.offsetLeft - 6}px)`;
    }
  }

  function showTab(name, { instant = false } = {}) {
    if (!TABS.includes(name)) name = 'analiz';
    if (name === currentTab) return;
    const next = $(`#panel-${name}`);
    const prev = currentTab && $(`#panel-${currentTab}`);
    currentTab = name;

    $$('[data-tab]').forEach((a) => {
      const on = a.dataset.tab === name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    moveIndicators();
    stagger(next);

    const activate = () => {
      next.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (name === 'takip') loadApps();
    };
    if (prev && !instant && !reduceMotion) {
      prev.classList.remove('active');
      prev.classList.add('leaving');
      setTimeout(() => { prev.classList.remove('leaving'); activate(); }, 170);
    } else {
      prev?.classList.remove('active');
      activate();
    }
  }

  addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  addEventListener('resize', moveIndicators, { passive: true });

  /* =========================================================
     Yapay zekâ durumu
     ========================================================= */
  async function loadStatus() {
    try {
      const s = await api('/api/status');
      state.ai = s.ai;
      state.model = s.model;
    } catch {
      state.ai = false;
    }
    $$('[data-ai-pill]').forEach((pill) => {
      pill.classList.toggle('on', state.ai);
      pill.classList.toggle('off', !state.ai);
      const compact = pill.classList.contains('compact');
      $('span', pill).textContent = state.ai ? (compact ? 'AI' : 'Yapay zekâ aktif') : compact ? 'Demo' : 'Demo modu';
      pill.title = state.ai ? `Model: ${state.model}` : 'API anahtarı tanımlı değil';
    });
    const banner = $('[data-ai-banner]');
    banner.classList.toggle('hidden', state.ai || store.get('bannerClosed', false));
  }
  $('[data-close-banner]').addEventListener('click', () => {
    $('[data-ai-banner]').classList.add('hidden');
    store.set('bannerClosed', true);
  });

  /* =========================================================
     CV yükleme ve görüntüleme
     ========================================================= */
  const fileInput = $('#fileInput');
  const dropzone = $('#dropzone');

  const SOURCE_LABEL = { pdf: 'PDF', docx: 'Word', txt: 'Metin', image: 'Görsel', text: 'Yapıştırılan metin', ai: 'CVPilot' };

  function setCv(cv) {
    state.cv = { ...cv, words: cv.words ?? countWords(cv.text) };
    store.set('cv', state.cv);
    state.analysis = null;
    store.del('analysis');
    $('#analyzeResults').innerHTML = '';
    renderCv();
  }

  async function uploadFile(file) {
    if (!file || state.uploading) return;
    if (file.size > 10 * 1024 * 1024) return toast('Dosya en fazla 10 MB olabilir.', 'error');
    state.uploading = true;
    dropzone.classList.add('busy');
    $('[data-dz-status]').textContent = /pdf|image/.test(file.type) && state.ai
      ? 'Okunuyor… (taranmış dosyalar yapay zekâ ile metne çevrilir)'
      : 'Metin çıkarılıyor…';
    renderCv();
    if (currentTab !== 'analiz') toast(`${file.name} yükleniyor…`, 'info');

    const form = new FormData();
    form.append('cv', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Yükleme başarısız oldu.');
      await wait(reduceMotion ? 0 : 500); // tarama animasyonu görünsün
      setCv({ text: data.text, fileName: data.fileName, words: data.words, source: data.source, notes: data.notes, ocr: data.ocr });
      toast(`${data.fileName} yüklendi · ${data.words} kelime`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.uploading = false;
      dropzone.classList.remove('busy');
      fileInput.value = '';
      renderCv();
    }
  }

  function renderCv() {
    const cv = state.cv;
    const loaded = $('[data-cv-loaded]');
    dropzone.classList.toggle('hidden', Boolean(cv) && !state.uploading);
    loaded.classList.toggle('hidden', !cv || state.uploading);
    $('[data-paste-cv]').classList.toggle('hidden', Boolean(cv));

    const meta = cv ? `${SOURCE_LABEL[cv.source] || 'Dosya'} · ${cv.words.toLocaleString('tr-TR')} kelime${cv.ocr ? ' · yapay zekâ ile okundu' : ''}` : '';
    if (cv) {
      const notes = (cv.notes || [])
        .map((n) => `<div class="note ${esc(n.level)}">${icon(n.level === 'kritik' ? 'alert' : 'info', 'ico-sm')}<span>${esc(n.text)}</span></div>`)
        .join('');
      loaded.innerHTML = `
        <div class="cv-file">
          <span class="file-ico">${icon('file')}<span class="ok">${icon('check')}</span></span>
          <div class="cv-file-info"><b>${esc(cv.fileName)}</b><small>${esc(meta)}</small></div>
        </div>
        ${notes ? `<div class="notes">${notes}</div>` : ''}
        <div class="cv-file-actions">
          <button class="btn btn-ghost btn-sm" data-open-cv>${icon('pen', 'ico-sm')}Metni gör / düzenle</button>
          <button class="btn btn-ghost btn-sm" data-upload-cv>${icon('refresh', 'ico-sm')}Değiştir</button>
          <button class="btn btn-ghost btn-sm" data-remove-cv aria-label="CV'yi kaldır">${icon('trash', 'ico-sm')}</button>
        </div>`;
    }

    const strip = cv
      ? `<div class="cv-strip"><span class="file-ico">${icon('file')}</span><div><b>${esc(cv.fileName)}</b><small>${esc(meta)}</small></div><button class="btn btn-ghost btn-sm" data-open-cv>${icon('pen', 'ico-sm')}<span>Düzenle</span></button><button class="btn btn-ghost btn-sm btn-icon" data-upload-cv aria-label="CV'yi değiştir">${icon('refresh', 'ico-sm')}</button></div>`
      : `<div class="cv-strip missing"><span class="file-ico">${state.uploading ? '<span class="spinner"></span>' : icon('upload')}</span><div><b>${state.uploading ? 'CV yükleniyor…' : 'Henüz CV yüklenmedi'}</b><small>Bu araç CV'ne göre çalışır.</small></div><button class="btn btn-primary btn-sm" data-upload-cv>${icon('upload', 'ico-sm')}CV Yükle</button></div>`;
    $$('[data-cv-bar]').forEach((bar) => (bar.innerHTML = strip));

    $('[data-cv-summary]').innerHTML = cv
      ? `<div class="cv-mini"><div class="cv-mini-top"><span class="file-ico">${icon('file')}</span><div style="min-width:0"><b>${esc(cv.fileName)}</b><small>${cv.words.toLocaleString('tr-TR')} kelime</small></div></div><button class="btn btn-ghost btn-sm btn-block" data-open-cv>${icon('pen', 'ico-sm')}CV metnini düzenle</button></div>`
      : `<div class="cv-mini"><small>Henüz CV yüklenmedi.</small><button class="btn btn-soft btn-sm btn-block" data-upload-cv>${icon('upload', 'ico-sm')}CV Yükle</button></div>`;
    $('[data-cv-short]').textContent = cv ? 'CV ✓' : 'CV Yükle';
  }

  function requireCv() {
    if (state.cv?.text) return true;
    toast('Önce CV yükle veya metnini yapıştır.', 'error');
    $$('.cv-strip.missing, #dropzone').forEach((el) => {
      el.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 380 });
    });
    return false;
  }

  // Dosya seçme ve sürükle-bırak
  fileInput.addEventListener('change', () => uploadFile(fileInput.files[0]));
  dropzone.addEventListener('click', () => !state.uploading && fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const overlay = $('#dropOverlay');
  let dragDepth = 0;
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('show');
    dropzone.classList.add('drag');
  });
  addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
  addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) { overlay.classList.remove('show'); dropzone.classList.remove('drag'); }
  });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('show');
    dropzone.classList.remove('drag');
    uploadFile(e.dataTransfer.files[0]);
  });

  /* =========================================================
     Alt pencereler (sheet)
     ========================================================= */
  let lastFocus = null;
  function openSheet(sheet) {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    sheet.classList.remove('closing');
    document.body.classList.add('sheet-open');
    if (finePointer) setTimeout(() => $('input, textarea', sheet)?.focus({ preventScroll: true }), 80);
  }
  function closeSheet(sheet) {
    if (sheet.hidden || sheet.classList.contains('closing')) return;
    sheet.classList.add('closing');
    setTimeout(() => {
      sheet.hidden = true;
      sheet.classList.remove('closing');
      $('.sheet-panel', sheet).style.transform = '';
      if (!$('.sheet:not([hidden])')) document.body.classList.remove('sheet-open');
      lastFocus?.focus?.({ preventScroll: true });
    }, reduceMotion ? 0 : 260);
  }
  $$('.sheet').forEach((sheet) => {
    $$('[data-close-sheet]', sheet).forEach((b) => b.addEventListener('click', () => closeSheet(sheet)));
    // Mobilde aşağı kaydırarak kapatma
    const panel = $('.sheet-panel', sheet);
    let startY = null;
    let dy = 0;
    const handle = [$('.sheet-grab', sheet), $('.sheet-head', sheet)];
    handle.forEach((h) => {
      h.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; dy = 0; panel.style.transition = 'none'; }, { passive: true });
      h.addEventListener('touchmove', (e) => {
        if (startY === null) return;
        dy = Math.max(0, e.touches[0].clientY - startY);
        panel.style.transform = `translateY(${dy}px)`;
      }, { passive: true });
      h.addEventListener('touchend', () => {
        panel.style.transition = '';
        if (dy > 110) closeSheet(sheet);
        else panel.style.transform = '';
        startY = null;
      });
    });
  });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $$('.sheet:not([hidden])').pop();
    if (open) closeSheet(open);
  });

  // CV metni penceresi
  const cvSheet = $('#cvSheet');
  const cvTextArea = $('#cvText');
  function openCvSheet() {
    cvTextArea.value = state.cv?.text || '';
    openSheet(cvSheet);
  }
  $('#saveCvText').addEventListener('click', () => {
    const text = cvTextArea.value.trim();
    if (text.length < 80) return toast('CV metni çok kısa görünüyor.', 'error');
    if (text !== state.cv?.text) {
      setCv({
        text,
        fileName: state.cv?.fileName || 'Yapıştırılan CV',
        source: state.cv?.source || 'text',
        notes: state.cv?.source === 'text' || !state.cv ? [] : state.cv.notes,
      });
      toast('CV metni kaydedildi');
    }
    closeSheet(cvSheet);
  });

  // Genel tıklama yönlendirmesi (dinamik butonlar için)
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-upload-cv],[data-open-cv],[data-remove-cv],[data-paste-cv],[data-clear-data],[data-new-app]');
    if (!t) return;
    if (t.matches('[data-upload-cv]')) {
      if (!cvSheet.hidden) closeSheet(cvSheet);
      fileInput.click();
    } else if (t.matches('[data-open-cv],[data-paste-cv]')) {
      openCvSheet();
    } else if (t.matches('[data-remove-cv]')) {
      state.cv = null;
      store.del('cv');
      renderCv();
      toast('CV kaldırıldı', 'info');
    } else if (t.matches('[data-clear-data]')) {
      if (!confirm('Bu tarayıcıda saklanan CV metni, ilan ve sonuçlar silinecek. (Başvuru takip kayıtları ayrıca tutulur.) Devam edilsin mi?')) return;
      store.clearAll();
      Object.assign(state, { cv: null, job: '', analysis: null, optimized: null, letter: null, match: null, matchJobs: [''] });
      ['#analyzeResults', '#tailorResults', '#letterResults', '#matchResults'].forEach((s) => ($(s).innerHTML = ''));
      syncJob();
      renderCv();
      renderJobList();
      closeSheet(cvSheet);
      toast('Yerel veriler silindi', 'info');
    } else if (t.matches('[data-new-app]')) {
      openAppSheet();
    }
  });

  /* =========================================================
     İlan metni (tüm panellerde ortak)
     ========================================================= */
  function syncJob(except) {
    $$('[data-bind="job"]').forEach((ta) => {
      if (ta !== except) ta.value = state.job;
    });
  }
  $$('[data-bind="job"]').forEach((ta) => {
    ta.addEventListener('input', () => {
      state.job = ta.value;
      store.set('job', state.job);
      syncJob(ta);
    });
  });

  /* =========================================================
     Yapay zekâ yükleme animasyonu
     ========================================================= */
  const STEPS = {
    analyze: ['CV metni okunuyor', 'Anahtar kelimeler çıkarılıyor', 'ATS uyumluluğu puanlanıyor', 'İyileştirme önerileri hazırlanıyor', 'Rapor yazılıyor'],
    optimize: ['İlan gereksinimleri çıkarılıyor', 'Deneyimlerin eşleştiriliyor', 'Maddeler güçlendiriliyor', 'ATS biçimine dönüştürülüyor', 'Yeni CV yazılıyor'],
    letter: ['İlanın tonu analiz ediliyor', 'En güçlü başarıların seçiliyor', 'Ön yazı yazılıyor'],
    match: ['Profilin çıkarılıyor', 'Pozisyonlar taranıyor', 'Uyum puanları hesaplanıyor', 'Sonuçlar sıralanıyor'],
  };

  function createLoader(container, kind, expectedChars) {
    const steps = STEPS[kind];
    container.innerHTML = `
      <div class="ai-loader" role="status" aria-live="polite">
        <div class="loader-visual" aria-hidden="true">
          <span class="ring-orbit"></span><span class="ring-orbit r2"></span><span class="ring-orbit r3"></span>
          <div class="loader-doc"><span></span><span></span><span></span><span></span><i></i></div>
        </div>
        <div class="loader-info">
          <h3>${state.ai ? 'Yapay zekâ çalışıyor' : 'Analiz ediliyor'}<span class="dots"></span></h3>
          <ol class="loader-steps">${steps.map((s) => `<li><span class="st">${icon('check')}</span>${s}</li>`).join('')}</ol>
          <div class="loader-bar"><i></i></div>
          <div class="loader-meta"><span data-meta>Başlatılıyor…</span><button type="button" data-cancel>İptal</button></div>
        </div>
      </div>`;
    const items = $$('.loader-steps li', container);
    const bar = $('.loader-bar i', container);
    const meta = $('[data-meta]', container);
    const started = performance.now();
    let idx = -1;
    let p = 0.04;
    let phase = 'thinking';
    let chars = 0;
    const setStep = (i) => {
      if (i <= idx) return;
      idx = Math.min(i, items.length - 1);
      items.forEach((li, j) => {
        li.classList.toggle('done', j < idx);
        li.classList.toggle('active', j === idx);
      });
    };
    setStep(0);
    const timer = setInterval(() => {
      const secs = (performance.now() - started) / 1000;
      if (phase === 'thinking') {
        p += (0.6 - p) * 0.03;
        setStep(Math.min(items.length - 2, Math.floor(secs / 6)));
        meta.textContent = `Düşünüyor… ${Math.round(secs)} sn`;
      }
      bar.style.setProperty('--p', p.toFixed(3));
    }, 250);

    return {
      onEvent(ev) {
        if (ev.type === 'phase' && ev.phase === 'writing') {
          phase = 'writing';
          setStep(items.length - 1);
        } else if (ev.type === 'progress' || ev.type === 'delta') {
          chars = ev.chars ?? chars + ev.text.length;
          p = 0.6 + 0.38 * Math.min(1, chars / expectedChars);
          meta.textContent = `Yazıyor… ${chars.toLocaleString('tr-TR')} karakter`;
        }
      },
      finish() {
        clearInterval(timer);
        items.forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
        bar.style.setProperty('--p', 1);
      },
      stop() { clearInterval(timer); },
      onCancel(fn) { $('[data-cancel]', container)?.addEventListener('click', fn); },
    };
  }

  const errorCard = (message) => `
    <div class="error-card">${icon('alert')}<div><b>İşlem tamamlanamadı</b><p>${esc(message)}</p></div></div>`;

  async function runJob({ kind, btn, container, url, body, expectedChars = 6000, onEvent, render }) {
    if (state.busy[kind]) return;
    state.busy[kind] = true;
    const controller = new AbortController();
    btn.classList.add('is-loading');
    const loader = createLoader(container, kind, expectedChars);
    loader.onCancel(() => controller.abort());
    container.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    const started = performance.now();
    try {
      const data = await streamRequest(url, body, {
        signal: controller.signal,
        onEvent: (ev) => { loader.onEvent(ev); onEvent?.(ev); },
      });
      // Çok hızlı yanıtlarda (demo modu) animasyon algılanabilsin diye kısa bir alt sınır.
      const minShown = reduceMotion ? 0 : 1300 - (performance.now() - started);
      if (minShown > 0) await wait(minShown);
      loader.finish();
      await wait(reduceMotion ? 0 : 450);
      render(data);
    } catch (err) {
      loader.stop();
      if (err.name === 'AbortError') {
        container.innerHTML = '';
        toast('İşlem iptal edildi', 'info');
      } else {
        container.innerHTML = errorCard(err.message);
      }
    } finally {
      state.busy[kind] = false;
      btn.classList.remove('is-loading');
    }
  }

  /* =========================================================
     1) CV ANALİZİ
     ========================================================= */
  const BREAKDOWN = {
    keyword_match: 'Anahtar kelime eşleşmesi',
    formatting: 'ATS biçim uyumu',
    structure: 'Yapı ve bölümler',
    impact: 'Etki ve ölçülebilirlik',
    readability: 'Okunabilirlik',
  };
  const IMPORTANCE = { yuksek: 'Yüksek', orta: 'Orta', dusuk: 'Düşük' };
  const SEVERITY = { kritik: 'Kritik', orta: 'Orta', dusuk: 'Düşük' };

  function renderAnalysis(a, { celebrate = false } = {}) {
    const box = $('#analyzeResults');
    const score = clampScore(a.ats_score);
    const C = 2 * Math.PI * 70;
    const color = scoreColor(score);
    const profile = a.profile || {};
    const profileChips = [
      a.job?.title && `<span class="chip chip-cyan">${icon('briefcase', 'ico-sm')}${esc(a.job.title)}${a.job.company ? ` · ${esc(a.job.company)}` : ''}</span>`,
      profile.title && `<span class="chip chip-violet">${esc(profile.title)}</span>`,
      profile.seniority && `<span class="chip">${esc(profile.seniority)}</span>`,
      profile.years_experience && `<span class="chip">${esc(profile.years_experience)}</span>`,
    ].filter(Boolean).join('');

    const found = (a.found_keywords || []).map((k, i) => `<span class="chip chip-green" style="--k:${i}">${icon('check', 'ico-sm')}${esc(k)}</span>`).join('');
    const missing = (a.missing_keywords || []).map((k, i) => `
      <span class="chip chip-red" style="--k:${i}" title="${esc(k.where_to_add)}">${icon('x', 'ico-sm')}${esc(k.keyword)}<span class="imp">${IMPORTANCE[k.importance] || ''}</span></span>`).join('');

    const strengths = (a.strengths || []).map((s) => `<li>${icon('check-circle', 'ico-sm')}<span>${esc(s)}</span></li>`).join('');
    const issues = (a.issues || []).map((it, i) => `
      <details class="issue" ${i === 0 ? 'open' : ''}>
        <summary><span class="sev ${esc(it.severity)}">${SEVERITY[it.severity] || esc(it.severity)}</span><span>${esc(it.title)}</span>${icon('chevron-down', 'ico-sm chev')}</summary>
        <div class="issue-body">
          ${it.detail ? `<p>${esc(it.detail)}</p>` : ''}
          ${it.fix ? `<div class="fix">${icon('wand', 'ico-sm')}<span>${withPlaceholders(it.fix)}</span></div>` : ''}
        </div>
      </details>`).join('');

    const rewrites = (a.rewrites || []).map((r) => `
      <div class="rewrite">
        <div class="rewrite-head"><span>${esc(r.section || 'Öneri')}</span><button class="btn btn-ghost btn-sm" data-copy="${esc(r.improved)}">${icon('copy', 'ico-sm')}Kopyala</button></div>
        <div class="rw-before">${esc(r.original)}</div>
        <div class="rw-after">${withPlaceholders(r.improved)}</div>
        ${r.reason ? `<div class="rw-reason">${esc(r.reason)}</div>` : ''}
      </div>`).join('');

    box.innerHTML = `
      <div class="res-head">
        <h2>Analiz sonucu</h2>
        <span class="chip ${a.mode === 'demo' ? 'chip-amber' : 'chip-violet'} mode-tag">${icon(a.mode === 'demo' ? 'zap' : 'sparkles', 'ico-sm')}${a.mode === 'demo' ? 'Demo · kural tabanlı' : 'Yapay zekâ analizi'}</span>
      </div>
      <div class="score-grid">
        <div class="card score-panel">
          <div class="gauge" style="--g-glow:${color}88">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <circle class="g-track" cx="80" cy="80" r="70"/>
              <circle class="g-val" cx="80" cy="80" r="70" stroke="${color}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-offset="${(C * (1 - score / 100)).toFixed(1)}"/>
            </svg>
            <div class="gauge-num"><b data-count="${score}" style="color:${color}">0</b><small>/ 100 ATS puanı</small></div>
          </div>
          <div class="score-text">
            <h2>${esc(a.verdict)}</h2>
            <p>${esc(a.summary)}</p>
            ${profileChips ? `<div class="chips">${profileChips}</div>` : ''}
          </div>
        </div>
        <div class="card breakdown">
          ${Object.entries(BREAKDOWN).map(([key, label]) => {
            const v = clampScore(a.score_breakdown?.[key]);
            return `<div class="bd-row lvl-${level(v)}"><div class="bd-top"><span>${label}</span><b data-count="${v}">0</b></div><div class="bd-bar"><i style="width:${v}%"></i></div></div>`;
          }).join('')}
        </div>
      </div>

      <div class="card sec-card">
        <h3>${icon('target')}Anahtar kelimeler</h3>
        ${found ? `<div class="kw-group"><small>CV'nde bulunanlar (${a.found_keywords.length})</small><div class="chips">${found}</div></div>` : ''}
        ${missing ? `<div class="kw-group"><small>Eksik olanlar (${a.missing_keywords.length}) — yalnızca gerçekten sahip olduklarını ekle</small><div class="chips">${missing}</div></div>` : '<p class="muted small">Önemli bir eksik anahtar kelime bulunamadı. 🎉</p>'}
      </div>

      <div class="grid-2">
        <div class="card sec-card"><h3>${icon('star')}Güçlü yönler</h3><ul class="list-check">${strengths}</ul></div>
        <div class="card sec-card"><h3>${icon('alert')}Düzeltilmesi gerekenler <span class="count">${(a.issues || []).length}</span></h3><div class="issues">${issues || '<p class="muted small">Kayda değer sorun bulunamadı.</p>'}</div></div>
      </div>

      ${rewrites ? `<div class="card sec-card"><h3>${icon('wand')}Cümle bazında yeniden yazım önerileri</h3><div class="rewrites">${rewrites}</div></div>` : ''}

      <div class="cta-strip">
        <div><b>Tüm bu düzeltmeleri tek tıkla uygula</b><p>Yapay zekâ CV'ni ${state.job.trim() ? 'bu ilana göre' : 'ATS kurallarına göre'} baştan yazsın; DOCX/PDF olarak indir.</p></div>
        <button class="btn btn-primary" data-autofix>${icon('wand')}CV'mi otomatik düzelt</button>
      </div>`;

    stagger(box);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ring = $('.g-val', box);
      if (ring) ring.style.strokeDashoffset = ring.dataset.offset;
      $$('.bd-bar i', box).forEach((bar, i) => setTimeout(() => (bar.style.transform = 'scaleX(1)'), 150 + i * 90));
      runCounters(box);
    }));
    if (celebrate && score >= 80) setTimeout(confetti, 900);
  }

  $('#analyzeBtn').addEventListener('click', (e) => {
    if (!requireCv()) return;
    runJob({
      kind: 'analyze',
      btn: e.currentTarget,
      container: $('#analyzeResults'),
      url: '/api/analyze',
      body: { cvText: state.cv.text, jobText: state.job, notes: state.cv.notes || [] },
      expectedChars: 6500,
      render: (data) => {
        state.analysis = data;
        store.set('analysis', data);
        renderAnalysis(data, { celebrate: true });
      },
    });
  });

  $('#analyzeResults').addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) return copyText(copy.dataset.copy);
    if (e.target.closest('[data-autofix]')) {
      location.hash = 'uyarla';
      setTimeout(() => $('#tailorBtn').click(), 450);
    }
  });

  /* =========================================================
     2) İLANA ÖZEL CV
     ========================================================= */
  const CV_LABELS = {
    tr: { summary: 'Profesyonel Özet', skills: 'Yetkinlikler', experience: 'İş Deneyimi', education: 'Eğitim', projects: 'Projeler', certifications: 'Sertifikalar', languages: 'Yabancı Diller' },
    en: { summary: 'Professional Summary', skills: 'Skills', experience: 'Work Experience', education: 'Education', projects: 'Projects', certifications: 'Certifications', languages: 'Languages' },
  };
  const filled = (list) => (list || []).filter((x) => (typeof x === 'string' ? x.trim() : x));
  const dateRange = (a, b) => [a, b].filter(Boolean).join(' – ');

  function cvPaperHtml(cv) {
    const L = CV_LABELS[cv.language === 'en' ? 'en' : 'tr'];
    const contact = [cv.email, cv.phone, cv.location, ...filled(cv.links)].filter(Boolean).map(esc).join('  |  ');
    const sec = (title, body) => (body ? `<section><h3>${esc(title)}</h3>${body}</section>` : '');
    const bullets = (items) => (filled(items).length ? `<ul>${filled(items).map((b) => `<li>${withPlaceholders(b)}</li>`).join('')}</ul>` : '');
    return `
      <h2>${esc(cv.name || 'Ad Soyad')}</h2>
      ${cv.headline ? `<div class="cv-headline">${esc(cv.headline)}</div>` : ''}
      ${contact ? `<div class="cv-contact">${contact}</div>` : ''}
      ${sec(L.summary, cv.summary && `<p>${withPlaceholders(cv.summary)}</p>`)}
      ${sec(L.skills, filled(cv.skills).filter((g) => filled(g.items).length).map((g) => `<div class="skill-row">${g.group ? `<b>${esc(g.group)}:</b> ` : ''}${filled(g.items).map(esc).join(', ')}</div>`).join(''))}
      ${sec(L.experience, filled(cv.experience).map((j) => `
        <div class="role">
          <div class="role-title">${esc(j.role)}${j.company ? ` <span>| ${esc(j.company)}</span>` : ''}</div>
          <div class="role-meta">${[j.location, dateRange(j.start, j.end)].filter(Boolean).map(esc).join(' · ')}</div>
          ${bullets(j.bullets)}
        </div>`).join(''))}
      ${sec(L.education, filled(cv.education).map((ed) => `
        <div class="role">
          <div class="role-title">${esc(ed.degree)}${ed.school ? ` <span>| ${esc(ed.school)}</span>` : ''}</div>
          <div class="role-meta">${[ed.location, dateRange(ed.start, ed.end)].filter(Boolean).map(esc).join(' · ')}</div>
          ${ed.details ? `<p>${withPlaceholders(ed.details)}</p>` : ''}
        </div>`).join(''))}
      ${sec(L.projects, filled(cv.projects).map((p) => `<p><b>${esc(p.name)}</b>${filled(p.tech).length ? ` (${filled(p.tech).map(esc).join(', ')})` : ''}: ${withPlaceholders(p.description)}</p>`).join(''))}
      ${sec(L.certifications, bullets(cv.certifications))}
      ${sec(L.languages, bullets(cv.languages))}
      ${filled(cv.extras).map((x) => sec(x.heading, bullets(x.items))).join('')}`;
  }

  function cvToText(cv) {
    const L = CV_LABELS[cv.language === 'en' ? 'en' : 'tr'];
    const out = [cv.name, cv.headline, [cv.email, cv.phone, cv.location, ...filled(cv.links)].filter(Boolean).join(' | ')].filter(Boolean);
    const head = (t) => out.push('', t.toLocaleUpperCase(cv.language === 'en' ? 'en-US' : 'tr-TR'));
    if (cv.summary) { head(L.summary); out.push(cv.summary); }
    const skills = filled(cv.skills).filter((g) => filled(g.items).length);
    if (skills.length) { head(L.skills); skills.forEach((g) => out.push(`${g.group ? `${g.group}: ` : ''}${filled(g.items).join(', ')}`)); }
    if (filled(cv.experience).length) {
      head(L.experience);
      filled(cv.experience).forEach((j, i) => {
        if (i) out.push('');
        out.push(`${j.role}${j.company ? ` | ${j.company}` : ''}`);
        const meta = [j.location, dateRange(j.start, j.end)].filter(Boolean).join(' · ');
        if (meta) out.push(meta);
        filled(j.bullets).forEach((b) => out.push(`- ${b}`));
      });
    }
    if (filled(cv.education).length) {
      head(L.education);
      filled(cv.education).forEach((ed) => {
        out.push(`${ed.degree}${ed.school ? ` | ${ed.school}` : ''}`);
        const meta = [ed.location, dateRange(ed.start, ed.end)].filter(Boolean).join(' · ');
        if (meta) out.push(meta);
        if (ed.details) out.push(ed.details);
      });
    }
    if (filled(cv.projects).length) {
      head(L.projects);
      filled(cv.projects).forEach((p) => out.push(`- ${p.name}${filled(p.tech).length ? ` (${filled(p.tech).join(', ')})` : ''}: ${p.description}`));
    }
    const list = (title, items) => { if (filled(items).length) { head(title); filled(items).forEach((x) => out.push(`- ${x}`)); } };
    list(L.certifications, cv.certifications);
    list(L.languages, cv.languages);
    filled(cv.extras).forEach((x) => list(x.heading, x.items));
    return out.join('\n');
  }

  function renderOptimized(o, { celebrate = false } = {}) {
    const box = $('#tailorResults');
    const before = clampScore(o.score_before);
    const after = clampScore(o.score_after);
    const diff = after - before;
    const placeholders = o.placeholders || [];
    const changes = o.changes || [];
    const jobChip = o.job?.title ? `<span class="chip chip-cyan">${icon('briefcase', 'ico-sm')}${esc(o.job.title)}${o.job.company ? ` · ${esc(o.job.company)}` : ''}</span>` : '<span class="chip chip-violet">Genel ATS optimizasyonu</span>';

    box.innerHTML = `
      <div class="res-head"><h2>Optimize edilmiş CV'n hazır</h2>${jobChip}</div>
      <div class="card uplift">
        <div class="uplift-scores">
          <div class="sc"><b data-count="${before}" style="color:${scoreColor(before)}">0</b><small>Önce</small></div>
          ${icon('arrow-right', 'ico-lg arrow')}
          <div class="sc"><b data-count="${after}" style="color:${scoreColor(after)}">0</b><small>Sonra</small></div>
        </div>
        <div class="uplift-text">
          <h2>${diff > 0 ? `+${diff} puan artış` : 'CV yeniden yapılandırıldı'}</h2>
          <p>${changes.length} değişiklik yapıldı.${placeholders.length ? ` İndirmeden önce ${placeholders.length} yer tutucuyu gerçek bilgilerinle doldur.` : ''}</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" data-act="docx">${icon('download')}DOCX indir</button>
        <button class="btn btn-ghost" data-act="pdf">${icon('printer')}PDF olarak kaydet</button>
        <button class="btn btn-ghost" data-act="copy">${icon('copy')}Metni kopyala</button>
        <button class="btn btn-ghost" data-act="use">${icon('refresh')}Aktif CV yap</button>
        <button class="btn btn-soft" data-act="track">${icon('board')}Takibe ekle</button>
      </div>
      ${placeholders.length ? `
        <div class="card sec-card">
          <h3>${icon('pen')}Doldurman gereken yerler <span class="count">${placeholders.length}</span></h3>
          <div class="ph-list">${placeholders.map((p) => `<div class="ph-item"><mark class="ph">${esc(p.placeholder)}</mark><span>${esc(p.hint)}</span></div>`).join('')}</div>
        </div>` : ''}
      <div class="cv-out">
        <div class="paper-wrap">
          <div class="paper-tools"><b>Önizleme</b><small class="muted">ATS dostu tek sütun · sarı alanlar doldurulacak</small></div>
          <article class="paper cv-paper">${cvPaperHtml(o.cv)}</article>
        </div>
        <div class="card sec-card">
          <h3>${icon('sparkles')}Yapılan değişiklikler</h3>
          <ol class="changes">${changes.map((c) => `<li><div><b>${esc(c.area)}</b><br><span>${esc(c.description)}</span></div></li>`).join('')}</ol>
        </div>
      </div>`;
    stagger(box);
    requestAnimationFrame(() => runCounters(box));
    if (celebrate) setTimeout(confetti, 700);
  }

  function runTailor() {
    if (!requireCv()) return;
    runJob({
      kind: 'optimize',
      btn: $('#tailorBtn'),
      container: $('#tailorResults'),
      url: '/api/optimize',
      body: {
        cvText: state.cv.text,
        jobText: state.job,
        language: $('#tailorLang').value,
        instructions: $('#tailorExtra').value,
      },
      expectedChars: 9000,
      render: (data) => {
        state.optimized = data;
        store.set('optimized', data);
        renderOptimized(data, { celebrate: true });
      },
    });
  }
  $('#tailorBtn').addEventListener('click', runTailor);

  async function addApplication(data) {
    try {
      const app = await api('/api/applications', { method: 'POST', body: JSON.stringify(data) });
      state.apps.unshift(app);
      toast('Takip paneline eklendi');
      return app;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  $('#tailorResults').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const o = state.optimized;
    if (!btn || !o) return;
    const act = btn.dataset.act;
    if (act === 'docx') {
      btn.classList.add('is-loading');
      try { await downloadFile('/api/export/cv', { cv: o.cv }, 'CV.docx'); } catch (err) { toast(err.message, 'error'); }
      btn.classList.remove('is-loading');
    } else if (act === 'pdf') {
      printPaper(cvPaperHtml(o.cv), 'cv-paper', `${o.cv.name || 'CV'} - CV`);
    } else if (act === 'copy') {
      copyText(cvToText(o.cv));
    } else if (act === 'use') {
      setCv({ text: cvToText(o.cv), fileName: `${o.cv.name || 'CV'} (optimize)`, source: 'ai', notes: [] });
      toast('Optimize edilmiş CV artık aktif CV\'n');
    } else if (act === 'track') {
      addApplication({ company: o.job?.company || '', position: o.job?.title || o.cv.headline || 'Pozisyon', status: 'kaydedildi', matchScore: o.score_after });
    }
  });

  /* =========================================================
     3) ÖN YAZI
     ========================================================= */
  function setupChoice(group, { multi = false, onChange } = {}) {
    const buttons = $$('button', group);
    const pill = $('.seg-pill', group);
    const placePill = () => {
      const active = $('button.active', group);
      if (pill && active && active.offsetParent) {
        pill.style.width = `${active.offsetWidth}px`;
        pill.style.transform = `translateX(${active.offsetLeft}px)`;
      }
    };
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (multi) {
        b.classList.toggle('active');
        b.setAttribute('aria-pressed', String(b.classList.contains('active')));
      } else {
        buttons.forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-checked', String(x === b));
        });
        placePill();
      }
      onChange?.();
    }));
    if (pill) {
      new ResizeObserver(placePill).observe(group);
    }
    return {
      get value() { return multi ? $$('button.active', group).map((x) => x.dataset.value) : $('button.active', group)?.dataset.value; },
      set value(v) {
        buttons.forEach((x) => {
          const on = multi ? (v || []).includes(x.dataset.value) : x.dataset.value === v;
          x.classList.toggle('active', on);
          x.setAttribute(multi ? 'aria-pressed' : 'aria-checked', String(on));
        });
        placePill();
      },
    };
  }

  const tone = setupChoice($('#letterTone'));
  const length = setupChoice($('#letterLength'));

  function letterShell(streaming) {
    return `
      <div class="res-head"><h2>Ön yazın</h2><span class="word-count" data-wc>0 kelime</span></div>
      <div class="paper-wrap"><article class="paper letter-paper ${streaming ? 'streaming' : ''}" spellcheck="false"></article></div>
      <div class="actions ${streaming ? 'hidden' : ''}" data-letter-actions>
        <button class="btn btn-primary" data-lact="copy">${icon('copy')}Kopyala</button>
        <button class="btn btn-ghost" data-lact="docx">${icon('download')}DOCX indir</button>
        <button class="btn btn-ghost" data-lact="pdf">${icon('printer')}PDF olarak kaydet</button>
        <button class="btn btn-soft" data-lact="again">${icon('refresh')}Yeniden oluştur</button>
      </div>
      <p class="muted small ${streaming ? 'hidden' : ''}" data-letter-tip>${icon('info', 'ico-sm')} Metnin üzerine tıklayarak doğrudan düzenleyebilirsin.</p>`;
  }

  function finalizeLetter(text) {
    const box = $('#letterResults');
    if (!$('.letter-paper', box)) box.innerHTML = letterShell(false);
    const paper = $('.letter-paper', box);
    paper.textContent = text;
    paper.classList.remove('streaming');
    paper.contentEditable = 'true';
    $('[data-wc]', box).textContent = `${countWords(text)} kelime`;
    $('[data-letter-actions]', box).classList.remove('hidden');
    $('[data-letter-tip]', box).classList.remove('hidden');
    paper.addEventListener('input', () => {
      state.letter.text = paper.innerText;
      store.set('letter', state.letter);
      $('[data-wc]', box).textContent = `${countWords(paper.innerText)} kelime`;
    });
  }

  function runLetter() {
    if (!requireCv()) return;
    if (state.job.trim().length < 60) {
      toast('Ön yazı için ilan metnini yapıştır.', 'error');
      $('#letterJob').focus();
      return;
    }
    const box = $('#letterResults');
    let paper = null;
    let text = '';
    runJob({
      kind: 'letter',
      btn: $('#letterBtn'),
      container: box,
      url: '/api/cover-letter',
      body: {
        cvText: state.cv.text,
        jobText: state.job,
        tone: tone.value,
        length: length.value,
        language: $('#letterLang').value,
        company: $('#letterCompany').value,
        manager: $('#letterManager').value,
        extra: $('#letterExtra').value,
      },
      expectedChars: 1900,
      onEvent: (ev) => {
        if (ev.type !== 'delta') return;
        if (!paper) {
          box.innerHTML = letterShell(true);
          stagger(box);
          paper = $('.letter-paper', box);
        }
        text += ev.text;
        paper.textContent = text;
        $('[data-wc]', box).textContent = `${countWords(text)} kelime`;
      },
      render: (data) => {
        state.letter = { text: data.text, company: $('#letterCompany').value };
        store.set('letter', state.letter);
        finalizeLetter(data.text);
        store.set('letterOpts', { tone: tone.value, length: length.value, lang: $('#letterLang').value, company: $('#letterCompany').value, manager: $('#letterManager').value, extra: $('#letterExtra').value });
      },
    });
  }
  $('#letterBtn').addEventListener('click', runLetter);

  $('#letterResults').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-lact]');
    if (!btn || !state.letter) return;
    const text = $('.letter-paper', $('#letterResults'))?.innerText || state.letter.text;
    const act = btn.dataset.lact;
    if (act === 'copy') copyText(text);
    else if (act === 'docx') {
      btn.classList.add('is-loading');
      try { await downloadFile('/api/export/letter', { text, name: state.letter.company || 'On_Yazi' }, 'On_Yazi.docx'); } catch (err) { toast(err.message, 'error'); }
      btn.classList.remove('is-loading');
    } else if (act === 'pdf') printPaper(esc(text), 'letter-paper', 'Ön Yazı');
    else if (act === 'again') runLetter();
  });

  /* =========================================================
     4) BAŞVURU TAKİBİ
     ========================================================= */
  const STATUSES = [
    { id: 'kaydedildi', label: 'Kaydedildi', c: '#a6a6c8' },
    { id: 'basvuruldu', label: 'Başvuruldu', c: '#818cf8' },
    { id: 'mulakat', label: 'Mülakat', c: '#fbbf24' },
    { id: 'teklif', label: 'Teklif', c: '#34d399' },
    { id: 'red', label: 'Olumsuz', c: '#f87171' },
  ];
  const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;
  const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  const parseDate = (s) => {
    if (!s) return null;
    const d = new Date(s.length === 10 ? `${s}T00:00` : s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  function relative(d) {
    const diff = d.getTime() - Date.now();
    const hours = Math.round(diff / 36e5);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(diff / 864e5), 'day');
  }

  async function loadApps() {
    try {
      state.apps = await api('/api/applications');
    } catch (err) {
      toast(`Başvurular yüklenemedi: ${err.message}`, 'error');
    }
    renderTracker();
  }

  function renderTracker(flashId) {
    const apps = state.apps;
    const count = (id) => apps.filter((a) => a.status === id).length;
    const applied = apps.filter((a) => a.status !== 'kaydedildi').length;
    const responded = count('mulakat') + count('teklif') + count('red');
    const rate = applied ? Math.round((responded / applied) * 100) : 0;
    $('#trackerStats').innerHTML = [
      ['Toplam başvuru', apps.length, '#8b5cf6'],
      ['Aktif süreç', count('basvuruldu') + count('mulakat'), '#818cf8'],
      ['Mülakat', count('mulakat'), '#fbbf24'],
      ['Teklif', count('teklif'), '#34d399'],
      ['Yanıt oranı', `%${rate}`, '#22d3ee'],
    ].map(([label, v, c]) => `<div class="stat-card" style="--c:${c}"><b ${typeof v === 'number' ? `data-count="${v}"` : ''}>${v}</b><span>${label}</span></div>`).join('');
    runCounters($('#trackerStats'));

    const now = Date.now() - 2 * 36e5;
    const upcoming = apps
      .map((a) => ({ a, d: parseDate(a.interviewAt) }))
      .filter((x) => x.d && x.d.getTime() >= now && x.a.status !== 'red')
      .sort((x, y) => x.d - y.d)
      .slice(0, 8);
    $('#upcoming').innerHTML = upcoming.length
      ? `<div class="up-title">${icon('calendar', 'ico-sm')}Yaklaşan mülakatlar</div><div class="up-list">${upcoming.map(({ a, d }) => `
          <div class="up-item" data-edit="${a.id}">
            <div class="up-date"><b>${d.getDate()}</b><small>${dateFmt.formatToParts(d).find((p) => p.type === 'month')?.value || ''}</small></div>
            <div><strong>${esc(a.position || a.company)}</strong><span>${esc(a.company)} · ${a.interviewAt.length > 10 ? timeFmt.format(d) : ''} · ${relative(d)}</span></div>
          </div>`).join('')}</div>`
      : '';

    const q = $('#boardSearch').value.trim().toLocaleLowerCase('tr-TR');
    const visible = q ? apps.filter((a) => `${a.company} ${a.position} ${a.location}`.toLocaleLowerCase('tr-TR').includes(q)) : apps;
    const board = $('#board');
    if (!apps.length) {
      board.innerHTML = `
        <div class="empty-board">
          <span class="f-ico">${icon('board', 'ico-lg')}</span>
          <h3>Henüz başvuru yok</h3>
          <p>Başvurularını ekle; durumlarını, mülakat tarihlerini ve notlarını tek yerden takip et. İlana özel CV veya iş eşleştirme sonuçlarından da tek tıkla ekleyebilirsin.</p>
          <button class="btn btn-primary" data-new-app>${icon('plus')}İlk başvurunu ekle</button>
        </div>`;
      return;
    }
    board.innerHTML = STATUSES.map((s) => {
      const items = visible.filter((a) => a.status === s.id);
      return `
        <div class="column" data-status="${s.id}">
          <div class="col-head" style="--c:${s.c}"><i></i>${s.label}<span>${items.length}</span></div>
          ${items.map((a, i) => appCard(a, i)).join('') || `<div class="col-empty">${finePointer ? 'Kartı buraya sürükle' : 'Boş'}</div>`}
        </div>`;
    }).join('');
    if (flashId) $(`.app-card[data-id="${flashId}"]`)?.classList.add('flash');
  }

  function appCard(a, i) {
    const applied = parseDate(a.appliedAt);
    const interview = parseDate(a.interviewAt);
    const name = a.company || a.position || '?';
    return `
      <article class="app-card" draggable="${finePointer}" data-id="${a.id}" style="--k:${i}" tabindex="0" aria-label="${esc(a.position)} - ${esc(a.company)}">
        <div class="ac-top">
          <span class="ac-logo" style="--h:${hueOf(name)}">${esc(name.trim().charAt(0).toLocaleUpperCase('tr-TR'))}</span>
          <div class="ac-title"><b>${esc(a.position || a.company)}</b><small>${esc(a.position ? a.company : '')}</small></div>
        </div>
        <div class="ac-meta">
          ${a.location ? `<span class="chip">${icon('pin')}${esc(a.location)}</span>` : ''}
          ${applied ? `<span class="chip">${icon('calendar')}${dateFmt.format(applied)}</span>` : ''}
          ${interview ? `<span class="chip chip-amber">${icon('clock')}${dateFmt.format(interview)}${a.interviewAt.length > 10 ? ` ${timeFmt.format(interview)}` : ''}</span>` : ''}
          ${a.matchScore != null ? `<span class="chip chip-green">%${a.matchScore}</span>` : ''}
        </div>
        <select class="select ac-status" data-status-select aria-label="Durumu değiştir">
          ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === a.status ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </article>`;
  }

  async function changeStatus(id, status) {
    const app = state.apps.find((a) => a.id === id);
    if (!app || app.status === status) return;
    const previous = app.status;
    app.status = status;
    renderTracker(id);
    try {
      Object.assign(app, await api(`/api/applications/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }));
      renderTracker(id);
      if (status === 'teklif') { confetti(); toast('Tebrikler! Teklif aldın 🎉'); }
      else toast(`"${statusLabel(status)}" olarak güncellendi`);
    } catch (err) {
      app.status = previous;
      renderTracker();
      toast(err.message, 'error');
    }
  }

  const board = $('#board');
  board.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-status-select]');
    if (sel) changeStatus(sel.closest('.app-card').dataset.id, sel.value);
  });
  board.addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
    const card = e.target.closest('.app-card');
    if (card) openAppSheet(state.apps.find((a) => a.id === card.dataset.id));
  });
  board.addEventListener('keydown', (e) => {
    const card = e.target.closest('.app-card');
    if (card && e.key === 'Enter' && e.target === card) openAppSheet(state.apps.find((a) => a.id === card.dataset.id));
  });
  $('#upcoming').addEventListener('click', (e) => {
    const item = e.target.closest('[data-edit]');
    if (item) openAppSheet(state.apps.find((a) => a.id === item.dataset.edit));
  });
  $('#boardSearch').addEventListener('input', () => renderTracker());

  // Masaüstünde sürükle-bırak
  let draggingId = null;
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.app-card');
    if (!card) return;
    draggingId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingId);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.app-card')?.classList.remove('dragging');
    $$('.column.drop-target', board).forEach((c) => c.classList.remove('drop-target'));
    draggingId = null;
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!col || !draggingId) return;
    e.preventDefault();
    $$('.column.drop-target', board).forEach((c) => c !== col && c.classList.remove('drop-target'));
    col.classList.add('drop-target');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.column');
    if (!col || !draggingId) return;
    e.preventDefault();
    col.classList.remove('drop-target');
    changeStatus(draggingId, col.dataset.status);
  });

  // Başvuru formu
  const appSheet = $('#appSheet');
  const appForm = $('#appForm');
  let editingId = null;
  function openAppSheet(app = null, preset = {}) {
    editingId = app?.id || null;
    $('#appSheetTitle').textContent = app ? 'Başvuruyu düzenle' : 'Yeni başvuru';
    const data = { status: 'basvuruldu', appliedAt: new Date().toISOString().slice(0, 10), ...preset, ...(app || {}) };
    for (const el of appForm.elements) {
      if (el.name) el.value = data[el.name] ?? '';
    }
    $('#deleteApp').classList.toggle('hidden', !app);
    $('#icsApp').classList.toggle('hidden', !app?.interviewAt);
    openSheet(appSheet);
  }
  appForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(appForm));
    if (!data.company.trim() && !data.position.trim()) {
      toast('Şirket veya pozisyon adı gir.', 'error');
      return $('#fCompany').focus();
    }
    if (data.matchScore === '') data.matchScore = null;
    const submit = $('button[type=submit]', appForm);
    submit.classList.add('is-loading');
    try {
      if (editingId) {
        const updated = await api(`/api/applications/${editingId}`, { method: 'PUT', body: JSON.stringify(data) });
        Object.assign(state.apps.find((a) => a.id === editingId), updated);
        toast('Başvuru güncellendi');
        if (updated.status === 'teklif') confetti();
        renderTracker(editingId);
      } else {
        const created = await api('/api/applications', { method: 'POST', body: JSON.stringify(data) });
        state.apps.unshift(created);
        toast('Başvuru eklendi');
        renderTracker(created.id);
      }
      closeSheet(appSheet);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      submit.classList.remove('is-loading');
    }
  });
  $('#deleteApp').addEventListener('click', async () => {
    if (!editingId || !confirm('Bu başvuru kalıcı olarak silinsin mi?')) return;
    try {
      await api(`/api/applications/${editingId}`, { method: 'DELETE' });
      state.apps = state.apps.filter((a) => a.id !== editingId);
      renderTracker();
      closeSheet(appSheet);
      toast('Başvuru silindi', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#icsApp').addEventListener('click', () => {
    const app = state.apps.find((a) => a.id === editingId);
    const d = parseDate(app?.interviewAt);
    if (!d) return;
    const pad = (n) => String(n).padStart(2, '0');
    const local = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    const icsEsc = (s) => String(s || '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CVPilot//TR', 'BEGIN:VEVENT',
      `UID:${app.id}@cvpilot`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${local(d)}`, 'DURATION:PT1H',
      `SUMMARY:${icsEsc(`Mülakat: ${app.position} - ${app.company}`)}`,
      `DESCRIPTION:${icsEsc([app.notes, app.url].filter(Boolean).join('\n'))}`,
      app.location ? `LOCATION:${icsEsc(app.location)}` : '',
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Mülakat hatırlatması', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })),
      download: 'mulakat.ics',
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  /* =========================================================
     5) İŞ EŞLEŞTİRME
     ========================================================= */
  const work = setupChoice($('#prefWork'), { multi: true, onChange: () => savePrefs() });
  const prefFields = { roles: '#prefRoles', location: '#prefLocation', seniority: '#prefSeniority', salary: '#prefSalary' };
  function savePrefs() {
    const prefs = Object.fromEntries(Object.entries(prefFields).map(([k, s]) => [k, $(s).value]));
    prefs.workType = work.value;
    store.set('prefs', prefs);
    return prefs;
  }
  Object.values(prefFields).forEach((s) => $(s).addEventListener('input', savePrefs));

  function renderJobList() {
    const list = $('#jobList');
    if (!state.matchJobs.length) state.matchJobs = [''];
    list.innerHTML = state.matchJobs.map((j, i) => `
      <div class="job-item">
        <span class="job-no">İlan ${i + 1}</span>
        <textarea class="textarea" data-job-index="${i}" rows="3" placeholder="İlan metnini yapıştır…" aria-label="İlan ${i + 1}">${esc(j)}</textarea>
        ${state.matchJobs.length > 1 ? `<button class="btn btn-ghost btn-icon remove" data-remove-job="${i}" aria-label="İlanı kaldır">${icon('x', 'ico-sm')}</button>` : ''}
      </div>`).join('');
    $('#addJobBtn').classList.toggle('hidden', state.matchJobs.length >= 8);
  }
  $('#jobList').addEventListener('input', (e) => {
    const ta = e.target.closest('[data-job-index]');
    if (!ta) return;
    state.matchJobs[Number(ta.dataset.jobIndex)] = ta.value;
    store.set('matchJobs', state.matchJobs);
  });
  $('#jobList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-job]');
    if (!rm) return;
    state.matchJobs.splice(Number(rm.dataset.removeJob), 1);
    store.set('matchJobs', state.matchJobs);
    renderJobList();
  });
  $('#addJobBtn').addEventListener('click', () => {
    state.matchJobs.push('');
    store.set('matchJobs', state.matchJobs);
    renderJobList();
    $$('#jobList textarea').pop()?.focus();
  });

  const VERDICT = {
    cok_uygun: ['Çok uygun', 'chip-green'],
    uygun: ['Uygun', 'chip-cyan'],
    kismen: ['Kısmen uygun', 'chip-amber'],
    uygun_degil: ['Uygun değil', 'chip-red'],
  };
  function searchLinks(query, location) {
    const q = encodeURIComponent(query);
    const l = encodeURIComponent(location || '');
    const slug = query.toLocaleLowerCase('tr-TR')
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return [
      ['LinkedIn', `https://www.linkedin.com/jobs/search/?keywords=${q}${l ? `&location=${l}` : ''}`],
      ['Kariyer.net', `https://www.kariyer.net/is-ilanlari/${slug}`],
      ['Indeed', `https://tr.indeed.com/jobs?q=${q}${l ? `&l=${l}` : ''}`],
    ].map(([name, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(name)}${icon('external')}</a>`).join('');
  }

  function renderMatch(m, jobsSent = state.matchSent || []) {
    const box = $('#matchResults');
    const C = 2 * Math.PI * 21;
    const prefs = store.get('prefs', {});
    const roles = (m.suggested_roles || []).map((r, i) => {
      const s = clampScore(r.fit_score);
      return `
        <div class="role-card" style="--k:${i}">
          <div class="role-top">
            <div class="mini-ring" style="--c:${scoreColor(s)}"><svg viewBox="0 0 50 50"><circle class="t" cx="25" cy="25" r="21"/><circle class="v" cx="25" cy="25" r="21" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-offset="${(C * (1 - s / 100)).toFixed(1)}"/></svg><b>${s}</b></div>
            <h4>${esc(r.title)}</h4>
          </div>
          <p>${esc(r.why)}</p>
          ${(r.keywords || []).length ? `<div class="chips">${r.keywords.map((k) => `<span class="chip chip-violet">${esc(k)}</span>`).join('')}</div>` : ''}
          <div class="search-links">${searchLinks(r.search_query || r.title, prefs.location)}</div>
        </div>`;
    }).join('');

    const jobs = [...(m.scored_jobs || [])].sort((a, b) => b.score - a.score).map((j, i) => {
      const s = clampScore(j.score);
      const [vLabel, vClass] = VERDICT[j.verdict] || ['', 'chip'];
      return `
        <div class="job-res" style="--k:${i}; --c:${scoreColor(s)}">
          <div class="score-big">%${s}</div>
          <div>
            <div class="jr-head"><h4>${esc(j.title || `İlan ${j.index}`)}</h4>${j.company ? `<span class="muted small">${esc(j.company)}</span>` : ''}<span class="chip ${vClass}">${vLabel}</span></div>
            <div class="jr-cols">
              <div class="ok"><small>Eşleşen yönler</small><ul>${(j.reasons || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
              ${(j.gaps || []).length ? `<div class="gap"><small>Eksikler</small><ul>${j.gaps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
            </div>
            <div class="actions">
              ${jobsSent[j.index - 1] ? `<button class="btn btn-soft btn-sm" data-tailor-job="${j.index - 1}">${icon('wand', 'ico-sm')}Bu ilana CV uyarla</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-track-job='${esc(JSON.stringify({ company: j.company, position: j.title, matchScore: s }))}'>${icon('board', 'ico-sm')}Takibe ekle</button>
            </div>
          </div>
        </div>`;
    }).join('');

    box.innerHTML = `
      ${m.profile_summary ? `<div class="card sec-card"><h3>${icon('user')}Profil özetin</h3><p class="muted">${esc(m.profile_summary)}</p></div>` : ''}
      <div class="res-head"><h2>Sana uygun pozisyonlar</h2><span class="chip chip-violet">${icon('sparkles', 'ico-sm')}Yapay zekâ önerisi</span></div>
      <div class="roles">${roles}</div>
      ${jobs ? `<div class="res-head"><h2>İlan uyum puanları</h2></div><div class="job-results">${jobs}</div>` : ''}`;
    stagger(box);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.mini-ring .v', box).forEach((c, i) => setTimeout(() => (c.style.strokeDashoffset = c.dataset.offset), 200 + i * 80));
    }));
  }

  $('#matchBtn').addEventListener('click', (e) => {
    if (!requireCv()) return;
    const prefs = savePrefs();
    const jobs = state.matchJobs.map((j) => j.trim()).filter((j) => j.length > 30);
    runJob({
      kind: 'match',
      btn: e.currentTarget,
      container: $('#matchResults'),
      url: '/api/match',
      body: { cvText: state.cv.text, preferences: prefs, jobs },
      expectedChars: 2500 + jobs.length * 900,
      render: (data) => {
        state.match = data;
        state.matchSent = jobs;
        store.set('match', { data, jobs });
        renderMatch(data, jobs);
      },
    });
  });

  $('#matchResults').addEventListener('click', (e) => {
    const tailor = e.target.closest('[data-tailor-job]');
    if (tailor) {
      state.job = state.matchSent[Number(tailor.dataset.tailorJob)] || '';
      store.set('job', state.job);
      syncJob();
      location.hash = 'uyarla';
      toast('İlan metni aktarıldı; şimdi CV\'ni uyarlayabilirsin', 'info');
      return;
    }
    const track = e.target.closest('[data-track-job]');
    if (track) {
      const d = JSON.parse(track.dataset.trackJob);
      addApplication({ ...d, position: d.position || 'Pozisyon', status: 'kaydedildi' });
    }
  });

  /* =========================================================
     Başlangıç
     ========================================================= */
  function restore() {
    syncJob();
    renderCv();
    renderJobList();
    const prefs = store.get('prefs');
    if (prefs) {
      Object.entries(prefFields).forEach(([k, s]) => ($(s).value = prefs[k] || ''));
      work.value = prefs.workType || [];
    }
    const lo = store.get('letterOpts');
    if (lo) {
      tone.value = lo.tone || 'otomatik';
      length.value = lo.length || 'orta';
      $('#letterLang').value = lo.lang || 'auto';
      $('#letterCompany').value = lo.company || '';
      $('#letterManager').value = lo.manager || '';
      $('#letterExtra').value = lo.extra || '';
    }
    if (state.analysis) renderAnalysis(state.analysis);
    if (state.optimized?.cv) renderOptimized(state.optimized);
    if (state.letter?.text) finalizeLetter(state.letter.text);
    if (state.match?.data) {
      state.matchSent = state.match.jobs || [];
      renderMatch(state.match.data, state.matchSent);
      state.match = state.match.data;
    }
  }

  restore();
  showTab(location.hash.slice(1) || 'analiz', { instant: true });
  loadStatus();
  if (currentTab !== 'takip') loadApps();
  document.fonts?.ready.then(moveIndicators);
})();
