// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let currentUser       = null;   // { uid, username, name, role }
let campaigns         = {};     // { id: { name, assignedUids, createdAt } }
let members           = {};     // { uid: { username, name, role } }
let userChecklist     = {};     // { campaignId: { entries: [...], d5: {}, d1: {}, lastActive } }
let selectedCampaignId = null;

const db = firebase.firestore();

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_UID      = 'admin';

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
async function handleLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!username || !password) { showError(errEl, 'Please enter your username and password.'); return; }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  try {
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      currentUser = { uid: ADMIN_UID, username: ADMIN_USERNAME, name: 'Admin', role: 'admin' };
      sessionStorage.setItem('mcSession', JSON.stringify(currentUser));
      await loadAdminData();
      showScreen('admin-screen');
      return;
    }

    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    if (snap.empty) { showError(errEl, 'Username not found.'); return; }

    const doc  = snap.docs[0];
    const data = doc.data();
    if (data.password !== password) { showError(errEl, 'Incorrect password.'); return; }

    currentUser = { uid: doc.id, username: data.username, name: data.name, role: 'member' };
    sessionStorage.setItem('mcSession', JSON.stringify(currentUser));
    await loadMemberData(doc.id);
    document.getElementById('user-name-display').textContent = data.name || data.username;
    showScreen('user-screen');

  } catch (e) {
    showError(errEl, 'Sign in failed. Please try again.'); console.error(e);
  } finally {
    btn.textContent = 'Sign in'; btn.disabled = false;
  }
}

function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('mcSession');
  showScreen('login-screen');
}

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  const saved = sessionStorage.getItem('mcSession');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      if (currentUser.role === 'admin') {
        await loadAdminData(); showScreen('admin-screen');
      } else {
        await loadMemberData(currentUser.uid);
        document.getElementById('user-name-display').textContent = currentUser.name || currentUser.username;
        showScreen('user-screen');
      }
    } catch (e) { sessionStorage.removeItem('mcSession'); showScreen('login-screen'); }
  } else { showScreen('login-screen'); }
});

// ─────────────────────────────────────────────────────────────
//  DATA LOADING
// ─────────────────────────────────────────────────────────────
async function loadAdminData() {
  const usersSnap = await db.collection('users').get();
  members = {};
  usersSnap.forEach(doc => { members[doc.id] = { ...doc.data(), uid: doc.id }; });

  const campsSnap = await db.collection('campaigns').orderBy('createdAt', 'desc').get();
  campaigns = {};
  campsSnap.forEach(doc => { campaigns[doc.id] = { ...doc.data(), id: doc.id }; });

  populateAdminCampaignFilter();
  renderAdminView();
}

async function loadMemberData(uid) {
  const campsSnap = await db.collection('campaigns')
    .where('assignedUids', 'array-contains', uid)
    .orderBy('createdAt', 'desc')
    .get();
  campaigns = {};
  campsSnap.forEach(doc => { campaigns[doc.id] = { ...doc.data(), id: doc.id }; });

  const checkSnap = await db.collection('checklists').doc(uid).get();
  userChecklist = checkSnap.exists ? checkSnap.data() : {};

  populateUserCampaignSelect();
}

// ─────────────────────────────────────────────────────────────
//  ADMIN VIEW
// ─────────────────────────────────────────────────────────────
function populateAdminCampaignFilter() {
  const sel = document.getElementById('admin-campaign-filter');
  sel.innerHTML = '<option value="">All campaigns</option>';
  Object.values(campaigns).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

async function renderAdminView() {
  const filterCampaign = document.getElementById('admin-campaign-filter').value;

  const checkSnap = await db.collection('checklists').get();
  const allChecklists = {};
  checkSnap.forEach(doc => { allChecklists[doc.id] = doc.data(); });

  let rows = [];
  const campaignList = filterCampaign
    ? [campaigns[filterCampaign]].filter(Boolean)
    : Object.values(campaigns);

  campaignList.forEach(camp => {
    (camp.assignedUids || []).forEach(uid => {
      const member = members[uid];
      if (!member) return;
      const cl     = (allChecklists[uid] || {})[camp.id] || {};
      const d5Done = countDone(cl.d5 || {});
      const d1Done = countDone(cl.d1 || {});
      const overallDone = Math.round(((d5Done + d1Done) / (TOTAL_ITEMS * 2)) * 100);
      rows.push({ member, camp, d5Done, d1Done, overallDone, lastActive: cl.lastActive || null });
    });
  });

  const total      = rows.length;
  const complete   = rows.filter(r => r.overallDone === 100).length;
  const inProgress = rows.filter(r => r.overallDone > 0 && r.overallDone < 100).length;
  const notStarted = rows.filter(r => r.overallDone === 0).length;

  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card"><div class="label">Total assignments</div><div class="value blue">${total}</div></div>
    <div class="stat-card"><div class="label">Fully complete</div><div class="value green">${complete}</div></div>
    <div class="stat-card"><div class="label">In progress</div><div class="value amber">${inProgress}</div></div>
    <div class="stat-card"><div class="label">Not started</div><div class="value red">${notStarted}</div></div>
  `;

  const tbody = document.getElementById('admin-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No assignments yet. Create a campaign and assign members.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const d5Pct  = Math.round((r.d5Done / TOTAL_ITEMS) * 100);
    const d1Pct  = Math.round((r.d1Done / TOTAL_ITEMS) * 100);
    const badge  = r.overallDone === 100 ? 'badge-done">Complete'
                 : r.overallDone === 0   ? 'badge-pending">Not started'
                 :                         'badge-partial">In progress';
    const lastStr = r.lastActive
      ? new Date(r.lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '—';
    return `<tr>
      <td><strong>${r.member.name || r.member.username}</strong><br><span style="font-size:11px;color:var(--text-muted)">@${r.member.username}</span></td>
      <td>${r.camp.name}</td>
      <td>${miniBar(d5Pct)} ${r.d5Done}/${TOTAL_ITEMS}</td>
      <td>${miniBar(d1Pct)} ${r.d1Done}/${TOTAL_ITEMS}</td>
      <td><span class="badge ${badge}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${lastStr}</td>
      <td><button class="btn-link" onclick="openReviewModal('${r.member.uid}','${r.camp.id}')">Review</button></td>
    </tr>`;
  }).join('');
}

function miniBar(pct) {
  const cls = pct === 100 ? '' : pct >= 50 ? ' warn' : ' danger';
  return `<div class="mini-bar"><div class="mini-track"><div class="mini-fill${cls}" style="width:${pct}%"></div></div><span class="mini-pct">${pct}%</span></div>`;
}

function countDone(obj) {
  return Object.values(obj).filter(v => v && (v.status === 'done' || v.status === 'na')).length;
}

// ─────────────────────────────────────────────────────────────
//  ADMIN REVIEW MODAL — full table view of member's checklist
// ─────────────────────────────────────────────────────────────
async function openReviewModal(uid, campId) {
  const member = members[uid];
  const camp   = campaigns[campId];
  document.getElementById('review-member-name').textContent    = member.name || member.username;
  document.getElementById('review-campaign-name').textContent  = camp.name;

  const checkSnap = await db.collection('checklists').doc(uid).get();
  const cl = checkSnap.exists ? (checkSnap.data()[campId] || {}) : {};
  const d5Data = cl.d5 || {};
  const d1Data = cl.d1 || {};

  // Determine entries (brand/platform/region combos) stored per campaign
  const entries = cl.entries || [{ brand: '', platform: '', region: '' }];

  // Build the same combined table the member sees, but read-only
  let html = `<div class="review-table-wrap"><table class="review-table">`;

  // ── Build dynamic column count based on entries ──
  // Each entry has: D-5 Status | D-5 Notes | D-1 Status | D-1 Notes
  const entryCount = entries.length;

  // thead row 1: freeze cols + one group header per entry
  html += `<thead><tr>
    <th class="freeze" rowspan="2" style="min-width:220px">Item</th>
    <th class="freeze2" rowspan="2" style="min-width:220px">Guide question</th>`;
  entries.forEach((e, i) => {
    const label = [e.brand, e.platform, e.region].filter(Boolean).join(' · ') || `Entry ${i + 1}`;
    html += `<th colspan="4" style="text-align:center">${label}</th>`;
  });
  html += `</tr><tr>`;
  entries.forEach(() => {
    html += `<th class="sub">D-5 Status</th><th class="sub">D-5 Notes</th><th class="sub">D-1 Status</th><th class="sub">D-1 Notes</th>`;
  });
  html += `</tr></thead><tbody>`;

  // ── Body rows ──
  CHECKLIST_SECTIONS.forEach(sec => {
    // Category header spanning all cols
    const totalCols = 2 + entryCount * 4;
    html += `<tr class="rv-cat">
      <td class="freeze" colspan="1">${sec.title}</td>
      <td class="freeze2"></td>
      ${Array(entryCount * 4).fill('<td></td>').join('')}
    </tr>`;

    sec.items.forEach(item => {
      html += `<tr>
        <td class="freeze" style="white-space:normal;line-height:1.4">${item.name}</td>
        <td class="freeze2" style="white-space:normal;line-height:1.4;color:var(--text-muted);font-size:12px">${item.guide}</td>`;

      entries.forEach((_, i) => {
        // For multi-entry items we key by itemId_entryIndex
        const d5key = i === 0 ? item.id : `${item.id}_e${i}`;
        const d1key = i === 0 ? item.id : `${item.id}_e${i}`;
        const d5 = d5Data[d5key] || {};
        const d1 = d1Data[d1key] || {};
        html += `<td>${statusBadge(d5.status)}</td>
                 <td style="color:var(--text-muted);font-size:12px;font-style:italic">${d5.note || ''}</td>
                 <td>${statusBadge(d1.status)}</td>
                 <td style="color:var(--text-muted);font-size:12px;font-style:italic">${d1.note || ''}</td>`;
      });

      html += `</tr>`;
    });
  });

  html += `</tbody></table></div>`;
  document.getElementById('review-content').innerHTML = html;
  document.getElementById('review-overlay').style.display = 'flex';
}

function statusBadge(status) {
  if (!status) return `<span class="rv-blank">—</span>`;
  const map = {
    done:       ['rv-done',     'Done'],
    'in-progress': ['rv-progress', 'In Progress'],
    pending:    ['rv-pending',  'Pending'],
    na:         ['rv-na',       'N/A'],
  };
  const [cls, label] = map[status] || ['rv-blank', status];
  return `<span class="rv-status ${cls}">${label}</span>`;
}

function closeReviewModal(e) {
  if (e && e.target !== document.getElementById('review-overlay')) return;
  document.getElementById('review-overlay').style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
//  MEMBER MANAGEMENT
// ─────────────────────────────────────────────────────────────
function openMemberModal() {
  renderMemberList();
  document.getElementById('new-member-username').value = '';
  document.getElementById('new-member-name').value     = '';
  document.getElementById('new-member-password').value = '';
  document.getElementById('member-modal-error').style.display = 'none';
  document.getElementById('member-modal-overlay').style.display = 'flex';
}

function closeMemberModal(e) {
  if (e && e.target !== document.getElementById('member-modal-overlay')) return;
  document.getElementById('member-modal-overlay').style.display = 'none';
}

function renderMemberList() {
  const list      = document.getElementById('existing-members-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  if (nonAdmins.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 10px">No members yet.</div>';
    return;
  }
  list.innerHTML = nonAdmins.map(m => `
    <div class="member-row" id="mrow-${m.uid}">
      <div>
        <strong>${m.name || m.username}</strong>
        <span style="color:var(--text-muted);font-size:12px;"> @${m.username}</span>
      </div>
      <button class="btn-ghost-light btn-sm" onclick="deleteMember('${m.uid}', '${(m.name || m.username).replace(/'/g,"\\'")}')">Remove</button>
    </div>
  `).join('');
}

async function addMember() {
  const username = document.getElementById('new-member-username').value.trim().toLowerCase();
  const name     = document.getElementById('new-member-name').value.trim();
  const password = document.getElementById('new-member-password').value.trim();
  const errEl    = document.getElementById('member-modal-error');
  errEl.style.display = 'none';

  if (!username || !name || !password) { showError(errEl, 'All fields are required.'); return; }
  if (username === ADMIN_USERNAME)      { showError(errEl, 'That username is reserved.'); return; }

  const existing = await db.collection('users').where('username', '==', username).limit(1).get();
  if (!existing.empty) { showError(errEl, 'Username already taken.'); return; }

  try {
    const ref = await db.collection('users').add({ username, name, password, role: 'member' });
    members[ref.id] = { uid: ref.id, username, name, password, role: 'member' };
    renderMemberList();
    document.getElementById('new-member-username').value = '';
    document.getElementById('new-member-name').value     = '';
    document.getElementById('new-member-password').value = '';
  } catch (e) { showError(errEl, 'Failed to add member. Try again.'); }
}

async function deleteMember(uid, displayName) {
  if (!confirm(`Remove ${displayName}? They will lose access immediately.`)) return;
  try {
    await db.collection('users').doc(uid).delete();
    delete members[uid];
    renderMemberList();
  } catch (e) { alert('Failed to remove member.'); }
}

// ─────────────────────────────────────────────────────────────
//  CAMPAIGN MODAL
// ─────────────────────────────────────────────────────────────
function openNewCampaignModal() {
  const list      = document.getElementById('member-assign-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  list.innerHTML  = nonAdmins.length === 0
    ? '<div style="color:var(--text-muted);font-size:13px;">No members yet. Add members first.</div>'
    : nonAdmins.map(m =>
        `<div class="member-chip" data-uid="${m.uid}" onclick="toggleChip(this)">${m.name || m.username}</div>`
      ).join('');
  document.getElementById('new-campaign-name').value = '';
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function toggleChip(el) { el.classList.toggle('selected'); }

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').style.display = 'none';
}

async function createCampaign() {
  const name  = document.getElementById('new-campaign-name').value.trim();
  const errEl = document.getElementById('modal-error');
  if (!name) { showError(errEl, 'Please enter a campaign name.'); return; }

  const selectedChips = document.querySelectorAll('#member-assign-list .member-chip.selected');
  const assignedUids  = [...selectedChips].map(c => c.dataset.uid);
  if (assignedUids.length === 0) { showError(errEl, 'Please assign at least one member.'); return; }

  try {
    await db.collection('campaigns').add({
      name, assignedUids,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: ADMIN_UID,
    });
    document.getElementById('modal-overlay').style.display = 'none';
    await loadAdminData();
  } catch (e) { showError(errEl, 'Failed to create campaign. Try again.'); }
}

// ─────────────────────────────────────────────────────────────
//  USER CHECKLIST — COMBINED D-5 / D-1 TABLE VIEW
// ─────────────────────────────────────────────────────────────
function populateUserCampaignSelect() {
  const sel = document.getElementById('user-campaign-select');
  sel.innerHTML = '<option value="">Select campaign…</option>';
  Object.values(campaigns).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

function loadUserChecklist() {
  const sel = document.getElementById('user-campaign-select');
  selectedCampaignId = sel.value;

  if (!selectedCampaignId) {
    document.getElementById('user-no-campaign').style.display     = 'block';
    document.getElementById('user-checklist').style.display       = 'none';
    document.getElementById('user-progress-bar-wrap').style.display = 'none';
    document.getElementById('user-campaign-name').textContent     = 'Select a campaign';
    return;
  }

  document.getElementById('user-campaign-name').textContent       = campaigns[selectedCampaignId]?.name || '';
  document.getElementById('user-no-campaign').style.display       = 'none';
  document.getElementById('user-checklist').style.display         = 'block';
  document.getElementById('user-progress-bar-wrap').style.display = 'block';

  // Ensure entries array exists
  ensureEntries();
  renderUserChecklist();
  updateUserProgress();
}

// ── Entries: each campaign has N brand/platform/region combos ──
function ensureEntries() {
  if (!userChecklist[selectedCampaignId]) userChecklist[selectedCampaignId] = {};
  if (!userChecklist[selectedCampaignId].entries || userChecklist[selectedCampaignId].entries.length === 0) {
    userChecklist[selectedCampaignId].entries = [{ brand: '', platform: '', region: '' }];
  }
}

function getEntries() {
  return (userChecklist[selectedCampaignId] || {}).entries || [{ brand: '', platform: '', region: '' }];
}

function addEntry() {
  ensureEntries();
  userChecklist[selectedCampaignId].entries.push({ brand: '', platform: '', region: '' });
  renderUserChecklist();
  updateUserProgress();
  saveChecklist();
}

function updateEntryField(index, field, value) {
  ensureEntries();
  userChecklist[selectedCampaignId].entries[index][field] = value;
  // Update the header label live
  const lbl = document.getElementById(`entry-label-${index}`);
  if (lbl) {
    const e   = userChecklist[selectedCampaignId].entries[index];
    lbl.textContent = buildEntryLabel(e, index);
  }
  saveChecklist();
}

function buildEntryLabel(entry, index) {
  const parts = [entry.brand, entry.platform, entry.region].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Entry ${index + 1}`;
}

// ── Collapse state for categories ──
const collapsedCats = {};

function toggleCat(catId) {
  collapsedCats[catId] = !collapsedCats[catId];
  // Toggle visibility of rows with this category
  document.querySelectorAll(`[data-cat="${catId}"]`).forEach(row => {
    row.style.display = collapsedCats[catId] ? 'none' : '';
  });
  const arrow = document.getElementById(`arrow-${catId}`);
  if (arrow) arrow.classList.toggle('open', !collapsedCats[catId]);
}

// ── Main render ──
function renderUserChecklist() {
  if (!selectedCampaignId) return;

  const campData = userChecklist[selectedCampaignId] || {};
  const d5Data   = campData.d5 || {};
  const d1Data   = campData.d1 || {};
  const entries  = getEntries();
  const entryCount = entries.length;

  const container = document.getElementById('user-checklist');

  // ── Table ──
  let html = `<div class="checklist-table-wrap"><div class="cl-scroll"><table class="cl-table">`;

  // ── THEAD row 1: Item | Guide | [Entry N header] x N ──
  html += `<thead><tr>
    <th class="col-freeze-item" rowspan="2"><span class="th-inner">Item / SKU Inventory</span></th>
    <th class="col-freeze-guide" rowspan="2"><span class="th-inner">Guide Question</span></th>`;

  entries.forEach((e, i) => {
    html += `<th colspan="4" style="text-align:center;border-left:2px solid rgba(255,255,255,0.18)">
      <span class="th-inner" style="display:flex;align-items:center;gap:8px;justify-content:center">
        <span id="entry-label-${i}">${buildEntryLabel(e, i)}</span>
        <span style="font-size:10px;opacity:0.6">Brand · Platform · Region</span>
      </span>
    </th>`;
  });

  // Add-entry button in thead
  html += `<th rowspan="2" style="vertical-align:bottom;padding-bottom:4px">
    <span class="th-inner">
      <button class="btn-add-entry" onclick="addEntry()">+ Add entry</button>
    </span>
  </th>`;
  html += `</tr>`;

  // ── THEAD row 2: sub-headers per entry ──
  html += `<tr class="sub-head">`;
  entries.forEach((e, i) => {
    const borderStyle = i === 0 ? 'border-left:2px solid rgba(255,255,255,0.18)' : '';
    html += `<th class="sub-head" style="${borderStyle}"><span class="th-inner" style="padding:5px 10px;display:block">
      <input type="text" placeholder="Brand" value="${escHtml(e.brand)}"
        oninput="updateEntryField(${i},'brand',this.value)"
        style="width:70px;font-size:11px;padding:3px 6px;border:1px solid rgba(255,255,255,0.25);border-radius:5px;background:rgba(255,255,255,0.12);color:white;font-family:var(--font)"
      />
    </span></th>
    <th class="sub-head"><span class="th-inner" style="padding:5px 10px;display:block">
      <input type="text" placeholder="Platform" value="${escHtml(e.platform)}"
        oninput="updateEntryField(${i},'platform',this.value)"
        style="width:80px;font-size:11px;padding:3px 6px;border:1px solid rgba(255,255,255,0.25);border-radius:5px;background:rgba(255,255,255,0.12);color:white;font-family:var(--font)"
      />
    </span></th>
    <th class="sub-head"><span class="th-inner" style="padding:5px 10px;display:block">
      <input type="text" placeholder="Region" value="${escHtml(e.region)}"
        oninput="updateEntryField(${i},'region',this.value)"
        style="width:65px;font-size:11px;padding:3px 6px;border:1px solid rgba(255,255,255,0.25);border-radius:5px;background:rgba(255,255,255,0.12);color:white;font-family:var(--font)"
      />
    </span></th>
    <th class="sub-head"><span class="th-inner" style="padding:5px 6px;display:block;font-size:10px;color:#93C5FD">Notes</span></th>`;
  });
  html += `</tr></thead>`;

  // ── TBODY ──
  html += `<tbody>`;

  CHECKLIST_SECTIONS.forEach(sec => {
    const isOpen    = !collapsedCats[sec.id];
    const totalCols = 2 + entryCount * 4 + 1;

    // Category header row
    html += `<tr class="cat-header" onclick="toggleCat('${sec.id}')">
      <td class="col-freeze-item">
        <span class="cat-toggle-arrow ${isOpen ? 'open' : ''}" id="arrow-${sec.id}">&#9658;</span>
        ${sec.title}
        <span style="font-weight:400;opacity:0.7;font-size:10px">(${sec.items.length})</span>
      </td>
      <td class="col-freeze-guide"></td>
      ${Array(entryCount * 4 + 1).fill('<td></td>').join('')}
    </tr>`;

    // Item rows
    sec.items.forEach(item => {
      const displayStyle = isOpen ? '' : 'display:none';
      html += `<tr class="item-row" data-cat="${sec.id}" style="${displayStyle}">
        <td class="col-freeze-item" style="font-size:12px;font-weight:500;line-height:1.4">${item.name}</td>
        <td class="col-freeze-guide" style="font-size:11px;color:var(--text-muted);line-height:1.4">${item.guide}</td>`;

      entries.forEach((_, ei) => {
        const d5key = ei === 0 ? item.id : `${item.id}_e${ei}`;
        const d1key = ei === 0 ? item.id : `${item.id}_e${ei}`;
        const d5val = (d5Data[d5key] || {}).status || '';
        const d1val = (d1Data[d1key] || {}).status || '';
        const d5note = escHtml((d5Data[d5key] || {}).note || '');
        const d1note = escHtml((d1Data[d1key] || {}).note || '');

        const borderL = ei === 0 ? 'border-left:2px solid var(--border-strong)' : '';

        html += `<td style="${borderL}">
          <select class="status-sel ${statusClass(d5val)}"
            onchange="handleStatusChange('${item.id}','d5',${ei},this)">
            ${statusOptions(d5val)}
          </select>
        </td>
        <td>
          <input class="note-input" type="text" placeholder="Notes…" value="${d5note}"
            oninput="handleNoteChange('${item.id}','d5',${ei},this.value)"
            onblur="saveChecklist()" />
        </td>
        <td>
          <select class="status-sel ${statusClass(d1val)}"
            onchange="handleStatusChange('${item.id}','d1',${ei},this)">
            ${statusOptions(d1val)}
          </select>
        </td>
        <td>
          <input class="note-input" type="text" placeholder="Notes…" value="${d1note}"
            oninput="handleNoteChange('${item.id}','d1',${ei},this.value)"
            onblur="saveChecklist()" />
        </td>`;
      });

      html += `<td></td></tr>`;
    });
  });

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}

// ── Status helpers ──
function statusOptions(current) {
  const opts = [
    { v: '',            l: '— Pending' },
    { v: 'done',        l: '✓ Done' },
    { v: 'in-progress', l: '⟳ In Progress' },
    { v: 'na',          l: 'N/A' },
  ];
  return opts.map(o => `<option value="${o.v}" ${current === o.v ? 'selected' : ''}>${o.l}</option>`).join('');
}

function statusClass(status) {
  return { done: 's-done', 'in-progress': 's-progress', na: 's-na', '': 's-pending' }[status] || 's-pending';
}

// ── Event handlers ──
function handleStatusChange(itemId, tab, entryIndex, selectEl) {
  const status = selectEl.value;
  selectEl.className = `status-sel ${statusClass(status)}`;
  ensurePath(tab);
  const key = entryIndex === 0 ? itemId : `${itemId}_e${entryIndex}`;
  userChecklist[selectedCampaignId][tab][key] = {
    ...(userChecklist[selectedCampaignId][tab][key] || {}), status
  };
  updateUserProgress();
  saveChecklist();
}

function handleNoteChange(itemId, tab, entryIndex, note) {
  ensurePath(tab);
  const key = entryIndex === 0 ? itemId : `${itemId}_e${entryIndex}`;
  userChecklist[selectedCampaignId][tab][key] = {
    ...(userChecklist[selectedCampaignId][tab][key] || {}), note
  };
}

function ensurePath(tab) {
  if (!userChecklist[selectedCampaignId])        userChecklist[selectedCampaignId] = {};
  if (!userChecklist[selectedCampaignId][tab])   userChecklist[selectedCampaignId][tab] = {};
}

function updateUserProgress() {
  const campData = userChecklist[selectedCampaignId] || {};
  const done     = countDone(campData.d5 || {}) + countDone(campData.d1 || {});
  const entries  = getEntries();
  const total    = TOTAL_ITEMS * 2 * entries.length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('user-progress-label').textContent = `${done} / ${total} items complete`;
  document.getElementById('user-progress-pct').textContent   = `${pct}%`;
  document.getElementById('user-progress-fill').style.width  = `${pct}%`;
}

let saveTimer = null;
function saveChecklist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentUser || !selectedCampaignId) return;
    const saveData = { ...userChecklist };
    if (!saveData[selectedCampaignId]) saveData[selectedCampaignId] = {};
    saveData[selectedCampaignId].lastActive = new Date().toISOString();
    await db.collection('checklists').doc(currentUser.uid).set(saveData, { merge: true });
  }, 800);
}

// ─────────────────────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────────────────────
function showScreen(id) {
  ['login-screen', 'admin-screen', 'user-screen'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
}

function showError(el, msg) {
  el.textContent    = msg;
  el.style.display  = 'block';
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ═════════════════════════════════════════════════════════════
//  FEATURE 1: BROADCAST SYSTEM
// ═════════════════════════════════════════════════════════════
let currentBroadcastType = 'shoutout';

const QUICK_MESSAGES = {
  shoutout: [
    '🏆 First to complete! Awesome work!',
    '🌟 Great hustle — checklist done ahead of schedule!',
    '🎉 Crushed it! 100% complete!',
  ],
  nudge: [
    '⏰ Friendly reminder: please complete your checklist before D-Day!',
    '📋 A few items still pending — can we wrap these up today?',
    '🚀 Almost there! Let\'s push to finish strong.',
  ],
  custom: [],
};

function openBroadcastModal() {
  // Populate member select
  const mSel = document.getElementById('broadcast-member-sel');
  mSel.innerHTML = '<option value="">All members</option>';
  Object.values(members).filter(m => m.role !== 'admin').forEach(m => {
    mSel.innerHTML += `<option value="${m.uid}">${m.name || m.username} (@${m.username})</option>`;
  });

  // Populate campaign select
  const cSel = document.getElementById('broadcast-campaign-sel');
  cSel.innerHTML = '<option value="">All campaigns</option>';
  Object.values(campaigns).forEach(c => {
    cSel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });

  currentBroadcastType = 'shoutout';
  document.querySelectorAll('.btn-broadcast-type').forEach(b => b.classList.remove('selected'));
  document.querySelector('.btn-broadcast-type[data-type="shoutout"]').classList.add('selected');
  renderQuickMessages();
  document.getElementById('broadcast-message').value = '';
  document.getElementById('broadcast-error').style.display = 'none';
  document.getElementById('broadcast-overlay').style.display = 'flex';
}

function closeBroadcastModal(e) {
  if (e && e.target !== document.getElementById('broadcast-overlay')) return;
  document.getElementById('broadcast-overlay').style.display = 'none';
}

function selectBroadcastType(btn) {
  currentBroadcastType = btn.dataset.type;
  document.querySelectorAll('.btn-broadcast-type').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  renderQuickMessages();
}

function renderQuickMessages() {
  const msgs = QUICK_MESSAGES[currentBroadcastType] || [];
  const wrap = document.getElementById('broadcast-quick-msgs');
  if (msgs.length === 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Quick picks</div>` +
    msgs.map(m => `<button class="quick-msg-chip" onclick="useQuickMsg(this)">${m}</button>`).join('');
}

function useQuickMsg(btn) {
  document.getElementById('broadcast-message').value = btn.textContent;
}

async function sendBroadcast() {
  const msg     = document.getElementById('broadcast-message').value.trim();
  const uid     = document.getElementById('broadcast-member-sel').value;
  const campId  = document.getElementById('broadcast-campaign-sel').value;
  const errEl   = document.getElementById('broadcast-error');
  errEl.style.display = 'none';

  if (!msg) { showError(errEl, 'Please write a message.'); return; }

  const memberName = uid
    ? (members[uid]?.name || members[uid]?.username || 'member')
    : 'everyone';
  const campName = campId ? campaigns[campId]?.name : null;

  const broadcast = {
    type:       currentBroadcastType,
    message:    msg,
    targetUid:  uid || null,
    targetName: memberName,
    campaignId: campId || null,
    campaignName: campName || null,
    sentAt:     new Date().toISOString(),
    sentBy:     'Admin',
    readBy:     [],
  };

  try {
    await db.collection('broadcasts').add(broadcast);
    document.getElementById('broadcast-overlay').style.display = 'none';
    alert(`Broadcast sent to ${memberName}!`);
  } catch(e) { showError(errEl, 'Failed to send. Try again.'); }
}

// ── Broadcast Feed (user side) ──
let lastBroadcastCheck = null;

async function openBroadcastFeed() {
  document.getElementById('broadcast-feed-overlay').style.display = 'flex';
  await loadBroadcastFeed();
}

function closeBroadcastFeed(e) {
  if (e && e.target !== document.getElementById('broadcast-feed-overlay')) return;
  document.getElementById('broadcast-feed-overlay').style.display = 'none';
}

async function loadBroadcastFeed() {
  const list = document.getElementById('broadcast-feed-list');
  list.innerHTML = '<div style="padding:1rem;color:var(--text-muted);text-align:center;">Loading…</div>';

  try {
    const snap = await db.collection('broadcasts')
      .orderBy('sentAt', 'desc')
      .limit(30)
      .get();

    if (snap.empty) {
      list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No broadcasts yet.</div>';
      return;
    }

    const uid = currentUser?.uid;
    const batch = db.batch();
    const unreadIds = [];

    let html = '';
    snap.forEach(doc => {
      const b = doc.data();
      // Only show broadcasts targeted at this user or all
      if (b.targetUid && b.targetUid !== uid) return;
      const isUnread = !b.readBy?.includes(uid);
      if (isUnread) unreadIds.push(doc.id);

      const typeIcon = { shoutout: '🏆', nudge: '⏰', custom: '📢' }[b.type] || '📣';
      const typeColor = { shoutout: '#059669', nudge: '#D97706', custom: '#2563EB' }[b.type] || '#64748B';
      const timeStr = new Date(b.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const campTag = b.campaignName ? `<span class="bcast-tag">${b.campaignName}</span>` : '';
      const unreadDot = isUnread ? `<span style="width:8px;height:8px;background:#EF4444;border-radius:50%;display:inline-block;margin-left:4px;"></span>` : '';

      html += `<div class="bcast-card ${isUnread ? 'bcast-unread' : ''}">
        <div class="bcast-header">
          <span class="bcast-type-icon" style="color:${typeColor}">${typeIcon}</span>
          <span class="bcast-from">From Admin</span>
          ${campTag}
          ${unreadDot}
          <span class="bcast-time">${timeStr}</span>
        </div>
        <div class="bcast-msg">${escHtml(b.message)}</div>
        ${b.targetUid ? `<div class="bcast-to">To: <strong>${escHtml(b.targetName)}</strong></div>` : ''}
      </div>`;
    });

    list.innerHTML = html || '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No messages for you yet.</div>';

    // Mark as read
    for (const docId of unreadIds) {
      await db.collection('broadcasts').doc(docId).update({
        readBy: firebase.firestore.FieldValue.arrayUnion(uid)
      });
    }
    updateBroadcastBadge(0);
  } catch(e) { list.innerHTML = '<div style="padding:1rem;color:var(--danger);">Failed to load broadcasts.</div>'; }
}

async function checkBroadcastBadge() {
  if (!currentUser || currentUser.role === 'admin') return;
  try {
    const snap = await db.collection('broadcasts')
      .orderBy('sentAt', 'desc')
      .limit(50)
      .get();
    let count = 0;
    snap.forEach(doc => {
      const b = doc.data();
      if (b.targetUid && b.targetUid !== currentUser.uid) return;
      if (!b.readBy?.includes(currentUser.uid)) count++;
    });
    updateBroadcastBadge(count);
  } catch(e) {}
}

function updateBroadcastBadge(count) {
  const badge = document.getElementById('user-broadcast-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Admin broadcast history view ──
async function openAdminBroadcastHistory() {
  document.getElementById('broadcast-feed-overlay').style.display = 'flex';
  const list = document.getElementById('broadcast-feed-list');
  list.innerHTML = '<div style="padding:1rem;color:var(--text-muted);text-align:center;">Loading…</div>';
  try {
    const snap = await db.collection('broadcasts').orderBy('sentAt','desc').limit(50).get();
    if (snap.empty) { list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No broadcasts sent yet.</div>'; return; }
    let html = '';
    snap.forEach(doc => {
      const b = doc.data();
      const typeIcon = { shoutout: '🏆', nudge: '⏰', custom: '📢' }[b.type] || '📣';
      const typeColor = { shoutout: '#059669', nudge: '#D97706', custom: '#2563EB' }[b.type] || '#64748B';
      const timeStr = new Date(b.sentAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const campTag = b.campaignName ? `<span class="bcast-tag">${b.campaignName}</span>` : '';
      const readCount = (b.readBy || []).length;
      html += `<div class="bcast-card">
        <div class="bcast-header">
          <span class="bcast-type-icon" style="color:${typeColor}">${typeIcon}</span>
          <span class="bcast-from">To: ${escHtml(b.targetName || 'everyone')}</span>
          ${campTag}
          <span class="bcast-time">${timeStr}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">👁 ${readCount}</span>
        </div>
        <div class="bcast-msg">${escHtml(b.message)}</div>
      </div>`;
    });
    list.innerHTML = html;
  } catch(e) { list.innerHTML = '<div style="padding:1rem;color:var(--danger);">Failed to load.</div>'; }
}

// ═════════════════════════════════════════════════════════════
//  FEATURE 2: CHECKLIST ITEM EDITOR
// ═════════════════════════════════════════════════════════════
// We store custom checklist overrides in Firestore at /settings/checklist
// On load, we merge them into CHECKLIST_SECTIONS

let editorSections = [];  // deep copy of current sections for editing

async function loadChecklistOverrides() {
  try {
    const doc = await db.collection('settings').doc('checklist').get();
    if (doc.exists && doc.data().sections) {
      const saved = doc.data().sections;
      // Merge: replace CHECKLIST_SECTIONS content
      CHECKLIST_SECTIONS.length = 0;
      saved.forEach(s => CHECKLIST_SECTIONS.push(s));
      // Recalculate TOTAL_ITEMS
      const newTotal = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
      // TOTAL_ITEMS is const so we patch it on the window
      window._TOTAL_ITEMS_OVERRIDE = newTotal;
    }
  } catch(e) { console.warn('Could not load checklist overrides', e); }
}

function getTotalItems() {
  return window._TOTAL_ITEMS_OVERRIDE || TOTAL_ITEMS;
}

function openEditorModal() {
  // Deep clone current sections
  editorSections = JSON.parse(JSON.stringify(CHECKLIST_SECTIONS));
  populateEditorSectionSel();
  renderEditorSection();
  document.getElementById('editor-error').style.display = 'none';
  document.getElementById('editor-overlay').style.display = 'flex';
}

function closeEditorModal(e) {
  if (e && e.target !== document.getElementById('editor-overlay')) return;
  document.getElementById('editor-overlay').style.display = 'none';
}

function populateEditorSectionSel() {
  const sel = document.getElementById('editor-section-sel');
  sel.innerHTML = editorSections.map((s, i) =>
    `<option value="${i}">${s.title}</option>`
  ).join('');
}

function renderEditorSection() {
  const idx = parseInt(document.getElementById('editor-section-sel').value) || 0;
  const sec = editorSections[idx];
  if (!sec) return;

  // Section title edit
  document.getElementById('editor-section-header').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
      <input type="text" id="editor-section-title" value="${escHtml(sec.title)}"
        oninput="editorSections[${idx}].title = this.value; document.getElementById('editor-section-sel').options[${idx}].text = this.value;"
        style="font-size:14px;font-weight:600;color:var(--navy);border:1px solid var(--border);border-radius:6px;padding:5px 10px;flex:1;" />
      <button class="btn-ghost-light" style="color:#DC2626;border-color:#FCA5A5;" onclick="deleteEditorSection(${idx})">🗑 Delete Section</button>
    </div>
  `;

  const list = document.getElementById('editor-items-list');
  if (sec.items.length === 0) {
    list.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">No items in this section yet.</div>`;
    return;
  }

  list.innerHTML = sec.items.map((item, ii) => `
    <div class="editor-item-row" id="erow-${ii}">
      <div class="editor-item-num">${ii + 1}</div>
      <div class="editor-item-fields">
        <input type="text" class="editor-item-name" placeholder="Item name"
          value="${escHtml(item.name)}"
          oninput="editorSections[${idx}].items[${ii}].name = this.value"
          />
        <textarea class="editor-item-guide" placeholder="Guide question" rows="2"
          oninput="editorSections[${idx}].items[${ii}].guide = this.value"
          >${escHtml(item.guide)}</textarea>
      </div>
      <button class="editor-item-del" onclick="deleteEditorItem(${idx},${ii})">✕</button>
    </div>
  `).join('');
}

function addEditorRow() {
  const idx = parseInt(document.getElementById('editor-section-sel').value) || 0;
  const sec = editorSections[idx];
  const newId = `${sec.id}_${Date.now()}`;
  sec.items.push({ id: newId, name: '', guide: '' });
  renderEditorSection();
  // Scroll to last row
  setTimeout(() => {
    const list = document.getElementById('editor-items-list');
    list.scrollTop = list.scrollHeight;
  }, 50);
}

function deleteEditorItem(secIdx, itemIdx) {
  if (!confirm('Delete this item?')) return;
  editorSections[secIdx].items.splice(itemIdx, 1);
  renderEditorSection();
}

function addEditorSection() {
  const name = prompt('Section name:');
  if (!name) return;
  editorSections.push({ id: `sec_${Date.now()}`, title: name, items: [] });
  populateEditorSectionSel();
  document.getElementById('editor-section-sel').value = editorSections.length - 1;
  renderEditorSection();
}

function deleteEditorSection(idx) {
  if (!confirm(`Delete section "${editorSections[idx].title}" and ALL its items?`)) return;
  editorSections.splice(idx, 1);
  populateEditorSectionSel();
  document.getElementById('editor-section-sel').value = 0;
  renderEditorSection();
}

async function saveEditorChanges() {
  const errEl = document.getElementById('editor-error');
  // Validate: no empty names
  for (const sec of editorSections) {
    if (!sec.title.trim()) { showError(errEl, 'All sections must have a title.'); return; }
    for (const item of sec.items) {
      if (!item.name.trim()) { showError(errEl, `Empty item name found in "${sec.title}". Please fill it in or delete the row.`); return; }
    }
  }

  try {
    await db.collection('settings').doc('checklist').set({ sections: editorSections });
    // Apply to runtime
    CHECKLIST_SECTIONS.length = 0;
    editorSections.forEach(s => CHECKLIST_SECTIONS.push(JSON.parse(JSON.stringify(s))));
    window._TOTAL_ITEMS_OVERRIDE = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
    document.getElementById('editor-overlay').style.display = 'none';
    // Re-render if user checklist is visible
    if (selectedCampaignId) renderUserChecklist();
  } catch(e) { showError(errEl, 'Failed to save. Please try again.'); }
}

// ═════════════════════════════════════════════════════════════
//  FEATURE 3: BRAND REGISTRATION
// ═════════════════════════════════════════════════════════════
const CAMPAIGN_TYPES = [
  { id: 'mega',         label: '🔥 Mega',         color: '#DC2626' },
  { id: 'double_digit', label: '🔢 Double Digit',  color: '#7C3AED' },
  { id: 'mid_month',   label: '📅 Mid-Month',     color: '#0891B2' },
  { id: 'payday',      label: '💰 Payday',         color: '#059669' },
];

let brandRegData = {};       // { mega: { brands: [...], campaigns: [...] }, ... }
let activeBrandTab = 'mega';

// Admin stat cards: registration summary
async function loadBrandRegistrations() {
  try {
    const doc = await db.collection('settings').doc('brandRegistration').get();
    if (doc.exists) brandRegData = doc.data() || {};
  } catch(e) { brandRegData = {}; }
}

function openBrandRegModal() {
  activeBrandTab = 'mega';
  document.querySelectorAll('.brand-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'mega');
  });
  renderBrandRegContent();
  document.getElementById('brand-reg-error').style.display = 'none';
  document.getElementById('brand-reg-overlay').style.display = 'flex';
}

function closeBrandRegModal(e) {
  if (e && e.target !== document.getElementById('brand-reg-overlay')) return;
  document.getElementById('brand-reg-overlay').style.display = 'none';
}

function switchBrandTab(btn, type) {
  activeBrandTab = type;
  document.querySelectorAll('.brand-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderBrandRegContent();
}

function renderBrandRegContent() {
  const typeInfo = CAMPAIGN_TYPES.find(t => t.id === activeBrandTab);
  const data = brandRegData[activeBrandTab] || { brands: [], campaigns: [] };
  const brands = data.brands || [];
  const campList = data.campaigns || [];

  let html = `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">
        Campaign Dates / Names for ${typeInfo.label}
      </div>
      <div id="br-campaigns-list" style="display:flex;flex-direction:column;gap:6px;">
        ${campList.map((c, i) => `
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" class="br-camp-input" value="${escHtml(c)}" placeholder="e.g. 11.11 Mega Sale"
              oninput="updateBrCamp(${i},this.value)"
              style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;" />
            <button class="btn-ghost-light btn-sm" onclick="removeBrCamp(${i})">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="btn-outline" style="margin-top:8px;background:transparent;color:var(--blue);border-color:var(--blue);font-size:12px;padding:5px 12px;" onclick="addBrCamp()">+ Add Campaign</button>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin-bottom:14px;">
    <div style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
      Registered Brands (${brands.length})
    </div>
    <div id="br-brands-list" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;">
      ${brands.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No brands registered yet.</div>' :
        brands.map((b, i) => `
          <div class="br-brand-row">
            <span class="br-brand-num">${i+1}</span>
            <input type="text" class="br-brand-input" value="${escHtml(b.name || b)}" placeholder="Brand name"
              oninput="updateBrBrand(${i},'name',this.value)"
              style="flex:1;font-size:13px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;" />
            <input type="text" class="br-brand-input" value="${escHtml(b.pic || '')}" placeholder="PIC / Contact"
              oninput="updateBrBrand(${i},'pic',this.value)"
              style="width:130px;font-size:13px;padding:5px 10px;border:1px solid var(--border);border-radius:6px;" />
            <button class="btn-ghost-light btn-sm" onclick="removeBrBrand(${i})">✕</button>
          </div>
        `).join('')
      }
    </div>
    <button class="btn-outline" style="margin-top:10px;background:transparent;color:var(--blue);border-color:var(--blue);font-size:12px;padding:5px 12px;" onclick="addBrBrand()">+ Add Brand</button>
  `;

  document.getElementById('brand-reg-content').innerHTML = html;
}

function ensureBrData(type) {
  if (!brandRegData[type]) brandRegData[type] = { brands: [], campaigns: [] };
  if (!brandRegData[type].brands) brandRegData[type].brands = [];
  if (!brandRegData[type].campaigns) brandRegData[type].campaigns = [];
}

function addBrCamp() {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].campaigns.push('');
  renderBrandRegContent();
}

function removeBrCamp(i) {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].campaigns.splice(i, 1);
  renderBrandRegContent();
}

function updateBrCamp(i, val) {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].campaigns[i] = val;
}

function addBrBrand() {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].brands.push({ name: '', pic: '' });
  renderBrandRegContent();
  setTimeout(() => {
    const list = document.getElementById('br-brands-list');
    if (list) list.scrollTop = list.scrollHeight;
  }, 50);
}

function removeBrBrand(i) {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].brands.splice(i, 1);
  renderBrandRegContent();
}

function updateBrBrand(i, field, val) {
  ensureBrData(activeBrandTab);
  if (typeof brandRegData[activeBrandTab].brands[i] === 'string') {
    brandRegData[activeBrandTab].brands[i] = { name: brandRegData[activeBrandTab].brands[i], pic: '' };
  }
  brandRegData[activeBrandTab].brands[i][field] = val;
}

async function saveBrandRegistration() {
  const errEl = document.getElementById('brand-reg-error');
  try {
    await db.collection('settings').doc('brandRegistration').set(brandRegData);
    document.getElementById('brand-reg-overlay').style.display = 'none';
    // Refresh admin brand summary cards
    renderBrandSummaryCards();
  } catch(e) { showError(errEl, 'Failed to save. Try again.'); }
}

function renderBrandSummaryCards() {
  const existingWrap = document.getElementById('brand-summary-row');
  if (!existingWrap) return;

  existingWrap.innerHTML = CAMPAIGN_TYPES.map(type => {
    const data = brandRegData[type.id] || {};
    const count = (data.brands || []).length;
    const camps = (data.campaigns || []).filter(Boolean);
    return `
      <div class="brand-summary-card" onclick="openBrandDetailPopover('${type.id}')" style="cursor:pointer;">
        <div class="bsc-label">${type.label}</div>
        <div class="bsc-count" style="color:${type.color};">${count}</div>
        <div class="bsc-sub">brands registered</div>
        ${camps.length > 0 ? `<div class="bsc-camps">${camps.slice(0,2).map(c=>`<span class="bsc-camp-tag">${escHtml(c)}</span>`).join('')}${camps.length > 2 ? `<span class="bsc-camp-tag">+${camps.length-2}</span>` : ''}</div>` : ''}
      </div>
    `;
  }).join('');
}

function openBrandDetailPopover(typeId) {
  const type = CAMPAIGN_TYPES.find(t => t.id === typeId);
  const data = brandRegData[typeId] || {};
  const brands = data.brands || [];
  const camps = (data.campaigns || []).filter(Boolean);

  // Reuse broadcast-feed overlay as a detail view
  document.getElementById('broadcast-feed-overlay').style.display = 'flex';
  const list = document.getElementById('broadcast-feed-list');

  list.innerHTML = `
    <div style="padding:0 0 12px;">
      <div style="font-size:16px;font-weight:600;color:var(--navy);margin-bottom:4px;">${type.label}</div>
      ${camps.length > 0 ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">📅 ${camps.join('  ·  ')}</div>` : ''}
      <div style="font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Registered Brands (${brands.length})</div>
      ${brands.length === 0 ? '<div style="color:var(--text-muted);font-size:13px;">No brands registered yet.</div>' :
        `<table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);border-radius:6px 0 0 0;">#</th>
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);">Brand</th>
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);border-radius:0 6px 0 0;">PIC / Contact</th>
          </tr></thead>
          <tbody>
            ${brands.map((b, i) => `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:7px 10px;color:var(--text-muted);">${i+1}</td>
              <td style="padding:7px 10px;font-weight:500;">${escHtml(b.name || b)}</td>
              <td style="padding:7px 10px;color:var(--text-muted);">${escHtml(b.pic || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      }
    </div>
  `;
}

// Inject brand summary row below admin stats
function injectBrandSummaryRow() {
  if (document.getElementById('brand-summary-row')) return;
  const adminBody = document.querySelector('.admin-body');
  if (!adminBody) return;
  const statsRow = document.getElementById('admin-stats');
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="section-label" style="margin-bottom:8px;margin-top:0;">Brand registrations — click to view</div>
    <div class="brand-summary-grid" id="brand-summary-row"></div>
  `;
  statsRow.after(wrap);
  renderBrandSummaryCards();
}

// ═════════════════════════════════════════════════════════════
//  PATCH EXISTING FUNCTIONS
// ═════════════════════════════════════════════════════════════

// Override loadAdminData to also load brand registrations + checklist overrides
const _origLoadAdminData = loadAdminData;
async function loadAdminData() {
  await _origLoadAdminData();
  await loadBrandRegistrations();
  await loadChecklistOverrides();
  injectBrandSummaryRow();
}

// Override loadMemberData to also load checklist overrides + broadcast badge
const _origLoadMemberData = loadMemberData;
async function loadMemberData(uid) {
  await _origLoadMemberData(uid);
  await loadChecklistOverrides();
  await checkBroadcastBadge();
}

// (already handled above via the override chain)

