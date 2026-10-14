// CVPilot — Tanıtım sayfası etkileşimleri ve animasyonları
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Nav durumu + kaydırma ilerlemesi + adım çizgisi ---------- */
  const nav = $('#nav');
  const progress = $('.scroll-progress');
  const steps = $('#steps');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      const max = document.documentElement.scrollHeight - innerHeight;
      nav.classList.toggle('scrolled', y > 12);
      progress.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
      if (steps) {
        const r = steps.getBoundingClientRect();
        const ratio = (innerHeight * 0.6 - r.top) / r.height;
        steps.style.setProperty('--progress', Math.max(0, Math.min(1, ratio)).toFixed(3));
      }
      ticking = false;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ---------- Aktif menü bağlantısı ---------- */
  const links = $$('.nav-links a');
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  $$('section[id]').forEach((s) => sectionObserver.observe(s));

  /* ---------- Mobil menü ---------- */
  const menuBtn = $('#menuBtn');
  const mobileMenu = $('#mobileMenu');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
    mobileMenu.setAttribute('aria-hidden', String(!open));
  };
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('a', mobileMenu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));
  matchMedia('(min-width: 961px)').addEventListener('change', (e) => e.matches && setMenu(false));

  /* ---------- Kaydırınca beliren öğeler ---------- */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        revealObserver.unobserve(e.target);
        if (e.target.matches('.hero-stats')) runCounters(e.target);
        if (e.target.matches('#compare')) hintCompare();
      }
    },
    { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
  );
  $$('.reveal').forEach((el) => revealObserver.observe(el));

  /* ---------- Sayaçlar ---------- */
  const easeOut = (t) => 1 - Math.pow(1 - t, 4);
  function animateNumber(el, to, { from = 0, duration = 1600, prefix = '', suffix = '' } = {}) {
    if (reduceMotion) { el.textContent = `${prefix}${to}${suffix}`; return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = `${prefix}${Math.round(from + (to - from) * easeOut(t))}${suffix}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function runCounters(root) {
    $$('[data-count]', root).forEach((el, i) => {
      setTimeout(() => animateNumber(el, Number(el.dataset.count), {
        prefix: el.dataset.prefix || '',
        suffix: el.dataset.suffix || '',
      }), i * 120);
    });
  }

  /* ---------- Yazılıp silinen başlık kelimeleri ---------- */
  const rotator = $('.rotator');
  if (rotator) {
    let words = [];
    try { words = JSON.parse(rotator.dataset.words); } catch { words = [rotator.textContent]; }
    let w = 0;
    let c = words[0].length;
    let deleting = true;
    const step = () => {
      const word = words[w];
      if (deleting) {
        c--;
        if (c <= 0) { deleting = false; w = (w + 1) % words.length; }
      } else {
        c++;
        if (c >= words[w].length) { deleting = true; rotator.textContent = words[w]; return setTimeout(step, 2200); }
      }
      rotator.textContent = (deleting ? word : words[w]).slice(0, Math.max(0, c)) || '​';
      setTimeout(step, deleting ? 38 : 70);
    };
    if (!reduceMotion) setTimeout(step, 2600);
  }

  /* ---------- Hero ATS puanı (tarama ışınıyla senkron) ---------- */
  const ring = $('#heroRing');
  const scoreEl = $('#heroScore');
  if (ring && scoreEl) {
    const C = 2 * Math.PI * 50;
    const setScore = (s) => {
      scoreEl.textContent = Math.round(s);
      ring.style.strokeDashoffset = (C * (1 - s / 100)).toFixed(1);
    };
    setScore(41);
    const cycle = () => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 2600);
        setScore(41 + (92 - 41) * easeOut(t));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => setScore(41), 4800);
    };
    if (reduceMotion) setScore(92);
    else { setTimeout(() => { cycle(); setInterval(cycle, 5000); }, 1000); }
  }

  /* ---------- 3B eğim (hero CV kartı) ---------- */
  const tilt = $('.tilt');
  if (tilt && finePointer && !reduceMotion) {
    const visual = tilt.parentElement;
    visual.addEventListener('pointermove', (e) => {
      const r = visual.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 12}deg) translateZ(0)`;
      $$('.float-card', visual).forEach((card, i) => {
        card.style.translate = `${x * (14 + i * 6)}px ${y * (14 + i * 6)}px`;
      });
    });
    visual.addEventListener('pointerleave', () => {
      tilt.style.transform = '';
      $$('.float-card', visual).forEach((card) => (card.style.translate = ''));
    });
  }

  /* ---------- İmleç ışığı ve mıknatıslı butonlar ---------- */
  if (finePointer) {
    $$('.spotlight').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
    if (!reduceMotion) {
      $$('.magnetic').forEach((btn) => {
        btn.addEventListener('pointermove', (e) => {
          const r = btn.getBoundingClientRect();
          const x = e.clientX - r.left - r.width / 2;
          const y = e.clientY - r.top - r.height / 2;
          btn.style.translate = `${x * 0.18}px ${y * 0.28}px`;
        });
        btn.addEventListener('pointerleave', () => (btn.style.translate = ''));
      });
    }
  }

  /* ---------- Önce / sonra kaydırıcısı ---------- */
  const compare = $('#compare');
  const range = compare && $('.cmp-range', compare);
  const setPos = (v) => compare.style.setProperty('--pos', `${v}%`);
  range?.addEventListener('input', () => setPos(range.value));
  let hinted = false;
  function hintCompare() {
    if (hinted || reduceMotion) return;
    hinted = true;
    const frames = [50, 22, 78, 50];
    let i = 0;
    const start = performance.now();
    const seg = 700;
    const tick = (now) => {
      const t = (now - start) / seg;
      i = Math.floor(t);
      if (i >= frames.length - 1) { setPos(50); range.value = 50; return; }
      const local = easeOut(t - i);
      const v = frames[i] + (frames[i + 1] - frames[i]) * local;
      setPos(v);
      range.value = v;
      requestAnimationFrame(tick);
    };
    setTimeout(() => requestAnimationFrame(tick), 500);
  }

  /* ---------- Fiyat dönemi ---------- */
  const toggle = $('.billing-toggle');
  if (toggle) {
    const pill = $('.toggle-pill', toggle);
    const buttons = $$('button', toggle);
    const place = (btn) => {
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    };
    buttons.forEach((btn) =>
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
        place(btn);
        const mode = btn.dataset.billing;
        $$('.price b').forEach((b) => {
          b.classList.remove('flip');
          void b.offsetWidth; // animasyonu yeniden başlat
          b.classList.add('flip');
          setTimeout(() => (b.textContent = b.dataset[mode]), 200);
        });
      }),
    );
    const init = () => place($('button.active', toggle));
    init();
    addEventListener('resize', init, { passive: true });
    document.fonts?.ready.then(init);
  }

  /* ---------- SSS akordeon (yumuşak açılıp kapanma) ---------- */
  $$('.faq-item').forEach((item) => {
    const summary = $('summary', item);
    const body = $('.faq-body', item);
    summary.addEventListener('click', (e) => {
      e.preventDefault();
      if (reduceMotion) { item.open = !item.open; return; }
      if (item.open) {
        item.classList.add('anim-closing');
        const done = () => { item.open = false; item.classList.remove('anim-closing'); };
        body.addEventListener('transitionend', done, { once: true });
        setTimeout(() => item.classList.contains('anim-closing') && done(), 600);
      } else {
        item.classList.add('anim-opening');
        item.open = true;
        requestAnimationFrame(() => requestAnimationFrame(() => item.classList.remove('anim-opening')));
      }
    });
  });
})();
