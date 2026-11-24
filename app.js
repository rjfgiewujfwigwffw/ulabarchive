'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/\btesto(?:steron(?:e)?)?\b/g, 'test').replace(/[^a-z0-9]+/g, '');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = d => { if (!d) return 'Undated'; const [y, m, day] = d.split('-'); return `${+day} ${MONTHS[+m - 1].slice(0, 3)} ${y}`; };
  const monthKey = d => d ? d.slice(0, 7) : 'undated';
  const monthLabel = k => k === 'undated' ? 'Undated' : `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  const plural = (n, w) => `${n.toLocaleString('en')} ${w}${n === 1 ? '' : 's'}`;
  const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4f46e5', '#ca8a04',
    '#059669', '#7c3aed', '#ea580c', '#0284c7', '#be123c', '#16a34a', '#a21caf', '#475569', '#b45309', '#94a3b8'];
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } }, del: k => { try { localStorage.removeItem(k); } catch { } } };

  let DATA, TESTS = [], BY_ID = new Map(), BATCH_COUNT = new Map(), CLASS_COLOR = {};
  const DEFAULT = { q: '', labs: [], classes: [], years: [], from: '', to: '', batch: false, warn: false, multi: false, topics: true, sort: 'new', view: 'tests' };
  let S = { ...DEFAULT }, route = { test: null }, current = [], renderLimit = 0, labsExpanded = false, labQuery = '';

  /* ---------- URL state ---------- */
  function toQuery(s) {
    const p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.labs.length) p.set('lab', s.labs.join('|'));
    if (s.classes.length) p.set('c', s.classes.join('|'));
    if (s.years.length) p.set('y', s.years.join('|'));
    if (s.from) p.set('from', s.from);
    if (s.to) p.set('to', s.to);
    if (s.batch) p.set('batch', '1');
    if (s.warn) p.set('warn', '1');
    if (s.multi) p.set('multi', '1');
    if (!s.topics) p.set('topics', '0');
    if (s.sort !== 'new') p.set('sort', s.sort);
    if (s.view !== 'tests') p.set('view', s.view);
    const q = p.toString().replace(/%7C/g, '|');
    return q ? '?' + q : '';
  }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const i = h.indexOf('?'), path = i < 0 ? h : h.slice(0, i);
    const p = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
    const list = k => (p.get(k) || '').split('|').filter(Boolean);
    S = {
      ...DEFAULT, q: p.get('q') || '', labs: list('lab'), classes: list('c'), years: list('y'), from: p.get('from') || '', to: p.get('to') || '',
      batch: p.get('batch') === '1', warn: p.get('warn') === '1', multi: p.get('multi') === '1', topics: p.get('topics') !== '0',
      sort: p.get('sort') || 'new', view: p.get('view') || 'tests',
    };
    const m = path.match(/^t\/(\d+)/);
    route = { test: m ? m[1] : null };
  }
  const listHash = () => '#/' + toQuery(S);
  function commit() {                       // filters changed: update URL without a history entry
    history.replaceState(null, '', route.test ? `#/t/${route.test}${toQuery(S)}` : listHash());
    renderList();
  }

  /* ---------- Filtering ---------- */
  function matchQuery(t, q) {
    if (!q) return true;
    const whole = norm(q);
    if (!whole) return true;
    if (t._hay.includes(whole)) return true;
    return queryTokens(q).every(tok => t._hay.includes(tok));
  }
  // Single-letter ester codes join the previous word: "testo e driada" -> ["teste", "driada"].
  function queryTokens(q) {
    if (queryTokens.q === q) return queryTokens.r;
    const out = [];
    for (const tok of q.split(/[\s,;]+/).map(norm).filter(Boolean)) {
      if (tok.length === 1 && /[a-z]/.test(tok) && out.length) out[out.length - 1] += tok; else out.push(tok);
    }
    queryTokens.q = q; queryTokens.r = out;
    return out;
  }
  function passes(t, s, skip) {
    if (!s.topics && t.topic && skip !== 'topics' && !s.labs.includes(t.lab)) return false;
    if (skip !== 'labs' && s.labs.length && !s.labs.includes(t.lab)) return false;
    if (skip !== 'classes' && s.classes.length && !t.classes.some(c => s.classes.includes(c))) return false;
    if (skip !== 'years' && s.years.length && !s.years.includes(t.date ? t.date.slice(0, 4) : 'undated')) return false;
    if (s.from && (!t.date || t.date < s.from)) return false;
    if (s.to && (!t.date || t.date > s.to)) return false;
    if (s.batch && !t.batches.length) return false;
    if (s.warn && !t.warning) return false;
    if (s.multi && !t.batches.some(b => BATCH_COUNT.get(b.toUpperCase()) > 1)) return false;
    return matchQuery(t, s.q);
  }
  const filtered = skip => TESTS.filter(t => passes(t, S, skip));
  function sortTests(list) {
    const by = {
      new: (a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id,
      old: (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id - b.id,
      lab: (a, b) => a.lab.localeCompare(b.lab, 'en', { sensitivity: 'base' }) || (b.date || '').localeCompare(a.date || ''),
      photos: (a, b) => b.photos.length - a.photos.length || (b.date || '').localeCompare(a.date || ''),
    }[S.sort] || ((a, b) => 0);
    return list.slice().sort(by);
  }
  const count = (list, key) => list.reduce((m, t) => { for (const k of [].concat(key(t))) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

  /* ---------- Facets ---------- */
  function toggle(arr, v) { const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); }
  function renderFacets() {
    const cCount = count(filtered('classes'), t => t.classes);
    $('#f-classes').innerHTML = DATA.classes.filter(c => cCount.get(c) || S.classes.includes(c) || TESTS.some(t => t.classes.includes(c)))
      .map(c => `<button class="chip${cCount.get(c) ? '' : ' zero'}" data-class="${esc(c)}" aria-pressed="${S.classes.includes(c)}">${esc(c)} <span class="n">${cCount.get(c) || 0}</span></button>`).join('');

    const yCount = count(filtered('years'), t => t.date ? t.date.slice(0, 4) : 'undated');
    const years = [...new Set(TESTS.map(t => t.date ? t.date.slice(0, 4) : 'undated'))].sort().reverse();
    $('#f-years').innerHTML = years.map(y => `<button class="chip${yCount.get(y) ? '' : ' zero'}" data-year="${y}" aria-pressed="${S.years.includes(y)}">${y === 'undated' ? 'Undated' : y} <span class="n">${yCount.get(y) || 0}</span></button>`).join('');

    const lCount = count(filtered('labs'), t => t.lab);
    const allLabs = [...new Set(TESTS.map(t => t.lab))];
    const lq = norm(labQuery);
    let labs = allLabs.filter(l => !lq || norm(l).includes(lq))
      .sort((a, b) => (S.labs.includes(b) - S.labs.includes(a)) || ((lCount.get(b) || 0) - (lCount.get(a) || 0)) || a.localeCompare(b));
    const total = labs.length, LIMIT = 14;
    if (!labsExpanded && !lq) labs = labs.slice(0, Math.max(LIMIT, S.labs.length));
    $('#f-labs').innerHTML = labs.map(l => `<label class="${lCount.get(l) ? '' : 'zero'}"><input type="checkbox" data-lab="${esc(l)}" ${S.labs.includes(l) ? 'checked' : ''}><span title="${esc(l)}">${esc(l)}</span><span class="n">${lCount.get(l) || 0}</span></label>`).join('')
      || '<p class="muted" style="margin:4px 6px;font-size:13px">No match</p>';
    $('#labs-more').textContent = lq ? '' : labsExpanded ? 'Show fewer' : total > labs.length ? `Show all ${total}` : '';
    $('#lab-count').textContent = `(${allLabs.length})`;

    $('#from').value = S.from; $('#to').value = S.to;
    $('#o-batch').checked = S.batch; $('#o-warn').checked = S.warn; $('#o-multi').checked = S.multi; $('#o-topics').checked = S.topics;
    $('#sort').value = S.sort;
    $$('.views button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === S.view));
    if (document.activeElement !== $('#q')) $('#q').value = S.q;

    const pills = [];
    if (S.q) pills.push(['q', null, `Search: ${S.q}`]);
    S.labs.forEach(l => pills.push(['labs', l, l]));
    S.classes.forEach(c => pills.push(['classes', c, c]));
    S.years.forEach(y => pills.push(['years', y, y === 'undated' ? 'Undated' : y]));
    if (S.from) pills.push(['from', null, `From ${fmtDate(S.from)}`]);
    if (S.to) pills.push(['to', null, `To ${fmtDate(S.to)}`]);
    if (S.batch) pills.push(['batch', null, 'Has batch no.']);
    if (S.warn) pills.push(['warn', null, 'Warning in title']);
    if (S.multi) pills.push(['multi', null, 'Batch tested more than once']);
    if (!S.topics) pills.push(['topics', null, 'Boards hidden']);
    $('#pills').innerHTML = pills.map(([k, v, label]) => `<button class="pill" data-pill="${k}" data-v="${esc(v ?? '')}">${esc(label)}<span aria-hidden="true">×</span></button>`).join('')
      + (pills.length > 1 ? '<button class="link-btn" data-pill="all">Clear all</button>' : '');
    $('#filter-badge').textContent = pills.length || '';
  }

  /* ---------- Results ---------- */
  const photoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-8 7"/></svg>';
  function card(t) {
    const p = t.photos[0];
    return `<a class="card" href="#/t/${t.id}${toQuery(S)}" data-id="${t.id}">
      <div class="thumb"><img data-src="${p.t}" alt="" decoding="async">
        <span class="count">${photoIcon}${t.photos.length}</span>${t.warning ? '<span class="flag">Warning</span>' : ''}</div>
      <div class="card-body">
        <span class="card-date">${fmtDate(t.date)}</span>
        <span class="card-title">${esc(t.compound || t.title)}</span>
        <span class="card-lab">${esc(t.lab)}</span>
        ${t.batches.length ? `<div class="batches">${t.batches.slice(0, 3).map(b => `<span class="batch" title="Batch ${esc(b)}">${esc(b)}</span>`).join('')}${t.batches.length > 3 ? `<span class="batch">+${t.batches.length - 3}</span>` : ''}</div>` : ''}
      </div></a>`;
  }
  function renderList() {
    renderFacets();
    current = sortTests(filtered());
    const labsN = new Set(current.map(t => t.lab)).size;
    const photos = current.reduce((n, t) => n + t.photos.length, 0);
    $('#summary').innerHTML = S.view === 'labs'
      ? `<b>${plural(labsN, 'lab')}</b>, ${plural(current.length, 'test')}`
      : `<b>${plural(current.length, 'test')}</b>, ${plural(labsN, 'lab')}, ${plural(photos, 'photo')}`;
    $('.sort').style.visibility = S.view === 'labs' ? 'hidden' : '';
    renderLimit = 0;
    $('#results').innerHTML = '';
    if (!current.length) {
      $('#results').innerHTML = `<div class="empty"><h2>Nothing found</h2><button class="btn" data-pill="all">Clear filters</button></div>`;
      return;
    }
    if (S.view === 'labs') return renderLabs();
    more();
  }
  function more() {
    if (S.view !== 'tests' || renderLimit >= current.length) return;
    const start = renderLimit, end = Math.min(current.length, start + 72);
    const group = S.sort === 'new' || S.sort === 'old' ? t => monthKey(t.date) : S.sort === 'lab' ? t => t.lab : null;
    const label = S.sort === 'lab' ? k => k : monthLabel;
    let html = '', grid = $('#results .grid:last-child');
    const sizes = group ? count(current, group) : null;
    for (let i = start; i < end; i++) {
      const t = current[i];
      if (group && (i === 0 || group(current[i - 1]) !== group(t))) {
        if (html) { grid ? grid.insertAdjacentHTML('beforeend', html) : null; html = ''; }
        const k = group(t);
        $('#results').insertAdjacentHTML('beforeend', `<h2 class="group-head">${esc(label(k))} <span class="n">${plural(sizes.get(k), 'test')}</span></h2><div class="grid"></div>`);
        grid = $('#results .grid:last-child');
      }
      if (!grid) { $('#results').insertAdjacentHTML('beforeend', '<div class="grid"></div>'); grid = $('#results .grid:last-child'); }
      html += card(t);
    }
    grid.insertAdjacentHTML('beforeend', html);
    renderLimit = end;
  }
  function renderLabs() {
    const groups = new Map();
    for (const t of current) { if (!groups.has(t.lab)) groups.set(t.lab, []); groups.get(t.lab).push(t); }
    const labs = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    $('#results').innerHTML = `<div class="labs-grid">${labs.map(([lab, ts]) => {
      ts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const imgs = ts.slice(0, 4).map(t => `<img data-src="${t.photos[0].t}" alt="">`).join('');
      const cls = [...count(ts, t => t.classes).entries()].sort((a, b) => b[1] - a[1]);
      const total = cls.reduce((n, [, v]) => n + v, 0);
      const latest = ts.find(t => t.date);
      return `<button class="lab-card" data-open-lab="${esc(lab)}">
        <div class="lab-top"><div class="lab-mosaic${ts.length < 2 ? ' one' : ''}">${imgs}</div>
          <div style="min-width:0">${ts[0].topic ? '<div class="lab-topic">Board</div>' : ''}<div class="lab-name">${esc(lab)}</div>
          <div class="lab-meta">${plural(ts.length, 'test')}${latest ? `, last ${fmtDate(latest.date)}` : ''}</div></div></div>
        <div class="bar">${cls.map(([c, n]) => `<i style="width:${n / total * 100}%;background:${CLASS_COLOR[c]}" title="${esc(c)}: ${n}"></i>`).join('')}</div>
        <div class="lab-classes">${cls.slice(0, 4).map(([c, n]) => `<span style="--c:${CLASS_COLOR[c]}">${esc(c)} ${n}</span>`).join('')}</div>
      </button>`;
    }).join('')}</div>`;
  }

  /* ---------- Detail ---------- */
  let lastFocus = null;
  function openDetail(id) {
    const t = BY_ID.get(id);
    const el = $('#detail');
    if (!t) { el.hidden = true; document.body.classList.remove('locked'); return; }
    if (el.hidden) lastFocus = document.activeElement;
    const list = current.length ? current : sortTests(TESTS);
    const idx = list.indexOf(t), prev = list[idx - 1], next = list[idx + 1];
    const sameBatch = t.batches.length ? TESTS.filter(o => o !== t && o.batches.some(b => t.batches.some(x => x.toUpperCase() === b.toUpperCase())))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')) : [];
    const sameLab = TESTS.filter(o => o !== t && o.lab === t.lab && !sameBatch.includes(o)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6);
    const labCount = TESTS.filter(o => o.lab === t.lab).length;
    const mini = o => `<a href="#/t/${o.id}${toQuery(S)}"><img data-src="${o.photos[0].t}" alt=""><span><b>${esc(o.compound || o.title)}</b><small>${esc(o.lab)}, ${fmtDate(o.date)}</small></span></a>`;
    el.innerHTML = `<div class="detail-panel">
      <div class="d-head">
        <button class="icon-btn" data-close aria-label="Back to results">←</button>
        <span class="d-crumb">${esc(t.lab)} / ${esc(t.compound || t.title)}</span><span class="spacer"></span>
        ${idx >= 0 ? `<span class="muted" style="font-size:13px;white-space:nowrap">${idx + 1} / ${list.length}</span>` : ''}
        <button class="icon-btn" data-go="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'} aria-label="Previous test" title="Previous test">‹</button>
        <button class="icon-btn" data-go="${next ? next.id : ''}" ${next ? '' : 'disabled'} aria-label="Next test" title="Next test">›</button>
      </div>
      <div class="d-body">
        <div class="d-photos">${t.photos.map((p, i) => `<button class="d-photo" data-photo="${i}" aria-label="Open photo ${i + 1}"><img data-src="${p.f}" width="${p.w}" height="${p.h}" alt="Photo ${i + 1} of ${esc(t.title)}" decoding="async"></button>`).join('')}</div>
        <aside class="d-side">
          <div>
            <a class="d-lab" href="#/?lab=${encodeURIComponent(t.lab)}" data-lab-link="${esc(t.lab)}">${esc(t.lab)}</a>
            <h1 id="d-title">${esc(t.compound || t.title)}</h1>
          </div>
          <dl class="meta">
            <dt>Test date</dt><dd>${fmtDate(t.date)}</dd>
            <dt>Batch</dt><dd>${t.batches.length ? `<div class="batches" style="margin:0">${t.batches.map(b => `<button class="batch" data-batch="${esc(b)}" title="Search this batch">${esc(b)}${BATCH_COUNT.get(b.toUpperCase()) > 1 ? ` ×${BATCH_COUNT.get(b.toUpperCase())}` : ''}</button>`).join('')}</div>` : '<span class="muted">Not given</span>'}</dd>
            <dt>Compound</dt><dd><div class="tags">${t.classes.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></dd>
            <dt>Photos</dt><dd>${t.photos.length}</dd>
            <dt>Title</dt><dd>${esc(t.title)}${t.warning ? ' <span class="tag" style="background:var(--warn-soft);color:var(--warn)">Warning</span>' : ''}</dd>
          </dl>
          ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
          <div class="actions">
            <button class="btn" data-copy>Copy link</button>
            <a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Forum thread</a>
          </div>
          ${sameBatch.length ? `<section class="d-section"><h2>Same batch (${sameBatch.length})</h2><div class="mini-list">${sameBatch.slice(0, 8).map(mini).join('')}</div></section>` : ''}
          ${sameLab.length ? `<section class="d-section"><h2>Other ${esc(t.lab)} tests</h2><div class="mini-list">${sameLab.map(mini).join('')}</div>
            <button class="link-btn" data-lab-link="${esc(t.lab)}">Show all ${labCount}</button></section>` : ''}
        </aside>
      </div></div>`;
    el.hidden = false; el.scrollTop = 0;
    document.body.classList.add('locked');
    document.title = `${t.compound || t.title}, ${t.lab} | ${DATA.title}`;
    $('[data-close]', el).focus({ preventScroll: true });
    detailTest = t;
  }
  let detailTest = null;
  function closeDetail() {
    if (history.state && history.state.fromList) history.back();
    else { route.test = null; history.replaceState(null, '', listHash()); syncRoute(); }
  }
  function goTest(id, push = true) {
    if (push) history.pushState({ fromList: !route.test || (history.state && history.state.fromList) }, '', `#/t/${id}${toQuery(S)}`);
    else history.replaceState(history.state, '', `#/t/${id}${toQuery(S)}`);
    route.test = id; syncRoute();
  }
  function syncRoute() {
    if (route.test) openDetail(route.test);
    else {
      $('#detail').hidden = true; document.body.classList.remove('locked'); detailTest = null;
      document.title = DATA.title;
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    }
  }

  /* ---------- Images (plain or encrypted) ---------- */
  let KEY = null;                                  // AES-GCM CryptoKey when the site is encrypted
  const blobCache = new Map(), fullOrder = [];
  async function decryptFetch(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, KEY, buf.slice(12));
  }
  function imageURL(path) {
    if (!KEY) return Promise.resolve(path);
    if (blobCache.has(path)) return blobCache.get(path);
    const pr = decryptFetch(path).then(b => URL.createObjectURL(new Blob([b], { type: 'image/webp' })));
    blobCache.set(path, pr);
    if (!/_t\b|thumb/.test(path) && LARGE.has(path)) {       // keep at most 40 full-size photos in memory
      fullOrder.push(path);
      while (fullOrder.length > 40) { const old = fullOrder.shift(); const o = blobCache.get(old); blobCache.delete(old); o.then(URL.revokeObjectURL).catch(() => {}); }
    }
    pr.catch(() => blobCache.delete(path));
    return pr;
  }
  const LARGE = new Set();
  const imgIO = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const img = e.target; imgIO.unobserve(img);
      imageURL(img.dataset.src).then(u => { if (img.dataset.src) img.src = u; }).catch(() => img.classList.add('broken'));
    }
  }, { rootMargin: '800px' });
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      for (const img of n.matches('img[data-src]') ? [n] : n.querySelectorAll('img[data-src]')) imgIO.observe(img);
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ---------- Lightbox ---------- */
  const LB = { photos: [], i: 0, zoom: false };
  const lb = $('#lightbox'), stage = $('.lb-stage'), lbImg = $('#lb-img');
  function openLightbox(photos, i) { LB.photos = photos; lb.hidden = false; showPhoto(i); }
  function showPhoto(i) {
    LB.i = (i + LB.photos.length) % LB.photos.length; setZoom(false);
    const p = LB.photos[LB.i];
    const want = p.f; lbImg.removeAttribute('src'); $('#lb-open').removeAttribute('href');
    imageURL(p.f).then(u => { if (LB.photos[LB.i] && LB.photos[LB.i].f === want) { lbImg.src = u; $('#lb-open').href = u; } }).catch(() => {});
    $('#lb-count').textContent = `${LB.i + 1} / ${LB.photos.length}`;
    $$('.lb-nav').forEach(b => b.hidden = LB.photos.length < 2);
    const n = LB.photos[(LB.i + 1) % LB.photos.length]; if (n) imageURL(n.f).catch(() => {});
  }
  function setZoom(on, ev) {
    LB.zoom = on; stage.classList.toggle('zoomed', on); stage.style.overflow = on ? 'auto' : 'hidden';
    if (on && ev) {
      const r = lbImg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
      requestAnimationFrame(() => { stage.scrollLeft = fx * lbImg.naturalWidth - stage.clientWidth / 2; stage.scrollTop = fy * lbImg.naturalHeight - stage.clientHeight / 2; });
    }
  }
  const closeLightbox = () => { lb.hidden = true; lbImg.removeAttribute('src'); };
  let drag = null;
  stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop, moved: false }; });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (LB.zoom && drag.moved) { stage.classList.add('dragging'); stage.scrollLeft = drag.sl - dx; stage.scrollTop = drag.st - dy; }
  });
  stage.addEventListener('pointerup', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x; stage.classList.remove('dragging');
    if (!drag.moved) { if (e.target === lbImg) setZoom(!LB.zoom, e); else if (!LB.zoom) closeLightbox(); }
    else if (!LB.zoom && Math.abs(dx) > 50 && e.pointerType !== 'mouse') showPhoto(LB.i + (dx < 0 ? 1 : -1));
    drag = null;
  });
  stage.addEventListener('pointercancel', () => { drag = null; stage.classList.remove('dragging'); });
  $('.lb-prev').onclick = () => showPhoto(LB.i - 1);
  $('.lb-next').onclick = () => showPhoto(LB.i + 1);
  $('.lb-close').onclick = closeLightbox;

  /* ---------- Events ---------- */
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1800); }
  function setFilters(patch, view) {
    Object.assign(S, patch); if (view) S.view = view;
    if (route.test) { route.test = null; history.replaceState(null, '', listHash()); syncRoute(); }
    commit(); window.scrollTo({ top: 0 });
  }
  let qTimer;
  $('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value.trim(); commit(); }, 110); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(qTimer); S.q = e.target.value.trim(); commit(); e.target.blur(); } });
  $('#lab-search').addEventListener('input', e => { labQuery = e.target.value; renderFacets(); });
  $('#labs-more').onclick = () => { labsExpanded = !labsExpanded; renderFacets(); };
  $('#sort').onchange = e => { S.sort = e.target.value; commit(); };
  $('#from').onchange = e => { S.from = e.target.value; commit(); };
  $('#to').onchange = e => { S.to = e.target.value; commit(); };
  for (const [id, k] of [['o-batch', 'batch'], ['o-warn', 'warn'], ['o-multi', 'multi'], ['o-topics', 'topics']]) $('#' + id).onchange = e => { S[k] = e.target.checked; commit(); };
  $('#reset').onclick = () => { labQuery = ''; $('#lab-search').value = ''; setFilters({ ...DEFAULT, view: S.view, sort: S.sort }); };
  $$('.views button').forEach(b => b.onclick = () => { S.view = b.dataset.view; commit(); });
  $('#theme').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', document.documentElement.dataset.theme);
  };
  const filtersEl = $('#filters'), scrim = $('#scrim');
  const drawer = open => { filtersEl.classList.toggle('open', open); scrim.classList.toggle('show', open); };
  $('#open-filters').onclick = () => drawer(true);
  $('#close-filters').onclick = scrim.onclick = () => drawer(false);

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-class],[data-year],[data-pill],[data-open-lab],[data-batch],[data-lab-link],[data-go],[data-close],[data-photo],[data-copy],.card,.mini-list a');
    if (!el) return;
    if (el.matches('.card, .mini-list a')) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault(); goTest(el.dataset.id || el.getAttribute('href').match(/t\/(\d+)/)[1], !route.test); return;
    }
    if (el.dataset.class !== undefined) { toggle(S.classes, el.dataset.class); commit(); }
    else if (el.dataset.year !== undefined) { toggle(S.years, el.dataset.year); commit(); }
    else if (el.dataset.openLab !== undefined) setFilters({ labs: [el.dataset.openLab] }, 'tests');
    else if (el.dataset.labLink !== undefined) { e.preventDefault(); setFilters({ ...DEFAULT, labs: [el.dataset.labLink] }, 'tests'); }
    else if (el.dataset.batch !== undefined) setFilters({ ...DEFAULT, q: el.dataset.batch }, 'tests');
    else if (el.dataset.go !== undefined) { if (el.dataset.go) goTest(el.dataset.go, false); }
    else if (el.dataset.close !== undefined) closeDetail();
    else if (el.dataset.photo !== undefined) openLightbox(detailTest.photos, +el.dataset.photo);
    else if (el.dataset.copy !== undefined) {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', url));
    } else if (el.dataset.pill !== undefined) {
      const k = el.dataset.pill, v = el.dataset.v;
      if (k === 'all') { setFilters({ ...DEFAULT, view: S.view, sort: S.sort }); return; }
      if (Array.isArray(S[k])) toggle(S[k], v); else S[k] = DEFAULT[k];
      commit();
    }
  });
  $('#f-labs').addEventListener('change', e => { const l = e.target.dataset.lab; if (l !== undefined) { toggle(S.labs, l); commit(); } });
  $('#detail').addEventListener('click', e => { if (e.target.id === 'detail') closeDetail(); });

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (!lb.hidden) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showPhoto(LB.i - 1);
      else if (e.key === 'ArrowRight') showPhoto(LB.i + 1);
      return;
    }
    if (route.test && !typing) {
      if (e.key === 'Escape') return closeDetail();
      const go = e.key === 'ArrowLeft' || e.key === 'k' ? '[data-go]:nth-of-type(1)' : e.key === 'ArrowRight' || e.key === 'j' ? null : undefined;
      if (go !== undefined) {
        const btns = $$('#detail [data-go]'), b = btns[go ? 0 : 1];
        if (b && b.dataset.go) { e.preventDefault(); goTest(b.dataset.go, false); }
      }
      return;
    }
    if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    else if (e.key === 'Escape' && document.activeElement === $('#q')) { $('#q').blur(); }
    else if (e.key === 'Escape') drawer(false);
  });
  window.addEventListener('hashchange', () => { parseHash(); renderList(); syncRoute(); });
  new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: '1200px' }).observe($('#sentinel'));

  /* ---------- Boot ---------- */
  function start(d) {
    DATA = d; TESTS = d.tests;
    if (KEY) for (const t of TESTS) for (const p of t.photos) LARGE.add(p.f);
    document.title = d.title; $('.brand span').textContent = d.title;
    d.classes.forEach((c, i) => CLASS_COLOR[c] = PALETTE[i % PALETTE.length]);
    for (const t of TESTS) {
      BY_ID.set(t.id, t);
      for (const b of t.batches) BATCH_COUNT.set(b.toUpperCase(), (BATCH_COUNT.get(b.toUpperCase()) || 0) + 1);
      t._hay = [t.lab, t.title, t.compound, t.batches.join(' '), t.classes.join(' '), t.note, t.date, fmtDate(t.date)].map(norm).join('|');
    }
    parseHash(); renderList(); syncRoute();
  }
  const loadError = err => { $('#results').innerHTML = `<div class="empty"><h2>Could not load the data</h2><p>${esc(err.message)}</p></div>`; };
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function unlock(lock, rawKey) {
    KEY = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await decryptFetch(lock.data);       // throws if the key is wrong
    const json = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    return json;
  }
  async function deriveKey(password, lock) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(lock.salt), iterations: lock.iterations }, base, 512);
    return bits.slice(0, 32);
  }
  async function bootLocked() {
    const lock = await fetch(window.LOCK_URL, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const slot = 'key:' + lock.salt;
    const saved = store.get(slot) || sessionGet(slot);
    if (saved) {
      try { return start(await unlock(lock, b64(saved))); } catch { store.del(slot); sessionDel(slot); KEY = null; }
    }
    const box = $('#lock'), form = $('#lock-form'), msg = $('#lock-msg'), input = $('#lock-pw');
    $('#results').innerHTML = ''; box.hidden = false; input.focus();
    form.onsubmit = async e => {
      e.preventDefault();
      const pw = input.value.trim(); if (!pw) return;
      form.classList.add('busy'); msg.textContent = 'Checking';
      try {
        const raw = await deriveKey(pw, lock);
        const d = await unlock(lock, raw);
        (($('#lock-remember').checked) ? store.set : sessionSet)(slot, toB64(raw));
        box.hidden = true; start(d);
      } catch (err) {
        KEY = null; msg.textContent = err instanceof DOMException && err.name === 'OperationError' ? 'Wrong password' : `Error: ${err.message}`;
        input.select();
      } finally { form.classList.remove('busy'); }
    };
  }
  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch { } }
  function sessionDel(k) { try { sessionStorage.removeItem(k); } catch { } }

  if (window.LOCK_URL) {
    $('#logout').hidden = false;
    $('#logout').onclick = () => {
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('key:')) localStorage.removeItem(k); } catch { }
      try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('key:')) sessionStorage.removeItem(k); } catch { }
      location.replace(location.pathname);
    };
  }
  $('#results').innerHTML = '<div class="loading">Loading</div>';
  if (window.LOCK_URL) bootLocked().catch(loadError);
  else fetch(window.DATA_URL).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(start).catch(loadError);
})();
