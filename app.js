--- a/app.js	2026-11-10 15:21:11.010771000 +0000
+++ b/app.js	2026-11-10 15:23:51.579827000 +0000
@@ -1925,7 +1925,8 @@
   const regs = CAL_REGIONS.filter(r => r.id !== 'LAZ');
   const opt = (list, v, ph) => `<option value="">${ph}</option>` + list.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${o.label}</option>`).join('');
   tbody.innerHTML = (_rmHint[prefix] ? `<tr><td colspan="7" class="cs-hint-warn">${_rmHint[prefix]}</td></tr>` : '') + _rmState[prefix].map((r, i) => {
-    const auto = !r._deadlineManual && r.deadline && _deadlineFromDday(r.dday) === r.deadline;
+    // Keep `auto` as the deadline STRING (or ''), not a boolean — it is passed to _fmtDeadline().
+    const auto = (!r._deadlineManual && r.deadline && _deadlineFromDday(r.dday) === r.deadline) ? r.deadline : '';
     const inp = f => `<td><input type="datetime-local" value="${r[f]}" style="font-size:12px;width:100%;" onchange="rmSet('${prefix}',${i},'${f}',this.value)" /></td>`;
     return `<tr><td><select style="font-size:12px;" onchange="rmSet('${prefix}',${i},'region',this.value)">${opt(regs, r.region, 'Region')}</select></td>
       <td><select style="font-size:12px;" onchange="rmSet('${prefix}',${i},'platform',this.value)">${opt(CAL_PLATFORMS, r.platform, 'All platforms')}</select></td>
@@ -1978,6 +1979,15 @@
 // Pretty-print a resolved deadline ("2026-07-14T16:00" → "Jul 14, 4:00 PM").
 function _fmtDeadline(iso) {
   if (!iso) return '—';
+  // Be tolerant of non-string values (Date, Firestore Timestamp, boolean)
+  // instead of crashing the whole modal with "iso.split is not a function".
+  if (typeof iso !== 'string') {
+    if (typeof iso.toDate === 'function') iso = iso.toDate();
+    if (iso instanceof Date && !isNaN(iso)) {
+      const pad = n => String(n).padStart(2, '0');
+      iso = `${iso.getFullYear()}-${pad(iso.getMonth() + 1)}-${pad(iso.getDate())}T${pad(iso.getHours())}:${pad(iso.getMinutes())}`;
+    } else return '—';
+  }
   const [datePart, timePart] = iso.split('T');
   const [y, mo, d] = datePart.split('-').map(Number);
   const base = `${_MONTH_LABELS[mo - 1].slice(0, 3)} ${d}`;
@@ -3663,6 +3673,18 @@
 // Serialize saves per signed-in account so older network writes cannot land
 // after newer ones. Only write the selected campaign field, never a stale
 // copy of every campaign in the member document.
+// Retry only errors that are genuinely transient (network blips, backend busy).
+// Permission / invalid-argument / size errors fail immediately with their real code.
+async function _withFirestoreRetry(fn, attempts = 3) {
+  const transient = new Set(['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'resource-exhausted']);
+  for (let i = 0; ; i++) {
+    try { return await fn(); }
+    catch (e) {
+      if (i >= attempts - 1 || !transient.has(e && e.code)) throw e;
+      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
+    }
+  }
+}
 const _checklistSaveTimers = new Map();
 let _checklistSaveQueue = Promise.resolve();
 let _checklistSaveGeneration = 0;
@@ -3686,7 +3708,7 @@
     if (total > 0 && done >= total && !campData.completedAt) campData.completedAt = campData.lastActive;
     const el = document.getElementById('checklist-save-state');
     if (el) { el.textContent = 'Saving…'; el.style.color = '#64748b'; }
-    _checklistSaveQueue = _checklistSaveQueue.catch(() => {}).then(async () => {
+    _checklistSaveQueue = _checklistSaveQueue.catch(() => {}).then(() => _withFirestoreRetry(async () => {
       if (checklistV2Enabled(campId)) {
         const key = checklistV2Key(uid, campId);
         // Retain the last fully committed snapshot on failure. Retrying
@@ -3704,21 +3726,41 @@
         }
       } else {
         const ref = db.collection('checklists').doc(uid);
-        const snap = await ref.get();
-        if (snap.exists) await ref.update(new firebase.firestore.FieldPath(campId), campData);
-        else await ref.set({ [campId]: campData }, { merge: true });
+        // Firestore hard limit: 1 MiB per document. The legacy format keeps EVERY
+        // campaign for a member in one document, so warn clearly before it fails.
+        const approxBytes = new Blob([JSON.stringify(userChecklist)]).size;
+        if (approxBytes > 900 * 1024) console.warn('Legacy checklist doc is near the 1 MiB Firestore limit', { uid, approxBytes });
+        try {
+          // update() replaces only this campaign's field and (unlike merge-set)
+          // lets removed entries/keys disappear. No prior get() -> no read/write race.
+          await ref.update(new firebase.firestore.FieldPath(campId), campData);
+        } catch (e) {
+          if (e && e.code === 'not-found') await ref.set({ [campId]: campData }, { merge: true });
+          else throw e;
+        }
       }
       if (currentUser?.uid === uid && selectedCampaignId === campId && generation === _checklistSaveGeneration) {
         const state = document.getElementById('checklist-save-state');
         if (state) { state.textContent = 'Saved ✓'; state.style.color = '#059669'; }
       }
-    }).catch(err => {
+    })).catch(err => {
       if (checklistV2Enabled(campId)) _v2Dirty.set(checklistV2Key(uid, campId), true);
-      console.error('Checklist save failed', { uid, campId, error: err });
+      const code = (err && err.code) || 'unknown';
+      const msg  = (err && err.message) || String(err);
+      // Log primitives (not a nested object) so the real reason is visible in the console without expanding.
+      console.error(`Checklist save failed [${code}] uid=${uid} campaign=${campId} v2=${checklistV2Enabled(campId)} :: ${msg}`, err);
       if (currentUser?.uid === uid && selectedCampaignId === campId) {
         const state = document.getElementById('checklist-save-state');
-        if (state) { state.textContent = 'Save failed — changes may not persist. Please do not refresh.'; state.style.color = '#dc2626'; }
-        showToast('Checklist save failed. Please report this to your administrator.', 'warn');
+        if (state) {
+          state.style.color = '#dc2626';
+          state.textContent = `Save failed (${code}) — changes may not persist. Please do not refresh. `;
+          const retry = document.createElement('button');
+          retry.textContent = 'Retry save';
+          retry.className = 'btn-ghost-light btn-sm';
+          retry.onclick = () => saveChecklist();
+          state.appendChild(retry);
+        }
+        showToast(`Checklist save failed (${code}). Please report this to your administrator.`, 'warn');
       }
     });
   }, 800);
