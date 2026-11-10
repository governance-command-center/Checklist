'use strict';
// Run with: node --test tests/storage-v2.test.js
// In-memory Firestore tests: NO production project access and NO data deletion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const documents = new Map();
  const state = { batches: 0, writes: 0, failBatch: null };
  const clone = data => JSON.parse(JSON.stringify(data));
  const ref = key => ({
    id: key.split('/').pop(),
    collection: name => collection(key + '/' + name),
    get: async () => snapshot(key),
    set: async (value, opts = {}) => {
      state.writes++;
      documents.set(key, opts.merge ? { ...(documents.get(key) || {}), ...clone(value) } : clone(value));
    },
    update: async value => {
      if (!documents.has(key)) throw new Error('Document does not exist: ' + key);
      documents.set(key, { ...documents.get(key), ...clone(value) });
    },
    delete: async () => { documents.delete(key); }
  });
  const snapshot = key => ({
    id: key.split('/').pop(),
    exists: documents.has(key),
    data: () => clone(documents.get(key)),
    ref: ref(key)
  });
  const collection = key => ({
    doc: id => ref(key + '/' + id),
    get: async () => {
      const docs = Array.from(documents.keys())
        .filter(k => k.startsWith(key + '/') && !k.slice(key.length + 1).includes('/'))
        .map(snapshot);
      return { empty: docs.length === 0, docs, forEach: fn => docs.forEach(fn) };
    }
  });
  const firestore = {
    collection,
    batch: () => {
      const operations = [];
      return {
        set: (r, value) => { operations.push([r, value]); },
        commit: async () => {
          state.batches++;
          if (state.batches === state.failBatch) throw new Error('Simulated batch interruption');
          for (const [r, value] of operations) await r.set(value);
        }
      };
    },
    runTransaction: async fn => fn({
      get: r => r.get(),
      set: (r, value, opts) => r.set(value, opts)
    })
  };
  const firebase = {
    firestore: Object.assign(() => firestore, { FieldValue: {}, FieldPath: class {} })
  };
  const sections = [{ id: 'test', items: Array.from({ length: 825 }, (_, i) => ({ id: 'item' + i })) }];
  const context = vm.createContext({
    firebase, CHECKLIST_SECTIONS: sections, TOTAL_ITEMS: 825,
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    console, setTimeout, clearTimeout
  });
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInContext(appJs, context, { filename: 'app.js' });
  const api = vm.runInContext('({saveChecklistV2, loadChecklistV2, loadChecklistCompatible, ' +
    'loadChecklistCompatibilityMap, loadAdminDashboardCache, getEntryBreakdown, ' +
    'migrateChecklistCopyToV2})', context);
  return {
    documents, state, api, clone, context,
    setContext(camps, memberMap) {
      context.testCampaigns = camps;
      context.testMembers = memberMap;
      vm.runInContext('campaigns = testCampaigns; members = testMembers;', context);
    },
    dashboard() { return vm.runInContext('_dashCache', context); }
  };
}

function highVolumeChecklist() {
  const data = { entries: [{ brand: 'Example', region: 'TH', platform: 'Shopee' }], d1: {}, d5: {} };
  for (let i = 0; i < 825; i++) {
    data.d1['item' + i] = { status: i % 2 ? 'done' : 'na', note: 'evidence ' + i };
  }
  return data;
}

test('825 statuses use bounded batches; legacy documents remain byte-for-byte unchanged', async () => {
  const f = fixture();
  const legacy = { campaign2026: { entries: [{ brand: 'Original' }], d1: { old: { status: 'done' } } } };
  f.documents.set('checklists/uid', f.clone(legacy));
  const data = highVolumeChecklist();
  await f.api.saveChecklistV2('uid', 'future', data, {});
  assert.equal(f.state.batches, 3);
  assert.equal(Object.keys((await f.api.loadChecklistV2('uid', 'future')).d1).length, 825);
  assert.deepEqual(f.documents.get('checklists/uid'), legacy);
});

test('single-item updates write only one status; tombstones retain historical values', async () => {
  const f = fixture();
  const original = highVolumeChecklist();
  const saved = await f.api.saveChecklistV2('uid', 'future', original, {});
  const before = f.state.writes;
  const next = f.clone(saved);
  next.d1.item3 = { status: 'in-progress' };
  const newSaved = await f.api.saveChecklistV2('uid', 'future', next, saved);
  assert.equal(f.state.writes - before, 3); // pending + one item + committed metadata
  const reduced = f.clone(newSaved);
  delete reduced.d1.item3;
  await f.api.saveChecklistV2('uid', 'future', reduced, newSaved);
  assert.equal((await f.api.loadChecklistV2('uid', 'future')).d1.item3, undefined);
  const archived = f.documents.get('checklists/uid/campaigns/future/items/d1__item3');
  assert.equal(archived.active, false);
  assert.equal(archived.value.status, 'in-progress');
});

test('interrupted batch remains visible as pending; retry restores all statuses', async () => {
  const f = fixture();
  const data = highVolumeChecklist();
  f.state.failBatch = 2;
  await assert.rejects(f.api.saveChecklistV2('uid', 'future', data, {}), /Simulated/);
  assert.equal(f.documents.get('checklists/uid/campaigns/future').writeState, 'pending');
  f.state.failBatch = null;
  await f.api.saveChecklistV2('uid', 'future', data, {});
  const reloaded = await f.api.loadChecklistV2('uid', 'future');
  assert.equal(reloaded.writeState, 'complete');
  assert.equal(Object.keys(reloaded.d1).length, 825);
});

test('admin cache reads both formats and computes 100% progress after refresh', async () => {
  const f = fixture();
  const legacy = { oldCamp: { entries: [{ brand: 'Legacy' }], d1: { old: { status: 'done' } } } };
  f.documents.set('checklists/uid', f.clone(legacy));
  const camp = { id: 'newCamp', storageVersion: 2, assignedUids: ['uid'] };
  f.setContext({ newCamp: camp, oldCamp: { id: 'oldCamp', assignedUids: ['uid'] } },
    { uid: { uid: 'uid', name: 'Test Member' } });
  await f.api.saveChecklistV2('uid', 'newCamp', highVolumeChecklist(), {});
  const map = await f.api.loadChecklistCompatibilityMap([camp], ['uid']);
  assert.equal(map.uid.oldCamp.d1.old.status, 'done');
  assert.equal(Object.keys(map.uid.newCamp.d1).length, 825);
  await f.api.loadAdminDashboardCache(true);
  const dashboard = f.dashboard();
  assert.equal(Object.keys(dashboard.checklists.uid.newCamp.d1).length, 825);
  const progress = f.api.getEntryBreakdown(dashboard.checklists.uid.newCamp,
    825, new Set(Array.from({ length: 825 }, (_, i) => 'item' + i)), false);
  assert.equal(progress[0].overallPct, 100);
});

test('copy-only migration verifies status data, refuses repeat migration, preserves legacy', async () => {
  const f = fixture();
  const legacy = { oldCamp: { entries: [{ brand: 'Original' }],
    d1: { 'item0': { status: 'done' } }, d5: {} } };
  f.documents.set('checklists/uid', f.clone(legacy));
  f.setContext({ oldCamp: { id: 'oldCamp', storageVersion: 2, assignedUids: ['uid'] } },
    { uid: { uid: 'uid' } });
  await assert.rejects(f.api.migrateChecklistCopyToV2('uid', 'oldCamp'), /confirmCopy/);
  const result = await f.api.migrateChecklistCopyToV2('uid', 'oldCamp', { confirmCopy: true });
  assert.equal(result.legacyPreserved, true);
  assert.equal((await f.api.loadChecklistV2('uid', 'oldCamp')).d1.item0.status, 'done');
  assert.deepEqual(f.documents.get('checklists/uid'), legacy);
  await assert.rejects(f.api.migrateChecklistCopyToV2('uid', 'oldCamp', { confirmCopy: true }), /already completed/);
});

test('member saves use per-campaign V2 and survive an immediate campaign switch', async () => {
  const f = fixture();
  const camps = {
    a: { id: 'a', storageVersion: 2, assignedUids: ['uid'] },
    b: { id: 'b', storageVersion: 2, assignedUids: ['uid'] }
  };
  f.setContext(camps, { uid: { uid: 'uid', role: 'member' } });
  f.context.mockUser = { uid: 'uid', role: 'member' };
  f.context.mockChecklists = {
    a: { entries: [{ brand: 'One' }], d1: { item0: { status: 'done' } } },
    b: { entries: [{ brand: 'Two' }], d1: { item1: { status: 'na' } } }
  };
  vm.runInContext('currentUser = mockUser; userChecklist = mockChecklists;', f.context);
  vm.runInContext("selectedCampaignId = 'a'; saveChecklist();", f.context);
  vm.runInContext("selectedCampaignId = 'b'; saveChecklist();", f.context);
  await new Promise(resolve => setTimeout(resolve, 950));
  await vm.runInContext('_checklistSaveQueue', f.context);
  assert.equal((await f.api.loadChecklistV2('uid', 'a')).d1.item0.status, 'done');
  assert.equal((await f.api.loadChecklistV2('uid', 'b')).d1.item1.status, 'na');
  assert.equal(f.documents.has('checklists/uid'), false, 'V2 saves must not write the legacy parent');
});

test('team lead own checklist routes through V2 despite an empty member campaign map', async () => {
  const f = fixture();
  f.setContext({}, { lead: { uid: 'lead', role: 'team_lead' } });
  f.context.mockOwnCampaigns = { leadCamp: {
    id: 'leadCamp', storageVersion: 2, assignedUids: ['lead']
  } };
  f.context.mockUser = { uid: 'lead', role: 'team_lead' };
  f.context.mockChecklists = {
    leadCamp: { entries: [{ brand: 'Lead brand' }], d1: { item0: { status: 'done' } } }
  };
  vm.runInContext("tlOwnCampaigns = mockOwnCampaigns; currentUser = mockUser; " +
    "userChecklist = mockChecklists; selectedCampaignId = 'leadCamp'; saveChecklist();", f.context);
  await new Promise(resolve => setTimeout(resolve, 950));
  await vm.runInContext('_checklistSaveQueue', f.context);
  assert.equal((await f.api.loadChecklistV2('lead', 'leadCamp')).d1.item0.status, 'done');
  assert.equal(f.documents.has('checklists/lead'), false);
});

test('interrupted copy-only migration can be resumed from unchanged legacy source', async () => {
  const f = fixture();
  const legacy = { oldCamp: highVolumeChecklist() };
  f.documents.set('checklists/uid', f.clone(legacy));
  f.setContext({ oldCamp: { id: 'oldCamp', storageVersion: 2, assignedUids: ['uid'] } },
    { uid: { uid: 'uid' } });
  f.state.failBatch = 2;
  await assert.rejects(f.api.migrateChecklistCopyToV2('uid', 'oldCamp', { confirmCopy: true }), /Simulated/);
  assert.equal(f.documents.get('checklists/uid/campaigns/oldCamp').migrationState, 'copying');
  f.state.failBatch = null;
  const result = await f.api.migrateChecklistCopyToV2('uid', 'oldCamp', { confirmCopy: true });
  assert.equal(result.resumed, true);
  assert.equal(Object.keys((await f.api.loadChecklistV2('uid', 'oldCamp')).d1).length, 825);
  assert.equal(f.documents.get('checklists/uid/campaigns/oldCamp').migrationState, 'complete');
  assert.deepEqual(f.documents.get('checklists/uid'), legacy);
});
