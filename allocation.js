/* ═════════════════════════════════════════════════════════════════════
   ALLOCATION  —  who (CDM) handles which brand / platform / region
   Stored in Firestore: settings/roster → { rows: [{uid, brand, platform, region}], updatedAt, updatedBy }

   This is the single source of truth for:
     • the Allocation tab (admin / manager / team lead can see + edit)
     • New Campaign → "Brand Allocation" pre-fill (members + checklist entries)
   (Calendar visibility by region will read the same rows in a later step.)

   Loaded AFTER app.js — it uses app.js globals (db, members, tlMembers,
   currentUser, campaignRoster, escHtml, showToast, readSheetRows, XLSX…).
   ═════════════════════════════════════════════════════════════════════ */

const ALLOC_BASE_PLATFORMS = ['Lazada', 'Shopee', 'TikTok', 'Zalora', 'Amazon', 'Shopify', 'KSO'];
const ALLOC_REGIONS        = ['PH', 'MY', 'SG', 'TH', 'VN', 'ID'];
const ALLOC_MAX_RENDER     = 400;

let _allocMeta    = { updatedAt: null, updatedBy: null };
let _allocDrafts  = [];   // unsaved new rows shown at the top of the table
let _allocView    = [];   // rows currently rendered (index → row) for edit handlers
let _allocFilter  = { q: '', uid: '', region: '', platform: '' };
let _allocExtraPlatforms = new Set();
let _allocImport  = null; // parsed import awaiting confirmation

// ── Scope / helpers ───────────────────────────────────────────────────────
function _allocIsTl()    { return currentUser?.role === 'team_lead'; }
function _allocIsAdmin() { return currentUser?.role === 'admin'; }
function _allocHost()    { return document.getElementById(_allocIsTl() ? 'tl-allocation-host' : 'admin-allocation-host'); }

// Members that can be picked in dropdowns — exactly the Members-tab names.
// Admin: everyone. Manager: their scoped members. Team lead: their team + self.
function _allocPool() {
  let list;
  if (_allocIsTl()) {
    list = Object.values(tlMembers || {});
    if (currentUser && !list.some(m => m.uid === currentUser.uid)) {
      list.push({ uid: currentUser.uid, name: currentUser.name, username: currentUser.username, role: 'team_lead' });
    }
  } else {
    list = Object.values(members || {}).filter(m => m.role !== 'admin');
  }
  return list.slice().sort((a, b) =>
    (a.name || a.username || '').localeCompare(b.name || b.username || ''));
}
function _allocPoolUids() { return new Set(_allocPool().map(m => m.uid)); }
function _allocInScope(r) { return _allocIsAdmin() ? true : _allocPoolUids().has(r.uid); }
function _allocName(uid) {
  const m = (members && members[uid]) || (tlMembers && tlMembers[uid]) ||
            (currentUser && currentUser.uid === uid ? currentUser : null);
  return m ? (m.name || m.username || '') : '';
}
function _allocClean(r) {
  return {
    uid:      String(r.uid || '').trim(),
    brand:    String(r.brand || '').trim(),
    platform: String(r.platform || '').trim(),
    region:   String(r.region || '').trim().toUpperCase(),
  };
}
function _allocKey(r) {
  return [r.uid, r.brand, r.platform, r.region].map(s => String(s || '').trim().toLowerCase()).join('|');
}
function _allocPlatforms() {
  const set = new Set(ALLOC_BASE_PLATFORMS);
  (campaignRoster || []).forEach(r => { if (r.platform) set.add(r.platform); });
  _allocExtraPlatforms.forEach(p => set.add(p));
  // collapse case-variants ("lazada" vs "Lazada") — keep the first-seen spelling
  const seen = new Map();
  [...set].forEach(p => { if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p); });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
function _allocRegionList() {
  const set = new Set(ALLOC_REGIONS);
  (campaignRoster || []).forEach(r => { if (r.region) set.add(r.region); });
  return [...set];
}
function _allocBrands() {
  return [...new Set((campaignRoster || []).map(r => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ── Persistence (transactional so two people editing don't overwrite each other) ──
async function _allocReload() {
  const doc = await db.collection('settings').doc('roster').get();
  const d = doc.exists ? doc.data() : {};
  campaignRoster = (d.rows || []).map(_allocClean);
  _allocMeta = { updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || null };
}
async function _allocMutate(fn) {
  const ref = db.collection('settings').doc('roster');
  const by  = currentUser?.name || currentUser?.username || 'Admin';
  const at  = new Date().toISOString();
  const next = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const rows = snap.exists ? (snap.data().rows || []).map(_allocClean) : [];
    const out  = fn(rows);
    // final de-dupe
    const seen = new Set();
    const clean = out.map(_allocClean).filter(r => {
      if (!r.uid || !r.brand) return false;
      const k = _allocKey(r);
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    tx.set(ref, { rows: clean, updatedAt: at, updatedBy: by });
    return clean;
  });
  campaignRoster = next;
  _allocMeta = { updatedAt: at, updatedBy: by };
}

// ── Tab rendering ─────────────────────────────────────────────────────────
async function renderAllocationTab() {
  const host = _allocHost();
  if (!host) return;
  host.innerHTML = '<div style="padding:2rem;color:var(--text-muted);font-size:13px;">Loading allocation…</div>';
  try { await _allocReload(); }
  catch (e) {
    console.error('allocation load failed', e);
    host.innerHTML = '<div class="error-msg" style="display:block;">Could not load the allocation. Please refresh and try again.</div>';
    return;
  }
  _allocDrafts = [];
  _allocFilter = { q: '', uid: '', region: '', platform: '' };

  host.innerHTML = `
    <div class="data-card data-card-full" style="margin-bottom:24px;">
      <div class="data-card-header" style="flex-wrap:wrap;gap:8px;">
        <span class="data-card-icon">📇</span>
        <div style="flex:1;min-width:160px;">
          <div class="data-card-title">Brand Allocation</div>
          <div class="data-card-sub" id="alloc-meta">—</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button class="btn-primary" style="width:auto;font-size:12px;padding:6px 14px;" onclick="allocAddRow()">+ Add Row</button>
          <button class="btn-outline" style="font-size:12px;padding:6px 14px;" onclick="document.getElementById('alloc-file').click()">⬆ Import Excel</button>
          <button class="btn-outline" style="font-size:12px;padding:6px 14px;" onclick="allocExport()">⬇ Export</button>
          <input type="file" id="alloc-file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="allocHandleFile(event)" />
        </div>
      </div>
      <div class="alloc-filters">
        <input type="text" id="alloc-q" placeholder="Search member or brand…" oninput="allocSetFilter('q', this.value)" />
        <select id="alloc-f-uid" onchange="allocSetFilter('uid', this.value)"></select>
        <select id="alloc-f-region" onchange="allocSetFilter('region', this.value)"></select>
        <select id="alloc-f-platform" onchange="allocSetFilter('platform', this.value)"></select>
        <button class="btn-ghost-light" style="font-size:12px;padding:6px 12px;" onclick="allocClearFilters()">Clear</button>
      </div>
      <div id="alloc-stats" class="alloc-stats"></div>
      <div id="alloc-table-wrap" style="overflow-x:auto;"></div>
      <datalist id="alloc-brand-list"></datalist>
    </div>`;
  _allocRenderFilters();
  _allocRenderTable();
}

function _allocRenderFilters() {
  const pool = _allocPool();
  const uidSel = document.getElementById('alloc-f-uid');
  const regSel = document.getElementById('alloc-f-region');
  const platSel = document.getElementById('alloc-f-platform');
  if (!uidSel) return;
  uidSel.innerHTML  = '<option value="">All members</option>' +
    pool.map(m => `<option value="${m.uid}">${escHtml(m.name || m.username)}</option>`).join('');
  regSel.innerHTML  = '<option value="">All regions</option>' +
    _allocRegionList().map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
  platSel.innerHTML = '<option value="">All platforms</option>' +
    _allocPlatforms().map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
  uidSel.value = _allocFilter.uid; regSel.value = _allocFilter.region; platSel.value = _allocFilter.platform;
}

function allocSetFilter(field, val) { _allocFilter[field] = val; _allocRenderTable(); }
function allocClearFilters() {
  _allocFilter = { q: '', uid: '', region: '', platform: '' };
  const q = document.getElementById('alloc-q'); if (q) q.value = '';
  _allocRenderFilters();
  _allocRenderTable();
}

function _allocSelect(options, current, onchangeJs, opts = {}) {
  const has = options.some(o => o.value === current);
  let html = `<select onchange="${onchangeJs}" class="alloc-cell${opts.invalid ? ' alloc-invalid' : ''}">`;
  if (!current) html += '<option value="" selected disabled>— select —</option>';
  else if (!has) html += `<option value="${escHtml(current)}" selected>${escHtml(opts.unknownLabel || current)}</option>`;
  html += options.map(o => `<option value="${escHtml(o.value)}" ${o.value === current ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('');
  if (opts.allowNew) html += '<option value="__new__">➕ New…</option>';
  return html + '</select>';
}

function _allocRowHtml(r, kind, i) {
  const pool = _allocPool();
  const memberOpts = pool.map(m => ({ value: m.uid, label: m.name || m.username }));
  const unknown = r.uid && !pool.some(m => m.uid === r.uid);
  const platOpts   = _allocPlatforms().map(p => ({ value: p, label: p }));
  const regOpts    = _allocRegionList().map(x => ({ value: x, label: x }));
  const fn = f => `allocEdit('${kind}',${i},'${f}',this.value)`;
  return `<tr class="${kind === 'draft' ? 'alloc-draft' : ''}">
    <td>${_allocSelect(memberOpts, r.uid, fn('uid'), { invalid: unknown, unknownLabel: '⚠ Unknown member — reassign' })}</td>
    <td><input class="alloc-cell" list="alloc-brand-list" value="${escHtml(r.brand)}" placeholder="Brand" onchange="${fn('brand')}" /></td>
    <td>${_allocSelect(platOpts, r.platform, fn('platform'), { allowNew: true })}</td>
    <td>${_allocSelect(regOpts, r.region, fn('region'))}</td>
    <td style="text-align:right;white-space:nowrap;">
      ${kind === 'draft'
        ? `<span style="font-size:11px;color:var(--text-muted);margin-right:6px;">Fill all fields to save</span><button class="btn-ghost-light" style="padding:3px 9px;font-size:12px;" onclick="allocRemoveDraft(${i})">✕</button>`
        : `<button class="btn-ghost-light" style="padding:3px 9px;font-size:12px;color:#DC2626;border-color:#FCA5A5;" title="Delete this allocation" onclick="allocDelete(${i})">🗑</button>`}
    </td>
  </tr>`;
}

function _allocRenderTable() {
  const wrap = document.getElementById('alloc-table-wrap');
  if (!wrap) return;
  const scoped = (campaignRoster || []).filter(_allocInScope);
  const f = _allocFilter, q = f.q.trim().toLowerCase();
  const rows = scoped.filter(r =>
    (!f.uid || r.uid === f.uid) && (!f.region || r.region === f.region) &&
    (!f.platform || r.platform.toLowerCase() === f.platform.toLowerCase()) &&
    (!q || r.brand.toLowerCase().includes(q) || _allocName(r.uid).toLowerCase().includes(q))
  ).sort((a, b) =>
    (_allocName(a.uid) || '~').localeCompare(_allocName(b.uid) || '~') ||
    a.brand.localeCompare(b.brand) || a.platform.localeCompare(b.platform) || a.region.localeCompare(b.region));
  _allocView = rows.slice(0, ALLOC_MAX_RENDER);

  const dl = document.getElementById('alloc-brand-list');
  if (dl) dl.innerHTML = _allocBrands().map(b => `<option value="${escHtml(b)}"></option>`).join('');

  const cdms = new Set(scoped.map(r => r.uid)).size;
  const brands = new Set(scoped.map(r => r.brand.toLowerCase())).size;
  const stats = document.getElementById('alloc-stats');
  if (stats) stats.innerHTML = `<strong>${rows.length}</strong> of ${scoped.length} entries shown · ${cdms} CDM(s) · ${brands} brand(s)`;
  const meta = document.getElementById('alloc-meta');
  if (meta) {
    const when = _allocMeta.updatedAt ? new Date(_allocMeta.updatedAt).toLocaleString() : null;
    meta.textContent = when ? `Last updated ${when}${_allocMeta.updatedBy ? ' by ' + _allocMeta.updatedBy : ''}` :
      'Nothing saved yet — add rows or import your masterlist.';
  }

  if (scoped.length === 0 && _allocDrafts.length === 0) {
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:13px;">No allocation yet. Click <strong>Import Excel</strong> to load your masterlist (columns: username, brand, platform, region) or <strong>+ Add Row</strong>.</div>';
    return;
  }
  wrap.innerHTML = `<table class="alloc-table">
    <thead><tr><th>CDM</th><th>Brand</th><th>Platform</th><th>Region</th><th></th></tr></thead>
    <tbody>
      ${_allocDrafts.map((d, i) => _allocRowHtml(d, 'draft', i)).join('')}
      ${_allocView.map((r, i) => _allocRowHtml(r, 'row', i)).join('')}
    </tbody></table>
    ${rows.length > ALLOC_MAX_RENDER ? `<div style="padding:8px 14px;font-size:12px;color:var(--text-muted);">Showing the first ${ALLOC_MAX_RENDER} — use the filters to narrow down.</div>` : ''}`;
}

// ── Editing ───────────────────────────────────────────────────────────────
function allocAddRow() {
  _allocDrafts.unshift({ uid: _allocFilter.uid || '', brand: '', platform: _allocFilter.platform || '', region: _allocFilter.region || '' });
  _allocRenderTable();
}
function allocRemoveDraft(i) { _allocDrafts.splice(i, 1); _allocRenderTable(); }

async function allocEdit(kind, i, field, val) {
  val = String(val || '').trim();
  if (field === 'platform' && val === '__new__') {
    const name = (prompt('New platform name:') || '').trim();
    if (!name) { _allocRenderTable(); return; }
    _allocExtraPlatforms.add(name);
    val = name;
    _allocRenderFilters();
  }
  if (field === 'region') val = val.toUpperCase();

  try {
    if (kind === 'draft') {
      const d = _allocDrafts[i]; if (!d) return;
      d[field] = val;
      if (!(d.uid && d.brand && d.platform && d.region)) { if (field === 'platform') _allocRenderTable(); return; }
      let dup = false;
      await _allocMutate(rows => {
        if (rows.some(r => _allocKey(r) === _allocKey(d))) { dup = true; return rows; }
        return [...rows, { ...d }];
      });
      _allocDrafts.splice(i, 1);
      showToast(dup ? 'That allocation already exists.' : '✅ Allocation added.', dup ? 'warn' : 'success');
      _allocRenderFilters(); _allocRenderTable();
      return;
    }

    const old = _allocView[i]; if (!old) return;
    const next = { ...old, [field]: val };
    if (!next.brand) { showToast('Brand cannot be empty.', 'warn'); _allocRenderTable(); return; }
    if (_allocKey(old) === _allocKey(next)) return;
    let merged = false;
    await _allocMutate(rows => {
      const ok = _allocKey(old), nk = _allocKey(next);
      const out = rows.filter(r => _allocKey(r) !== ok);
      if (out.some(r => _allocKey(r) === nk)) merged = true; else out.push(next);
      return out;
    });
    showToast(merged ? 'Already allocated that way — duplicate removed.' : '✅ Saved.', merged ? 'warn' : 'success');
    _allocRenderFilters(); _allocRenderTable();
  } catch (e) {
    console.error('allocation save failed', e);
    showToast('Failed to save. Reloading latest…', 'error');
    try { await _allocReload(); } catch (_) {}
    _allocRenderTable();
  }
}

async function allocDelete(i) {
  const r = _allocView[i]; if (!r) return;
  if (!confirm(`Remove ${r.brand} · ${r.platform} · ${r.region} from ${_allocName(r.uid) || 'this member'}?`)) return;
  try {
    await _allocMutate(rows => rows.filter(x => _allocKey(x) !== _allocKey(r)));
    showToast('🗑 Removed.', 'success');
    _allocRenderFilters(); _allocRenderTable();
  } catch (e) { console.error(e); showToast('Failed to delete.', 'error'); }
}

// ── Export ────────────────────────────────────────────────────────────────
function allocExport() {
  const rows = (campaignRoster || []).filter(_allocInScope)
    .slice().sort((a, b) => (_allocName(a.uid)).localeCompare(_allocName(b.uid)) || a.brand.localeCompare(b.brand));
  const aoa = [['username', 'brand', 'platform', 'region'],
    ...rows.map(r => [_allocName(r.uid) || '(unknown member)', r.brand, r.platform, r.region])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 30 }, { wch: 28 }, { wch: 12 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Allocation');
  XLSX.writeFile(wb, `Allocation_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Import (with preview before anything is saved) ────────────────────────
function _allocNorm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function _allocParse(rows) {
  const res = { rows: [], unmatched: new Set(), badRegions: new Set(), newPlatforms: new Set(), incomplete: 0, dupes: 0, error: null };
  if (!rows || rows.length < 2) { res.error = 'File appears empty.'; return res; }
  const hIdx = _findHeaderRowIndex(rows, [['username', 'name'], ['brand'], ['platform'], ['region']]);
  if (hIdx < 0) { res.error = 'File must have the columns: username, brand, platform, region.'; return res; }
  const h = rows[hIdx].map(x => String(x).toLowerCase().trim());
  const uI = h.indexOf('username') >= 0 ? h.indexOf('username') : h.indexOf('name');
  const bI = h.indexOf('brand'), pI = h.indexOf('platform'), rI = h.indexOf('region');

  // Exact-name matching (case/spacing-insensitive) against the Members-tab names, then usernames.
  const byName = new Map(), byUser = new Map();
  _allocPool().forEach(m => {
    if (m.name) byName.set(_allocNorm(m.name), m.uid);
    if (m.username) byUser.set(_allocNorm(m.username), m.uid);
  });
  const platCanon = new Map(_allocPlatforms().map(p => [p.toLowerCase(), p]));
  const seen = new Set();

  rows.slice(hIdx + 1).forEach(r => {
    const who = String(r[uI] || '').trim(), brand = String(r[bI] || '').trim();
    const platRaw = String(r[pI] || '').trim(), regRaw = String(r[rI] || '').trim();
    if (!who && !brand && !platRaw && !regRaw) return;
    if (!who || !brand || !platRaw || !regRaw) { res.incomplete++; return; }
    const uid = byName.get(_allocNorm(who)) || byUser.get(_allocNorm(who));
    if (!uid) { res.unmatched.add(who); return; }
    const region = _normalizeRegionCode(regRaw);
    if (!region) { res.badRegions.add(regRaw); return; }
    let platform = platCanon.get(platRaw.toLowerCase());
    if (!platform) { platform = platRaw; res.newPlatforms.add(platRaw); }
    const row = { uid, brand, platform, region };
    const k = _allocKey(row);
    if (seen.has(k)) { res.dupes++; return; }
    seen.add(k); res.rows.push(row);
  });
  return res;
}

function allocHandleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  readSheetRows(file, (rows, err) => {
    e.target.value = '';
    if (err) { showToast(err, 'error'); return; }
    const parsed = _allocParse(rows);
    if (parsed.error) { showToast(parsed.error, 'error'); return; }
    _allocImport = parsed;
    _allocOpenImportModal(file.name);
  });
}

function _allocEnsureImportModal() {
  if (document.getElementById('allocation-import-overlay')) return;
  const el = document.createElement('div');
  el.id = 'allocation-import-overlay';
  el.style.display = 'none';
  el.onclick = e => { if (e.target === el) allocCloseImport(); };
  el.innerHTML = `<div class="modal" style="max-width:620px;">
    <div class="modal-header"><h3>⬆ Import Allocation</h3><button class="btn-ghost-light" onclick="allocCloseImport()">✕</button></div>
    <div id="alloc-import-body"></div>
    <div class="modal-actions">
      <button class="btn-ghost-light" onclick="allocCloseImport()">Cancel</button>
      <button class="btn-primary" id="alloc-import-apply" style="width:auto;" onclick="allocApplyImport()">Apply import</button>
    </div></div>`;
  document.body.appendChild(el);
}
function allocCloseImport() { const el = document.getElementById('allocation-import-overlay'); if (el) el.style.display = 'none'; _allocImport = null; }

function _allocImportMode() {
  const r = document.querySelector('input[name="alloc-imp-mode"]:checked');
  return r ? r.value : 'replace';
}

function _allocOpenImportModal(fileName) {
  _allocEnsureImportModal();
  const hasExisting = (campaignRoster || []).some(_allocInScope);
  _allocImport.fileName = fileName;
  _allocImport.defaultMode = hasExisting ? 'merge' : 'replace';
  document.getElementById('allocation-import-overlay').style.display = 'flex';
  _allocRenderImportPreview(_allocImport.defaultMode);
}

function _allocImportDiff(mode) {
  const cur = (campaignRoster || []).filter(_allocInScope);
  const curKeys = new Set(cur.map(_allocKey));
  const impKeys = new Set(_allocImport.rows.map(_allocKey));
  const added = _allocImport.rows.filter(r => !curKeys.has(_allocKey(r)));
  const removed = mode === 'replace' ? cur.filter(r => !impKeys.has(_allocKey(r))) : [];
  const unchanged = _allocImport.rows.length - added.length;
  return { added, removed, unchanged };
}

function _allocRenderImportPreview(mode) {
  const imp = _allocImport; if (!imp) return;
  const d = _allocImportDiff(mode);
  const warn = (title, items) => items.length ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:8px;font-size:12px;color:#DC2626;"><strong>${title}</strong> ${items.map(escHtml).join(', ')}</div>` : '';
  const lbl = r => `${_allocName(r.uid) || '?'} — ${r.brand} · ${r.platform} · ${r.region}`;
  const list = (title, arr) => arr.length ? `<details style="margin-top:6px;font-size:12px;"><summary style="cursor:pointer;">${title} (${arr.length})</summary><div style="max-height:140px;overflow:auto;padding:4px 0 0 14px;color:var(--text-muted);">${arr.slice(0, 200).map(r => escHtml(lbl(r))).join('<br>')}${arr.length > 200 ? '<br>…' : ''}</div></details>` : '';
  document.getElementById('alloc-import-body').innerHTML = `
    <div style="font-size:13px;margin-bottom:10px;"><strong>${escHtml(imp.fileName)}</strong> — ${imp.rows.length} valid row(s) found.</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;font-size:13px;">
      <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;"><input type="radio" name="alloc-imp-mode" value="merge" ${mode === 'merge' ? 'checked' : ''} onchange="_allocRenderImportPreview('merge')" /> <span><strong>Add new rows only</strong> — keep everything already in the allocation.</span></label>
      <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;"><input type="radio" name="alloc-imp-mode" value="replace" ${mode === 'replace' ? 'checked' : ''} onchange="_allocRenderImportPreview('replace')" /> <span><strong>Replace everything${_allocIsAdmin() ? '' : ' in my scope'}</strong> — rows not in the file are removed.</span></label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px;">
      <span style="background:#ECFDF5;color:#047857;padding:4px 10px;border-radius:6px;">+ ${d.added.length} to add</span>
      <span style="background:#FEF2F2;color:#B91C1C;padding:4px 10px;border-radius:6px;">− ${d.removed.length} to remove</span>
      <span style="background:var(--surface2);padding:4px 10px;border-radius:6px;">${d.unchanged} unchanged</span>
    </div>
    ${list('Show rows to add', d.added)}${list('Show rows to remove', d.removed)}
    ${warn('Names not found in the Members tab (skipped):', [...imp.unmatched])}
    ${warn('Unknown region (skipped):', [...imp.badRegions])}
    ${imp.incomplete ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">${imp.incomplete} row(s) skipped — missing a username, brand, platform, or region.</div>` : ''}
    ${imp.dupes ? `<div style="margin-top:4px;font-size:12px;color:var(--text-muted);">${imp.dupes} duplicate row(s) in the file were ignored.</div>` : ''}
    ${imp.newPlatforms.size ? `<div style="margin-top:4px;font-size:12px;color:var(--text-muted);">New platform(s) will be added to the dropdown: ${[...imp.newPlatforms].map(escHtml).join(', ')}</div>` : ''}`;
  document.getElementById('alloc-import-apply').disabled = (d.added.length + d.removed.length) === 0;
}

async function allocApplyImport() {
  const imp = _allocImport; if (!imp) return;
  const mode = _allocImportMode();
  const btn = document.getElementById('alloc-import-apply');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const poolUids = _allocPoolUids(), isAdmin = _allocIsAdmin();
    const inScope = r => isAdmin || poolUids.has(r.uid);
    await _allocMutate(rows => {
      const base = mode === 'replace' ? rows.filter(r => !inScope(r)) : rows;
      return [...base, ...imp.rows];
    });
    imp.newPlatforms.forEach(p => _allocExtraPlatforms.add(p));
    allocCloseImport();
    showToast('✅ Allocation updated.', 'success');
    _allocRenderFilters(); _allocRenderTable();
  } catch (e) {
    console.error('allocation import failed', e);
    showToast('Import failed. Nothing was changed.', 'error');
  } finally { btn.textContent = 'Apply import'; btn.disabled = false; }
}

// ═════════════════════════════════════════════════════════════════════
//  New Campaign → pre-fill from allocation
// ═════════════════════════════════════════════════════════════════════

// { uid: [{label, brand, platform, region}] } for the chosen regions/platforms.
// Empty platform list = all platforms. Only members visible to the current user.
function allocationForScope(regions, platforms) {
  const regs = new Set((regions || []).map(r => String(r).toUpperCase()));
  const plats = new Set((platforms || []).map(p => String(p).toLowerCase()));
  const out = {};
  (campaignRoster || []).forEach(r => {
    if (!members[r.uid]) return;
    if (regs.size && !regs.has(r.region)) return;
    if (plats.size && !plats.has(r.platform.toLowerCase())) return;
    if (!out[r.uid]) out[r.uid] = [];
    out[r.uid].push({ label: [r.brand, r.platform, r.region].filter(Boolean).join('_'), brand: r.brand, platform: r.platform, region: r.region });
  });
  return out;
}

let _allocCamp = { regions: new Set(), platforms: new Set(), autoUids: new Set() };

function allocInitCampaignPanel() {
  _allocCamp = { regions: new Set(), platforms: new Set(), autoUids: new Set() };
  const host = document.getElementById('alloc-camp-panel');
  if (!host) return;
  host.innerHTML = `<label>📇 Allocation source</label>
    <div class="field-help">Trackory automatically matches the Region × Platform rows loaded from Calendar to the Brand Allocation tab. No region/platform selection is needed here.</div>
    <div id="alloc-camp-summary" style="margin-top:8px;"></div>`;
  allocCampRecomputeFromSchedule();
}

// New Campaign normal path: Calendar determines the active Region × Platform
// scope, then Allocation determines the members + brand checklist entries.
// This removes the old second set of region/platform selectors.
function allocCampRecomputeFromSchedule() {
  const rows = ((_rmState && _rmState['new-campaign']) || [])
    .filter(r => r.region && (r.teasing || r.teasingNA || r.dday || r.deadline));
  const scoped = {};
  const seen = new Set();
  rows.forEach(row => {
    (campaignRoster || []).forEach(r => {
      if (!members[r.uid] || r.region !== row.region) return;
      if (row.platform && String(r.platform).toLowerCase() !== String(row.platform).toLowerCase()) return;
      const key = [r.uid,r.brand,r.platform,r.region].join('|').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      if (!scoped[r.uid]) scoped[r.uid] = [];
      scoped[r.uid].push({ label:[r.brand,r.platform,r.region].filter(Boolean).join('_'), brand:r.brand, platform:r.platform, region:r.region });
    });
  });

  // Clear only members previously selected automatically; preserve deliberate
  // manual selections in Advanced Overrides.
  _allocCamp.autoUids.forEach(uid => {
    const c = document.querySelector(`#member-assign-list .member-chip[data-uid="${uid}"]`);
    if (c) c.classList.remove('selected');
  });
  _allocCamp.autoUids = new Set();
  newCampBulkMatched = scoped;
  Object.keys(scoped).forEach(uid => {
    const c = document.querySelector(`#member-assign-list .member-chip[data-uid="${uid}"]`);
    if (c) { c.classList.add('selected'); _allocCamp.autoUids.add(uid); }
  });

  const sum = document.getElementById('alloc-camp-summary');
  if (sum) {
    if (!rows.length) sum.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Choose a month + phase above to determine the campaign scope.</div>';
    else if (!Object.keys(scoped).length) sum.innerHTML = '<div style="font-size:12px;color:#B45309;">⚠ Calendar dates were found, but no matching Brand Allocation rows exist.</div>';
    else renderBrandAssignmentPreview(sum, scoped, [], true);
  }
  if (typeof updateNewCampaignReadySummary === 'function') updateNewCampaignReadySummary();
}

// Kept for compatibility with any older inline handlers/bookmarks.
function allocCampToggle() { allocCampRecomputeFromSchedule(); }
function allocCampRecompute() { allocCampRecomputeFromSchedule(); }

