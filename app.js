// ──────────────────────────────────────────
// STATE
// ──────────────────────────────────────────
let currentUser = null;   // { uid, username, name, role }
let campaigns   = {};     // { campaignId: { name, assignedUids, createdAt } }
let members     = {};     // { uid: { username, name, role } }
let userChecklist = {};
let activeTab = 'd5';
let selectedCampaignId = null;

// ──────────────────────────────────────────
// FIREBASE (Firestore only — no Auth)
// ──────────────────────────────────────────
const db = firebase.firestore();

// ──────────────────────────────────────────
// ADMIN CREDENTIALS (hardcoded)
// ──────────────────────────────────────────
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_UID      = 'admin';

// ──────────────────────────────────────────
// AUTH
// ──────────────────────────────────────────
async function handleLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!username || !password) {
    showError(errEl, 'Please enter your username and password.');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  try {
    // Check hardcoded admin first
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      currentUser = { uid: ADMIN_UID, username: ADMIN_USERNAME, name: 'Admin', role: 'admin' };
      sessionStorage.setItem('mcSession', JSON.stringify(currentUser));
      await loadAdminData();
      showScreen('admin-screen');
      return;
    }

    // Look up member in Firestore
    const snap = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snap.empty) {
      showError(errEl, 'Username not found.');
      return;
    }

    const doc  = snap.docs[0];
    const data = doc.data();

    if (data.password !== password) {
      showError(errEl, 'Incorrect password.');
      return;
    }

    currentUser = { uid: doc.id, username: data.username, name: data.name, role: 'member' };
    sessionStorage.setItem('mcSession', JSON.stringify(currentUser));
    await loadMemberData(doc.id);
    document.getElementById('user-name-display').textContent = data.name || data.username;
    showScreen('user-screen');

  } catch (e) {
    showError(errEl, 'Sign in failed. Please try again.');
    console.error(e);
  } finally {
    btn.textContent = 'Sign in';
    btn.disabled = false;
  }
}

function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('mcSession');
  showScreen('login-screen');
}

// Restore session on page load
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  const saved = sessionStorage.getItem('mcSession');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      if (currentUser.role === 'admin') {
        await loadAdminData();
        showScreen('admin-screen');
      } else {
        await loadMemberData(currentUser.uid);
        document.getElementById('user-name-display').textContent = currentUser.name || currentUser.username;
        showScreen('user-screen');
      }
    } catch (e) {
      sessionStorage.removeItem('mcSession');
      showScreen('login-screen');
    }
  } else {
    showScreen('login-screen');
  }
});

// ──────────────────────────────────────────
// DATA LOADING
// ──────────────────────────────────────────
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

// ──────────────────────────────────────────
// ADMIN VIEW
// ──────────────────────────────────────────
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
      const cl = (allChecklists[uid] || {})[camp.id] || {};
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
    <div class="stat-card"><div class="label">Total assignments</div><div class="value">${total}</div></div>
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
      <td><button class="btn-link" onclick="openDetailModal('${r.member.uid}','${r.camp.id}')">View</button></td>
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

// ──────────────────────────────────────────
// MEMBER MANAGEMENT MODAL
// ──────────────────────────────────────────
function openMemberModal() {
  renderMemberList();
  document.getElementById('new-member-username').value = '';
  document.getElementById('new-member-name').value = '';
  document.getElementById('new-member-password').value = '';
  document.getElementById('member-modal-error').style.display = 'none';
  document.getElementById('member-modal-overlay').style.display = 'flex';
}

function closeMemberModal(e) {
  if (e && e.target !== document.getElementById('member-modal-overlay')) return;
  document.getElementById('member-modal-overlay').style.display = 'none';
}

function renderMemberList() {
  const list = document.getElementById('existing-members-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  if (nonAdmins.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No members yet.</div>';
    return;
  }
  list.innerHTML = nonAdmins.map(m => `
    <div class="member-row" id="mrow-${m.uid}">
      <div>
        <strong>${m.name || m.username}</strong>
        <span style="color:var(--text-muted);font-size:12px;"> @${m.username}</span>
      </div>
      <button class="btn-ghost btn-sm" onclick="deleteMember('${m.uid}', '${m.name || m.username}')">Remove</button>
    </div>
  `).join('');
}

async function addMember() {
  const username = document.getElementById('new-member-username').value.trim().toLowerCase();
  const name     = document.getElementById('new-member-name').value.trim();
  const password = document.getElementById('new-member-password').value.trim();
  const errEl    = document.getElementById('member-modal-error');
  errEl.style.display = 'none';

  if (!username || !name || !password) {
    showError(errEl, 'All fields are required.'); return;
  }
  if (username === ADMIN_USERNAME) {
    showError(errEl, 'That username is reserved.'); return;
  }

  // Check uniqueness
  const existing = await db.collection('users').where('username', '==', username).limit(1).get();
  if (!existing.empty) {
    showError(errEl, 'Username already taken.'); return;
  }

  try {
    const ref = await db.collection('users').add({ username, name, password, role: 'member' });
    members[ref.id] = { uid: ref.id, username, name, password, role: 'member' };
    renderMemberList();
    document.getElementById('new-member-username').value = '';
    document.getElementById('new-member-name').value = '';
    document.getElementById('new-member-password').value = '';
  } catch (e) {
    showError(errEl, 'Failed to add member. Try again.');
  }
}

async function deleteMember(uid, displayName) {
  if (!confirm(`Remove ${displayName}? They will lose access immediately.`)) return;
  try {
    await db.collection('users').doc(uid).delete();
    delete members[uid];
    renderMemberList();
  } catch (e) {
    alert('Failed to remove member.');
  }
}

// ──────────────────────────────────────────
// CAMPAIGN MODAL
// ──────────────────────────────────────────
function openNewCampaignModal() {
  const list = document.getElementById('member-assign-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  list.innerHTML = nonAdmins.length === 0
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
  const name = document.getElementById('new-campaign-name').value.trim();
  const errEl = document.getElementById('modal-error');
  if (!name) { showError(errEl, 'Please enter a campaign name.'); return; }

  const selectedChips = document.querySelectorAll('#member-assign-list .member-chip.selected');
  const assignedUids  = [...selectedChips].map(c => c.dataset.uid);
  if (assignedUids.length === 0) { showError(errEl, 'Please assign at least one member.'); return; }

  try {
    await db.collection('campaigns').add({
      name,
      assignedUids,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: ADMIN_UID,
    });
    document.getElementById('modal-overlay').style.display = 'none';
    await loadAdminData();
  } catch (e) {
    showError(errEl, 'Failed to create campaign. Try again.');
  }
}

// ──────────────────────────────────────────
// DETAIL MODAL
// ──────────────────────────────────────────
async function openDetailModal(uid, campId) {
  const member = members[uid];
  const camp   = campaigns[campId];
  document.getElementById('detail-member-name').textContent   = member.name || member.username;
  document.getElementById('detail-campaign-name').textContent = camp.name;

  const checkSnap = await db.collection('checklists').doc(uid).get();
  const cl = checkSnap.exists ? (checkSnap.data()[campId] || {}) : {};

  document.getElementById('detail-content').innerHTML = ['d5', 'd1'].map(tab => {
    const data = cl[tab] || {};
    return `
      <div class="detail-section">
        <div class="detail-section-title">${tab === 'd5' ? 'D-5 Check' : 'D-1 Check'}</div>
        ${CHECKLIST_SECTIONS.map(sec => `
          <div style="margin-bottom:10px">
            <div style="font-size:11px;font-weight:600;color:var(--text);margin:6px 0 2px">${sec.title}</div>
            ${sec.items.map(item => {
              const d    = data[item.id] || {};
              const icon = d.status === 'done' ? '✅' : d.status === 'na' ? '—' : '⬜';
              return `<div class="detail-item">
                <span class="detail-check">${icon}</span>
                <div>
                  <div class="detail-name">${item.name}</div>
                  ${d.note ? `<div class="detail-note">${d.note}</div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>`;
  }).join('');

  document.getElementById('detail-overlay').style.display = 'flex';
}

function closeDetailModal(e) {
  if (e && e.target !== document.getElementById('detail-overlay')) return;
  document.getElementById('detail-overlay').style.display = 'none';
}

// ──────────────────────────────────────────
// USER CHECKLIST VIEW
// ──────────────────────────────────────────
function populateUserCampaignSelect() {
  const sel = document.getElementById('user-campaign-select');
  sel.innerHTML = '<option value="">Select campaign…</option>';
  Object.values(campaigns).forEach(c => {
    sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });
}

function setActiveTab(tab) {
  activeTab = tab;
  document.getElementById('tab-d5').classList.toggle('active', tab === 'd5');
  document.getElementById('tab-d1').classList.toggle('active', tab === 'd1');
  renderUserChecklist();
}

function loadUserChecklist() {
  const sel = document.getElementById('user-campaign-select');
  selectedCampaignId = sel.value;
  if (!selectedCampaignId) {
    document.getElementById('user-no-campaign').style.display = 'block';
    document.getElementById('user-checklist').style.display = 'none';
    document.getElementById('user-progress-bar-wrap').style.display = 'none';
    document.getElementById('user-campaign-name').textContent = 'Select a campaign';
    return;
  }
  document.getElementById('user-campaign-name').textContent = campaigns[selectedCampaignId]?.name || '';
  document.getElementById('user-no-campaign').style.display = 'none';
  document.getElementById('user-checklist').style.display = 'block';
  document.getElementById('user-progress-bar-wrap').style.display = 'block';
  renderUserChecklist();
  updateUserProgress();
}

function renderUserChecklist() {
  if (!selectedCampaignId) return;
  const campData = (userChecklist[selectedCampaignId] || {})[activeTab] || {};
  const container = document.getElementById('user-checklist');

  container.innerHTML = CHECKLIST_SECTIONS.map(sec => `
    <div class="checklist-section">
      <div class="section-header">${sec.title}</div>
      <div class="section-body">
        ${sec.items.map(item => {
          const d = campData[item.id] || { status: '', note: '' };
          const selCls = d.status === 'done' ? 'status-done' : d.status === 'na' ? 'status-na' : 'status-pending';
          return `<div class="checklist-item" id="ci-${item.id}">
            <div class="item-left">
              <div class="item-name">${item.name}</div>
              <div class="item-guide">${item.guide}</div>
            </div>
            <div class="item-right">
              <select class="status-select ${selCls}" onchange="handleStatusChange('${item.id}', this)">
                <option value="" ${!d.status ? 'selected' : ''}>— Pending</option>
                <option value="done" ${d.status === 'done' ? 'selected' : ''}>✓ Done</option>
                <option value="na" ${d.status === 'na' ? 'selected' : ''}>N/A</option>
              </select>
              <input class="notes-input" type="text" placeholder="Notes…" value="${d.note || ''}"
                oninput="handleNoteChange('${item.id}', this.value)"
                onblur="saveChecklist()" />
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function handleStatusChange(itemId, selectEl) {
  const status = selectEl.value;
  selectEl.className = `status-select ${status === 'done' ? 'status-done' : status === 'na' ? 'status-na' : 'status-pending'}`;
  ensurePath();
  userChecklist[selectedCampaignId][activeTab][itemId] = {
    ...(userChecklist[selectedCampaignId][activeTab][itemId] || {}), status
  };
  updateUserProgress();
  saveChecklist();
}

function handleNoteChange(itemId, note) {
  ensurePath();
  userChecklist[selectedCampaignId][activeTab][itemId] = {
    ...(userChecklist[selectedCampaignId][activeTab][itemId] || {}), note
  };
}

function ensurePath() {
  if (!userChecklist[selectedCampaignId]) userChecklist[selectedCampaignId] = {};
  if (!userChecklist[selectedCampaignId][activeTab]) userChecklist[selectedCampaignId][activeTab] = {};
}

function updateUserProgress() {
  const campData = userChecklist[selectedCampaignId] || {};
  const done  = countDone(campData.d5 || {}) + countDone(campData.d1 || {});
  const total = TOTAL_ITEMS * 2;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
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

// ──────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────
function showScreen(id) {
  ['login-screen', 'admin-screen', 'user-screen'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}
