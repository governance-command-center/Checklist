// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let currentUser       = null;   // { uid, username, name, role }
let campaigns         = {};     // { id: { name, assignedUids, createdAt } }
let members           = {};     // { uid: { username, name, role } }
let userChecklist     = {};     // { campaignId: { entries, d5, d1, lastActive } }
let selectedCampaignId = null;
let calendarEntries   = [];     // shared admin calendar entries
let personalCalendarEntries = []; // personal entries for current user

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
  await loadChecklistOverrides();
  await loadBrandRegistrations();
  await loadCalendarEntries();
  injectBrandSummaryRow();
  // Refresh data tab if it's currently showing
  const dataTab = document.getElementById('admin-tab-data');
  if (dataTab && dataTab.style.display !== 'none') renderDataTab();
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
  await loadChecklistOverrides();
  await loadCalendarEntries();
  await loadPersonalCalendarEntries(uid);
  await checkBroadcastBadge();

  // Show calendar as the main view for members
  showUserTab('calendar');
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
      <td style="white-space:nowrap;">
        <button class="btn-link" onclick="openReviewModal('${r.member.uid}','${r.camp.id}')">Review</button>
        <button class="btn-link" style="color:#DC2626;margin-left:10px;" onclick="openDeleteClModal('${r.member.uid}','${r.camp.id}','${(r.member.name||r.member.username).replace(/'/g,"\\'")}')">Delete</button>
      </td>
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
//  ADMIN REVIEW MODAL
// ─────────────────────────────────────────────────────────────
async function openReviewModal(uid, campId) {
  _reviewUid   = uid;
  _reviewCampId = campId;
  const member = members[uid];
  const camp   = campaigns[campId];
  document.getElementById('review-member-name').textContent    = member.name || member.username;
  document.getElementById('review-campaign-name').textContent  = camp.name;

  const checkSnap = await db.collection('checklists').doc(uid).get();
  const cl = checkSnap.exists ? (checkSnap.data()[campId] || {}) : {};
  const d5Data = cl.d5 || {};
  const d1Data = cl.d1 || {};
  const entries = cl.entries || [{ brand: '', platform: '', region: '' }];

  let html = `<div class="review-table-wrap"><table class="review-table">`;
  const entryCount = entries.length;

  html += `<thead><tr>
    <th class="freeze" rowspan="2" style="min-width:220px">Item</th>
    <th class="freeze2" rowspan="2" style="min-width:220px">Guide question</th>`;
  entries.forEach((e, i) => {
    const label = [e.brand, e.platform, e.region].filter(Boolean).join(' · ') || `Entry ${i + 1}`;
    html += `<th colspan="4" style="text-align:center">${label}</th>`;
  });
  html += `</tr><tr>`;
  entries.forEach(() => {
    html += `<th class="sub" colspan="2" style="text-align:center;">D-5<br><span style="font-size:10px;font-weight:400;opacity:0.7;">status &amp; notes</span></th><th class="sub" colspan="2" style="text-align:center;">D-1<br><span style="font-size:10px;font-weight:400;opacity:0.7;">status &amp; notes</span></th>`;
  });
  html += `</tr></thead><tbody>`;

  CHECKLIST_SECTIONS.forEach(sec => {
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
        const key = i === 0 ? item.id : `${item.id}_e${i}`;
        const d5 = d5Data[key] || {};
        const d1 = d1Data[key] || {};
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
    done:          ['rv-done',     'Done'],
    'in-progress': ['rv-progress', 'In Progress'],
    pending:       ['rv-pending',  'Pending'],
    na:            ['rv-na',       'N/A'],
  };
  const [cls, label] = map[status] || ['rv-blank', status];
  return `<span class="rv-status ${cls}">${label}</span>`;
}

function closeReviewModal(e) {
  if (e && e.target !== document.getElementById('review-overlay')) return;
  document.getElementById('review-overlay').style.display = 'none';
}

// Track what's currently open in the review modal for the delete button
let _reviewUid = null;
let _reviewCampId = null;

function openDeleteClFromReview() {
  if (!_reviewUid || !_reviewCampId) return;
  const member = members[_reviewUid];
  const camp   = campaigns[_reviewCampId];
  document.getElementById('review-overlay').style.display = 'none';
  openDeleteClModal(_reviewUid, _reviewCampId, member?.name || member?.username || _reviewUid);
}

// ── Delete checklist modal ──
function openDeleteClModal(uid, campId, memberName) {
  document.getElementById('delete-cl-msg').textContent =
    `This will permanently delete ${memberName}'s checklist progress for "${campaigns[campId]?.name || campId}". This cannot be undone.`;
  document.getElementById('delete-cl-error').style.display = 'none';
  document.getElementById('delete-cl-confirm-btn').onclick = () => confirmDeleteChecklist(uid, campId);
  document.getElementById('delete-cl-overlay').style.display = 'flex';
}

function closeDeleteClModal(e) {
  if (e && e.target !== document.getElementById('delete-cl-overlay')) return;
  document.getElementById('delete-cl-overlay').style.display = 'none';
}

async function confirmDeleteChecklist(uid, campId) {
  const errEl = document.getElementById('delete-cl-error');
  errEl.style.display = 'none';
  try {
    // Load the member's full checklist doc, remove only the campaign key, then save
    const snap = await db.collection('checklists').doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      delete data[campId];
      await db.collection('checklists').doc(uid).set(data);
    }
    document.getElementById('delete-cl-overlay').style.display = 'none';
    await renderAdminView();
  } catch(e) {
    showError(errEl, 'Failed to delete checklist. Try again.');
    console.error(e);
  }
}

// ── Admin: Delete ALL checklists globally ──
function openDeleteAllChecklistsModal() {
  document.getElementById('delete-all-cl-error').style.display = 'none';
  document.getElementById('delete-all-cl-overlay').style.display = 'flex';
}

function closeDeleteAllChecklistsModal(e) {
  if (e && e.target !== document.getElementById('delete-all-cl-overlay')) return;
  document.getElementById('delete-all-cl-overlay').style.display = 'none';
}

async function confirmDeleteAllChecklists() {
  const errEl = document.getElementById('delete-all-cl-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('delete-all-cl-confirm-btn');
  btn.textContent = 'Deleting…'; btn.disabled = true;
  try {
    const snap = await db.collection('checklists').get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    userChecklist = {};
    document.getElementById('delete-all-cl-overlay').style.display = 'none';
    await renderAdminView();
  } catch(e) {
    showError(errEl, 'Failed to delete all checklists. Try again.');
    console.error(e);
  } finally {
    btn.textContent = 'Delete ALL Checklists'; btn.disabled = false;
  }
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
//  USER TABS  (calendar vs checklist)
// ─────────────────────────────────────────────────────────────
function showUserTab(tab) {
  const calView  = document.getElementById('user-calendar-view');
  const clView   = document.getElementById('user-checklist-view');
  const tabCal   = document.getElementById('tab-calendar');
  const tabCL    = document.getElementById('tab-checklist');

  if (tab === 'calendar') {
    calView.style.display = 'block';
    clView.style.display  = 'none';
    tabCal.classList.add('active');
    tabCL.classList.remove('active');
    renderCalendarView(calView);
  } else {
    calView.style.display = 'none';
    clView.style.display  = 'block';
    tabCal.classList.remove('active');
    tabCL.classList.add('active');
    // If a campaign is already selected, re-render; otherwise show selector
    if (selectedCampaignId) {
      renderUserChecklist();
    }
  }
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
    return;
  }

  document.getElementById('user-campaign-name').textContent       = campaigns[selectedCampaignId]?.name || '';
  document.getElementById('user-no-campaign').style.display       = 'none';
  document.getElementById('user-checklist').style.display         = 'block';
  document.getElementById('user-progress-bar-wrap').style.display = 'block';

  ensureEntries();
  renderUserChecklist();
  updateUserProgress();
}

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
  saveChecklist();
}

// New: single editable label per entry
function updateEntryLabel(index, value) {
  ensureEntries();
  userChecklist[selectedCampaignId].entries[index].label = value;
  saveChecklist();
}

function buildEntryLabel(entry, index) {
  if (entry.label) return entry.label;
  const parts = [entry.brand, entry.platform, entry.region].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Entry ${index + 1}`;
}

function removeEntry(index) {
  ensureEntries();
  if (userChecklist[selectedCampaignId].entries.length <= 1) return;
  userChecklist[selectedCampaignId].entries.splice(index, 1);
  renderUserChecklist();
  updateUserProgress();
  saveChecklist();
}

const collapsedCats = {};

function toggleCat(catId) {
  collapsedCats[catId] = !collapsedCats[catId];
  document.querySelectorAll(`[data-cat="${catId}"]`).forEach(row => {
    row.style.display = collapsedCats[catId] ? 'none' : '';
  });
  const arrow = document.getElementById(`arrow-${catId}`);
  if (arrow) arrow.classList.toggle('open', !collapsedCats[catId]);
}

// ── BULK SELECT STATE ──
let bulkTab = 'd5'; // which tab the bulk action applies to

function openBulkPanel(tab, catId) {
  bulkTab = tab;
  const panel = document.getElementById('bulk-action-panel');
  panel.dataset.catId = catId || '';
  panel.dataset.tab = tab;
  panel.style.display = 'flex';
}

function closeBulkPanel() {
  document.getElementById('bulk-action-panel').style.display = 'none';
  // Uncheck all
  document.querySelectorAll('.row-cb:checked, .cat-cb:checked').forEach(cb => cb.checked = false);
  updateSelectAllState();
}

function applyBulkStatus(status, targetTab) {
  // targetTab: 'd5' or 'd1' — which column group to update
  const tab = targetTab || 'd5';

  // Collect checked row checkboxes — one per item row
  const checked = [...document.querySelectorAll('.row-cb:checked')];
  if (checked.length === 0) {
    document.getElementById('bulk-count-label').textContent = 'No items selected';
    return;
  }

  const entryCount = getEntries().length;

  checked.forEach(cb => {
    const itemId = cb.dataset.itemId;
    // Apply to ALL entry columns for this item
    for (let ei = 0; ei < entryCount; ei++) {
      ensurePath(tab);
      const key = ei === 0 ? itemId : `${itemId}_e${ei}`;
      userChecklist[selectedCampaignId][tab][key] = {
        ...(userChecklist[selectedCampaignId][tab][key] || {}), status
      };
      const sel = document.getElementById(`sel-${tab}-${itemId}-${ei}`);
      if (sel) {
        sel.value = status;
        sel.className = `status-sel ${statusClass(status)}`;
      }
    }
  });

  updateUserProgress();
  saveChecklist();
  // Keep panel open so user can also set D-1 after D-5 without re-selecting
  document.getElementById('bulk-count-label').textContent =
    `${checked.length} item${checked.length > 1 ? 's' : ''} selected — ${tab.toUpperCase()} updated ✓`;
}

function toggleSelectAll(masterCb) {
  const checked = masterCb.checked;
  document.querySelectorAll('.row-cb').forEach(cb => {
    cb.checked = checked;
  });
  document.querySelectorAll('.cat-cb').forEach(cb => {
    cb.checked = checked;
  });
  updateBulkBar();
}

function toggleCatCheckboxes(catCb, catId) {
  const checked = catCb.checked;
  document.querySelectorAll(`.row-cb[data-cat="${catId}"]`).forEach(cb => {
    cb.checked = checked;
  });
  updateSelectAllState();
  updateBulkBar();
}

// Bulk-apply a status to all items in a category for D-5 or D-1
// Show a small status-picker popup anchored to the category checkbox
function toggleCatD5(cb, catId, entryIdx) {
  if (!cb.checked) { cb.checked = false; return; } // unchecking does nothing
  showCatStatusPicker(cb, catId, entryIdx, 'd5');
}

function toggleCatD1(cb, catId, entryIdx) {
  if (!cb.checked) { cb.checked = false; return; }
  showCatStatusPicker(cb, catId, entryIdx, 'd1');
}

function showCatStatusPicker(anchorCb, catId, entryIdx, tab) {
  // Remove any existing picker
  const existing = document.getElementById('cat-status-picker');
  if (existing) existing.remove();

  // Tick all row checkboxes in this category+tab so user sees bulk scope
  const rowCbs = [...document.querySelectorAll(`.row-cb[data-cat="${catId}"][data-tab="${tab}"][data-entry-idx="${entryIdx}"]`)];
  rowCbs.forEach(cb => { cb.checked = true; });

  const resetRowCbs = () => rowCbs.forEach(cb => { cb.checked = false; });

  const statuses = [
    { v: 'done',        l: 'Done',        cls: 'csp-done' },
    { v: 'in-progress', l: 'In Progress', cls: 'csp-progress' },
    { v: '',            l: 'Pending',     cls: 'csp-pending' },
    { v: 'na',          l: 'N/A',         cls: 'csp-na' },
  ];

  const picker = document.createElement('div');
  picker.id = 'cat-status-picker';

  // Label at top of picker
  const label = document.createElement('div');
  label.textContent = `Bulk set ${tab.toUpperCase()} — ${catId.replace(/_/g,' ')}`;
  label.style.cssText = 'font-size:10px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.05em;padding:2px 4px 6px;border-bottom:1px solid rgba(255,255,255,0.12);margin-bottom:4px;white-space:nowrap;';
  picker.appendChild(label);

  picker.style.cssText = `
    position:fixed;z-index:9999;background:#1B3A6B;border:1px solid rgba(255,255,255,0.2);
    border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;
    box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:140px;
  `;

  statuses.forEach(s => {
    const btn = document.createElement('button');
    btn.textContent = s.l;
    btn.className = 'csp-btn ' + s.cls;
    btn.onclick = () => {
      applyCatStatus(catId, entryIdx, tab, s.v);
      picker.remove();
      anchorCb.checked = false;
      resetRowCbs();
      document.removeEventListener('mousedown', dismiss);
    };
    picker.appendChild(btn);
  });

  // Cancel on outside click
  const dismiss = (e) => {
    if (!picker.contains(e.target) && e.target !== anchorCb) {
      picker.remove();
      anchorCb.checked = false;
      resetRowCbs();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

  // Position near the checkbox
  document.body.appendChild(picker);
  const rect = anchorCb.getBoundingClientRect();
  const ph = picker.offsetHeight || 160;
  const pw = picker.offsetWidth  || 150;
  let top  = rect.bottom + 6;
  let left = rect.left - 4;
  if (top + ph > window.innerHeight) top = rect.top - ph - 6;
  if (left + pw > window.innerWidth)  left = rect.right - pw;
  picker.style.top  = top  + 'px';
  picker.style.left = left + 'px';
}

function applyCatStatus(catId, entryIdx, tab, status) {
  const selector = `.row-cb[data-cat="${catId}"][data-tab="${tab}"][data-entry-idx="${entryIdx}"]`;
  const items = [...document.querySelectorAll(selector)];
  items.forEach(rowCb => {
    const itemId = rowCb.dataset.itemId;
    const ei = parseInt(rowCb.dataset.entryIdx);
    ensurePath(tab);
    const key = ei === 0 ? itemId : `${itemId}_e${ei}`;
    userChecklist[selectedCampaignId][tab][key] = {
      ...(userChecklist[selectedCampaignId][tab][key] || {}), status
    };
    const sel = document.getElementById(`sel-${tab}-${itemId}-${ei}`);
    if (sel) { sel.value = status; sel.className = `status-sel ${statusClass(status)}`; }
  });
  updateUserProgress();
  saveChecklist();
}

function onRowCbChange() {
  updateSelectAllState();
  updateBulkBar();
}

function updateSelectAllState() {
  const all   = [...document.querySelectorAll('.row-cb')];
  const allCh = all.every(cb => cb.checked);
  const someCh = all.some(cb => cb.checked);
  const master = document.getElementById('select-all-cb');
  if (master) {
    master.checked       = allCh;
    master.indeterminate = !allCh && someCh;
  }
  // Per-cat
  document.querySelectorAll('.cat-cb').forEach(catCb => {
    const catId = catCb.dataset.catId;
    const catRows = [...document.querySelectorAll(`.row-cb[data-cat="${catId}"]`)];
    catCb.checked       = catRows.every(cb => cb.checked);
    catCb.indeterminate = !catCb.checked && catRows.some(cb => cb.checked);
  });
}

function updateBulkBar() {
  const checked = [...document.querySelectorAll('.row-cb:checked')];
  const bar     = document.getElementById('bulk-action-panel');
  if (checked.length > 0) {
    bar.style.display = 'flex';
    document.getElementById('bulk-count-label').textContent = `${checked.length} item${checked.length > 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

// ── Main render ──
function renderUserChecklist() {
  if (!selectedCampaignId) return;

  const campData   = userChecklist[selectedCampaignId] || {};
  const d5Data     = campData.d5 || {};
  const d1Data     = campData.d1 || {};
  const entries    = getEntries();
  const entryCount = entries.length;

  const container = document.getElementById('user-checklist');

  // Bulk action bar (floating)
  let html = `
  <div id="bulk-action-panel" style="display:none;position:sticky;top:0;z-index:50;
    background:var(--navy);color:white;padding:10px 16px;border-radius:var(--radius);
    margin-bottom:10px;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 4px 16px rgba(27,58,107,0.3);">
    <span id="bulk-count-label" style="font-size:13px;font-weight:600;min-width:100px;"></span>
    <div style="display:flex;align-items:center;gap:6px;border-left:1px solid rgba(255,255,255,0.2);padding-left:10px;">
      <span style="font-size:11px;font-weight:700;color:#93C5FD;letter-spacing:.05em;">D-5:</span>
      <button class="bulk-btn bulk-done"     onclick="applyBulkStatus('done','d5')">✓ Done</button>
      <button class="bulk-btn bulk-progress" onclick="applyBulkStatus('in-progress','d5')">⟳ In Progress</button>
      <button class="bulk-btn bulk-pending"  onclick="applyBulkStatus('','d5')">— Pending</button>
      <button class="bulk-btn bulk-na"       onclick="applyBulkStatus('na','d5')">N/A</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px;border-left:1px solid rgba(255,255,255,0.2);padding-left:10px;">
      <span style="font-size:11px;font-weight:700;color:#C4B5FD;letter-spacing:.05em;">D-1:</span>
      <button class="bulk-btn bulk-done"     onclick="applyBulkStatus('done','d1')">✓ Done</button>
      <button class="bulk-btn bulk-progress" onclick="applyBulkStatus('in-progress','d1')">⟳ In Progress</button>
      <button class="bulk-btn bulk-pending"  onclick="applyBulkStatus('','d1')">— Pending</button>
      <button class="bulk-btn bulk-na"       onclick="applyBulkStatus('na','d1')">N/A</button>
    </div>
    <button class="bulk-btn bulk-cancel" onclick="closeBulkPanel()" style="margin-left:auto;">✕ Cancel</button>
  </div>`;

  html += `<div class="checklist-table-wrap"><div class="cl-scroll"><table class="cl-table">`;

  // ── THEAD row 1 ──
  html += `<thead><tr>
    <th class="col-freeze-item" rowspan="2" style="min-width:44px;width:44px;">
      <span class="th-inner" style="display:flex;align-items:center;justify-content:center;">
        <input type="checkbox" id="select-all-cb" class="bulk-master-cb" onchange="toggleSelectAll(this)" title="Select all" />
      </span>
    </th>
    <th class="col-freeze-item2" rowspan="2"><span class="th-inner">Item</span></th>
    <th class="col-freeze-guide" rowspan="2"><span class="th-inner">Guide Questions</span></th>`;

  entries.forEach((e, i) => {
    const labelVal = buildEntryLabel(e, i);
    html += `<th colspan="5" class="entry-group-header" style="border-left:3px solid rgba(255,255,255,0.3);">
      <span class="th-inner" style="display:flex;align-items:center;gap:8px;justify-content:center;">
        <input type="text" id="entry-label-${i}" placeholder="Entry ${i+1}"
          value="${escHtml(labelVal)}"
          oninput="updateEntryLabel(${i},this.value)"
          style="font-size:13px;font-weight:600;padding:4px 12px;border:1px solid rgba(255,255,255,0.3);border-radius:6px;background:rgba(255,255,255,0.12);color:white;font-family:var(--font);text-align:center;min-width:160px;max-width:260px;" />
        ${i > 0 ? `<button onclick="removeEntry(${i})" title="Remove entry" style="background:rgba(239,68,68,0.25);border:1px solid rgba(239,68,68,0.4);color:#FCA5A5;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;flex-shrink:0;">✕</button>` : ''}
      </span>
    </th>`;
  });

  html += `<th rowspan="2" style="vertical-align:bottom;padding-bottom:4px;background:var(--navy);">
    <span class="th-inner">
      <button class="btn-add-entry" onclick="addEntry()">+ Add entry</button>
    </span>
  </th>`;
  html += `</tr>`;

  // ── THEAD row 2: D-5 [☐] Status | D-1 [☐] Status | Notes (shared) ──
  html += `<tr class="sub-head">`;
  entries.forEach((e, i) => {
    const borderL = 'border-left:3px solid rgba(255,255,255,0.3)';
    html += `
    <th class="sub-head sub-head-cb-col d5-zone" style="${borderL};">
      <span class="th-inner" style="display:flex;align-items:center;justify-content:center;padding:6px 2px;">
        <span class="sub-day-pill d5-pill">D-5</span>
      </span>
    </th>
    <th class="sub-head d5-zone sub-head-status-col">
      <span class="th-inner" style="display:block;padding:6px 10px;text-align:center;font-size:11px;font-weight:600;color:#DBEAFE;letter-spacing:.04em;text-transform:uppercase;">Status</span>
    </th>
    <th class="sub-head sub-head-cb-col d1-zone">
      <span class="th-inner" style="display:flex;align-items:center;justify-content:center;padding:6px 2px;">
        <span class="sub-day-pill d1-pill">D-1</span>
      </span>
    </th>
    <th class="sub-head d1-zone sub-head-status-col">
      <span class="th-inner" style="display:block;padding:6px 10px;text-align:center;font-size:11px;font-weight:600;color:#EDE9FE;letter-spacing:.04em;text-transform:uppercase;">Status</span>
    </th>
    <th class="sub-head sub-head-notes-col" style="background:var(--navy)!important;">
      <span class="th-inner" style="display:block;padding:6px 8px;text-align:center;font-size:11px;color:#BFDBFE;">Notes</span>
    </th>`;
  });
  html += `</tr></thead>`;

  // ── TBODY ──
  html += `<tbody>`;

  CHECKLIST_SECTIONS.forEach(sec => {
    const isOpen    = !collapsedCats[sec.id];
    const totalCols = 3 + entryCount * 4 + 1; // +1 for checkbox col, +1 for item name

    // Build per-entry D-5 and D-1 cat checkboxes plus a shared notes empty td
    let catEntryCells = '';
    for (let ei = 0; ei < entryCount; ei++) {
      const borderL = ei === 0 ? 'border-left:2px solid rgba(255,255,255,0.2)' : '';
      catEntryCells += `
        <td style="padding:4px 8px;text-align:center;background:var(--navy);${borderL}">
          <input type="checkbox" class="cat-d5-cb" data-cat-id="${sec.id}" data-entry-idx="${ei}"
            onchange="toggleCatD5(this,'${sec.id}',${ei})" title="Click to bulk-set D-5 status for this category"
            style="width:14px;height:14px;cursor:pointer;accent-color:#93C5FD;" />
        </td>
        <td style="padding:4px 6px;background:var(--navy);"></td>
        <td style="padding:4px 8px;text-align:center;background:var(--navy);">
          <input type="checkbox" class="cat-d1-cb" data-cat-id="${sec.id}" data-entry-idx="${ei}"
            onchange="toggleCatD1(this,'${sec.id}',${ei})" title="Click to bulk-set D-1 status for this category"
            style="width:14px;height:14px;cursor:pointer;accent-color:#C4B5FD;" />
        </td>
        <td style="padding:4px 6px;background:var(--navy);"></td>
        <td style="background:var(--navy);"></td>`;
    }

    html += `<tr class="cat-header">
      <td style="padding:6px 8px;text-align:center;">
        <input type="checkbox" class="cat-cb bulk-cat-cb" data-cat-id="${sec.id}"
          onchange="toggleCatCheckboxes(this,'${sec.id}')" title="Select all rows in category" />
      </td>
      <td class="col-freeze-item2" colspan="1" onclick="toggleCat('${sec.id}')" style="cursor:pointer;">
        <span class="cat-toggle-arrow ${isOpen ? 'open' : ''}" id="arrow-${sec.id}">&#9658;</span>
        ${sec.title}
        <span style="font-weight:400;opacity:0.7;font-size:10px">(${sec.items.length})</span>
      </td>
      <td class="col-freeze-guide" onclick="toggleCat('${sec.id}')"></td>
      ${catEntryCells}
      <td></td>
    </tr>`;

    sec.items.forEach(item => {
      const displayStyle = isOpen ? '' : 'display:none';
      html += `<tr class="item-row" data-cat="${sec.id}" style="${displayStyle}">
        <td style="padding:6px 8px;text-align:center;background:var(--surface);">
          <input type="checkbox" class="row-cb" data-item-id="${item.id}" data-cat="${sec.id}" data-entry-idx="0" data-tab="d5"
            onchange="onRowCbChange()" />
        </td>
        <td class="col-freeze-item2" style="font-size:12px;font-weight:500;line-height:1.4">${item.name}</td>
        <td class="col-freeze-guide" style="font-size:11px;color:var(--text-muted);line-height:1.4">${item.guide}</td>`;

      entries.forEach((_, ei) => {
        const d5key  = ei === 0 ? item.id : `${item.id}_e${ei}`;
        const d5val  = (d5Data[d5key] || {}).status || '';
        const d1val  = (d1Data[d5key] || {}).status || '';
        const sharedNote = escHtml((d1Data[d5key] || {}).note || (d5Data[d5key] || {}).note || '');
        const borderL = ei === 0 ? 'border-left:2px solid var(--border-strong)' : '';

        html += `
        <td class="d5-cb-col" style="${borderL};">
          <input type="checkbox" class="row-cb" data-item-id="${item.id}" data-cat="${sec.id}" data-entry-idx="${ei}" data-tab="d5"
            onchange="onRowCbChange()" />
        </td>
        <td style="background:rgba(37,99,235,0.04);padding:4px 6px;">
          <select class="status-sel ${statusClass(d5val)}" id="sel-d5-${item.id}-${ei}"
            onchange="handleStatusChange('${item.id}','d5',${ei},this)">
            ${statusOptions(d5val)}
          </select>
        </td>
        <td class="d1-cb-col">
          <input type="checkbox" class="row-cb" data-item-id="${item.id}" data-cat="${sec.id}" data-entry-idx="${ei}" data-tab="d1"
            onchange="onRowCbChange()" />
        </td>
        <td style="background:rgba(124,58,237,0.04);padding:4px 6px;">
          <select class="status-sel ${statusClass(d1val)}" id="sel-d1-${item.id}-${ei}"
            onchange="handleStatusChange('${item.id}','d1',${ei},this)">
            ${statusOptions(d1val)}
          </select>
        </td>
        <td style="padding:4px 6px;">
          <input class="note-input" type="text" placeholder="Notes…" value="${sharedNote}"
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
    { v: '',            l: 'Pending' },
    { v: 'done',        l: 'Done' },
    { v: 'in-progress', l: 'In Progress' },
    { v: 'na',          l: 'N/A' },
  ];
  return opts.map(o => `<option value="${o.v}" ${current === o.v ? 'selected' : ''}>${o.l}</option>`).join('');
}

function statusClass(status) {
  return { done: 's-done', 'in-progress': 's-progress', na: 's-na', '': 's-pending' }[status] || 's-pending';
}

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
//  ══════════════ CAMPAIGN CALENDAR ══════════════
// ─────────────────────────────────────────────────────────────
// Shared entries: /settings/calendar  → { entries: [...] }
// Personal entries: /calendarPersonal/{uid} → { entries: [...] }
//
// Shared entry: { id, title, date, endDate, type, campaignId, description, color, createdBy, assignedUids }
//   assignedUids: [] means visible to ALL assigned members; non-empty means only those UIDs + admin
// Personal entry: { id, title, date, endDate, type, description, color }

const CAL_ENTRY_TYPES = [
  { id: 'teasing',   label: 'Teasing',      color: '#7C3AED' },
  { id: 'dday',      label: 'D-Day',        color: '#DC2626' },
  { id: 'deadline',  label: 'Deadline',     color: '#D97706' },
  { id: 'meeting',   label: 'Meeting',      color: '#2563EB' },
  { id: 'milestone', label: 'Milestone',    color: '#059669' },
  { id: 'other',     label: 'Other',        color: '#64748B' },
];

let calCurrentMonth = new Date().getMonth();
let calCurrentYear  = new Date().getFullYear();
let calEditingEntry = null; // { entry, isPersonal }

async function loadCalendarEntries() {
  try {
    const doc = await db.collection('settings').doc('calendar').get();
    calendarEntries = doc.exists ? (doc.data().entries || []) : [];
  } catch(e) { calendarEntries = []; }
}

async function loadPersonalCalendarEntries(uid) {
  try {
    const doc = await db.collection('calendarPersonal').doc(uid).get();
    personalCalendarEntries = doc.exists ? (doc.data().entries || []) : [];
  } catch(e) { personalCalendarEntries = []; }
}

async function saveCalendarEntries() {
  await db.collection('settings').doc('calendar').set({ entries: calendarEntries });
}

async function savePersonalCalendarEntries() {
  if (!currentUser) return;
  await db.collection('calendarPersonal').doc(currentUser.uid).set({ entries: personalCalendarEntries });
}

function getVisibleSharedEntries() {
  if (!currentUser) return calendarEntries;
  if (currentUser.role === 'admin') return calendarEntries;
  // Members: see shared entries assigned to all, or specifically to them
  return calendarEntries.filter(e => {
    if (!e.assignedUids || e.assignedUids.length === 0) return true;
    return e.assignedUids.includes(currentUser.uid);
  });
}

function renderCalendarView(targetEl) {
  const wrap = targetEl || document.getElementById('user-calendar-view');
  if (!wrap) return;

  const now        = new Date();
  const year       = calCurrentYear;
  const month      = calCurrentMonth;
  const firstDay   = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName  = new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  const sharedVisible = getVisibleSharedEntries();
  // Admin sees all shared entries; members see only their personal ones
  const personalVisible = currentUser?.role !== 'admin' ? personalCalendarEntries : [];

  // Build day → entries map
  const dayMap = {};
  const allVisible = [
    ...sharedVisible.map(e => ({ ...e, _type: 'shared' })),
    ...personalVisible.map(e => ({ ...e, _type: 'personal' })),
  ];

  allVisible.forEach(entry => {
    const start = entry.date ? new Date(entry.date) : null;
    const end   = entry.endDate ? new Date(entry.endDate) : start;
    if (!start) return;
    // Enumerate each day in range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!dayMap[key]) dayMap[key] = [];
      dayMap[key].push(entry);
    }
  });

  const isAdmin   = currentUser?.role === 'admin';
  const canAddPersonal = !isAdmin;

  let html = `
  <div class="cal-wrap">
    <div class="cal-header">
      <div class="cal-nav">
        <button class="cal-nav-btn" onclick="calNav(-1)">&#8592;</button>
        <span class="cal-month-label">${monthName}</span>
        <button class="cal-nav-btn" onclick="calNav(1)">&#8594;</button>
        <button class="cal-nav-btn" onclick="calGoToday()" style="font-size:11px;padding:4px 10px;">Today</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="cal-legend">
          ${CAL_ENTRY_TYPES.map(t => `<span class="cal-legend-dot" style="background:${t.color}"></span><span style="font-size:11px;color:var(--text-muted)">${t.label}</span>`).join('')}
          ${canAddPersonal ? `<span class="cal-legend-dot" style="background:#94A3B8;border:2px dashed #64748B;box-sizing:border-box;"></span><span style="font-size:11px;color:var(--text-muted)">My Events</span>` : ''}
        </div>
        ${isAdmin ? `<button class="btn-outline" style="background:var(--blue);border-color:var(--blue);font-size:12px;" onclick="openCalEntryModal(null,false)">+ Add Event</button>` : ''}
        ${canAddPersonal ? `<button class="btn-outline" style="background:#475569;border-color:#475569;font-size:12px;" onclick="openCalEntryModal(null,true)">+ My Event</button>` : ''}
      </div>
    </div>

    <div class="cal-grid-wrap">
      <div class="cal-weekdays">
        ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div class="cal-wd">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">`;

  // Leading empty cells
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day cal-day-empty"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = (d === now.getDate() && month === now.getMonth() && year === now.getFullYear());
    const key     = `${year}-${month}-${d}`;
    const dayEntries = dayMap[key] || [];

    html += `<div class="cal-day ${isToday ? 'cal-day-today' : ''}">
      <div class="cal-day-num ${isToday ? 'cal-today-num' : ''}">${d}</div>
      <div class="cal-day-events">`;

    dayEntries.slice(0, 3).forEach(entry => {
      const typeInfo = CAL_ENTRY_TYPES.find(t => t.id === entry.type) || CAL_ENTRY_TYPES[5];
      const col      = entry._type === 'personal' ? '#94A3B8' : (entry.color || typeInfo.color);
      const border   = entry._type === 'personal' ? '2px dashed #64748B' : 'none';
      const isEditable = isAdmin || (entry._type === 'personal');
      html += `<div class="cal-event" style="background:${col}20;border-left:3px solid ${col};border:${border};"
        onclick="${isEditable ? `openCalEntryModal('${entry.id}',${entry._type === 'personal'})` : ''}"
        title="${escHtml(entry.title)}${entry._type === 'personal' ? ' (My Event)' : ''}">
        <span style="color:${col};font-size:10px;font-weight:600;">${escHtml(entry.title)}</span>
      </div>`;
    });
    if (dayEntries.length > 3) {
      html += `<div class="cal-event-more" onclick="openCalDayModal('${year}-${month+1}-${String(d).padStart(2,'0')}')">+${dayEntries.length - 3} more</div>`;
    }

    html += `</div></div>`;
  }

  html += `</div></div>`; // cal-grid, cal-grid-wrap

  // Upcoming events list
  const upcomingCutoff = new Date(); upcomingCutoff.setHours(0,0,0,0);
  const upcoming = [...allVisible]
    .filter(e => e.date && new Date(e.date) >= upcomingCutoff)
    .sort((a,b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8);

  if (upcoming.length > 0) {
    html += `<div class="cal-upcoming">
      <div class="section-label" style="margin-bottom:10px;">Upcoming</div>
      <div class="cal-upcoming-list">`;
    upcoming.forEach(entry => {
      const typeInfo = CAL_ENTRY_TYPES.find(t => t.id === entry.type) || CAL_ENTRY_TYPES[5];
      const col = entry._type === 'personal' ? '#94A3B8' : (entry.color || typeInfo.color);
      const dateStr = new Date(entry.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', weekday: 'short' });
      const isEditable = isAdmin || (entry._type === 'personal');
      html += `<div class="cal-upcoming-item" style="border-left:3px solid ${col};"
        ${isEditable ? `onclick="openCalEntryModal('${entry.id}',${entry._type === 'personal'})" style="border-left:3px solid ${col};cursor:pointer;"` : ''}>
        <div class="cal-upcoming-date">${dateStr}</div>
        <div class="cal-upcoming-title">${escHtml(entry.title)}</div>
        ${entry.description ? `<div class="cal-upcoming-desc">${escHtml(entry.description)}</div>` : ''}
        ${entry._type === 'personal' ? '<span class="cal-personal-badge">My Event</span>' : ''}
        <span class="cal-type-badge" style="background:${col}20;color:${col};">${typeInfo.label}</span>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`; // cal-wrap

  wrap.innerHTML = html;
}

function getCalTarget() {
  // If the admin calendar tab is visible, render into its host; otherwise user view
  const adminHost = document.getElementById('admin-calendar-host');
  if (adminHost && adminHost.offsetParent !== null) return adminHost;
  return document.getElementById('user-calendar-view');
}

function calNav(dir) {
  calCurrentMonth += dir;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  if (calCurrentMonth < 0)  { calCurrentMonth = 11; calCurrentYear--; }
  renderCalendarView(getCalTarget());
}

function calGoToday() {
  const now = new Date();
  calCurrentMonth = now.getMonth();
  calCurrentYear  = now.getFullYear();
  renderCalendarView(getCalTarget());
}

// ── Calendar Entry Modal ──
function openCalEntryModal(entryId, isPersonal) {
  calEditingEntry = null;

  const isAdmin = currentUser?.role === 'admin';

  if (entryId) {
    const list = isPersonal ? personalCalendarEntries : calendarEntries;
    const found = list.find(e => e.id === entryId);
    if (found) calEditingEntry = { entry: found, isPersonal };
  }

  const entry = calEditingEntry?.entry || {};
  const personalMode = isPersonal || (!isAdmin && !entryId);

  // Populate member assign list (for admin shared entries)
  let memberAssignHtml = '';
  if (isAdmin && !isPersonal) {
    const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
    memberAssignHtml = `
    <div class="field">
      <label>Visible to (leave all unchecked = all members)</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);max-height:100px;overflow-y:auto;">
        ${nonAdmins.map(m => {
          const checked = entry.assignedUids && entry.assignedUids.includes(m.uid) ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;padding:3px 8px;border:1px solid var(--border);border-radius:99px;background:var(--surface);">
            <input type="checkbox" class="cal-member-cb" value="${m.uid}" ${checked} />
            ${escHtml(m.name || m.username)}
          </label>`;
        }).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Unchecked = visible to all tagged members</div>
    </div>`;
  }

  // Campaign link (admin only)
  let campLinkHtml = '';
  if (isAdmin) {
    campLinkHtml = `
    <div class="field">
      <label>Link to Campaign (optional)</label>
      <select id="cal-entry-campaign">
        <option value="">No campaign</option>
        ${Object.values(campaigns).map(c =>
          `<option value="${c.id}" ${entry.campaignId === c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
        ).join('')}
      </select>
    </div>`;
  }

  document.getElementById('cal-modal-title').textContent = entryId ? (personalMode ? 'Edit My Event' : 'Edit Event') : (personalMode ? 'Add My Event' : 'Add Event');
  document.getElementById('cal-entry-title-input').value   = entry.title || '';
  document.getElementById('cal-entry-date').value          = entry.date || '';
  document.getElementById('cal-entry-enddate').value       = entry.endDate || '';
  document.getElementById('cal-entry-type').value          = entry.type || 'milestone';
  document.getElementById('cal-entry-desc').value          = entry.description || '';
  document.getElementById('cal-entry-personal-mode').value = personalMode ? '1' : '0';
  document.getElementById('cal-member-assign-wrap').innerHTML = memberAssignHtml;
  document.getElementById('cal-camp-link-wrap').innerHTML     = campLinkHtml;
  document.getElementById('cal-entry-error').style.display    = 'none';

  const deleteBtn = document.getElementById('cal-delete-btn');
  deleteBtn.style.display = entryId ? 'inline-flex' : 'none';

  document.getElementById('cal-entry-overlay').style.display = 'flex';
}

function closeCalEntryModal(e) {
  if (e && e.target !== document.getElementById('cal-entry-overlay')) return;
  document.getElementById('cal-entry-overlay').style.display = 'none';
}

async function saveCalEntry() {
  const title    = document.getElementById('cal-entry-title-input').value.trim();
  const date     = document.getElementById('cal-entry-date').value;
  const endDate  = document.getElementById('cal-entry-enddate').value;
  const type     = document.getElementById('cal-entry-type').value;
  const desc     = document.getElementById('cal-entry-desc').value.trim();
  const personalMode = document.getElementById('cal-entry-personal-mode').value === '1';
  const errEl    = document.getElementById('cal-entry-error');
  errEl.style.display = 'none';

  if (!title) { showError(errEl, 'Title is required.'); return; }
  if (!date)  { showError(errEl, 'Start date is required.'); return; }

  const typeInfo = CAL_ENTRY_TYPES.find(t => t.id === type) || CAL_ENTRY_TYPES[5];

  // Gather assigned UIDs (admin shared only)
  let assignedUids = [];
  if (!personalMode && currentUser?.role === 'admin') {
    assignedUids = [...document.querySelectorAll('.cal-member-cb:checked')].map(cb => cb.value);
  }

  const campaignEl = document.getElementById('cal-entry-campaign');
  const campaignId = campaignEl ? campaignEl.value : '';

  const entryData = {
    title, date,
    endDate: endDate || date,
    type,
    description: desc,
    color: typeInfo.color,
    assignedUids,
    campaignId: campaignId || null,
    createdBy: currentUser?.uid || '',
    updatedAt: new Date().toISOString(),
  };

  try {
    if (personalMode) {
      if (calEditingEntry && calEditingEntry.isPersonal) {
        const idx = personalCalendarEntries.findIndex(e => e.id === calEditingEntry.entry.id);
        if (idx >= 0) personalCalendarEntries[idx] = { ...personalCalendarEntries[idx], ...entryData };
      } else {
        personalCalendarEntries.push({ id: `pce_${Date.now()}`, ...entryData });
      }
      await savePersonalCalendarEntries();
    } else {
      if (calEditingEntry && !calEditingEntry.isPersonal) {
        const idx = calendarEntries.findIndex(e => e.id === calEditingEntry.entry.id);
        if (idx >= 0) calendarEntries[idx] = { ...calendarEntries[idx], ...entryData };
      } else {
        calendarEntries.push({ id: `ce_${Date.now()}`, ...entryData });
      }
      await saveCalendarEntries();
    }
    document.getElementById('cal-entry-overlay').style.display = 'none';
    renderCalendarView(getCalTarget());
  } catch(e) { showError(errEl, 'Failed to save. Try again.'); console.error(e); }
}

async function deleteCalEntry() {
  if (!calEditingEntry) return;
  if (!confirm('Delete this event?')) return;
  try {
    if (calEditingEntry.isPersonal) {
      personalCalendarEntries = personalCalendarEntries.filter(e => e.id !== calEditingEntry.entry.id);
      await savePersonalCalendarEntries();
    } else {
      calendarEntries = calendarEntries.filter(e => e.id !== calEditingEntry.entry.id);
      await saveCalendarEntries();
    }
    document.getElementById('cal-entry-overlay').style.display = 'none';
    renderCalendarView(getCalTarget());
  } catch(e) { alert('Failed to delete event.'); }
}

// Admin calendar view (inside admin screen)
function switchAdminTab(tab) {
  document.getElementById('admin-tab-progress').style.display = tab === 'progress' ? 'block' : 'none';
  document.getElementById('admin-tab-calendar').style.display = tab === 'calendar'  ? 'block' : 'none';
  document.getElementById('admin-tab-data').style.display     = tab === 'data'      ? 'block' : 'none';
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('atab-' + tab);
  if (btn) btn.classList.add('active');
  if (tab === 'calendar') {
    renderCalendarView(document.getElementById('admin-calendar-host'));
  }
  if (tab === 'data') {
    renderDataTab();
  }
}

async function renderDataTab() {
  // ── Campaigns list ──
  const campEl = document.getElementById('data-campaigns-list');
  const campList = Object.values(campaigns);
  if (campList.length === 0) {
    campEl.innerHTML = '<div class="data-empty">No campaigns yet.</div>';
  } else {
    campEl.innerHTML = campList.map(c => {
      const assignedNames = (c.assignedUids || []).map(uid => {
        const m = members[uid];
        return m ? (m.name || m.username) : uid;
      }).join(', ') || '—';
      return `
        <div class="data-list-row">
          <div>
            <div class="data-row-title">${escHtml(c.name)}</div>
            <div class="data-row-sub">Members: ${escHtml(assignedNames)}</div>
          </div>
        </div>`;
    }).join('');
  }

  // ── Members list ──
  const membEl = document.getElementById('data-members-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  if (nonAdmins.length === 0) {
    membEl.innerHTML = '<div class="data-empty">No members yet.</div>';
  } else {
    membEl.innerHTML = nonAdmins.map(m => `
      <div class="data-list-row">
        <div>
          <div class="data-row-title">${escHtml(m.name || m.username)}</div>
          <div class="data-row-sub">@${escHtml(m.username)}</div>
        </div>
        <button class="btn-ghost-light btn-sm" style="color:#FCA5A5;border-color:#FCA5A5;"
          onclick="deleteMember('${m.uid}','${(m.name||m.username).replace(/'/g,"\'")}')">Remove</button>
      </div>`).join('');
  }

  // ── Checklists list ──
  const clEl = document.getElementById('data-checklists-list');
  try {
    const checkSnap = await db.collection('checklists').get();
    const allChecklists = {};
    checkSnap.forEach(doc => { allChecklists[doc.id] = doc.data(); });

    let rows = [];
    Object.values(campaigns).forEach(camp => {
      (camp.assignedUids || []).forEach(uid => {
        const member = members[uid];
        if (!member) return;
        const cl = (allChecklists[uid] || {})[camp.id] || {};
        const d5Done = countDone(cl.d5 || {});
        const d1Done = countDone(cl.d1 || {});
        rows.push({ member, camp, d5Done, d1Done, cl });
      });
    });

    if (rows.length === 0) {
      clEl.innerHTML = '<div class="data-empty">No checklist progress recorded yet.</div>';
    } else {
      clEl.innerHTML = `<table class="data-cl-table">
        <thead><tr>
          <th>Member</th><th>Campaign</th>
          <th>D-5</th><th>D-1</th><th>Last Active</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const d5Pct = Math.round((r.d5Done / TOTAL_ITEMS) * 100);
          const d1Pct = Math.round((r.d1Done / TOTAL_ITEMS) * 100);
          const lastStr = r.cl.lastActive
            ? new Date(r.cl.lastActive).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
            : '—';
          return `<tr>
            <td><strong>${escHtml(r.member.name || r.member.username)}</strong><br>
              <span style="font-size:11px;color:var(--text-muted)">@${escHtml(r.member.username)}</span></td>
            <td>${escHtml(r.camp.name)}</td>
            <td>${miniBar(d5Pct)} ${r.d5Done}/${TOTAL_ITEMS}</td>
            <td>${miniBar(d1Pct)} ${r.d1Done}/${TOTAL_ITEMS}</td>
            <td style="font-size:12px;color:var(--text-muted)">${lastStr}</td>
            <td style="white-space:nowrap;">
              <button class="btn-link" onclick="openReviewModal('${r.member.uid}','${r.camp.id}')">Review</button>
              <button class="btn-link" style="color:#DC2626;margin-left:8px;"
                onclick="openDeleteClModal('${r.member.uid}','${r.camp.id}','${(r.member.name||r.member.username).replace(/'/g,"\'")}')">Delete</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    }
  } catch(e) {
    clEl.innerHTML = '<div class="data-empty">Error loading checklist data.</div>';
  }
}

function renderAdminCalendarTab() {
  switchAdminTab('calendar');
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
//  BROADCAST SYSTEM
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
  const mSel = document.getElementById('broadcast-member-sel');
  mSel.innerHTML = '<option value="">All members</option>';
  Object.values(members).filter(m => m.role !== 'admin').forEach(m => {
    mSel.innerHTML += `<option value="${m.uid}">${m.name || m.username} (@${m.username})</option>`;
  });

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
  const msg    = document.getElementById('broadcast-message').value.trim();
  const uid    = document.getElementById('broadcast-member-sel').value;
  const campId = document.getElementById('broadcast-campaign-sel').value;
  const errEl  = document.getElementById('broadcast-error');
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
      .orderBy('sentAt', 'desc').limit(30).get();

    if (snap.empty) {
      list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">No broadcasts yet.</div>';
      return;
    }

    const uid = currentUser?.uid;
    const unreadIds = [];

    let html = '';
    snap.forEach(doc => {
      const b = doc.data();
      if (b.targetUid && b.targetUid !== uid) return;
      const isUnread = !b.readBy?.includes(uid);
      if (isUnread) unreadIds.push(doc.id);

      const typeIcon  = { shoutout: '🏆', nudge: '⏰', custom: '📢' }[b.type] || '📣';
      const typeColor = { shoutout: '#059669', nudge: '#D97706', custom: '#2563EB' }[b.type] || '#64748B';
      const timeStr   = new Date(b.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const campTag   = b.campaignName ? `<span class="bcast-tag">${b.campaignName}</span>` : '';
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
    const snap = await db.collection('broadcasts').orderBy('sentAt', 'desc').limit(50).get();
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
  if (count > 0) { badge.textContent = count; badge.style.display = 'block'; }
  else { badge.style.display = 'none'; }
}

// ═════════════════════════════════════════════════════════════
//  CHECKLIST ITEM EDITOR
// ═════════════════════════════════════════════════════════════
let editorSections = [];

async function loadChecklistOverrides() {
  try {
    const doc = await db.collection('settings').doc('checklist').get();
    if (doc.exists && doc.data().sections) {
      const saved = doc.data().sections;
      CHECKLIST_SECTIONS.length = 0;
      saved.forEach(s => CHECKLIST_SECTIONS.push(s));
      window._TOTAL_ITEMS_OVERRIDE = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
    }
  } catch(e) { console.warn('Could not load checklist overrides', e); }
}

function getTotalItems() {
  return window._TOTAL_ITEMS_OVERRIDE || TOTAL_ITEMS;
}

function openEditorModal() {
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
          oninput="editorSections[${idx}].items[${ii}].name = this.value" />
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
  for (const sec of editorSections) {
    if (!sec.title.trim()) { showError(errEl, 'All sections must have a title.'); return; }
    for (const item of sec.items) {
      if (!item.name.trim()) { showError(errEl, `Empty item name found in "${sec.title}". Please fill it in or delete the row.`); return; }
    }
  }

  try {
    await db.collection('settings').doc('checklist').set({ sections: editorSections });
    CHECKLIST_SECTIONS.length = 0;
    editorSections.forEach(s => CHECKLIST_SECTIONS.push(JSON.parse(JSON.stringify(s))));
    window._TOTAL_ITEMS_OVERRIDE = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
    document.getElementById('editor-overlay').style.display = 'none';
    if (selectedCampaignId) renderUserChecklist();
  } catch(e) { showError(errEl, 'Failed to save. Please try again.'); }
}

// ═════════════════════════════════════════════════════════════
//  BRAND REGISTRATION
// ═════════════════════════════════════════════════════════════
const CAMPAIGN_TYPES = [
  { id: 'mega',         label: '🔥 Mega',         color: '#DC2626' },
  { id: 'double_digit', label: '🔢 Double Digit',  color: '#7C3AED' },
  { id: 'mid_month',   label: '📅 Mid-Month',     color: '#0891B2' },
  { id: 'payday',      label: '💰 Payday',         color: '#059669' },
];

let brandRegData  = {};
let activeBrandTab = 'mega';

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

function addBrCamp()          { ensureBrData(activeBrandTab); brandRegData[activeBrandTab].campaigns.push(''); renderBrandRegContent(); }
function removeBrCamp(i)      { ensureBrData(activeBrandTab); brandRegData[activeBrandTab].campaigns.splice(i,1); renderBrandRegContent(); }
function updateBrCamp(i,val)  { ensureBrData(activeBrandTab); brandRegData[activeBrandTab].campaigns[i]=val; }
function addBrBrand() {
  ensureBrData(activeBrandTab);
  brandRegData[activeBrandTab].brands.push({ name:'', pic:'' });
  renderBrandRegContent();
  setTimeout(() => { const l=document.getElementById('br-brands-list'); if(l) l.scrollTop=l.scrollHeight; },50);
}
function removeBrBrand(i)            { ensureBrData(activeBrandTab); brandRegData[activeBrandTab].brands.splice(i,1); renderBrandRegContent(); }
function updateBrBrand(i,field,val)  {
  ensureBrData(activeBrandTab);
  if (typeof brandRegData[activeBrandTab].brands[i]==='string') brandRegData[activeBrandTab].brands[i]={name:brandRegData[activeBrandTab].brands[i],pic:''};
  brandRegData[activeBrandTab].brands[i][field]=val;
}

async function saveBrandRegistration() {
  const errEl = document.getElementById('brand-reg-error');
  try {
    await db.collection('settings').doc('brandRegistration').set(brandRegData);
    document.getElementById('brand-reg-overlay').style.display = 'none';
    renderBrandSummaryCards();
  } catch(e) { showError(errEl, 'Failed to save. Try again.'); }
}

function renderBrandSummaryCards() {
  const existingWrap = document.getElementById('brand-summary-row');
  if (!existingWrap) return;
  existingWrap.innerHTML = CAMPAIGN_TYPES.map(type => {
    const data  = brandRegData[type.id] || {};
    const count = (data.brands || []).length;
    const camps = (data.campaigns || []).filter(Boolean);
    return `
      <div class="brand-summary-card" onclick="openBrandDetailPopover('${type.id}')" style="cursor:pointer;">
        <div class="bsc-label">${type.label}</div>
        <div class="bsc-count" style="color:${type.color};">${count}</div>
        <div class="bsc-sub">brands registered</div>
        ${camps.length > 0 ? `<div class="bsc-camps">${camps.slice(0,2).map(c=>`<span class="bsc-camp-tag">${escHtml(c)}</span>`).join('')}${camps.length>2?`<span class="bsc-camp-tag">+${camps.length-2}</span>`:''}</div>` : ''}
      </div>
    `;
  }).join('');
}

function openBrandDetailPopover(typeId) {
  const type = CAMPAIGN_TYPES.find(t => t.id === typeId);
  const data = brandRegData[typeId] || {};
  const brands = data.brands || [];
  const camps = (data.campaigns || []).filter(Boolean);

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
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);">#</th>
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);">Brand</th>
            <th style="text-align:left;padding:6px 10px;background:var(--surface2);font-size:11px;color:var(--text-muted);">PIC</th>
          </tr></thead>
          <tbody>${brands.map((b,i)=>`<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:7px 10px;color:var(--text-muted);">${i+1}</td>
            <td style="padding:7px 10px;font-weight:500;">${escHtml(b.name||b)}</td>
            <td style="padding:7px 10px;color:var(--text-muted);">${escHtml(b.pic||'—')}</td>
          </tr>`).join('')}</tbody>
        </table>`
      }
    </div>
  `;
}

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
