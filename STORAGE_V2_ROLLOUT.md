# Trackory Storage V2 — rollout and recovery checklist

Status: **Development-only** on `feature/checklist-storage-v2`. Draft PR #2; no production deployment.

## Storage contracts
- Existing campaigns (including 11.11) have no `storageVersion: 2` marker and continue reading/writing `checklists/{uid}[campaignId]`. Do not change their campaign marker.
- Newly created campaigns from the revised app set `campaigns/{campaignId}.storageVersion = 2`.
- V2 checklist metadata lives at `checklists/{uid}/campaigns/{campaignId}`; statuses live at `.../items/{encodedTab}__{encodedKey}`.
- A removed UI entry leaves historical status documents in place with `active: false`. Compatibility readers ignore inactive items.
- Admin, Manager, member, and Team Lead progress/dashboard reads use compatible legacy/V2 data, and archived summaries can read V2. Existing campaign record deletion is blocked for V2 campaigns.
- The copy migration helper `migrateChecklistCopyToV2(uid, campaignId, { confirmCopy: true })` is deliberately NOT invoked automatically. It never deletes the legacy parent. It requires an explicitly V2-opted campaign and refuses to overwrite existing V2 status records.

## Tests completed
Run `node --check app.js` and `node --test tests/storage-v2.test.js`.
The GitHub workflow `Trackory Storage V2 tests` runs on pull-request changes. Tests use **in-memory mock Firestore only**, including an 825-status save, multi-batch interruption/retry, status tombstones, compatible Admin progress data, member and team lead saves, and copy-only migration.

## Required manual staging QA before merging
Use a **new test campaign** and a dedicated high-volume test account. Do not reuse the active 11.11 campaign or migrate its member data.

1. Review Firebase security rules (not versioned in this repository) for read/write of nested campaigns and items for member, Admin, Team Lead and Manager roles. Confirm indexes and quota limits.
2. Assign hundreds of brand/platform/region rows; edit single statuses, bulk statuses, notes, after-party dates, add/remove entries; verify the save indicator displays **Saved ✓** only after Firestore commits.
3. Hard refresh, log out/in, and switch campaigns while saves are pending. Reopen the same rows and confirm statuses, notes, and progress are unchanged.
4. Compare member Checklist, member Overview, Team Lead own checklist, Team Lead dashboard, Admin/Manager dashboard, review modal, Reports, Data tab, RSP/Kit progress and archived CSV for the same campaign. Validate all percentages and entry allocations.
5. Simulate a failed multi-batch save in an isolated test project. Verify a `writeState: pending` warning appears and failed saves never show as Saved. **Important:** the current recovery mechanism retries the full diff from the last successful in-session snapshot. After a refresh, review the partially saved data and reconcile it before retrying; the client does not yet provide a durable operation journal to reconstruct every missing batch.
6. Verify copy-only migration on a disposable legacy test campaign explicitly opted into V2. Compare all records before/after. Check that the original parent remains identical and that a second migration attempt is rejected.
7. Verify archive/restore is safe; all destructive legacy admin operations must remain blocked for V2 records until a separate, reviewed cleanup design exists.
8. Confirm GitHub Pages deployment settings point to the intended production branch. Do not merge or publish the PR during 11.11.

## Deployment gate
Only mark PR #2 ready for review once actual Firestore staging and all role-based browser checks pass, including the pending-save recovery limitation above. Do not describe mock tests as production validation. Preserve backups and retain the original legacy records after cutover.
