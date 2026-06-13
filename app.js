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
  await loadCalendarEntries();
  // Refresh data tab if it's currently showing
  const dataTab = document.getElementById('admin-tab-data');
  if (dataTab && dataTab.style.display !== 'none') renderDataTab();
  // Refresh registration tab if it's currently showing
  const regTab = document.getElementById('admin-tab-registration');
  if (regTab && regTab.style.display !== 'none') loadAndRenderRegPollAdmin();
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
  await checkForPendingPoll();

  // Show team dashboard as the main view for members
  showUserTab('dashboard');
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
  const label = document.getElementById('dashboard-campaign-label');
  if (label) label.textContent = sel.value ? (campaigns[sel.value]?.name || 'All campaigns') : 'All campaigns';
}

async function renderAdminView() {
  const filterCampaign = document.getElementById('admin-campaign-filter').value;
  const label = document.getElementById('dashboard-campaign-label');
  if (label) label.textContent = filterCampaign ? (campaigns[filterCampaign]?.name || 'All campaigns') : 'All campaigns';

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

  // Apply sort
  const sortSel = document.getElementById('table-sort');
  const sortVal = sortSel ? sortSel.value : 'name';
  rows.sort((a, b) => {
    if (sortVal === 'name') return (a.member.name || a.member.username).localeCompare(b.member.name || b.member.username);
    if (sortVal === 'overall_desc') return b.overallDone - a.overallDone;
    if (sortVal === 'overall_asc')  return a.overallDone - b.overallDone;
    if (sortVal === 'lastactive') {
      const aT = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const bT = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return bT - aT;
    }
    return 0;
  });
  window._adminRows = rows;

  const total      = rows.length;
  const complete   = rows.filter(r => r.overallDone === 100).length;
  const inProgress = rows.filter(r => r.overallDone > 0 && r.overallDone < 100).length;
  const notStarted = rows.filter(r => r.overallDone === 0).length;
  const completePct  = total > 0 ? Math.round((complete / total) * 100) : 0;
  const inProgPct    = total > 0 ? Math.round((inProgress / total) * 100) : 0;
  const notStartPct  = total > 0 ? Math.round((notStarted / total) * 100) : 0;

  const overallCompletionRate = total > 0 ? Math.round((complete / total) * 100) : 0;
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card"><div class="label">Total Checklists</div><div class="value blue">${total}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:100%;background:var(--blue);"></div></div></div>
    <div class="stat-card"><div class="label">Complete</div><div class="value green">${complete}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${completePct}%;background:#059669;"></div></div></div>
    <div class="stat-card"><div class="label">In Progress</div><div class="value amber">${inProgress}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${inProgPct}%;background:#D97706;"></div></div></div>
    <div class="stat-card"><div class="label">Not Started</div><div class="value red">${notStarted}</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${notStartPct}%;background:#DC2626;"></div></div></div>
    <div class="stat-card"><div class="label">Completion Rate</div><div class="value" style="color:${overallCompletionRate===100?'#059669':overallCompletionRate>=50?'#D97706':'#2563EB'}">${overallCompletionRate}%</div>
      <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${overallCompletionRate}%;background:${overallCompletionRate===100?'#059669':overallCompletionRate>=50?'#D97706':'#2563EB'};"></div></div></div>
  `;

  const tbody = document.getElementById('admin-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">No assignments yet. Create a campaign and assign members.</td></tr>`;
    renderDashboardWidgets(rows);
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

  renderDashboardWidgets(rows);
  filterProgressTable();
}

function filterProgressTable() {
  const q = (document.getElementById('table-search')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#admin-tbody tr');
  rows.forEach(tr => {
    if (!q) { tr.classList.remove('table-hidden'); return; }
    tr.classList.toggle('table-hidden', !tr.textContent.toLowerCase().includes(q));
  });
}


// ═════════════════════════════════════════════════════════════
//  D-DAY COUNTDOWN BANNER
// ═════════════════════════════════════════════════════════════
function renderDdayBanner() {
  const el = document.getElementById('dday-banner');
  if (!el) return;
  const now = new Date(); now.setHours(0,0,0,0);
  // Find the nearest upcoming dday event
  const ddays = calendarEntries
    .filter(e => e.type === 'dday' && e.date)
    .map(e => ({ ...e, dateObj: new Date(e.date) }))
    .filter(e => e.dateObj >= now)
    .sort((a,b) => a.dateObj - b.dateObj);

  if (ddays.length === 0) { el.style.display = 'none'; return; }

  const next = ddays[0];
  const diff = Math.ceil((next.dateObj - now) / 86400000);
  let cls = 'dday-green', msg = '';
  if (diff === 0)      { cls = 'dday-red';   msg = '🔴 D-DAY IS TODAY'; }
  else if (diff === 1) { cls = 'dday-red';   msg = '🔴 D-DAY TOMORROW'; }
  else if (diff <= 5)  { cls = 'dday-amber'; msg = `⚠️ D-DAY IN ${diff} DAYS`; }
  else                 { cls = 'dday-green'; msg = `📅 D-DAY IN ${diff} DAYS`; }

  el.style.display = 'block';
  el.innerHTML = `
    <div class="dday-banner ${cls}">
      <div class="dday-banner-left">
        <span class="dday-banner-label">${msg}</span>
        <span class="dday-banner-name">${escHtml(next.title)}</span>
      </div>
      <span class="dday-banner-date">${next.dateObj.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
//  DASHBOARD WIDGETS
// ─────────────────────────────────────────────────────────────
function renderDashboardWidgets(rows) {
  rows = rows || window._adminRows || [];
  renderCompletionChart(rows);
  renderDeadlinePanel();
  renderAlertsBanner(rows);
  renderDdayBanner();
  renderTaskChecksInDashboard();
}

function renderCompletionChart(rows) {
  const el = document.getElementById('dash-completion-chart');
  if (!el) return;
  const memberMap = {};
  rows.forEach(r => {
    const uid  = r.member.uid;
    const name = r.member.name || r.member.username;
    if (!memberMap[uid]) memberMap[uid] = { name, uid, total: 0, done: 0 };
    memberMap[uid].total += 100;
    memberMap[uid].done  += r.overallDone;
  });
  const members_list = Object.values(memberMap).sort((a,b) => (b.done/Math.max(b.total,1)) - (a.done/Math.max(a.total,1)));
  const badge = document.getElementById('dash-completion-badge');
  if (badge) badge.textContent = `${members_list.length} member${members_list.length !== 1 ? 's' : ''}`;
  if (members_list.length === 0) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No data yet.</div>'; return; }
  el.innerHTML = members_list.map(m => {
    const pct   = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
    const color = pct === 100 ? '#059669' : pct >= 50 ? '#D97706' : pct > 0 ? '#3B82F6' : '#D1D5DB';
    const nudge = pct === 0 ? `<button class="completion-nudge" onclick="quickNudge('${escHtml(m.name).replace(/'/g,"\\'")}','${m.uid}')">Nudge</button>` : '';
    return `<div class="completion-bar-row">
      <div class="completion-name" title="${escHtml(m.name)}">${escHtml(m.name)}</div>
      <div class="completion-track"><div class="completion-fill" style="width:${pct}%;background:${color};"></div></div>
      <div class="completion-pct">${pct}%</div>
      ${nudge}
    </div>`;
  }).join('');
}

function renderDeadlinePanel() {
  // Renamed to renderActiveCampaignsPanel — kept for backward compat
  renderActiveCampaignsPanel();
}

// ── Active Checklists Breakdown (replaces Upcoming Deadlines widget) ──
function renderActiveCampaignsPanel() {
  const el    = document.getElementById('dash-deadlines-list');
  const badge = document.getElementById('dash-camps-badge');
  if (!el) return;

  const rows = window._adminRows || [];
  // Group rows by campaign
  const campMap = {};
  rows.forEach(r => {
    const id = r.camp.id;
    if (!campMap[id]) campMap[id] = { name: r.camp.name, dday: r.camp.dday || null, total: 0, complete: 0, inProgress: 0, notStarted: 0 };
    campMap[id].total++;
    if (r.overallDone === 100)      campMap[id].complete++;
    else if (r.overallDone > 0)     campMap[id].inProgress++;
    else                            campMap[id].notStarted++;
  });

  const campList = Object.values(campMap);
  if (badge) badge.textContent = `${campList.length} campaign${campList.length !== 1 ? 's' : ''}`;

  if (campList.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No campaigns yet.</div>';
    return;
  }

  const now = new Date(); now.setHours(0,0,0,0);

  el.innerHTML = campList.map(camp => {
    const rate       = camp.total > 0 ? Math.round((camp.complete / camp.total) * 100) : 0;
    const rateColor  = rate === 100 ? '#059669' : rate >= 50 ? '#D97706' : '#2563EB';
    let ddayTag = '';
    if (camp.dday) {
      const dd   = new Date(camp.dday);
      const diff = Math.ceil((dd - now) / 86400000);
      let cls = 'dp-green', txt = dd.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
      if (diff === 0)      { cls = 'dp-red';   txt = 'D-Day Today'; }
      else if (diff === 1) { cls = 'dp-red';   txt = 'D-Day Tomorrow'; }
      else if (diff <= 5)  { cls = 'dp-amber'; txt = `D-Day in ${diff}d`; }
      ddayTag = `<span class="deadline-pill ${cls}" style="margin-left:4px;">${txt}</span>`;
    }
    return `<div class="ac-camp-row">
      <div class="ac-camp-top">
        <div class="ac-camp-name">${escHtml(camp.name)}${ddayTag}</div>
        <div class="ac-camp-rate" style="color:${rateColor};font-family:var(--mono);font-size:13px;font-weight:700;">${rate}%</div>
      </div>
      <div class="ac-rate-bar"><div style="width:${rate}%;background:${rateColor};height:100%;border-radius:4px;transition:width .4s;"></div></div>
      <div class="ac-camp-pills">
        <span class="ac-pill ac-green">✓ ${camp.complete}</span>
        <span class="ac-pill ac-amber">⟳ ${camp.inProgress}</span>
        <span class="ac-pill ac-red">— ${camp.notStarted}</span>
        <span class="ac-pill ac-blue">${camp.total} total</span>
      </div>
    </div>`;
  }).join('');
}

function renderAlertsBanner(rows) {
  const notStarted = rows.filter(r => r.overallDone === 0);
  const alertRow   = document.getElementById('dash-alerts-row');
  const alertList  = document.getElementById('dash-alerts-list');
  if (!alertRow || !alertList) return;
  const alertsBtn  = document.getElementById('navbtn-alerts');
  const alertsDiv  = document.getElementById('nav-alerts-divider');
  const alertBadge = document.getElementById('nav-alert-badge');
  if (notStarted.length === 0) {
    alertRow.style.display = 'none';
    if (alertsBtn)  alertsBtn.style.display  = 'none';
    if (alertsDiv)  alertsDiv.style.display  = 'none';
    return;
  }
  alertRow.style.display = 'block';
  if (alertsBtn)  { alertsBtn.style.display  = 'flex'; }
  if (alertsDiv)  { alertsDiv.style.display  = 'block'; }
  if (alertBadge) { alertBadge.textContent = notStarted.length; alertBadge.style.display = 'inline-block'; }
  const seen = new Set();
  const unique = notStarted.filter(r => { if (seen.has(r.member.uid)) return false; seen.add(r.member.uid); return true; });
  alertList.innerHTML = unique.slice(0,8).map(r =>
    `<div class="alert-chip">${escHtml(r.member.name || r.member.username)}
      <button class="alert-chip-nudge" onclick="quickNudge('${escHtml(r.member.name||r.member.username).replace(/'/g,"\\'")}','${r.member.uid}')">Nudge</button>
    </div>`).join('');
}

async function quickNudge(memberName, uid) {
  openBroadcastModal();
  setTimeout(() => {
    document.getElementById('broadcast-message').value = `\u23F0 Friendly reminder: please complete your checklist before D-Day!`;
    if (uid) { const s = document.getElementById('broadcast-member-sel'); if (s) s.value = uid; }
    const nudgeBtn = document.querySelector('.btn-broadcast-type[data-type="nudge"]');
    if (nudgeBtn) selectBroadcastType(nudgeBtn);
  }, 120);
}

async function renderAlertsTab() {
  const el = document.getElementById('alerts-full-list');
  if (!el) return;
  const rows = window._adminRows || [];
  const notStarted = rows.filter(r => r.overallDone === 0);
  if (notStarted.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:4rem 2rem;"><div style="font-size:40px;margin-bottom:12px;">\uD83C\uDF89</div><div style="font-size:16px;font-weight:600;color:var(--navy);margin-bottom:8px;">All caught up!</div><div style="font-size:14px;color:var(--text-muted);">Every member has started their checklist.</div></div>`;
    return;
  }

  // Bulk nudge header
  const uniqueUids = [...new Set(notStarted.map(r => r.member.uid))];
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
      <div style="font-size:13px;color:var(--text-muted);">${notStarted.length} assignment${notStarted.length !== 1 ? 's' : ''} not started · ${uniqueUids.length} member${uniqueUids.length !== 1 ? 's' : ''}</div>
      <button class="btn-primary" style="width:auto;padding:8px 18px;background:#D97706;" onclick="bulkNudgeAll()">📣 Nudge All (${uniqueUids.length})</button>
    </div>` +
  notStarted.map(r => {
    const lastStr = r.lastActive ? 'Last active: ' + new Date(r.lastActive).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : 'Never opened';
    return `<div class="alerts-member-row">
      <div class="alerts-member-info">
        <div class="alerts-member-name">${escHtml(r.member.name || r.member.username)}</div>
        <div class="alerts-member-sub">@${escHtml(r.member.username)} · ${escHtml(r.camp.name)} · ${lastStr}</div>
      </div>
      <div class="alerts-member-actions">
        <button class="btn-link" onclick="openReviewModal('${r.member.uid}','${r.camp.id}')">View checklist</button>
        <button class="btn-ghost-light btn-sm" onclick="quickNudge('${escHtml(r.member.name||r.member.username).replace(/'/g,"\\'")}','${r.member.uid}')">\uD83D\uDCE3 Nudge</button>
      </div>
    </div>`;
  }).join('');
}

async function bulkNudgeAll() {
  const rows = window._adminRows || [];
  const notStarted = rows.filter(r => r.overallDone === 0);
  const uniqueUids = [...new Set(notStarted.map(r => r.member.uid))];
  if (uniqueUids.length === 0) return;
  if (!confirm(`Send a nudge broadcast to all ${uniqueUids.length} member(s) who haven't started?`)) return;
  try {
    await db.collection('broadcasts').add({
      type:       'nudge',
      message:    `⏰ Friendly reminder: please complete your checklist before D-Day!`,
      targetUid:  null,
      targetName: 'everyone (not started)',
      campaignId: null,
      campaignName: null,
      sentAt:     new Date().toISOString(),
      sentBy:     'Admin',
      readBy:     [],
    });
    showToast(`📣 Nudge sent to ${uniqueUids.length} member(s)!`, 'success');
  } catch(e) { showToast('Failed to send nudge.', 'warn'); console.error(e); }
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
        const d5NoteFlag = d5.note ? `<span class="note-flag" title="${escHtml(d5.note)}">💬</span>` : '';
        const d1NoteFlag = d1.note ? `<span class="note-flag" title="${escHtml(d1.note)}">💬</span>` : '';
        html += `<td>${statusBadge(d5.status)}</td>
                 <td style="color:var(--text-muted);font-size:12px;font-style:italic">${d5NoteFlag}${d5.note || ''}</td>
                 <td>${statusBadge(d1.status)}</td>
                 <td style="color:var(--text-muted);font-size:12px;font-style:italic">${d1NoteFlag}${d1.note || ''}</td>`;
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
  document.getElementById('delete-all-cl-password').value = '';
  document.getElementById('delete-all-cl-overlay').style.display = 'flex';
}

function closeDeleteAllChecklistsModal(e) {
  if (e && e.target !== document.getElementById('delete-all-cl-overlay')) return;
  document.getElementById('delete-all-cl-overlay').style.display = 'none';
}

async function confirmDeleteAllChecklists() {
  const errEl = document.getElementById('delete-all-cl-error');
  errEl.style.display = 'none';
  const pwd = document.getElementById('delete-all-cl-password').value;
  if (pwd !== ADMIN_PASSWORD) {
    showError(errEl, 'Incorrect admin password. Please try again.');
    return;
  }
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
    // Sync data tab if open
    const dataTab = document.getElementById('admin-tab-data');
    if (dataTab && dataTab.style.display !== 'none') renderDataTab();
  } catch (e) { showToast('Failed to remove member.', 'warn'); }
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
  document.getElementById('new-campaign-name').value     = '';
  document.getElementById('new-campaign-dday').value     = '';
  document.getElementById('new-campaign-deadline').value = '';
  document.getElementById('modal-error').style.display   = 'none';
  populateCampaignTemplateSel();
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
    const pollId = document.getElementById('modal-overlay').dataset.pollId || null;
    const selectedTemplateId = document.getElementById('campaign-template-sel')?.value || null;

    // Build prefill data from poll responses if this came from a poll
    let prefillData = {};
    if (pollId && Object.keys(pollResponses || {}).length > 0) {
      assignedUids.forEach(uid => {
        const resp = pollResponses[uid];
        if (resp && resp.status === 'registered' && resp.registrations && resp.registrations.length > 0) {
          prefillData[uid] = resp.registrations.map(r => ({
            label:    [r.brand, r.platform, r.region].filter(Boolean).join('_'),
            brand:    r.brand || '',
            platform: r.platform || '',
            region:   r.region || '',
          }));
        }
      });
    }

    const ref = await db.collection('campaigns').add({
      name, assignedUids,
      createdAt:           firebase.firestore.FieldValue.serverTimestamp(),
      createdBy:           ADMIN_UID,
      fromPollId:          pollId || null,
      checklistTemplateId: selectedTemplateId || null,
      dday:                document.getElementById('new-campaign-dday')?.value || null,
      deadline:            document.getElementById('new-campaign-deadline')?.value || null,
    });

    // Pre-populate checklists for members who came from poll
    if (Object.keys(prefillData).length > 0) {
      await Promise.all(Object.entries(prefillData).map(([uid, entries]) =>
        db.collection('checklists').doc(uid).set({
          [ref.id]: { entries, lastActive: new Date().toISOString() }
        }, { merge: true })
      ));

      // Notify members their checklist is ready
      await db.collection('broadcasts').add({
        type: 'custom',
        message: `🚀 Campaign "${name}" is ready! Your checklist has been pre-filled with your registered details. Go to the Checklist tab to start.`,
        targetUid: null, targetName: 'everyone',
        campaignId: ref.id, campaignName: name,
        sentAt: new Date().toISOString(), sentBy: 'Admin', readBy: [],
      });
    }

    // Lock the poll if it came from one
    if (pollId) {
      try {
        await POLL_META_REF(pollId).set({ status: 'locked', lockedAt: new Date().toISOString() }, { merge: true });
        const listDoc2 = await POLLS_LIST_REF().get();
        if (listDoc2.exists) {
          const pls = listDoc2.data().polls || [];
          const pidx = pls.findIndex(p => p.id === pollId);
          if (pidx >= 0) { pls[pidx].status = 'locked'; await POLLS_LIST_REF().set({ polls: pls }); }
        }
      } catch(le) { console.warn('Could not lock poll:', le); }
    }

    // Reset poll linkage
    document.getElementById('modal-overlay').dataset.pollId = '';
    document.getElementById('modal-overlay').style.display = 'none';
    await loadAdminData();
  } catch (e) {
    showError(errEl, 'Failed to create campaign. Try again.');
    console.error(e);
  }
}


// ─── Admin: Duplicate Campaign ───────────────────────────────
async function duplicateCampaign(campId) {
  const camp = campaigns[campId];
  if (!camp) return;
  const newName = prompt('New campaign name:', camp.name + ' (copy)');
  if (!newName || !newName.trim()) return;
  try {
    await db.collection('campaigns').add({
      name:        newName.trim(),
      assignedUids: camp.assignedUids || [],
      createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
      createdBy:   ADMIN_UID,
      fromPollId:  null,
    });
    await loadAdminData();
    showToast(`✅ Campaign "${newName.trim()}" created!`, 'success');
  } catch(e) { showToast('Failed to duplicate campaign. Try again.', 'warn'); console.error(e); }
}

// ─── Admin: Edit Campaign ─────────────────────────────────────
async function openEditCampaignModal(campId) {
  const camp = campaigns[campId];
  if (!camp) return;

  // Ensure templates are loaded
  if (!checklistTemplates || checklistTemplates.length === 0) {
    await loadChecklistTemplates();
  }

  const overlay = document.getElementById('edit-campaign-overlay');
  overlay.dataset.campId = campId;

  document.getElementById('edit-campaign-name').value     = camp.name;
  document.getElementById('edit-campaign-dday').value     = camp.dday || '';
  document.getElementById('edit-campaign-deadline').value = camp.deadline || '';
  document.getElementById('edit-campaign-error').style.display = 'none';

  // Build template selector
  const tmplSel = document.getElementById('edit-campaign-template-sel');
  tmplSel.innerHTML = `<option value="">None (use default checklist)</option>`;
  (checklistTemplates || []).forEach(t => {
    tmplSel.innerHTML += `<option value="${t.id}" ${camp.checklistTemplateId === t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`;
  });

  // Build member chips
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  const list = document.getElementById('edit-member-assign-list');
  list.innerHTML = nonAdmins.length === 0
    ? '<div style="color:var(--text-muted);font-size:13px;">No members yet.</div>'
    : nonAdmins.map(m => {
        const sel = (camp.assignedUids || []).includes(m.uid) ? 'selected' : '';
        return `<div class="member-chip ${sel}" data-uid="${m.uid}" onclick="toggleChip(this)">${m.name || m.username}</div>`;
      }).join('');

  overlay.style.display = 'flex';
}

function closeEditCampaignModal(e) {
  if (e && e.target !== document.getElementById('edit-campaign-overlay')) return;
  document.getElementById('edit-campaign-overlay').style.display = 'none';
}

async function saveEditCampaign() {
  const overlay = document.getElementById('edit-campaign-overlay');
  const campId  = overlay.dataset.campId;
  const name    = document.getElementById('edit-campaign-name').value.trim();
  const errEl   = document.getElementById('edit-campaign-error');
  errEl.style.display = 'none';

  if (!name) { showError(errEl, 'Campaign name is required.'); return; }

  const selectedChips = document.querySelectorAll('#edit-member-assign-list .member-chip.selected');
  const assignedUids  = [...selectedChips].map(c => c.dataset.uid);
  if (assignedUids.length === 0) { showError(errEl, 'Please assign at least one member.'); return; }

  const templateId = document.getElementById('edit-campaign-template-sel')?.value || null;
  const dday       = document.getElementById('edit-campaign-dday')?.value || null;
  const deadline   = document.getElementById('edit-campaign-deadline')?.value || null;

  try {
    await db.collection('campaigns').doc(campId).update({
      name,
      assignedUids,
      checklistTemplateId: templateId || null,
      dday:     dday || null,
      deadline: deadline || null,
    });
    campaigns[campId] = { ...campaigns[campId], name, assignedUids, checklistTemplateId: templateId || null, dday: dday || null, deadline: deadline || null };
    overlay.style.display = 'none';
    await loadAdminData();
    showToast('✅ Campaign updated!', 'success');
  } catch(e) {
    showError(errEl, 'Failed to save. Try again.');
    console.error(e);
  }
}

// ─── Admin: Delete single Campaign ───────────────────────────
async function deleteCampaign(campId, campName) {
  if (!confirm(`Delete campaign "${campName}"?\n\nThis will remove the campaign and all assigned members' checklist progress for it. This cannot be undone.`)) return;
  try {
    // Delete the campaign document
    await db.collection('campaigns').doc(campId).delete();

    // Remove campaign key from all member checklists
    const clSnap = await db.collection('checklists').get();
    const batch  = db.batch();
    clSnap.forEach(doc => {
      const data = doc.data();
      if (data[campId] !== undefined) {
        const updated = { ...data };
        delete updated[campId];
        batch.set(doc.ref, updated);
      }
    });
    await batch.commit();

    delete campaigns[campId];
    await loadAdminData();
    showToast(`✅ Campaign "${campName}" deleted.`, 'success');
  } catch(e) {
    showToast('Failed to delete campaign. Try again.', 'warn');
    console.error(e);
  }
}

// ─────────────────────────────────────────────────────────────
//  USER TABS  (calendar vs checklist)
// ─────────────────────────────────────────────────────────────
function showUserTab(tab) {
  const dashView = document.getElementById('user-dashboard-view');
  const calView  = document.getElementById('user-calendar-view');
  const clView   = document.getElementById('user-checklist-view');

  // Update sidebar nav active state
  ['dashboard','calendar','checklist'].forEach(t => {
    const btn = document.getElementById('user-navbtn-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });

  // Hide all views
  if (dashView) dashView.style.display = 'none';
  if (calView)  calView.style.display  = 'none';
  if (clView)   clView.style.display   = 'none';

  if (tab === 'dashboard') {
    if (dashView) dashView.style.display = 'block';
    renderUserDashboard();
  } else if (tab === 'calendar') {
    if (calView) calView.style.display = 'block';
    renderCalendarView(calView);
  } else {
    if (clView) clView.style.display = 'block';
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

async function loadUserChecklist() {
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

  // Load the correct checklist sections for this campaign's template
  await loadChecklistOverrides(selectedCampaignId);

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
  const d5Done   = countDone(campData.d5 || {});
  const d1Done   = countDone(campData.d1 || {});
  const d5Pct    = total > 0 ? Math.round((d5Done / (TOTAL_ITEMS * entries.length)) * 100) : 0;
  const d1Pct    = total > 0 ? Math.round((d1Done / (TOTAL_ITEMS * entries.length)) * 100) : 0;

  // Inline progress banner above checklist
  const banner = document.getElementById('user-progress-banner');
  if (banner) {
    const color = pct === 100 ? '#059669' : pct >= 50 ? '#D97706' : '#2563EB';
    const emoji = pct === 100 ? '🎉' : pct >= 50 ? '🔥' : '📋';
    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="user-prog-banner">
        <div class="user-prog-banner-top">
          <span class="user-prog-emoji">${emoji}</span>
          <span class="user-prog-title">${escHtml(campaigns[selectedCampaignId]?.name || '')}</span>
          <span class="user-prog-pct" style="color:${color};">${pct}%</span>
        </div>
        <div class="user-prog-bar-track"><div class="user-prog-bar-fill" style="width:${pct}%;background:${color};"></div></div>
        <div class="user-prog-detail">
          <span>D-5: ${d5Done}/${TOTAL_ITEMS * entries.length} (${d5Pct}%)</span>
          <span>D-1: ${d1Done}/${TOTAL_ITEMS * entries.length} (${d1Pct}%)</span>
          <span>${done} / ${total} items complete</span>
        </div>
      </div>`;
  }

  // Legacy progress bar (sidebar)
  const legacyLabel = document.getElementById('user-progress-label');
  const legacyPct   = document.getElementById('user-progress-pct');
  const legacyFill  = document.getElementById('user-progress-fill');
  if (legacyLabel) legacyLabel.textContent = `${done} / ${total} items complete`;
  if (legacyPct)   legacyPct.textContent   = `${pct}%`;
  if (legacyFill)  legacyFill.style.width  = `${pct}%`;
  // Update sidebar
  updateUserSidebarProgress();
}

let saveTimer = null;
function saveChecklist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!currentUser || !selectedCampaignId) return;
    const saveData = { ...userChecklist };
    if (!saveData[selectedCampaignId]) saveData[selectedCampaignId] = {};
    saveData[selectedCampaignId].lastActive = new Date().toISOString();

    // Record startedAt on the very first save for this campaign
    if (!saveData[selectedCampaignId].startedAt) {
      saveData[selectedCampaignId].startedAt = new Date().toISOString();
    }

    // Record completedAt if just hit 100%
    const campData   = saveData[selectedCampaignId];
    const d5Done     = countDone(campData.d5 || {});
    const d1Done     = countDone(campData.d1 || {});
    const entries    = (campData.entries || [{ brand:'',platform:'',region:'' }]);
    const totalItems = TOTAL_ITEMS * 2 * entries.length;
    const isNowComplete = totalItems > 0 && (d5Done + d1Done) >= totalItems;
    if (isNowComplete && !campData.completedAt) {
      saveData[selectedCampaignId].completedAt = new Date().toISOString();
    }

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
  } catch(e) { showToast('Failed to delete event.', 'warn'); }
}

// Admin calendar view (inside admin screen)
function switchAdminTab(tab) {
  const tabs = ['dashboard', 'calendar', 'data', 'registration', 'reports', 'alerts', 'checklist'];
  tabs.forEach(t => {
    const el = document.getElementById('admin-tab-' + t);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });

  // Update sidebar nav active state
  document.querySelectorAll('.nav-item').forEach(b => {
    if (b.id && b.id.startsWith('navbtn-')) b.classList.remove('active');
  });
  const navBtn = document.getElementById('navbtn-' + tab);
  if (navBtn) navBtn.classList.add('active');

  // Also update legacy tab btn class if present
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  const legacyBtn = document.getElementById('atab-' + tab);
  if (legacyBtn) legacyBtn.classList.add('active');

  if (tab === 'calendar') {
    renderCalendarView(document.getElementById('admin-calendar-host'));
  }
  if (tab === 'data') {
    renderDataTab();
  }
  if (tab === 'registration') {
    loadAndRenderRegPollAdmin();
  }
  if (tab === 'alerts') {
    renderAlertsTab();
  }
  if (tab === 'reports') {
    renderReportTab();
  }
  if (tab === 'dashboard') {
    renderDashboardWidgets();
  }
  if (tab === 'checklist') {
    renderChecklistTab();
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
          <button class="btn-ghost-light btn-sm" onclick="openEditCampaignModal('${c.id}')" title="Edit campaign">✏️ Edit</button>
          <button class="btn-ghost-light btn-sm" onclick="duplicateCampaign('${c.id}')" title="Duplicate campaign">⧉ Clone</button>
          <button class="btn-ghost-light btn-sm" style="color:#DC2626;border-color:#FCA5A5;" onclick="deleteCampaign('${c.id}','${escHtml(c.name).replace(/'/g,"\\'")}')" title="Delete campaign">🗑 Delete</button>
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
    const el = document.getElementById(s);
    if (!el) return;
    if (s !== id) { el.style.display = 'none'; return; }
    el.style.display = s === 'login-screen' ? 'block' : 'flex';
  });
}

// ─────────────────────────────────────────────────────────────
//  SIDEBAR TOGGLE
// ─────────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('admin-sidebar');
  if (sb) sb.classList.toggle('collapsed');
}

function toggleUserSidebar() {
  const sb = document.getElementById('user-sidebar');
  if (sb) sb.classList.toggle('collapsed');
}

// ─────────────────────────────────────────────────────────────
//  MEMBER PROGRESS IN SIDEBAR
// ─────────────────────────────────────────────────────────────
function updateUserSidebarProgress() {
  if (!selectedCampaignId) {
    const wrap = document.getElementById('user-sidebar-progress');
    if (wrap) wrap.style.display = 'none';
    return;
  }
  const campData = userChecklist[selectedCampaignId] || {};
  const done     = countDone(campData.d5 || {}) + countDone(campData.d1 || {});
  const entries  = getEntries();
  const total    = TOTAL_ITEMS * 2 * entries.length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;

  const wrap = document.getElementById('user-sidebar-progress');
  if (wrap) wrap.style.display = 'block';

  const labelEl = document.getElementById('user-progress-label');
  const pctEl   = document.getElementById('user-progress-pct');
  const fillEl  = document.getElementById('user-progress-fill');
  const campLbl = document.getElementById('user-sidebar-campaign-label');

  if (labelEl) labelEl.textContent = `${done} / ${total} items`;
  if (pctEl)   pctEl.textContent   = `${pct}%`;
  if (fillEl)  fillEl.style.width  = `${pct}%`;
  if (campLbl) campLbl.textContent = campaigns[selectedCampaignId]?.name || '';
}

// ─────────────────────────────────────────────────────────────
//  MEMBER TEAM OVERVIEW DASHBOARD
// ─────────────────────────────────────────────────────────────
async function renderUserDashboard() {
  const statsEl     = document.getElementById('user-team-stats');
  const breakdownEl = document.getElementById('user-team-campaign-breakdown');
  if (!statsEl || !breakdownEl) return;

  statsEl.innerHTML     = `<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">Loading team data…</div>`;
  breakdownEl.innerHTML = '';

  try {
    // Fetch all checklists so we can compute team-wide stats
    const checkSnap = await db.collection('checklists').get();
    const allChecklists = {};
    checkSnap.forEach(doc => { allChecklists[doc.id] = doc.data(); });

    // Only include campaigns this member is part of
    const myCampaigns = Object.values(campaigns);
    if (myCampaigns.length === 0) {
      statsEl.innerHTML = `<div class="empty-state" style="padding:2rem;text-align:center;color:var(--text-muted);">No campaigns assigned yet.</div>`;
      return;
    }

    // Build aggregate rows across all campaigns this member can see
    let totalRows = 0, completeRows = 0, inProgressRows = 0, notStartedRows = 0;
    const campCards = [];

    for (const camp of myCampaigns) {
      const assignedUids = camp.assignedUids || [];
      let cTotal = 0, cComplete = 0, cInProgress = 0, cNotStarted = 0;
      const memberRows = [];

      for (const uid of assignedUids) {
        const cl     = (allChecklists[uid] || {})[camp.id] || {};
        const d5Done = countDone(cl.d5 || {});
        const d1Done = countDone(cl.d1 || {});
        const pct    = Math.round(((d5Done + d1Done) / (TOTAL_ITEMS * 2)) * 100);
        cTotal++;
        if (pct === 100)       cComplete++;
        else if (pct > 0)      cInProgress++;
        else                   cNotStarted++;

        // We only show member rows if they come from the members map (admin-loaded)
        // For the member view, we just show aggregated counts per campaign
        memberRows.push({ uid, pct });
      }

      totalRows      += cTotal;
      completeRows   += cComplete;
      inProgressRows += cInProgress;
      notStartedRows += cNotStarted;

      const campRate = cTotal > 0 ? Math.round((cComplete / cTotal) * 100) : 0;
      campCards.push({ camp, cTotal, cComplete, cInProgress, cNotStarted, campRate, memberRows });
    }

    // ── Overall stat cards ──
    const overallRate = totalRows > 0 ? Math.round((completeRows / totalRows) * 100) : 0;
    const rateColor   = overallRate === 100 ? '#059669' : overallRate >= 50 ? '#D97706' : '#2563EB';
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="label">Total Checklists</div>
        <div class="value blue">${totalRows}</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:100%;background:var(--blue);"></div></div>
      </div>
      <div class="stat-card">
        <div class="label">Complete</div>
        <div class="value green">${completeRows}</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${totalRows>0?Math.round(completeRows/totalRows*100):0}%;background:#059669;"></div></div>
      </div>
      <div class="stat-card">
        <div class="label">In Progress</div>
        <div class="value amber">${inProgressRows}</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${totalRows>0?Math.round(inProgressRows/totalRows*100):0}%;background:#D97706;"></div></div>
      </div>
      <div class="stat-card">
        <div class="label">Not Started</div>
        <div class="value red">${notStartedRows}</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${totalRows>0?Math.round(notStartedRows/totalRows*100):0}%;background:#DC2626;"></div></div>
      </div>
      <div class="stat-card">
        <div class="label">Completion Rate</div>
        <div class="value" style="color:${rateColor};">${overallRate}%</div>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${overallRate}%;background:${rateColor};"></div></div>
      </div>
    `;

    // ── Per-campaign breakdown ──
    let breakHtml = `<div class="section-label" style="margin-bottom:12px;">Breakdown by Campaign</div>`;
    breakHtml += `<div class="user-dash-camp-grid">`;

    for (const { camp, cTotal, cComplete, cInProgress, cNotStarted, campRate, memberRows } of campCards) {
      const rColor = campRate === 100 ? '#059669' : campRate >= 50 ? '#D97706' : '#2563EB';
      const deadlineStr = camp.dday
        ? `<span style="font-size:11px;color:var(--text-muted);">📅 D-Day: ${new Date(camp.dday).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>`
        : '';

      // Member completion mini-bars (anonymous — just progress bars, no names)
      const barsHtml = memberRows.map(r => {
        const bColor = r.pct === 100 ? '#059669' : r.pct > 0 ? '#3B82F6' : '#E5E7EB';
        return `<div class="user-dash-mini-bar-row">
          <div class="user-dash-mini-track">
            <div style="width:${r.pct}%;background:${bColor};height:100%;border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="font-size:10px;font-family:var(--mono);color:var(--text-muted);min-width:28px;text-align:right;">${r.pct}%</span>
        </div>`;
      }).join('');

      breakHtml += `
        <div class="user-dash-camp-card">
          <div class="user-dash-camp-header">
            <div>
              <div class="user-dash-camp-name">${escHtml(camp.name)}</div>
              ${deadlineStr}
            </div>
            <div class="user-dash-camp-rate" style="color:${rColor};">${campRate}%</div>
          </div>
          <div class="user-dash-camp-rate-bar">
            <div style="width:${campRate}%;background:${rColor};height:100%;border-radius:4px;transition:width .4s;"></div>
          </div>
          <div class="user-dash-camp-pills">
            <span class="user-dash-pill pill-green">✓ ${cComplete} Complete</span>
            <span class="user-dash-pill pill-amber">⟳ ${cInProgress} In Progress</span>
            <span class="user-dash-pill pill-red">— ${cNotStarted} Not Started</span>
            <span class="user-dash-pill pill-blue">${cTotal} Total</span>
          </div>
          <div class="user-dash-members-label">Team progress</div>
          <div class="user-dash-member-bars">${barsHtml}</div>
        </div>`;
    }

    breakHtml += `</div>`;
    breakdownEl.innerHTML = breakHtml;

  } catch(e) {
    statsEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">Failed to load team data.</div>`;
    console.error(e);
  }
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
    showToast(`📣 Broadcast sent to ${memberName}!`, 'success');
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

      const typeIcon  = { shoutout: '🏆', nudge: '⏰', custom: '📢', registration: '📋', taskcheck: '🎒' }[b.type] || '📣';
      const typeColor = { shoutout: '#059669', nudge: '#D97706', custom: '#2563EB', registration: '#7C3AED', taskcheck: '#0F766E' }[b.type] || '#64748B';
      const timeStr   = new Date(b.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const campTag   = b.campaignName ? `<span class="bcast-tag">${b.campaignName}</span>` : '';
      const unreadDot = isUnread ? `<span style="width:8px;height:8px;background:#EF4444;border-radius:50%;display:inline-block;margin-left:4px;"></span>` : '';

      // Registration poll card — show a "Register Now" action button
      const regPollBtn = (b.isRegPoll && b.pollId && currentUser?.role !== 'admin')
        ? `<button onclick="closeBroadcastFeedAndOpenPoll('${b.pollId}')" style="margin-top:10px;padding:7px 16px;font-size:12px;font-weight:600;background:rgba(124,58,237,0.18);border:1px solid rgba(124,58,237,0.5);color:#C4B5FD;border-radius:8px;cursor:pointer;">📋 Register Now</button>`
        : '';

      // Task check card — show "Update Status" button for members
      const taskCheckBtn = (b.type === 'taskcheck' && b.taskCheckId && currentUser?.role !== 'admin')
        ? `<button onclick="closeBroadcastFeed();openMemberTaskCheck('${b.taskCheckId}')" style="margin-top:10px;padding:7px 16px;font-size:12px;font-weight:600;background:rgba(15,118,110,0.18);border:1px solid rgba(15,118,110,0.5);color:#5EEAD4;border-radius:8px;cursor:pointer;">🎒 Update My Status</button>`
        : '';

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
        ${regPollBtn}
        ${taskCheckBtn || ''}
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

// ─── Member: open poll from broadcast feed ───────────────────
async function closeBroadcastFeedAndOpenPoll(pollId) {
  document.getElementById('broadcast-feed-overlay').style.display = 'none';

  try {
    // Check if user already responded (settings/pollResponses flat map)
    const respDoc = await POLL_RESP_REF().get();
    const allResponses = respDoc.exists ? respDoc.data() : {};
    if (allResponses[currentUser.uid]) {
      showToast('You have already responded to this poll.', 'info');
      return;
    }

    // Load poll data from settings/activePoll
    const pollDoc = await POLL_META_REF().get();
    if (!pollDoc.exists || pollDoc.data().status !== 'open') {
      showToast('This registration poll is no longer open.', 'info');
      return;
    }

    userPendingPollId = pollDoc.data().id || 'activePoll';
    currentPollData   = { id: userPendingPollId, ...pollDoc.data() };
    openUserRegModal();
  } catch(e) {
    console.error('closeBroadcastFeedAndOpenPoll:', e);
    showToast('Could not load poll. Please try again.', 'error');
  }
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
//  CHECKLIST SECTION LOADER  (per-campaign template support)
// ═════════════════════════════════════════════════════════════
async function loadChecklistOverrides(campaignId) {
  try {
    // If a campaignId is provided and it has a template assigned, load that template
    if (campaignId && campaigns[campaignId]?.checklistTemplateId) {
      const tmplId = campaigns[campaignId].checklistTemplateId;
      const tmplDoc = await db.collection('settings').doc('checklistTemplates').get();
      if (tmplDoc.exists) {
        const templates = tmplDoc.data().templates || [];
        const tmpl = templates.find(t => t.id === tmplId);
        if (tmpl && tmpl.sections) {
          CHECKLIST_SECTIONS.length = 0;
          tmpl.sections.forEach(s => CHECKLIST_SECTIONS.push(s));
          window._TOTAL_ITEMS_OVERRIDE = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
          return;
        }
      }
    }
    // Fall back to global checklist override doc
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

// ═════════════════════════════════════════════════════════════
//  CHECKLIST TEMPLATES  (tab + centered editor modal)
// ═════════════════════════════════════════════════════════════
let checklistTemplates    = [];   // [{ id, name, sections }]
let editingTemplateId     = null;
let templateEditorSections = [];

// ── Load / Save ──────────────────────────────────────────────
async function loadChecklistTemplates() {
  try {
    const doc = await db.collection('settings').doc('checklistTemplates').get();
    checklistTemplates = doc.exists ? (doc.data().templates || []) : [];
    // Seed "Mega Campaign Checklist" from the default if no templates yet
    if (checklistTemplates.length === 0) {
      const defaultSections = JSON.parse(JSON.stringify(CHECKLIST_SECTIONS));
      checklistTemplates = [{
        id: 'tmpl_default',
        name: 'Mega Campaign Checklist',
        sections: defaultSections,
      }];
      await saveChecklistTemplates();
    }
  } catch(e) { console.warn('Could not load checklist templates', e); }
}

async function saveChecklistTemplates() {
  await db.collection('settings').doc('checklistTemplates').set({ templates: checklistTemplates });
}

// ── Tab render ───────────────────────────────────────────────
async function renderChecklistTab() {
  const host = document.getElementById('checklist-tab-content');
  if (!host) return;
  host.innerHTML = '<div style="padding:2rem;color:var(--text-muted);text-align:center;">Loading…</div>';
  await loadChecklistTemplates();
  renderChecklistTabContent();
}

function renderChecklistTabContent() {
  const host = document.getElementById('checklist-tab-content');
  if (!host) return;

  if (checklistTemplates.length === 0) {
    host.innerHTML = `
      <div style="padding:4rem;text-align:center;">
        <div style="font-size:48px;margin-bottom:14px;">📋</div>
        <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px;">No templates yet</div>
        <div style="color:var(--text-muted);margin-bottom:24px;">Create your first checklist template to assign to campaigns.</div>
        <button class="btn-primary" style="width:auto;padding:10px 24px;" onclick="openNewTemplateModal()">+ New Template</button>
      </div>`;
    return;
  }

  host.innerHTML = `
    <div class="tmpl-tab-grid">
      ${checklistTemplates.map((t, i) => {
        const itemCount = t.sections ? t.sections.reduce((s, sec) => s + sec.items.length, 0) : 0;
        const secCount  = t.sections ? t.sections.length : 0;
        const isDefault = t.id === 'tmpl_default';
        return `
        <div class="tmpl-card">
          <div class="tmpl-card-top">
            <div class="tmpl-card-name">${escHtml(t.name)}</div>
            ${isDefault ? '<span class="tmpl-card-badge">Default</span>' : ''}
          </div>
          <div class="tmpl-card-meta">${secCount} section${secCount !== 1 ? 's' : ''} · ${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
          <div class="tmpl-card-sections">
            ${(t.sections || []).map(s => `<span class="tmpl-sec-chip">${escHtml(s.title)}</span>`).join('')}
          </div>
          <div class="tmpl-card-actions">
            <button class="btn-ghost-light btn-sm" onclick="openEditTemplateModal(${i})">✏️ Edit</button>
            ${!isDefault ? `<button class="btn-ghost-light btn-sm" style="color:#DC2626;border-color:#FCA5A5;" onclick="deleteTemplate(${i})">🗑 Delete</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ── Open new template modal ──────────────────────────────────
async function openNewTemplateModal() {
  await loadChecklistTemplates();
  editingTemplateId = null;
  // Pre-populate with full default sections so admin can edit from there
  templateEditorSections = JSON.parse(JSON.stringify(CHECKLIST_SECTIONS));
  document.getElementById('tmpl-name-input').value = '';
  document.getElementById('tmpl-editor-modal-title').textContent = '✏️ New Template';
  document.getElementById('tmpl-editor-error').style.display = 'none';
  renderTmplEditor();
  document.getElementById('tmpl-editor-overlay').style.display = 'flex';
}

// ── Open edit template modal ─────────────────────────────────
function openEditTemplateModal(idx) {
  const t = checklistTemplates[idx];
  editingTemplateId = t.id;
  // If template has no sections yet, seed from default
  templateEditorSections = JSON.parse(JSON.stringify(
    t.sections && t.sections.length > 0 ? t.sections : CHECKLIST_SECTIONS
  ));
  document.getElementById('tmpl-name-input').value = t.name;
  document.getElementById('tmpl-editor-modal-title').textContent = `✏️ Edit: ${t.name}`;
  document.getElementById('tmpl-editor-error').style.display = 'none';
  renderTmplEditor();
  document.getElementById('tmpl-editor-overlay').style.display = 'flex';
}

function closeTmplEditorModal(e) {
  if (e && e.target !== document.getElementById('tmpl-editor-overlay')) return;
  document.getElementById('tmpl-editor-overlay').style.display = 'none';
}

// ── Inline drag-and-drop template editor ─────────────────────

let _tmplDragType = null;   // 'section' | 'item'
let _tmplDragSecIdx = null;
let _tmplDragItemIdx = null;

function renderTmplEditor() {
  const con = document.getElementById('tmpl-sections-container');
  if (!con) return;

  // Update stats badge
  const total = templateEditorSections.reduce((s, sec) => s + sec.items.length, 0);
  const statsEl = document.getElementById('tmpl-editor-stats');
  if (statsEl) statsEl.textContent = `${templateEditorSections.length} section${templateEditorSections.length !== 1 ? 's' : ''} · ${total} item${total !== 1 ? 's' : ''}`;

  if (templateEditorSections.length === 0) {
    con.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-muted);font-size:13px;">No sections yet. Click "+ Add Section" to get started.</div>`;
    return;
  }

  con.innerHTML = templateEditorSections.map((sec, si) => `
    <div class="tmpl-section-card"
      draggable="true"
      data-si="${si}"
      ondragstart="tmplSecDragStart(event,${si})"
      ondragover="tmplSecDragOver(event,${si})"
      ondrop="tmplSecDrop(event,${si})"
      ondragend="tmplDragEnd(event)">
      <div class="tmpl-section-hdr">
        <span class="tmpl-sec-grip" aria-hidden="true">⠿</span>
        <input class="tmpl-sec-title-input"
          value="${escHtml(sec.title)}"
          placeholder="Section name"
          onchange="templateEditorSections[${si}].title=this.value;renderTmplEditorStats()" />
        <span class="tmpl-sec-count">${sec.items.length} item${sec.items.length !== 1 ? 's' : ''}</span>
        <button class="btn-ghost-light tmpl-sec-del-btn" onclick="tmplDeleteSection(${si})">🗑</button>
      </div>
      <div class="tmpl-items-wrap">
        ${sec.items.length === 0
          ? `<div style="font-size:12px;color:var(--text-faint);padding:6px 4px;">No items yet.</div>`
          : sec.items.map((item, ii) => `
            <div class="tmpl-item-row"
              draggable="true"
              data-ii="${ii}"
              ondragstart="tmplItemDragStart(event,${si},${ii})"
              ondragover="tmplItemDragOver(event,${si},${ii})"
              ondrop="tmplItemDrop(event,${si},${ii})"
              ondragend="tmplDragEnd(event)">
              <span class="tmpl-item-grip" aria-hidden="true">⠿</span>
              <div class="tmpl-item-fields">
                <input class="tmpl-item-name-inp"
                  value="${escHtml(item.name)}"
                  placeholder="Item name…"
                  onchange="templateEditorSections[${si}].items[${ii}].name=this.value" />
                <input class="tmpl-item-guide-inp"
                  value="${escHtml(item.guide || '')}"
                  placeholder="Guide / description (optional)"
                  onchange="templateEditorSections[${si}].items[${ii}].guide=this.value" />
              </div>
              <button class="tmpl-item-del-btn" onclick="tmplDeleteItem(${si},${ii})" title="Remove item">✕</button>
            </div>`).join('')
        }
      </div>
      <button class="tmpl-add-item-btn" onclick="tmplAddItem(${si})">+ Add item</button>
    </div>
  `).join('');
}

function renderTmplEditorStats() {
  const total = templateEditorSections.reduce((s, sec) => s + sec.items.length, 0);
  const statsEl = document.getElementById('tmpl-editor-stats');
  if (statsEl) statsEl.textContent = `${templateEditorSections.length} section${templateEditorSections.length !== 1 ? 's' : ''} · ${total} item${total !== 1 ? 's' : ''}`;
}

function tmplAddSection() {
  templateEditorSections.push({ id: `sec_${Date.now()}`, title: 'New Section', items: [] });
  renderTmplEditor();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.tmpl-sec-title-input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  }, 50);
}

function tmplAddItem(si) {
  const sec = templateEditorSections[si];
  if (!sec) return;
  sec.items.push({ id: `${sec.id || 'sec'}_${Date.now()}`, name: '', guide: '' });
  renderTmplEditor();
  setTimeout(() => {
    const wrap = document.querySelectorAll('.tmpl-section-card')[si];
    if (wrap) {
      const inputs = wrap.querySelectorAll('.tmpl-item-name-inp');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    }
  }, 50);
}

function tmplDeleteSection(si) {
  if (!confirm(`Delete "${templateEditorSections[si].title}" and all its items?`)) return;
  templateEditorSections.splice(si, 1);
  renderTmplEditor();
}

function tmplDeleteItem(si, ii) {
  templateEditorSections[si].items.splice(ii, 1);
  renderTmplEditor();
}

// Drag — sections
function tmplSecDragStart(e, si) { _tmplDragType = 'section'; _tmplDragSecIdx = si; e.dataTransfer.effectAllowed = 'move'; }
function tmplSecDragOver(e, si)  { if (_tmplDragType === 'section' && _tmplDragSecIdx !== si) { e.preventDefault(); e.currentTarget.classList.add('drag-over-section'); } }
function tmplSecDrop(e, si) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over-section');
  if (_tmplDragType === 'section' && _tmplDragSecIdx !== si) {
    const moved = templateEditorSections.splice(_tmplDragSecIdx, 1)[0];
    templateEditorSections.splice(si, 0, moved);
    renderTmplEditor();
  }
}

// Drag — items
function tmplItemDragStart(e, si, ii) { _tmplDragType = 'item'; _tmplDragSecIdx = si; _tmplDragItemIdx = ii; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }
function tmplItemDragOver(e, si, ii)  { if (_tmplDragType === 'item') { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drag-over-item'); } }
function tmplItemDrop(e, si, ii) {
  e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over-item');
  if (_tmplDragType === 'item') {
    const item = templateEditorSections[_tmplDragSecIdx].items.splice(_tmplDragItemIdx, 1)[0];
    templateEditorSections[si].items.splice(ii, 0, item);
    renderTmplEditor();
  }
}
function tmplDragEnd(e) {
  document.querySelectorAll('.drag-over-section,.drag-over-item').forEach(el => el.classList.remove('drag-over-section', 'drag-over-item'));
  _tmplDragType = null; _tmplDragSecIdx = null; _tmplDragItemIdx = null;
}

// Legacy stubs so old calls from renderTmplEditorSection don't break
function populateTmplEditorSectionSel() { /* replaced by renderTmplEditor */ }
function renderTmplEditorSection() { renderTmplEditor(); }
function addTmplRow() { /* replaced — section-specific buttons now handle this */ }
function addTmplSection() { tmplAddSection(); }
function deleteTmplSection(idx) { tmplDeleteSection(idx); }
function deleteTmplItem(si, ii) { tmplDeleteItem(si, ii); }
function moveTmplItem() { /* replaced by drag */ }
function syncItemCardTitle() { /* no-op */ }

async function deleteTemplate(idx) {
  const t = checklistTemplates[idx];
  if (!confirm(`Delete template "${t.name}"?`)) return;
  checklistTemplates.splice(idx, 1);
  await saveChecklistTemplates();
  renderChecklistTabContent();
  showToast('Template deleted.', 'success');
}

async function saveTemplate() {
  const errEl = document.getElementById('tmpl-editor-error');
  const name  = document.getElementById('tmpl-name-input').value.trim();
  if (!name) { showError(errEl, 'Template name is required.'); return; }
  for (const sec of templateEditorSections) {
    if (!sec.title.trim()) { showError(errEl, 'All sections must have a title.'); return; }
    for (const item of sec.items) {
      if (!item.name.trim()) { showError(errEl, `Empty item name found in "${sec.title}". Please fill it in or remove it.`); return; }
    }
  }
  errEl.style.display = 'none';

  if (editingTemplateId) {
    const idx = checklistTemplates.findIndex(t => t.id === editingTemplateId);
    if (idx >= 0) {
      checklistTemplates[idx] = { ...checklistTemplates[idx], name, sections: JSON.parse(JSON.stringify(templateEditorSections)) };
    }
  } else {
    checklistTemplates.push({ id: `tmpl_${Date.now()}`, name, sections: JSON.parse(JSON.stringify(templateEditorSections)) });
  }

  try {
    await saveChecklistTemplates();
    document.getElementById('tmpl-editor-overlay').style.display = 'none';
    renderChecklistTabContent();
    showToast('✅ Template saved!', 'success');
  } catch(e) { showError(errEl, 'Failed to save template. Please try again.'); console.error(e); }
}

// ── Populate the template selector in the New Campaign modal ─
async function populateCampaignTemplateSel() {
  await loadChecklistTemplates();
  const sel = document.getElementById('campaign-template-sel');
  if (!sel) return;
  sel.innerHTML = `<option value="">None (use default checklist)</option>` +
    checklistTemplates.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
}

// ── Legacy stubs (kept so old calls don't break) ─────────────
function openEditorModal()  { switchAdminTab('checklist'); }
function closeEditorModal() { /* no-op — modal is gone */ }
function openTemplatesModal() { switchAdminTab('checklist'); }
function closeTemplatesModal() { /* no-op */ }
function showTemplatesListView() { /* no-op */ }
function showTemplateEditorView() { /* no-op */ }



// ═════════════════════════════════════════════════════════════
//  BRAND REGISTRATION POLL SYSTEM
// ═════════════════════════════════════════════════════════════
//
//  Firestore paths (uses existing permitted 'settings' collection):
//    /settings/activePoll          — poll metadata (name, desc, status, createdAt)
//    /settings/pollResponses       — flat map { [uid]: responseData }
//
//  Poll states: 'open' | 'closed'
//  Response states: 'registered' | 'skipped' | null (not responded)

// Helper refs — multi-poll support
// polls stored as individual docs in 'settings' collection: 'poll_{id}'
// responses stored per poll: 'pollResp_{pollId}'
const POLL_META_REF = (pollId) => db.collection('settings').doc(pollId || 'activePoll');
const POLL_RESP_REF = (pollId) => db.collection('settings').doc('pollResp_' + (pollId || 'activePoll'));
const POLLS_LIST_REF = () => db.collection('settings').doc('pollsList');

const PLATFORMS = ['Lazada', 'Shopee', 'TikTok', 'Zalora'];
const REGIONS   = ['MY', 'PH', 'SG', 'TH', 'VN', 'ID'];

let activePollId       = null;   // currently open poll (admin knows)
let currentPollData    = null;   // the poll document
let userPendingPollId  = null;   // poll the member has not yet responded to
let pollResponses      = {};     // { uid: responseDoc }
let regPollUnreadCount = 0;
let allPolls           = [];     // list of all polls [{id,name,desc,status,createdAt}]
let activePollTabId    = null;   // which poll tab is shown in admin

// ─── Admin: open "Create Registration Poll" modal ───────────
function openRegPollModal() {
  document.getElementById('reg-poll-name').value = '';
  document.getElementById('reg-poll-desc').value = '';
  document.getElementById('reg-poll-error').style.display = 'none';
  renderRegPollAdmin();
  document.getElementById('reg-poll-overlay').style.display = 'flex';
}

function closeRegPollModal(e) {
  if (e && e.target !== document.getElementById('reg-poll-overlay')) return;
  document.getElementById('reg-poll-overlay').style.display = 'none';
}

async function createRegPoll() {
  const name = document.getElementById('reg-poll-name').value.trim();
  const desc = document.getElementById('reg-poll-desc').value.trim();
  const errEl = document.getElementById('reg-poll-error');
  errEl.style.display = 'none';

  if (!name) { showError(errEl, 'Please enter a campaign name.'); return; }

  const btn = document.getElementById('reg-poll-create-btn');
  btn.textContent = 'Creating…'; btn.disabled = true;

  try {
    const pollId = 'poll_' + Date.now();
    const pollData = {
      id:        pollId,
      name, desc,
      status:    'open',
      createdAt: new Date().toISOString(),
      createdBy: ADMIN_UID,
    };

    // Save poll metadata as its own settings doc
    await POLL_META_REF(pollId).set(pollData);

    // Also update the polls list doc
    const listDoc = await POLLS_LIST_REF().get();
    const existingList = listDoc.exists ? (listDoc.data().polls || []) : [];
    existingList.unshift({ id: pollId, name, desc, status: 'open', createdAt: pollData.createdAt });
    await POLLS_LIST_REF().set({ polls: existingList });

    // Initialise empty responses doc for this poll
    await POLL_RESP_REF(pollId).set({});

    // Send "Register Now" broadcast automatically
    await db.collection('broadcasts').add({
      type:       'registration',
      message:    `📋 Registration is now open for "${name}"${desc ? '\n\n' + desc : ''}`,
      pollId:     pollId,
      targetUid:  null,
      targetName: 'everyone',
      campaignId: null,
      campaignName: null,
      sentAt:     new Date().toISOString(),
      sentBy:     'Admin',
      readBy:     [],
      isRegPoll:  true,
    });

    document.getElementById('reg-poll-overlay').style.display = 'none';
    await loadAdminData();
    switchAdminTab('registration');
  } catch(e) {
    showError(errEl, 'Failed to create poll. Try again.');
    console.error(e);
  } finally {
    btn.textContent = '📣 Create & Send'; btn.disabled = false;
  }
}

// ─── Admin: Registration tab render ─────────────────────────
async function loadAndRenderRegPollAdmin() {
  const host = document.getElementById('admin-tab-registration');
  if (!host) return;
  host.innerHTML = '<div style="padding:2rem;color:var(--text-muted);text-align:center;">Loading…</div>';

  try {
    // Load the polls list
    const listDoc = await POLLS_LIST_REF().get();
    allPolls = listDoc.exists ? (listDoc.data().polls || []) : [];

    // Legacy fallback: check old single-poll doc
    if (allPolls.length === 0) {
      const legacyDoc = await db.collection('settings').doc('activePoll').get();
      if (legacyDoc.exists) {
        const d = legacyDoc.data();
        allPolls = [{ id: d.id || 'activePoll', name: d.name, desc: d.desc, status: d.status, createdAt: d.createdAt }];
      }
    }

    if (allPolls.length === 0) {
      host.innerHTML = `
        <div style="padding:4rem;text-align:center;">
          <div style="font-size:56px;margin-bottom:14px;">📋</div>
          <div style="font-size:20px;font-weight:700;color:var(--navy);margin-bottom:8px;">No registration polls yet</div>
          <div style="color:var(--text-muted);margin-bottom:24px;max-width:400px;margin-left:auto;margin-right:auto;line-height:1.6;">
            Create a poll to collect brand, platform and region registrations from your team.<br>A "Register Now" broadcast is sent automatically.
          </div>
          <button class="btn-primary" style="width:auto;padding:12px 28px;font-size:15px;" onclick="openRegPollModal()">📣 Create Registration Poll</button>
        </div>`;
      return;
    }

    // Show the first (most recent) poll tab by default
    activePollTabId = activePollTabId || allPolls[0].id;
    // Ensure the selected tab poll exists
    if (!allPolls.find(p => p.id === activePollTabId)) activePollTabId = allPolls[0].id;

    await loadPollTabData(activePollTabId);
    renderRegPollAdminWithTabs();
  } catch(e) {
    console.error('loadAndRenderRegPollAdmin error:', e);
    const isPermErr = e.message && e.message.toLowerCase().includes('permission');
    host.innerHTML = `
      <div style="padding:3rem 2rem;text-align:center;max-width:540px;margin:0 auto;">
        <div style="font-size:48px;margin-bottom:14px;">${isPermErr ? '🔒' : '⚠️'}</div>
        <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px;">
          ${isPermErr ? 'Firestore permissions required' : 'Failed to load registration data'}
        </div>
        <div style="color:var(--text-muted);font-size:13px;line-height:1.7;margin-bottom:20px;">
          ${isPermErr
            ? 'Unable to load registration data. Please check your Firestore security rules allow access to the <code>settings</code> collection.'
            : e.message}
        </div>
        <button class="btn-primary" style="width:auto;padding:10px 24px;font-size:14px;" onclick="openRegPollModal()">📋 Create Registration Poll</button>
      </div>`;
  }
}

async function loadPollTabData(pollId) {
  // Load full poll metadata
  const pollDoc = await POLL_META_REF(pollId).get();
  if (!pollDoc.exists) {
    // fallback to list data
    currentPollData = allPolls.find(p => p.id === pollId) || null;
  } else {
    currentPollData = { id: pollDoc.data().id || pollId, ...pollDoc.data() };
  }
  activePollId = pollId;
  const respDoc = await POLL_RESP_REF(pollId).get();
  pollResponses = respDoc.exists ? respDoc.data() : {};
}

async function switchPollTab(pollId) {
  activePollTabId = pollId;
  await loadPollTabData(pollId);
  renderRegPollAdminWithTabs();
}

function renderRegPollAdminWithTabs() {
  const host = document.getElementById('admin-tab-registration');
  if (!host) return;

  const tabsHtml = allPolls.map(p => {
    const isActive = p.id === activePollTabId;
    const statusDot = p.status === 'open' ? '🟢' : '🔴';
    return `<button class="poll-tab-btn ${isActive ? 'active' : ''}" onclick="switchPollTab('${p.id}')">${statusDot} ${escHtml(p.name)}</button>`;
  }).join('');

  const headerHtml = `
    <div class="reg-poll-tabs-header">
      <div class="reg-poll-tabs-list">${tabsHtml}</div>
      <button class="btn-primary" style="font-size:12px;width:auto;padding:7px 16px;background:#4F46E5;flex-shrink:0;" onclick="openRegPollModal()">📋 New Poll</button>
    </div>`;

  // Render the poll content section below the tabs
  const pollContentId = 'reg-poll-content-area';
  host.innerHTML = headerHtml + `<div id="${pollContentId}"></div>`;

  renderRegPollAdmin();
}

function renderRegPollAdmin() {
  // When tabs are shown, write to content area; otherwise write to main tab
  const host = document.getElementById('reg-poll-content-area') || document.getElementById('admin-tab-registration');
  if (!host) return;
  if (!currentPollData) { loadAndRenderRegPollAdmin(); return; }

  const poll = currentPollData;
  const isOpen = poll.status === 'open';
  const isLocked = poll.status === 'locked';

  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  const registered = [];
  const skipped    = [];
  const pending    = [];

  nonAdmins.forEach(m => {
    const resp = pollResponses[m.uid];
    if (!resp) { pending.push(m); return; }
    if (resp.status === 'skipped') { skipped.push({ member: m, resp }); return; }
    registered.push({ member: m, resp });
  });

  // Summarise registrations by platform
  const byPlatform = {};
  registered.forEach(({ resp }) => {
    (resp.registrations || []).forEach(r => {
      const key = r.platform;
      if (!byPlatform[key]) byPlatform[key] = 0;
      byPlatform[key]++;
    });
  });

  const totalMembers = nonAdmins.length;
  const respondedCount = registered.length + skipped.length;
  const responsePct = totalMembers > 0 ? Math.round((respondedCount / totalMembers) * 100) : 0;

  host.innerHTML = `
    <div class="reg-poll-admin-wrap">

      <!-- Poll header card -->
      <div class="reg-poll-header-card">
        <div class="reg-poll-header-left">
          <div class="reg-poll-status-pill ${poll.status === 'open' ? 'rp-open' : poll.status === 'locked' ? 'rp-locked' : 'rp-closed'}">${poll.status === 'open' ? '🟢 Open' : poll.status === 'locked' ? '🔒 Locked' : '🔴 Closed'}</div>
          <div class="reg-poll-title">${escHtml(poll.name)}</div>
          ${poll.desc ? `<div class="reg-poll-sub">${escHtml(poll.desc)}</div>` : ''}
        </div>
        <div class="reg-poll-header-right">
          ${isOpen && !isLocked ? `<button class="btn-outline" style="border-color:#FCA5A5;color:#FCA5A5;font-size:12px;" onclick="closeRegPoll()">🔒 Close Poll</button>` : ''}
          <button class="btn-outline" style="border-color:#FCA5A5;color:#DC2626;font-size:12px;background:rgba(220,38,38,0.07);" onclick="deleteRegPoll('${poll.id}')">🗑 Delete Poll</button>
        </div>
      </div>

      <!-- Stats row -->
      <div class="reg-poll-stats">
        <div class="rp-stat-card">
          <div class="rp-stat-num" style="color:var(--blue)">${totalMembers}</div>
          <div class="rp-stat-label">Total members</div>
        </div>
        <div class="rp-stat-card">
          <div class="rp-stat-num" style="color:#059669">${registered.length}</div>
          <div class="rp-stat-label">Registered</div>
        </div>
        <div class="rp-stat-card">
          <div class="rp-stat-num" style="color:#D97706">${skipped.length}</div>
          <div class="rp-stat-label">Skipped</div>
        </div>
        <div class="rp-stat-card">
          <div class="rp-stat-num" style="color:#DC2626">${pending.length}</div>
          <div class="rp-stat-label">No response</div>
        </div>
        <div class="rp-stat-card rp-stat-wide">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:12px;color:var(--text-muted);">Response rate</span>
            <span style="font-size:12px;font-weight:600;">${responsePct}%</span>
          </div>
          <div class="mini-bar" style="margin:0;"><div class="mini-track" style="height:8px;"><div class="mini-fill" style="width:${responsePct}%;height:8px;"></div></div></div>
        </div>
      </div>

      <!-- Registered brands -->
      <div class="reg-poll-section-grid">

        <div class="reg-poll-col">
          <div class="reg-poll-col-header" style="color:#059669;">
            ✅ Registered (${registered.length})
            ${registered.length > 0 ? `<button class="btn-outline" style="font-size:11px;padding:3px 10px;background:#059669;border-color:#059669;" onclick="createCampaignFromPoll()">➕ Create Campaign from Poll</button>` : ''}
          </div>
          <div class="rp-member-list">
            ${registered.length === 0 ? '<div class="rp-empty">No registrations yet.</div>' : `
              <table class="rp-reg-table">
                <thead>
                  <tr>
                    <th>CDM</th>
                    <th>Brand</th>
                    <th>Platform</th>
                    <th>Region</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  ${registered.map(({ member, resp }) =>
                    (resp.registrations || [{ brand: '', platform: '', region: '' }]).map((r, ri) => `
                      <tr>
                        ${ri === 0 ? `<td rowspan="${(resp.registrations||[{}]).length}" class="rp-cdm-cell">${escHtml(member.name || member.username)}</td>` : ''}
                        <td>${escHtml(r.brand || '—')}</td>
                        <td><span class="rp-reg-tag">${escHtml(r.platform)}</span></td>
                        <td><span class="rp-reg-tag">${escHtml(r.region)}</span></td>
                        ${ri === 0 ? `<td rowspan="${(resp.registrations||[{}]).length}" style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${resp.submittedAt ? new Date(resp.submittedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}</td>` : ''}
                      </tr>`
                    ).join('')
                  ).join('')}
                </tbody>
              </table>`
            }
          </div>
        </div>

        <div class="reg-poll-col">
          <div class="reg-poll-col-header" style="color:#D97706;">⏭ Skipped (${skipped.length})</div>
          <div class="rp-member-list">
            ${skipped.length === 0 ? '<div class="rp-empty">No one skipped.</div>' :
              skipped.map(({ member, resp }) => `
                <div class="rp-member-card rp-skipped">
                  <div class="rp-member-name">${escHtml(member.name || member.username)}</div>
                  ${resp.note ? `<div class="rp-note">"${escHtml(resp.note)}"</div>` : ''}
                  <div class="rp-time">${resp.submittedAt ? new Date(resp.submittedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : ''}</div>
                </div>
              `).join('')
            }
          </div>

          <div class="reg-poll-col-header" style="color:#DC2626;margin-top:16px;">❓ No Response (${pending.length})
            ${pending.length > 0 ? `<button class="btn-outline" style="font-size:11px;padding:3px 10px;background:#DC2626;border-color:#DC2626;" onclick="sendPollReminder()">📣 Send Reminder</button>` : ''}
          </div>
          <div class="rp-member-list">
            ${pending.length === 0 ? '<div class="rp-empty" style="color:#059669;">🎉 Everyone responded!</div>' :
              pending.map(m => `
                <div class="rp-member-card rp-pending">
                  <div class="rp-member-name">${escHtml(m.name || m.username)}</div>
                  <div style="font-size:11px;color:var(--text-muted);">@${escHtml(m.username)} — hasn't responded yet</div>
                </div>
              `).join('')
            }
          </div>
        </div>

      </div>
    </div>
  `;
}

async function closeRegPoll() {
  if (!currentPollData || !activePollId) return;
  if (!confirm('Close this poll? Members will no longer be able to register.')) return;
  await POLL_META_REF(activePollId).set({ status: 'closed' }, { merge: true });
  currentPollData.status = 'closed';
  // Update polls list
  const listDoc = await POLLS_LIST_REF().get();
  if (listDoc.exists) {
    const polls = listDoc.data().polls || [];
    const idx = polls.findIndex(p => p.id === activePollId);
    if (idx >= 0) { polls[idx].status = 'closed'; await POLLS_LIST_REF().set({ polls }); }
  }
  allPolls = allPolls.map(p => p.id === activePollId ? { ...p, status: 'closed' } : p);
  renderRegPollAdminWithTabs();
}

// ─── Admin: Delete a poll and all its response records ───────
async function deleteRegPoll(pollId) {
  const poll = allPolls.find(p => p.id === pollId);
  if (!poll) return;
  if (!confirm(`Delete poll "${poll.name}"?\n\nThis will permanently delete the poll and ALL member responses. This cannot be undone.`)) return;
  try {
    // Delete poll metadata doc
    await POLL_META_REF(pollId).delete();
    // Delete poll responses doc
    await POLL_RESP_REF(pollId).delete();
    // Remove from the polls list doc
    const listDoc = await POLLS_LIST_REF().get();
    if (listDoc.exists) {
      const polls = (listDoc.data().polls || []).filter(p => p.id !== pollId);
      await POLLS_LIST_REF().set({ polls });
    }
    // Remove from local state and switch to next poll if needed
    allPolls = allPolls.filter(p => p.id !== pollId);
    if (activePollTabId === pollId) {
      activePollTabId = allPolls.length > 0 ? allPolls[0].id : null;
      currentPollData = null;
      pollResponses = {};
    }
    if (allPolls.length > 0 && activePollTabId) {
      await loadPollTabData(activePollTabId);
      renderRegPollAdminWithTabs();
    } else {
      await loadAndRenderRegPollAdmin();
    }
    showToast('✅ Poll deleted.', 'success');
  } catch(e) {
    showToast('Failed to delete poll. Try again.', 'error');
    console.error(e);
  }
}


// ─── Admin: Send reminder to non-responders ─────────────────
async function sendPollReminder() {
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  const pending = nonAdmins.filter(m => {
    const resp = pollResponses[m.uid];
    return !resp;
  });
  if (pending.length === 0) { showToast('Everyone has already responded!', 'info'); return; }
  if (!confirm(`Send a reminder to ${pending.length} member(s) who haven't responded yet?`)) return;

  try {
    await db.collection('broadcasts').add({
      type:       'nudge',
      message:    `⏰ Reminder: Please respond to the registration poll "${currentPollData?.name || ''}" — your response is needed!`,
      targetUid:  null,
      targetName: 'pending-poll',
      targetUids: pending.map(m => m.uid),
      pollId:     activePollId,
      sentAt:     new Date().toISOString(),
      sentBy:     'Admin',
      readBy:     [],
    });
    showToast(`✅ Reminder sent to ${pending.length} member(s)!`, 'success');
  } catch(e) { showToast('Failed to send reminder.', 'error'); console.error(e); }
}

// ─── Admin: Create Campaign from Poll results ────────────────
async function createCampaignFromPoll() {
  if (!currentPollData || !activePollId) return;

  const registered = Object.values(members).filter(m => {
    const resp = pollResponses[m.uid];
    return resp && resp.status === 'registered';
  });

  if (registered.length === 0) {
    showToast('No registrations to create a campaign from.', 'info');
    return;
  }

  const campName = currentPollData.name;

  // Show the campaign creation modal with poll data pre-filled
  const list = document.getElementById('member-assign-list');
  const nonAdmins = Object.values(members).filter(m => m.role !== 'admin');
  list.innerHTML = nonAdmins.map(m => {
    const resp = pollResponses[m.uid];
    const isRegistered = resp && resp.status === 'registered';
    return `<div class="member-chip ${isRegistered ? 'selected' : ''}" data-uid="${m.uid}" onclick="toggleChip(this)">${m.name || m.username}${isRegistered ? ' ✓' : ''}</div>`;
  }).join('');

  document.getElementById('new-campaign-name').value = campName;
  document.getElementById('modal-error').style.display = 'none';

  // Override the createCampaign function temporarily to also save poll prefill data
  document.getElementById('modal-overlay').dataset.pollId = activePollId;
  document.getElementById('modal-overlay').style.display = 'flex';
}


// ─── Member: check for pending registration poll ─────────────
async function checkForPendingPoll() {
  if (!currentUser || currentUser.role === 'admin') return;

  try {
    // Find the most recent open poll the user hasn't responded to
    const listDoc = await POLLS_LIST_REF().get();
    let pollsList = listDoc.exists ? (listDoc.data().polls || []) : [];

    // Legacy fallback
    if (pollsList.length === 0) {
      const legacyDoc = await db.collection('settings').doc('activePoll').get();
      if (legacyDoc.exists) {
        const d = legacyDoc.data();
        pollsList = [{ id: d.id || 'activePoll', ...d }];
      }
    }

    const openPolls = pollsList.filter(p => p.status === 'open'); // locked/closed excluded
    if (openPolls.length === 0) return;

    // Check each open poll for an unanswered one
    let pendingPoll = null;
    for (const p of openPolls) {
      const respDoc = await POLL_RESP_REF(p.id).get();
      const allResponses = respDoc.exists ? respDoc.data() : {};
      if (!allResponses[currentUser.uid]) { pendingPoll = p; break; }
    }
    if (!pendingPoll) return;

    const openPoll = pendingPoll;
    const pollId = openPoll.id;

    // If poll metadata needs full data, load it
    if (!openPoll.name) {
      const pollDoc = await POLL_META_REF(pollId).get();
      if (!pollDoc.exists) return;
      Object.assign(openPoll, pollDoc.data());
    }

    // Check if user has already responded (kept for clarity, already checked above)
    const respDoc = await POLL_RESP_REF(pollId).get();
    const allResponses = respDoc.exists ? respDoc.data() : {};
    if (allResponses[currentUser.uid]) return; // already responded

    userPendingPollId = pollId;
    currentPollData   = openPoll;

    // Mark broadcast as read + update badge
    await checkBroadcastBadge();

    // Show the register button in header
    const regBtn = document.getElementById('user-reg-poll-btn');
    if (regBtn) regBtn.style.display = 'inline-flex';

    // Show the registration modal automatically
    openUserRegModal();
  } catch(e) { console.error('checkForPendingPoll:', e); }
}

// ─── Member: Registration modal ──────────────────────────────
function openUserRegModal() {
  if (!currentPollData) return;

  document.getElementById('user-reg-poll-title').textContent = currentPollData.name;
  document.getElementById('user-reg-poll-desc').textContent  = currentPollData.desc || '';
  document.getElementById('user-reg-error').style.display    = 'none';

  // Reset form
  renderUserRegForm();
  document.getElementById('user-reg-overlay').style.display = 'flex';
}

function closeUserRegModal(e) {
  if (e && e.target !== document.getElementById('user-reg-overlay')) return;
  document.getElementById('user-reg-overlay').style.display = 'none';
}

let userRegEntries = [{ platform: '', region: '', brand: '' }];

function renderUserRegForm() {
  userRegEntries = [{ platform: '', region: '', brand: '' }];
  document.getElementById('user-reg-form-body').innerHTML = buildUserRegRows();
}

function buildUserRegRows() {
  return userRegEntries.map((entry, i) => `
    <tr id="ureg-entry-${i}">
      <td style="text-align:center;color:var(--text-muted);font-size:12px;">${i + 1}</td>
      <td>
        <input type="text" placeholder="e.g. L'Oréal" value="${escHtml(entry.brand)}"
          oninput="userRegEntries[${i}].brand = this.value"
          style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;width:100%;" />
      </td>
      <td>
        <select onchange="userRegEntries[${i}].platform = this.value"
          style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;width:100%;">
          <option value="">Select…</option>
          ${PLATFORMS.map(p => `<option value="${p}" ${entry.platform===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </td>
      <td>
        <select onchange="userRegEntries[${i}].region = this.value"
          style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;width:100%;">
          <option value="">Select…</option>
          ${REGIONS.map(r => `<option value="${r}" ${entry.region===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </td>
      <td style="text-align:center;">
        ${i > 0
          ? `<button onclick="removeUserRegEntry(${i})" title="Remove row"
              style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#FCA5A5;border-radius:50%;width:24px;height:24px;font-size:12px;cursor:pointer;">✕</button>`
          : `<button onclick="addUserRegEntry()" title="Add row"
              style="background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.3);color:#60A5FA;border-radius:50%;width:24px;height:24px;font-size:14px;cursor:pointer;line-height:1;">+</button>`
        }
      </td>
    </tr>
  `).join('');
}

function addUserRegEntry() {
  userRegEntries.push({ platform: '', region: '', brand: '' });
  document.getElementById('user-reg-form-body').innerHTML = buildUserRegRows();
}

function removeUserRegEntry(i) {
  userRegEntries.splice(i, 1);
  document.getElementById('user-reg-form-body').innerHTML = buildUserRegRows();
}

async function submitUserRegistration() {
  const errEl = document.getElementById('user-reg-error');
  errEl.style.display = 'none';

  // Validate
  for (let i = 0; i < userRegEntries.length; i++) {
    const e = userRegEntries[i];
    if (!e.platform) { showError(errEl, `Entry ${i+1}: please select a platform.`); return; }
    if (!e.region)   { showError(errEl, `Entry ${i+1}: please select a region.`); return; }
  }

  const note = document.getElementById('user-reg-note').value.trim();
  const btn  = document.getElementById('user-reg-submit-btn');
  btn.textContent = 'Submitting…'; btn.disabled = true;

  try {
    // Write to per-poll responses doc using dot-notation field update
    await POLL_RESP_REF(userPendingPollId || activePollId).set({
      [currentUser.uid]: {
        status:        'registered',
        registrations: userRegEntries.map(e => ({
          brand:    e.brand || '',
          platform: e.platform,
          region:   e.region,
        })),
        note:        note,
        submittedAt: new Date().toISOString(),
        memberName:  currentUser.name || currentUser.username,
      }
    }, { merge: true });

    document.getElementById('user-reg-overlay').style.display = 'none';
    userPendingPollId = null;

    // Show success toast
    showToast('✅ Registration submitted!', 'success');
  } catch(e) {
    showError(errEl, 'Failed to submit. Please try again.');
    console.error(e);
  } finally {
    btn.textContent = 'Submit Registration'; btn.disabled = false;
  }
}

async function skipUserRegistration() {
  if (!userPendingPollId) return;
  const note = document.getElementById('user-reg-skip-note')?.value?.trim() || '';

  try {
    await POLL_RESP_REF(userPendingPollId || activePollId).set({
      [currentUser.uid]: {
        status:      'skipped',
        note:        note,
        submittedAt: new Date().toISOString(),
        memberName:  currentUser.name || currentUser.username,
      }
    }, { merge: true });
    document.getElementById('user-reg-overlay').style.display = 'none';
    userPendingPollId = null;
    showToast('Registration skipped.', 'info');
  } catch(e) { showToast('Failed to skip. Try again.', 'warn'); }
}



// ═════════════════════════════════════════════════════════════
//  REPORTS TAB
// ═════════════════════════════════════════════════════════════
async function renderReportTab() {
  const host = document.getElementById('report-tab-content');
  if (!host) return;
  host.innerHTML = '<div style="padding:2rem;color:var(--text-muted);text-align:center;">Loading report data…</div>';

  // Populate campaign filter
  const filterSel = document.getElementById('report-campaign-filter');
  if (filterSel) {
    filterSel.innerHTML = '<option value="">All campaigns</option>';
    Object.values(campaigns).forEach(c => {
      filterSel.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`;
    });
  }
  const filterCamp = filterSel ? filterSel.value : '';

  try {
    const checkSnap = await db.collection('checklists').get();
    const allChecklists = {};
    checkSnap.forEach(doc => { allChecklists[doc.id] = doc.data(); });

    const campList = filterCamp
      ? [campaigns[filterCamp]].filter(Boolean)
      : Object.values(campaigns);

    if (campList.length === 0) {
      host.innerHTML = '<div style="padding:3rem;text-align:center;color:var(--text-muted);">No campaigns found.</div>';
      return;
    }

    window._reportData = { campList, allChecklists };

    const today     = new Date(); today.setHours(0,0,0,0);
    const fmtDate   = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const daysDiff  = (isoA, isoB) => Math.ceil((new Date(isoA) - new Date(isoB)) / 86400000);

    let html = '';

    campList.forEach(camp => {
      const deadline     = camp.deadline ? new Date(camp.deadline) : null;
      const dday         = camp.dday     ? new Date(camp.dday)     : null;
      const deadlineStr  = camp.deadline ? fmtDate(camp.deadline)  : null;
      const ddayStr      = camp.dday     ? fmtDate(camp.dday)      : null;
      const deadlinePast = deadline && deadline < today;
      const daysToDeadline = deadline ? daysDiff(deadline, today) : null;

      const rows = [];
      (camp.assignedUids || []).forEach(uid => {
        const member = members[uid];
        if (!member) return;
        const cl      = (allChecklists[uid] || {})[camp.id] || {};
        const d5Done  = countDone(cl.d5 || {});
        const d1Done  = countDone(cl.d1 || {});
        const ti      = TOTAL_ITEMS;
        const entries = cl.entries || [];
        const overallPct  = Math.round(((d5Done + d1Done) / (ti * 2)) * 100);
        const d5Pct       = Math.round((d5Done / ti) * 100);
        const d1Pct       = Math.round((d1Done / ti) * 100);
        const startedAt   = cl.startedAt   || null;
        const completedAt = cl.completedAt || null;
        const lastActive  = cl.lastActive  || null;

        // Auto-detect completion: mark completedAt if 100% and not already set
        const isComplete  = overallPct === 100;

        // Deadline analysis
        let deadlineStatus = null; // 'on-time' | 'late' | 'at-risk' | 'overdue' | null
        let deadlineDelta  = null; // days relative to deadline (negative = late)
        if (deadline) {
          if (isComplete && completedAt) {
            const completedDay = new Date(completedAt); completedDay.setHours(0,0,0,0);
            deadlineDelta = daysDiff(deadline, completedDay);
            deadlineStatus = deadlineDelta >= 0 ? 'on-time' : 'late';
          } else if (!isComplete) {
            if (deadlinePast) {
              deadlineStatus = 'overdue';
              deadlineDelta  = daysDiff(today, deadline); // positive = how many days overdue
            } else if (daysToDeadline !== null && daysToDeadline <= 3) {
              deadlineStatus = 'at-risk';
            }
          }
        }

        const status    = isComplete ? 'Complete' : overallPct > 0 ? 'In Progress' : 'Not Started';
        const statusCls = isComplete ? 'badge-done' : overallPct > 0 ? 'badge-partial' : 'badge-pending';

        rows.push({
          member, camp, cl, entries,
          d5Done, d1Done, d5Pct, d1Pct, overallPct,
          lastActive, startedAt, completedAt, isComplete,
          status, statusCls, deadlineStatus, deadlineDelta,
        });
      });

      const total       = rows.length;
      const complete    = rows.filter(r => r.isComplete).length;
      const inProg      = rows.filter(r => r.overallPct > 0 && !r.isComplete).length;
      const notStarted  = rows.filter(r => r.overallPct === 0).length;
      const atRisk      = rows.filter(r => r.deadlineStatus === 'at-risk').length;
      const overdue     = rows.filter(r => r.deadlineStatus === 'overdue').length;
      const late        = rows.filter(r => r.deadlineStatus === 'late').length;
      const onTime      = rows.filter(r => r.deadlineStatus === 'on-time').length;
      const avgPct      = total > 0 ? Math.round(rows.reduce((s,r) => s + r.overallPct, 0) / total) : 0;

      // Deadline pill for header
      let deadlinePillHtml = '';
      if (deadlineStr) {
        const cls = deadlinePast ? 'rs-stat-red' : daysToDeadline <= 3 ? 'rs-stat-amber' : 'rs-stat-green';
        const label = deadlinePast
          ? `⚠️ Deadline passed (${deadlineStr})`
          : daysToDeadline === 0 ? `🔴 Deadline TODAY`
          : daysToDeadline === 1 ? `🔴 Deadline TOMORROW`
          : `📅 Deadline in ${daysToDeadline}d (${deadlineStr})`;
        deadlinePillHtml = `<span class="rs-stat ${cls}" style="font-size:12px;">${label}</span>`;
      }
      if (ddayStr) {
        const ddayDiff = daysDiff(dday, today);
        const ddayCls  = ddayDiff <= 0 ? 'rs-stat-red' : ddayDiff <= 5 ? 'rs-stat-amber' : 'rs-stat-navy';
        const ddayLabel = ddayDiff === 0 ? '🔴 D-Day TODAY' : ddayDiff < 0 ? `🔴 D-Day was ${Math.abs(ddayDiff)}d ago` : `📌 D-Day in ${ddayDiff}d (${ddayStr})`;
        deadlinePillHtml += ` <span class="rs-stat ${ddayCls}" style="font-size:12px;">${ddayLabel}</span>`;
      }

      // At-risk / overdue warning banner
      let riskBannerHtml = '';
      if (overdue > 0 || atRisk > 0) {
        riskBannerHtml = `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.2);border-radius:var(--radius);">
            <span style="font-size:13px;font-weight:600;color:#DC2626;">⚠ Completion Issues</span>
            ${overdue > 0 ? `<span style="font-size:12px;background:#FEE2E2;color:#991B1B;padding:2px 10px;border-radius:99px;font-weight:600;">${overdue} overdue</span>` : ''}
            ${atRisk  > 0 ? `<span style="font-size:12px;background:#FEF3C7;color:#92400E;padding:2px 10px;border-radius:99px;font-weight:600;">${atRisk} at risk (≤3 days)</span>` : ''}
            ${late    > 0 ? `<span style="font-size:12px;background:#FEE2E2;color:#991B1B;padding:2px 10px;border-radius:99px;font-weight:600;">${late} completed late</span>` : ''}
          </div>`;
      }

      // Deadline status badge helper
      const deadlineBadge = (r) => {
        if (!r.deadlineStatus) return '<span style="color:var(--text-faint);font-size:11px;">—</span>';
        const map = {
          'on-time': [`background:#D1FAE5;color:#065F46`, `✅ On time${r.deadlineDelta != null ? ` (+${r.deadlineDelta}d)` : ''}`],
          'late':    [`background:#FEE2E2;color:#991B1B`, `❌ Late (${Math.abs(r.deadlineDelta)}d)`],
          'at-risk': [`background:#FEF3C7;color:#92400E`, `⚠ At risk`],
          'overdue': [`background:#FEE2E2;color:#991B1B`, `🔴 Overdue +${r.deadlineDelta}d`],
        };
        const [style, label] = map[r.deadlineStatus];
        return `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;${style};">${label}</span>`;
      };

      html += `
        <div class="report-section">
          <div class="report-section-header">
            <div class="report-section-title">${escHtml(camp.name)}</div>
            <div class="report-section-stats" style="flex-wrap:wrap;gap:6px;">
              <span class="rs-stat rs-stat-blue">${total} members</span>
              <span class="rs-stat rs-stat-green">${complete} complete</span>
              <span class="rs-stat rs-stat-amber">${inProg} in progress</span>
              <span class="rs-stat rs-stat-red">${notStarted} not started</span>
              <span class="rs-stat rs-stat-navy">Avg ${avgPct}%</span>
              ${onTime > 0 ? `<span class="rs-stat" style="background:#D1FAE5;color:#065F46;">${onTime} on-time ✅</span>` : ''}
              ${deadlinePillHtml}
            </div>
          </div>

          <!-- Summary progress bar -->
          <div style="margin:10px 0 6px;">
            <div style="display:flex;gap:3px;height:8px;border-radius:4px;overflow:hidden;">
              <div style="width:${total>0?Math.round(complete/total*100):0}%;background:#059669;"></div>
              <div style="width:${total>0?Math.round(inProg/total*100):0}%;background:#D97706;"></div>
              <div style="width:${total>0?Math.round(notStarted/total*100):0}%;background:#DC2626;"></div>
            </div>
            <div style="display:flex;gap:14px;margin-top:5px;font-size:11px;color:var(--text-muted);">
              <span>🟢 Complete: ${total>0?Math.round(complete/total*100):0}%</span>
              <span>🟡 In Progress: ${total>0?Math.round(inProg/total*100):0}%</span>
              <span>🔴 Not Started: ${total>0?Math.round(notStarted/total*100):0}%</span>
            </div>
          </div>

          ${riskBannerHtml}

          <div class="report-table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>D-5</th>
                  <th>D-1</th>
                  <th>Overall</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Last Active</th>
                  <th>Completed</th>
                  ${deadline ? '<th>vs Deadline</th>' : ''}
                  <th>Registrations</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length === 0
                  ? `<tr><td colspan="${deadline ? 10 : 9}" style="text-align:center;color:var(--text-muted);">No members assigned.</td></tr>`
                  : rows.map(r => {
                    const isAtRisk = r.deadlineStatus === 'at-risk' || r.deadlineStatus === 'overdue';
                    const regLines = r.entries.map(e=>[e.brand,e.platform,e.region].filter(Boolean).join(' · ')).filter(Boolean);
                    const regId    = `reg-${r.member.uid}-${r.camp.id}`;
                    const regHtml  = regLines.length === 0 ? '—'
                      : regLines.length <= 2 ? regLines.join('<br>')
                      : `<div><span>${escHtml(regLines[0])}</span><span id="${regId}-more" style="display:none;">${regLines.slice(1).map(l=>'<br>'+escHtml(l)).join('')}</span><br><button onclick="toggleRegList('${regId}')" id="${regId}-btn" style="font-size:10px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0;margin-top:2px;">+${regLines.length-1} more</button></div>`;
                    return `<tr style="${isAtRisk ? 'background:rgba(220,38,38,0.03);' : ''}">
                      <td>
                        <strong>${escHtml(r.member.name || r.member.username)}</strong><br>
                        <span style="font-size:11px;color:var(--text-muted)">@${escHtml(r.member.username)}</span>
                      </td>
                      <td>${miniBar(r.d5Pct)} ${r.d5Done}/${TOTAL_ITEMS}</td>
                      <td>${miniBar(r.d1Pct)} ${r.d1Done}/${TOTAL_ITEMS}</td>
                      <td><strong style="color:${r.isComplete?'#059669':r.overallPct>0?'#D97706':'#DC2626'}">${r.overallPct}%</strong></td>
                      <td><span class="badge ${r.statusCls}">${r.status}</span></td>
                      <td style="font-size:12px;color:var(--text-muted)">${r.startedAt ? fmtDate(r.startedAt) : r.overallPct > 0 ? fmtDate(r.lastActive) : '—'}</td>
                      <td style="font-size:12px;color:var(--text-muted)">${r.lastActive ? fmtDate(r.lastActive) : '—'}</td>
                      <td style="font-size:12px;">${r.isComplete ? `<span style="color:#059669;font-weight:600;">${r.completedAt ? fmtDate(r.completedAt) : '✅ Done'}</span>` : '<span style="color:var(--text-faint);">—</span>'}</td>
                      ${deadline ? `<td>${deadlineBadge(r)}</td>` : ''}
                      <td style="font-size:12px;">${regHtml}</td>
                    </tr>`;
                  }).join('')
                }
              </tbody>
            </table>
          </div>
        </div>`;
    });

    host.innerHTML = html;

    // Auto-track completedAt: for any row that is 100% but missing completedAt, write it now
    campList.forEach(camp => {
      (camp.assignedUids || []).forEach(uid => {
        const cl = (allChecklists[uid] || {})[camp.id] || {};
        const d5Done = countDone(cl.d5 || {});
        const d1Done = countDone(cl.d1 || {});
        const overallPct = Math.round(((d5Done + d1Done) / (TOTAL_ITEMS * 2)) * 100);
        if (overallPct === 100 && !cl.completedAt) {
          const updateData = {};
          updateData[`${camp.id}.completedAt`] = cl.lastActive || new Date().toISOString();
          if (!cl.startedAt) updateData[`${camp.id}.startedAt`] = cl.lastActive || new Date().toISOString();
          db.collection('checklists').doc(uid).update(updateData).catch(() => {});
        }
      });
    });

  } catch(e) {
    host.innerHTML = `<div style="padding:2rem;color:var(--text-muted);">Error loading report: ${escHtml(e.message)}</div>`;
    console.error(e);
  }
}

// ── Excel/CSV export ──────────────────────────────────────────
async function exportReportToExcel() {
  const { campList, allChecklists } = window._reportData || {};
  if (!campList) { showToast('Please open the Reports tab first.', 'info'); return; }

  const today   = new Date(); today.setHours(0,0,0,0);
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB') : '';
  const daysDiff = (isoA, isoB) => Math.ceil((new Date(isoA) - new Date(isoB)) / 86400000);

  const rows = [['Campaign', 'D-Day', 'Deadline', 'Member', 'Username',
    'D-5 Done', 'D-5 Total', 'D-5 %',
    'D-1 Done', 'D-1 Total', 'D-1 %',
    'Overall %', 'Status', 'Started', 'Last Active', 'Completed',
    'vs Deadline', 'Deadline Status', 'Brand/Platform/Region']];

  campList.forEach(camp => {
    const deadline = camp.deadline ? new Date(camp.deadline) : null;
    (camp.assignedUids || []).forEach(uid => {
      const member = members[uid];
      if (!member) return;
      const cl         = (allChecklists[uid] || {})[camp.id] || {};
      const d5Done     = countDone(cl.d5 || {});
      const d1Done     = countDone(cl.d1 || {});
      const ti         = TOTAL_ITEMS;
      const overallPct = Math.round(((d5Done + d1Done) / (ti * 2)) * 100);
      const d5Pct      = Math.round((d5Done / ti) * 100);
      const d1Pct      = Math.round((d1Done / ti) * 100);
      const status     = overallPct === 100 ? 'Complete' : overallPct > 0 ? 'In Progress' : 'Not Started';
      const entries    = (cl.entries || []).map(e => [e.brand, e.platform, e.region].filter(Boolean).join(' · ')).filter(Boolean).join(' | ');

      // Deadline analysis
      let deadlineStatus = '', vsDead = '';
      if (deadline) {
        const deadlinePast = deadline < today;
        if (overallPct === 100 && cl.completedAt) {
          const completedDay = new Date(cl.completedAt); completedDay.setHours(0,0,0,0);
          const delta = daysDiff(deadline, completedDay);
          deadlineStatus = delta >= 0 ? 'On Time' : 'Late';
          vsDead = delta >= 0 ? `+${delta}d early` : `${Math.abs(delta)}d late`;
        } else if (overallPct < 100) {
          deadlineStatus = deadlinePast ? 'Overdue' : daysDiff(deadline, today) <= 3 ? 'At Risk' : 'In Progress';
          if (deadlinePast) vsDead = `${daysDiff(today, deadline)}d overdue`;
        }
      }

      rows.push([
        camp.name, fmtDate(camp.dday), fmtDate(camp.deadline),
        member.name || member.username, member.username,
        d5Done, ti, d5Pct + '%',
        d1Done, ti, d1Pct + '%',
        overallPct + '%', status,
        fmtDate(cl.startedAt || (overallPct > 0 ? cl.lastActive : '')),
        fmtDate(cl.lastActive),
        fmtDate(cl.completedAt),
        vsDead, deadlineStatus, entries,
      ]);
    });
    rows.push([]); // blank row between campaigns
  });

  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `Trackory_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📊 Report exported!', 'success');
}

// ── Admin: Delete ALL campaigns ──
function openDeleteAllCampaignsModal() {
  document.getElementById('delete-all-camps-error').style.display = 'none';
  document.getElementById('delete-all-camps-password').value = '';
  document.getElementById('delete-all-camps-overlay').style.display = 'flex';
}

function closeDeleteAllCampaignsModal(e) {
  if (e && e.target !== document.getElementById('delete-all-camps-overlay')) return;
  document.getElementById('delete-all-camps-overlay').style.display = 'none';
}

async function confirmDeleteAllCampaigns() {
  const errEl = document.getElementById('delete-all-camps-error');
  errEl.style.display = 'none';
  const pwd = document.getElementById('delete-all-camps-password').value;
  if (pwd !== ADMIN_PASSWORD) {
    showError(errEl, 'Incorrect admin password. Please try again.');
    return;
  }
  const btn = document.getElementById('delete-all-camps-confirm-btn');
  btn.textContent = 'Deleting…'; btn.disabled = true;
  try {
    // Delete all campaigns
    const campSnap = await db.collection('campaigns').get();
    const batch1 = db.batch();
    campSnap.forEach(doc => batch1.delete(doc.ref));
    await batch1.commit();

    // Delete all checklists
    const clSnap = await db.collection('checklists').get();
    const batch2 = db.batch();
    clSnap.forEach(doc => batch2.delete(doc.ref));
    await batch2.commit();

    campaigns = {};
    userChecklist = {};
    document.getElementById('delete-all-camps-overlay').style.display = 'none';
    await loadAdminData();
    showToast('✅ All campaigns and assignments deleted.', 'success');
  } catch(e) {
    showError(errEl, 'Failed to delete campaigns. Try again.');
    console.error(e);
  } finally {
    btn.textContent = 'Delete ALL Campaigns'; btn.disabled = false;
  }
}


// ═════════════════════════════════════════════════════════════
//  CSV MEMBER IMPORT
// ═════════════════════════════════════════════════════════════
let importedMembersPreview = [];

function openImportMembersModal() {
  importedMembersPreview = [];
  document.getElementById('import-csv-file').value = '';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-members-error').style.display = 'none';
  document.getElementById('import-members-overlay').style.display = 'flex';
}

function closeImportMembersModal(e) {
  if (e && e.target !== document.getElementById('import-members-overlay')) return;
  document.getElementById('import-members-overlay').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const fi = document.getElementById('import-csv-file');
  if (fi) fi.addEventListener('change', handleImportCsvChange);
});

// Derive a username slug from a display name (e.g. "Jane Smith" → "jane.smith")
function deriveUsername(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
}

function handleImportCsvChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const rows = text.split(/\r?\n/).map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
    if (rows.length < 2) {
      showError(document.getElementById('import-members-error'), 'CSV appears empty or has no data rows.');
      return;
    }
    const headers = rows[0].map(h => h.toLowerCase());
    const nIdx = headers.indexOf('name');
    const pIdx = headers.indexOf('password');
    const uIdx = headers.indexOf('username'); // optional

    if (nIdx < 0 || pIdx < 0) {
      showError(document.getElementById('import-members-error'), 'CSV must have columns: Name, Password (Username is optional — auto-generated if missing)');
      return;
    }
    document.getElementById('import-members-error').style.display = 'none';
    importedMembersPreview = [];
    rows.slice(1).forEach(r => {
      if (r.length <= Math.max(nIdx, pIdx)) return;
      const name     = r[nIdx]?.trim();
      const password = r[pIdx]?.trim();
      if (!name || !password) return;
      const username = (uIdx >= 0 && r[uIdx]?.trim())
        ? r[uIdx].trim().toLowerCase()
        : deriveUsername(name);
      importedMembersPreview.push({ username, name, password });
    });
    const prev = document.getElementById('import-preview');
    if (importedMembersPreview.length === 0) {
      prev.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No valid rows found.</div>';
      return;
    }
    prev.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">${importedMembersPreview.length} members to import</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:var(--surface2);">
          <th style="padding:5px 8px;text-align:left;">Name</th>
          <th style="padding:5px 8px;text-align:left;">Username (auto)</th>
        </tr></thead>
        <tbody>${importedMembersPreview.map(m => `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:5px 8px;">${escHtml(m.name)}</td>
          <td style="padding:5px 8px;color:var(--text-muted);">@${escHtml(m.username)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  };
  reader.readAsText(file);
}

async function confirmImportMembers() {
  const errEl = document.getElementById('import-members-error');
  if (importedMembersPreview.length === 0) { showError(errEl, 'No members to import. Please upload a valid CSV first.'); return; }
  const btn = document.getElementById('import-members-btn');
  btn.textContent = 'Importing…'; btn.disabled = true;
  let added = 0, skipped = 0;
  try {
    for (const m of importedMembersPreview) {
      if (m.username === ADMIN_USERNAME) { skipped++; continue; }
      const existing = await db.collection('users').where('username', '==', m.username).limit(1).get();
      if (!existing.empty) { skipped++; continue; }
      const ref = await db.collection('users').add({ username: m.username, name: m.name, password: m.password, role: 'member' });
      members[ref.id] = { uid: ref.id, ...m, role: 'member' };
      added++;
    }
    document.getElementById('import-members-overlay').style.display = 'none';
    await loadAdminData();
    showToast(`✅ Imported ${added} member(s)${skipped ? ', skipped '+skipped+' (already exist)' : ''}.`, 'success');
  } catch(e) {
    showError(errEl, 'Import failed. Try again.'); console.error(e);
  } finally {
    btn.textContent = '📥 Import Members'; btn.disabled = false;
  }
}

// ─── Reports: toggle collapsible registrations ───────────────
function toggleRegList(id) {
  const more = document.getElementById(id + '-more');
  const btn  = document.getElementById(id + '-btn');
  if (!more || !btn) return;
  const isOpen = more.style.display !== 'none';
  more.style.display = isOpen ? 'none' : 'inline';
  btn.textContent = isOpen ? `+${more.querySelectorAll('br').length} more` : 'Show less';
}

// ─── Toast notification ──────────────────────────────────────
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `mc-toast mc-toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('mc-toast-in'), 10);
  setTimeout(() => {
    toast.classList.remove('mc-toast-in');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}




// ═════════════════════════════════════════════════════════════
//  TASK CHECK SYSTEM  (Kit & RSP Check — Admin sends, Members respond)
//  Firestore:
//    taskChecks/{checkId}   → { title, items:[{id,label}], sentAt, sentBy,
//                               targetUid, targetName, campaignId, campaignName }
//    taskCheckResponses/{checkId}/responses/{uid}
//                           → { items: { [itemId]: 'pending'|'in-progress'|'done' }, updatedAt }
// ═════════════════════════════════════════════════════════════

const DEFAULT_TASK_CHECK_ITEMS = [
  { id: 'kit_uniform',   label: 'Uniform / attire is complete and presentable' },
  { id: 'kit_idlace',    label: 'ID / lace / lanyard is present' },
  { id: 'kit_device',    label: 'Device is charged and working' },
  { id: 'kit_materials', label: 'All required materials / props are ready' },
  { id: 'rsp_pricing',   label: 'RSP / pricing list is acknowledged' },
  { id: 'rsp_promos',    label: 'Current promos and mechanics are reviewed' },
  { id: 'rsp_script',    label: 'Script / talking points are prepared' },
];

let _taskCheckItems = []; // working copy during admin modal editing
let _activeMemberTaskCheck = null; // { checkId, data, myResponse }

// ── Admin: Open "Send Task Check" modal ──────────────────────
function openTaskCheckModal() {
  // Reset items to defaults
  _taskCheckItems = DEFAULT_TASK_CHECK_ITEMS.map(i => ({ ...i }));
  renderTaskCheckItemsList();

  // Populate dropdowns
  const campSel = document.getElementById('tc-campaign-sel');
  campSel.innerHTML = '<option value="">All campaigns</option>';
  Object.values(campaigns).forEach(c => {
    campSel.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`;
  });

  const memSel = document.getElementById('tc-member-sel');
  memSel.innerHTML = '<option value="">All members</option>';
  Object.values(members).filter(m => m.role !== 'admin').forEach(m => {
    memSel.innerHTML += `<option value="${m.uid}">${escHtml(m.name || m.username)} (@${m.username})</option>`;
  });

  document.getElementById('tc-title').value = 'Kit & RSP Check';
  document.getElementById('tc-error').style.display = 'none';
  document.getElementById('taskcheck-overlay').style.display = 'flex';
}

function closeTaskCheckModal(e) {
  if (e && e.target !== document.getElementById('taskcheck-overlay')) return;
  document.getElementById('taskcheck-overlay').style.display = 'none';
}

function renderTaskCheckItemsList() {
  const el = document.getElementById('tc-items-list');
  if (!el) return;
  el.innerHTML = _taskCheckItems.map((item, i) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:13px;color:var(--text-muted);min-width:18px;">${i+1}.</span>
      <input type="text" value="${escHtml(item.label)}"
        oninput="_taskCheckItems[${i}].label = this.value"
        style="flex:1;font-size:13px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);" />
      <button onclick="removeTaskCheckItem(${i})"
        style="background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);color:#DC2626;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;">✕</button>
    </div>`).join('');
}

function addTaskCheckItem() {
  _taskCheckItems.push({ id: `custom_${Date.now()}`, label: '' });
  renderTaskCheckItemsList();
  // Focus last input
  const inputs = document.querySelectorAll('#tc-items-list input[type="text"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeTaskCheckItem(i) {
  _taskCheckItems.splice(i, 1);
  renderTaskCheckItemsList();
}

async function sendTaskCheck() {
  const title   = document.getElementById('tc-title').value.trim();
  const campId  = document.getElementById('tc-campaign-sel').value;
  const uid     = document.getElementById('tc-member-sel').value;
  const errEl   = document.getElementById('tc-error');
  errEl.style.display = 'none';

  if (!title) { showError(errEl, 'Please enter a title.'); return; }
  const validItems = _taskCheckItems.filter(i => i.label.trim());
  if (validItems.length === 0) { showError(errEl, 'Please add at least one check item.'); return; }

  const btn = document.querySelector('#taskcheck-overlay .btn-primary');
  btn.textContent = 'Sending…'; btn.disabled = true;

  try {
    const memberName = uid ? (members[uid]?.name || members[uid]?.username || uid) : 'All members';
    const campName   = campId ? campaigns[campId]?.name : null;

    const checkData = {
      title,
      items:       validItems,
      sentAt:      new Date().toISOString(),
      sentBy:      'Admin',
      targetUid:   uid || null,
      targetName:  memberName,
      campaignId:  campId || null,
      campaignName: campName || null,
    };

    // Save the task check document
    const ref = await db.collection('taskChecks').add(checkData);

    // Also create a broadcast so it shows up in the member feed
    await db.collection('broadcasts').add({
      type:         'taskcheck',
      message:      `🎒 New Task Check sent: "${title}" — please review and update your status.`,
      targetUid:    uid || null,
      targetName:   memberName,
      campaignId:   campId || null,
      campaignName: campName || null,
      sentAt:       new Date().toISOString(),
      sentBy:       'Admin',
      readBy:       [],
      taskCheckId:  ref.id,   // link broadcast → task check
    });

    document.getElementById('taskcheck-overlay').style.display = 'none';
    showToast(`🎒 Task Check "${title}" sent to ${memberName}!`, 'success');
  } catch(e) {
    showError(errEl, 'Failed to send. Please try again.');
    console.error(e);
  } finally {
    btn.textContent = '🎒 Send Task Check'; btn.disabled = false;
  }
}

// ── Admin: View task check responses (tracker modal) ─────────
async function openTaskCheckTracker(checkId) {
  document.getElementById('taskcheck-tracker-overlay').style.display = 'flex';
  const content = document.getElementById('tc-tracker-content');
  content.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted);">Loading responses…</div>';

  try {
    const checkDoc = await db.collection('taskChecks').doc(checkId).get();
    if (!checkDoc.exists) { content.innerHTML = '<div style="color:var(--text-muted);">Task check not found.</div>'; return; }
    const check = checkDoc.data();
    document.getElementById('tc-tracker-title').textContent = `🎒 ${check.title}`;

    const respSnap = await db.collection('taskCheckResponses').doc(checkId).collection('responses').get();
    const responses = {};
    respSnap.forEach(doc => { responses[doc.id] = doc.data(); });

    // Determine which members to show
    const targetMembers = check.targetUid
      ? [members[check.targetUid]].filter(Boolean)
      : Object.values(members).filter(m => m.role !== 'admin');

    const sentStr = new Date(check.sentAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const campTag = check.campaignName ? `<span class="bcast-tag" style="margin-left:6px;">${escHtml(check.campaignName)}</span>` : '';

    let html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">Sent ${sentStr} ${campTag} · ${targetMembers.length} member${targetMembers.length!==1?'s':''}</div>`;

    // Summary pills
    let cDone = 0, cProg = 0, cPend = 0;
    targetMembers.forEach(m => {
      const r = responses[m.uid] || {};
      const statuses = check.items.map(item => (r.items || {})[item.id] || 'pending');
      const allDone  = statuses.every(s => s === 'done');
      const anyProg  = statuses.some(s => s === 'in-progress' || s === 'done');
      if (allDone)       cDone++;
      else if (anyProg)  cProg++;
      else               cPend++;
    });

    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;">
      <span class="ac-pill ac-green">✓ ${cDone} Complete</span>
      <span class="ac-pill ac-amber">⟳ ${cProg} In Progress</span>
      <span class="ac-pill ac-red">— ${cPend} Pending</span>
    </div>`;

    // Per-member table
    html += `<div style="display:flex;flex-direction:column;gap:10px;">`;
    targetMembers.forEach(m => {
      const r    = responses[m.uid] || {};
      const upd  = r.updatedAt ? `Updated ${new Date(r.updatedAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}` : 'No response yet';
      const itemsHtml = check.items.map(item => {
        const st    = (r.items || {})[item.id] || 'pending';
        const stLbl = { done: '✓ Done', 'in-progress': '⟳ In Progress', pending: '— Pending' }[st] || '— Pending';
        const stCls = { done: 'rv-done', 'in-progress': 'rv-progress', pending: 'rv-pending' }[st] || 'rv-pending';
        return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--text);">${escHtml(item.label)}</span>
          <span class="rv-status ${stCls}" style="font-size:10px;">${stLbl}</span>
        </div>`;
      }).join('');

      html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <span style="font-weight:600;font-size:13px;">${escHtml(m.name || m.username)}</span>
            <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">@${escHtml(m.username)}</span>
          </div>
          <span style="font-size:10px;color:var(--text-faint);">${upd}</span>
        </div>
        ${itemsHtml}
      </div>`;
    });
    html += `</div>`;
    content.innerHTML = html;
  } catch(e) {
    content.innerHTML = '<div style="color:var(--danger);">Failed to load responses.</div>';
    console.error(e);
  }
}

function closeTaskCheckTracker(e) {
  if (e && e.target !== document.getElementById('taskcheck-tracker-overlay')) return;
  document.getElementById('taskcheck-tracker-overlay').style.display = 'none';
}

// ── Member: See task check in broadcast feed ─────────────────
// In loadBroadcastFeed, we inject a "Respond" button for taskcheck type
// This is handled by patching the broadcast render — see below

// ── Member: Open task check response modal ───────────────────
async function openMemberTaskCheck(checkId) {
  _activeMemberTaskCheck = null;
  document.getElementById('member-taskcheck-overlay').style.display = 'flex';
  document.getElementById('mtc-items-list').innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:1rem 0;">Loading…</div>';

  try {
    const checkDoc = await db.collection('taskChecks').doc(checkId).get();
    if (!checkDoc.exists) { closeMemberTaskCheck(); return; }
    const check = checkDoc.data();

    // Load existing response
    const respDoc = await db.collection('taskCheckResponses').doc(checkId)
      .collection('responses').doc(currentUser.uid).get();
    const myResponse = respDoc.exists ? respDoc.data() : { items: {} };

    _activeMemberTaskCheck = { checkId, check, myResponse };

    document.getElementById('mtc-title').textContent = `🎒 ${check.title}`;
    document.getElementById('mtc-subtitle').textContent = check.campaignName
      ? `Campaign: ${check.campaignName}`
      : `Sent by Admin · ${new Date(check.sentAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}`;

    renderMemberTaskCheckItems();
  } catch(e) {
    document.getElementById('mtc-items-list').innerHTML = '<div style="color:var(--danger);">Failed to load. Try again.</div>';
    console.error(e);
  }
}

function renderMemberTaskCheckItems() {
  if (!_activeMemberTaskCheck) return;
  const { check, myResponse } = _activeMemberTaskCheck;
  const el = document.getElementById('mtc-items-list');
  if (!el) return;

  el.innerHTML = check.items.map((item, i) => {
    const current = (myResponse.items || {})[item.id] || 'pending';
    const opts = [
      { v: 'pending',     l: '— Pending',     cls: 's-pending' },
      { v: 'in-progress', l: '⟳ In Progress', cls: 's-progress' },
      { v: 'done',        l: '✓ Done',         cls: 's-done' },
    ];
    const selectHtml = opts.map(o => `<option value="${o.v}" ${current===o.v?'selected':''}>${o.l}</option>`).join('');
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:12px;color:var(--text-muted);min-width:18px;">${i+1}.</span>
      <span style="flex:1;font-size:13px;color:var(--text);">${escHtml(item.label)}</span>
      <select class="status-sel ${statusClass(current)}" id="mtc-sel-${item.id}"
        onchange="onMemberTaskItemChange('${item.id}', this)">
        ${selectHtml}
      </select>
    </div>`;
  }).join('');
}

function onMemberTaskItemChange(itemId, sel) {
  if (!_activeMemberTaskCheck) return;
  sel.className = `status-sel ${statusClass(sel.value)}`;
  if (!_activeMemberTaskCheck.myResponse.items) _activeMemberTaskCheck.myResponse.items = {};
  _activeMemberTaskCheck.myResponse.items[itemId] = sel.value;
}

async function saveMemberTaskCheck() {
  if (!_activeMemberTaskCheck || !currentUser) return;
  const { checkId, myResponse } = _activeMemberTaskCheck;
  const btn = document.querySelector('#member-taskcheck-overlay .btn-primary');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    // Read current values from selects (in case onchange missed any)
    const { check } = _activeMemberTaskCheck;
    check.items.forEach(item => {
      const sel = document.getElementById(`mtc-sel-${item.id}`);
      if (sel) {
        if (!myResponse.items) myResponse.items = {};
        myResponse.items[item.id] = sel.value;
      }
    });

    await db.collection('taskCheckResponses').doc(checkId)
      .collection('responses').doc(currentUser.uid)
      .set({ items: myResponse.items || {}, updatedAt: new Date().toISOString() }, { merge: true });

    document.getElementById('member-taskcheck-overlay').style.display = 'none';
    showToast('✅ Task check status saved!', 'success');
  } catch(e) {
    showToast('Failed to save. Try again.', 'warn');
    console.error(e);
  } finally {
    btn.textContent = '💾 Save Status'; btn.disabled = false;
  }
}

function closeMemberTaskCheck(e) {
  if (e && e.target !== document.getElementById('member-taskcheck-overlay')) return;
  document.getElementById('member-taskcheck-overlay').style.display = 'none';
}

// ── Admin dashboard: load & show recent task checks ──────────
async function renderTaskChecksInDashboard() {
  // Called from renderDashboardWidgets – shows a compact list below stats
  const el = document.getElementById('dash-taskcheck-panel');
  if (!el) return;

  try {
    const snap = await db.collection('taskChecks').orderBy('sentAt','desc').limit(5).get();
    if (snap.empty) { el.style.display = 'none'; return; }

    el.style.display = 'block';
    let html = '';
    snap.forEach(doc => {
      const tc  = doc.data();
      const dt  = new Date(tc.sentAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
      const who = tc.targetUid ? (members[tc.targetUid]?.name || tc.targetName || '—') : 'All members';
      html += `<div class="deadline-row" style="cursor:pointer;" onclick="openTaskCheckTracker('${doc.id}')">
        <div class="deadline-name" title="${escHtml(tc.title)}">🎒 ${escHtml(tc.title)}<span style="font-size:11px;color:var(--text-faint);margin-left:6px;">${dt} · ${escHtml(who)}</span></div>
        <span class="deadline-pill dp-blue" style="background:rgba(37,99,235,0.1);color:var(--blue-text);">View</span>
      </div>`;
    });
    el.innerHTML = `<div class="dash-card-header" style="margin-bottom:8px;"><div class="dash-card-title">Recent Task Checks</div></div>` + html;
  } catch(e) { el.style.display = 'none'; }
}
