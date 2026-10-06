firebase.initializeApp({
  apiKey:"AIzaSyAMeIPEAagUU_SO6T2OnZj-ppubbPjIfrw",
  authDomain:"complianchub.firebaseapp.com",
  databaseURL:"https://complianchub-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:"complianchub",
  storageBucket:"complianchub.firebasestorage.app",
  messagingSenderId:"780924840622",
  appId:"1:780924840622:web:5180777620a99d6a731b3f"
});
const FDB=firebase.database();
const ADMIN_UN='admin',ADMIN_PW='admin123',ADMIN_NAME='Vhino Santos';
const SESSION_KEY='gh_session_v2';
const ROLES=['HOD','Manager','Assist. Manager','Team Lead','Executive','Talent on Demand'];
const LEAD_ROLES=['HOD','Manager','Assist. Manager','Team Lead'];
// Returns all tasks visible to current user:
// - Admin: all admin tasks only (leadTasks shown separately in Task Management)
// - Lead: admin tasks (read-only view) + their own lead tasks (editable)
// - Member: admin tasks + any lead tasks assigned to them
function allTasks(){
  var base=D.tasks||[];
  var lead=D.leadTasks||[];
  if(CU.isAdmin) return base; // admin sees all admin tasks
  // A task counts as "mine" if I'm in its assignees list OR — for tracker-linked
  // tasks (Abnormal Orders / Finance Report) whose real per-person assignment lives
  // in the tracker rows, not in t.assignees — I'm named on at least one live row of
  // that linked tracker. Without this, a member tagged only in the tracker (e.g. as a
  // row's CDM/Team Lead) never sees the AO/FR task on their dashboard.
  function isMine(t){
    if((t.assignees||[]).includes(CU.username))return true;
    if((t.aoLinked||t.frLinked)&&userOwnsAnyTrackerRow(t))return true;
    return false;
  }
  if(isLead()){
    // Lead sees: admin tasks assigned to them + all their own created lead tasks
    var assignedAdminTasks=base.filter(isMine);
    var myLeadTasks=lead.filter(function(t){return t._leadOwner===CU.username;});
    return assignedAdminTasks.concat(myLeadTasks);
  }
  // Regular member: ONLY admin tasks assigned to them + lead tasks assigned to them
  var assignedBase=base.filter(isMine);
  var assignedLeadTasks=lead.filter(isMine);
  return assignedBase.concat(assignedLeadTasks);
}
// True if the current (non-admin) user is named on at least one live (non Exited/Inactive)
// row of the tracker linked to this task. Covers both the Abnormal Orders tracker
// (CDM col 2 / Team Lead col 3, reusing aoIsRowOwner) and the Finance Report tracker
// (Exec/CDM & Team Lead columns, resolved per-platform). Standing-buddy grants are
// inherited via aoIsRowOwner / aoIsBuddyOf so a buddy also sees the task.
function userOwnsAnyTrackerRow(t){
  if(!CU||CU.isAdmin)return true;
  if(!(CU.name||'').trim())return false;
  try{
    if(t.aoLinked){
      var aoEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].aoLinked;});
      if(!aoEntry)return false;
      var aoSheets=(aoEntry[1].sheets)||{};
      return Object.keys(aoSheets).some(function(sk){
        var sh=aoSheets[sk];if(!sh||!sh.rows)return false;
        var meta=sh.aoMeta||{};
        return sh.rows.some(function(row,ri){
          if(!row||row[0]==null||!String(row[0]).trim())return false;
          if(String(row[0]).toUpperCase()==='TOTAL')return false;
          var m=meta[ri],st=m&&m.status?String(m.status).trim().toLowerCase():'';
          if(st==='exited'||st==='inactive')return false;
          return aoIsRowOwner(row);
        });
      });
    }
    if(t.frLinked){
      var frLinked=(typeof getFRLinked==='function')?getFRLinked():null;
      if(!frLinked){
        var frEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].frLinked;});
        frLinked=frEntry?frEntry[1]:null;
      }
      if(!frLinked)return false;
      var frSheets=frLinked.sheets||{};
      var nm=(CU.name||'').trim().toLowerCase();
      return Object.keys(frSheets).some(function(sk){
        var sheet=frSheets[sk];if(!sheet||!sheet.rows)return false;
        var platform=sk;
        var execCol=frFixedColIdx(sheet,platform,'exec');
        var headerRows=(sheet.headerRows)||(sheet.row0?[sheet.row0]:[[]]);
        var hr0=headerRows[0]||[];
        var tlCol=(function(){var i=hr0.findIndex(function(l){return/team.?lead|^tl$/i.test(String(l||''));});return i>=0?i:execCol+1;})();
        var acctCol=frFixedColIdx(sheet,platform,'acct');
        return sheet.rows.some(function(row){
          if(!row)return false;
          var stt=String(row[acctCol]||'').trim().toLowerCase();
          if(stt==='inactive'||stt==='exited')return false;
          var ex=String(row[execCol]||'').trim().toLowerCase();
          var tl=String(row[tlCol]||'').trim().toLowerCase();
          if((ex&&ex===nm)||(tl&&tl===nm))return true;
          return aoIsBuddyOf(ex)||aoIsBuddyOf(tl);
        });
      });
    }
  }catch(e){/* tracker shape unexpected — fail closed, don't crash dashboard */}
  return false;
}
// Check if current user can edit a task
function canEditTask(t){
  if(CU.isAdmin) return true;
  if(t._isLeadTask) return isLead()&&t._leadOwner===CU.username;
  return false; // admin tasks: non-admin cannot edit
}
function canDeleteTask(t){
  if(CU.isAdmin) return true;
  if(t._isLeadTask) return isLead()&&t._leadOwner===CU.username;
  return false;
}
function isLead(){ return CU && !CU.isAdmin && LEAD_ROLES.includes(CU.role); }
function isNonTOD(){ return CU && !CU.isAdmin && CU.role !== 'Talent on Demand'; }
function canSeeDataTab(){ return CU && (CU.isAdmin || isLead()); }
const DEFAULT_TASKS=[
  {id:1,title:'Abnormal orders tracking',freq:'daily',dow:null,time:'12:00 PM',deadline:'12:00 PM',dh:12,dm:0,assignees:[],note:''},
  {id:2,title:'SIS checking',freq:'daily',dow:null,time:'5:00 PM',deadline:'5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:3,title:'Category checking',freq:'daily',dow:null,time:'5:00 PM',deadline:'5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:4,title:'Listing checks',freq:'daily',dow:null,time:'5:00 PM',deadline:'5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:5,title:'Lazada finance report',freq:'weekly',dow:2,time:'5:00 PM',deadline:'Every Tuesday 5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:6,title:'Shopee finance report',freq:'weekly',dow:4,time:'5:00 PM',deadline:'Every Thursday 5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:7,title:'TikTok finance report',freq:'weekly',dow:4,time:'5:00 PM',deadline:'Every Thursday 5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:8,title:'Account health',freq:'weekly',dow:1,time:'5:00 PM',deadline:'Every Monday 5:00 PM',dh:17,dm:0,assignees:[],note:''},
  {id:9,title:'Weekly incident report',freq:'weekly',dow:5,time:'5:00 PM',deadline:'Every Friday 5:00 PM',dh:17,dm:0,assignees:[],note:''},
];
const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOWF=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// How far back the dashboard looks when rolling forward still-pending recurring tasks.
const CARRYOVER_LOOKBACK_DAYS=120;

let CU=null;
let D={tasks:[],members:[],statuses:{},actLog:[],calEntries:{},campaigns:{},broadcast:null,incidents:[],extRequests:{},groups:[],trackers:{},todAttendance:{},todOvertime:{},auditLog:[],leaves:[],leadTasks:[],weeklyReports:[],personalTasks:[],nonCompliance:{},frCompletions:{},_tLoaded:false,_mLoaded:false};
// FR_WEEK_OFFSET declared early: Finance-tracker render helpers reference it well before its
// former mid-file declaration, which threw "Cannot access 'FR_WEEK_OFFSET' before initialization".
// Defaults live here; loadFRConfig() later merges admin overrides from Firebase into this same object.
let FR_WEEK_OFFSET={Lazada:-1,Shopee:0,TikTok:0};
let _extListenerInit=false;
let _ncListenerInit=false;
let _activeTracker=null,_activeTrackerSheet=null;

let _todWeekStart=null;
let _todViewMode='weekly'; // 'weekly' | 'monthly'
let _todMonthDate=null; // Date, day is irrelevant — represents the viewed month
let _todSelectedMember=''; // username selected for monthly detail view (admin/lead)
let viewDate=new Date(),calViewDate=new Date(),selCalDate=null;
let _editTId=null,_selM=[],_selTagged=[];
let _listeners=[],_curPage='dashboard';

// Firebase
const fbRef=p=>FDB.ref(p);
const fbGet=async p=>{const s=await fbRef(p).get();return s.exists()?s.val():null;};
const fbSet=async(p,v)=>{setSyncing(1);await fbRef(p).set(v);setSyncing(0);};
const fbUpd=async(p,v)=>{setSyncing(1);await fbRef(p).update(v);setSyncing(0);};
const fbPush=async(p,v)=>{setSyncing(1);const r=await fbRef(p).push(v);setSyncing(0);return r.key;};
const fbDel=async p=>{setSyncing(1);await fbRef(p).remove();setSyncing(0);};
function fbListen(p,cb){const r=fbRef(p);r.on('value',s=>cb(s.exists()?s.val():null));_listeners.push(r);}
function stopListeners(){_listeners.forEach(r=>r.off('value'));_listeners=[];}
function setSyncing(v){const d=document.getElementById('sync-dot');if(d)d.classList.toggle('busy',!!v);}

// Helpers
const ini=n=>(n||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const ds=function(d){
  // Use local date to avoid UTC offset issues
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+dd;
};
const fmtD=d=>d.toLocaleDateString('en-PH',{weekday:'short',year:'numeric',month:'short',day:'numeric'});
const fmtM=d=>d.toLocaleDateString('en-PH',{month:'long',year:'numeric'});
const now=()=>new Date();
// Full audit-style stamp: "Jun 23, 2:54 PM · Vhino" — always includes the date so a stale
// entry from a previous day is never mistaken for a same-day update.
function ltStamp(){
  const n=now();
  const datePart=n.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
  const timePart=n.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
  const firstName=(CU&&CU.name?CU.name.split(' ')[0]:'')||'';
  return datePart+', '+timePart+(firstName?' · '+firstName:'');
}
function fmtHours(ms){if(!ms||ms<=0)return'0h 0m';var t=Math.floor(ms/60000);var h=Math.floor(t/60);var m=t%60;return h+'h '+m+'m';}

// Short "Aug 27 → Sep 10" style label for a task's Start/End Date window, for admin tables.
// Returns '' when no window is set (task remains ongoing, unchanged from before).
function taskWindowLabel(t){
  if(!t?.startDate&&!t?.endDate)return'';
  const fmt=s=>{if(!s)return'';const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('en-PH',{month:'short',day:'numeric'});};
  if(t.startDate&&t.endDate)return'<div style="font-size:10px;color:var(--blue);margin-top:2px">🗓 '+fmt(t.startDate)+' → '+fmt(t.endDate)+'</div>';
  if(t.startDate)return'<div style="font-size:10px;color:var(--blue);margin-top:2px">🗓 From '+fmt(t.startDate)+'</div>';
  return'<div style="font-size:10px;color:var(--blue);margin-top:2px">🗓 Until '+fmt(t.endDate)+'</div>';
}
// True if `dateStr` still falls inside the task's Start/End Date window (weekly tasks are
// exempt, per isSched). Used to cut off carry-over once a task's End Date has passed — isSched
// alone stops NEW occurrences, but an already-open carry chain needs this extra check too.
function inDateFence(t,dateStr){
  if(t.freq==='weekly')return true;
  if(t.startDate&&dateStr<t.startDate)return false;
  if(t.endDate&&dateStr>t.endDate)return false;
  return true;
}
function isSched(t,d){
  if(!t?.freq)return false;
  const dds=ds(d);
  // Start/End Date fence: if set, the task only appears on/after Start Date and on/before
  // End Date. Outside that window it's treated as not scheduled for that day at all —
  // it won't show on the assignee's dashboard, calendar, or be counted for compliance.
  // Weekly tasks are exempt for now (they keep their pre-existing always-recurring behavior,
  // since fencing interacts badly with their carry-over chain) — revisit if needed later.
  if(t.freq!=='weekly'){
    if(t.startDate&&dds<t.startDate)return false;
    if(t.endDate&&dds>t.endDate)return false;
  }
  const dow=d.getDay(),date=d.getDate(),m=d.getMonth();
  if(t.freq==='daily')return true;
  if(t.freq==='weekly')return parseInt(t.dow)===dow;
  if(t.freq==='monthly')return parseInt(t.dayOfMonth||1)===date;
  if(t.freq==='quarterly')return[0,3,6,9].includes(m)&&date===1;
  if(t.freq==='eom'){const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();return date===last;}
  // occasional and other tasks always appear on the dashboard (within the date fence above)
  if(t.freq==='occasional'||t.freq==='other')return true;
  return false;
}
// Parse a free-typed time string like "7:00 PM" or "19:00" into [hours,minutes]. Returns null if unparseable.
function parseTimeStr(str){
  if(!str)return null;
  const m=String(str).trim().match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM|am|pm)?$/);
  if(!m)return null;
  let h=parseInt(m[1],10),mi=m[2]?parseInt(m[2],10):0;
  const ap=(m[3]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12;
  if(ap==='AM'&&h===12)h=0;
  if(isNaN(h)||isNaN(mi)||h>23||mi>59)return null;
  return[h,mi];
}
// Approved extension covering this task+date, if any
function getApprovedExt(taskId,date){
  return Object.values(D.extRequests||{}).find(function(r){return r.taskId==taskId&&r.date===date&&r.status==='Approved';});
}
// A task is overdue relative to its admin-set deadline — unless an approved extension
// has moved that deadline, in which case the extension's proposed date/time applies instead.
function isOverdue(t,date){
  const n=now(),dds=ds(n);
  const ext=getApprovedExt(t.id,date);
  if(ext&&ext.proposedDate){
    const hm=parseTimeStr(ext.proposedTime)||[t.dh||17,t.dm||0];
    if(dds<ext.proposedDate)return false;
    if(dds>ext.proposedDate)return true;
    return n.getHours()>hm[0]||(n.getHours()===hm[0]&&n.getMinutes()>hm[1]);
  }
  if(date!==dds)return false;
  // One-time tasks ('Other'/'Occasional') with an End Date set: Start/End Date only control when
  // the task is *visible* on the dashboard (see the "Leave dates blank..." hint in the task
  // editor) — the actual deadline is a single fixed instant, End Date @ End Time. Without this
  // guard, a multi-day Start→End window would incorrectly re-trigger "overdue" on every day
  // inside the window (e.g. Start Sep 10 / End Sep 12 would already flag as overdue on the 10th),
  // instead of only once the real due date/time (Sep 12, 1am) actually arrives.
  if((t.freq==='other'||t.freq==='occasional')&&t.endDate){
    if(dds<t.endDate)return false; // window is open but the real deadline hasn't arrived yet
    if(dds>t.endDate)return false; // isSched already stops scheduling past End Date; guard anyway
  }
  return n.getHours()>(t.dh||17)||(n.getHours()===(t.dh||17)&&n.getMinutes()>(t.dm||0));
}

const sKey=(id,date)=>`${date}_${id}`;

// ── CORE STATUS COMPUTATION ──
// Single source of truth: member statuses drive everything
function getMemberStatuses(taskId, date){
  const raw=D.statuses[sKey(taskId,date)]||{};
  return raw.members||{};
}

function getMemberStatus(taskId, date, username){
  return getMemberStatuses(taskId,date)[username]||'Pending';
}

// Compute task-level overall from actual member statuses
function computeTaskOverall(taskId, date){
  const task=(D.tasks.find(t=>t.id==taskId))||(D.leadTasks||[]).find(t=>t.id==taskId);
  if(!task||(task.assignees||[]).length===0) return 'Pending';
  // AO-linked tasks: status from tracker input
  if(task.aoLinked) return getAOStatusForDate(date);
  // Finance report linked tasks — resolve against THIS date's own reporting cycle, not
  // whatever cycle happens to be live today (see getFRStatusForTaskObj).
  if(task.frLinked){return getFRStatusForTaskObj(task,date);}
  const mems=getMemberStatuses(taskId,date);
  const vals=(task.assignees||[]).map(u=>mems[u]||'Pending');
  if(vals.every(v=>v==='Done')) return 'Done';
  if(vals.some(v=>v==='Ongoing'||v==='Done')) return 'Ongoing';
  if(vals.some(v=>v==='Needs Extension')) return 'Needs Extension';
  return 'Pending';
}


function buildAOInlineRegions(date){
  const aoComp=getAOCompletionForDashboard(date);
  if(!aoComp) return '<div style="font-size:11px;color:var(--text3);margin-top:4px">No tracker linked — <button class="btn sm" onclick="showPage(\'live-trackers\')" style="font-size:10px;padding:2px 8px">Link Tracker</button></div>';
  const AO_R=[{key:'MY',label:'MY'},{key:'TH',label:'TH'},{key:'VN',label:'VN'},{key:'SG',label:'SG'}];
  const items=AO_R.map(function(r){
    const d=aoComp[r.key]||{order:{done:0,total:0,pct:0},product:{done:0,total:0,pct:0}};
    const oPct=d.order.pct, pPct=d.product.pct;
    const overallPct=Math.round((oPct+pPct)/2);
    const col=overallPct>=100?'var(--green)':overallPct>0?'var(--yellow)':'var(--red)';
    const oCol=oPct>=100?'var(--green)':oPct>0?'var(--yellow)':'var(--red)';
    const pCol=pPct>=100?'var(--green)':pPct>0?'var(--yellow)':'var(--red)';
    return '<div style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:20px;background:'+col+'18;border:1px solid '+col+'44;margin:2px">'
      +'<span style="font-size:10px;font-weight:700;color:'+col+'">'+r.label+'</span>'
      +'<span style="font-size:10px;color:'+oCol+'">Ord '+oPct+'%</span>'
      +'<span style="font-size:9px;color:var(--text4)">|</span>'
      +'<span style="font-size:10px;color:'+pCol+'">Prd '+pPct+'%</span>'
    +'</div>';
  }).join('');
  return '<div id="ao-inline-regions" style="margin-top:5px;display:flex;flex-wrap:wrap;gap:2px">'+items+'</div>';
}

// Helper: find the correct [orderCol, productCol] indices for a specific date in an AO sheet.
// Returns a stable, ever-increasing "week block" number for a given date, anchored to a
// fixed Monday. Used so virtual (non-Excel-header) AO columns get a UNIQUE slot per calendar
// week instead of being reused every week — previously virtual columns were computed from
// weekday-position only (Mon=0...Fri=4) with no notion of *which* week, so week 2's Monday
// column was the exact same Firebase storage slot as week 1's Monday column, and any old
// value typed there would silently reappear as if it were new/blank-cell data. Do not change
// the anchor date below — it only has to be *a* Monday, not any particular one.
const AO_WEEK_EPOCH_MS=new Date('2026-06-29T00:00:00').getTime();
function aoWeekBlock(dateStr){
  const d=new Date(dateStr+'T00:00:00').getTime();
  return Math.floor(Math.round((d-AO_WEEK_EPOCH_MS)/86400000)/7);
}
// Handles three cases:
//   1. Excel has a header for this exact date → use that column pair
//   2. Excel has NO headers at all → virtual fallback: maxCol + weekBlock*10 + weekdayOffset*2
//   3. Excel has PARTIAL headers (some days covered, this day missing) → same virtual fallback
// This must exactly mirror buildAOTable's virtual column index: maxCol + aoWeekBlock(date)*10 + wi*2
// where wi = day's position in Mon-Fri week (Mon=0 ... Fri=4).
function aoFindDateCols(row0, date, row1){
  // Try to find a matching Excel header first
  const exactCols=[];
  row0.forEach(function(h,ci){
    if(!h)return;
    const mo=String(h).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(mo){
      const d=mo[3]+'-'+mo[1].padStart(2,'0')+'-'+mo[2].padStart(2,'0');
      if(d===date){exactCols.push(ci);if(ci+1<row0.length)exactCols.push(ci+1);}
    }
  });
  if(exactCols.length)return exactCols;

  // No exact header found — use virtual column fallback.
  // maxCol must mirror buildAOTable: Math.max(row0.length, row1.length)
  const maxCol=Math.max(row0.length,(row1||[]).length,4);
  const dow=new Date(date+'T12:00:00').getDay(); // 0=Sun,1=Mon...6=Sat
  // Map getDay() → Mon-Fri week-index (wi) to match buildAOTable's weekDates[wi]
  const dowToWi={1:0,2:1,3:2,4:3,5:4}; // Mon=0...Fri=4
  const wi=dowToWi[dow];
  if(wi===undefined)return[]; // weekend — no AO data
  const vci=maxCol+aoWeekBlock(date)*10+wi*2;
  return[vci, vci+1];
}

// ── AO Row Ownership (CDM / Team Lead access control) ──
// A row "belongs" to whoever is named in its CDM (col 2) or Team Lead (col 3) cell.
// Admin always has full access. Everyone else gets view-only on rows that aren't theirs.
function aoIsRowOwner(row){
  if(CU&&CU.isAdmin)return true;
  if(!row)return false;
  const nm=(CU&&CU.name||'').trim().toLowerCase();
  if(!nm)return false;
  const cdm=row[2]!=null?String(row[2]).trim().toLowerCase():'';
  const tl=row[3]!=null?String(row[3]).trim().toLowerCase():'';
  if((cdm&&cdm===nm)||(tl&&tl===nm))return true;
  // Standing buddy system: if the current user is the assigned buddy of whoever owns
  // this row (its CDM or Team Lead), they get the same edit access as that owner. The
  // pairing lives on the member record (member.buddy = the buddy's username), so it's
  // permanent and admin-auditable rather than derived from individual leave entries.
  return aoIsBuddyOf(cdm)||aoIsBuddyOf(tl);
}
// True if the current user is the standing buddy of the member whose display name is
// `ownerNameLc` (already lowercased). Resolves owner name -> member record -> that
// member's buddy username, then compares to the current user's username.
function aoIsBuddyOf(ownerNameLc){
  if(!ownerNameLc)return false;
  const me=(CU&&CU.username||'').trim().toLowerCase();
  if(!me)return false;
  const owner=(D.members||[]).find(function(m){return m&&m.name&&m.name.trim().toLowerCase()===ownerNameLc;});
  if(!owner||!owner.buddy)return false;
  return String(owner.buddy).trim().toLowerCase()===me;
}
// Admin-only: assign/reassign the CDM (colIdx=2) or Team Lead (colIdx=3) for a row,
// picked from registered members so it always matches a real login name exactly.
async function ltSetRowAssignee(trackerKey,sheetKey,ri,colIdx,value){
  if(!CU.isAdmin){toast('Admin only.');return;}
  if(!D.trackers[trackerKey])D.trackers[trackerKey]={};
  if(!D.trackers[trackerKey].sheets)D.trackers[trackerKey].sheets={};
  if(!D.trackers[trackerKey].sheets[sheetKey])D.trackers[trackerKey].sheets[sheetKey]={rows:[],timestamps:{}};
  const localSheet=D.trackers[trackerKey].sheets[sheetKey];
  if(!localSheet.rows)localSheet.rows=[];
  if(!localSheet.rows[ri])localSheet.rows[ri]=[];
  localSheet.rows[ri][colIdx]=value||'';
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const updates={};
  updates['rows/'+ri+'/'+colIdx]=value||'';
  await fbUpd(path,updates);
  toast((colIdx===2?'CDM':'Team Lead')+' updated.');
  renderLiveTrackers();
}

// ── AO Account Status (Active / Exited) ──
// The AO date-column layout is index-fragile: fixed cols are 0=Brand,1=Platform,2=CDM,
// 3=Team Lead and every date column is computed off those positions and off maxCol. Inserting
// a real "Status" column into each row array would shift every date column and corrupt
// aoWeekBlock()/aoFindDateCols(). So AO status + exit date live in a PARALLEL per-row map on the
// sheet (sheet.aoMeta[rowIndex] = {status:'Active'|'Exited', exitDate:'YYYY-MM-DD'}) keyed by the
// row's true array index — never in the row array itself.
function aoRowStatus(sheet,ri){
  const meta=sheet&&sheet.aoMeta&&sheet.aoMeta[ri];
  const s=meta&&meta.status?String(meta.status).trim():'';
  return s||'Active';
}
function aoRowExitDate(sheet,ri){
  const meta=sheet&&sheet.aoMeta&&sheet.aoMeta[ri];
  return meta&&meta.exitDate?String(meta.exitDate).trim():'';
}
// True unless the row is marked Exited or Inactive in aoMeta. Used everywhere completion is
// computed so hidden (exited/inactive) brands never count toward the denominator — otherwise a
// fully-filled region can never reach 100%.
function aoRowIsActive(sheet,ri){
  const meta=sheet&&sheet.aoMeta&&sheet.aoMeta[ri];
  const st=meta&&meta.status?String(meta.status).trim().toLowerCase():'';
  return st!=='exited'&&st!=='inactive';
}
// Admin-only: set a row's AO status. 'Exited' requires an exit date (collected via the modal).
async function aoSetRowStatus(trackerKey,sheetKey,ri,status,exitDate){
  if(!CU.isAdmin){toast('Admin only.');return;}
  if(!D.trackers[trackerKey])D.trackers[trackerKey]={};
  if(!D.trackers[trackerKey].sheets)D.trackers[trackerKey].sheets={};
  if(!D.trackers[trackerKey].sheets[sheetKey])D.trackers[trackerKey].sheets[sheetKey]={rows:[],timestamps:{}};
  const localSheet=D.trackers[trackerKey].sheets[sheetKey];
  if(!localSheet.aoMeta)localSheet.aoMeta={};
  localSheet.aoMeta[ri]={status:status,exitDate:status==='Exited'?(exitDate||''):''};
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/aoMeta/'+ri,localSheet.aoMeta[ri]);
  toast(status==='Exited'?'Brand marked as Exited and moved to the Exited tab.':status==='Inactive'?'Brand marked as Inactive and listed in the Exited tab.':'Status updated to '+status+'.');
  closeModal('modal-lt-upload');
  renderLiveTrackers();
}
// Inline dropdown handler. Active → save immediately. Exited → open a centered modal that
// requires an exit date before saving (mirrors the Finance Report "Set Account as Exited" popup).
function aoInlineStatusChange(trackerKey,sheetKey,ri,newStatus,selectEl){
  if(!CU.isAdmin){toast('Admin only.');if(selectEl){const t=D.trackers[trackerKey];const sh=t&&t.sheets?t.sheets[sheetKey]:null;selectEl.value=aoRowStatus(sh,ri);}return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sh=(t.sheets||{})[sheetKey];if(!sh)return;
  const row=(sh.rows||[])[ri]||[];
  const brand=String(row[0]||'').trim()||'This brand';
  if(newStatus==='Exited'){
    const cur=aoRowExitDate(sh,ri)||ds(now());
    document.getElementById('mlt-body').innerHTML=''
      +'<div style="margin-bottom:12px;font-size:14px;font-weight:600">'+escHtml(brand)+'</div>'
      +'<div class="fg" style="margin-bottom:12px"><div style="display:inline-block;padding:3px 12px;border-radius:20px;border:1px solid var(--red);background:var(--red-light);color:var(--red);font-size:12px;font-weight:700">Exited</div></div>'
      +'<div style="padding:12px;background:var(--red-light);border:1px solid var(--red-mid);border-radius:var(--radius)">'
        +'<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ Offboarding Date Required</div>'
        +'<label class="flabel">Offboarding / Exit Date</label>'
        +'<input class="finput nb" id="ao-exit-date" type="date" value="'+escHtml(cur)+'"/>'
        +'<div style="font-size:11px;color:var(--red);margin-top:4px">This brand will be moved to the Exited tab.</div>'
      +'</div>'
      +'<div class="form-actions" style="margin-top:14px">'
        +'<button class="btn primary" onclick="aoConfirmExit(\''+trackerKey+'\',\''+sheetKey+'\','+ri+')">Confirm Exit</button>'
        +'<button class="btn" onclick="closeModal(\'modal-lt-upload\');renderLiveTrackers()">Cancel</button>'
      +'</div>';
    document.getElementById('modal-lt-upload').querySelector('h3').textContent='Set Brand as Exited';
    openModal('modal-lt-upload');
    if(selectEl)selectEl.value=aoRowStatus(sh,ri);
    return;
  }
  if(newStatus==='Inactive'){
    // Inactive: confirm only (no exit date). Brand leaves the active view and appears in the
    // Exited tab, mirroring the Finance Report "Set Account as Inactive" flow.
    document.getElementById('mlt-body').innerHTML=''
      +'<div style="margin-bottom:12px;font-size:14px;font-weight:600">'+escHtml(brand)+'</div>'
      +'<div class="fg" style="margin-bottom:12px"><div style="display:inline-block;padding:3px 12px;border-radius:20px;border:1px solid var(--yellow);background:var(--yellow-light);color:#92400e;font-size:12px;font-weight:700">Inactive</div></div>'
      +'<div style="padding:12px;background:var(--yellow-light);border:1px solid var(--yellow);border-radius:var(--radius)">'
        +'<div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">⚠️ Confirm Status Change</div>'
        +'<div style="font-size:12px;color:#92400e">Set this brand as <b>Inactive</b>? It will be removed from the active view and listed in the <b>Exited</b> tab.</div>'
      +'</div>'
      +'<div class="form-actions" style="margin-top:14px">'
        +'<button class="btn primary" onclick="aoSetRowStatus(\''+trackerKey+'\',\''+sheetKey+'\','+ri+',\'Inactive\',\'\')">Confirm</button>'
        +'<button class="btn" onclick="closeModal(\'modal-lt-upload\');renderLiveTrackers()">Cancel</button>'
      +'</div>';
    document.getElementById('modal-lt-upload').querySelector('h3').textContent='Set Brand as Inactive';
    openModal('modal-lt-upload');
    if(selectEl)selectEl.value=aoRowStatus(sh,ri);
    return;
  }
  // Active — save directly.
  aoSetRowStatus(trackerKey,sheetKey,ri,'Active','');
}
function aoConfirmExit(trackerKey,sheetKey,ri){
  const exitDate=document.getElementById('ao-exit-date')?.value||'';
  if(!exitDate){toast('Please pick an exit date.');return;}
  aoSetRowStatus(trackerKey,sheetKey,ri,'Exited',exitDate);
}
// Admin-only: update an exit date from the Exited tab.
async function aoUpdateExitDate(trackerKey,sheetKey,ri,val){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sh=(t.sheets||{})[sheetKey];if(!sh)return;
  if(!sh.aoMeta)sh.aoMeta={};
  const cur=sh.aoMeta[ri]||{status:'Exited',exitDate:''};
  cur.exitDate=val||'';cur.status='Exited';
  sh.aoMeta[ri]=cur;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/aoMeta/'+ri,cur);
  toast('Offboarding date updated.');
}
// Admin-only: revert an exited brand back to Active from the Exited tab.
async function aoReactivateRow(trackerKey,sheetKey,ri){
  if(!CU.isAdmin){toast('Admin only.');return;}
  await aoSetRowStatus(trackerKey,sheetKey,ri,'Active','');
}

// ── Finance Report Row Ownership (Exec/CDM / Team Lead access control) ──
// Mirrors aoIsRowOwner: a brand row "belongs" to whoever is named in its Exec/CDM or
// Team Lead cell. Admin always has full access; everyone else gets view-only on rows
// that aren't assigned to them.
function frIsRowOwner(row,execCol,tlCol){
  if(CU&&CU.isAdmin)return true;
  if(!row)return false;
  const nm=(CU&&CU.name||'').trim().toLowerCase();
  if(!nm)return false;
  const ex=row[execCol]!=null?String(row[execCol]).trim().toLowerCase():'';
  const tl=row[tlCol]!=null?String(row[tlCol]).trim().toLowerCase():'';
  if((ex&&ex===nm)||(tl&&tl===nm))return true;
  // Same standing-buddy grant as the AO tracker (see aoIsRowOwner): a member's assigned
  // buddy inherits the owner's edit access on Finance rows too.
  return aoIsBuddyOf(ex)||aoIsBuddyOf(tl);
}
// Admin-only: edit any fixed-column cell (Region, Platform, Account Status text fallback,
// Synagie Merchant ID, Brand/Store Name) on a Finance Report row. Exec/CDM and Team Lead use
// frSetRowAssignee (dropdown of real members) instead, same split as the AO tracker.
async function frUpdateFixedCell(trackerKey,sheetKey,ri,colIdx,value){
  if(!CU.isAdmin){toast('Admin only.');return;}
  if(!D.trackers[trackerKey])return;
  const sheet=(D.trackers[trackerKey].sheets||{})[sheetKey];if(!sheet)return;
  if(!sheet.rows)sheet.rows=[];
  if(!sheet.rows[ri])sheet.rows[ri]=[];
  sheet.rows[ri][colIdx]=value;
  const updates={};updates['rows/'+ri+'/'+colIdx]=value;
  await fbUpd('trackers/'+trackerKey+'/sheets/'+sheetKey,updates);
  renderLiveTrackers();
}
// Admin-only: assign/reassign Exec/CDM or Team Lead for a Finance Report row, picked from
// registered members so access control always matches a real login name exactly.
async function frSetRowAssignee(trackerKey,sheetKey,ri,colIdx,value){
  if(!CU.isAdmin){toast('Admin only.');return;}
  if(!D.trackers[trackerKey])return;
  const sheet=(D.trackers[trackerKey].sheets||{})[sheetKey];if(!sheet)return;
  if(!sheet.rows)sheet.rows=[];
  if(!sheet.rows[ri])sheet.rows[ri]=[];
  sheet.rows[ri][colIdx]=value||'';
  const updates={};updates['rows/'+ri+'/'+colIdx]=value||'';
  await fbUpd('trackers/'+trackerKey+'/sheets/'+sheetKey,updates);
  toast('Assignee updated.');
  renderLiveTrackers();
}

function getAOStatusForDate(date){
  // Future dates have no data by definition — always Pending
  if(date>ds(now())) return 'Pending';
  const linkedEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].aoLinked;});
  if(!linkedEntry) return 'Pending';
  const linked=linkedEntry[1];
  const AO_SHEETS=['MY','SG','TH','VN'];
  let totalRows=0,filledRows=0;
  AO_SHEETS.forEach(function(key){
    const sh=linked.sheets&&linked.sheets[key];
    if(!sh) return;
    const row0=sh.row0||[];
    const row1=sh.row1||[];
    const dateCols=aoFindDateCols(row0,date,row1);
    if(!dateCols.length)return;
    // Use live local rows so ltUpdateCell edits are counted
    const liveSheet=(D.trackers[linkedEntry[0]]||{}).sheets;
    const _liveObj=liveSheet&&liveSheet[key]?liveSheet[key]:sh;
    const liveRows=_liveObj&&_liveObj.rows?_liveObj.rows:(sh.rows||[]);
    const dataRows=liveRows.filter(function(row,ri){
      if(!(row&&row[0]!=null&&String(row[0]).trim()&&String(row[0]).toUpperCase()!=='TOTAL'))return false;
      return aoRowIsActive(_liveObj,ri); // skip exited/inactive brands
    });
    totalRows+=dataRows.length;
    dataRows.forEach(function(row){
      // Any entered value (including 0) counts as tracked — only blank/null/OFF means not yet entered
      if(dateCols.some(function(ci){const v=row[ci];return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v).toUpperCase()!=='OFF';}))filledRows++;
    });
  });
  if(!totalRows) return 'Pending';
  const pct=Math.round(filledRows/totalRows*100);
  if(pct>=100) return 'Done';
  if(pct>0) return 'Ongoing';
  return 'Pending';
}

function taskCompletionRate(taskId, date){
  const task=(D.tasks.find(t=>t.id==taskId))||(D.leadTasks||[]).find(t=>t.id==taskId);
  if(!task||(task.assignees||[]).length===0) return {done:0,total:0,pct:0};
  if(task.aoLinked){
    // Future dates have no inputs — always 0%
    if(date>ds(now())) return {done:0,total:0,pct:0};
    const linkedEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].aoLinked;});
    if(!linkedEntry) return {done:0,total:0,pct:0};
    const linked=linkedEntry[1];
    const AO_SHEETS=['MY','SG','TH','VN'];
    let total=0,done=0;
    AO_SHEETS.forEach(function(key){
      const sh=linked.sheets&&linked.sheets[key];
      if(!sh) return;
      const row0=sh.row0||[];
      const row1=sh.row1||[];
      const dateCols=aoFindDateCols(row0,date,row1);
      if(!dateCols.length)return;
      // Use live local rows
      const liveSheet=(D.trackers[linkedEntry[0]]||{}).sheets;
      const _liveObj=liveSheet&&liveSheet[key]?liveSheet[key]:sh;
      const liveRows=_liveObj&&_liveObj.rows?_liveObj.rows:(sh.rows||[]);
      const dataRows=liveRows.filter(function(row,ri){
        if(!(row&&row[0]!=null&&String(row[0]).trim()&&String(row[0]).toUpperCase()!=='TOTAL'))return false;
        return aoRowIsActive(_liveObj,ri); // skip exited/inactive brands
      });
      total+=dataRows.length;
      dataRows.forEach(function(row){
        // Any entered value (including 0) counts as tracked/filled — only blank/null/OFF means not yet entered
        if(dateCols.some(function(ci){const v=row[ci];return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v).toUpperCase()!=='OFF';})) done++;
      });
    });
    return {done,total,pct:total?Math.round(done/total*100):0};
  }
  // Finance report linked tasks — same date-scoped cycle lookup as computeTaskOverall.
  if(task.frLinked){return getFRCompletionForTaskObj(task,date);}
  const mems=getMemberStatuses(taskId,date);
  const total=(task.assignees||[]).length;
  const done=(task.assignees||[]).filter(u=>(mems[u]||'Pending')==='Done').length;
  return {done,total,pct:total?Math.round(done/total*100):0};
}

// ── CARRY-OVER (pending tasks roll to the next day until completed) ──
// A recurring task that was scheduled on an earlier day and never fully completed keeps
// appearing on later days until every assignee is Done. Progress accumulates across all the
// days it stayed open: a member counts as done if they completed it on ANY day in that window.
const _dateStrToObj=s=>new Date(s+'T00:00:00');
const _addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};

// Most recent day on-or-before `viewD` that this task was actually scheduled. null if none.
function lastScheduledOnOrBefore(t,viewD){
  for(let i=0;i<400;i++){
    const d=_addDays(viewD,-i);
    if(isSched(t,d))return d;
  }
  return null;
}

// Origin date of the CURRENT open carry-chain: walk backward over this task's scheduled
// occurrences starting from the view date. Each occurrence day that was NOT completed (overall
// Done) on its own day extends the chain further back. The walk stops as soon as it hits an
// occurrence day that WAS Done — that day closed any earlier chain. Returns the earliest
// still-open occurrence date, or null if the view-date occurrence itself is already Done.
//
// Rationale: an unfinished recurring task keeps rolling forward as ONE running item that
// accumulates progress across every day it stayed open, until the day it's finally completed.
function carryOriginDate(t,viewD){
  // The chain must be live on the view date. If the task's own view-date occurrence is Done,
  // there is nothing carrying (it was completed today / on this occurrence).
  // Find the most recent scheduled occurrence on-or-before the view date.
  let cur=null;
  for(let i=0;i<=CARRYOVER_LOOKBACK_DAYS;i++){
    const d=_addDays(viewD,-i);
    if(isSched(t,d)&&!t.inactive){cur=d;break;}
  }
  if(!cur)return null;
  const curStr=ds(cur);
  if(computeTaskOverall(t.id,curStr)==='Done')return null; // finished on its current occurrence
  // Walk further back while each earlier occurrence was also not Done — they're part of the
  // same open chain. Stop at the first Done occurrence (exclusive).
  // Walk backward over earlier scheduled occurrences. The most recent occurrence that reached
  // Done is a hard barrier — anything before it belongs to an already-closed run. Within the
  // still-open run (everything after that barrier), the origin is the EARLIEST occurrence that
  // had real activity (any recorded member status). Blank days in between don't break the chain;
  // they're just days the task sat open. A run that never had any activity doesn't carry — the
  // task simply shows on its current day as normal.
  let origin=cur;
  let d=_addDays(cur,-1);
  for(let i=0;i<CARRYOVER_LOOKBACK_DAYS;i++){
    let prev=null;
    for(let j=0;j<=CARRYOVER_LOOKBACK_DAYS;j++){
      const dd=_addDays(d,-j);
      if(_addDays(viewD,-CARRYOVER_LOOKBACK_DAYS)>dd)break;
      if(isSched(t,dd)&&!t.inactive){prev=dd;break;}
    }
    if(!prev)break;
    const prevStr=ds(prev);
    if(computeTaskOverall(t.id,prevStr)==='Done')break; // barrier: earlier run already closed
    if(hasAnyStatus(t.id,prevStr))origin=prev;          // extend origin to this engaged day
    d=_addDays(prev,-1);
  }
  // If nothing before the current day was ever engaged, there's no real carry — return the
  // current occurrence date (caller treats origin===viewDate as "not carried").
  return ds(origin);
}
// True if any member status was ever recorded for this task on this date.
function hasAnyStatus(taskId,dateStr){
  const mems=getMemberStatuses(taskId,dateStr);
  return mems&&Object.keys(mems).length>0;
}

// ── Tracker-linked completion dates (linger-through-completion-day) ──────────
// FR/AO task status is read LIVE from the tracker and is date-independent, so the moment the
// last cell is filled the task reads "Done" and would otherwise disappear the same instant.
// Requirement: a report assigned on the 1st but finished on the 4th must stay on the dashboard
// through the 4th and only drop off on the 5th. To do that we stamp the date the task's current
// reporting CYCLE first reaches 100% (per cycle, so next month starts fresh) and key the carry
// off that stamp. frCycleKey identifies the cycle: the month for a monthly task, else the active
// weekly column's due date. frGetCompletionDate returns the stored stamp (or null).
function frCycleKey(t){
  if(!(t.aoLinked||t.frLinked))return null;
  if(t.frLinked&&frTaskIsMonthly(t)){
    // Monthly cycle = the calendar month currently being reported. Anchor to the active monthly
    // column's due date (1st of the following month) when we can read it, so the key rolls over
    // exactly when the tracker's monthly column does; fall back to the current month.
    const linked=getFRLinked();
    const plats=frTaskPlatforms(t);
    if(linked&&plats.length){
      const sheet=getFRSheet(linked,plats[0]);
      if(sheet){
        const ci=frActiveMonthlyColIdx(sheet,plats[0]);
        const grp=_frScanDateCols(sheet,plats[0]).find(function(g){return g.ci===ci;});
        if(grp&&grp.dueDate){
          const dd=new Date(grp.dueDate);dd.setDate(dd.getDate()-1); // last covered day = the reported month
          return 'm'+dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0');
        }
      }
    }
    const n=now();return 'm'+n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0');
  }
  if(t.frLinked){
    // Weekly cycle = the active weekly column's due date (rolls forward each reporting week).
    const linked=getFRLinked();
    const plats=frTaskPlatforms(t);
    if(linked&&plats.length){
      const sheet=getFRSheet(linked,plats[0]);
      if(sheet){
        const ci=frActiveColIdx(sheet,plats[0]);
        const grp=_frScanDateCols(sheet,plats[0]).find(function(g){return g.ci===ci;});
        if(grp&&grp.dueDate)return 'w'+ds(grp.dueDate);
      }
    }
  }
  // AO or unresolved FR → key by the current ISO week so it still resets periodically.
  return 'w'+getWeekNumber(ds(now()));
}
function frGetCompletionDate(t){
  const key=frCycleKey(t);
  if(!key)return null;
  const rec=(D.frCompletions||{})[t.id];
  return rec&&rec[key]?rec[key]:null;
}
// Called on every tracker update: if a tracker-linked task's current cycle now reads Done and we
// haven't stamped a completion date for that cycle yet, stamp today. Idempotent — only writes once
// per cycle, so re-renders and multi-client listeners don't keep rewriting it.
function frRecordCompletions(){
  if(!CU)return;
  const all=[...(D.tasks||[]),...(D.leadTasks||[])];
  all.forEach(function(t){
    if(t.inactive||!(t.aoLinked||t.frLinked))return;
    if(computeTaskOverall(t.id,ds(now()))!=='Done')return;
    const key=frCycleKey(t);
    if(!key)return;
    const rec=(D.frCompletions||{})[t.id]||{};
    if(rec[key])return; // already stamped for this cycle
    const today=ds(now());
    // optimistic local update so the current render already sees it
    if(!D.frCompletions[t.id])D.frCompletions[t.id]={};
    D.frCompletions[t.id][key]=today;
    fbSet('frCompletions/'+t.id+'/'+key,today);
  });
}

// Carry-over for TRACKER-LINKED tasks (Finance Report / Abnormal Orders). These don't store
// per-day member statuses — their status comes live from the linked tracker (date-independent).
// A tracker task keeps appearing from its scheduled day until it is completed AND that completion
// day has passed: while pending it carries; on the day it hits 100% it still shows (so the team
// sees it close out that day); the day AFTER its recorded completion date it finally drops off.
// Returns the most recent PAST scheduled occurrence date (its original due day) while it should
// still show; otherwise null (nothing to carry).
function trackerCarryOrigin(t,viewD){
  if(!(t.aoLinked||t.frLinked))return null;
  const viewStr=ds(viewD);
  // If it's scheduled today, it's a normal occurrence, not a carry.
  if(isSched(t,viewD))return null;
  // If the cycle was completed, keep showing THROUGH the completion day; hide strictly after it.
  if(computeTaskOverall(t.id,viewStr)==='Done'){
    const cd=frGetCompletionDate(t);
    // Done but no stamp yet (e.g. completed before this feature, or stamp not written) → treat as
    // completed today so it still lingers one day rather than disappearing retroactively.
    if(!cd)return null;
    if(viewStr>cd)return null;      // past the completion day → drop off
    // else: viewStr <= cd → fall through and keep carrying (still its completion day)
  }
  // Find the most recent scheduled occurrence strictly before the view date.
  for(let i=1;i<=CARRYOVER_LOOKBACK_DAYS;i++){
    const d=_addDays(viewD,-i);
    if(isSched(t,d)&&!t.inactive)return ds(d);
  }
  return null;
}

// Cumulative member statuses across the carry window [originStr, viewStr]: a member is Done if
// they were Done on any day in the window; else Ongoing if ever Ongoing; else their view-day status.
function cumulativeMemberStatuses(t,originStr,viewStr){
  const out={};
  (t.assignees||[]).forEach(u=>{out[u]='Pending';});
  let d=_dateStrToObj(originStr);
  const end=_dateStrToObj(viewStr);
  for(let i=0;i<CARRYOVER_LOOKBACK_DAYS+2&&d<=end;i++){
    const mems=getMemberStatuses(t.id,ds(d));
    (t.assignees||[]).forEach(u=>{
      const s=mems[u];
      if(s==='Done')out[u]='Done';
      else if(s==='Ongoing'&&out[u]!=='Done')out[u]='Ongoing';
      else if(s==='Needs Extension'&&out[u]==='Pending')out[u]='Needs Extension';
    });
    d=_addDays(d,1);
  }
  return out;
}

// Overall + rate computed cumulatively over the carry window.
function computeTaskOverallCumulative(t,originStr,viewStr){
  if(t.aoLinked||t.frLinked)return computeTaskOverall(t.id,viewStr);
  if((t.assignees||[]).length===0)return 'Pending';
  const cm=cumulativeMemberStatuses(t,originStr,viewStr);
  const vals=(t.assignees||[]).map(u=>cm[u]||'Pending');
  if(vals.every(v=>v==='Done'))return 'Done';
  if(vals.some(v=>v==='Ongoing'||v==='Done'))return 'Ongoing';
  if(vals.some(v=>v==='Needs Extension'))return 'Needs Extension';
  return 'Pending';
}
function taskCompletionRateCumulative(t,originStr,viewStr){
  if(t.aoLinked||t.frLinked)return taskCompletionRate(t.id,viewStr);
  const cm=cumulativeMemberStatuses(t,originStr,viewStr);
  const total=(t.assignees||[]).length;
  const done=(t.assignees||[]).filter(u=>(cm[u]||'Pending')==='Done').length;
  return {done,total,pct:total?Math.round(done/total*100):0};
}

function computeDashboardMetrics(tasks, date){
  let totalAssignments=0,doneAssignments=0,ongoingAssignments=0,pendingAssignments=0;
  // Ageing: how many carried-over tasks there are and the oldest age (in days) among them.
  let carriedCount=0,maxAgeDays=0,agingSumDays=0;
  tasks.forEach(t=>{
    // frLinked and aoLinked tasks have no per-member statuses — use computeTaskOverall
    // so the assignment-level counters reflect actual tracker data instead of always "Pending"
    if(t.frLinked||t.aoLinked){
      const ov=computeTaskOverall(t.id,date);
      totalAssignments++;
      if(ov==='Done')doneAssignments++;
      else if(ov==='Ongoing')ongoingAssignments++;
      else pendingAssignments++;
      // A tracker task that carried over from an earlier day still counts toward ageing.
      if(t._carryOrigin){const age=carryDaysOpen(t,date);carriedCount++;if(age>maxAgeDays)maxAgeDays=age;agingSumDays+=age;}
      return;
    }
    // Carried-over tasks: count each assignee by their CUMULATIVE status across the carry window
    // so the top counters match what the task rows show, and tally the task's ageing.
    if(t._carryOrigin){
      const age=carryDaysOpen(t,date); // full days open since origin (0 = same day)
      carriedCount++;
      if(age>maxAgeDays)maxAgeDays=age;
      agingSumDays+=age;
      const cm=cumulativeMemberStatuses(t,t._carryOrigin,date);
      (t.assignees||[]).forEach(u=>{
        const st=cm[u]||'Pending';
        totalAssignments++;
        if(st==='Done')doneAssignments++;
        else if(st==='Ongoing')ongoingAssignments++;
        else pendingAssignments++;
      });
      return;
    }
    const mems=getMemberStatuses(t.id,date);
    (t.assignees||[]).forEach(u=>{
      const st=mems[u]||'Pending';
      totalAssignments++;
      if(st==='Done')doneAssignments++;
      else if(st==='Ongoing')ongoingAssignments++;
      else pendingAssignments++;
    });
  });
  // Task-level counts — cumulative overall for carried tasks
  let taskDone=0,taskOngoing=0,taskPending=0;
  tasks.forEach(t=>{
    const ov=t._carryOrigin?computeTaskOverallCumulative(t,t._carryOrigin,date):computeTaskOverall(t.id,date);
    if(ov==='Done')taskDone++;
    else if(ov==='Ongoing')taskOngoing++;
    else taskPending++;
  });
  const pct=totalAssignments?Math.round(doneAssignments/totalAssignments*100):0;
  return{totalAssignments,doneAssignments,ongoingAssignments,pendingAssignments,taskDone,taskOngoing,taskPending,pct,taskTotal:tasks.length,carriedCount,maxAgeDays,agingSumDays};
}

const getMN=u=>u===ADMIN_UN?ADMIN_NAME:(D.members.find(m=>m.username===u)?.name||u);
const getRole=u=>u===ADMIN_UN?'Admin':(D.members.find(m=>m.username===u)?.role||'Member');

function sbc(s){if(s==='Done')return'sb-d';if(s==='Ongoing')return'sb-o';if(s==='Needs Extension')return'sb-ne';if(s==='Escalated')return'sb-esc';return'sb-p';}
function sdc(s){if(s==='Done')return'sd-d';if(s==='Ongoing')return'sd-o';if(s==='Needs Extension')return'sd-ne';if(s==='Escalated')return'sd-esc';return'sd-p';}
function toast(msg,dur=2500){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),dur);}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function showMsg(id,msg){const e=document.getElementById(id);if(e){e.textContent=msg;e.style.display='block';}}
function hideMsg(id){const e=document.getElementById(id);if(e)e.style.display='none';}
function saveSession(){if(CU)localStorage.setItem(SESSION_KEY,JSON.stringify(CU));}
function clearSession(){localStorage.removeItem(SESSION_KEY);}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{return null;}}

function rateBarHtml(pct){
  const col=pct>=80?'var(--green)':pct>=50?'var(--yellow)':'var(--red)';
  return `<div class="rate-bar-wrap"><div class="rate-bar"><div class="rate-bar-fill" style="width:${pct}%;background:${col}"></div></div><div style="font-size:11px;font-weight:700;color:${col};text-align:right">${pct}%</div></div>`;
}

// Days a carried-over task has been open (origin → view date), inclusive of the origin day.
function carryDaysOpen(t,viewStr){
  if(!t._carryOrigin)return 0;
  const a=new Date(t._carryOrigin+'T00:00:00'),b=new Date(viewStr+'T00:00:00');
  return Math.max(0,Math.round((b-a)/86400000));
}
// Amber "Carried over" pill showing how many days the task has been ageing (open since its
// origin day). Shown on the task title when it rolled in from an earlier day.
function carryBadge(t){
  if(!t._carryOrigin)return '';
  const age=carryDaysOpen(t,ds(viewDate));
  const label=age>0?'↻ Carried over · '+age+'d ageing':'↻ Carried over';
  const strong=age>=3; // 3+ days open — flag more urgently
  return '&nbsp;<span style="font-size:10px;background:'+(strong?'#fee2e2':'var(--orange-light)')+';color:'+(strong?'var(--red)':'var(--orange)')+';padding:1px 6px;border-radius:20px;font-weight:700" title="Open since '+t._carryOrigin+' — '+age+' day'+(age!==1?'s':'')+' ageing">'+label+'</span>';
}
// Small note under the completion bar showing the running/cumulative progress across the days
// this task has stayed pending.
function carryProgressNote(t,viewStr){
  if(!t._carryOrigin||t._trackerCarry)return '';
  const d=carryDaysOpen(t,viewStr);
  const r=taskCompletionRateCumulative(t,t._carryOrigin,viewStr);
  return '<div style="font-size:10px;color:var(--orange);font-weight:600;margin-top:2px">Running: '+r.done+'/'+r.total+' over '+(d+1)+' day'+(d+1!==1?'s':'')+' (since '+t._carryOrigin+')</div>';
}
// The actual scheduled DATE this task instance belongs to. For a carried-over task this is its
// origin date (the day it was first due) so users can trace where it came from; otherwise it's
// the day being viewed. Rendered as a chip in the "Task Date" dashboard column.
function taskDateChip(t,viewStr){
  const originStr=t._carryOrigin||viewStr;
  const carried=!!t._carryOrigin;
  const d=new Date(originStr+'T00:00:00');
  const label=isNaN(d)?originStr:d.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'});
  if(carried){
    return '<span style="display:inline-block;font-size:11px;font-weight:700;color:var(--orange);background:var(--orange-light);border:1px solid #fed7aa;padding:2px 7px;border-radius:20px" title="Original due date — carried over since '+originStr+'">'+label+'</span>';
  }
  return '<span style="display:inline-block;font-size:11px;font-weight:600;color:var(--text3)" title="'+originStr+'">'+label+'</span>';
}

function statusBadge(ov,taskId,date){
  const task=D.tasks.find(t=>t.id==taskId)||(D.leadTasks||[]).find(t=>t.id==taskId);
  // FR-linked and AO-linked tasks are managed via their own tracker modals — the
  // generic per-member status modal doesn't apply to them.
  if(task?.frLinked||task?.aoLinked){
    return `<span class="sbadge ${sbc(ov)}" style="cursor:default"><span class="sdot ${sdc(ov)}"></span>${ov}</span>`;
  }
  const mems=getMemberStatuses(taskId,date);
  const byS={Pending:[],Ongoing:[],Done:[],'Needs Extension':[]};
  (task?.assignees||[]).forEach(u=>{const st=mems[u]||'Pending';if(!byS[st])byS[st]=[];byS[st].push(getMN(u));});
  const tip=Object.entries(byS).filter(([,v])=>v.length)
    .map(([k,v])=>`<div><b style="color:${k==='Done'?'#4ade80':k==='Ongoing'?'#fbbf24':k==='Needs Extension'?'#22d3ee':'#f87171'}">${k}:</b> ${v.join(', ')}</div>`).join('');
  return `<div class="tt-wrap"><span class="sbadge ${sbc(ov)}" onclick="openStatusModal(${taskId},'${date}')"><span class="sdot ${sdc(ov)}"></span>${ov}</span>${tip?`<div class="tt-box">${tip}</div>`:''}</div>`;
}

function metricsHTML(metrics){
  // Track history for sparklines (last 7 values in localStorage)
  function getHistory(key,newVal){
    try{
      var arr=JSON.parse(localStorage.getItem('gh_spark_'+key)||'[]');
      arr.push(newVal);
      if(arr.length>7)arr=arr.slice(-7);
      localStorage.setItem('gh_spark_'+key,JSON.stringify(arr));
      return arr;
    }catch(e){return[newVal];}
  }
  function sparkSVG(data,color){
    if(!data||data.length<2)return'';
    var mn=Math.min(...data),mx=Math.max(...data);
    var range=mx-mn||1;
    var w=80,h=24,pad=2;
    var pts=data.map((v,i)=>{
      var x=pad+(i/(data.length-1))*(w-pad*2);
      var y=h-pad-(v-mn)/range*(h-pad*2);
      return x+','+y;
    });
    var fillPts=pts.join(' ')+' '+(w-pad)+','+(h-pad)+' '+pad+','+(h-pad);
    var last=data[data.length-1],prev=data[data.length-2];
    var trend=last>prev?'up':last<prev?'down':'flat';
    var trendIcon=trend==='up'?'↑':trend==='down'?'↓':'→';
    var trendColor=color;
    var diff=last-prev;
    var diffStr=(diff>0?'+':'')+diff;
    return '<svg class="mc-sparkline" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      +'<polygon points="'+fillPts+'" fill="'+color+'" opacity=".12"/>'
      +'<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
      +'<circle cx="'+pts[pts.length-1].split(',')[0]+'" cy="'+pts[pts.length-1].split(',')[1]+'" r="2" fill="'+color+'"/>'
      +'</svg>'
      +'<div class="mc-trend '+trend+'" style="color:'+trendColor+'">'+trendIcon+' '+diffStr+' vs prev</div>';
  }
  var today=ds(now());
  var hDone=getHistory('done_'+today,metrics.taskDone);
  var hPct=getHistory('pct_'+today,metrics.pct);
  var hPend=getHistory('pend_'+today,metrics.taskPending);
  var hOng=getHistory('ong_'+today,metrics.taskOngoing);
  return `<div class="metrics-row">
    <div class="metric-card mc-blue"><div class="mc-label">Scheduled Tasks</div><div class="mc-val">${metrics.taskTotal}</div></div>
    <div class="metric-card mc-green"><div class="mc-label">Completed</div><div class="mc-val">${metrics.taskDone}</div>${sparkSVG(hDone,'#16a34a')}</div>
    <div class="metric-card mc-yellow"><div class="mc-label">Ongoing</div><div class="mc-val">${metrics.taskOngoing}</div>${sparkSVG(hOng,'#ca8a04')}</div>
    <div class="metric-card mc-red"><div class="mc-label">Pending</div><div class="mc-val">${metrics.taskPending}</div>${sparkSVG(hPend,'#dc2626')}</div>
    ${metrics.carriedCount?`<div class="metric-card mc-orange"><div class="mc-label">Carried Over</div><div class="mc-val">${metrics.carriedCount}</div><div class="mc-trend" style="color:var(--orange)" title="Oldest task has been open this many days">↻ up to ${metrics.maxAgeDays} day${metrics.maxAgeDays!==1?'s':''} ageing</div></div>`:''}
    <div class="metric-card mc-black"><div class="mc-label">Completion Rate</div><div class="mc-val">${metrics.pct}%</div>${sparkSVG(hPct,'#64748b')}</div>
  </div><div class="prog-row"><div class="prog-bar"><div class="prog-fill" style="width:${metrics.pct}%"></div></div><div class="prog-label">${metrics.pct}%</div><div style="font-size:11px;color:var(--text3)">${metrics.doneAssignments}/${metrics.totalAssignments} assignments done</div></div>`;
}

function dateSel(d,onchange="viewDate=new Date(this.value+'T00:00:00');rerender()"){
  const n=now();let opts='';
  for(let i=-30;i<=14;i++){const dd=new Date(n);dd.setDate(n.getDate()+i);const dds=ds(dd);opts+=`<option value="${dds}"${ds(d)===dds?' selected':''}>${i===0?'Today — '+fmtD(dd):fmtD(dd)}</option>`;}
  return `<select onchange="${onchange}" style="padding:6px 10px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);font-size:13px;font-weight:500;cursor:pointer;max-width:240px">${opts}</select>`;
}

// Init — show login immediately, no spinner
function initApp(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  const session=loadSession();
  if(!session)return;
  if(session.isAdmin){CU=session;startApp();return;}
  fbGet('members').then(function(mems){
    mems=mems||{};
    const match=Object.values(mems).find(function(m){return m.username===session.username&&m.approved;});
    if(match){CU=Object.assign({},session,{role:match.role,ltAccess:!!match.ltAccess});saveSession();startApp();}
  }).catch(function(e){console.warn('Session restore failed:',e.message);});
  fbGet('tasks').then(function(existing){
    if(!existing){const obj={};DEFAULT_TASKS.forEach(function(t){obj[t.id]=t;});fbSet('tasks',obj);fbSet('taskNextId',10);}
  }).catch(function(){});
}
initApp();

async function doLogin(){
  hideMsg('login-err');
  const u=document.getElementById('login-user').value.trim().toLowerCase();
  const p=document.getElementById('login-pass').value;
  if(u===ADMIN_UN&&p===ADMIN_PW){CU={username:'admin',name:ADMIN_NAME,isAdmin:true};saveSession();startApp();return;}
  const mems=await fbGet('members')||{};
  const match=Object.values(mems).find(m=>m.username===u&&m.password===p&&m.approved);
  if(match){CU={username:match.username,name:match.name,isAdmin:false,role:match.role,ltAccess:!!match.ltAccess};saveSession();startApp();return;}
  showMsg('login-err','Incorrect username or password.');
}
function doLogout(){stopListeners();clearSession();CU=null;document.getElementById('app').style.display='none';document.getElementById('auth-screen').style.display='flex';['login-user','login-pass'].forEach(id=>document.getElementById(id).value='');viewDate=new Date();}

function startApp(){
  document.getElementById('loading-screen').style.display='none';
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  buildNav();
  if(window.lucide)lucide.createIcons();
  document.getElementById('user-chip').innerHTML=`<span class="av${CU.isAdmin?' g':''}">${ini(CU.name)}</span>${CU.name}${CU.isAdmin?'&nbsp;<span class="admin-badge">Admin</span>':isTOD()?'&nbsp;<span class="tod-badge">TOD</span>':'&nbsp;<span class="role-badge">'+(CU.role||'Member')+'</span>'}`;
  // Sidebar user info
  const sav=document.getElementById('sidebar-av');if(sav){sav.textContent=ini(CU.name);if(CU.isAdmin)sav.classList.add('g');}
  const sn=document.getElementById('sidebar-name');if(sn)sn.textContent=CU.name;
  const sr=document.getElementById('sidebar-role');if(sr)sr.textContent=CU.isAdmin?'Admin':(CU.role||'Member');
  // Restore sidebar collapse state
  if(localStorage.getItem('gh_sb_collapsed')==='1'){const sb=document.getElementById('sidebar');if(sb)sb.classList.add('collapsed');}
  fbListen('tasks',v=>{D.tasks=v?Object.values(v).filter(Boolean):[];D._tLoaded=true;frRecordCompletions();buildNav();rerender();});
  fbListen('members',v=>{
    D.members=v?Object.values(v).filter(Boolean):[];D._mLoaded=true;
    if(CU&&!CU.isAdmin){
      const me=D.members.find(m=>m.username===CU.username);
      if(me){CU.ltAccess=!!me.ltAccess;CU.role=me.role;}
    }
    buildNav();rerender();
  });
  fbListen('statuses',v=>{D.statuses=v||{};rerender();});
  fbListen('actLog',v=>{D.actLog=v?Object.values(v).sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,500):[];if(_curPage==='dashboard')renderDashboard();});
  fbListen('extRequests',v=>{
    const prev=D.extRequests||{};const nv=v||{};
    if(_extListenerInit&&CU&&CU.isAdmin){
      Object.keys(nv).forEach(function(k){
        if(!prev[k]&&nv[k].status==='Pending'){
          const r=nv[k];
          const nbT=document.getElementById('nb-title'),nbB=document.getElementById('nb-body'),nb=document.getElementById('notif-banner');
          if(nbT&&nbB&&nb){nbT.textContent='New Extension Request';nbB.textContent=r.memberName+' requested an extension for "'+r.taskTitle+'"';nb.classList.add('show');setTimeout(()=>nb.classList.remove('show'),8000);}
          toast('📩 New extension request from '+r.memberName);
        }
      });
    }
    _extListenerInit=true;
    D.extRequests=nv;if(_curPage==='dashboard')renderDashboard();
  });
  fbListen('incidents',v=>{D.incidents=v?Object.entries(v).map(([k,i])=>({...i,_key:k})).sort((a,b)=>(b.ts||0)-(a.ts||0)):[];if(_curPage==='incidents')renderIncidents();const open=D.incidents.filter(i=>i.status==='Open').length;const btn=document.getElementById('ntab-incidents');if(btn)btn.style.setProperty('--dot','block');});
  // Non-compliance registry: overdue/failed tasks land here for admin review instead of being
  // auto-pushed straight into the incident log. Admin decides per-entry whether to send to Incidents.
  fbListen('nonCompliance',v=>{
    const prev=D.nonCompliance||{};const nv=v||{};
    if(_ncListenerInit&&CU&&CU.isAdmin){
      Object.keys(nv).forEach(function(k){
        if(!prev[k]&&nv[k].status==='Open'){
          const r=nv[k];
          toast('⚠️ New non-compliance flagged: '+(r.taskTitle||'task'));
        }
      });
    }
    _ncListenerInit=true;
    D.nonCompliance=nv;if(_curPage==='dashboard')renderDashboard();
  });
  fbListen('broadcast',v=>{D.broadcast=v;if(v?.msg){const dis=localStorage.getItem('gh_bc_dis');if(dis!==String(v.ts))showBC(v);}else hideBC();});
  fbListen('calEntries',v=>{D.calEntries={};if(v)for(const[k,en]of Object.entries(v))if(en&&typeof en==='object'){D.calEntries[k]={};for(const[ek,e]of Object.entries(en))D.calEntries[k][ek]={...e,_key:ek};}if(selCalDate)renderCalDay(selCalDate);});
  fbListen('campaigns',v=>{D.campaigns=v||{};if(_curPage==='campaigns'&&typeof renderCampaigns==='function')renderCampaigns();});
  fbListen('groups',v=>{D.groups=v?Object.entries(v).map(([k,g])=>({...g,_key:k})):[];});
  // Lead-owned tasks — listen to the whole leadTasks tree so members can see tasks assigned to them
  fbListen('leadTasks',v=>{
    D.leadTasks=[];
    if(v){
      Object.entries(v).forEach(function([ownerUN,taskMap]){
        if(!taskMap)return;
        Object.values(taskMap).filter(Boolean).forEach(function(t){
          D.leadTasks.push(Object.assign({},t,{_leadOwner:ownerUN,_isLeadTask:true}));
        });
      });
    }
    buildNav();rerender();
  });
  // Lead-private groups — stored per user
  if(!CU.isAdmin){
    fbListen('leadGroups/'+CU.username,v=>{D.leadGroups=v?Object.entries(v).map(([k,g])=>({...g,_key:k})):[];if(_curPage==='members')renderMembers();});
  } else {
    // Admin: load all leadGroups from all leads so they can assign group members in tasks
    fbListen('leadGroups',v=>{
      if(!v){D.leadGroups=[];return;}
      var all=[];
      Object.entries(v).forEach(function([ownerUN,groupMap]){
        if(!groupMap)return;
        Object.entries(groupMap).forEach(function([k,g]){
          if(g)all.push(Object.assign({},g,{_key:k,_leadOwner:ownerUN}));
        });
      });
      D.leadGroups=all;
      if(_curPage==='tasks')renderTasks();
    });
  }
  // Per-cycle completion dates for tracker-linked (FR/AO) tasks. Stamped the first day a task's
  // reporting cycle reads 100%, so a completed report keeps showing through THAT day and drops off
  // the next — instead of vanishing the instant the last cell is filled. See frRecordCompletions().
  fbListen('frCompletions',v=>{D.frCompletions=v||{};if(_curPage==='dashboard')renderDashboard();if(_curPage==='my-tasks')renderMyTasks();});
  fbListen('trackers',v=>{D.trackers=v||{};
    // A tracker edit may have just pushed a cycle to 100% — stamp its completion date now.
    frRecordCompletions();
    // Only re-render live trackers if user is not currently editing an AO cell
    if(_curPage==='live-trackers'){
      const active=document.activeElement;
      const isEditingCell=active&&active.tagName==='INPUT'&&active.closest('#ao-table-scroll');
      if(!isEditingCell)renderLiveTrackers();
    }
    if(_curPage==='dashboard')renderDashboard();if(_curPage==='my-tasks')renderMyTasks();});
  fbListen('todAttendance',v=>{D.todAttendance=v||{};if(_curPage==='tod')renderTOD();});
  fbListen('todOvertime',v=>{D.todOvertime=v||{};if(_curPage==='tod')renderTOD();});
  fbListen('auditLog',v=>{D.auditLog=v?Object.entries(v).map(([k,e])=>({...e,_key:k})).sort((a,b)=>(b.ts||0)-(a.ts||0)):[];if(_curPage==='audit')renderAudit();if(_curPage==='my-tasks')renderMyTasks();if(_curPage==='incidents')renderIncidents();});
  fbListen('leaves',v=>{D.leaves=v?Object.entries(v).map(([k,e])=>({...e,_key:k})).sort((a,b)=>(b.ts||0)-(a.ts||0)):[];if(_curPage==='leaves')renderLeaves();});
  fbListen('weeklyReports',v=>{D.weeklyReports=v?Object.entries(v).map(([k,r])=>({...r,_key:k})).sort((a,b)=>(b.ts||0)-(a.ts||0)):[];if(_curPage==='incidents')renderIncidents();if(_curPage==='reports')renderReports();if(_curPage==='my-tasks')renderMyTasks();});
  // Personal tasks — scoped to current user; admin sees all users' personal tasks
  if(!CU.isAdmin){
    fbListen('personalTasks/'+CU.username,v=>{
      D.personalTasks=v?Object.entries(v).map(([k,t])=>({...t,_key:k,_owner:CU.username})):[];
      if(_curPage==='tasks')renderTasks();
      if(_curPage==='my-tasks')renderMyTasks();
    });
  } else {
    // Admin: listen to entire personalTasks tree so all user-created tasks appear
    fbListen('personalTasks',v=>{
      D.personalTasks=[];
      if(v){
        Object.entries(v).forEach(function([ownerUN,taskMap]){
          if(!taskMap)return;
          Object.entries(taskMap).forEach(function([k,t]){
            if(t)D.personalTasks.push(Object.assign({},t,{_key:k,_owner:ownerUN}));
          });
        });
      }
      if(_curPage==='dashboard')renderDashboard();
      if(_curPage==='tasks')renderTasks();
    });
  }
  // WorkSpace: personal notes (per user) + shared bulletins
  fbListen('wsNotes/'+CU.username,v=>{
    D.wsNotes=v?Object.entries(v).map(([k,n])=>({...n,_key:k})).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)):[];
    if(_curPage==='workspace')renderWorkSpace();
    if(_curPage==='notes')renderNotes();
  });
  fbListen('wsBulletins',v=>{
    D.wsBulletins=v?Object.entries(v).map(([k,b])=>({...b,_key:k})).sort((a,b)=>(b.postedAt||0)-(a.postedAt||0)):[];
    if(_curPage==='workspace')renderWorkSpace();
    if(_curPage==='bulletin')renderBulletin();
    // Update nav badge
    const unacked=(D.wsBulletins||[]).filter(b=>!(b.acks||{})[CU.username]).length;
    buildNav();
  });
  scheduleReminders();
  loadFRConfig(); // Load finance report week offsets from Firebase
  // Init TOD week start (Sunday of current week)
  const _td=now();_todWeekStart=new Date(_td);_todWeekStart.setDate(_td.getDate()-_td.getDay());_todWeekStart.setHours(0,0,0,0);
  showPage('dashboard');
}

// ── WORKSPACE ──
D.wsNotes=[];D.wsBulletins=[];

function canPostBulletin(){
  if(CU.isAdmin)return true;
  return LEAD_ROLES.includes(CU.role);
}

function renderWorkSpace(){
  const el=document.getElementById('pg-workspace');if(!el)return;
  const notes=D.wsNotes||[];
  const bulletins=D.wsBulletins||[];
  const pinned=notes.filter(n=>n.pinned);
  const unpinned=notes.filter(n=>!n.pinned);
  const allNotesSorted=[...pinned,...unpinned];
  const canPost=canPostBulletin();
  const totalMembers=(D.members||[]).filter(m=>m.approved).length+1;

  function noteLines(n){
    const lines=(n.body||'').split('\n').filter(l=>l.trim());
    if(!lines.length)return `<div class="ws-note-add-line"><div style="width:5px;min-width:5px"></div><div class="ws-note-line-gutter"></div><span class="ws-note-add-hint" onclick="wsOpenNote('${n._key}')">Add items...</span></div>`;
    return lines.map((line,idx)=>{
      const isDone=(n.checkedLines||{})[idx];
      return `<div class="ws-note-line">
        ${n.pinned?`<div class="ws-note-pin-flag"></div>`:'<div style="width:5px;min-width:5px"></div>'}
        <div class="ws-note-line-gutter">
          <input type="checkbox" class="ws-note-check" ${isDone?'checked':''} onclick="wsToggleLine('${n._key}',${idx},this.checked)" title="Mark done"/>
        </div>
        <div class="ws-note-text${isDone?' done-task':''}" onclick="wsOpenNote('${n._key}')">${escHtml(line)}</div>
        <span class="ws-note-date-tag">${idx===0&&n.updatedAt?new Date(n.updatedAt).toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''}</span>
      </div>`;
    }).join('');
  }

  function noteSection(n){
    return `<div style="border-bottom:2px solid rgba(100,140,220,.12)">
      <div class="ws-note-line" style="background:rgba(37,99,235,.03)">
        ${n.pinned?`<div class="ws-note-pin-flag"></div>`:'<div style="width:5px;min-width:5px"></div>'}
        <div class="ws-note-line-gutter"><span style="font-size:10px;color:var(--blue);opacity:.6">📝</span></div>
        <div style="flex:1;padding:7px 10px;font-size:12px;font-weight:700;color:var(--text2);cursor:pointer" onclick="wsOpenNote('${n._key}')">${escHtml(n.title||'Untitled')}${n.pinned?' <span style="font-size:9px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.05em;margin-left:4px">Pinned</span>':''}</div>
        <button class="btn sm edit" style="margin:4px 10px 4px 0;padding:2px 8px;font-size:11px" onclick="wsOpenNote('${n._key}')">Edit</button>
      </div>
      ${noteLines(n)}
    </div>`;
  }

  function bcCard(b){
    const type=b.type||'general';
    const acks=b.acks||{};
    const ackCount=Object.keys(acks).length;
    const userAcked=!!acks[CU.username];
    const pct=totalMembers>0?Math.round(ackCount/totalMembers*100):0;
    const typeLabel=type.charAt(0).toUpperCase()+type.slice(1);
    const typeColors={urgent:'var(--red)',policy:'var(--blue)',announcement:'var(--purple)',general:'#64748b'};
    const typeLight={urgent:'var(--red-light)',policy:'var(--blue-light)',announcement:'var(--purple-light)',general:'#f1f5f9'};
    return `<div class="ws-bc ${type}">
      <div class="ws-bc-top">
        <div class="ws-bc-meta">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span class="ws-bc-title">${escHtml(b.title||'')}</span>
            <span style="font-size:9px;padding:2px 7px;border-radius:20px;font-weight:700;background:${typeLight[type]};color:${typeColors[type]}">${typeLabel}</span>
          </div>
          <div class="ws-bc-from">Posted by ${escHtml(b.postedByName||'—')} · ${b.postedAt?new Date(b.postedAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):''} · Dept-wide</div>
        </div>
      </div>
      <div class="ws-bc-body">${escHtml(b.body||'')}</div>
      <div class="ws-bc-footer">
        <div class="ws-ack-info" style="display:flex;align-items:center;gap:6px;">
          <button class="ws-ack-btn${userAcked?' done':''}" ${userAcked?'disabled':''} onclick="wsAck('${b._key}',this)">${userAcked?'✓ Acknowledged':'✓ Acknowledge'}</button>
          <div class="ws-ack-bar-wrap"><div class="ws-ack-bar" style="width:${pct}%"></div></div>
          <span style="font-size:10px;color:var(--text4)">${ackCount}/${totalMembers}</span>
        </div>
        <span style="font-size:10px;color:var(--text4)">${b.postedAt?new Date(b.postedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):''}</span>
      </div>
    </div>`;
  }

  el.innerHTML=`
  <div class="page-header">
    <div>
      <div class="page-title">WorkSpace</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">Your personal notes &amp; department bulletin board</div>
    </div>
  </div>
  <div class="ws-layout">
    <div class="ws-col-notes">
      <div class="ws-col-header">
        <div class="ws-col-title">
          <i data-lucide="notebook-text" style="width:14px;height:14px;opacity:.6"></i>
          Notes
          <span class="ws-scope-tag ws-scope-personal">Personal</span>
        </div>
        <button class="btn sm primary" onclick="wsNewNote()">+ New note</button>
      </div>
      <div class="ws-notebook">
        <div class="ws-notebook-header">
          <span class="ws-notebook-label">My Notes &amp; Tasks</span>
          <span style="font-size:10px;color:#c8b87a">${allNotesSorted.length} note${allNotesSorted.length!==1?'s':''}</span>
        </div>
        <div class="ws-note-entries">
          ${allNotesSorted.length?allNotesSorted.map(noteSection).join(''):`<div class="ws-note-add-line"><div style="width:5px;min-width:5px"></div><div class="ws-note-line-gutter"></div><span class="ws-note-add-hint" onclick="wsNewNote()">Click \"+ New note\" to get started...</span></div>`}
          <div class="ws-note-add-line">
            <div style="width:5px;min-width:5px"></div>
            <div class="ws-note-line-gutter"><span style="font-size:14px;color:var(--text4)">+</span></div>
            <span class="ws-note-add-hint" onclick="wsNewNote()">Add a new note or task list...</span>
          </div>
        </div>
      </div>
    </div>
    <div class="ws-col-bulletin">
      <div class="ws-col-header">
        <div class="ws-col-title">
          <i data-lucide="megaphone" style="width:14px;height:14px;opacity:.6"></i>
          Bulletin
          <span class="ws-scope-tag ws-scope-dept">Department-wide</span>
        </div>
        ${canPost?`<button class="btn sm primary" onclick="wsTogglePostBar()">+ Post bulletin</button>`:''}
      </div>
      <div class="ws-post-bar" id="ws-post-bar">
        <div class="ws-post-label">New bulletin · visible to all department members</div>
        <div class="fg" style="gap:8px">
          <input class="finput nb" id="ws-b-title" placeholder="Title" />
          <textarea class="finput nb" id="ws-b-body" rows="3" placeholder="Message to the team..."></textarea>
        </div>
        <div class="ws-post-row" style="margin-top:10px">
          <span style="font-size:11px;color:var(--text3);margin-right:4px">Priority:</span>
          <button class="ws-priority-pill sel" onclick="wsSelPriority(this,'general')">General</button>
          <button class="ws-priority-pill" onclick="wsSelPriority(this,'policy')">Policy</button>
          <button class="ws-priority-pill" onclick="wsSelPriority(this,'urgent')">Urgent</button>
          <button class="ws-priority-pill" onclick="wsSelPriority(this,'announcement')">Announcement</button>
          <div style="flex:1"></div>
          <button class="btn sm" onclick="wsTogglePostBar()">Cancel</button>
          <button class="btn sm primary" onclick="wsPostBulletin()">Send to all</button>
        </div>
      </div>
      <div class="ws-bulletin-notebook">
        <div class="ws-bulletin-nb-header">
          <span class="ws-bulletin-nb-label">📋 Department Bulletins</span>
          <span style="font-size:10px;color:#8b9de8">${bulletins.length} post${bulletins.length!==1?'s':''}</span>
        </div>
        <div class="ws-bulletin-list">
          ${bulletins.length?bulletins.map(bcCard).join(''):'<div style="padding:32px 52px;color:var(--text4);font-size:13px;font-style:italic">No bulletins posted yet.</div>'}
        </div>
      </div>
    </div>
  </div>

  <!-- Note modal -->
  <div class="ws-note-modal-bg" id="ws-note-modal-bg" onclick="if(event.target===this)wsCloseNote()">
    <div class="ws-note-modal">
      <button class="modal-close" onclick="wsCloseNote()">&#x2715;</button>
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <input id="ws-modal-title" class="finput nb" placeholder="Note / task list title" style="flex:1;font-weight:700;font-size:15px"/>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--text3)">
          <input type="checkbox" id="ws-modal-pin" style="accent-color:var(--blue)"/> Pin
        </label>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Enter each item on its own line — each line becomes a checkable task</div>
      <textarea id="ws-modal-body" class="finput nb" rows="8" placeholder="Write one item per line..." style="resize:vertical;font-family:monospace;font-size:13px;line-height:1.8"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:space-between">
        <button class="btn sm del" id="ws-modal-del" onclick="wsDeleteNote()" style="display:none">Delete</button>
        <div style="display:flex;gap:8px;margin-left:auto">
          <button class="btn sm" onclick="wsCloseNote()">Cancel</button>
          <button class="btn sm primary" onclick="wsSaveNote()">Save note</button>
        </div>
      </div>
    </div>
  </div>`;
  if(window.lucide)lucide.createIcons();
}

let _wsEditKey=null,_wsPriority='general';

// ── NOTES PAGE ──
let _niOpenKey=null; // currently open page key

function renderNotes(){
  const el=document.getElementById('pg-notes');if(!el)return;
  const notes=D.wsNotes||[];
  // If a page is open, render it; otherwise render the list
  if(_niOpenKey){
    const n=notes.find(x=>x._key===_niOpenKey);
    if(n){niRenderPage(el,n);return;}
    _niOpenKey=null; // note was deleted, fall through to list
  }
  niRenderList(el,notes);
}

function niRenderList(el,notes){
  const pinned=notes.filter(n=>n.pinned);
  const unpinned=notes.filter(n=>!n.pinned);
  const allNotesSorted=[...pinned,...unpinned];

  const rows=allNotesSorted.length?allNotesSorted.map(n=>{
    const preview=(n.body||'').split('\n').filter(l=>l.trim()).slice(0,1)[0]||'';
    const imgCount=(n.images||[]).length;
    const date=n.updatedAt?new Date(n.updatedAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
    return `<div class="ni-list-row" onclick="niOpenPage('${n._key}')">
      <div class="ni-list-icon">${n.pinned?'📌':'📄'}</div>
      <div class="ni-list-body">
        <div class="ni-list-title">${escHtml(n.title||'Untitled')}${n.pinned?'<span class="ni-pin-badge">Pinned</span>':''}</div>
        <div class="ni-list-preview">${escHtml(preview)||'<em style="color:var(--text4)">Empty page</em>'}${imgCount?` · <span style="color:var(--text3)">${imgCount} image${imgCount>1?'s':''}</span>`:''}</div>
      </div>
      <div class="ni-list-date">${date}</div>
      <button class="ni-list-del" title="Delete" onclick="event.stopPropagation();niConfirmDelete('${n._key}')">✕</button>
    </div>`;
  }).join(''):`<div class="ni-empty-state">No pages yet. Click <strong>+ New page</strong> to get started.</div>`;

  el.innerHTML=`
  <style>
    .ni-list-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-card)}
    .ni-list-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f3f5;cursor:pointer;transition:background .12s}
    .ni-list-row:last-child{border-bottom:none}
    .ni-list-row:hover{background:#f7f9ff}
    .ni-list-icon{font-size:18px;flex-shrink:0;width:28px;text-align:center}
    .ni-list-body{flex:1;min-width:0}
    .ni-list-title{font-size:14px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ni-pin-badge{display:inline-block;margin-left:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;background:var(--blue-light);color:var(--blue);padding:1px 6px;border-radius:20px;vertical-align:middle}
    .ni-list-preview{font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
    .ni-list-date{font-size:11px;color:var(--text4);flex-shrink:0;white-space:nowrap}
    .ni-list-del{padding:3px 7px;border:none;background:transparent;color:var(--text4);font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;flex-shrink:0}
    .ni-list-row:hover .ni-list-del{opacity:1}
    .ni-list-del:hover{color:var(--red)}
    .ni-empty-state{padding:48px;text-align:center;color:var(--text3);font-size:14px}
  </style>
  <div class="page-header">
    <div><div class="page-title">Notes</div><div style="font-size:12px;color:var(--text3);margin-top:2px">Your private notebook — free-form pages with text &amp; images</div></div>
    <button class="btn primary" onclick="niNewPage()">+ New page</button>
  </div>
  <div class="ni-list-wrap">${rows}</div>`;
}

function niRenderPage(el,n){
  const imgItems=(n.images||[]).map((img,i)=>`
    <div class="nip-img-wrap">
      <img src="${escHtml(img.url)}" alt="${escHtml(img.alt||'')}" class="nip-img"/>
      <button class="nip-img-del" onclick="niRemoveImg('${n._key}',${i})" title="Remove">✕</button>
    </div>`).join('');

  el.innerHTML=`
  <style>
    .nip-header{display:flex;align-items:center;gap:10px;margin-bottom:18px}
    .nip-back{padding:5px 12px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--text2);transition:all .15s}
    .nip-back:hover{background:var(--bg)}
    .nip-title-input{flex:1;border:none;background:transparent;font-size:22px;font-weight:800;font-family:'Playfair Display',serif;color:var(--text);outline:none;padding:2px 0}
    .nip-title-input::placeholder{color:var(--text4)}
    .nip-actions{display:flex;gap:8px;flex-shrink:0}
    /* Notebook page */
    .nip-page{background:#e8f4fd;border-radius:var(--radius-lg);border:1px solid #b8d9f0;box-shadow:0 2px 12px rgba(37,99,235,.08);min-height:500px;position:relative;overflow:hidden}
    .nip-page::before{content:'';position:absolute;inset:0;background-image:repeating-linear-gradient(transparent,transparent 27px,#b8cfe8 27px,#b8cfe8 28px);background-position:0 36px;pointer-events:none;z-index:0}
    .nip-page::after{content:'';position:absolute;left:48px;top:0;bottom:0;width:1px;background:#f8a5a5;opacity:.5;pointer-events:none;z-index:0}
    .nip-editor{position:relative;z-index:1;min-height:460px;padding:12px 20px 20px 60px;font-size:14px;line-height:28px;color:var(--text);outline:none;white-space:pre-wrap;word-break:break-word}
    .nip-editor:empty::before{content:attr(data-placeholder);color:var(--text4);pointer-events:none}
    .nip-images{padding:12px 20px 16px 60px;position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:10px}
    .nip-img-wrap{position:relative;display:inline-block}
    .nip-img{max-height:160px;max-width:240px;border-radius:var(--radius);border:1px solid #b8d9f0;box-shadow:0 1px 4px rgba(0,0,0,.1);object-fit:cover}
    .nip-img-del{position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;border:none;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .nip-toolbar{display:flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(255,255,255,.7);border-top:1px solid #b8d9f0;border-radius:0 0 var(--radius-lg) var(--radius-lg)}
    .nip-tb-btn{padding:4px 10px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);font-size:12px;font-weight:600;cursor:pointer;color:var(--text2);transition:all .15s}
    .nip-tb-btn:hover{background:var(--blue-light);border-color:var(--blue);color:var(--blue)}
    .nip-save-status{font-size:11px;color:var(--text4);margin-left:auto}
  </style>
  <div class="nip-header">
    <button class="nip-back" onclick="niClosePage()">← Back</button>
    <input class="nip-title-input" id="nip-title" value="${escHtml(n.title||'')}" placeholder="Page title..." 
      onblur="niSaveTitle('${n._key}',this.value)"/>
    <div class="nip-actions">
      <button class="btn sm ${n.pinned?'primary':''}" onclick="niTogglePin('${n._key}',${!n.pinned})" title="${n.pinned?'Unpin':'Pin'}">📌 ${n.pinned?'Pinned':'Pin'}</button>
      <button class="btn sm del" onclick="niConfirmDelete('${n._key}')">Delete page</button>
    </div>
  </div>
  <div class="nip-page">
    ${imgItems?`<div class="nip-images" id="nip-images">${imgItems}</div>`:'<div class="nip-images" id="nip-images"></div>'}
    <div class="nip-editor" id="nip-editor" contenteditable="true" data-placeholder="Start writing..."
      onpaste="niHandlePaste(event,'${n._key}')"
      oninput="niDebounceSave('${n._key}',this.innerText)"
      >${escHtml(n.body||'')}</div>
    <div class="nip-toolbar">
      <label class="nip-tb-btn" title="Add image">
        🖼 Image
        <input type="file" accept="image/*" style="display:none" onchange="niAddImagePage('${n._key}',this)"/>
      </label>
      <button class="nip-tb-btn" onclick="niInsertBullet('${n._key}')">• Bullet</button>
      <button class="nip-tb-btn" onclick="niInsertDivider('${n._key}')">— Divider</button>
      <span class="nip-save-status" id="nip-save-status">All changes saved</span>
    </div>
  </div>`;

  // Focus editor at end
  setTimeout(()=>{
    const ed=document.getElementById('nip-editor');
    if(ed){ed.focus();const r=document.createRange();const s=window.getSelection();r.selectNodeContents(ed);r.collapse(false);s.removeAllRanges();s.addRange(r);}
  },50);
}

function niOpenPage(key){_niOpenKey=key;renderNotes();}
function niClosePage(){_niOpenKey=null;renderNotes();}

async function niNewPage(){
  const key=await fbPush('wsNotes/'+CU.username,{title:'',body:'',pinned:false,images:[],createdAt:Date.now(),updatedAt:Date.now()});
  _niOpenKey=key;
  renderNotes();
  setTimeout(()=>{const t=document.getElementById('nip-title');if(t){t.focus();t.select();}},80);
}

let _niSaveTimer=null;
function niDebounceSave(key,text){
  clearTimeout(_niSaveTimer);
  const st=document.getElementById('nip-save-status');if(st)st.textContent='Saving...';
  _niSaveTimer=setTimeout(async()=>{
    await fbUpd('wsNotes/'+CU.username+'/'+key,{body:text,updatedAt:Date.now()});
    const st2=document.getElementById('nip-save-status');if(st2)st2.textContent='All changes saved';
  },800);
}

async function niHandlePaste(e,key){
  const items=(e.clipboardData||e.originalEvent?.clipboardData)?.items||[];
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();
      const file=item.getAsFile();if(!file)continue;
      if(file.size>3*1024*1024){toast('Image too large (max 3 MB)');continue;}
      const reader=new FileReader();
      reader.onload=async function(ev){
        const n=(D.wsNotes||[]).find(x=>x._key===key);if(!n)return;
        const images=[...(n.images||[]),{url:ev.target.result,alt:'pasted image',addedAt:Date.now()}];
        await fbUpd('wsNotes/'+CU.username+'/'+key,{images,updatedAt:Date.now()});
        toast('Image pasted!');
      };
      reader.readAsDataURL(file);
    }
  }
}

async function niAddImagePage(key,input){
  const file=input.files[0];if(!file)return;
  if(!file.type.startsWith('image/')){toast('Please select an image.');return;}
  if(file.size>3*1024*1024){toast('Image must be under 3 MB.');return;}
  const reader=new FileReader();
  reader.onload=async function(e){
    const n=(D.wsNotes||[]).find(x=>x._key===key);if(!n)return;
    const images=[...(n.images||[]),{url:e.target.result,alt:file.name,addedAt:Date.now()}];
    await fbUpd('wsNotes/'+CU.username+'/'+key,{images,updatedAt:Date.now()});
    toast('Image added!');
  };
  reader.readAsDataURL(file);
  input.value='';
}

async function niRemoveImg(key,idx){
  const n=(D.wsNotes||[]).find(x=>x._key===key);if(!n)return;
  const images=[...(n.images||[])];images.splice(idx,1);
  await fbUpd('wsNotes/'+CU.username+'/'+key,{images,updatedAt:Date.now()});
}

function niInsertBullet(key){
  const ed=document.getElementById('nip-editor');if(!ed)return;
  const sel=window.getSelection();
  const r=sel.getRangeAt(0);
  const txt=document.createTextNode('• ');
  r.insertNode(txt);r.collapse(false);sel.removeAllRanges();sel.addRange(r);
  ed.dispatchEvent(new Event('input'));
}

function niInsertDivider(key){
  const ed=document.getElementById('nip-editor');if(!ed)return;
  const sel=window.getSelection();
  const r=sel.getRangeAt(0);
  const div=document.createElement('div');div.textContent='────────────────────────';
  div.style.cssText='color:#b8cfe8;user-select:none;line-height:28px';
  r.insertNode(div);r.collapse(false);sel.removeAllRanges();sel.addRange(r);
  ed.dispatchEvent(new Event('input'));
}

// keep old helpers for backward-compat (Workspace still uses wsNewNote/wsOpenNote)
function niImgPreview(url){}

async function niNewNote(){await niNewPage();}

async function niSaveTitle(key,val){
  await fbUpd('wsNotes/'+CU.username+'/'+key,{title:val.trim()||'Untitled',updatedAt:Date.now()});
}

async function niTogglePin(key,pin){
  await fbUpd('wsNotes/'+CU.username+'/'+key,{pinned:pin,updatedAt:Date.now()});
  toast(pin?'Page pinned':'Page unpinned');
  renderNotes();
}

async function niConfirmDelete(key){
  if(!confirm('Delete this page?'))return;
  await fbDel('wsNotes/'+CU.username+'/'+key);
  if(_niOpenKey===key)_niOpenKey=null;
  toast('Page deleted.');
}

// stubs no longer needed but kept to avoid reference errors
function niSaveLine(){}
function niLineKey(){}
function niAddLine(){}
function niDeleteLine(){}
function niAddImage(){}
function niDeleteImg(){}
function wsNewNote(){niNewPage();}
function wsOpenNote(key){niOpenPage(key);}
function wsCloseNote(){niClosePage();}
function wsSaveNote(){niClosePage();}
async function wsDeleteNote(){}


// ── BULLETIN PAGE ──
function renderBulletin(){
  const el=document.getElementById('pg-bulletin');if(!el)return;
  const bulletins=D.wsBulletins||[];
  const canPost=canPostBulletin();
  const totalMembers=(D.members||[]).filter(m=>m.approved).length+1;

  function bcCard(b){
    const type=b.type||'general';
    const acks=b.acks||{};
    const ackCount=Object.keys(acks).length;
    const userAcked=!!acks[CU.username];
    const pct=totalMembers>0?Math.round(ackCount/totalMembers*100):0;
    const typeLabel=type.charAt(0).toUpperCase()+type.slice(1);
    const typeColors={urgent:'var(--red)',policy:'var(--blue)',announcement:'var(--purple)',general:'#64748b'};
    const typeLight={urgent:'var(--red-light)',policy:'var(--blue-light)',announcement:'var(--purple-light)',general:'#f1f5f9'};
    const imgHtml=b.image?`<div style="margin:10px 0"><img src="${escHtml(b.image)}" alt="${escHtml(b.imageAlt||'')}" style="max-width:100%;max-height:300px;border-radius:var(--radius);border:1px solid var(--border);object-fit:cover"/>${b.imageAlt?`<div style="font-size:11px;color:var(--text3);margin-top:4px;font-style:italic">${escHtml(b.imageAlt)}</div>`:''}</div>`:'';
    const linkHtml=b.linkUrl?`<div style="margin-top:8px"><a href="${escHtml(b.linkUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:var(--radius);background:var(--blue-light);color:var(--blue);font-size:12px;font-weight:600;text-decoration:none;border:1px solid var(--blue-mid)">🔗 ${escHtml(b.linkLabel||b.linkUrl)}</a></div>`:'';
    const deleteBtn=CU.isAdmin?`<button class="btn sm del" style="margin-left:8px;font-size:11px" onclick="bltDelete('${b._key}')">Delete</button>`:'';
    return `<div class="ws-bc ${type}">
      <div class="ws-bc-top">
        <div class="ws-bc-meta">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span class="ws-bc-title">${escHtml(b.title||'')}</span>
            <span style="font-size:9px;padding:2px 7px;border-radius:20px;font-weight:700;background:${typeLight[type]};color:${typeColors[type]}">${typeLabel}</span>
          </div>
          <div class="ws-bc-from">Posted by ${escHtml(b.postedByName||'—')} · ${b.postedAt?new Date(b.postedAt).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):''} · Dept-wide${deleteBtn}</div>
        </div>
      </div>
      ${imgHtml}
      <div class="ws-bc-body">${escHtml(b.body||'')}</div>
      ${linkHtml}
      <div class="ws-bc-footer">
        <div class="ws-ack-info" style="display:flex;align-items:center;gap:6px;">
          <button class="ws-ack-btn${userAcked?' done':''}" ${userAcked?'disabled':''} onclick="wsAck('${b._key}',this)">${userAcked?'✓ Acknowledged':'✓ Acknowledge'}</button>
          <div class="ws-ack-bar-wrap"><div class="ws-ack-bar" style="width:${pct}%"></div></div>
          <span style="font-size:10px;color:var(--text4)">${ackCount}/${totalMembers}</span>
        </div>
        <span style="font-size:10px;color:var(--text4)">${b.postedAt?new Date(b.postedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):''}</span>
      </div>
    </div>`;
  }

  el.innerHTML=`
  <div class="page-header">
    <div>
      <div class="page-title">Announcements</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">Department notice board — posts, announcements &amp; acknowledgment tracking</div>
    </div>
    ${canPost?`<button class="btn primary" onclick="bltTogglePostBar()">+ Post Announcement</button>`:''}
  </div>
  <div style="width:100%">
    <div class="ws-post-bar" id="ws-post-bar">
      <div class="ws-post-label">New announcement · visible to all department members</div>
      <div class="fg" style="gap:8px">
        <input class="finput nb" id="ws-b-title" placeholder="Title (required)" />
        <textarea class="finput nb" id="ws-b-body" rows="3" placeholder="Message to the team..."></textarea>
      </div>
      <div style="margin-top:8px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Attach image (optional)</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;padding:5px 12px;border:1px dashed var(--border);border-radius:var(--radius);cursor:pointer;font-size:12px;color:var(--text2);background:var(--bg);transition:all .15s">
            🖼 Upload image
            <input type="file" accept="image/*" id="ws-b-img-file" style="display:none" onchange="bltPreviewImage(this)"/>
          </label>
          <input class="finput nb" id="ws-b-img-url" placeholder="Or paste image URL..." style="flex:1;min-width:200px" oninput="bltPreviewImageUrl(this.value)"/>
        </div>
        <div id="ws-b-img-preview" style="margin-top:8px;display:none">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <img id="ws-b-img-preview-el" src="" alt="preview" style="height:80px;width:auto;border-radius:var(--radius);border:1px solid var(--border);object-fit:cover"/>
            <div>
              <input class="finput nb" id="ws-b-img-alt" placeholder="Image caption (optional)" style="font-size:12px;margin-bottom:4px"/>
              <button class="btn sm del" onclick="bltClearImage()">Remove</button>
            </div>
          </div>
        </div>
      </div>
      <div style="margin-top:8px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Attach link (optional)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="finput nb" id="ws-b-link-url" placeholder="https://..." style="flex:2"/>
          <input class="finput nb" id="ws-b-link-label" placeholder="Link label (e.g. Read more)" style="flex:1;min-width:140px"/>
        </div>
      </div>
      <div class="ws-post-row" style="margin-top:10px">
        <span style="font-size:11px;color:var(--text3);margin-right:4px">Priority:</span>
        <button class="ws-priority-pill sel" onclick="wsSelPriority(this,'general')">General</button>
        <button class="ws-priority-pill" onclick="wsSelPriority(this,'policy')">Policy</button>
        <button class="ws-priority-pill" onclick="wsSelPriority(this,'urgent')">Urgent</button>
        <button class="ws-priority-pill" onclick="wsSelPriority(this,'announcement')">Announcement</button>
        <div style="flex:1"></div>
        <button class="btn sm" onclick="bltTogglePostBar()">Cancel</button>
        <button class="btn sm primary" onclick="wsPostBulletin()">Send to all</button>
      </div>
    </div>
    <div class="ws-bulletin-notebook">
      <div class="ws-bulletin-nb-header">
        <span class="ws-bulletin-nb-label">📋 Department Announcements</span>
        <span style="font-size:10px;color:#8b9de8">${bulletins.length} post${bulletins.length!==1?'s':''}</span>
      </div>
      <div class="ws-bulletin-list">
        ${bulletins.length?bulletins.map(bcCard).join(''):'<div style="padding:32px 52px;color:var(--text4);font-size:13px;font-style:italic">No bulletins posted yet.</div>'}
      </div>
    </div>
  </div>`;
  if(window.lucide)lucide.createIcons();
}

function bltTogglePostBar(){const b=document.getElementById('ws-post-bar');if(b)b.classList.toggle('open');}



async function wsToggleLine(noteKey,lineIdx,checked){
  await fbUpd('wsNotes/'+CU.username+'/'+noteKey+'/checkedLines',{[lineIdx]:checked});
}

function wsTogglePostBar(){const b=document.getElementById('ws-post-bar');if(b)b.classList.toggle('open');}
function wsSelPriority(el,val){_wsPriority=val;document.querySelectorAll('.ws-priority-pill').forEach(p=>p.classList.remove('sel'));el.classList.add('sel');}

// Bulletin image helpers
let _bltImgData='';
function bltPreviewImage(input){
  const file=input.files[0];if(!file)return;
  if(!file.type.startsWith('image/')){toast('Please select an image.');return;}
  if(file.size>3*1024*1024){toast('Image must be under 3 MB.');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    _bltImgData=e.target.result;
    const pr=document.getElementById('ws-b-img-preview');
    const img=document.getElementById('ws-b-img-preview-el');
    if(pr)pr.style.display='';
    if(img)img.src=_bltImgData;
    const urlInput=document.getElementById('ws-b-img-url');
    if(urlInput)urlInput.value='';
  };
  reader.readAsDataURL(file);
}
function bltPreviewImageUrl(url){
  if(!url){_bltImgData='';const pr=document.getElementById('ws-b-img-preview');if(pr)pr.style.display='none';return;}
  _bltImgData=url;
  const pr=document.getElementById('ws-b-img-preview');
  const img=document.getElementById('ws-b-img-preview-el');
  if(pr)pr.style.display='';
  if(img)img.src=url;
}
function bltClearImage(){
  _bltImgData='';
  const pr=document.getElementById('ws-b-img-preview');if(pr)pr.style.display='none';
  const fi=document.getElementById('ws-b-img-file');if(fi)fi.value='';
  const ui=document.getElementById('ws-b-img-url');if(ui)ui.value='';
  const alt=document.getElementById('ws-b-img-alt');if(alt)alt.value='';
  const img=document.getElementById('ws-b-img-preview-el');if(img)img.src='';
}
async function bltDelete(key){
  if(!CU.isAdmin)return;
  if(!confirm('Delete this bulletin? This cannot be undone.'))return;
  await fbDel('wsBulletins/'+key);
  toast('Bulletin deleted.');
}

async function wsPostBulletin(){
  if(!canPostBulletin()){toast('Only Managers, HODs, and Leaders can post bulletins.');return;}
  const title=document.getElementById('ws-b-title')?.value.trim();
  const body=document.getElementById('ws-b-body')?.value.trim();
  if(!title){toast('Please add a title.');return;}
  if(!body){toast('Please add a message.');return;}
  const image=_bltImgData||'';
  const imageAlt=document.getElementById('ws-b-img-alt')?.value.trim()||'';
  const linkUrl=document.getElementById('ws-b-link-url')?.value.trim()||'';
  const linkLabel=document.getElementById('ws-b-link-label')?.value.trim()||'';
  const payload={title,body,type:_wsPriority,postedBy:CU.username,postedByName:CU.name,postedAt:Date.now(),acks:{}};
  if(image)Object.assign(payload,{image,imageAlt});
  if(linkUrl)Object.assign(payload,{linkUrl,linkLabel});
  await fbPush('wsBulletins',payload);
  // Reset form
  ['ws-b-title','ws-b-body','ws-b-link-url','ws-b-link-label'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  bltClearImage();
  const pb=document.getElementById('ws-post-bar');if(pb)pb.classList.remove('open');
  _wsPriority='general';
  document.querySelectorAll('.ws-priority-pill').forEach((p,i)=>{p.classList.toggle('sel',i===0);});
  toast('Bulletin posted to department!');
}
async function wsAck(key,btn){
  if(!key)return;
  await fbUpd('wsBulletins/'+key+'/acks',{[CU.username]:Date.now()});
  toast('Acknowledged!');
}

function dashNavDate(delta){
  var d=new Date(viewDate.getTime());
  d.setDate(d.getDate()+delta);
  viewDate=d;
  rerender();
}
function rerender(){
  if(_curPage==='dashboard')renderDashboard();
  else if(_curPage==='tasks')renderTasks();
  else if(_curPage==='members')renderMembers();
  else if(_curPage==='my-tasks')renderMyTasks();
  else if(_curPage==='calendar')renderCalendar();
  else if(_curPage==='campaigns')renderCampaigns();
  else if(_curPage==='incidents')renderIncidents();
  else if(_curPage==='reports')renderReports();
  else if(_curPage==='live-trackers')renderLiveTrackers();
  else if(_curPage==='tod')renderTOD();
  else if(_curPage==='audit')renderAudit();
  else if(_curPage==='leaves')renderLeaves();
  else if(_curPage==='workspace')renderWorkSpace();
  else if(_curPage==='notes')renderNotes();
  else if(_curPage==='bulletin')renderBulletin();
}
function showPage(p){
  _curPage=p;
  ['dashboard','tasks','members','reports','incidents','calendar','campaigns','my-tasks','live-trackers','tod','audit','leaves','workspace','notes','bulletin'].forEach(pg=>{
    const el=document.getElementById('pg-'+pg);
    if(el){
      if(pg===p){
        el.style.display='';
        el.classList.remove('page-fade');
        void el.offsetWidth; // reflow
        el.classList.add('page-fade');
      } else {
        el.style.display='none';
      }
    }
    const b=document.getElementById('ntab-'+pg);if(b)b.classList.toggle('active',pg===p);
  });
  const ddPages=['members','incidents','reports','leaves'];
  const ddBtn=document.getElementById('ntab-data');if(ddBtn)ddBtn.classList.toggle('active',ddPages.includes(p));
  const wsPages=['notes','bulletin'];
  const wsBtn=document.getElementById('ntab-ws');if(wsBtn)wsBtn.classList.toggle('active',wsPages.includes(p));
  // Update sidebar active states
  document.querySelectorAll('.sidebar-item,.sidebar-sub-item').forEach(el=>{
    el.classList.toggle('active',el.dataset.page===p);
  });
  rerender();
}

// ── NAV with proper dropdown ──
function getNavBadges(){
  // Compute live badge counts for each tab
  var b={};
  var today=ds(now());

  // Dashboard: overdue tasks today (admin) or overdue assigned tasks (member)
  if(CU.isAdmin){
    var schedBase=[...(D.tasks||[]),...(D.leadTasks||[])];
    var sched=schedBase.filter(function(t){return !t.inactive&&isSched(t,now());});
    var overdue=sched.filter(function(t){var ov=computeTaskOverall(t.id,today);return ov!=='Done'&&isOverdue(t,today);});
    var pendingExt=Object.values(D.extRequests||{}).filter(function(r){return r.status==='Pending';}).length;
    b.dashboard=overdue.length+pendingExt;
  } else {
    var myT=allTasks().filter(function(t){return !t.inactive&&(t.assignees||[]).includes(CU.username)&&isSched(t,now());});
    var myOverdue=myT.filter(function(t){var st=getMemberStatus(t.id,today,CU.username);return st!=='Done'&&isOverdue(t,today);});
    b['my-tasks']=myOverdue.length;
    b['dashboard']=myOverdue.length;
  }

  // Tasks: inactive tasks that need attention (admin/lead only)
  if(CU.isAdmin){
    b.tasks=(D.tasks||[]).filter(function(t){return t.inactive;}).length;
  } else if(isLead()){
    b.tasks=(D.leadTasks||[]).filter(function(t){return t._leadOwner===CU.username&&t.inactive;}).length;
  }

  // Incidents: open incidents count
  var openInc=(D.incidents||[]).filter(function(i){return i.status==='Open'&&!i._leadTaskEsc;}).length;
  b.incidents=openInc;

  // Reports: pending WR responses (leads only)
  if(isLead()&&!CU.isAdmin){
    var pendingWR=(D.weeklyReports||[]).filter(function(r){
      if((r.tlResponses||{})[CU.username])return false;
      var covCW=Math.max(1,r.cw-1);
      var covWD=getWeekDatesForCW(covCW,r.year||now().getFullYear());
      var covInc=getIncidentsForWeek(D.incidents||[],covWD);
      return covInc.some(function(i){
        if((i.cdmTL||'')=== CU.name)return true;
        var tagged=i.tagged||[];
        if(tagged.includes(CU.username))return true;
        return tagged.some(function(u){var member=D.members.find(function(m){return m.username===u;});return member&&member.reportsTo===CU.username;});
      });
    }).length;
    b.reports=pendingWR;
  }

  // Admin: pending WR responses — only leads who have incidents in the covered week AND haven't responded
  if(CU.isAdmin){
    var latestReport=(D.weeklyReports||[])[0];
    if(latestReport){
      var wrResponses=latestReport.tlResponses||{};
      var covCW2=Math.max(1,latestReport.cw-1);
      var covWD2=getWeekDatesForCW(covCW2,latestReport.year||now().getFullYear());
      var covInc2=getIncidentsForWeek(D.incidents||[],covWD2);
      var allLeads=D.members.filter(function(m){return m.approved&&m.active!==false&&LEAD_ROLES.includes(m.role);});
      var pendingLeads=allLeads.filter(function(tl){
        if(wrResponses[tl.username])return false; // already responded
        return covInc2.some(function(i){
          if((i.cdmTL||'')===tl.name)return true;
          var tagged=i.tagged||[];
          if(tagged.includes(tl.username))return true;
          return tagged.some(function(u){var member=D.members.find(function(m){return m.username===u;});return member&&member.reportsTo===tl.username;});
        });
      }).length;
      b.reports=pendingLeads;
    }
  }

  // Workspace: unacknowledged bulletins
  var unackedBulletins=(D.wsBulletins||[]).filter(function(b){return!(b.acks||{})[CU.username];}).length;
  b.bulletin=unackedBulletins;

  return b;
}


let _ddOpen=false;
function toggleNavDD(){
  _ddOpen=!_ddOpen;
  document.getElementById('nav-dd-panel')?.classList.toggle('open',_ddOpen);
  document.getElementById('ntab-data')?.classList.toggle('open',_ddOpen);
  if(_ddOpen)closeNavWsDD();
}
function closeNavDD(){
  _ddOpen=false;
  document.getElementById('nav-dd-panel')?.classList.remove('open');
  document.getElementById('ntab-data')?.classList.remove('open');
}

let _wsDdOpen=false;
function toggleNavWsDD(){
  _wsDdOpen=!_wsDdOpen;
  document.getElementById('nav-dd-ws-panel')?.classList.toggle('open',_wsDdOpen);
  document.getElementById('ntab-ws')?.classList.toggle('open',_wsDdOpen);
  if(_wsDdOpen)closeNavDD();
}
function closeNavWsDD(){
  _wsDdOpen=false;
  document.getElementById('nav-dd-ws-panel')?.classList.remove('open');
  document.getElementById('ntab-ws')?.classList.remove('open');
}

// Broadcast
function showBC(v){document.getElementById('bc-msg').textContent=v.msg;document.getElementById('bc-time').textContent='Sent '+new Date(parseInt(v.ts)).toLocaleString('en-PH');document.getElementById('bc-bar').style.display='flex';document.getElementById('nb-title').textContent='Team Announcement';document.getElementById('nb-body').textContent=v.msg;const nb=document.getElementById('notif-banner');nb.classList.add('show');setTimeout(()=>nb.classList.remove('show'),8000);}
function hideBC(){document.getElementById('bc-bar').style.display='none';}
function dismissBC(){if(D.broadcast)localStorage.setItem('gh_bc_dis',String(D.broadcast.ts));hideBC();}
async function sendBC(){const msg=document.getElementById('bc-input')?.value.trim();if(!msg)return;const ts=Date.now();await fbSet('broadcast',{msg,ts,sentBy:CU.name});localStorage.removeItem('gh_bc_dis');closeModal('modal-broadcast');document.getElementById('bc-input').value='';toast('Broadcast sent!');}

// ── DASHBOARD RESPONSE STATUS WIDGET ──
function buildDashboardResponseStatus(){
  if(!CU.isAdmin)return'';
  const reports=D.weeklyReports||[];
  if(!reports.length)return'';

  // "Current week's report" = the most recently published report
  const report=reports[0]; // already sorted newest first
  const coveredCW=Math.max(1,report.cw-1);
  const year=report.year||now().getFullYear();
  const coveredWD=getWeekDatesForCW(coveredCW,year);
  const coveredInc=getIncidentsForWeek(D.incidents||[],coveredWD);

  const LEAD_ORDER_D=['Team Lead','Assist. Manager','Manager','HOD'];
  const allLeads=D.members.filter(m=>m.approved&&m.active!==false&&LEAD_ROLES.includes(m.role))
    .sort((a,b)=>LEAD_ORDER_D.indexOf(a.role)-LEAD_ORDER_D.indexOf(b.role)||a.name.localeCompare(b.name));

  function leadHasInc(tl){
    return coveredInc.some(i=>{
      if((i.cdmTL||'')=== tl.name)return true;
      const tagged=i.tagged||[];
      if(tagged.includes(tl.username))return true;
      return tagged.some(u=>{const m=D.members.find(x=>x.username===u);return m&&m.reportsTo===tl.username;});
    });
  }

  const teamLeads=allLeads.filter(tl=>leadHasInc(tl));
  if(!teamLeads.length)return'';

  const responses=report.tlResponses||{};
  const dueFriday=report.dueFriday;
  const deadlineTs=dueFriday?new Date(dueFriday+'T17:00:00').getTime():null;

  const respondedLeads=teamLeads.filter(tl=>responses[tl.username]);
  const pendingLeads=teamLeads.filter(tl=>!responses[tl.username]);
  const respondedCount=respondedLeads.length;

  const autoEscalated=respondedLeads.filter(tl=>{
    const resp=responses[tl.username];
    return deadlineTs&&resp.ts>deadlineTs;
  });

  // Hover tooltip for responded
  const respondedTooltip=respondedLeads.map(tl=>{
    const resp=responses[tl.username];
    const isLate=deadlineTs&&resp.ts>deadlineTs;
    const ts=new Date(resp.ts).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return(isLate?'⚠️ ':'✓ ')+tl.name+(isLate?' (auto-escalated, '+ts+')':' · '+ts);
  }).join('\n')||'None yet';

  // Pending list — shown inline as avatar chips like AO tracker style
  const pendingAvatars=pendingLeads.map(tl=>{
    return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0">'
      +'<span class="av" style="width:22px;height:22px;font-size:8px;background:var(--red-light);color:var(--red)">'+ini(tl.name)+'</span>'
      +'<span style="font-size:12px;font-weight:500">'+tl.name+'</span>'
      +'<span style="font-size:10px;color:var(--text3)">'+( tl.role==='Assist. Manager'?'Asst. Mgr':tl.role)+'</span>'
    +'</div>';
  }).join('');

  const escNotice=autoEscalated.length
    ?'<div style="margin-top:6px;padding:5px 10px;background:var(--orange-light);border:1px solid #fed7aa;border-radius:var(--radius);font-size:11px;color:var(--orange);font-weight:600">⚠️ Auto-escalated: '+autoEscalated.map(tl=>tl.name).join(', ')+'</div>'
    :'';

  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:16px;box-shadow:var(--shadow)">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">'
      +'<span style="font-size:12px;font-weight:700;color:var(--text2)">✅ Response Status — CW'+report.cw+' report</span>'
      +'<span class="tt-wrap" style="display:inline-block;cursor:pointer">'
        +'<span style="color:var(--green);font-weight:700;font-size:12px;border-bottom:1px dashed var(--green)">'+respondedCount+' responded</span>'
        +'<div class="tt-box" style="white-space:pre-line;min-width:260px;bottom:calc(100% + 7px)">'+respondedTooltip+'</div>'
      +'</span>'
      +'<span style="color:var(--text3);font-size:12px"> / '+teamLeads.length+'</span>'
      +(pendingLeads.length?'<span style="color:var(--red);font-weight:700;font-size:12px">· '+pendingLeads.length+' pending</span>':'<span style="color:var(--green);font-size:12px;font-weight:600">· All responded ✓</span>')
      +(pendingLeads.length?'<button class="btn sm warning" onclick="remindPendingLeads(\''+report._key+'\')" style="margin-left:auto;font-size:11px">📣 Remind</button>':'')
    +'</div>'
    +(pendingLeads.length
      ?'<div style="border-top:1px solid var(--border);padding-top:8px">'
        +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);letter-spacing:.06em;margin-bottom:6px">Pending Response</div>'
        +pendingAvatars
      +'</div>'
      :'')
    +escNotice
  +'</div>';
}

// ── DASHBOARD SECTION BUILDERS ──
function buildDashboardTaskRows(list, date){
  const isToday=date===ds(now());
  // FR/AO-linked tasks now resolve their status against the SPECIFIC cycle covering the date
  // being viewed (see _frResolveColByCadence / aoFindDateCols), so no "always live, not
  // specific to this date" caveat is needed any more — browsing to a past Thursday correctly
  // shows that Thursday's own report status, not today's.
  const liveTrackerNote=t=>'';
  return list.map(t=>{
    const _cc=t._carryOrigin&&!t._trackerCarry; // cumulative (member-status) carry
    const ov=_cc?computeTaskOverallCumulative(t,t._carryOrigin,date):computeTaskOverall(t.id,date),rate=_cc?taskCompletionRateCumulative(t,t._carryOrigin,date):taskCompletionRate(t.id,date),isOv=isOverdue(t,date)&&ov!=='Done';
    const mAv=(t.assignees||[]).slice(0,4).map(u=>`<span class="av" title="${getMN(u)}" style="width:20px;height:20px;font-size:8px;margin-right:-2px">${ini(getMN(u))}</span>`).join('');
    // For FR-linked tasks, pull completion from the live tracker sheet instead of generic assignment rate
    let completionCell='';
    if(t._isPersonal){
      completionCell=`<button class="btn sm del" onclick="deletePersonalTask('${t._key}')" style="font-size:11px">Delete</button>`;
    } else if(t.frLinked){
      const _fc=getFRCompletionForTaskObj(t,date);
      const _fcCol=_fc.pct>=100?'var(--green)':_fc.pct>0?'var(--blue)':'var(--red)';
      const _fcBar=`<div class="rate-bar-wrap"><div class="rate-bar"><div class="rate-bar-fill" style="width:${_fc.pct}%;background:${_fcCol}"></div></div><div style="font-size:11px;font-weight:700;color:${_fcCol};text-align:right">${_fc.pct}%</div></div>`;
      completionCell=_fcBar+`<div style="font-size:10px;color:var(--text3)">${_fc.done}/${_fc.total} done</div>`;
    } else if(t.aoLinked){
      completionCell=rateBarHtml(rate.pct)+`<div id="ao-dash-progress" style="font-size:10px;color:var(--text3)">${rate.done}/${rate.total} done</div>`;
    } else {
      completionCell=rateBarHtml(rate.pct)+`<div style="font-size:10px;color:var(--text3)">${rate.done}/${rate.total} done</div>`+carryProgressNote(t,date);
    }
    // Inline "Request Extension" control — shown right beside the status so it's easy to find.
    // Shown for a non-admin assignee on ANY dashboard task (plain, Abnormal-Orders-linked, or
    // Finance-Report-linked) that isn't Done. Personal tasks are the member's own to-do items with
    // no team deadline, so they're the only kind excluded. Reflects a pending or approved request
    // instead of the button so it can't be submitted twice. Before the deadline it submits a
    // request; after the deadline the greyed button explains the window is closed.
    let extInline='';
    if(!t._isPersonal&&!CU.isAdmin&&(t.assignees||[]).includes(CU.username)){
      const myStat=t.aoLinked||t.frLinked?ov:getMemberStatus(t.id,date,CU.username);
      const hasPending=Object.values(D.extRequests||{}).some(function(r){return r.taskId==t.id&&r.date===date&&r.memberUsername===CU.username&&r.status==='Pending';});
      const hasApproved=!!getApprovedExt(t.id,date);
      if(hasApproved){
        extInline='<div style="margin-top:5px"><span style="font-size:10px;font-weight:700;color:var(--teal);background:var(--teal-light,#ccfbf1);padding:2px 7px;border-radius:20px">✓ Extension approved</span></div>';
      } else if(hasPending){
        extInline='<div style="margin-top:5px"><span style="font-size:10px;font-weight:700;color:var(--text3);background:var(--bg);border:1px solid var(--border);padding:2px 7px;border-radius:20px">⏳ Extension pending</span></div>';
      } else if(myStat!=='Done'){
        // Show the Request Extension control on every assigned task that isn't Done — including
        // ones already past deadline. Before the deadline it submits a request; after the deadline
        // the button explains the window is closed (extensions can't undo an auto-flagged miss).
        if(isOv){
          extInline='<div style="margin-top:5px"><button class="btn sm teal" style="font-size:10px;padding:2px 8px;opacity:.65" onclick="openExtRequestModal('+t.id+',\''+date+'\')" title="Deadline passed — extension window closed">⏱ Request Extension</button></div>';
        } else {
          extInline='<div style="margin-top:5px"><button class="btn sm teal" style="font-size:10px;padding:2px 8px" onclick="openExtRequestModal('+t.id+',\''+date+'\')">⏱ Request Extension</button></div>';
        }
      }
    }
    return `<tr class="${isOv?'overdue-row':''}">
      <td style="width:32%">
        <div style="font-weight:600">${t.title}${isOv?'&nbsp;<span style="color:var(--red);font-size:10px;font-weight:700">OVERDUE</span>':''}${carryBadge(t)}${t.aoLinked?'&nbsp;<span style="font-size:10px;background:var(--orange-light);color:var(--orange);padding:1px 6px;border-radius:20px;font-weight:700">📊 Abnormal Orders</span>':''}${t.frLinked?'&nbsp;<span style="font-size:10px;background:var(--blue-light);color:var(--blue);padding:1px 6px;border-radius:20px;font-weight:700">💰 Finance Report</span>':''}${t._isPersonal?'&nbsp;<span style="font-size:10px;background:var(--green-light);color:var(--green);padding:1px 6px;border-radius:20px;font-weight:700">✅ Personal</span>':''}</div>
        <span class="freq-chip fc-${t.freq||'other'}">${t.freq||'personal'}</span>
        ${t.aoLinked?buildAOInlineRegions(date):''}
        ${t.frLinked?`<div id="fr-inline-regions-${t.id}">${buildFRInlineRegionsForTask(t,date)}</div>`:''}
        ${liveTrackerNote(t)}
      </td>
      <td style="width:13%;text-align:center">${t._isPersonal?'<span style="font-size:11px;color:var(--text3)">—</span>':taskDateChip(t,date)}</td>
      <td style="width:13%;text-align:center"><span class="dl-chip${isOv?' overdue':''}">${t.deadline||'—'}</span></td>
      <td style="width:18%">${mAv}${(t.assignees||[]).length>4?`<span style="font-size:11px;color:var(--text3)"> +${t.assignees.length-4}</span>`:t._isPersonal?'<span style="font-size:11px;color:var(--text3)">Personal</span>':''}</td>
      <td style="width:12%;text-align:center">${t._isPersonal?`<select class="finput nb" style="padding:4px 7px;font-size:12px;width:auto" onchange="updatePersonalTaskStatus('${t._key}',this.value)"><option${(t.status||'Pending')==='Pending'?' selected':''}>Pending</option><option${t.status==='Done'?' selected':''}>Done</option></select>`:t.aoLinked||t.frLinked?`<span class="sbadge ${sbc(ov)}" style="cursor:default"><span class="sdot ${sdc(ov)}"></span>${ov}</span>`:statusBadge(ov,t.id,date)}${extInline}</td>
      <td style="width:16%">${completionCell}</td>
    </tr>`;
  }).join('');
}
function dashTaskTableHead(){
  return '<thead><tr><th style="width:32%">Task</th><th style="width:13%;text-align:center">Task Date</th><th style="width:13%;text-align:center">Deadline</th><th style="width:18%">Assigned</th><th style="width:12%;text-align:center">Status</th><th style="width:16%">Completion</th></tr></thead>';
}
function buildDashboardOngoing(byS,date){
  const list=byS.Ongoing||[];if(!list.length)return'';
  return `<div class="section-hdr sh-yellow">Ongoing <span style="opacity:.7">(${list.length})</span></div><div class="tbl-wrap"><table>${dashTaskTableHead()}<tbody>${buildDashboardTaskRows(list,date)}</tbody></table></div>`;
}
function buildDashboardCompleted(byS,date){
  const list=byS.Done||[];if(!list.length)return'';
  return `<div class="section-hdr sh-green">Completed <span style="opacity:.7">(${list.length})</span></div><div class="tbl-wrap"><table>${dashTaskTableHead()}<tbody>${buildDashboardTaskRows(list,date)}</tbody></table></div>`;
}
function buildDashboardNeedsExtension(byS,date){
  const list=byS['Needs Extension']||[];if(!list.length)return'';
  return `<div class="section-hdr sh-teal">Needs Extension <span style="opacity:.7">(${list.length})</span></div><div class="tbl-wrap"><table>${dashTaskTableHead()}<tbody>${buildDashboardTaskRows(list,date)}</tbody></table></div>`;
}

// ── DASHBOARD ──
// ── Dashboard: On-Leave Summary ──────────────────────────────────────────────
// Admin-only glance card: who has leave logged in the current month, their buddy
// (coverage), and whether handover/briefing is still pending. Keyed on the leave's
// structured `month` field ("July 2026") rather than the free-text date string,
// which isn't machine-parseable (e.g. "Jan 2–5", "Jan 9 & 16"). The raw date text
// is shown as-is so the admin can read the exact days.
function buildDashboardLeaveSummary(){
  if(!CU.isAdmin)return'';
  const now_=now();
  const LV_MONTHS_LOCAL=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const curMonth=LV_MONTHS_LOCAL[now_.getMonth()]+' '+now_.getFullYear();
  const rows=(D.leaves||[]).filter(e=>e&&e.month===curMonth);
  if(!rows.length)return'';
  // Resolve each CDM's standing buddy from the member record; fall back to the
  // per-leave buddy field if no standing pairing is set.
  function buddyDisplay(e){
    const owner=(D.members||[]).find(m=>m&&m.name&&m.name.trim().toLowerCase()===String(e.cdm||'').trim().toLowerCase());
    if(owner&&owner.buddy){
      const b=(D.members||[]).find(m=>m&&m.username===owner.buddy);
      if(b)return b.name;
    }
    return e.buddy||'';
  }
  // Sort so anyone with a pending handover/briefing (the ones to chase) floats up.
  const enriched=rows.map(e=>{
    const pending=(e.handover==='Pending')||(e.briefing==='Pending');
    return{e,pending,buddy:buddyDisplay(e)};
  }).sort((a,b)=>(b.pending?1:0)-(a.pending?1:0));
  const chaseCount=enriched.filter(x=>x.pending).length;

  const cards=enriched.map(({e,pending,buddy})=>{
    const flag=pending
      ?'<span style="font-size:10px;font-weight:700;color:var(--red);background:var(--red-light,#fee2e2);padding:2px 7px;border-radius:10px;white-space:nowrap">⚠ chase handover</span>'
      :'<span style="font-size:10px;font-weight:600;color:var(--green);background:var(--green-light,#dcfce7);padding:2px 7px;border-radius:10px;white-space:nowrap">✓ covered</span>';
    const buddyBit=buddy
      ?`<span style="font-size:11px;color:var(--text2)">Buddy: <strong>${buddy}</strong></span>`
      :'<span style="font-size:11px;color:var(--red)">No buddy assigned</span>';
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);background:#fff;flex-wrap:wrap">
      <span class="av" style="width:26px;height:26px;font-size:10px;flex-shrink:0">${ini(e.cdm||'?')}</span>
      <div style="flex:1;min-width:120px">
        <div style="font-size:12px;font-weight:700">${e.cdm||'—'} ${lvTypeBadge(e.type||'AL')}</div>
        <div style="font-size:11px;color:var(--text3)">${e.date||'—'}${e.region?' · '+e.region:''}</div>
      </div>
      ${buddyBit}
      ${flag}
    </div>`;
  }).join('');

  return `<div class="panel" style="margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <span style="font-size:12px;font-weight:700;color:var(--text2)">🌴 On Leave — ${curMonth}${chaseCount?` · <span style="color:var(--red)">${chaseCount} to chase</span>`:''}</span>
      <button class="btn sm" onclick="showPage('leaves')" style="font-size:10px;padding:2px 10px">Open Leave Tracker →</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${cards}</div>
  </div>`;
}

function renderDashboard(){
  const date=ds(viewDate);
  // When looking at today, run the (idempotent) overdue sweep first so a task whose deadline just
  // passed is already registered as non-compliance by the time this render paints — no waiting for
  // the 20s poll. Guard against recursion via the fbListen→renderDashboard callback.
  if(date===ds(now())&&!window._ncSweeping){
    window._ncSweeping=true;
    try{checkOverdueAndBroadcast();}catch(e){}
    window._ncSweeping=false;
  }
  // Admin sees all admin tasks + all lead tasks so tasks tagged to others appear on dashboard
  const schedBase=CU.isAdmin?[...(D.tasks||[]),...(D.leadTasks||[])]:allTasks();
  const sched=schedBase.filter(t=>!t.inactive&&isSched(t,viewDate));
  // Carry-over: recurring tasks scheduled on an EARLIER day that are still not fully Done keep
  // appearing until completed. Attach _carryOrigin (the origin scheduled date) so rows show the
  // cumulative running progress across every day the task stayed open.
  const schedIds=new Set(sched.map(t=>t.id));
  const carried=[];
  schedBase.forEach(t=>{
    if(t.inactive)return;
    if(schedIds.has(t.id))return;               // already showing as today's scheduled occurrence
    // Tracker-driven tasks (Finance Report / Abnormal Orders): status is live from the tracker
    // (date-independent). Carry them forward from their last scheduled day until the tracker is
    // 100% complete, using the simpler tracker-carry rule.
    if(t.aoLinked||t.frLinked){
      const to=trackerCarryOrigin(t,viewDate);
      if(to&&inDateFence(t,date))carried.push({...t,_carryOrigin:to,_trackerCarry:true});
      return;
    }
    if(!(t.assignees||[]).length)return;
    const origin=carryOriginDate(t,viewDate);
    if(!origin||origin===date)return;           // nothing open from a prior day
    if(!inDateFence(t,date))return;              // past this task's End Date — stop carrying
    if(computeTaskOverallCumulative(t,origin,date)==='Done')return; // already completed
    carried.push({...t,_carryOrigin:origin});
  });
  // Mark today's scheduled tasks with their own carry origin too, so a task pending since an
  // earlier day but also scheduled again today shows cumulative progress. Use copies so we never
  // mutate the shared D.tasks / D.leadTasks source objects.
  const schedTagged=sched.map(t=>{
    if(t.aoLinked||t.frLinked||!(t.assignees||[]).length)return t;
    const origin=carryOriginDate(t,viewDate);
    if(origin&&origin!==date&&computeTaskOverallCumulative(t,origin,date)!=='Done')return {...t,_carryOrigin:origin};
    return t;
  });
  const schedAll=schedTagged.concat(carried);
  const metrics=computeDashboardMetrics(schedAll,date);

  const byS={Done:[],Ongoing:[],Pending:[],'Needs Extension':[]};
  schedAll.forEach(t=>{const ov=(t._carryOrigin&&!t._trackerCarry)?computeTaskOverallCumulative(t,t._carryOrigin,date):computeTaskOverall(t.id,date);if(!byS[ov])byS[ov]=[];byS[ov].push(t);});
  // Inject admin's own personal tasks into the dashboard buckets
  (D.personalTasks||[]).filter(t=>t._owner===CU.username).forEach(t=>{
    const bucket=(t.status==='Done')?'Done':'Pending';
    byS[bucket].push({...t,_isPersonal:true,freq:'personal',deadline:t.dueDate||''});
  });

  const escalated=schedAll.filter(t=>{const ov=(t._carryOrigin&&!t._trackerCarry)?computeTaskOverallCumulative(t,t._carryOrigin,date):computeTaskOverall(t.id,date);return ov!=='Done'&&isOverdue(t,date);});
  let escBanner=escalated.length?`<div class="esc-banner"><span>⚠️</span><div><div style="font-weight:700;color:var(--orange);font-size:13px">${escalated.length} overdue task${escalated.length>1?'s':''}</div><div style="font-size:12px;color:var(--text3)">${escalated.map(t=>t.title).join(' · ')}</div></div></div>`:'';

  // Extension requests
  const pendingExt=CU.isAdmin?Object.entries(D.extRequests).filter(([,r])=>r.status==='Pending'):[];
  let extHtml='';
  if(pendingExt.length){
    extHtml=`<div class="section-hdr sh-teal" style="margin-top:4px">Extension Requests <span style="opacity:.7">(${pendingExt.length})</span></div>`;
    pendingExt.forEach(([k,r])=>{extHtml+=`<div class="ext-request-card"><div><div style="font-weight:700;font-size:13px">${r.taskTitle}</div><div style="font-size:12px;margin:3px 0">From <b>${r.memberName}</b> — ${r.reason}</div><div style="font-size:11px;color:var(--text3)">Proposed: ${r.proposedDate} ${r.proposedTime}</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button class="btn sm approve" onclick="approveExt('${k}')">Approve</button><button class="btn sm del" onclick="declineExt('${k}')">Decline</button></div></div>`;});
  }

  const secCfg=[{k:'Pending',l:'Pending',c:'sh-red'},{k:'Ongoing',l:'Ongoing',c:'sh-yellow'},{k:'Needs Extension',l:'Needs Extension',c:'sh-teal'},{k:'Done',l:'Completed',c:'sh-green'}];

  // Build pending section first (highest priority)
  const pendingSec=(byS.Pending||[]).length?`<div class="section-hdr sh-red">Pending <span style="opacity:.7">(${(byS.Pending||[]).length})</span></div><div class="tbl-wrap"><table>${dashTaskTableHead()}<tbody>${buildDashboardTaskRows(byS.Pending||[],date)}</tbody></table></div>`:'';

  // Include personal tasks in admin dashboard — show all users' personal tasks
  const adminPersonal=(D.personalTasks||[]).filter(t=>t._owner===CU.username);
  const adminPersonalSec=adminPersonal.length?`<div style="margin-bottom:16px">
    <div class="section-hdr sh-green" style="margin-bottom:8px">✅ My Personal Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(${adminPersonal.filter(t=>t.status==='Done').length}/${adminPersonal.length} done)</span>
      <button class="btn sm primary" onclick="openPersonalTaskForm(null)" style="margin-left:auto;font-size:11px">+ Personal Task</button>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${adminPersonal.map(t=>`<tr style="${t.status==='Done'?'opacity:0.55':''}"><td style="font-weight:600">${t.status==='Done'?'<s>'+escHtml(t.title)+'</s>':escHtml(t.title)}</td><td style="font-size:12px;color:var(--text3)">${t.note?escHtml(t.note):'—'}</td><td><select class="finput nb" style="padding:4px 8px;font-size:12px;width:auto" onchange="updatePersonalTaskStatus('${t._key}',this.value)"><option${t.status==='Pending'?' selected':''}>Pending</option><option${t.status==='Done'?' selected':''}>Done</option></select></td><td><button class="btn sm edit" onclick="openPersonalTaskForm('${t._key}')" style="margin-right:3px">Edit</button><button class="btn sm del" onclick="deletePersonalTask('${t._key}')">Delete</button></td></tr>`).join('')}
    </tbody></table></div>
  </div>`:'';

  // Member-created personal tasks visible on admin dashboard
  const memberPersonalGroups={};
  (D.personalTasks||[]).filter(t=>t._owner!==CU.username).forEach(t=>{
    const ownerName=getMN(t._owner);
    if(!memberPersonalGroups[ownerName])memberPersonalGroups[ownerName]=[];
    memberPersonalGroups[ownerName].push(t);
  });
  const memberPersonalSec=Object.keys(memberPersonalGroups).length?`<div style="margin-bottom:16px">
    <div class="section-hdr sh-blue" style="margin-bottom:8px">👤 User-Created Personal Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(across all members)</span></div>
    ${Object.entries(memberPersonalGroups).map(([ownerName,tasks])=>`
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);padding:6px 0 4px 4px;border-bottom:1px solid var(--border);margin-bottom:4px">${ownerName} <span style="font-size:11px;font-weight:400;color:var(--text3)">(${tasks.filter(t=>t.status==='Done').length}/${tasks.length} done)</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Note</th><th>Status</th></tr></thead><tbody>
      ${tasks.map(t=>`<tr style="${t.status==='Done'?'opacity:0.55':''}"><td style="font-weight:600">${t.status==='Done'?'<s>'+escHtml(t.title)+'</s>':escHtml(t.title)}</td><td style="font-size:12px;color:var(--text3)">${t.note?escHtml(t.note):'—'}</td><td><span style="font-size:12px;font-weight:600;color:${t.status==='Done'?'var(--green)':'var(--text3)'}">${t.status||'Pending'}</span></td></tr>`).join('')}
      </tbody></table></div>
    </div>`).join('')}
  </div>`:'';

  // Quarterly archive reminder — shown on admin dashboard in the last week of each quarter
  const nowD=now();
  const nowMonth=nowD.getMonth()+1; // 1-12
  const nowDay=nowD.getDate();
  const lastDayOfMonth=new Date(nowD.getFullYear(),nowD.getMonth()+1,0).getDate();
  const isQuarterEndMonth=[3,6,9,12].includes(nowMonth);
  const isLastWeekOfQuarter=isQuarterEndMonth&&nowDay>=lastDayOfMonth-6;
  const resolvedOlderThan3m=(D.incidents||[]).filter(function(i){
    const threeMonthCutoff=new Date();threeMonthCutoff.setMonth(threeMonthCutoff.getMonth()-3);
    return i.status==='Resolved'&&i.date&&i.date<=ds(threeMonthCutoff)&&!i._archived;
  });
  const quarterReminderBanner=CU.isAdmin&&isLastWeekOfQuarter&&resolvedOlderThan3m.length
    ?`<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:var(--radius-lg);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px;color:#856404">🗓️ End-of-Quarter Reminder — Archive Incident Log</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${resolvedOlderThan3m.length} resolved incident${resolvedOlderThan3m.length!==1?'s':''} older than 3 months are ready to be archived or downloaded. It's the end of Q${[3,6,9,12].indexOf(nowMonth)+1}!</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm success" onclick="showPage('incidents');setTimeout(()=>downloadArchivableExcel(),300)">&#8595; Download Excel</button>
          <button class="btn sm warning" onclick="showPage('incidents')">Go to Incident Log →</button>
        </div>
      </div>`
    :'';

  document.getElementById('pg-dashboard').innerHTML=`
    <div class="page-header">
      <div class="page-title">${ds(viewDate)===ds(now())?'Dashboard — Today':'Dashboard — '+fmtD(viewDate)}</div>
      <div class="date-nav">
        <button class="nav-arrow" onclick="dashNavDate(-1)" title="Previous day">&#8592;</button>
        ${dateSel(viewDate)}
        <button class="nav-arrow" onclick="dashNavDate(1)" title="Next day">&#8594;</button>
        ${CU.isAdmin?'<button class="btn warning" onclick="openModal(\'modal-broadcast\')" style="margin-left:4px">Broadcast</button>':''}
        <button class="btn sm" onclick="openRemind()">Reminders</button>
      </div>
    </div>
    ${escBanner}${extHtml}
    ${quarterReminderBanner}
    ${metricsHTML(metrics)}
    ${pendingSec}
    ${buildDashboardOngoing(byS,date)}
    ${buildDashboardCompleted(byS,date)}
    ${buildDashboardNeedsExtension(byS,date)}
    ${buildDashboardResponseStatus()}
    ${adminPersonalSec}
    ${memberPersonalSec}
    ${buildDashboardLeaveSummary()}
    ${buildDashboardNonCompliance()}
    ${buildActivityFeed()}`;
}

async function approveExt(key){if(!CU.isAdmin){toast('Only admins can approve extension requests');return;}const r=D.extRequests[key];if(!r)return;await fbUpd(`extRequests/${key}`,{status:'Approved',reviewedBy:CU.name,reviewedAt:Date.now()});await logAct(r.taskId,r.date,CU.name,`Extension approved for ${r.memberName}. New: ${r.proposedDate} ${r.proposedTime}`,'EXT_APPROVED');toast('Extension approved');}
async function declineExt(key){if(!CU.isAdmin){toast('Only admins can decline extension requests');return;}const r=D.extRequests[key];if(!r)return;await fbUpd(`extRequests/${key}`,{status:'Declined',reviewedBy:CU.name,reviewedAt:Date.now()});await logAct(r.taskId,r.date,CU.name,`Extension declined for ${r.memberName}`,'EXT_DECLINED');toast('Extension declined');}

function renderTasks(){
  var el=document.getElementById('pg-tasks');if(!el)return;
  if(!D._tLoaded){el.innerHTML='<div class="empty-state"><div class="spinner" style="margin:0 auto 12px"></div>Loading...</div>';return;}
  var groups={daily:'Daily',weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',eom:'End of Month',occasional:'Occasional',other:'Other'};

  function schedLabel(t){
    if(t.freq==='weekly')return DOW[parseInt(t.dow)]||'';
    if(t.freq==='daily')return'Every day';
    if(t.freq==='monthly')return(t.dayOfMonth||1)+'st of month';
    if(t.freq==='quarterly')return'1st of quarter';
    if(t.freq==='eom')return'Last day';
    return'—';
  }

  // ── MEMBER VIEW ──
  if(!CU.isAdmin&&!isLead()){
    // Department-wide tasks assigned to this member
    var myAdminTasks=(D.tasks||[]).filter(function(t){return !t.inactive&&(t.assignees||[]).includes(CU.username);});
    // Lead tasks assigned to this member
    var myLeadTasksM=(D.leadTasks||[]).filter(function(t){return !t.inactive&&(t.assignees||[]).includes(CU.username);});
    // Personal tasks
    var myPersonal=(D.personalTasks||[]).filter(function(t){return t._owner===CU.username;});

    var html='<div class="page-header"><div><div class="page-title">Task Management</div><div class="page-subtitle">View, manage and track all governance tasks</div></div>'
      +'<div style="display:flex;gap:8px;align-items:center"><button class="btn primary" onclick="openPersonalTaskForm(null)">+ Personal Task</button></div></div>';

    // Helper: builds the Status + Action (Request Extension) cells shared by both member sections below
    var todayDate=ds(now());
    function statusActionCells(t){
      var appliesToday=isSched(t,now());
      if(!appliesToday){
        return '<td style="text-align:center"><span style="color:var(--text4);font-size:11px">—</span></td><td style="text-align:center"><span style="color:var(--text4);font-size:11px">Not due today</span></td>';
      }
      var myStat=getMemberStatus(t.id,todayDate,CU.username);
      var isOv=isOverdue(t,todayDate)&&myStat!=='Done';
      var statusCell='<span class="sbadge '+sbc(myStat)+'" style="cursor:default"><span class="sdot '+sdc(myStat)+'"></span>'+myStat+'</span>'+(isOv?'<div style="font-size:10px;color:var(--red);font-weight:700;margin-top:2px">OVERDUE</div>':'');
      var extRec=Object.values(D.extRequests||{}).find(function(r){return r.taskId==t.id&&r.date===todayDate&&r.memberUsername===CU.username&&r.status!=='Declined';});
      var actionCell;
      if(myStat==='Done'){
        actionCell='<span style="color:var(--text4);font-size:11px">—</span>';
      } else if(extRec&&extRec.status==='Approved'){
        actionCell='<span style="color:var(--teal);font-weight:600;font-size:11px">&#10003; Extended to '+extRec.proposedDate+' '+extRec.proposedTime+'</span>';
      } else if(extRec&&extRec.status==='Pending'){
        actionCell='<span style="color:var(--text3);font-size:11px">&#9203; Extension Pending</span>';
      } else if(isOv){
        // Deadline passed with no approved extension — requests are closed and the
        // miss is auto-flagged, so don't offer a button that will just be rejected.
        actionCell='<span style="color:var(--red);font-size:11px;font-weight:600">Extension window closed</span>';
      } else {
        actionCell='<button class="btn sm teal" onclick="openExtRequestModal('+t.id+',\''+todayDate+'\')">Request Extension</button>';
      }
      return '<td style="text-align:center">'+statusCell+'</td><td style="text-align:center">'+actionCell+'</td>';
    }

    // Section 1: Department-Wide Tasks — only tasks assigned to this member
    var allAdminTasks=(D.tasks||[]).filter(function(t){return !t.inactive&&(t.assignees||[]).includes(CU.username);});
    html+='<div class="section-hdr sh-gray" style="margin-bottom:8px">🏢 Department-Wide Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(admin-created tasks assigned to you)</span></div>';
    if(allAdminTasks.length){
      html+='<div class="tbl-wrap"><table><thead><tr><th style="width:34%">Task</th><th style="width:16%;text-align:center">Schedule</th><th style="width:16%;text-align:center">Deadline</th><th style="width:14%;text-align:center">Status</th><th style="width:20%;text-align:center">Extension</th></tr></thead><tbody>';
      html+=allAdminTasks.map(function(t){
        return'<tr><td><div style="font-weight:600">'+t.title+'</div>'+(t.note?'<div style="font-size:11px;color:var(--text3)">'+t.note+'</div>':'')+'</td>'
          +'<td style="text-align:center"><span class="freq-chip fc-'+t.freq+'">'+schedLabel(t)+'</span></td>'
          +'<td style="text-align:center"><span class="dl-chip">'+(t.deadline||'—')+'</span></td>'
          +statusActionCells(t)
        +'</tr>';
      }).join('');
      html+='</tbody></table></div>';
    } else {
      html+='<div class="empty-state" style="padding:20px">No department-wide tasks assigned to you.</div>';
    }

    // Section 2: Lead-Specific Tasks
    html+='<div class="section-hdr sh-purple" style="margin-top:12px">👥 Lead-Specific Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(assigned by your lead)</span></div>';
    if(myLeadTasksM.length){
      html+='<div class="tbl-wrap"><table><thead><tr><th style="width:30%">Task</th><th style="width:14%">Lead</th><th style="width:14%;text-align:center">Schedule</th><th style="width:14%;text-align:center">Deadline</th><th style="width:12%;text-align:center">Status</th><th style="width:16%;text-align:center">Extension</th></tr></thead><tbody>';
      html+=myLeadTasksM.map(function(t){
        return'<tr><td><div style="font-weight:600">'+t.title+'</div>'+(t.note?'<div style="font-size:11px;color:var(--text3)">'+t.note+'</div>':'')+'</td>'
          +'<td style="font-size:12px;color:var(--text3)">'+getMN(t._leadOwner)+'</td>'
          +'<td style="text-align:center"><span class="freq-chip fc-'+t.freq+'">'+schedLabel(t)+'</span></td>'
          +'<td style="text-align:center"><span class="dl-chip">'+(t.deadline||'—')+'</span></td>'
          +statusActionCells(t)
        +'</tr>';
      }).join('');
      html+='</tbody></table></div>';
    } else {
      html+='<div class="empty-state" style="padding:20px">No lead-specific tasks assigned to you.</div>';
    }

    // Section 3: Personal Tasks
    var personalDone=myPersonal.filter(function(t){return t.status==='Done';}).length;
    var personalPct=myPersonal.length?Math.round(personalDone/myPersonal.length*100):0;
    html+='<div class="section-hdr sh-green" style="margin-top:12px">✅ My Personal Tasks'
      +(myPersonal.length?' <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">('+personalDone+'/'+myPersonal.length+' done — '+personalPct+'%)</span>':'')
      +'</div>';
    if(myPersonal.length){
      html+='<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      html+=myPersonal.map(function(t){
        var isDone=t.status==='Done';
        return'<tr style="'+(isDone?'opacity:0.6':'')+'"><td style="font-weight:600">'+(isDone?'<s>'+t.title+'</s>':t.title)+'</td>'
          +'<td style="font-size:12px;color:var(--text3)">'+(t.note||'—')+'</td>'
          +'<td><select class="finput nb" style="padding:4px 8px;font-size:12px;width:auto" onchange="updatePersonalTaskStatus(\''+t._key+'\',this.value)">'
            +'<option'+(t.status==='Pending'?' selected':'')+'>Pending</option>'
            +'<option'+(t.status==='Done'?' selected':'')+'>Done</option>'
          +'</select></td>'
          +'<td><button class="btn sm del" onclick="deletePersonalTask(\''+t._key+'\')">Delete</button></td>'
        +'</tr>';
      }).join('');
      html+='</tbody></table></div>';
    } else {
      html+='<div class="empty-state" style="padding:20px">No personal tasks yet. Click "+ Personal Task" to add one.</div>';
    }

    el.innerHTML=html;
    return;
  }

  // ── ADMIN / LEAD VIEW ──
  // ── Column layout: fixed pixel widths for perfect cross-table alignment ──
  // Standard 5-col table (Task | Schedule | Deadline | Assigned | Actions)
  // Lead 5-col table  (Task | Lead      | Schedule | Deadline | Assigned)
  // Using colgroup + table-layout:fixed so every section aligns perfectly
  const TBLSTYLE='style="width:100%;table-layout:fixed;border-collapse:collapse"';
  // Col widths in px (must sum to ~100% of container)
  const W={task:'auto',sched:'130px',dl:'130px',assign:'180px',act:'200px',lead:'130px'};

  const COLGROUP5='<colgroup><col/><col style="width:'+W.sched+'"/><col style="width:'+W.dl+'"/><col style="width:'+W.assign+'"/><col style="width:'+W.act+'"/></colgroup>';
  const COLGROUP5L='<colgroup><col/><col style="width:'+W.lead+'"/><col style="width:'+W.sched+'"/><col style="width:'+W.dl+'"/><col style="width:'+W.assign+'"/><col style="width:'+W.act+'"/></colgroup>';

  const TH='style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc"';
  const THC='style="padding:9px 12px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc"';
  const THR='style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc"';

  function sth(col,label,align){var s=_taskSort.col===col?(_taskSort.dir===1?'asc':'desc'):'';var a=align?'text-align:'+align+';':'';return '<th class="sh '+s+'" style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc;'+a+'" onclick="_taskSort.col===\''+col+'\' ? _taskSort.dir*=-1 : (_taskSort.col=\''+col+'\',_taskSort.dir=1); renderTasks()">'+label+'</th>';}
  function tHead5(){return '<thead><tr>'+sth('title','Task','')+sth('freq','Schedule','center')+sth('deadline','Deadline','center')+'<th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc">Assigned</th><th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc">Actions</th></tr></thead>';}
  function tHead5Lead(){return '<thead><tr>'+sth('title','Task','')+sth('_leadOwner','Lead','')+sth('freq','Schedule','center')+sth('deadline','Deadline','center')+'<th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc">Assigned</th><th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:1px solid var(--border);background:#f8fafc">Actions</th></tr></thead>';}

  function tblWrap5(inner){return '<div class="tbl-wrap"><table '+TBLSTYLE+'>'+COLGROUP5+inner+'</table></div>';}
  function tblWrap5L(inner){return '<div class="tbl-wrap"><table '+TBLSTYLE+'>'+COLGROUP5L+inner+'</table></div>';}

  function taskRow(t){
    var mAv=(t.assignees||[]).slice(0,5).map(function(u){return'<span class="av" title="'+getMN(u)+'" style="width:20px;height:20px;font-size:8px;margin-right:2px">'+ini(getMN(u))+'</span>';}).join('');
    var badge=t._isLeadTask?'<span style="font-size:10px;background:var(--purple-light);color:var(--purple);padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px">My Task</span>':'';
    var isInactive=!!(t.inactive);
    var actions='';
    if(canEditTask(t)){
      var activeToggleLabel=isInactive?'✅ Active':'⏸ Inactive';
      var activeToggleClass=isInactive?'btn sm approve':'btn sm';
      var activeToggle='<button class="'+activeToggleClass+'" onclick="toggleTaskActive('+JSON.stringify(t.id)+','+JSON.stringify(t._isLeadTask||false)+','+isInactive+')" style="margin-right:3px;font-size:11px">'+activeToggleLabel+'</button>';
      actions=activeToggle+'<button class="btn sm edit" onclick="openTaskForm('+JSON.stringify(t.id)+','+JSON.stringify(t._isLeadTask||false)+')" style="margin-right:3px">Edit</button>';
      if(canDeleteTask(t)) actions+='<button class="btn sm del" onclick="delTask('+JSON.stringify(t.id)+','+JSON.stringify(t._isLeadTask||false)+')">Delete</button>';
    } else if(isLead()){
      actions='<span style="font-size:11px;color:var(--text3)">Admin task</span>';
    }
    var rowStyle=isInactive?'opacity:0.5;background:#fafafa':'';
    var inactiveBadge=isInactive?'<span style="font-size:9px;background:#f1f5f9;color:#6b7280;padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px;border:1px solid #e2e6ea">INACTIVE</span>':'';
    return '<tr style="'+rowStyle+'">'
      +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle"><div style="font-weight:600">'+t.title+badge+inactiveBadge+'</div>'+(t.note?'<div style="font-size:11px;color:var(--text3)">'+t.note+'</div>':'')+taskWindowLabel(t)+'</td>'
      +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:center"><span class="freq-chip fc-'+t.freq+'">'+schedLabel(t)+'</span></td>'
      +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:center"><span class="dl-chip">'+(t.deadline||'—')+'</span></td>'
      +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle">'+mAv+((t.assignees||[]).length>5?'<span style="font-size:11px;color:var(--text3)">+'+(t.assignees.length-5)+'</span>':'')+(!(t.assignees||[]).length?'<span style="color:var(--text4);font-size:12px">None</span>':'')+'</td>'
      +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:right;white-space:nowrap">'+actions+'</td>'
    +'</tr>';
  }


  if(!window._taskSort)window._taskSort={col:'title',dir:1};
  var _rawTasks=allTasks();
  var tasks=_rawTasks.slice().sort(function(a,b){var col=_taskSort.col,dir=_taskSort.dir;var av=a[col]||'',bv=b[col]||'';if(typeof av==='number'&&typeof bv==='number')return(av-bv)*dir;return String(av).toLowerCase()<String(bv).toLowerCase()?-dir:String(av).toLowerCase()>String(bv).toLowerCase()?dir:0;});
  var html='<div class="page-header"><div class="page-title">Task Management</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
  if(CU.isAdmin) html+='<button class="btn primary" onclick="openTaskForm(null,false)">+ Add Task</button>';
  else if(isLead()) html+='<button class="btn primary" onclick="openTaskForm(null,true)">+ Add Task</button>';
  if(CU.isAdmin||isLead()){
    html+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text2)">'
      +'<div onclick="_taskShowInactive=!_taskShowInactive;renderTasks()" style="position:relative;width:34px;height:18px;border-radius:9px;background:'+(_taskShowInactive?'var(--blue)':'#cbd5e1')+';transition:background .2s;cursor:pointer;flex-shrink:0">'
      +'<div style="position:absolute;top:2px;left:'+(_taskShowInactive?'18px':'2px')+';width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div></div>'
      +'Show Inactive</label>';
  }
  html+='</div></div>';

  // Frequency filter tabs (admin + lead only)
  if(CU.isAdmin||isLead()){
    var allFreqKeys=['all','daily','weekly','monthly','quarterly','eom','occasional','other'];
    var freqLabels={all:'All',daily:'Daily',weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',eom:'End of Month',occasional:'Occasional',other:'Other'};
    // Count tasks per frequency for the badge numbers
    var allVisibleTasks=(D.tasks||[]).concat(CU.isAdmin?(D.leadTasks||[]):(D.leadTasks||[]).filter(function(t){return t._leadOwner===CU.username;}));
    var freqCounts={all:allVisibleTasks.filter(function(t){return _taskShowInactive||!t.inactive;}).length};
    allFreqKeys.slice(1).forEach(function(k){
      freqCounts[k]=allVisibleTasks.filter(function(t){return t.freq===k&&(_taskShowInactive||!t.inactive);}).length;
    });
    html+='<div class="task-freq-tabs">';
    allFreqKeys.forEach(function(k){
      var cnt=freqCounts[k]||0;
      if(k!=='all'&&cnt===0)return; // hide empty freq tabs except All
      var isActive=_taskFreqFilter===k;
      html+='<button class="task-freq-tab'+(isActive?' active':'')+'" onclick="_taskFreqFilter=\''+k+'\';renderTasks()">'
        +freqLabels[k]
        +(cnt>0?'<span style="margin-left:5px;font-size:10px;opacity:'+(isActive?'0.85':'0.6')+'">'+cnt+'</span>':'')
      +'</button>';
    });
    html+='</div>';
  }

  // Section 1: Department-Wide Tasks (admin-created)
  // Leads only see department-wide tasks they are individually assigned to
  var adminTasks=(D.tasks||[]).filter(function(t){
    var passInactive=_taskShowInactive||!t.inactive;
    var passFreq=_taskFreqFilter==='all'||t.freq===_taskFreqFilter;
    var passAssign=CU.isAdmin||(t.assignees||[]).includes(CU.username);
    return passInactive&&passFreq&&passAssign;
  });
  if(adminTasks.length){
    html+='<div class="section-hdr sh-gray" style="margin-bottom:8px">🏢 Department-Wide Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">'+(isLead()?'(assigned by admin — view only)':'')+'</span></div>';
    Object.entries(groups).forEach(function(entry){
      var freq=entry[0],label=entry[1];
      var list=adminTasks.filter(function(t){return t.freq===freq;});
      if(!list.length)return;
      html+='<div class="section-hdr sh-blue" style="margin-left:0">'+label+' <span style="opacity:.7">('+list.length+')</span></div>';
      html+=tblWrap5(tHead5()+'<tbody>'+list.map(taskRow).join('')+'</tbody>');
    });
  }
  if(isLead()){
    var myLeadTasks=(D.leadTasks||[]).filter(function(t){return t._leadOwner===CU.username&&(_taskShowInactive||!t.inactive)&&(_taskFreqFilter==='all'||t.freq===_taskFreqFilter);});
    html+='<div class="section-hdr sh-purple" style="margin-top:12px">👥 My Lead Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(visible to your assigned members)</span></div>';
    if(!myLeadTasks.length){
      html+='<div class="empty-state" style="padding:20px">No tasks created yet. Click "+ Add Task" to create one for your team.</div>';
    } else {
      Object.entries(groups).forEach(function(entry){
        var freq=entry[0],label=entry[1];
        var list=myLeadTasks.filter(function(t){return t.freq===freq;});
        if(!list.length)return;
        html+='<div class="section-hdr sh-blue">'+label+' <span style="opacity:.7">('+list.length+')</span></div>';
        html+=tblWrap5(tHead5()+'<tbody>'+list.map(taskRow).join('')+'</tbody>');
      });
    }
  }

  // Admin: show ALL lead tasks grouped by lead owner
  if(CU.isAdmin){
    const allLeadTasks=(D.leadTasks||[]).filter(function(t){return(_taskShowInactive||!t.inactive)&&(_taskFreqFilter==='all'||t.freq===_taskFreqFilter);});
    if(allLeadTasks.length){
      // Group by lead owner
      const byLead={};
      allLeadTasks.forEach(function(t){
        const owner=t._leadOwner||'unknown';
        if(!byLead[owner])byLead[owner]=[];
        byLead[owner].push(t);
      });
      html+='<div class="section-hdr sh-purple" style="margin-top:12px">👥 Lead-Created Tasks <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(created by leads for their teams)</span></div>';
      Object.entries(byLead).forEach(function([ownerUN,tasks]){
        const ownerName=getMN(ownerUN);
        html+='<div style="font-size:12px;font-weight:700;color:var(--text2);padding:6px 4px 4px;margin-top:6px">'+ownerName+'<span style="font-size:10px;font-weight:400;color:var(--text3);margin-left:6px">('+tasks.length+' task'+(tasks.length!==1?'s':'')+')</span></div>';
        Object.entries(groups).forEach(function(entry){
          var freq=entry[0],label=entry[1];
          var list=tasks.filter(function(t){return t.freq===freq;});
          if(!list.length)return;
          html+='<div class="section-hdr sh-blue" style="margin-left:0;font-size:10px">'+label+' <span style="opacity:.7">('+list.length+')</span></div>';
          html+=tblWrap5L(tHead5Lead()+'<tbody>'+list.map(function(t){
            var mAv=(t.assignees||[]).slice(0,5).map(function(u){return'<span class="av" title="'+getMN(u)+'" style="width:20px;height:20px;font-size:8px;margin-right:2px">'+ini(getMN(u))+'</span>';}).join('');
            var isInactive=!!(t.inactive);
            var inactiveBadge=isInactive?'<span style="font-size:9px;background:#f1f5f9;color:#6b7280;padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px;border:1px solid #e2e6ea">INACTIVE</span>':'';
            var govBadge=t._escalatedToAdmin?'<span style="font-size:9px;background:var(--orange-light);color:var(--orange);padding:1px 6px;border-radius:20px;font-weight:700;margin-left:4px">⚠ Escalated</span>':'';
            // Build actions — only show if current user owns this lead task
            var rowActions='';
            if(canEditTask(t)){
              var activeToggleLabel=isInactive?'✅ Active':'⏸ Inactive';
              var activeToggleClass=isInactive?'btn sm approve':'btn sm';
              rowActions='<button class="'+activeToggleClass+'" onclick="toggleTaskActive('+JSON.stringify(t.id)+',true,'+isInactive+')" style="margin-right:3px;font-size:11px">'+activeToggleLabel+'</button>'
                +'<button class="btn sm edit" onclick="openTaskForm('+JSON.stringify(t.id)+',true)" style="margin-right:3px">Edit</button>';
              if(canDeleteTask(t)) rowActions+='<button class="btn sm del" onclick="delTask('+JSON.stringify(t.id)+',true)">Delete</button>';
            }
            return'<tr style="'+(isInactive?'opacity:0.5;background:#fafafa':'')+'">'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle"><div style="font-weight:600">'+t.title+inactiveBadge+govBadge+'</div>'+(t.note?'<div style="font-size:11px;color:var(--text3)">'+t.note+'</div>':'')+taskWindowLabel(t)+'</td>'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;font-size:12px;color:var(--text3)">'+ownerName+'</td>'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:center"><span class="freq-chip fc-'+t.freq+'">'+schedLabel(t)+'</span></td>'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:center"><span class="dl-chip">'+(t.deadline||'—')+'</span></td>'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle">'+mAv+((t.assignees||[]).length>5?'<span style="font-size:11px;color:var(--text3)">+'+(t.assignees.length-5)+'</span>':'')+(!(t.assignees||[]).length?'<span style="color:var(--text4);font-size:12px">None</span>':'')+'</td>'
              +'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:middle;text-align:right;white-space:nowrap">'+rowActions+'</td>'
            +'</tr>';
          }).join('')+'</tbody>');
        });
      });
    }
  }

  el.innerHTML=html;
}


// ── TASK FORM ──
// _editIsLeadTask tracks whether we're editing a lead-owned task
var _editIsLeadTask=false;
var _taskShowInactive=true; // Show inactive tasks by default (admin can hide them)
var _taskFreqFilter='all'; // Frequency filter for admin Tasks tab: 'all' | freq key
function openTaskForm(taskId,isLeadTask){
  _editTId=taskId;
  _editIsLeadTask=!CU.isAdmin&&!!(isLeadTask||false);
  var t=null;
  if(taskId){
    if(_editIsLeadTask){
      t=(D.leadTasks||[]).find(function(x){return x.id==taskId&&x._leadOwner===CU.username;})||null;
    } else {
      t=D.tasks.find(function(x){return x.id==taskId;})||null;
    }
  }
  _selM=t?[...(t.assignees||[])]:[];
  document.getElementById('mt-title').textContent=t?'Edit Task':'Add Task';
  const dOpts=DOWF.map((d,i)=>`<option value="${i}"${t?.dow==i?' selected':''}>${d}</option>`).join('');
  const allGroups=[...(D.groups||[]),...(D.leadGroups||[]).map(g=>({...g,_leadOwned:true}))]; const groupOpts=allGroups.map(g=>`<option value="${g._leadOwned?'lead_'+g._key:g._key}">${g.name}${g._leadOwned?(CU.isAdmin?' ('+getMN(g._leadOwner||'')+'\'s group)':' (my group)'):''} (${(g.members||[]).length})</option>`).join('');
  document.getElementById('mt-body').innerHTML=`
    <div class="fg fg2">
      <div><label class="flabel">Task Name</label><input class="finput nb" id="ft-title" value="${t?t.title:''}"/></div>
      <div><label class="flabel">Frequency</label><select class="finput nb" id="ft-freq" onchange="ftToggle()">
        <option value="daily"${(!t||t.freq==='daily')?' selected':''}>Daily</option>
        <option value="weekly"${t?.freq==='weekly'?' selected':''}>Weekly</option>
        <option value="monthly"${t?.freq==='monthly'?' selected':''}>Monthly</option>
        <option value="quarterly"${t?.freq==='quarterly'?' selected':''}>Quarterly</option>
        <option value="eom"${t?.freq==='eom'?' selected':''}>End of Month</option>
        <option value="occasional"${t?.freq==='occasional'?' selected':''}>Occasional</option>
        <option value="other"${t?.freq==='other'?' selected':''}>Other</option>
      </select></div>
    </div>
    <div class="fg fg2">
      <div id="ft-dow-g" style="display:none"><label class="flabel">Day of Week</label><select class="finput nb" id="ft-dow">${dOpts}</select></div>
      <div id="ft-dom-g" style="display:none"><label class="flabel">Day of Month</label><input class="finput nb" id="ft-dom" type="number" min="1" max="28" value="${t?.dayOfMonth||1}"/></div>
    </div>
    <div class="fg" style="background:var(--surface2,#f8fafc);border-radius:var(--radius);padding:10px 12px;border:1px solid var(--border);margin-bottom:10px">
      <div style="font-size:11px;color:var(--text3)">Leave dates blank for an <b>ongoing</b> task with no start/end window. Set them to control exactly when this task starts appearing on assignees' dashboards, and when it stops.</div>
      <div id="ft-datefence-note" style="display:${t?.freq==='weekly'?'':'none'};font-size:11px;color:var(--orange,#b45309);margin-top:4px">⚠ Not currently applied to Weekly tasks — they'll keep recurring every week regardless of these dates.</div>
    </div>
    <div class="fg fg4">
      <div><label class="flabel">Start Date <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="ft-startdate" type="date" value="${t?.startDate||''}"/></div>
      <div><label class="flabel">Start Time <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="ft-starttime" type="time" value="${t?.startTime||''}"/></div>
      <div><label class="flabel">End Date <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="ft-enddate" type="date" value="${t?.endDate||''}"/></div>
      <div><label class="flabel">End Time <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="ft-endtime" type="time" value="${t?.endTime||''}"/></div>
    </div>
    <div class="fg"><label class="flabel">Deadline Label <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">(shown on dashboard — e.g. "Every Tuesday 5:00 PM" or "5:00 PM")</span></label><input class="finput nb" id="ft-deadline" placeholder="e.g. 5:00 PM" value="${t?.deadline||''}"/></div>
    <div class="fg"><label class="flabel">Notes</label><textarea class="finput" id="ft-note">${t?.note||''}</textarea></div>
    <div class="fg" style="background:var(--blue-light);border-radius:var(--radius);padding:12px;border:1px solid var(--blue-mid)">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="ft-ao-link" style="width:16px;height:16px;cursor:pointer" ${t?.aoLinked?'checked':''} onchange="document.getElementById('ft-ao-hint').style.display=this.checked?'':'none'"/>
        <div>
          <label class="flabel" for="ft-ao-link" style="cursor:pointer;color:var(--blue);margin-bottom:0">Link to AO Live Tracker</label>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">Member status will be driven by their input in the linked AO tracker — no manual status update needed</div>
        </div>
      </div>
      <div id="ft-ao-hint" style="margin-top:8px;font-size:11px;color:var(--text2);background:var(--surface);border-radius:var(--radius);padding:8px;display:${t?.aoLinked?'':'none'}">
        ✓ When members fill in their rows in the Live Tracker today, their task status auto-updates to <b>Done</b>. Make sure a tracker is linked to the Dashboard in Live Trackers.
      </div>
    </div>
    <div class="fg" style="background:var(--blue-light);border-radius:var(--radius);padding:12px;border:1px solid var(--blue-mid)">
      <div style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="ft-fr-link" style="width:16px;height:16px;cursor:pointer" ${t?.frLinked?'checked':''} onchange="document.getElementById('ft-fr-hint').style.display=this.checked?'':'none'"/>
        <div>
          <label class="flabel" for="ft-fr-link" style="cursor:pointer;color:var(--blue);margin-bottom:0">Link to Finance Report Live Tracker</label>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">Progress is pulled directly from the linked Finance Report tracker — the completion rate reflects how many brand rows have been filled in, no manual status update needed</div>
        </div>
      </div>
      <div id="ft-fr-hint" style="margin-top:8px;font-size:11px;color:var(--text2);background:var(--surface);border-radius:var(--radius);padding:8px;display:${t?.frLinked?'':'none'}">
        ✓ Completion is read live from the Finance Report tracker sheets (all platforms this task covers). For a <b>Monthly</b> task the monthly column is used; otherwise the current weekly column. Make sure a Finance tracker is linked in Live Trackers.
      </div>
    </div>
    ${allGroups.length?`<div class="fg"><label class="flabel">Quick-add Group</label><select class="finput nb" onchange="applyGroup(this.value);this.value=''"><option value="">— Select group to add members —</option>${groupOpts}</select></div>`:''}
    <div>
      <label class="flabel">Assign Members &nbsp;<span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">${D.members.filter(m=>m.approved&&m.active!==false).length} available</span></label>
      <div class="mselect-wrap" id="ft-chips" onclick="document.getElementById('ft-ms').focus()"></div>
      <input class="finput" id="ft-ms" placeholder="Search by name or username..." style="margin-top:6px;margin-bottom:4px" oninput="ftFilt()" onfocus="document.getElementById('ft-mdrop').style.display=''"/>
      <div style="display:flex;gap:6px;margin-bottom:6px"><button class="btn sm" onclick="ftSelAll()">Select All</button><button class="btn sm" onclick="ftClrAll()">Clear All</button></div>
      <div class="mdrop" id="ft-mdrop" style="display:none"></div>
    </div>
    <div class="form-actions"><button class="btn primary" onclick="saveTask()">${t?'Save Changes':'Add Task'}</button><button class="btn" onclick="closeModal('modal-task')">Cancel</button></div>`;
  ftChips();ftFilt();ftToggle();openModal('modal-task');
}
function applyGroup(key){if(!key)return;let g;if(key.startsWith('lead_')){g=(D.leadGroups||[]).find(x=>x._key===key.slice(5));}else{g=D.groups.find(x=>x._key===key);}if(!g)return;(g.members||[]).forEach(u=>{if(!_selM.includes(u))_selM.push(u);});ftChips();ftFilt();toast(`Added ${(g.members||[]).length} from "${g.name}"`)}
function ftToggle(){const f=document.getElementById('ft-freq')?.value;document.getElementById('ft-dow-g').style.display=f==='weekly'?'':'none';document.getElementById('ft-dom-g').style.display=f==='monthly'?'':'none';const note=document.getElementById('ft-datefence-note');if(note)note.style.display=f==='weekly'?'':'none';}
function ftChips(){const e=document.getElementById('ft-chips');if(!e)return;e.innerHTML=_selM.map(u=>`<span class="m-chip"><span class="av" style="width:17px;height:17px;font-size:7px">${ini(getMN(u))}</span>${getMN(u)}<span class="rm" onclick="ftRemM('${u}')">&#x2715;</span></span>`).join('');}
function ftRemM(u){_selM=_selM.filter(x=>x!==u);ftChips();ftFilt();}
function ftFilt(){
  const q=(document.getElementById('ft-ms')?.value||'').toLowerCase(),drop=document.getElementById('ft-mdrop');if(!drop)return;
  const f=D.members.filter(m=>m.approved&&(m.name.toLowerCase().includes(q)||m.username.toLowerCase().includes(q)));
  drop.innerHTML=f.length?f.map(m=>`<div class="mdrop-item${_selM.includes(m.username)?' sel':''}" onclick="ftTogM('${m.username}')"><span class="av" style="width:20px;height:20px;font-size:8px">${ini(m.name)}</span><span style="flex:1">${m.name}</span><span style="font-size:11px;color:var(--text3)">${m.role||'Member'}</span>${_selM.includes(m.username)?'<span style="color:var(--blue)">&#10003;</span>':''}</div>`).join(''):'<div class="mdrop-item" style="color:var(--text4)">No members found</div>';
  drop.style.display='';
}
function ftTogM(u){if(_selM.includes(u))_selM=_selM.filter(x=>x!==u);else _selM.push(u);ftChips();ftFilt();}
function ftSelAll(){_selM=D.members.filter(m=>m.approved&&m.active!==false).map(m=>m.username);ftChips();ftFilt();}
function ftClrAll(){_selM=[];ftChips();ftFilt();}
async function saveTask(){
  var title=document.getElementById('ft-title')?.value.trim();if(!title){toast('Task name required');return;}
  var freq=document.getElementById('ft-freq')?.value;
  var dow=freq==='weekly'?parseInt(document.getElementById('ft-dow')?.value):null;
  var dayOfMonth=freq==='monthly'?parseInt(document.getElementById('ft-dom')?.value||1):null;
  var endTimeRaw=document.getElementById('ft-endtime')?.value.trim()||'';
  var startTimeRaw=document.getElementById('ft-starttime')?.value.trim()||'';
  var startDateRaw=document.getElementById('ft-startdate')?.value.trim()||'';
  var endDateRaw=document.getElementById('ft-enddate')?.value.trim()||'';
  if(startDateRaw&&endDateRaw&&endDateRaw<startDateRaw){toast('End Date cannot be before Start Date');return;}
  var dhVal=17,dmVal=0;
  if(endTimeRaw){var etParts=endTimeRaw.split(':');dhVal=parseInt(etParts[0]||17);dmVal=parseInt(etParts[1]||0);}
  // Due Time is no longer a separate field — derive the 12-hour label used for the
  // auto-generated deadline text from the End Time (falls back to 5:00 PM if unset).
  var to12h=function(hhmm){if(!hhmm)return'';var p=hhmm.split(':');var hr=parseInt(p[0]||0),mn=parseInt(p[1]||0);var ap=hr>=12?'PM':'AM';var hr12=hr%12||12;return hr12+':'+(mn<10?'0'+mn:mn)+' '+ap;};
  var dueTime=to12h(endTimeRaw)||'5:00 PM';
  // Read the deadline label; if left blank, auto-generate a sensible one
  var deadlineRaw=(document.getElementById('ft-deadline')?.value||'').trim();
  var deadline=deadlineRaw;
  if(!deadline){
    if(freq==='daily') deadline=dueTime;
    else if(freq==='weekly'&&dow!=null) deadline='Every '+DOWF[dow]+' '+dueTime;
    else if(freq==='monthly'&&dayOfMonth!=null) deadline=(dayOfMonth)+'th of month · '+dueTime;
    else if(freq==='quarterly') deadline='1st of quarter · '+dueTime;
    else if(freq==='eom') deadline='Last day of month · '+dueTime;
    else if((freq==='other'||freq==='occasional')&&endDateRaw){
      // Anchor the auto-label to the real End Date (the actual deadline instant used by
      // isOverdue) rather than just the time, so the visible label can't drift from what's
      // actually enforced.
      var p=endDateRaw.split('-'),edLabel=new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      deadline=edLabel+' · '+dueTime;
    }
    else deadline=dueTime;
  }
  var data={title,freq,dow:dow!=null?dow:null,dayOfMonth:dayOfMonth!=null?dayOfMonth:null,
    time:dueTime,
    deadline:deadline,
    startDate:startDateRaw,
    startTime:startTimeRaw,
    endDate:endDateRaw,
    endTime:endTimeRaw,
    dh:dhVal,
    dm:dmVal,
    note:document.getElementById('ft-note')?.value.trim()||'',
    assignees:[..._selM],
    aoLinked:!!(document.getElementById('ft-ao-link')?.checked),
    frLinked:!!(document.getElementById('ft-fr-link')?.checked)};
  // For an FR-linked task, remember whether it should read the monthly column.
  // Monthly/EOM frequencies read the tracker's monthly column; any other cadence
  // reads the current weekly column (same logic frTaskIsMonthly already applies).
  if(data.frLinked)data.frMonthly=(freq==='monthly'||freq==='eom');
  var isLT=!CU.isAdmin&&(_editIsLeadTask||(isLead()&&!_editTId)); // new tasks from leads go to leadTasks; admin always uses tasks/
  if(isLT){
    // Lead-owned task path
    var basePath='leadTasks/'+CU.username;
    if(_editTId){
      data.id=_editTId;
      await fbSet(basePath+'/'+_editTId,data);
      toast('Task updated');
    } else {
      var ltNextKey='leadTaskNextId_'+CU.username;
      var nid=(await fbGet(ltNextKey))||1000;
      data.id=nid;
      await fbSet(basePath+'/'+nid,data);
      await fbSet(ltNextKey,nid+1);
      toast('Task added — your team members can now see it in their Dashboard');
    }
  } else {
    // Admin task path
    if(_editTId){data.id=_editTId;await fbSet('tasks/'+_editTId,data);toast('Task updated');}
    else{var nid2=(await fbGet('taskNextId'))||10;data.id=nid2;await fbSet('tasks/'+nid2,data);await fbSet('taskNextId',nid2+1);await logAct(nid2,ds(now()),CU.name,'Task Added','TASK_ADDED');toast('Task added');}
  }
  closeModal('modal-task');
}
async function delTask(id,isLeadTask){
  if(!confirm('Delete this task?'))return;
  if(isLeadTask){
    await fbDel('leadTasks/'+CU.username+'/'+id);
  } else {
    await fbDel('tasks/'+id);
  }
  toast('Task deleted');
}

// ── PERSONAL TASKS ──
function openPersonalTaskForm(key){
  var t=key?(D.personalTasks||[]).find(function(x){return x._key===key;}):null;
  document.getElementById('mpt-title').textContent=t?'Edit Personal Task':'Add Personal Task';
  document.getElementById('mpt-body').innerHTML=`
    <div class="fg"><label class="flabel">Task Title</label><input class="finput nb" id="pt-title" value="${t?escHtml(t.title):''}"/></div>
    <div class="fg"><label class="flabel">Note (optional)</label><textarea class="finput" id="pt-note" rows="2" placeholder="Any details...">${t?escHtml(t.note||''):''}</textarea></div>
    <div class="fg fg2">
      <div><label class="flabel">Frequency</label><select class="finput nb" id="pt-freq" onchange="ptToggleFreq()">
        <option value="daily"${(!t||t.freq==='daily')?' selected':''}>Daily</option>
        <option value="weekly"${t?.freq==='weekly'?' selected':''}>Weekly</option>
        <option value="monthly"${t?.freq==='monthly'?' selected':''}>Monthly</option>
        <option value="occasional"${t?.freq==='occasional'?' selected':''}>Occasional</option>
        <option value="other"${t?.freq==='other'?' selected':''}>Other / One-time</option>
      </select></div>
      <div><label class="flabel">Status</label><select class="finput nb" id="pt-status">
        <option${(!t||t.status==='Pending')?' selected':''}>Pending</option>
        <option${t?.status==='Done'?' selected':''}>Done</option>
      </select></div>
    </div>
    <div class="fg fg4">
      <div id="pt-dow-g" style="display:none"><label class="flabel">Day of Week</label><select class="finput nb" id="pt-dow">${DOWF.map((d,i)=>`<option value="${i}"${t?.dow==i?' selected':''}>${d}</option>`).join('')}</select></div>
      <div id="pt-dom-g" style="display:none"><label class="flabel">Day of Month</label><input class="finput nb" id="pt-dom" type="number" min="1" max="28" value="${t?.dayOfMonth||1}"/></div>
      <div><label class="flabel">Due Time</label><input class="finput nb" id="pt-time" value="${t?.time||'5:00 PM'}"/></div>
      <div><label class="flabel">Start Time <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="pt-starttime" type="time" value="${t?.startTime||''}"/></div>
      <div><label class="flabel">End Time <span style="font-weight:400;color:var(--text3)">(optional)</span></label><input class="finput nb" id="pt-endtime" type="time" value="${t?.endTime||''}" onchange="ptSyncEndTime()"/></div>
    </div>
    <div class="form-actions">
      <button class="btn primary" onclick="savePersonalTask(${key?`'${key}'`:'null'})">${t?'Save Changes':'Add Task'}</button>
      <button class="btn" onclick="closeModal('modal-personal-task')">Cancel</button>
    </div>`;
  ptToggleFreq();
  openModal('modal-personal-task');
}

function ptToggleFreq(){
  const f=document.getElementById('pt-freq')?.value;
  const dowG=document.getElementById('pt-dow-g');
  const domG=document.getElementById('pt-dom-g');
  if(dowG)dowG.style.display=f==='weekly'?'':'none';
  if(domG)domG.style.display=f==='monthly'?'':'none';
}
function ptSyncEndTime(){const et=document.getElementById('pt-endtime')?.value;const ti=document.getElementById('pt-time');if(et&&ti){const[h,m]=et.split(':');const hr=parseInt(h),mn=parseInt(m);const ap=hr>=12?'PM':'AM';const hr12=hr%12||12;ti.value=hr12+':'+(mn<10?'0'+mn:mn)+' '+ap;}}

async function savePersonalTask(key){
  var title=document.getElementById('pt-title')?.value.trim();
  if(!title){toast('Task title required');return;}
  var freq=document.getElementById('pt-freq')?.value||'other';
  var dow=freq==='weekly'?parseInt(document.getElementById('pt-dow')?.value||0):null;
  var dayOfMonth=freq==='monthly'?parseInt(document.getElementById('pt-dom')?.value||1):null;
  var ptEndTimeRaw=document.getElementById('pt-endtime')?.value.trim()||'';
  var ptDh=17,ptDm=0;
  if(ptEndTimeRaw){var ptEtP=ptEndTimeRaw.split(':');ptDh=parseInt(ptEtP[0]||17);ptDm=parseInt(ptEtP[1]||0);}
  var data={
    title,
    note:document.getElementById('pt-note')?.value.trim()||'',
    status:document.getElementById('pt-status')?.value||'Pending',
    freq,
    dow:dow!=null?dow:undefined,
    dayOfMonth:dayOfMonth!=null?dayOfMonth:undefined,
    time:document.getElementById('pt-time')?.value.trim()||'5:00 PM',
    deadline:'',
    startTime:document.getElementById('pt-starttime')?.value.trim()||'',
    endTime:ptEndTimeRaw,
    dh:ptDh,
    dm:ptDm,
    updatedAt:Date.now()
  };
  if(key){
    await fbUpd('personalTasks/'+CU.username+'/'+key,data);
    toast('Task updated');
  } else {
    data.createdAt=Date.now();
    await fbPush('personalTasks/'+CU.username,data);
    toast('Personal task added!');
  }
  closeModal('modal-personal-task');
}

async function updatePersonalTaskStatus(key,status){
  await fbUpd('personalTasks/'+CU.username+'/'+key,{status,updatedAt:Date.now()});
  toast('Status updated');
}

async function deletePersonalTask(key){
  if(!confirm('Delete this personal task?'))return;
  await fbDel('personalTasks/'+CU.username+'/'+key);
  toast('Task deleted');
}

async function toggleTaskActive(id,isLeadTask,currentlyInactive){
  // currentlyInactive = true means task IS inactive → clicking makes it active (inactive:false)
  // currentlyInactive = false means task IS active → clicking makes it inactive (inactive:true)
  const newInactive=!currentlyInactive;
  if(isLeadTask){
    await fbUpd('leadTasks/'+CU.username+'/'+id,{inactive:newInactive});
  } else {
    await fbUpd('tasks/'+id,{inactive:newInactive});
  }
  toast(newInactive?'Task set to inactive':'Task reactivated');
}

// ── STATUS MODAL ──
function openStatusModal(taskId,date){
  const task=(D.tasks.find(t=>t.id==taskId))||(D.leadTasks||[]).find(t=>t.id==taskId);if(!task)return;
  document.getElementById('mst-title').textContent=task.title;
  const info=D.statuses[sKey(taskId,date)]||{};
  const ms=task.assignees||[];
  const ov=isOverdue(task,date)&&computeTaskOverall(taskId,date)!=='Done';
  let body=ov?`<div class="esc-banner" style="margin-bottom:12px"><span>⚠️</span><div style="font-size:13px;font-weight:700;color:var(--orange)">Past deadline — ${task.deadline}</div></div>`:'';
  const extApproved=Object.values(D.extRequests).find(r=>r.taskId==taskId&&r.date===date&&r.status==='Approved');
  if(extApproved){body+=`<div class="ne-box" style="margin-bottom:12px"><div style="font-weight:700;color:var(--teal);font-size:13px">&#10003; Extension Approved</div><div style="font-size:12px">New deadline: ${extApproved.proposedDate} ${extApproved.proposedTime}</div></div>`;}
  if(ms.length){
    body+=`<div style="font-size:12px;color:var(--text3);margin-bottom:10px">Per-member — <b>${fmtD(new Date(date+'T00:00:00'))}</b></div>`;
    body+=`<div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Status</th></tr></thead><tbody>`;
    ms.forEach(u=>{
      const mst=getMemberStatus(taskId,date,u),can=CU.isAdmin||u===CU.username,name=getMN(u),role=getRole(u);
      body+=`<tr><td><div style="display:flex;align-items:center;gap:6px"><span class="av" style="width:22px;height:22px;font-size:8px">${ini(name)}</span>${name}</div></td>
        <td><span style="font-size:11px;color:var(--text3)">${role}</span></td>
        <td>${can?`<select class="finput nb" style="padding:4px 7px;font-size:12px;width:auto" onchange="smMember(${taskId},'${date}','${u}',this.value)">
          <option${mst==='Pending'?' selected':''}>Pending</option><option${mst==='Ongoing'?' selected':''}>Ongoing</option>
          <option${mst==='Needs Extension'?' selected':''}>Needs Extension</option><option${mst==='Done'?' selected':''}>Done</option>
        </select>`:`<span class="sbadge ${sbc(mst)}" style="cursor:default"><span class="sdot ${sdc(mst)}"></span>${mst}</span>`}</td>
      </tr>`;
    });
    body+='</tbody></table></div>';
    const rate=taskCompletionRate(taskId,date);
    body+=`<div style="margin:10px 0 4px;font-size:12px;color:var(--text3)">Overall completion: <b>${rate.done}/${rate.total} done (${rate.pct}%)</b></div>${rateBarHtml(rate.pct)}`;
  }
  if(CU.isAdmin||isLead()){
    body+=`<div class="form-actions" style="margin-top:14px"><button class="btn success" onclick="markAllDone(${taskId},'${date}')">Mark All Done</button><button class="btn" onclick="closeModal('modal-status')">Close</button></div>`;
  } else {
    body+=`<div class="form-actions"><button class="btn" onclick="closeModal('modal-status')">Close</button></div>`;
  }
  document.getElementById('mst-body').innerHTML=body;openModal('modal-status');
}

async function smMember(tid,date,u,val){
  if(val==='Needs Extension'&&!CU.isAdmin){
    document.getElementById('mne-body').innerHTML=`
      <p style="font-size:13px;color:var(--text3);margin-bottom:12px">Provide a reason and proposed new deadline for admin review.</p>
      <div class="fg"><label class="flabel">Reason</label><textarea class="finput" id="ne-reason" rows="3" placeholder="Why do you need more time?"></textarea></div>
      <div class="fg fg2">
        <div><label class="flabel">Proposed Date</label><input class="finput nb" id="ne-date" type="date" value="${date}"/></div>
        <div><label class="flabel">Proposed Time</label><input class="finput nb" id="ne-time" placeholder="e.g. 7:00 PM"/></div>
      </div>
      <div class="form-actions"><button class="btn teal" onclick="submitExtRequest(${tid},'${date}','${u}')">Submit Request</button><button class="btn" onclick="closeModal('modal-ne')">Cancel</button></div>`;
    openModal('modal-ne');return;
  }
  const k=sKey(tid,date);
  const cur=D.statuses[k]||{};
  const mems={...(cur.members||{}),[u]:val};
  // Recompute overall from fresh member map
  const task=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid);
  const vals=(task?.assignees||[]).map(x=>mems[x]||'Pending');
  let overall='Pending';
  if(vals.every(v=>v==='Done'))overall='Done';
  else if(vals.some(v=>v==='Ongoing'||v==='Done'))overall='Ongoing';
  else if(vals.some(v=>v==='Needs Extension'))overall='Needs Extension';
  await fbUpd(`statuses/${k}`,{members:mems,overall});
  await logAct(tid,date,getMN(u),val,'');
  toast('Status updated');
  // Refresh modal
  openStatusModal(tid,date);
}

// Quick-access entry point for a "Request Extension" button on the Tasks page —
// opens the same center popup used from the status modal, pre-filled for today's occurrence.
function openExtRequestModal(tid,date){
  const task=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid);if(!task)return;
  const myStat=getMemberStatus(tid,date,CU.username);
  if(myStat==='Done'){toast('This task is already marked Done — no extension needed');return;}
  const existing=Object.values(D.extRequests||{}).find(function(r){return r.taskId==tid&&r.date===date&&r.memberUsername===CU.username&&r.status==='Pending';});
  if(existing){toast('You already have a pending extension request for this task');return;}
  // Extensions must be requested ON OR BEFORE the deadline. Once the deadline has passed
  // the task is auto-flagged as non-compliance, so a late request cannot undo it.
  if(isOverdue(task,date)){
    toast('Deadline has already passed — extensions must be requested before the deadline. This is now auto-flagged as non-compliance.');
    return;
  }
  document.getElementById('mne-body').innerHTML=`
    <p style="font-size:13px;font-weight:600;margin-bottom:2px">${task.title}</p>
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px">Current deadline: ${task.deadline||'—'}</p>
    <p style="font-size:13px;color:var(--text3);margin-bottom:12px">Provide a reason and proposed new deadline for admin review.</p>
    <div class="fg"><label class="flabel">Reason</label><textarea class="finput" id="ne-reason" rows="3" placeholder="Why do you need more time?"></textarea></div>
    <div class="fg fg2">
      <div><label class="flabel">Proposed Date</label><input class="finput nb" id="ne-date" type="date" value="${date}"/></div>
      <div><label class="flabel">Proposed Time</label><input class="finput nb" id="ne-time" placeholder="e.g. 7:00 PM"/></div>
    </div>
    <div class="form-actions"><button class="btn teal" onclick="submitExtRequest(${tid},'${date}','${CU.username}')">Submit Request</button><button class="btn" onclick="closeModal('modal-ne')">Cancel</button></div>`;
  openModal('modal-ne');
}

async function submitExtRequest(tid,date,u){
  const reason=document.getElementById('ne-reason')?.value.trim();if(!reason){toast('Reason required');return;}
  const task=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid)||{};
  // Enforce the before-deadline rule here too — this covers the status-modal entry point
  // and guards against the modal being left open until after the deadline passes.
  if(task.id&&isOverdue(task,date)){
    toast('Deadline has already passed — extensions must be requested before the deadline.');
    closeModal('modal-ne');
    return;
  }
  // The proposed new deadline must be in the future, otherwise the extension grants nothing.
  const _pd=document.getElementById('ne-date')?.value;
  const _pt=document.getElementById('ne-time')?.value.trim();
  if(!_pd){toast('Proposed date required');return;}
  const _hm=parseTimeStr(_pt);
  if(_pt&&!_hm){toast('Proposed time not recognised — use a format like 7:00 PM');return;}
  const _n=now();
  const _propose=new Date(_pd+'T00:00:00');
  _propose.setHours(_hm?_hm[0]:23,_hm?_hm[1]:59,0,0);
  if(_propose<=_n){toast('Proposed new deadline must be later than right now');return;}
  await fbPush('extRequests',{taskId:tid,taskTitle:task?.title||'',memberUsername:u,memberName:getMN(u),reason,proposedDate:_pd,proposedTime:_pt,date,status:'Pending',ts:Date.now()});
  const k=sKey(tid,date),cur=D.statuses[k]||{};
  const mems={...(cur.members||{}),[u]:'Needs Extension'};
  const task2=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid);
  const vals=(task2?.assignees||[]).map(x=>mems[x]||'Pending');
  let overall='Needs Extension';
  if(vals.every(v=>v==='Done'))overall='Done';
  else if(vals.some(v=>v==='Ongoing'||v==='Done'))overall='Ongoing';
  await fbUpd(`statuses/${k}`,{members:mems,overall});
  await logAct(tid,date,getMN(u),'Needs Extension','EXT_REQUESTED');
  closeModal('modal-ne');closeModal('modal-status');
  toast('Extension request submitted!');
}

async function markAllDone(tid,date){
  const task=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid);if(!task)return;
  const mems={};(task.assignees||[]).forEach(u=>{mems[u]='Done';});
  await fbUpd(`statuses/${sKey(tid,date)}`,{members:mems,overall:'Done'});
  await logAct(tid,date,CU.name,'All Done','ADMIN');
  toast('All marked as Done');openStatusModal(tid,date);
}
async function logAct(tid,date,who,status,note=''){
  const task=(D.tasks.find(t=>t.id==tid))||(D.leadTasks||[]).find(t=>t.id==tid)||{},n=now();
  await fbPush('actLog',{taskId:tid,title:task?.title||'',who,status,note,date,time:n.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),ts:n.getTime()});
}

// ── MEMBERS ──


function memToggleSel(username, checked){
  if(checked) _selectedMembers.add(username);
  else _selectedMembers.delete(username);
  memUpdateBulkBar();
}
function memToggleAll(checked){
  document.querySelectorAll('.mem-cb').forEach(cb=>{
    cb.checked=checked;
    if(checked) _selectedMembers.add(cb.dataset.username);
    else _selectedMembers.delete(cb.dataset.username);
  });
  memUpdateBulkBar();
}
function memClearAll(){
  _selectedMembers.clear();
  document.querySelectorAll('.mem-cb').forEach(cb=>cb.checked=false);
  const all=document.getElementById('mem-sel-all');
  if(all)all.checked=false;
  memUpdateBulkBar();
}
function memUpdateBulkBar(){
  const bar=document.getElementById('mem-bulk-bar');
  const count=document.getElementById('mem-sel-count');
  if(bar){bar.style.display=_selectedMembers.size>0?'flex':'none';}
  if(count)count.textContent=_selectedMembers.size+' selected';
}
function exportSelectedMembers(){
  if(!_selectedMembers.size){toast('No members selected.');return;}
  const sel=D.members.filter(m=>_selectedMembers.has(m.username));
  const rows=sel.map(function(m){
    return{
      'Name':m.name||'',
      'Username':m.username||'',
      'Role':m.role||'',
      'Region':m.region||'',
      'Reports To':m.reportsTo?getMN(m.reportsTo):'',
      'Buddy':m.buddy?getMN(m.buddy):'',
      'Working Hours':m.workingHours||'',
      'Status':m.active===false?'Inactive':'Active'
    };
  });
  const ws=XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:22},{wch:16},{wch:18},{wch:10},{wch:22},{wch:22},{wch:16},{wch:10}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Selected Members');
  XLSX.writeFile(wb,'Members_Selected_'+ds(now())+'.xlsx');
  toast('Exported '+rows.length+' member(s)!');
}
async function deleteSelectedMembers(){
  if(!_selectedMembers.size){toast('No members selected.');return;}
  if(!confirm('Permanently delete '+_selectedMembers.size+' member(s)? This cannot be undone.'))return;
  const mems=await fbGet('members')||{};
  let deleted=0;
  for(const[k,m]of Object.entries(mems)){
    if(m&&_selectedMembers.has(m.username)){
      await fbDel('members/'+k);
      deleted++;
    }
  }
  _selectedMembers.clear();
  toast('Deleted '+deleted+' member(s).');
}

let _membersShowInactive = false;
let _selectedMembers = new Set();

async function toggleMemberActive(username, currentlyActive){
  const mems = await fbGet('members') || {};
  for(const [k, m] of Object.entries(mems)){
    if(m && m.username === username){
      await fbUpd('members/' + k, {active: !currentlyActive});
      toast((!currentlyActive ? 'Member activated' : 'Member deactivated'));
      return;
    }
  }
}

function exportMembers(){
  const rows = D.members.map(function(m){
    return {
      'Name': m.name || '',
      'Username': m.username || '',
      'Role': m.role || '',
      'Region': m.region || '',
      'Reports To': m.reportsTo ? getMN(m.reportsTo) : '',
      'Buddy': m.buddy ? getMN(m.buddy) : '',
      'Working Hours': m.workingHours || '',
      'Status': m.active === false ? 'Inactive' : 'Active'
    };
  });
  if(!rows.length){ toast('No members to export.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:22},{wch:16},{wch:18},{wch:10},{wch:22},{wch:22},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');
  XLSX.writeFile(wb, 'Members_' + ds(now()) + '.xlsx');
  toast('Members exported!');
}

function renderMembers(){
  if(!CU.isAdmin&&!isLead()){document.getElementById('pg-members').innerHTML='<div class="empty-state" style="padding:60px"><div style="font-size:32px;margin-bottom:12px">🔒</div><div style="font-weight:700;font-size:16px;color:var(--text2)">Access Restricted</div></div>';return;}
  const ROLE_ORDER=['HOD','Manager','Assist. Manager','Team Lead','Executive','Talent on Demand'];
  const roleLabel=r=>r==='Talent on Demand'?'TOD':r||'Member';
  const roleBadgeStyle=r=>{
    if(r==='HOD')return'background:#fdf4ff;color:#7c3aed';
    if(r==='Manager')return'background:#eff6ff;color:#1d4ed8';
    if(r==='Assist. Manager')return'background:#ecfeff;color:#0891b2';
    if(r==='Team Lead')return'background:#f0fdf4;color:#15803d';
    if(r==='Talent on Demand')return'background:#fdf4ff;color:#9333ea';
    return'';
  };

  // Leads see admin-added members (read-only) + their own groups (stored under leadGroups/<username>/)
  if(isLead()){
    const memberList=D.members.filter(m=>m.active!==false&&m.approved);
    const grouped={};
    ROLE_ORDER.forEach(r=>grouped[r]=[]);
    memberList.forEach(m=>{const k=ROLE_ORDER.includes(m.role)?m.role:'Executive';if(!grouped[k])grouped[k]=[];grouped[k].push(m);});
    let rows='';
    ROLE_ORDER.forEach(role=>{
      const list=grouped[role]||[];
      if(!list.length)return;
      rows+=`<tr><td colspan="6" style="background:#f8fafc;padding:6px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border-bottom:1px solid var(--border)">${roleLabel(role)} (${list.length})</td></tr>`;
      rows+=list.map(m=>`<tr>
        <td><div style="display:flex;align-items:center;gap:7px"><span class="av" style="width:24px;height:24px;font-size:9px">${ini(m.name)}</span>${m.name}</div></td>
        <td style="color:var(--text3)">@${m.username}</td>
        <td><span class="role-badge" style="${roleBadgeStyle(m.role)}">${roleLabel(m.role)}</span></td>
        <td><span style="font-size:11px;font-weight:600;color:var(--blue)">${m.region||'—'}</span></td>
        <td style="font-size:12px;color:var(--text3)">${m.reportsTo?getMN(m.reportsTo):'—'}</td>
        <td style="font-size:12px;color:var(--text3)">${m.buddy?getMN(m.buddy):'—'}</td>
      </tr>`).join('');
    });
    // Lead-private groups — stored under leadGroups/<username>
    const myLeadGroups=D.leadGroups||[];
    const myGroupCards=myLeadGroups.map(g=>`<div class="group-card"><div style="flex:1"><div style="font-weight:700;font-size:13px;margin-bottom:4px">${g.name} <span style="font-size:10px;background:var(--purple-light);color:var(--purple);padding:1px 6px;border-radius:20px">My Group</span></div><div style="display:flex;flex-wrap:wrap;gap:4px">${(g.members||[]).slice(0,6).map(u=>`<span class="m-chip" style="font-size:11px"><span class="av" style="width:16px;height:16px;font-size:7px">${ini(getMN(u))}</span>${getMN(u)}</span>`).join('')}${(g.members||[]).length>6?`<span style="font-size:11px;color:var(--text3)">+${g.members.length-6} more</span>`:''}</div></div><div style="display:flex;gap:6px"><button class="btn sm edit" onclick="openLeadGroupForm('${g._key}')">Edit</button><button class="btn sm del" onclick="deleteLeadGroup('${g._key}')">Delete</button></div></div>`).join('');
    document.getElementById('pg-members').innerHTML=`
      <div class="page-header"><div class="page-title">Members (${memberList.length})</div><span style="font-size:12px;color:var(--text3);padding:6px 10px;background:var(--blue-light);border-radius:var(--radius)">View only — member management is admin-only</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Region</th><th>Reports To</th><th>Buddy</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" class="empty-state">No members yet</td></tr>'}</tbody></table></div>
      <div style="margin-top:20px">
        <div class="section-hdr sh-purple">My Groups <span style="font-size:11px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">(only visible to you)</span> <button class="btn sm primary" onclick="openLeadGroupForm(null)" style="float:right">+ New Group</button></div>
        ${myGroupCards||'<div class="empty-state" style="padding:20px">No groups yet. Create one to quickly assign members to tasks.</div>'}
      </div>`;
    return;
  }

  // ADMIN view (full management)
  const groupCards=D.groups.map(g=>`<div class="group-card"><div style="flex:1"><div style="font-weight:700;font-size:13px;margin-bottom:4px">${g.name}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${(g.members||[]).slice(0,6).map(u=>`<span class="m-chip" style="font-size:11px"><span class="av" style="width:16px;height:16px;font-size:7px">${ini(getMN(u))}</span>${getMN(u)}</span>`).join('')}${(g.members||[]).length>6?`<span style="font-size:11px;color:var(--text3)">+${g.members.length-6} more</span>`:''}</div></div><div style="display:flex;gap:6px"><button class="btn sm edit" onclick="openGroupForm('${g._key}')">Edit</button><button class="btn sm del" onclick="deleteGroup('${g._key}')">Delete</button></div></div>`).join('');
  if(!window._memSort)window._memSort={col:'name',dir:1};
  let memberList=D.members;
  if(!_membersShowInactive) memberList=memberList.filter(m=>m.active!==false&&m.approved);
  memberList=memberList.slice().sort(function(a,b){var col=_memSort.col,dir=_memSort.dir;var av=a[col]||'',bv=b[col]||'';return String(av).toLowerCase()<String(bv).toLowerCase()?-dir:String(av).toLowerCase()>String(bv).toLowerCase()?dir:0;});
  const grouped={};
  ROLE_ORDER.forEach(r=>grouped[r]=[]);
  memberList.forEach(m=>{const k=ROLE_ORDER.includes(m.role)?m.role:'Executive';if(!grouped[k])grouped[k]=[];grouped[k].push(m);});
  let rows='';
  ROLE_ORDER.forEach(role=>{
    const list=grouped[role]||[];
    if(!list.length)return;
    rows+=`<tr><td colspan="9" style="background:#f8fafc;padding:6px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border-bottom:1px solid var(--border)">${roleLabel(role)} (${list.length})</td></tr>`;
    rows+=list.map(m=>`<tr style="${m.active===false?'opacity:.5;background:#fafafa':''}">
      <td style="width:32px;text-align:center"><input type="checkbox" class="mem-cb" data-username="${m.username}" onchange="memToggleSel('${m.username}',this.checked)" style="cursor:pointer"/></td>
      <td><div style="display:flex;align-items:center;gap:7px"><span class="av" style="width:24px;height:24px;font-size:9px">${ini(m.name)}</span>${m.name}</div></td>
      <td style="color:var(--text3)">@${m.username}</td>
      <td><span class="role-badge" style="${roleBadgeStyle(m.role)}">${roleLabel(m.role)}</span></td>
      <td><span style="font-size:11px;font-weight:600;color:var(--blue)">${m.region||'—'}</span></td>
      <td style="font-size:12px;color:var(--text3)">${m.reportsTo?getMN(m.reportsTo):'—'}</td>
      <td style="font-size:12px;color:var(--text3)">${m.buddy?getMN(m.buddy):'—'}</td>
      <td>
        <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
          <div onclick="toggleMemberActive('${m.username}',${m.active!==false})" style="position:relative;width:34px;height:18px;border-radius:9px;background:${m.active!==false?'var(--green)':'#cbd5e1'};transition:background .2s;flex-shrink:0;cursor:pointer">
            <div style="position:absolute;top:2px;left:${m.active!==false?'18px':'2px'};width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${m.active!==false?'var(--green)':'var(--text4)'}">${m.active!==false?'Active':'Inactive'}</span>
        </label>
      </td>
      <td style="white-space:nowrap"><button class="btn sm edit" onclick="editMember('${m.username}')" style="margin-right:3px">Edit</button><button class="btn sm" onclick="resetMemberPassword('${m.username}')" style="margin-right:3px;background:var(--blue-light);color:var(--blue);border-color:var(--blue-mid)">🔑 Reset Password</button><button class="btn sm del" onclick="removeM('${m.username}')">Remove</button></td>
    </tr>`).join('');
  });

  document.getElementById('pg-members').innerHTML=`
    <div class="page-header">
      <div class="page-title">Members (${memberList.length})</div>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text2)">
          <div onclick="_membersShowInactive=!_membersShowInactive;renderMembers()" style="position:relative;width:34px;height:18px;border-radius:9px;background:${_membersShowInactive?'var(--blue)':'#cbd5e1'};transition:background .2s;cursor:pointer;flex-shrink:0">
            <div style="position:absolute;top:2px;left:${_membersShowInactive?'18px':'2px'};width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div>
          </div>
          Show Inactive
        </label>
        <button class="btn sm success" onclick="exportMembers()">&#11015; Export Members</button>
      </div>
    </div>
    <div id="mem-bulk-bar" style="display:none;background:var(--blue-light);border:1px solid var(--blue-mid);border-radius:var(--radius-lg);padding:10px 16px;margin-bottom:12px;display:none;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:var(--blue)" id="mem-sel-count">0 selected</span>
      <button class="btn sm primary" onclick="exportSelectedMembers()">&#11015; Download Selected</button>
      <button class="btn sm del" onclick="deleteSelectedMembers()">&#128465; Delete Selected</button>
      <button class="btn sm" onclick="memClearAll()" style="margin-left:auto">Clear Selection</button>
    </div>
    <div class="panel"><h3>Add Member</h3>
      <div class="fg fg4">
        <div><label class="flabel">Full Name</label><input class="finput nb" id="nm-n" placeholder="Full name"/></div>
        <div><label class="flabel">Username</label><input class="finput nb" id="nm-u" placeholder="Username"/></div>
        <div><label class="flabel">Password</label><input class="finput nb" id="nm-p" type="password" placeholder="Password"/></div>
        <div><label class="flabel">Role</label><select class="finput nb" id="nm-r">${ROLES.map(r=>`<option value="${r}">${r==='Talent on Demand'?'TOD':r}</option>`).join('')}</select></div>
      </div>
      <div class="fg fg2">
        <div><label class="flabel">Region</label><select class="finput nb" id="nm-reg"><option value="">— None —</option><option>MY</option><option>PH</option><option>TH</option><option>VN</option><option>ID</option><option>SG</option><option>EP</option></select></div>
        <div><label class="flabel">Reports To</label><select class="finput nb" id="nm-rt"><option value="">— None —</option>${D.members.filter(m=>m.approved&&m.active!==false&&['HOD','Manager','Assist. Manager','Team Lead'].includes(m.role)).map(m=>`<option value="${m.username}">${m.name} (${m.role})</option>`).join('')}</select></div>
      </div>
      <div class="fg fg2">
        <div><label class="flabel">Scheduled Start <span style="font-weight:400;color:var(--text3);font-size:11px">(for TOD attendance tracking)</span></label><input class="finput nb" id="nm-schedstart" type="time" value="09:00"/></div>
        <div><label class="flabel">Scheduled End <span style="font-weight:400;color:var(--text3);font-size:11px">(for TOD attendance tracking)</span></label><input class="finput nb" id="nm-schedend" type="time" value="18:00"/></div>
      </div>
      <div class="fg">
        <div><label class="flabel">Break (minutes) <span style="font-weight:400;color:var(--text3);font-size:11px">(unpaid, subtracted from scheduled hours — e.g. 60 for a 1-hour break)</span></label><input class="finput nb" id="nm-breakmins" type="number" min="0" step="5" value="60"/></div>
      </div>
      <div class="fg fg2">
        <div><label class="flabel">Service <span style="font-weight:400;color:var(--text3);font-size:11px">(TOD billing label — admin only)</span></label><input class="finput nb" id="nm-service" placeholder="e.g. Dulux Manual Processing Order Task"/></div>
        <div><label class="flabel">Rate (PHP/hr) <span style="font-weight:400;color:var(--text3);font-size:11px">(TOD billing — admin only, never shown to the member)</span></label><input class="finput nb" id="nm-rate" type="number" min="0" step="0.01" placeholder="e.g. 100"/></div>
      </div>
      <div class="fg"><label class="flabel">Buddy <span style="font-weight:400;color:var(--text3);font-size:11px">(covers this member's trackers — can edit their brand rows)</span></label><select class="finput nb" id="nm-buddy"><option value="">— None —</option>${D.members.filter(m=>m.approved&&m.active!==false).map(m=>`<option value="${m.username}">${m.name}</option>`).join('')}</select></div>
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text2)"><input type="checkbox" id="nm-ltaccess" style="width:15px;height:15px;cursor:pointer"/>Grant Live Tracker access <span style="font-weight:400;color:var(--text3);font-size:11px">(only matters for TOD role — normally hidden from TOD members)</span></label></div>
      <div class="form-actions">
        <button class="btn primary" onclick="addM()">Add Member</button>
        <button class="btn" onclick="document.getElementById('bulk-f').click()">Bulk Import Excel</button>
        <input type="file" id="bulk-f" accept=".xlsx,.xls" style="display:none" onchange="bulkImport(event)"/>
      </div>
      <div style="margin-top:6px;font-size:12px;color:var(--text3)">Excel: Col A=Name · B=Username · C=Password · D=Role · E=ReportsTo(username) · F=Region · G=WorkingHours</div>
    </div>
    <div id="mem-sort-state" style="display:none"></div>
    <div class="tbl-wrap"><table><thead><tr>
      <th style="width:32px;padding:7px 10px;background:#f8fafc;border-bottom:2px solid var(--border)"><input type="checkbox" id="mem-sel-all" onchange="memToggleAll(this.checked)" style="cursor:pointer"/></th>
      <th class="sh ${window._memSort&&_memSort.col==='name'?(_memSort.dir===1?'asc':'desc'):''}" style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc" onclick="if(!window._memSort)window._memSort={col:'name',dir:1};_memSort.col==='name'?_memSort.dir*=-1:(_memSort.col='name',_memSort.dir=1);renderMembers()">Name</th>
      <th class="sh ${window._memSort&&_memSort.col==='username'?(_memSort.dir===1?'asc':'desc'):''}" style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc" onclick="if(!window._memSort)window._memSort={col:'name',dir:1};_memSort.col==='username'?_memSort.dir*=-1:(_memSort.col='username',_memSort.dir=1);renderMembers()">Username</th>
      <th class="sh ${window._memSort&&_memSort.col==='role'?(_memSort.dir===1?'asc':'desc'):''}" style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc" onclick="if(!window._memSort)window._memSort={col:'name',dir:1};_memSort.col==='role'?_memSort.dir*=-1:(_memSort.col='role',_memSort.dir=1);renderMembers()">Role</th>
      <th class="sh ${window._memSort&&_memSort.col==='region'?(_memSort.dir===1?'asc':'desc'):''}" style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc" onclick="if(!window._memSort)window._memSort={col:'name',dir:1};_memSort.col==='region'?_memSort.dir*=-1:(_memSort.col='region',_memSort.dir=1);renderMembers()">Region</th>
      <th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc">Reports To</th>
      <th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc">Buddy</th>
      <th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc">Active</th>
      <th style="padding:9px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);border-bottom:2px solid var(--border);background:#f8fafc">Actions</th>
    </tr></thead>
    <tbody>${rows||'<tr><td colspan="9" class="empty-state">No members yet</td></tr>'}</tbody></table></div>
    <div style="margin-top:20px">
      <div class="section-hdr sh-purple">Assignment Groups <button class="btn sm primary" onclick="openGroupForm(null)" style="float:right">+ New Group</button></div>
      ${groupCards||'<div class="empty-state" style="padding:20px">No groups yet.</div>'}
    </div>`;
}


async function addM(){
  const name=document.getElementById('nm-n')?.value.trim(),user=document.getElementById('nm-u')?.value.trim().toLowerCase(),pass=document.getElementById('nm-p')?.value,role=document.getElementById('nm-r')?.value||'Member',region=document.getElementById('nm-reg')?.value||'',rt=document.getElementById('nm-rt')?.value||'',buddy=document.getElementById('nm-buddy')?.value||'';
  const schedStart=document.getElementById('nm-schedstart')?.value||'',schedEnd=document.getElementById('nm-schedend')?.value||'';
  const breakMinsRaw=document.getElementById('nm-breakmins')?.value,breakMins=breakMinsRaw?parseInt(breakMinsRaw,10):0;
  const service=document.getElementById('nm-service')?.value.trim()||'',rateRaw=document.getElementById('nm-rate')?.value,rate=rateRaw?parseFloat(rateRaw):0;
  const ltAccess=document.getElementById('nm-ltaccess')?.checked||false;
  if(!name||!user||!pass){toast('Name, username and password required');return;}
  if(user===ADMIN_UN||D.members.find(m=>m.username===user)){toast('Username already taken');return;}
  await fbPush('members',{name,username:user,password:pass,role,region,reportsTo:rt,buddy,schedStart,schedEnd,breakMins,service,rate,ltAccess,approved:true});
  await logAct(0,ds(now()),CU.name,'Member Added: '+name,'MEMBER_ADDED');
  ['nm-n','nm-u','nm-p','nm-service','nm-rate'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const ltEl=document.getElementById('nm-ltaccess');if(ltEl)ltEl.checked=false;
  toast('Member added');
}

function editMember(username){
  const m=D.members.find(x=>x.username===username);if(!m)return;
  const memberOpts=D.members.filter(x=>x.approved&&x.active!==false&&x.username!==username&&['HOD','Manager','Assist. Manager','Team Lead'].includes(x.role)).map(x=>`<option value="${x.username}"${m.reportsTo===x.username?' selected':''}>${x.name} (${x.role})</option>`).join('');
  // Buddy can be any other active member (the coverage partner who inherits this member's
  // tracker edit access). Standing pairing — independent of any logged leave.
  const buddyOpts=D.members.filter(x=>x.approved&&x.active!==false&&x.username!==username).map(x=>`<option value="${x.username}"${m.buddy===x.username?' selected':''}>${x.name}</option>`).join('');
  document.getElementById('mt-title').textContent='Edit Member';
  document.getElementById('mt-body').innerHTML=`
    <div class="fg fg2">
      <div><label class="flabel">Full Name</label><input class="finput nb" id="em-name" value="${m.name}"/></div>
      <div><label class="flabel">Role</label><select class="finput nb" id="em-role">${ROLES.map(r=>`<option value="${r}"${r===m.role?' selected':''}>${r==='Talent on Demand'?'TOD':r}</option>`).join('')}</select></div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">Region</label><select class="finput nb" id="em-region"><option value="">— None —</option><option${m.region==='MY'?' selected':''}>MY</option><option${m.region==='PH'?' selected':''}>PH</option><option${m.region==='TH'?' selected':''}>TH</option><option${m.region==='VN'?' selected':''}>VN</option><option${m.region==='ID'?' selected':''}>ID</option><option${m.region==='SG'?' selected':''}>SG</option><option${m.region==='EP'?' selected':''}>EP</option></select></div>
      <div><label class="flabel">Reports To</label><select class="finput nb" id="em-rt"><option value="">— None —</option>${memberOpts}</select></div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">Scheduled Start <span style="font-weight:400;color:var(--text3);font-size:11px">(for TOD attendance tracking)</span></label><input class="finput nb" id="em-schedstart" type="time" value="${m.schedStart||'09:00'}"/></div>
      <div><label class="flabel">Scheduled End <span style="font-weight:400;color:var(--text3);font-size:11px">(for TOD attendance tracking)</span></label><input class="finput nb" id="em-schedend" type="time" value="${m.schedEnd||'18:00'}"/></div>
    </div>
    <div class="fg">
      <div><label class="flabel">Break (minutes) <span style="font-weight:400;color:var(--text3);font-size:11px">(unpaid, subtracted from scheduled hours — e.g. 60 for a 1-hour break)</span></label><input class="finput nb" id="em-breakmins" type="number" min="0" step="5" value="${m.breakMins!=null?m.breakMins:60}"/></div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">Service <span style="font-weight:400;color:var(--text3);font-size:11px">(TOD billing label — admin only)</span></label><input class="finput nb" id="em-service" value="${escHtml(m.service||'')}" placeholder="e.g. Dulux Manual Processing Order Task"/></div>
      <div><label class="flabel">Rate (PHP/hr) <span style="font-weight:400;color:var(--text3);font-size:11px">(TOD billing — admin only, never shown to the member)</span></label><input class="finput nb" id="em-rate" type="number" min="0" step="0.01" value="${m.rate||''}" placeholder="e.g. 100"/></div>
    </div>
    <div class="fg"><label class="flabel">Buddy <span style="font-weight:400;color:var(--text3);font-size:11px">(covers this member's trackers — can edit their brand rows)</span></label><select class="finput nb" id="em-buddy"><option value="">— None —</option>${buddyOpts}</select></div>
    <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--text2)"><input type="checkbox" id="em-ltaccess" ${m.ltAccess?'checked':''} style="width:15px;height:15px;cursor:pointer"/>Grant Live Tracker access <span style="font-weight:400;color:var(--text3);font-size:11px">(only matters for TOD role — normally hidden from TOD members)</span></label></div>
    <div class="fg"><label class="flabel">New Password (optional)</label><input class="finput nb" id="em-pass" type="password" placeholder="Leave blank to keep"/></div>
    <div class="form-actions"><button class="btn primary" onclick="saveMemberEdit('${username}')">Save</button><button class="btn" onclick="closeModal('modal-task')">Cancel</button></div>`;
  openModal('modal-task');
}
async function saveMemberEdit(username){
  const mems=await fbGet('members')||{};
  for(const[k,m]of Object.entries(mems)){
    if(m.username===username){
      const rateRaw=document.getElementById('em-rate')?.value;
      const breakMinsRaw=document.getElementById('em-breakmins')?.value;
      const upd={name:document.getElementById('em-name').value.trim(),role:document.getElementById('em-role').value,region:document.getElementById('em-region')?.value||'',reportsTo:document.getElementById('em-rt')?.value||'',buddy:document.getElementById('em-buddy')?.value||'',schedStart:document.getElementById('em-schedstart')?.value||'',schedEnd:document.getElementById('em-schedend')?.value||'',breakMins:breakMinsRaw?parseInt(breakMinsRaw,10):0,service:document.getElementById('em-service')?.value.trim()||'',rate:rateRaw?parseFloat(rateRaw):0,ltAccess:document.getElementById('em-ltaccess')?.checked||false};
      const np=document.getElementById('em-pass').value;if(np)upd.password=np;
      await fbUpd(`members/${k}`,upd);toast('Member updated');break;
    }
  }
  closeModal('modal-task');
}
async function removeM(username){
  if(!confirm('Remove this member?'))return;
  const mems=await fbGet('members')||{};
  for(const[k,m]of Object.entries(mems)){if(m.username===username){await fbDel(`members/${k}`);break;}}
  toast('Member removed');
}
// Admin: dedicated quick-action to reset a member's login password, separate from the full
// Edit Member form so it's a one-click, low-friction action from the Members table.
function resetMemberPassword(username){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const m=D.members.find(x=>x.username===username);if(!m)return;
  document.getElementById('mt-title').textContent='Reset Password';
  document.getElementById('mt-body').innerHTML=`
    <div style="font-size:13px;color:var(--text3);margin-bottom:12px">Set a new password for <b>${escHtml(m.name)}</b> <span style="color:var(--text4)">(@${escHtml(m.username)})</span>.</div>
    <div class="fg"><label class="flabel">New Password</label><input class="finput nb" id="rp-pass" type="password" placeholder="Enter new password" autocomplete="new-password" onkeydown="if(event.key==='Enter')document.getElementById('rp-pass2').focus()"/></div>
    <div class="fg"><label class="flabel">Confirm New Password</label><input class="finput nb" id="rp-pass2" type="password" placeholder="Re-enter new password" autocomplete="new-password" onkeydown="if(event.key==='Enter')saveMemberPasswordReset('${username}')"/></div>
    <div class="msg err" id="rp-err" style="display:none"></div>
    <div class="form-actions"><button class="btn primary" onclick="saveMemberPasswordReset('${username}')">Reset Password</button><button class="btn" onclick="closeModal('modal-task')">Cancel</button></div>`;
  openModal('modal-task');
  setTimeout(()=>document.getElementById('rp-pass')?.focus(),50);
}
async function saveMemberPasswordReset(username){
  const errEl=document.getElementById('rp-err');
  const showErr=msg=>{if(errEl){errEl.textContent=msg;errEl.style.display='block';}else toast(msg);};
  const p1=document.getElementById('rp-pass')?.value||'';
  const p2=document.getElementById('rp-pass2')?.value||'';
  if(!p1||p1.length<4){showErr('Password must be at least 4 characters.');return;}
  if(p1!==p2){showErr('Passwords do not match.');return;}
  const mems=await fbGet('members')||{};
  for(const[k,m]of Object.entries(mems)){
    if(m.username===username){
      await fbUpd(`members/${k}`,{password:p1});
      await logAct(0,ds(now()),CU.name,'Password reset for: '+(m.name||username),'PASSWORD_RESET');
      toast('Password reset for '+(m.name||username)+'.');
      closeModal('modal-task');
      return;
    }
  }
  showErr('Member not found.');
}
function downloadMemberTemplate(){
  const headers=['Name','Username','Password','Role','ReportsTo(username)','Region','WorkingHours','ScheduleStart(HH:MM)','ScheduleEnd(HH:MM)'];
  const example=['Jane Doe','janedoe','pass123','Talent on Demand','john_manager','MY','9AM-6PM','09:00','18:00'];
  const notes=[
    '\u2192 Roles: HOD / Manager / Assist. Manager / Team Lead / Executive / Talent on Demand',
    '\u2192 ReportsTo: username of their direct manager/team lead (leave blank if none)',
    '\u2192 Regions: MY PH TH VN ID SG EP',
    '\u2192 WorkingHours: free text e.g. 9AM-6PM (display only)',
    '\u2192 ScheduleStart/ScheduleEnd: 24-hour HH:MM (e.g. 09:00, 18:00) — used to flag lateness and compute hours for TOD attendance tracking',
    '\u2192 Delete this row and the note rows before importing. Keep the header row.',
  ];
  const wb=XLSX.utils.book_new();
  const wsData=[headers,example,...notes.map(n=>[n])];
  const ws=XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols']=headers.map(()=>({wch:24}));
  XLSX.utils.book_append_sheet(wb,ws,'Members Template');
  XLSX.writeFile(wb,'Members_Import_Template.xlsx');
  toast('Member template downloaded!');
}
async function bulkImport(evt){
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'}),ws=wb.Sheets[wb.SheetNames[0]],data=XLSX.utils.sheet_to_json(ws,{header:1});
      let added=0;
      for(const row of data){
        const name=(row[0]||'').toString().trim(),user=(row[1]||'').toString().trim().toLowerCase(),pass=(row[2]||'').toString().trim(),role=(row[3]||'Member').toString().trim(),rt=(row[4]||'').toString().trim(),region=(row[5]||'').toString().trim(),wh=(row[6]||'').toString().trim(),schedStart=(row[7]||'').toString().trim(),schedEnd=(row[8]||'').toString().trim();
        if(name&&user&&pass&&user!==ADMIN_UN&&!D.members.find(m=>m.username===user)){await fbPush('members',{name,username:user,password:pass,role,reportsTo:rt,region,workingHours:wh,schedStart,schedEnd,approved:true,active:true});added++;}
      }
      toast(`Imported ${added} member(s)`);
    }catch(e){toast('Could not read file');}
  };
  reader.readAsBinaryString(file);evt.target.value='';
}

// Groups (inside Members page)
let _editGKey=null,_selGM=[];
function openGroupForm(key){
  _editGKey=key;const g=key?D.groups.find(x=>x._key===key):null;
  _selGM=g?[...(g.members||[])]:[];
  document.getElementById('mt-title').textContent=g?'Edit Group':'New Group';
  document.getElementById('mt-body').innerHTML=`
    <div class="fg"><label class="flabel">Group Name</label><input class="finput nb" id="grp-name" value="${g?g.name:''}" placeholder="e.g. Finance Team, CDM Group"/></div>
    <div><label class="flabel">Members</label>
      <div class="mselect-wrap" id="grp-chips" onclick="document.getElementById('grp-ms').focus()"></div>
      <input class="finput" id="grp-ms" placeholder="Search member..." style="margin-top:6px;margin-bottom:4px" oninput="grpFilt()" onfocus="document.getElementById('grp-mdrop').style.display=''"/>
      <div style="display:flex;gap:6px;margin-bottom:6px"><button class="btn sm" onclick="grpSelAll()">Select All</button><button class="btn sm" onclick="_selGM=[];grpChips();grpFilt()">Clear</button></div>
      <div class="mdrop" id="grp-mdrop" style="display:none"></div>
    </div>
    <div class="form-actions"><button class="btn primary" onclick="saveGroup()">${g?'Save':'Create Group'}</button><button class="btn" onclick="closeModal('modal-task')">Cancel</button></div>`;
  grpChips();grpFilt();openModal('modal-task');
}
function grpChips(){const e=document.getElementById('grp-chips');if(!e)return;e.innerHTML=_selGM.map(u=>`<span class="m-chip" style="font-size:11px"><span class="av" style="width:16px;height:16px;font-size:7px">${ini(getMN(u))}</span>${getMN(u)}<span class="rm" onclick="_selGM=_selGM.filter(x=>x!=='${u}');grpChips();grpFilt()">&#x2715;</span></span>`).join('');}
function grpFilt(){
  const q=(document.getElementById('grp-ms')?.value||'').toLowerCase(),drop=document.getElementById('grp-mdrop');if(!drop)return;
  const f=D.members.filter(m=>m.approved&&(m.name.toLowerCase().includes(q)||m.username.toLowerCase().includes(q)));
  drop.innerHTML=f.length?f.map(m=>`<div class="mdrop-item${_selGM.includes(m.username)?' sel':''}" onclick="grpTogM('${m.username}')"><span class="av" style="width:20px;height:20px;font-size:8px">${ini(m.name)}</span><span style="flex:1">${m.name}</span><span style="font-size:11px;color:var(--text3)">${m.role||'Member'}</span></div>`).join(''):'<div class="mdrop-item" style="color:var(--text4)">No members</div>';
  drop.style.display='';
}
function grpTogM(u){if(_selGM.includes(u))_selGM=_selGM.filter(x=>x!==u);else _selGM.push(u);grpChips();grpFilt();}
function grpSelAll(){_selGM=D.members.filter(m=>m.approved&&m.active!==false).map(m=>m.username);grpChips();grpFilt();}
async function saveGroup(){
  const name=document.getElementById('grp-name')?.value.trim();if(!name){toast('Group name required');return;}
  if(_editGKey)await fbUpd(`groups/${_editGKey}`,{name,members:_selGM});
  else await fbPush('groups',{name,members:_selGM,createdBy:CU.name,ts:Date.now()});
  toast(_editGKey?'Group updated':'Group created');closeModal('modal-task');
}
async function deleteGroup(key){if(!confirm('Delete this group?'))return;await fbDel(`groups/${key}`);toast('Group deleted');}

// ── LEAD-PRIVATE GROUPS (stored under leadGroups/<username>/, not visible to admin) ──
let _editLeadGKey=null, _selLeadGM=[];
function openLeadGroupForm(key){
  _editLeadGKey=key;
  const g=key?(D.leadGroups||[]).find(x=>x._key===key):null;
  _selLeadGM=g?[...(g.members||[])]:[];
  document.getElementById('mt-title').textContent=g?'Edit My Group':'New Group';
  document.getElementById('mt-body').innerHTML=
    '<div class="fg"><label class="flabel">Group Name</label><input class="finput nb" id="lgrp-name" value="'+(g?g.name:'')+'" placeholder="e.g. Finance Team"/></div>'+
    '<div><label class="flabel">Members</label>'+
      '<div class="mselect-wrap" id="lgrp-chips" onclick="document.getElementById(&quot;lgrp-ms&quot;).focus()"></div>'+
      '<input class="finput" id="lgrp-ms" placeholder="Search member..." style="margin-top:6px;margin-bottom:4px" oninput="lgrpFilt()" onfocus="document.getElementById(&quot;lgrp-mdrop&quot;).style.display=&quot;&quot;"/>'+
      '<div style="display:flex;gap:6px;margin-bottom:6px"><button class="btn sm" onclick="lgrpSelAll()">Select All</button><button class="btn sm" onclick="_selLeadGM=[];lgrpChips();lgrpFilt()">Clear</button></div>'+
      '<div class="mdrop" id="lgrp-mdrop" style="display:none"></div>'+
    '</div>'+
    '<div class="form-actions"><button class="btn primary" onclick="saveLeadGroup()">'+(g?'Save':'Create Group')+'</button><button class="btn" onclick="closeModal(&quot;modal-task&quot;)">Cancel</button></div>';
  lgrpChips();lgrpFilt();openModal('modal-task');
}
function lgrpChips(){const e=document.getElementById('lgrp-chips');if(!e)return;e.innerHTML=_selLeadGM.map(u=>`<span class="m-chip" style="font-size:11px"><span class="av" style="width:16px;height:16px;font-size:7px">${ini(getMN(u))}</span>${getMN(u)}<span class="rm" onclick="_selLeadGM=_selLeadGM.filter(x=>x!=='${u}');lgrpChips();lgrpFilt()">&#x2715;</span></span>`).join('');}
function lgrpFilt(){
  const q=(document.getElementById('lgrp-ms')?.value||'').toLowerCase(),drop=document.getElementById('lgrp-mdrop');if(!drop)return;
  const f=D.members.filter(m=>m.approved&&(m.name.toLowerCase().includes(q)||m.username.toLowerCase().includes(q)));
  drop.innerHTML=f.length?f.map(m=>`<div class="mdrop-item${_selLeadGM.includes(m.username)?' sel':''}" onclick="lgrpTogM('${m.username}')"><span class="av" style="width:20px;height:20px;font-size:8px">${ini(m.name)}</span><span style="flex:1">${m.name}</span><span style="font-size:11px;color:var(--text3)">${m.role||'Member'}</span></div>`).join(''):'<div class="mdrop-item" style="color:var(--text4)">No members</div>';
  drop.style.display='';
}
function lgrpTogM(u){if(_selLeadGM.includes(u))_selLeadGM=_selLeadGM.filter(x=>x!==u);else _selLeadGM.push(u);lgrpChips();lgrpFilt();}
function lgrpSelAll(){_selLeadGM=D.members.filter(m=>m.approved&&m.active!==false).map(m=>m.username);lgrpChips();lgrpFilt();}
async function saveLeadGroup(){
  const name=document.getElementById('lgrp-name')?.value.trim();if(!name){toast('Group name required');return;}
  const path='leadGroups/'+CU.username;
  if(_editLeadGKey) await fbUpd(path+'/'+_editLeadGKey,{name,members:_selLeadGM});
  else await fbPush(path,{name,members:_selLeadGM,createdBy:CU.name,ts:Date.now()});
  toast(_editLeadGKey?'Group updated':'Group created');closeModal('modal-task');
}
async function deleteLeadGroup(key){if(!confirm('Delete this group?'))return;await fbDel('leadGroups/'+CU.username+'/'+key);toast('Group deleted');}


// ── ACTIVITY FEED (replaces Transaction Log) ──
function buildActivityFeed(){
  if(!CU.isAdmin)return'';
  const log=D.actLog||[];
  const meaningful=['EXT_REQUESTED','EXT_APPROVED','EXT_DECLINED','ADMIN','AUTO','INCIDENT','AUDIT','TASK_ADDED','TASK_DELETED','MEMBER_ADDED','ESC_GOVERNANCE'];
  const allFeed=log.filter(l=>meaningful.includes(l.note));
  const feed=allFeed.slice(0,20);

  // Auto-expand if there are events and user hasn't explicitly collapsed
  if(window._actFeedOpen===undefined&&feed.length>0)window._actFeedOpen=true;
  if(window._actFeedOpen===undefined)window._actFeedOpen=false;
  const isOpen=window._actFeedOpen;

  const totalCount=allFeed.length;
  const countBadge=totalCount?`<span style="font-size:10px;background:var(--blue-light);color:var(--blue);padding:1px 8px;border-radius:20px;font-weight:700;margin-left:8px">${totalCount} event${totalCount!==1?'s':''}</span>`:'';

  if(!isOpen){
    return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);margin-bottom:16px">
      <div onclick="window._actFeedOpen=true;renderDashboard()" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none">
        <span style="font-size:12px;font-weight:700;color:var(--text2)">📌 Activity Feed${countBadge}</span>
        <span style="font-size:12px;color:var(--text3)">▼ Show</span>
      </div>
    </div>`;
  }

  if(!feed.length){
    return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);margin-bottom:16px">
      <div onclick="window._actFeedOpen=false;renderDashboard()" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none">
        <span style="font-size:12px;font-weight:700;color:var(--text2)">📌 Activity Feed</span>
        <span style="font-size:12px;color:var(--text3)">▲ Hide</span>
      </div>
      <div style="padding:0 16px 14px;color:var(--text4);font-size:13px">No significant events yet.</div>
    </div>`;
  }

  const iconMap={
    'EXT_REQUESTED':'🕐','EXT_APPROVED':'✅','EXT_DECLINED':'❌',
    'ADMIN':'🛡️','AUTO':'⚙️','INCIDENT':'⚠️','AUDIT':'📋',
    'TASK_ADDED':'➕','TASK_DELETED':'🗑️','MEMBER_ADDED':'👤','ESC_GOVERNANCE':'🚨'
  };
  const labelMap={
    'EXT_REQUESTED':'Extension Requested','EXT_APPROVED':'Extension Approved','EXT_DECLINED':'Extension Declined',
    'ADMIN':'Admin Action','AUTO':'Auto','INCIDENT':'Incident','AUDIT':'Audit Entry',
    'TASK_ADDED':'Task Added','TASK_DELETED':'Task Deleted','MEMBER_ADDED':'Member Added','ESC_GOVERNANCE':'Escalated to Governance'
  };
  const colMap={
    'EXT_REQUESTED':'var(--teal)','EXT_APPROVED':'var(--green)','EXT_DECLINED':'var(--red)',
    'ADMIN':'var(--purple)','AUTO':'var(--orange)','INCIDENT':'#92400e',
    'AUDIT':'#92400e','TASK_ADDED':'var(--blue)','TASK_DELETED':'var(--red)',
    'MEMBER_ADDED':'var(--green)','ESC_GOVERNANCE':'var(--red)'
  };
  const bgMap={
    'EXT_REQUESTED':'var(--teal-light)','EXT_APPROVED':'var(--green-light)','EXT_DECLINED':'var(--red-light)',
    'ADMIN':'var(--purple-light)','AUTO':'var(--orange-light)','INCIDENT':'var(--yellow-light)',
    'AUDIT':'var(--yellow-light)','TASK_ADDED':'var(--blue-light)','TASK_DELETED':'var(--red-light)',
    'MEMBER_ADDED':'var(--green-light)','ESC_GOVERNANCE':'var(--red-light)'
  };

  function fmtRelTime(ts){
    if(!ts)return'';
    const diff=Date.now()-ts;
    const mins=Math.floor(diff/60000);
    const hrs=Math.floor(mins/60);
    const days=Math.floor(hrs/24);
    if(mins<2)return'just now';
    if(mins<60)return mins+'m ago';
    if(hrs<24)return hrs+'h ago';
    if(days===1)return'yesterday';
    return days+'d ago';
  }

  const rows=feed.map(l=>{
    const icon=iconMap[l.note]||'📌';
    const col=colMap[l.note]||'var(--text3)';
    const bg=bgMap[l.note]||'#f1f5f9';
    const label=labelMap[l.note]||l.note||'Event';
    const jumpTarget=l.note==='INCIDENT'?'incidents':
      l.note==='AUDIT'?'audit':
      l.note==='EXT_REQUESTED'||l.note==='EXT_APPROVED'||l.note==='EXT_DECLINED'?'dashboard':
      l.note==='MEMBER_ADDED'?'members':
      l.taskId?'tasks':'';
    const relTime=fmtRelTime(l.ts);
    return`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);min-height:46px">
      <div style="width:28px;height:28px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">${l.title||'—'}</span>
          <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;background:${bg};color:${col};white-space:nowrap;flex-shrink:0">${label}</span>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-weight:500;color:var(--text2)">${l.who}</span>
          <span>·</span>
          <span>${l.date}${l.time?' '+l.time:''}</span>
          ${relTime?`<span style="color:var(--text4)">· ${relTime}</span>`:''}
          ${l.status&&l.status!==l.title&&l.status!==l.note?`<span>· <span style="color:var(--text2)">${l.status}</span></span>`:''}
        </div>
      </div>
      ${jumpTarget?`<button class="btn sm" onclick="showPage('${jumpTarget}')" style="flex-shrink:0;font-size:11px;padding:4px 10px">View →</button>`:''}
    </div>`;
  }).join('');

  return`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);margin-bottom:16px">
    <div onclick="window._actFeedOpen=false;renderDashboard()" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;font-weight:700;color:var(--text2)">📌 Activity Feed${countBadge}</span>
      <span style="font-size:12px;color:var(--text3)">▲ Hide</span>
    </div>
    <div style="padding:0 16px">
    ${rows}
    </div>
    ${totalCount>20?`<div style="padding:8px 16px;font-size:11px;color:var(--text4);border-top:1px solid var(--border)">Showing 20 of ${totalCount} events — most recent shown first.</div>`:''}
  </div>`;
}




// Incident summary - rows=TeamLeaders, cols=Categories, week view
const INCIDENT_CATS=['SIS','Listing','Category','Merchandise Master','Compliance','Others'];

// ── WEEKLY REPORT SYSTEM ──
function getWeekNumber(dateStr){
  // ISO 8601 week number (Monday start; week 1 contains Jan 4th / first Thursday).
  const d=new Date((dateStr||ds(now()))+'T12:00:00');
  const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));
  const y=new Date(Date.UTC(t.getUTCFullYear(),0,1));
  return Math.ceil(((t-y)/864e5+1)/7);
}

function getWeekDatesForCW(cw,year){
  // Returns Mon-Sun for a given ISO CW number and year. Must mirror getWeekNumber (ISO 8601):
  // week 1 = the week containing Jan 4th.
  const jan4=new Date(year,0,4);
  const mon1=new Date(year,0,4-((jan4.getDay()||7)-1));
  const mon=new Date(mon1);mon.setDate(mon1.getDate()+(cw-1)*7);
  const dates=[];
  for(let i=0;i<7;i++){const x=new Date(mon);x.setDate(mon.getDate()+i);dates.push(ds(x));}
  return dates;
}

function getIncidentsForWeek(allInc,weekDates){
  const s=weekDates[0],e=weekDates[6];
  return allInc.filter(i=>{const d=i.incidentDate||i.date;return d>=s&&d<=e;});
}

function buildWeeklyReportData(allInc,cw,year){
  // Returns pivot data for one week
  const weekDates=getWeekDatesForCW(cw,year);
  const weekInc=getIncidentsForWeek(allInc,weekDates);
  const cats=INCIDENT_CATS;

  // Table 2: CDM × TL breakdown
  // Group by CDM name + TL name
  const cdmMap={};
  weekInc.forEach(i=>{
    const cdm=i.cdm||'(Unknown)';
    const tl=i.cdmTL||'—';
    const key=cdm+'|||'+tl;
    if(!cdmMap[key])cdmMap[key]={cdm,tl,counts:{}};
    const cat=cats.includes(i.category)?i.category:'Others';
    cdmMap[key].counts[cat]=(cdmMap[key].counts[cat]||0)+1;
  });
  const cdmRows=Object.values(cdmMap).sort((a,b)=>a.cdm.localeCompare(b.cdm));

  // Totals per category for this week
  const weekTotals={};
  cats.forEach(c=>{weekTotals[c]=weekInc.filter(i=>(i.category||'Others')===c).length;});
  weekTotals._grand=weekInc.length;

  return{weekDates,weekInc,cdmRows,weekTotals,cats};
}

function buildWeeklyReportHTML(report){
  const baseCW=report.cw,year=report.year,rKey=report._key;
  // Exclude auto-escalated lead task compliance incidents — only count real logged incidents
  const allInc=(D.incidents||[]).filter(i=>!i._leadTaskEsc);
  const cats=INCIDENT_CATS;

  // Per-report nav offsets stored in window to survive re-renders without Firebase
  if(!window._wrOff)window._wrOff={};
  // t1: 0=current week is newest in window; t2: -1=previous week (incidents covered); t3: 0=current CW vs prev CW
  if(!window._wrOff[rKey])window._wrOff[rKey]={t1:0,t2:-1,t3:0};
  const off=window._wrOff[rKey];

  // Helper: clamp CW to 1..53 within year
  function cwLabel(cw){return'CW'+cw;}
  function navBtn(table,dir,disabled){
    return'<button class="nav-arrow" style="width:24px;height:24px;font-size:12px'+(disabled?';opacity:.3':'')+'"'
      +(disabled?' disabled':'')
      +' onclick="window._wrOff[\''+rKey+'\'].'+table+'='+(dir>0?'Math.min(window._wrOff[\''+rKey+'\'].'+table+'+1,4)':'Math.max(window._wrOff[\''+rKey+'\'].'+table+'-1,-30)')
      +';renderReports()">'+(dir>0?'&#8594;':'&#8592;')+'</button>';
  }

  // ── TABLE 1: current week + 3 past weeks (fixed window, navigable) ──
  // off.t1 shifts the anchor: 0=current week is the newest, -1=go back 1 week, etc.
  // Always show 4 weeks ending at (baseCW + off.t1): i.e. [anchor-3 .. anchor]
  const t1Anchor=baseCW+off.t1;
  const t1Start=t1Anchor-3,t1End=t1Anchor; // 4 weeks: anchor-3, anchor-2, anchor-1, anchor
  const t1Weeks=[];
  for(let w=t1Start;w<=t1End;w++){
    if(w<1||w>53)continue;
    const wd=getWeekDatesForCW(w,year);
    const wi=getIncidentsForWeek(allInc,wd);
    const counts={};cats.forEach(c=>{counts[c]=wi.filter(i=>(i.category||'Others')===c).length;});
    counts._grand=wi.length;
    const isBase=w===baseCW;
    t1Weeks.push({cw:w,counts,isBase});
  }
  const t1Grand={};
  cats.forEach(c=>{t1Grand[c]=t1Weeks.reduce((s,w)=>s+(w.counts[c]||0),0);});
  t1Grand._grand=t1Weeks.reduce((s,w)=>s+(w.counts._grand||0),0);
  const t1Rows=t1Weeks.map(w=>{
    const cells=cats.map(c=>`<td style="${w.counts[c]>0?'font-weight:700;color:var(--red)':''}">${w.counts[c]||''}</td>`).join('');
    const bg=w.isBase?'background:#e8f4fd;':'';
    return`<tr style="${bg}"><td class="left">${cwLabel(w.cw)}${w.isBase?' <span style="font-size:9px;background:var(--blue);color:#fff;padding:1px 5px;border-radius:10px">current</span>':''}</td>${cells}<td style="font-weight:700${w.counts._grand>0?';color:var(--red)':''}">${w.counts._grand||''}</td></tr>`;
  }).join('');
  const t1GrandCells=cats.map(c=>`<td style="font-weight:700">${t1Grand[c]||''}</td>`).join('');
  const t1RangeLabel=`${cwLabel(t1Start)} – ${cwLabel(t1End)}`;
  const table1=`<div class="wr-card">
    <div class="wr-card-hdr">
      <span class="wr-card-title">📊 Summary — ${t1RangeLabel} · ${year} <span style="font-size:10px;font-weight:400;color:#93c5fd">(current week + 3 past)</span></span>
      <div style="display:flex;align-items:center;gap:6px">
        ${navBtn('t1',-1,off.t1<=-8)}
        <span style="font-size:11px;color:#93c5fd;min-width:60px;text-align:center">4 weeks</span>
        ${navBtn('t1',1,off.t1>=0)}
      </div>
    </div>
    <div style="overflow-x:auto;padding:0"><table class="wr-table"><thead><tr>
      <th class="left">Week No.</th>${cats.map(c=>`<th>${c}</th>`).join('')}<th>Grand Total</th>
    </tr></thead><tbody>
      ${t1Rows}
      <tr class="grand-row"><td class="left">Grand Total</td>${t1GrandCells}<td style="font-weight:700">${t1Grand._grand||''}</td></tr>
    </tbody></table></div></div>`;

  // ── TABLE 2: Lead → CDM view — week selector, nav fixed (← = older, → = newer) ──
  // off.t2 default=-1 means we show the previous week's incidents (covered by this report)
  const t2CW=baseCW+off.t2;
  const t2WD=getWeekDatesForCW(Math.max(1,t2CW),year);
  const t2Inc=getIncidentsForWeek(allInc,t2WD);
  const cdmMap={};
  t2Inc.forEach(i=>{
    const cdm=i.cdm||'(Unknown)';const tl=i.cdmTL||'—';const key=tl+'|||'+cdm;
    if(!cdmMap[key])cdmMap[key]={cdm,tl,counts:{}};
    const cat=cats.includes(i.category)?i.category:'Others';
    cdmMap[key].counts[cat]=(cdmMap[key].counts[cat]||0)+1;
  });
  // Sort by Lead first, then CDM
  const t2Rows=Object.values(cdmMap).sort((a,b)=>a.tl.localeCompare(b.tl)||a.cdm.localeCompare(b.cdm)).map(r=>{
    const cells=cats.map(c=>`<td>${r.counts[c]||''}</td>`).join('');
    const grand=cats.reduce((s,c)=>s+(r.counts[c]||0),0);
    return`<tr><td class="left" style="font-weight:600">${r.tl}</td><td class="left">${r.cdm}</td>${cells}<td style="font-weight:700">${grand||''}</td></tr>`;
  }).join('');
  const t2Totals={};cats.forEach(c=>{t2Totals[c]=t2Inc.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length;});
  const t2GrandTotal=cats.reduce((s,c)=>s+(t2Totals[c]||0),0);
  const t2GrandCells=cats.map(c=>`<td style="font-weight:700">${t2Totals[c]||''}</td>`).join('');
  const t2Label=cwLabel(t2CW)+(t2CW===baseCW-1?' · incidents covered by '+cwLabel(baseCW):t2CW===baseCW?' (current, published week)':'');
  const t2DateRange=new Date(t2WD[0]+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'})+' – '+new Date(t2WD[6]+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
  const table2=`<div class="wr-card">
    <div class="wr-card-hdr">
      <span class="wr-card-title">👥 CDM & Team Lead View — ${t2Label} · ${t2DateRange}</span>
      <div style="display:flex;align-items:center;gap:6px">
        ${navBtn('t2',-1,off.t2<=-4)}
        <span style="font-size:11px;color:#93c5fd;min-width:60px;text-align:center">${t2Inc.length} incident${t2Inc.length!==1?'s':''}</span>
        ${navBtn('t2',1,off.t2>=4)}
      </div>
    </div>
    <div style="overflow-x:auto;padding:0"><table class="wr-table"><thead><tr>
      <th class="left">Team Lead</th><th class="left">CDM</th>${cats.map(c=>`<th>${c}</th>`).join('')}<th>Grand Total</th>
    </tr></thead><tbody>
      ${t2Rows||'<tr><td colspan="'+(cats.length+3)+'" style="text-align:center;padding:16px;color:var(--text4)">No incidents this week</td></tr>'}
      <tr class="grand-row"><td class="left" colspan="2">Grand Total</td>${t2GrandCells}<td style="font-weight:700">${t2GrandTotal||''}</td></tr>
    </tbody></table></div></div>`;

  // ── TABLE 3: WoW — t3 offset shifts the "current" week; shows t3CW vs t3CW-1 ──
  // t3=0 → current CW (baseCW) vs previous (baseCW-1); ← goes back in time, → goes forward
  const t3CW=baseCW+off.t3;
  const t3Prev=Math.max(1,t3CW-1);
  const t3CurWD=getWeekDatesForCW(t3CW,year);
  const t3PrevWD=getWeekDatesForCW(t3Prev,year);
  const t3CurInc=getIncidentsForWeek(allInc,t3CurWD);
  const t3PrevInc=getIncidentsForWeek(allInc,t3PrevWD);
  const regions=['MY','PH','SG','TH','VN','ID','EP'];
  const usedReg=regions.filter(r=>t3CurInc.some(i=>i.region===r)||t3PrevInc.some(i=>i.region===r));
  const t3Rows=usedReg.map(r=>{
    const rCur=t3CurInc.filter(i=>i.region===r);
    const rPrev=t3PrevInc.filter(i=>i.region===r);
    const cells=cats.map(c=>{
      const cur=rCur.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length;
      const prev=rPrev.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length;
      const wow=cur-prev;
      const wowHtml=wow===0?'<span style="color:var(--text4)">0</span>':wow>0?`<span class="pos">+${wow}</span>`:`<span class="neg">${wow}</span>`;
      return`<td>${cur||''}</td><td>${wowHtml}</td>`;
    }).join('');
    const rowTotal=cats.reduce((s,c)=>s+rCur.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length,0);
    const prevTotal=cats.reduce((s,c)=>s+rPrev.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length,0);
    const rowWow=rowTotal-prevTotal;
    const rowWowHtml=rowWow===0?'<span style="color:var(--text4)">0</span>':rowWow>0?`<span class="pos">+${rowWow}</span>`:`<span class="neg">${rowWow}</span>`;
    return`<tr><td class="left"><b>${r}</b></td>${cells}<td style="font-weight:700">${rowTotal||''}</td><td>${rowWowHtml}</td></tr>`;
  }).join('');
  const t3GtCells=cats.map(c=>{
    const cur=t3CurInc.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length;
    const prev=t3PrevInc.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length;
    const wow=cur-prev;
    const wowHtml=wow===0?'<span style="color:var(--text4)">0</span>':wow>0?`<span class="pos">+${wow}</span>`:`<span class="neg">${wow}</span>`;
    return`<td>${cur||''}</td><td>${wowHtml}</td>`;
  }).join('');
  const t3GrandCur=cats.reduce((s,c)=>s+t3CurInc.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length,0);
  const t3GrandPrev=cats.reduce((s,c)=>s+t3PrevInc.filter(i=>(cats.includes(i.category)?i.category:'Others')===c).length,0);
  const t3GrandWow=t3GrandCur-t3GrandPrev;
  const t3GrandWowHtml=t3GrandWow===0?'<span style="color:var(--text4)">0</span>':t3GrandWow>0?`<span class="pos">+${t3GrandWow}</span>`:`<span class="neg">${t3GrandWow}</span>`;
  const t3Header=cats.map(c=>`<th colspan="2">${c}</th>`).join('');
  const t3Sub=cats.map(()=>`<th>${cwLabel(t3CW)}</th><th>WoW</th>`).join('');
  const t3IsCurrent=t3CW===baseCW;
  const table3=`<div class="wr-card">
    <div class="wr-card-hdr">
      <span class="wr-card-title">📈 Week-on-Week — ${cwLabel(t3Prev)} vs ${cwLabel(t3CW)}${t3IsCurrent?' (current)':''}</span>
      <div style="display:flex;align-items:center;gap:6px">
        ${navBtn('t3',-1,off.t3<=-4)}
        <span style="font-size:11px;color:#93c5fd;min-width:60px;text-align:center">by Region</span>
        ${navBtn('t3',1,off.t3>=0)}
      </div>
    </div>
    <div style="overflow-x:auto;padding:0"><table class="wr-table"><thead>
      <tr><th class="left">Region</th>${t3Header}<th colspan="2">Total</th></tr>
      <tr><th class="left"></th>${t3Sub}<th>${cwLabel(t3CW)}</th><th>WoW</th></tr>
    </thead><tbody>
      ${t3Rows||'<tr><td colspan="'+(cats.length*2+3)+'" style="text-align:center;padding:16px;color:var(--text4)">No data</td></tr>'}
      <tr class="grand-row"><td class="left">Grand Total</td>${t3GtCells}<td style="font-weight:700">${t3GrandCur||''}</td><td>${t3GrandWowHtml}</td></tr>
    </tbody></table></div></div>`;

  // ── RESPONSE TRACKER — compact avatar grid, no textarea ──
  // The "covered" week = baseCW-1 (incidents from last week, reported this week)
  const coveredCW=Math.max(1,baseCW-1);
  const coveredWD=getWeekDatesForCW(coveredCW,year);
  const coveredInc=getIncidentsForWeek(allInc,coveredWD);

  const LEAD_ORDER_R=['Team Lead','Assist. Manager','Manager','HOD'];
  const allLeads=D.members.filter(m=>m.approved&&m.active!==false&&LEAD_ROLES.includes(m.role))
    .sort((a,b)=>LEAD_ORDER_R.indexOf(a.role)-LEAD_ORDER_R.indexOf(b.role)||a.name.localeCompare(b.name));

  // Only include leads who have at least one incident recorded in the covered week
  // (either as cdmTL, tagged, or whose reports-to members are tagged)
  function leadHasIncident(tl){
    return coveredInc.some(i=>{
      if((i.cdmTL||'')=== tl.name)return true;
      const tagged=i.tagged||[];
      if(tagged.includes(tl.username))return true;
      return tagged.some(u=>{
        const member=D.members.find(m=>m.username===u);
        return member&&member.reportsTo===tl.username;
      });
    });
  }

  // teamLeads = only leads with incidents in the covered (previous) week
  const teamLeads=allLeads.filter(tl=>leadHasIncident(tl));

  const responses=report.tlResponses||{};
  const respondedCount=teamLeads.filter(tl=>responses[tl.username]).length;
  const pendingLeads=teamLeads.filter(tl=>!responses[tl.username]);
  const myPending=isLead()&&!CU.isAdmin&&!responses[CU.username]&&teamLeads.some(tl=>tl.username===CU.username);

  // Determine deadline: Friday 5pm of the report's due week
  const dueFriday=report.dueFriday;
  const deadlineTs=dueFriday?new Date(dueFriday+'T17:00:00').getTime():null;

  // Build tooltip lists
  const respondedLeads=teamLeads.filter(tl=>responses[tl.username]);
  const respondedTooltip=respondedLeads.map(tl=>{
    const resp=responses[tl.username];
    const isLate=deadlineTs&&resp.ts>deadlineTs;
    const ts=new Date(resp.ts).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return(isLate?'⚠️ ':'✓ ')+tl.name+(isLate?' (auto-escalated, '+ts+')':' · '+ts);
  }).join('\n')||'None yet';

  const pendingTooltip=pendingLeads.map(tl=>('⏳ '+tl.name)).join('\n')||'All responded!';

  // Auto-escalate: leads who responded after the Friday 5pm deadline
  const autoEscalated=respondedLeads.filter(tl=>{
    const resp=responses[tl.username];
    return deadlineTs&&resp.ts>deadlineTs;
  });

  // Lead's own submit box — shown only if pending
  const mySubmitBox=myPending?`<div class="wr-tl-pending" style="margin-top:10px">
    <div style="font-weight:700;font-size:12px;color:#92400e;margin-bottom:6px">⏰ Your response is required — due Friday 5:00 PM</div>
    <textarea id="wr-resp-${rKey}" class="finput" rows="2" placeholder="Acknowledge your team's findings for ${cwLabel(baseCW)}..."></textarea>
    <div class="form-actions" style="margin-top:6px">
      <button class="btn primary sm" onclick="tlSubmitResponse('${rKey}','${CU.username}')">Submit Acknowledgment</button>
    </div>
  </div>`:'';

  // Admin remind button — only shown if there are pending leads
  const remindBtn=(CU.isAdmin&&pendingLeads.length)?`<button class="btn sm warning" onclick="remindPendingLeads('${rKey}')" style="margin-left:4px">📣 Remind ${pendingLeads.length}</button>`:'';

  // Auto-escalation notice
  const escNotice=autoEscalated.length?`<div style="margin-top:8px;padding:7px 12px;background:var(--orange-light);border:1px solid #fed7aa;border-radius:var(--radius);font-size:11px;color:var(--orange);font-weight:600">⚠️ Auto-escalated (responded after Friday 5pm deadline): ${autoEscalated.map(tl=>tl.name).join(', ')}</div>`:'';

  const responseSection=`<div class="wr-card">
    <div class="wr-card-hdr" style="align-items:center">
      <div class="wr-resp-collapsible-hdr" style="flex:1;display:flex;align-items:center" onclick="wrToggleRespDetail('${rKey}')">
        <span class="wr-card-title">✅ Response Status — CW${baseCW} report &nbsp;<span style="font-size:10px;font-weight:400;color:#93c5fd">covering CW${coveredCW} incidents</span></span>
        <span style="margin-left:12px;display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="color:#4ade80;font-weight:700;font-size:11px">${respondedCount} responded</span>
          <span style="color:#93c5fd;font-size:11px">/</span>
          <span style="color:#fca5a5;font-weight:700;font-size:11px">${pendingLeads.length} pending</span>
          <span style="color:#93c5fd;font-size:11px">of ${teamLeads.length}${teamLeads.length===0?' (no leads with incidents)':''}</span>
          <span class="wr-resp-toggle" id="wr-resp-arrow-${rKey}">▼</span>
        </span>
      </div>
      ${remindBtn}
    </div>
    ${escNotice}
    <div class="wr-resp-detail" id="wr-resp-detail-${rKey}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px">
        ${pendingLeads.length?`<div>
          <div class="wr-resp-section-label" style="color:#fca5a5">⏳ Pending (${pendingLeads.length})</div>
          <div class="wr-pending-list">
            ${pendingLeads.map(tl=>`<div class="wr-pending-item">
              <div class="av" style="background:rgba(255,255,255,.1);color:#e2e8f0;font-size:9px;width:24px;height:24px">${ini(tl.name)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:600;color:#e2e8f0">${escHtml(tl.name)}</div>
                <div style="font-size:10px;color:#93c5fd">${escHtml(tl.role||'')}</div>
              </div>
              <span style="font-size:10px;color:#fca5a5;background:rgba(220,38,38,.15);padding:2px 8px;border-radius:20px;border:1px solid rgba(220,38,38,.3)">Pending</span>
            </div>`).join('')}
          </div>
        </div>`:'<div><div class="wr-resp-section-label" style="color:#4ade80">⏳ Pending</div><div style="color:#4ade80;font-size:12px;padding:12px 0">All leads have responded! 🎉</div></div>'}
        ${respondedLeads.length?`<div>
          <div class="wr-resp-section-label" style="color:#4ade80">✓ Responded (${respondedLeads.length})</div>
          <div class="wr-pending-list">
            ${respondedLeads.map(tl=>{
              const resp=responses[tl.username];
              const isLate=deadlineTs&&resp.ts>deadlineTs;
              const ts=new Date(resp.ts).toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
              return `<div class="wr-responded-item">
                <div class="av" style="background:rgba(74,222,128,.15);color:#4ade80;font-size:9px;width:24px;height:24px">${ini(tl.name)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600;color:#e2e8f0">${escHtml(tl.name)}</div>
                  <div style="font-size:10px;color:#86efac">${ts}${isLate?' · <span style="color:var(--orange)">⚠️ Late</span>':''}</div>
                  ${resp.text?`<div style="font-size:11px;color:#93c5fd;margin-top:3px;font-style:italic;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:220px">"${escHtml(resp.text)}"</div>`:''}
                </div>
                ${(CU.isAdmin||(isLead()&&tl.username===CU.username))?`<button class="btn sm" style="font-size:10px;padding:2px 7px;background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#e2e8f0" onclick="tlEditResponse('${rKey}','${tl.username}')">Edit</button>`:''}
              </div>`;
            }).join('')}
          </div>
        </div>`:''}
      </div>
      ${mySubmitBox}
    </div>
  </div>`;

  return table1+table2+table3+responseSection;
}

async function publishWeeklyReport(){
  const cw=getWeekNumber(ds(now()));
  const year=now().getFullYear();
  // Find next Friday for due date label
  const d=now();
  const daysToFri=(5-d.getDay()+7)%7||7;
  const fri=new Date(d);fri.setDate(d.getDate()+daysToFri);
  const friLabel=fri.toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'});
  // Check for stale report with wrong CW (e.g. published before week-number fix)
  const staleCW=cw+1; // the off-by-one that existed before the fix
  const staleReport=(D.weeklyReports||[]).find(r=>r.cw===staleCW&&r.year===year);
  if(staleReport){
    if(confirm(`Found a report published as CW${staleCW} that should be CW${cw}. Fix it now?`)){
      await fbUpd('weeklyReports/'+staleReport._key,{cw,updatedAt:Date.now(),updatedBy:CU.name});
      toast('Report corrected: CW'+staleCW+' → CW'+cw);
      return;
    }
  }
  const existing=(D.weeklyReports||[]).find(r=>r.cw===cw&&r.year===year);
  if(existing&&!confirm(`A report for CW${cw} already exists. Republish/update it?`))return;
  if(existing){
    await fbUpd('weeklyReports/'+existing._key,{updatedAt:Date.now(),updatedBy:CU.name});
    toast('Report updated for CW'+cw);
  } else {
    await fbPush('weeklyReports',{cw,year,publishedAt:Date.now(),publishedBy:CU.name,tlResponses:{},dueFriday:ds(fri)});
    _wrReportIdx=0;
    toast('Weekly report published for CW'+cw+'!');
    await fbSet('broadcast',{msg:'📊 CW'+cw+' Weekly Incident Report is now published. All Leads — please submit your response by '+friLabel+', 5:00 PM.',ts:Date.now(),sentBy:CU.name});
  }
}

async function deleteWeeklyReport(){
  const reports=D.weeklyReports||[];
  if(!reports.length){toast('No reports to delete.');return;}
  const r=reports[_wrReportIdx]||reports[0];
  if(!confirm('Delete the CW'+r.cw+' · '+r.year+' report? This will remove the report and reset the pending-response badge. This cannot be undone.'))return;
  await fbDel('weeklyReports/'+r._key);
  _wrReportIdx=0;
  toast('CW'+r.cw+' report deleted.');
}

async function tlSubmitResponse(reportKey,tlUsername){
  const inp=document.getElementById('wr-resp-'+reportKey);
  if(!inp||!inp.value.trim()){toast('Please write a response first');return;}
  await fbUpd('weeklyReports/'+reportKey+'/tlResponses/'+tlUsername,{text:inp.value.trim(),ts:Date.now(),by:CU.name});
  toast('Response submitted!');
}

async function tlEditResponse(reportKey,tlUsername){
  const resp=(D.weeklyReports||[]).find(r=>r._key===reportKey)?.tlResponses?.[tlUsername];
  const text=prompt('Edit your acknowledgment:',resp?.text||'');
  if(text===null)return;
  await fbUpd('weeklyReports/'+reportKey+'/tlResponses/'+tlUsername,{text:text.trim(),ts:Date.now(),by:CU.name});
  toast('Response updated');
}

function wrToggleRespDetail(rKey){
  const panel=document.getElementById('wr-resp-detail-'+rKey);
  const arrow=document.getElementById('wr-resp-arrow-'+rKey);
  if(!panel)return;
  const isOpen=panel.classList.toggle('open');
  if(arrow)arrow.style.transform=isOpen?'rotate(180deg)':'rotate(0deg)';
}

async function remindPendingLeads(reportKey){
  const report=(D.weeklyReports||[]).find(r=>r._key===reportKey);
  if(!report)return;
  const responses=report.tlResponses||{};
  const coveredCW=Math.max(1,report.cw-1);
  const coveredWD=getWeekDatesForCW(coveredCW,report.year||now().getFullYear());
  const coveredInc=getIncidentsForWeek(D.incidents||[],coveredWD);
  const LEAD_ORDER_R=['Team Lead','Assist. Manager','Manager','HOD'];
  function leadHasIncidentR(tl){
    return coveredInc.some(i=>{
      if((i.cdmTL||'')=== tl.name)return true;
      const tagged=i.tagged||[];
      if(tagged.includes(tl.username))return true;
      return tagged.some(u=>{const member=D.members.find(m=>m.username===u);return member&&member.reportsTo===tl.username;});
    });
  }
  const pending=D.members.filter(m=>m.approved&&m.active!==false&&LEAD_ROLES.includes(m.role)&&!responses[m.username]&&leadHasIncidentR(m));
  if(!pending.length){toast('All leads with incidents have responded!');return;}
  const names=pending.map(m=>m.name).join(', ');
  const due=report.dueFriday?new Date(report.dueFriday+'T17:00:00').toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'})+' 5:00 PM':'Friday 5:00 PM';
  await fbSet('broadcast',{msg:'📊 Reminder: CW'+report.cw+' Weekly Report response still pending from: '+names+'. Please respond by '+due+'.',ts:Date.now(),sentBy:CU.name});
  toast('Reminder sent to '+pending.length+' lead'+(pending.length>1?'s':'')+'!');
}

function getIncidentWeekDates(refDate){
  // Get Mon-Sun of the week containing refDate
  const d=refDate?new Date(refDate+'T12:00:00'):now();
  const day=d.getDay();
  const diff=day===0?-6:1-day;
  const mon=new Date(d);mon.setDate(d.getDate()+diff);
  const dates=[];
  for(let i=0;i<7;i++){const x=new Date(mon);x.setDate(mon.getDate()+i);dates.push(ds(x));}
  return dates;
}

function buildIncidentSummary(incidents, weekOffset){
  const allInc=incidents||[];
  weekOffset=weekOffset||0;

  // Compute the reference Monday based on offset
  const today=now();
  const dayOfWeek=today.getDay();
  const diff=dayOfWeek===0?-6:1-dayOfWeek;
  const thisMon=new Date(today);thisMon.setDate(today.getDate()+diff);thisMon.setHours(0,0,0,0);

  // Build 4-week windows: current week + 3 past weeks (no future)
  const windowStart=weekOffset-3;
  const windowEnd=weekOffset;

  // Only count real/manual incidents — exclude auto-escalated lead task compliance incidents (_leadTaskEsc)
  const realInc=allInc.filter(function(i){return !i._leadTaskEsc;});
  const weekCols=[];
  for(let w=windowStart;w<=windowEnd;w++){
    const mon=new Date(thisMon);mon.setDate(thisMon.getDate()+w*7);
    const sun=new Date(mon);sun.setDate(mon.getDate()+6);
    const weekStart=ds(mon),weekEnd=ds(sun);
    const weekInc=realInc.filter(function(i){const d=i.incidentDate||i.date;return d>=weekStart&&d<=weekEnd;});
    const isCurrent=w===0;
    weekCols.push({w,mon,sun,weekStart,weekEnd,weekInc,isCurrent});
  }

  // Header label helper
  function wkLabel(col){
    const monLabel=col.mon.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
    const sunLabel=col.sun.toLocaleDateString('en-PH',{month:'short',day:'numeric'});
    const cw=getWeekNumber(col.weekStart);
    return 'CW'+cw+'<br><span style="font-size:9px;font-weight:400;color:#93c5fd">'+monLabel+' – '+sunLabel+'</span>'+(col.isCurrent?'<br><span style="font-size:9px;font-weight:700;color:#fbbf24">★ current</span>':'');
  }

  // Build list of all members (CDMs) who have at least one incident across the 4 weeks
  // Filter by selected team lead if set
  const _incSumTLFilter=window._incSumTLFilter||'';
  const allWeekInc=weekCols.reduce(function(s,col){return s.concat(col.weekInc);},[]);
  // Collect unique CDM names with incidents
  const cdmSet={};
  allWeekInc.forEach(function(i){
    const cdm=i.cdm||'';
    const tl=i.cdmTL||'—';
    if(!cdm)return;
    if(_incSumTLFilter&&tl!==_incSumTLFilter)return;
    if(!cdmSet[cdm])cdmSet[cdm]={cdm,tl};
  });
  const cdmList=Object.values(cdmSet).sort(function(a,b){
    return a.tl.localeCompare(b.tl)||a.cdm.localeCompare(b.cdm);
  });

  // Build available TL options for filter dropdown
  const tlSet={};
  allWeekInc.forEach(function(i){if(i.cdmTL)tlSet[i.cdmTL]=1;});
  const tlOptions=Object.keys(tlSet).sort();
  const tlFilterHtml='<select onchange="window._incSumTLFilter=this.value;renderReports()" style="padding:4px 8px;border:1px solid rgba(255,255,255,.2);border-radius:var(--radius);background:rgba(255,255,255,.1);color:#fff;font-size:12px;cursor:pointer">'
    +'<option value="" style="color:var(--text)">'+(tlOptions.length?'All Teams':'All Teams')+'</option>'
    +tlOptions.map(function(tl){return'<option value="'+tl+'" style="color:var(--text)"'+((_incSumTLFilter===tl)?' selected':'')+'>'+tl+'</option>';}).join('')
  +'</select>';

  // Build rows per CDM member
  const tableRows=cdmList.map(function(row){
    const cells=weekCols.map(function(col){
      // Filter by TL if set
      const colInc=col.weekInc.filter(function(i){
        if(i.cdm!==row.cdm)return false;
        if(_incSumTLFilter&&(i.cdmTL||'—')!==_incSumTLFilter)return false;
        return true;
      });
      const total=colInc.length;
      const bg=col.isCurrent?(total>0?'var(--red-light)':'var(--blue-light)'):(total>0?'#fff5f5':'transparent');
      const inner=total>0
        ?'<div style="font-weight:700;color:var(--red);font-size:12px">'+total+'</div>'
        :'<span style="color:var(--text4)">—</span>';
      return'<td style="text-align:center;background:'+bg+';vertical-align:middle;'+(col.isCurrent?'border-left:2px solid var(--blue);border-right:2px solid var(--blue)':'')+'">'+(col.isCurrent?'<span title="Current week">'+inner+'</span>':inner)+'</td>';
    }).join('');
    const rowTotal=weekCols.reduce(function(s,col){
      return s+col.weekInc.filter(function(i){
        if(i.cdm!==row.cdm)return false;
        if(_incSumTLFilter&&(i.cdmTL||'—')!==_incSumTLFilter)return false;
        return true;
      }).length;
    },0);
    return'<tr>'
      +'<td style="font-weight:600">'+row.cdm+'</td>'
      +'<td style="font-size:11px;color:var(--text3)">'+row.tl+'</td>'
      +cells
      +'<td style="text-align:center;font-weight:700;color:'+(rowTotal>0?'var(--red)':'var(--text4)')+'">'+rowTotal+'</td>'
    +'</tr>';
  }).join('');

  // Grand total row
  const grandCells=weekCols.map(function(col){
    const t=_incSumTLFilter?col.weekInc.filter(function(i){return(i.cdmTL||'—')===_incSumTLFilter;}).length:col.weekInc.length;
    return'<td style="text-align:center;font-weight:700;background:'+(t>0?'var(--red-light)':'transparent')+';color:'+(t>0?'var(--red)':'var(--text4)')+'">'+t+'</td>';
  }).join('');
  const grandTotal=weekCols.reduce(function(s,col){
    return s+(_incSumTLFilter?col.weekInc.filter(function(i){return(i.cdmTL||'—')===_incSumTLFilter;}).length:col.weekInc.length);
  },0);
  const grandRow='<tr style="background:#eef2f7;border-top:2px solid var(--border)">'
    +'<td style="font-weight:700" colspan="2">Grand Total</td>'
    +grandCells
    +'<td style="text-align:center;font-weight:800;color:'+(grandTotal>0?'var(--red)':'var(--text4)')+'">'+grandTotal+'</td>'
  +'</tr>';

  // Column headers
  const colHeaders=weekCols.map(function(col){
    return'<th style="text-align:center;min-width:90px;'+(col.isCurrent?'background:#1d3a6e;border-left:2px solid #60a5fa;border-right:2px solid #60a5fa':'')+'">'
      +wkLabel(col)+'</th>';
  }).join('');

  const currentCol=weekCols.find(function(c){return c.isCurrent;});
  const currentWeekInc=currentCol?(_incSumTLFilter?currentCol.weekInc.filter(function(i){return(i.cdmTL||'—')===_incSumTLFilter;}).length:currentCol.weekInc.length):0;

  return'<div class="tbl-wrap" style="margin-bottom:16px">'
    +'<div style="padding:10px 14px;background:#1e3a5f;color:#fff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'
      +'<span style="font-size:12px;font-weight:700;color:#fff">📋 Incident Summary — Current Week + 3 Past <span style="font-size:10px;font-weight:400;color:#93c5fd">(members with incidents)</span></span>'
      +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
        +tlFilterHtml
        +'<button class="nav-arrow" onclick="_incSumWeekOffset=Math.max(_incSumWeekOffset-1,-30);renderReports()" style="width:24px;height:24px;font-size:12px">&#8592;</button>'
        +'<span style="font-size:11px;color:#93c5fd;min-width:80px;text-align:center">'+currentWeekInc+' incident'+(currentWeekInc!==1?'s':'')+' this week</span>'
        +'<button class="nav-arrow" onclick="_incSumWeekOffset=Math.min(_incSumWeekOffset+1,0);renderReports()" style="width:24px;height:24px;font-size:12px"'+(weekOffset>=0?' disabled style="width:24px;height:24px;font-size:12px;opacity:.3"':'')+'>&#8594;</button>'
        +(weekOffset!==0?'<button class="btn sm" onclick="_incSumWeekOffset=0;renderReports()" style="font-size:11px;margin-left:4px">Reset</button>':'')
      +'</div>'
    +'</div>'
    +'<table class="wr-table"><thead><tr>'
      +'<th class="left" style="min-width:140px">Member (CDM)</th>'
      +'<th class="left" style="min-width:120px">Team Lead</th>'
      +colHeaders
      +'<th style="text-align:center">Total</th>'
    +'</tr></thead>'
    +'<tbody>'+(tableRows||'<tr><td colspan="'+(weekCols.length+3)+'" class="empty-state">No incidents recorded for this period.</td></tr>')+grandRow+'</tbody>'
    +'</table>'
  +'</div>';
}



// ── REPORTS PAGE ──
// ── REPORTS TAB STATE ──

// ── INCIDENT INTELLIGENCE ──



function renderReports(){
  var el=document.getElementById('pg-reports');if(!el)return;
  const reports=D.weeklyReports||[];
  const canSeeReports=CU.isAdmin||isLead();

  function leadHasIncidentInReport(report){
    if(!isLead()||CU.isAdmin)return false;
    const covCW=Math.max(1,report.cw-1);
    const covWD=getWeekDatesForCW(covCW,report.year||now().getFullYear());
    const covInc=getIncidentsForWeek(D.incidents||[],covWD);
    return covInc.some(i=>{
      if((i.cdmTL||'')=== CU.name)return true;
      const tagged=i.tagged||[];
      if(tagged.includes(CU.username))return true;
      return tagged.some(u=>{const member=D.members.find(m=>m.username===u);return member&&member.reportsTo===CU.username;});
    });
  }

  if(_wrReportIdx>=reports.length)_wrReportIdx=0;

  const reportsBlock=(function(){
    if(!reports.length||!canSeeReports)return'<div class="empty-state">No weekly reports published yet.</div>';
    const r=reports[_wrReportIdx];
    const myHasIncidents=leadHasIncidentInReport(r);
    const pendingForMe=isLead()&&!CU.isAdmin&&!(r.tlResponses||{})[CU.username]&&myHasIncidents;
    const totalPending=isLead()&&!CU.isAdmin?reports.filter(x=>!(x.tlResponses||{})[CU.username]&&leadHasIncidentInReport(x)).length:0;
    return '<div class="section-hdr sh-blue" style="display:flex;align-items:center;gap:10px;cursor:default">'
      +'<span>📊 Weekly Reports</span>'
      +(totalPending?'<span style="background:var(--red);color:#fff;padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700">'+totalPending+' pending response</span>':'')
      +'<div style="margin-left:auto;display:flex;align-items:center;gap:6px">'
        +'<button class="nav-arrow" onclick="_wrReportIdx=Math.min(_wrReportIdx+1,'+(reports.length-1)+');renderReports()" '+(reports.length<=1||_wrReportIdx>=reports.length-1?'disabled style="opacity:.3"':'')+' title="Older">&#8592;</button>'
        +'<span style="font-size:12px;font-weight:600;color:var(--text2);min-width:80px;text-align:center">CW'+r.cw+' · '+r.year+'</span>'
        +'<button class="nav-arrow" onclick="_wrReportIdx=Math.max(_wrReportIdx-1,0);renderReports()" '+(_wrReportIdx<=0?'disabled style="opacity:.3"':'')+' title="Newer">&#8594;</button>'
      +'</div>'
    +'</div>'
    +(pendingForMe?'<div class="wr-tl-pending" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px"><div style="font-weight:700;color:#92400e;font-size:13px">⏰ Your response for CW'+r.cw+' is pending</div><span style="font-size:11px;color:var(--text3)">Due Friday 5:00 PM</span></div>':'')
    +'<div>'+buildWeeklyReportHTML(r)+'</div>';
  }());

  // ── Weekly-only view (Incident Intelligence tab removed) ──

  const staleBanner=(function(){
    const curCW=getWeekNumber(ds(now())),curYear=now().getFullYear();
    const stale=(D.weeklyReports||[]).find(r=>r.cw===curCW+1&&r.year===curYear);
    if(!stale||!CU.isAdmin)return'';
    return'<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">'
      +'<div><span style="font-weight:700;color:#92400e">⚠️ Stale report detected</span> '
      +'<span style="font-size:12px;color:var(--text3)">A report is stored as CW'+(curCW+1)+' but the current week is CW'+curCW+'. Click to correct it.</span></div>'
      +'<button class="btn sm warning" onclick="publishWeeklyReport()">Fix CW'+(curCW+1)+' → CW'+curCW+'</button>'
    +'</div>';
  }());

  const tabContent='<div style="margin-bottom:16px">'+reportsBlock+'</div>'+buildIncidentSummary(D.incidents,_incSumWeekOffset);

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Reports</div><div class="page-subtitle">Weekly compliance and performance summaries</div></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
        +(CU.isAdmin?'<button class="btn warning" onclick="publishWeeklyReport()">📊 Publish Weekly Report</button>':'')
      +(CU.isAdmin&&(D.weeklyReports||[]).length?'<button class="btn del" onclick="deleteWeeklyReport()">🗑 Delete This Report</button>':'')
      +'</div>'
    +'</div>'
    +staleBanner
    +tabContent;
}



// ── INCIDENTS ──
let _selTaggedMembers=[];
let _incFrom='',_incTo='',_incShowArchived=false;
let _incViewMode='table'; // 'table' | 'cards'
let _incFltCDM='',_incFltTL='',_incFltStatus='',_incFltSearch='';
let _incSelKeys=new Set(); // keys of selected incidents for admin delete
let _wrReportIdx=0; // index into D.weeklyReports for left/right nav
let _incSumWeekOffset=0; // offset in weeks for incident summary view (0=current)
if(!window._incSumTLFilter)window._incSumTLFilter='';
function renderIncidents(){
  var el=document.getElementById('pg-incidents');if(!el)return;
  try{incRefreshCase();}catch(e){}

  // Filter incidents by role:
  // - Admin sees all EXCEPT _leadTaskEsc that haven't been escalated to governance
  // - Lead sees: all regular incidents + their own _leadTaskEsc entries
  // - Member sees: all regular incidents (no _leadTaskEsc)
  function visibleToMe(i){
    if(i._leadTaskEsc){
      if(CU.isAdmin) return i._govEscalated===true; // admin only sees gov-escalated ones
      if(isLead()) return i._leadOwner===CU.username; // lead sees only their own
      return false; // regular members don't see these
    }
    if(!incCanSee(i))return false; // workflow incidents: members/leads see their own
    return true;
  }

  var allVisible=D.incidents.filter(visibleToMe).filter(function(i){return _incShowArchived?true:!i._archived;});
  var open=allVisible.filter(function(i){return i.status==='Open'&&!i._archived;});
  var esc=allVisible.filter(function(i){return i.status==='Escalated'&&!i._archived;});
  var closed=allVisible.filter(function(i){return i.status==='Resolved'&&!i._archived;});

  function incCard(i){
    var isSpecific=i.incidentType==='Compliance'||i.incidentType==='Merchandise Master'||(i.category&&i.category!=='Others'&&!i.incidentType);
    var taggedHtml=(i.tagged||[]).map(function(u){
      var resp=(i.responses||{})[u]||{action:'Pending'};var myTag=u===CU.username;
      return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">'
        +'<span class="av" style="width:20px;height:20px;font-size:8px">'+ini(getMN(u))+'</span>'
        +'<span style="font-size:12px;font-weight:500">'+getMN(u)+'</span>'
        +'<span class="ack-chip '+resp.action+'">'+resp.action+'</span>'
        +(myTag&&resp.action==='Pending'
          ?'<div style="display:flex;gap:4px">'
            +'<button class="btn sm approve" onclick="respondInc(\''+i._key+'\',\''+u+'\',\'Acknowledged\')">Acknowledge</button>'
            +'<button class="btn sm del" onclick="respondInc(\''+i._key+'\',\''+u+'\',\'Declined\')">Decline</button>'
            +'<button class="btn sm warning" onclick="respondInc(\''+i._key+'\',\''+u+'\',\'Appealed\')">Appeal</button>'
          +'</div>'
          :'')
        +(resp.note?'<span style="font-size:11px;color:var(--text3)">— '+resp.note+'</span>':'')
      +'</div>';
    }).join('');

    // Supervisor note section — leads/managers/HOD can add a note after CDM acknowledges
    var canSupNote=(CU.isAdmin||isLead())&&i.status!=='Resolved';
    var supNoteHtml='';
    if(i.supervisorNote){
      supNoteHtml='<div style="background:var(--blue-light);border:1px solid var(--blue-mid);border-radius:var(--radius);padding:8px 12px;margin-top:8px;font-size:12px">'
        +'<span style="font-weight:700;color:var(--blue);font-size:11px;text-transform:uppercase;letter-spacing:.06em">Supervisor Note</span> '
        +'<span style="color:var(--text2)">'+i.supervisorNote+'</span>'
        +(i.supervisorNoteBy?' <span style="color:var(--text4);font-size:11px">— '+i.supervisorNoteBy+'</span>':'')
      +'</div>';
    }
    if(canSupNote){
      supNoteHtml+='<div style="margin-top:6px;display:flex;gap:6px;align-items:center">'
        +'<input id="supnote-'+i._key+'" type="text" class="finput nb" style="flex:1;padding:5px 9px;font-size:12px" placeholder="'+(i.supervisorNote?'Update supervisor note...':'Add supervisor note / discussion summary...')+'" value="'+(i.supervisorNote||'')+'"/>'
        +'<button class="btn sm teal" onclick="saveSupervisorNote(\''+i._key+'\')">Save Note</button>'
      +'</div>';
    }

    var sevBg=i.severity==='High'?'var(--red-light)':i.severity==='Medium'?'var(--yellow-light)':'var(--green-light)';
    var sevCol=i.severity==='High'?'var(--red)':i.severity==='Medium'?'var(--yellow)':'var(--green)';
    var stBg=i.status==='Open'?'var(--red-light)':i.status==='Escalated'?'var(--orange-light)':'var(--green-light)';
    var stCol=i.status==='Open'?'var(--red)':i.status==='Escalated'?'var(--orange)':'var(--green)';
    var typeBadge=isSpecific?'<span style="font-size:10px;background:'+(i.incidentType==='Compliance'?'var(--purple-light)':'var(--teal-light)')+';color:'+(i.incidentType==='Compliance'?'var(--purple)':'var(--teal)')+';padding:1px 7px;border-radius:20px;font-weight:700;margin-right:4px">'+i.incidentType+'</span>':'';

    // Full detail row — always shown for all incidents
    var detailRow='<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:5px;padding:6px 10px;background:var(--bg);border-radius:var(--radius)">'
      +(i.incidentDate&&i.incidentDate!==i.date?'<span>Incident date: <b>'+i.incidentDate+'</b></span>':'')
      +(i.region?'<span>Region: <b>'+i.region+'</b></span>':'')
      +(i.brand?'<span>Brand: <b>'+i.brand+'</b></span>':'')
      +(i.platform?'<span>Platform: <b>'+i.platform+'</b></span>':'')
      +(i.cdm?'<span>CDM: <b>'+i.cdm+'</b></span>':'')
      +(i.cdmTL?'<span>TL: <b>'+i.cdmTL+'</b></span>':'')
      +(i.classification?'<span>Classification: <b>'+i.classification+'</b></span>':'')
      +(i.remarks?'<span style="color:var(--text3)">Remarks: '+i.remarks+'</span>':'')
    +'</div>';

    return '<div class="incident-card '+(i.severity||'Low')+'" style="'+(i._leadTaskEsc&&!i._govEscalated?'border-left-color:var(--orange)':'')+'">'
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">'
        +'<div style="flex:1">'
          +'<div style="font-weight:700;font-size:13px">'
            +(i._leadTaskEsc?'<span style="font-size:10px;background:var(--orange-light);color:var(--orange);padding:1px 7px;border-radius:20px;font-weight:700;margin-right:5px">'+(i._govEscalated?'🚨 Sent to Governance':'⏱ Task Non-Compliance')+'</span>':'')
            +typeBadge+(i.title||'Incident')
          +'</div>'
          +'<div style="font-size:12px;color:var(--text2);margin:3px 0">'+(i.description||i.issue||'')+'</div>'
          +'<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;margin-top:4px">'
            +'<span style="color:var(--text3)">Logged <b>'+(i.date||'')+'</b> by <b>'+(i.reportedBy||'—')+'</b></span>'
            +'<span style="background:'+sevBg+';color:'+sevCol+';padding:1px 7px;border-radius:20px;font-weight:700">'+(i.severity||'Low')+'</span>'
            +'<span style="background:'+stBg+';color:'+stCol+';padding:1px 7px;border-radius:20px;font-weight:700">'+(i.status||'Open')+'</span>'
            +(i.category?'<span style="background:var(--bg);border:1px solid var(--border);padding:1px 7px;border-radius:20px;font-weight:600">'+i.category+'</span>':'')
          +'</div>'
          +detailRow
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">'
          // Lead's own overdue-task auto-escalation: show Resolve (stays private) + Escalate to Governance
          +(i._leadTaskEsc&&!CU.isAdmin&&isLead()&&i._leadOwner===CU.username&&i.status==='Open'
            ?'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')" title="Mark resolved — stays in your view only">Resolve</button>'
             +'<button class="btn sm del" style="background:var(--orange-light);color:var(--orange);border-color:#fed7aa" onclick="escToGovernance(\''+i._key+'\')" title="Send this to admin for review">🚨 Escalate to Governance</button>'
            :'')
          // Lead's own gov-escalated: lead can still resolve even after escalation
          +(i._leadTaskEsc&&!CU.isAdmin&&isLead()&&i._leadOwner===CU.username&&i._govEscalated&&i.status!=='Resolved'
            ?'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')" title="Mark as resolved">Resolve</button>'
            :'')
          // Normal incidents for admin/lead
          +(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Open'?'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button><button class="btn sm del" onclick="escalateInc(\''+i._key+'\')">Escalate</button>':'')
          +(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Escalated'?'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button><button class="btn sm warning" onclick="keepEscalated(\''+i._key+'\')">Remain Escalated</button>':'')
          // Gov-escalated cards visible to admin: Resolve
          +(i._leadTaskEsc&&i._govEscalated&&CU.isAdmin&&i.status!=='Resolved'?'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button>':'')
          // Archived: admin can unarchive
          +(i._archived&&CU.isAdmin?'<button class="btn sm" onclick="unarchiveIncident(\''+i._key+'\')" style="font-size:11px">↩ Unarchive</button>':'')
        +'</div>'
      +'</div>'
      +(taggedHtml?'<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Tagged Members</div>'+taggedHtml+'</div>':'')
      +(supNoteHtml?'<div style="border-top:1px solid var(--border);padding-top:8px;margin-top:6px">'+supNoteHtml+'</div>':'')
    +'</div>';
  }

  // Archive reminder: show at end of each quarter (months 3, 6, 9, 12 = March, June, September, December)
  const threeMonthsAgo=new Date();threeMonthsAgo.setMonth(threeMonthsAgo.getMonth()-3);
  const threeMonthsAgoStr=ds(threeMonthsAgo);
  const archivable=allVisible.filter(function(i){return i.status==='Resolved'&&i.date&&i.date<=threeMonthsAgoStr&&!i._archived;});
  const currentMonth=new Date().getMonth()+1; // 1-12
  const isQuarterEnd=[3,6,9,12].includes(currentMonth);
  const archiveBanner=archivable.length&&CU.isAdmin
    ?'<div style="background:var(--yellow-light);border:1px solid var(--yellow-mid);border-radius:var(--radius);padding:10px 14px;margin-bottom:14px">'
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">'
        +'<div>'
          +'<div style="font-weight:700;font-size:13px;color:#92400e">📦 '+(isQuarterEnd?'End-of-Quarter Archive Reminder':'Archive Reminder')+'</div>'
          +'<div style="font-size:12px;color:var(--text3);margin-top:2px">'+archivable.length+' resolved incident'+(archivable.length!==1?'s':'')+' are older than 3 months.'+(isQuarterEnd?' This is an end-of-quarter reminder to archive or download these records.':' Consider archiving or downloading these for record-keeping.')+'</div>'
        +'</div>'
        +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
          +'<button class="btn sm success" onclick="downloadArchivableExcel()">&#8595; Download Excel</button>'
          +'<button class="btn sm warning" onclick="archiveOldIncidents()">📦 Archive Now</button>'
        +'</div>'
      +'</div>'
    +'</div>'
    :'';

  // ── Table view builder ──
  function buildIncidentTableViewLegacy(incidents){
    if(!incidents.length) return '<div class="empty-state" style="padding:40px">No incidents found.</div>';

    var memberNames=(D.members||[]).map(function(m){return m.name;});

    // Build CDM and TL filter options
    var cdmSet={},tlSet={};
    incidents.forEach(function(i){if(i.cdm)cdmSet[i.cdm]=1;if(i.cdmTL)tlSet[i.cdmTL]=1;});
    var cdmOpts='<option value="">All CDMs</option>'+Object.keys(cdmSet).sort().map(function(n){return'<option value="'+n+'"'+(n===_incFltCDM?' selected':'')+'>'+n+'</option>';}).join('');
    var tlOpts='<option value="">All Team Leads</option>'+Object.keys(tlSet).sort().map(function(n){return'<option value="'+n+'"'+(n===_incFltTL?' selected':'')+'>'+n+'</option>';}).join('');
    var statusOpts='<option value="">All Status</option>'
      +'<option value="Open"'+ (_incFltStatus==='Open'?' selected':'')+'>Open</option>'
      +'<option value="Escalated"'+(_incFltStatus==='Escalated'?' selected':'')+'>Escalated</option>'
      +'<option value="Resolved"'+(_incFltStatus==='Resolved'?' selected':'')+'>Resolved</option>';

    // Apply sub-filters
    var filtered=incidents.filter(function(i){
      if(_incFltCDM&&i.cdm!==_incFltCDM)return false;
      if(_incFltTL&&i.cdmTL!==_incFltTL)return false;
      if(_incFltStatus&&i.status!==_incFltStatus)return false;
      if(_incFltSearch){var q=_incFltSearch.toLowerCase();var hay=(i.title+' '+(i.issue||i.description||'')+' '+(i.brand||'')+' '+(i.platform||'')+' '+incCdmName(i)+' '+incTlName(i)+' '+(i.classification||'')+' '+(i.remarks||'')).toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });

    function clsColor(s){
      if(!s)return'';
      var sl=s.toLowerCase();
      if(sl.includes('high')||sl.includes('critical'))return'background:var(--red-light);color:var(--red);border:1px solid var(--red-mid)';
      if(sl.includes('medium')||sl.includes('moderate'))return'background:var(--yellow-light);color:#92400e;border:1px solid var(--yellow-mid)';
      if(sl.includes('low'))return'background:var(--green-light);color:var(--green);border:1px solid var(--green-mid)';
      return'background:var(--bg);color:var(--text3);border:1px solid var(--border)';
    }
    function statusStyle(s){
      if(s==='Open')return'background:var(--red-light);color:var(--red);border:1px solid var(--red-mid)';
      if(s==='Escalated')return'background:var(--orange-light);color:var(--orange);border:1px solid #fed7aa';
      if(s==='Resolved')return'background:var(--green-light);color:var(--green);border:1px solid var(--green-mid)';
      return'background:var(--bg);color:var(--text3);border:1px solid var(--border)';
    }
    function cell(txt,extraStyle){
      return'<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:top;font-size:12px;'+(extraStyle||'')+'">'+txt+'</td>';
    }
    function truncCell(txt,maxLen,key){
      if(!txt)return cell('<span style="color:var(--text4)">—</span>');
      var short=txt.length>maxLen?txt.slice(0,maxLen)+'…':txt;
      if(txt.length<=maxLen)return cell(escHtml(txt));
      return cell('<span class="inc-trunc" title="Click to expand">'
        +'<span class="inc-trunc-short" id="ts-'+key+'">'+escHtml(short)
          +'<button onclick="incToggleTrunc(\''+key+'\')" style="margin-left:4px;font-size:10px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0;vertical-align:middle">▼</button>'
        +'</span>'
        +'<span class="inc-trunc-full" id="tf-'+key+'" style="display:none">'+escHtml(txt)
          +'<button onclick="incToggleTrunc(\''+key+'\')" style="margin-left:4px;font-size:10px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0;vertical-align:middle">▲</button>'
        +'</span>'
      +'</span>');
    }

    var rows=filtered.map(function(i,idx){
      var iKey=i._key||('r'+idx);
      var sevStyle=i.severity==='High'?'border-left:3px solid var(--red)':i.severity==='Medium'?'border-left:3px solid var(--yellow)':'border-left:3px solid var(--green)';

      // Action buttons based on role/status
      var actionBtns='';
      if(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Open'){
        actionBtns='<div style="display:flex;flex-direction:column;gap:4px">'
          +'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button>'
          +'<button class="btn sm del" onclick="escalateInc(\''+i._key+'\')">Escalate</button>'
          +'</div>';
      } else if(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Escalated'){
        actionBtns='<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button>';
      } else if(i._leadTaskEsc&&!CU.isAdmin&&isLead()&&i._leadOwner===CU.username&&i.status==='Open'){
        actionBtns='<div style="display:flex;flex-direction:column;gap:4px">'
          +'<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button>'
          +'<button class="btn sm" style="background:var(--orange-light);color:var(--orange);border-color:#fed7aa" onclick="escToGovernance(\''+i._key+'\')">🚨 Escalate</button>'
          +'</div>';
      } else if(i._govEscalated&&CU.isAdmin&&i.status!=='Resolved'){
        actionBtns='<button class="btn sm approve" onclick="resolveInc(\''+i._key+'\')">Resolve</button>';
      }

      // Tagged members + ack status
      var taggedHtml=(i.tagged||[]).length
        ?'<div style="margin-top:6px;font-size:11px;color:var(--text3)">'+(i.tagged||[]).map(function(u){
            var resp=(i.responses||{})[u]||{action:'Pending'};
            var dot=resp.action==='Acknowledged'?'#16a34a':resp.action==='Declined'?'#dc2626':resp.action==='Appealed'?'#ca8a04':'#94a3b8';
            var isMe=u===CU.username&&resp.action==='Pending';
            return'<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 4px 2px 0;padding:2px 7px;border-radius:20px;background:var(--bg);border:1px solid var(--border)">'
              +'<span style="width:6px;height:6px;border-radius:50%;background:'+dot+';flex-shrink:0"></span>'
              +getMN(u)
              +(isMe
                ?'<button onclick="respondInc(\''+i._key+'\',\''+u+'\',\'Acknowledged\')" style="margin-left:4px;font-size:10px;color:var(--green);background:none;border:none;cursor:pointer;padding:0" title="Acknowledge">✓</button>'
                +'<button onclick="respondInc(\''+i._key+'\',\''+u+'\',\'Declined\')" style="font-size:10px;color:var(--red);background:none;border:none;cursor:pointer;padding:0" title="Decline">✕</button>'
                :'')
            +'</span>';
          }).join('')
        +'</div>'
        :'';

      var supervisorNoteHtml='';
      if(i.supervisorNote){
        supervisorNoteHtml='<div style="margin-top:5px;font-size:11px;color:var(--blue);font-style:italic">📝 '+escHtml(i.supervisorNote)+'</div>';
      }

      return'<tr style="'+sevStyle+'">'
        +cell('<span style="font-size:11px;font-weight:600">'+(i.incidentDate||i.date||'—')+'</span>'
          +'<div style="font-size:10px;color:var(--text4);margin-top:1px">Logged: '+(i.date||'—')+'</div>')
        +cell(i.region?'<span style="font-weight:700">'+escHtml(i.region)+'</span>':'<span style="color:var(--text4)">—</span>')
        +cell(i.brand?escHtml(i.brand):'<span style="color:var(--text4)">—</span>','font-weight:500')
        +cell(i.platform?escHtml(i.platform):'<span style="color:var(--text4)">—</span>')
        +cell('<div style="font-weight:600">'+(i.cdm?escHtml(i.cdm):'<span style="color:var(--text4)">—</span>')+'</div>'+taggedHtml)
        +cell(i.cdmTL?'<div style="font-weight:600">'+escHtml(i.cdmTL)+'</div>'+supervisorNoteHtml:'<span style="color:var(--text4)">—</span>')
        +cell(i.classification?'<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;'+clsColor(i.classification)+'">'+escHtml(i.classification)+'</span>'+'<div style="margin-top:3px"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;'+statusStyle(i.status||'Open')+'">'+escHtml(i.status||'Open')+'</span></div>':'<span style="color:var(--text4)">—</span>')
        +truncCell(i.issue||i.description||i.title||'','90','iss-'+iKey)
        +truncCell(i.remarks||'','80','rem-'+iKey)
        +(CU.isAdmin||isLead()?'<td style="padding:8px 10px;border-bottom:1px solid #f1f3f5;vertical-align:top;white-space:nowrap">'+actionBtns+'</td>':'')
      +'</tr>';
    }).join('');

    var colCount=9+(CU.isAdmin||isLead()?1:0); // 9 data cols + optional actions
    var emptyRow=filtered.length?'':'<tr><td colspan="'+colCount+'" class="empty-state" style="padding:32px">No incidents match the current filters.</td></tr>';

    var filterBar='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
      +'<select class="finput nb" style="width:auto;padding:5px 10px;font-size:12px;margin-bottom:0" onchange="_incFltCDM=this.value;renderIncidents()">'+cdmOpts+'</select>'
      +'<select class="finput nb" style="width:auto;padding:5px 10px;font-size:12px;margin-bottom:0" onchange="_incFltTL=this.value;renderIncidents()">'+tlOpts+'</select>'
      +'<select class="finput nb" style="width:auto;padding:5px 10px;font-size:12px;margin-bottom:0" onchange="_incFltStatus=this.value;renderIncidents()">'+statusOpts+'</select>'
      +'<input type="text" class="finput nb" style="width:auto;min-width:180px;padding:5px 10px;font-size:12px;margin-bottom:0" placeholder="🔍 Search issue, brand, CDM…" value="'+escHtml(_incFltSearch||'')+'" oninput="_incFltSearch=this.value;renderIncidents()"/>'
      +(_incFltCDM||_incFltTL||_incFltStatus||_incFltSearch?'<button class="btn sm" onclick="_incFltCDM=\'\';_incFltTL=\'\';_incFltStatus=\'\';_incFltSearch=\'\';renderIncidents()">✕ Clear filters</button>':'')
      +'<span style="font-size:11px;color:var(--text3);margin-left:auto">'+filtered.length+' of '+incidents.length+' incident'+(incidents.length!==1?'s':'')+' shown</span>'
    +'</div>';

    var thStyle='padding:9px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--text3);border-bottom:2px solid var(--border);white-space:nowrap;background:linear-gradient(to bottom,#f8fafc,#f1f5f9)';
    var selCount=_incSelKeys.size;
    var selBanner=CU.isAdmin&&selCount>0
      ?'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--red);border-radius:var(--radius-lg) var(--radius-lg) 0 0;flex-wrap:wrap">'
        +'<span style="font-size:12px;font-weight:700;color:#fff">'+selCount+' incident'+(selCount!==1?'s':'')+' selected</span>'
        +'<button onclick="incDeleteSelected()" style="padding:5px 16px;border:none;border-radius:var(--radius);font-size:12px;font-weight:700;background:#fff;color:var(--red);cursor:pointer">🗑 Delete Selected</button>'
        +'<button onclick="_incSelKeys=new Set();renderIncidents()" style="padding:5px 12px;border:1px solid rgba(255,255,255,.4);border-radius:var(--radius);font-size:11px;font-weight:600;background:transparent;color:#fff;cursor:pointer">✕ Clear selection</button>'
      +'</div>'
      :'';

    return filterBar
      +selBanner
      +'<div style="overflow:auto;max-height:calc(100vh - 310px);border-radius:'+(selCount>0?'0 0':'')+'var(--radius-lg) var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-card)">'
      +'<table style="width:100%;border-collapse:collapse;background:var(--surface)">'
      +'<thead style="position:sticky;top:0;z-index:3"><tr>'
        +(CU.isAdmin?'<th style="'+thStyle+';width:36px;min-width:36px;padding:6px 8px;text-align:center"><input type="checkbox" id="inc-sel-all" style="cursor:pointer;width:14px;height:14px;accent-color:var(--red)" title="Select all" onchange="incSelAll(this.checked)"></th>':'')
        +(function(){if(!window._incSort)window._incSort={col:'incidentDate',dir:-1};function ith(col,label,minW){var s=_incSort.col===col?(_incSort.dir===1?'asc':'desc'):'';return '<th class="sh '+s+'" style="'+thStyle+';min-width:'+(minW||'100px')+'" onclick="if(!window._incSort)window._incSort={col:\'incidentDate\',dir:-1};_incSort.col===\''+col+'\'?_incSort.dir*=-1:(_incSort.col=\''+col+'\',_incSort.dir=1);renderIncidents()">'+label+'</th>';}return ith('incidentDate','Incident Date','105px')+ith('region','Region','55px')+ith('brand','Brand','110px')+ith('platform','Platform','90px')+ith('cdm','CDM','130px')+ith('cdmTL','CDM Team Lead','130px')+ith('classification','Classification','120px')+'<th style="'+thStyle+';min-width:220px">Issue</th><th style="'+thStyle+';min-width:180px">Remarks</th>'+(CU.isAdmin||isLead()?'<th style="'+thStyle+';min-width:90px">Actions</th>':'');})()
      +'</tr></thead>'
      +'<tbody>'+(function(){if(!window._incSort)window._incSort={col:'incidentDate',dir:-1};return filtered.slice().sort(function(a,b){var col=_incSort.col,dir=_incSort.dir;var av=a[col]||'',bv=b[col]||'';return String(av).toLowerCase()<String(bv).toLowerCase()?-dir:String(av).toLowerCase()>String(bv).toLowerCase()?dir:0;}).map(function(i,idx){var iKey=i._key||('r'+idx);var isSel=CU.isAdmin&&_incSelKeys.has(iKey);var sevStyle=(isSel?'background:#fff0f0;outline:2px solid var(--red);outline-offset:-2px;':'')+(i.severity==='High'?'border-left:3px solid var(--red)':i.severity==='Medium'?'border-left:3px solid var(--yellow)':'border-left:3px solid var(--green)');var actionBtns='';if(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Open'){actionBtns='<div style="display:flex;flex-direction:column;gap:4px"><button class="btn sm approve" onclick="resolveInc(\''+iKey+'\')">Resolve</button><button class="btn sm del" onclick="escalateInc(\''+iKey+'\')">Escalate</button></div>';}else if(!i._leadTaskEsc&&(CU.isAdmin||isLead())&&i.status==='Escalated'){actionBtns='<button class="btn sm approve" onclick="resolveInc(\''+iKey+'\')">Resolve</button>';}else if(i._govEscalated&&CU.isAdmin&&i.status!=='Resolved'){actionBtns='<button class="btn sm approve" onclick="resolveInc(\''+iKey+'\')">Resolve</button>';}var taggedHtml=(i.tagged||[]).length?'<div style="margin-top:5px;font-size:10px;color:var(--text3)">'+(i.tagged||[]).map(function(u){var resp=(i.responses||{})[u]||{action:'Pending'};var dot=resp.action==='Acknowledged'?'#16a34a':resp.action==='Declined'?'#dc2626':'#94a3b8';return'<span style="display:inline-flex;align-items:center;gap:3px;margin:1px 3px 1px 0;padding:1px 6px;border-radius:20px;background:var(--bg);border:1px solid var(--border);font-size:10px"><span style="width:5px;height:5px;border-radius:50%;background:'+dot+';flex-shrink:0"></span>'+getMN(u)+'</span>';}).join('')+'</div>':'';var snote=i.supervisorNote?'<div style="margin-top:3px;font-size:10px;color:var(--blue);font-style:italic">'+escHtml(i.supervisorNote)+'</div>':'';return'<tr style="'+sevStyle+'">'+(CU.isAdmin?'<td style="padding:4px 8px;border-bottom:1px solid #f1f3f5;text-align:center;vertical-align:middle;cursor:pointer" onclick="incToggleSel(\''+iKey+'\')"><input type="checkbox" data-inc-key="'+iKey+'" '+(isSel?'checked':'')+' style="cursor:pointer;width:14px;height:14px;accent-color:var(--red)" onclick="event.stopPropagation();incToggleSel(\''+iKey+'\')"></td>':'')+cell('<span style="font-size:11px;font-weight:600">'+(i.incidentDate||i.date||'&#8212;')+'</span><div style="font-size:10px;color:var(--text4);margin-top:1px">Logged: '+(i.date||'&#8212;')+'</div>')+cell(i.region?'<span style="font-weight:700">'+escHtml(i.region)+'</span>':'<span style="color:var(--text4)">&#8212;</span>')+cell(i.brand?escHtml(i.brand):'<span style="color:var(--text4)">&#8212;</span>','font-weight:500')+cell(i.platform?escHtml(i.platform):'<span style="color:var(--text4)">&#8212;</span>')+cell('<div style="font-weight:600">'+(i.cdm?escHtml(i.cdm):'<span style="color:var(--text4)">&#8212;</span>')+'</div>'+taggedHtml)+cell(i.cdmTL?'<div style="font-weight:600">'+escHtml(i.cdmTL)+'</div>'+snote:'<span style="color:var(--text4)">&#8212;</span>')+cell(i.classification?'<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;'+clsColor(i.classification)+'">'+escHtml(i.classification)+'</span><div style="margin-top:3px"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;'+statusStyle(i.status||'Open')+'">'+escHtml(i.status||'Open')+'</span></div>':'<span style="color:var(--text4)">&#8212;</span>')+truncCell(i.issue||i.description||i.title||'','90','iss-'+iKey)+truncCell(i.remarks||'','80','rem-'+iKey)+(CU.isAdmin||isLead()?'<td style="padding:8px 10px;border-bottom:1px solid #f1f3f5;vertical-align:top;white-space:nowrap">'+actionBtns+'</td>':'')+'</tr>';}).join('')})()+emptyRow+'</tbody>'
      +'</table>'
      +'</div>';
  }

// Sub-filters state (persist across re-renders)
  var allNonArchived=allVisible.filter(function(i){return !i._archived;});

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Incident Log</div><div class="page-subtitle">Acknowledge, coach and close — one record, one source of truth</div></div>'
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
        // View toggle
        +'<div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;flex-shrink:0">'
          +'<button onclick="_incViewMode=\'table\';renderIncidents()" style="padding:5px 12px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:'+(_incViewMode!=='cards'?'var(--blue)':'var(--surface)')+';color:'+(_incViewMode!=='cards'?'#fff':'var(--text2)')+'" title="Table view">⊞ Table</button>'
          +'<button onclick="_incViewMode=\'cards\';renderIncidents()" style="padding:5px 12px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:'+(_incViewMode==='cards'?'var(--blue)':'var(--surface)')+';color:'+(_incViewMode==='cards'?'#fff':'var(--text2)')+'" title="Card view">☰ Cards</button>'
        +'</div>'
        +'<button class="btn sm" onclick="downloadIncidentTemplate()">&#11015; Template</button>'
        +'<button class="btn sm teal" onclick="document.getElementById(\'inc-import-f\').click()">&#11014; Import Excel</button>'
        +'<input type="file" id="inc-import-f" accept=".xlsx,.xls" style="display:none" onchange="importIncidentExcel(event)"/>'
        +'<button class="btn sm" onclick="exportIncidents()">Export Excel</button>'
        +(CU.isAdmin?'<button class="btn sm" onclick="toggleArchivedIncidents()" id="inc-archive-btn">📦 '+((_incShowArchived)?'Hide Archived':'View Archived')+'</button>':'')
        +(CU.isAdmin?'<button class="btn sm del" onclick="clearAllIncidents()" title="Remove all logged incidents permanently">🗑 Clear All Incidents</button>':'')
        +'<button class="btn sm success" onclick="syncIncidentsToReports()" title="Push latest incidents into the Reports tab tables">🔄 Sync to Reports</button>'
        +'<button class="btn primary" onclick="openIncidentForm()">+ Log Incident</button>'
      +'</div>'
    +'</div>'
    +incSummaryCards(allVisible.filter(function(i){return !i._archived;}))
    +archiveBanner
    +'<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
      +'<label class="flabel" style="display:inline;margin-bottom:0">From</label>'
      +'<input type="date" id="inc-from" class="finput nb" style="width:auto;margin-bottom:0" value="'+_incFrom+'" onchange="_incFrom=this.value;renderIncidents()"/>'
      +'<label class="flabel" style="display:inline;margin-bottom:0">To</label>'
      +'<input type="date" id="inc-to" class="finput nb" style="width:auto;margin-bottom:0" value="'+(_incTo||ds(now()))+'" onchange="_incTo=this.value;renderIncidents()"/>'
      +'<button class="btn sm" onclick="_incFrom=\'\';_incTo=\'\';renderIncidents()">Clear</button>'
    +'</div>'
    +(_incShowArchived
      ?'<div class="section-hdr sh-gray" style="margin-bottom:8px">📦 Archived Incidents <span style="opacity:.7">('+allVisible.filter(function(i){return i._archived;}).length+')</span></div>'
        +(_incViewMode==='cards'
          ?allVisible.filter(function(i){return i._archived;}).map(incCard).join('')
          :buildIncidentTableView(allVisible.filter(function(i){return i._archived;})))
        +'<hr style="border:none;border-top:1px solid var(--border);margin:16px 0"/>'
      :'')
    +(!allNonArchived.length
      ?'<div class="empty-state">No incidents logged yet.</div>'
      :(_incViewMode==='cards'
        // ── CARD MODE (original) ──
        ?(open.length?'<div class="section-hdr sh-red">Open ('+open.length+')</div>'+open.map(incCard).join(''):'')
          +(esc.length?'<div class="section-hdr sh-orange">Escalated ('+esc.length+')</div>'+esc.map(incCard).join(''):'')
          +(closed.length?'<div class="section-hdr sh-green">Resolved ('+closed.length+')</div>'+closed.map(incCard).join(''):'')
        // ── TABLE MODE ──
        : buildIncidentTableView(allNonArchived)
      )
    );
}

// ── SYNC: push incident data into Reports tab ──
function syncIncidentsToReports(){
  // Re-render reports with fresh incident data
  var reportsEl=document.getElementById('pg-reports');
  if(reportsEl){
    renderReports();
  }
  // Switch to the Reports tab so user can see the result
  showPage('reports');
  toast('✅ Synced! Incidents are now reflected in the Reports tab.');
}

// Helper: toggle truncated text in incident table
function incToggleTrunc(key){
  var s=document.getElementById('ts-'+key),f=document.getElementById('tf-'+key);
  if(s&&f){var hidden=f.style.display==='none';s.style.display=hidden?'none':'';f.style.display=hidden?'':'none';}
}


function exportIncidentsLegacy(){
  const from=document.getElementById('inc-from')?.value;
  const to=document.getElementById('inc-to')?.value||ds(now());
  const filtered=D.incidents.filter(i=>(!from||i.date>=from)&&i.date<=to&&!i._archived);
  const ws=XLSX.utils.json_to_sheet(filtered.map(i=>({
    'Log Date':i.date,'Incident Date':i.incidentDate||i.date,
    Type:i.incidentType||'General',Title:i.title,Severity:i.severity,
    Category:i.category,Region:i.region||'',Brand:i.brand||'',
    Platform:i.platform||'',CDM:incCdmName(i),
    'CDM Team Lead':incTlName(i),Classification:i.classification||'',
    Issue:i.issue||i.description||'',Remarks:i.remarks||'',
    Status:i.status,'Reported By':i.reportedBy,
    'Tagged':(i.tagged||[]).map(getMN).join(', '),
    'Supervisor Note':i.supervisorNote||''
  })));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Incidents');
  XLSX.writeFile(wb,`GovernanceHub_Incidents_${ds(now())}.xlsx`);
  toast(`Exported ${filtered.length} incident(s)`);
}

function toggleArchivedIncidents(){
  _incShowArchived=!_incShowArchived;
  renderIncidents();
}

async function archiveOldIncidents(){
  if(!CU.isAdmin){toast('Admin only');return;}
  const threeMonthsAgo=new Date();threeMonthsAgo.setMonth(threeMonthsAgo.getMonth()-3);
  const cutoff=ds(threeMonthsAgo);
  const toArchive=(D.incidents||[]).filter(function(i){return i.status==='Resolved'&&i.date&&i.date<=cutoff&&!i._archived;});
  if(!toArchive.length){toast('No incidents to archive');return;}
  if(!confirm('Archive '+toArchive.length+' resolved incident(s) older than 3 months? They will be hidden from the main view but can still be accessed via "View Archived".'))return;
  for(const i of toArchive){
    await fbUpd('incidents/'+i._key,{_archived:true,_archivedAt:Date.now(),_archivedBy:CU.name});
  }
  toast('Archived '+toArchive.length+' incident(s)');
}

function downloadArchivableExcel(){
  const threeMonthsAgo=new Date();threeMonthsAgo.setMonth(threeMonthsAgo.getMonth()-3);
  const cutoff=ds(threeMonthsAgo);
  const toDownload=(D.incidents||[]).filter(function(i){return i.status==='Resolved'&&i.date&&i.date<=cutoff&&!i._archived;});
  if(!toDownload.length){toast('No archivable incidents found');return;}
  const ws=XLSX.utils.json_to_sheet(toDownload.map(function(i){return{
    'Log Date':i.date,'Incident Date':i.incidentDate||i.date,
    Type:i.incidentType||'General',Title:i.title,Severity:i.severity,
    Category:i.category,Region:i.region||'',Brand:i.brand||'',
    Platform:i.platform||'',CDM:incCdmName(i),
    'CDM Team Lead':incTlName(i),Classification:i.classification||'',
    Issue:i.issue||i.description||'',Remarks:i.remarks||'',
    Status:i.status,'Reported By':i.reportedBy,
    'Tagged':(i.tagged||[]).map(getMN).join(', '),
    'Supervisor Note':i.supervisorNote||''
  };}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Archivable Incidents');
  XLSX.writeFile(wb,'GovernanceHub_ArchivableIncidents_'+ds(now())+'.xlsx');
  toast('Downloaded '+toDownload.length+' archivable incident(s)!');
}

async function clearAllIncidents(){
  if(!CU.isAdmin){toast('Admin only');return;}
  const count=(D.incidents||[]).length;
  if(!count){toast('No incidents to clear');return;}
  if(!confirm('⚠️ This will permanently delete ALL '+count+' incident(s). This cannot be undone. Are you sure?'))return;
  if(!confirm('Final confirmation: delete all '+count+' incidents?'))return;
  await fbSet('incidents',null);
  _incSelKeys=new Set();
  toast('All incidents cleared ('+count+' removed)');
}

function incToggleSel(key){
  if(!CU.isAdmin)return;
  if(_incSelKeys.has(key))_incSelKeys.delete(key);else _incSelKeys.add(key);
  // Surgical update: checkbox state + row highlight
  const chk=document.querySelector('input[data-inc-key="'+key+'"]');
  if(chk){
    chk.checked=_incSelKeys.has(key);
    const tr=chk.closest('tr');
    if(tr){
      const isSel=_incSelKeys.has(key);
      const baseBorder=tr.style.borderLeft;
      tr.style.cssText=(isSel?'background:#fff0f0;outline:2px solid var(--red);outline-offset:-2px;':'')+(baseBorder?'border-left:'+baseBorder+';':'');
    }
  }
  // Update banner if present, otherwise full re-render to show/hide banner
  const banner=document.getElementById('inc-sel-banner');
  if(banner){
    const cnt=_incSelKeys.size;
    banner.style.display=cnt>0?'flex':'none';
    const lbl=document.getElementById('inc-sel-count');
    if(lbl)lbl.textContent=cnt+' incident'+(cnt!==1?'s':'')+' selected';
  } else {
    renderIncidents();
  }
}

function incSelAll(checked){
  if(!CU.isAdmin)return;
  document.querySelectorAll('input[data-inc-key]').forEach(function(chk){
    const key=chk.dataset.incKey;
    if(checked)_incSelKeys.add(key);else _incSelKeys.delete(key);
    chk.checked=checked;
    const tr=chk.closest('tr');
    if(tr)tr.style.cssText=checked?'background:#fff0f0;outline:2px solid var(--red);outline-offset:-2px;':'';
  });
  const banner=document.getElementById('inc-sel-banner');
  if(banner){
    banner.style.display=_incSelKeys.size>0?'flex':'none';
    const lbl=document.getElementById('inc-sel-count');
    if(lbl)lbl.textContent=_incSelKeys.size+' incident'+(_incSelKeys.size!==1?'s':'')+' selected';
  } else {
    renderIncidents();
  }
}

async function incDeleteSelected(){
  if(!CU.isAdmin){toast('Admin only');return;}
  const keys=Array.from(_incSelKeys);
  if(!keys.length){toast('No incidents selected.');return;}
  if(!confirm('Delete '+keys.length+' selected incident'+(keys.length!==1?'s':'')+' permanently? This cannot be undone.'))return;
  for(const k of keys){await fbDel('incidents/'+k);}
  _incSelKeys=new Set();
  toast(keys.length+' incident'+(keys.length!==1?'s':'')+' deleted.');
}

async function unarchiveIncident(key){
  if(!CU.isAdmin){toast('Admin only');return;}
  await fbUpd('incidents/'+key,{_archived:false,_archivedAt:null,_archivedBy:null});
  toast('Incident unarchived');
}

function downloadIncidentTemplate(){
  const headers=['Incident Date','Log Date','Region','Brand','Platform','CDM','CDM Team Lead','Category','Classification','Issue','Remarks'];
  const example=['2026-04-20','2026-04-20','SG','Brand Name','Lazada','CDM Name','TL Name','Merchandise Master','Duplicate Information','Product listed without required disclosure','For monitoring'];
  const notes=[
    '→ Region: MY PH TH VN ID SG EP',
    '→ Platform: Lazada / Shopee / TikTok / Zalora / Qoo10 / All',
    '→ Category (EXACT): SIS / Listing / Category / Merchandise Master / Compliance / Others',
    '→ Date format: YYYY-MM-DD (e.g. 2026-04-20)',
    '→ Delete this row and the note rows before importing. Keep the header row.',
  ];
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([headers,example,...notes.map(n=>[n])]);
  ws['!cols']=headers.map(()=>({wch:22}));
  XLSX.utils.book_append_sheet(wb,ws,'Incident Template');
  XLSX.writeFile(wb,'Incident_Import_Template.xlsx');
  toast('Template downloaded!');
}

// Parse a date value from Excel — handles serial numbers AND string formats
function parseExcelDate(val){
  if(val===''||val===null||val===undefined)return'';
  // Excel serial number (numeric, e.g. 46930)
  if(typeof val==='number'){
    const excelEpoch=new Date(1899,11,30);
    const d=new Date(excelEpoch.getTime()+Math.round(val)*86400000);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  const s=String(val).trim();
  if(!s)return'';
  // Already YYYY-MM-DD
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  // MM/DD/YYYY or DD/MM/YYYY
  const slash=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(slash){
    const a=parseInt(slash[1]),b=parseInt(slash[2]),yr=slash[3];
    const [mon,day]=a>12?[b,a]:[a,b];
    return yr+'-'+String(mon).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  // Native parse fallback
  const nd=new Date(s);
  if(!isNaN(nd))return nd.getFullYear()+'-'+String(nd.getMonth()+1).padStart(2,'0')+'-'+String(nd.getDate()).padStart(2,'0');
  return s;
}

async function importIncidentExcel(evt){
  const file=evt.target.files[0];if(!file)return;
  evt.target.value='';
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      // raw:true keeps dates as serial numbers so parseExcelDate handles them correctly
      const wb=XLSX.read(e.target.result,{type:'binary',cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
      if(rows.length<2){toast('File empty or no data rows.');return;}
      const header=rows[0].map(h=>String(h).trim());
      const col=h=>header.indexOf(h);
      let added=0,skipped=0,unlinked=0;
      const dataRows=rows.slice(1).filter(r=>{
        const v=String(r[col('Issue')]||r[col('Brand')]||'').trim();
        return v&&!v.startsWith('\u2192');
      });
      const CATS=['SIS','Listing','Category','Merchandise Master','Compliance','Others'];
      for(const row of dataRows){
        const issue=String(row[col('Issue')]||'').trim();
        const brand=String(row[col('Brand')]||'').trim();
        if(!issue&&!brand){skipped++;continue;}
        const cdmName=String(row[col('CDM')]||'').trim();
        const tlName=String(row[col('CDM Team Lead')]||'').trim();
        // Parse dates properly (Excel serial numbers or strings)
        const incidentDate=parseExcelDate(row[col('Incident Date')])||ds(now());
        const logDate=parseExcelDate(row[col('Log Date')])||incidentDate;
        // Read category — must match INCIDENT_CATS exactly
        const rawCat=String(row[col('Category')]||'').trim();
        const category=CATS.includes(rawCat)?rawCat:'Others';
        // Auto-tag CDM and TL by name lookup
        const cdmMember=incMem('',cdmName)||undefined;
        const tlMember=incMem('',tlName)||undefined;
        if(cdmName&&!cdmMember)unlinked++;
        const tagged=[...new Set([cdmMember?.username,tlMember?.username].filter(Boolean))];
        const responses={};tagged.forEach(u=>{responses[u]={action:'Pending'};});
        await fbPush('incidents',{
          title:issue||brand,
          incidentType:'General',
          incidentDate,
          date:logDate,
          severity:'Medium',
          category,
          region:String(row[col('Region')]||'').trim(),
          brand,
          platform:String(row[col('Platform')]||'').trim(),
          cdm:cdmMember?cdmMember.name:cdmName,cdmUser:cdmMember?cdmMember.username:'',
          cdmTL:tlMember?tlMember.name:tlName,cdmTLUser:tlMember?tlMember.username:'',
          classification:String(row[col('Classification')]||'').trim(),
          issue,
          remarks:String(row[col('Remarks')]||'').trim(),
          description:issue,
          reportedBy:CU.name,
          tagged:[],responses:{},
          status:'Open',
          ts:Date.now(),
          importedFrom:'excel',
          ...(await incInitFields())
        });
        added++;
      }
      toast('Imported '+added+' incident'+(added!==1?'s':'')+(skipped?' ('+skipped+' skipped)':'')+(unlinked?' — '+unlinked+' CDM name(s) not found in Members; link them in the case view':'')+'!',unlinked?6000:2500);
    }catch(err){toast('Import error: '+err.message);}
  };
  reader.readAsBinaryString(file);
}

function openIncidentFormLegacy(){
  const memberOpts=D.members.filter(m=>m.approved&&m.active!==false&&m.role!=='Talent on Demand').map(m=>`<option value="${m.name}">${m.name} (${m.role})</option>`).join('');
  const tlOpts=D.members.filter(m=>m.approved&&m.active!==false&&['HOD','Manager','Assist. Manager','Team Lead'].includes(m.role)).map(m=>`<option value="${m.name}">${m.name} (${m.role})</option>`).join('');
  document.getElementById('mi-title').textContent='Log Incident';
  document.getElementById('mi-body').innerHTML=`
    <div class="fg fg2">
      <div><label class="flabel">Incident Date</label><input class="finput nb" id="inc-incdate" type="date" value="${ds(now())}"/></div>
      <div><label class="flabel">Region</label>
        <select class="finput nb" id="inc-region"><option value="">— None —</option><option>MY</option><option>PH</option><option>TH</option><option>VN</option><option>ID</option><option>SG</option><option>EP</option></select>
      </div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">Brand</label><input class="finput nb" id="inc-brand" placeholder="Brand name"/></div>
      <div><label class="flabel">Platform</label>
        <select class="finput nb" id="inc-platform"><option value="">— None —</option><option>Lazada</option><option>Shopee</option><option>TikTok</option><option>Zalora</option><option>Qoo10</option><option>All</option></select>
      </div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">CDM</label>
        <select class="finput nb" id="inc-cdm"><option value="">— Select CDM —</option>${memberOpts}</select>
      </div>
      <div><label class="flabel">CDM Team Lead</label>
        <select class="finput nb" id="inc-cdmtl"><option value="">— Select Team Lead —</option>${tlOpts}</select>
      </div>
    </div>
    <div class="fg fg3">
      <div><label class="flabel">Category</label>
        <select class="finput nb" id="inc-category"><option value="">— Select Category —</option>${INCIDENT_CATS.map(c=>`<option>${c}</option>`).join('')}</select>
      </div>
      <div><label class="flabel">Classification</label><input class="finput nb" id="inc-classification" placeholder="e.g. Policy Violation, Wrong Category..."/></div>
      <div><label class="flabel">Log Date</label><input class="finput nb" id="inc-logdate" type="date" value="${ds(now())}"/></div>
    </div>
    <div class="fg"><label class="flabel">Issue / Finding</label><textarea class="finput" id="inc-issue" rows="2" placeholder="Describe the specific issue found..."></textarea></div>
    <div class="fg"><label class="flabel">Remarks</label><textarea class="finput" id="inc-remarks" rows="2" placeholder="Additional remarks, context, actions taken..."></textarea></div>
    <div class="form-actions">
      <button class="btn primary" onclick="saveIncident()">Log Incident</button>
      <button class="btn" onclick="closeModal('modal-incident')">Cancel</button>
    </div>`;
  openModal('modal-incident');
}

async function saveIncidentLegacy(){
  const logDate=document.getElementById('inc-logdate')?.value||ds(now());
  const incDate=document.getElementById('inc-incdate')?.value||logDate;
  const issue=document.getElementById('inc-issue')?.value.trim()||'';
  const brand=document.getElementById('inc-brand')?.value.trim()||'';
  if(!issue&&!brand){toast('Issue / Finding or Brand is required');return;}
  const payload={
    title:issue||brand,
    incidentType:'General',
    incidentDate:incDate,
    date:logDate,
    severity:'Medium',
    category:document.getElementById('inc-category')?.value||'Others',
    region:document.getElementById('inc-region')?.value||'',
    brand,
    platform:document.getElementById('inc-platform')?.value||'',
    cdm:document.getElementById('inc-cdm')?.value||'',
    cdmTL:document.getElementById('inc-cdmtl')?.value||'',
    classification:document.getElementById('inc-classification')?.value.trim()||'',
    issue,
    description:issue,
    remarks:document.getElementById('inc-remarks')?.value.trim()||'',
    reportedBy:CU.name,
    tagged:[],responses:{},status:'Open',ts:Date.now()
  };
  await fbPush('incidents',payload);
  closeModal('modal-incident');
  toast('Incident logged');
}
// ══════════════════════════════════════════════════════════════════════
// INCIDENT WORKFLOW (additive layer): Acknowledge → Coach → Close
// All new fields are additive. Legacy incidents (no `wf` field) still render
// through derived fallbacks, so no Firebase cleanup is needed.
// ══════════════════════════════════════════════════════════════════════
const INC_WF_STAGES=['For Acknowledgement','For Coaching','For Closure','Closed'];
// Deadline rules are data: each incident stores deadlineRule + deadlineAt, so the rule
// (or an individual due date) can later be made configurable without a data migration.
const INC_DEADLINE_RULES={weekly:{dow:5,h:16,m:0}}; // Friday 4:00 PM
const INC_SENIOR=['HOD','Manager','Assist. Manager'];
let _incFltComp='',_incCaseKey=null,_incCaseSig='',_incDraft={},_incAppealOpen=false,_incBusy=false;

// ── CDM / Team Lead always resolve from the Members tab (by username; name kept only as a fallback/label) ──
function incMem(user,name){
  var ms=D.members||[],m=user&&ms.find(function(x){return x.username===user;});if(m)return m;
  var n=(name||'').trim().toLowerCase();return n?ms.find(function(x){return x.name&&x.name.trim().toLowerCase()===n;})||null:null;
}
function incCdmM(i){return incMem(i.cdmUser,i.cdm);}
function incTlM(i){return incMem(i.cdmTLUser,i.cdmTL);}
function incCdmName(i){var m=incCdmM(i);return m?m.name:(i.cdm||'');}
function incTlName(i){var m=incTlM(i);return m?m.name:(i.cdmTL||'');}
function incCdmUser(i){var m=incCdmM(i);return m?m.username:'';}
function incTlUser(i){var m=incTlM(i);return m?m.username:'';}
function incMemberOpts(tlOnly,sel){
  return '<option value="">— Select —</option>'+(D.members||[]).filter(function(m){return m.approved&&m.active!==false&&(tlOnly?LEAD_ROLES.includes(m.role):m.role!=='Talent on Demand');}).map(function(m){return '<option value="'+escHtml(m.username)+'"'+(m.username===sel?' selected':'')+'>'+escHtml(m.name)+' ('+escHtml(m.role||'')+')</option>';}).join('');
}
function incLinkUI(i){
  if(!CU.isAdmin||!i.wf)return '';var parts=[];
  [['cdm','CDM',incCdmM(i),i.cdm],['tl','Team Lead',incTlM(i),i.cdmTL]].forEach(function(r){
    if(r[2]||!r[3])return;
    parts.push('<div style="margin:3px 0">'+r[1]+' “'+escHtml(r[3])+'” is not linked to a member in the Members tab. <select id="icf-link-'+r[0]+'" class="finput nb" style="width:auto;display:inline-block;padding:4px 8px;font-size:12px">'+incMemberOpts(r[0]==='tl')+'</select> <button class="btn sm primary" onclick="incLinkMember(\''+i._key+'\',\''+r[0]+'\')">Link</button></div>');
  });
  return parts.length?'<div class="inc-note warn">'+parts.join('')+'</div>':'';
}
function incLinkMember(key,kind){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i)return;var u=incVal('icf-link-'+kind),m=(D.members||[]).find(function(x){return x.username===u;});
  if(!m){toast('Select a member');return;}
  var f=kind==='cdm'?{cdm:m.name,cdmUser:m.username,tagged:[m.username]}:{cdmTL:m.name,cdmTLUser:m.username};
  await incCommit(key,f,{type:'LINKED',text:(kind==='cdm'?'CDM':'Team Lead')+' linked to Members tab: '+m.name+' (by '+CU.name+')'});
  toast('Linked to '+m.name);renderIncCase();
});}
function incGet(k){return (D.incidents||[]).find(function(x){return x._key===k;});}
function incRaw(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function incFmt(ts){if(!ts)return '—';var d=new Date(ts);return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
function incFmtDue(ts){if(!ts)return '—';var d=new Date(ts);return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
function incDV(id){return _incDraft[id]===undefined?'':_incDraft[id];}
function incDS(id,v){_incDraft[id]=v;}

// Next due date for a rule, from a base timestamp (default rule: upcoming Friday 4:00 PM)
function incDeadlineFor(base,rule){
  var c=INC_DEADLINE_RULES[rule]||INC_DEADLINE_RULES.weekly;
  var d=new Date(base);d.setHours(c.h,c.m,0,0);
  d.setDate(d.getDate()+((c.dow-d.getDay()+7)%7));
  if(d.getTime()<=base)d.setDate(d.getDate()+7);
  return d.getTime();
}
async function incNextNo(year){
  year=year||now().getFullYear();var n=null;
  try{var r=await fbRef('meta/incidentCounter/'+year).transaction(function(c){return (c||0)+1;});if(r.committed)n=r.snapshot.val();}catch(e){}
  if(n===null){var mx=0;(D.incidents||[]).forEach(function(i){var m=/^INC-(\d{4})-(\d+)$/.exec(i.incidentNo||'');if(m&&+m[1]===year)mx=Math.max(mx,+m[2]);});n=mx+1;}
  return 'INC-'+year+'-'+String(n).padStart(4,'0');
}
async function incInitFields(){
  var t=Date.now(),tl={};
  tl[fbRef('incidents').push().key]={ts:t,by:CU.name,username:CU.username,type:'LOGGED',text:'Incident logged by '+CU.name};
  return {incidentNo:await incNextNo(),wf:'For Acknowledgement',deadlineRule:'weekly',deadlineAt:incDeadlineFor(t,'weekly'),issuedAt:t,timeline:tl};
}

// ── Derived state (works for legacy records) ──
function incWf(i){return i.wf||(i.status==='Resolved'?'Closed':'For Acknowledgement');}
function incComp(i){
  if(!i.wf||i.cancelled)return 'N/A';
  var w=i.wf;
  if(w==='Closed'||w==='For Closure')return i.lateFlag?'Late':'On Time'; // lateness is preserved permanently
  if(i.appealStatus==='Under Appeal')return 'On Hold';
  return (i.lateFlag||(i.deadlineAt&&Date.now()>i.deadlineAt))?'Overdue':'On Track';
}
function incIsMember(i){return !CU.isAdmin&&!!incCdmUser(i)&&incCdmUser(i)===CU.username;}
function incIsTL(i){return !CU.isAdmin&&isLead()&&(incTlUser(i)===CU.username||INC_SENIOR.indexOf(CU.role)>-1);}
function incCanSee(i){
  if(!i.wf||CU.isAdmin)return true; // legacy records stay visible as before
  if(incCdmUser(i)===CU.username||incTlUser(i)===CU.username||i.reportedBy===CU.name)return true;
  return isLead()&&INC_SENIOR.indexOf(CU.role)>-1;
}

// ── Styles ──
function incPill(txt,bg,fg,bd){return '<span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;background:'+bg+';color:'+fg+';border:1px solid '+bd+'">'+incRaw(txt)+'</span>';}
function incWfPill(w){var m={'For Acknowledgement':['var(--blue-light)','var(--blue)','var(--blue-mid)'],'For Coaching':['var(--purple-light)','var(--purple)','#ddd6fe'],'For Closure':['var(--teal-light)','var(--teal)','#a5f3fc'],'Closed':['var(--green-light)','var(--green)','var(--green-mid)']}[w]||['var(--bg)','var(--text3)','var(--border)'];return incPill(w,m[0],m[1],m[2]);}
function incCompPill(c){var m={'Overdue':['var(--red-light)','var(--red)','var(--red-mid)'],'Late':['var(--orange-light)','var(--orange)','#fed7aa'],'On Time':['var(--green-light)','var(--green)','var(--green-mid)'],'On Track':['var(--blue-light)','var(--blue)','var(--blue-mid)'],'On Hold':['var(--yellow-light)','#92400e','var(--yellow-mid)']}[c]||['var(--bg)','var(--text3)','var(--border)'];return incPill(c,m[0],m[1],m[2]);}

// ── Summary cards ──
function incCardFilter(kind,val){_incFltStatus='';_incFltComp='';if(kind==='wf')_incFltStatus=val;else _incFltComp=val;renderIncidents();}
function incSummaryCards(list){
  var c={open:0,ack:0,coach:0,close:0,over:0,noId:0};
  list.forEach(function(i){var w=incWf(i);if(w!=='Closed')c.open++;if(w==='For Acknowledgement')c.ack++;if(w==='For Coaching')c.coach++;if(w==='For Closure')c.close++;if(incComp(i)==='Overdue')c.over++;if(!i.incidentNo)c.noId++;});
  function card(label,n,color,kind,val){return '<div class="metric-card" style="cursor:pointer;border-top:3px solid '+color+'" onclick="incCardFilter(\''+kind+'\',\''+val+'\')"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">'+label+'</div><div style="font-size:30px;font-weight:800;color:'+color+';line-height:1.2;margin-top:4px">'+n+'</div></div>';}
  return '<div class="metrics-row" style="margin-bottom:16px">'
    +card('Open Incidents',c.open,'var(--blue)','wf','__open')+card('Awaiting Acknowledgement',c.ack,'var(--yellow)','wf','For Acknowledgement')
    +card('Awaiting Coaching',c.coach,'var(--purple)','wf','For Coaching')+card('For Closure',c.close,'var(--teal)','wf','For Closure')
    +card('Overdue',c.over,'var(--red)','comp','Overdue')+'</div>'
    +(CU.isAdmin&&c.noId?'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;margin-bottom:12px;background:var(--yellow-light);border:1px solid var(--yellow-mid);border-radius:var(--radius);font-size:12px"><span>'+c.noId+' existing incident'+(c.noId!==1?'s have':' has')+' no readable Incident ID yet.</span><button class="btn sm warning" onclick="incBackfillIds()">Assign IDs</button></div>':'');
}
async function incBackfillIds(){
  if(!CU.isAdmin)return;
  var list=(D.incidents||[]).filter(function(i){return !i.incidentNo;}).sort(function(a,b){return (a.ts||0)-(b.ts||0);});
  if(!list.length||!confirm('Assign Incident IDs to '+list.length+' existing incident(s)? (Oldest first; no other data changes.)'))return;
  for(var k=0;k<list.length;k++){var y=+((list[k].date||'').slice(0,4))||new Date(list[k].ts||Date.now()).getFullYear();await fbUpd('incidents/'+list[k]._key,{incidentNo:await incNextNo(y)});}
  toast('Assigned '+list.length+' Incident ID(s)');
}

// ── Table (primary operational columns) ──
function buildIncidentTableView(incidents){
  if(!incidents.length)return '<div class="empty-state" style="padding:40px">No incidents found.</div>';
  var E=escHtml,cdmSet={},tlSet={};
  incidents.forEach(function(i){if(incCdmName(i))cdmSet[incCdmName(i)]=1;if(incTlName(i))tlSet[incTlName(i)]=1;});
  function opts(set,cur,all){return '<option value="">'+all+'</option>'+Object.keys(set).sort().map(function(n){return '<option value="'+E(n)+'"'+(n===cur?' selected':'')+'>'+E(n)+'</option>';}).join('');}
  function fixed(list,cur,all){return '<option value="">'+all+'</option>'+list.map(function(v){return '<option value="'+v[0]+'"'+(v[0]===cur?' selected':'')+'>'+v[1]+'</option>';}).join('');}
  var wfOpts=fixed([['__open','Open (not closed)']].concat(INC_WF_STAGES.map(function(s){return [s,s];})).concat([['Escalated','Escalated']]),_incFltStatus,'All Workflow');
  var cpOpts=fixed(['Overdue','Late','On Time','On Track','On Hold','N/A'].map(function(s){return [s,s];}),_incFltComp,'All Compliance');
  var filtered=incidents.filter(function(i){
    var w=incWf(i);
    if(_incFltCDM&&incCdmName(i)!==_incFltCDM)return false;
    if(_incFltTL&&incTlName(i)!==_incFltTL)return false;
    if(_incFltStatus==='__open'){if(w==='Closed')return false;}
    else if(_incFltStatus==='Escalated'){if(i.status!=='Escalated')return false;}
    else if(_incFltStatus&&_incFltStatus!==w)return false;
    if(_incFltComp&&incComp(i)!==_incFltComp)return false;
    if(_incFltSearch){var hay=((i.incidentNo||'')+' '+(i.title||'')+' '+(i.issue||i.description||'')+' '+(i.brand||'')+' '+(i.platform||'')+' '+incCdmName(i)+' '+incTlName(i)+' '+(i.classification||'')+' '+(i.remarks||'')).toLowerCase();if(hay.indexOf(_incFltSearch.toLowerCase())<0)return false;}
    return true;
  });
  if(!window._incSort)window._incSort={col:'incidentDate',dir:-1};
  function sv(i,c){if(c==='wf')return INC_WF_STAGES.indexOf(incWf(i));if(c==='comp')return incComp(i);if(c==='deadlineAt')return i.deadlineAt||0;if(c==='incidentNo')return i.incidentNo||'';return String(i[c]||'').toLowerCase();}
  var sorted=filtered.slice().sort(function(a,b){var x=sv(a,_incSort.col),y=sv(b,_incSort.col);return x<y?-_incSort.dir:x>y?_incSort.dir:0;});
  var thS='padding:9px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--text3);border-bottom:2px solid var(--border);white-space:nowrap;background:linear-gradient(to bottom,#f8fafc,#f1f5f9)';
  function th(col,label,w){if(!col)return '<th style="'+thS+';min-width:'+w+'">'+label+'</th>';var s=_incSort.col===col?(_incSort.dir===1?'asc':'desc'):'';return '<th class="sh '+s+'" style="'+thS+';min-width:'+w+'" onclick="_incSort.col===\''+col+'\'?_incSort.dir*=-1:(_incSort.col=\''+col+'\',_incSort.dir=1);renderIncidents()">'+label+'</th>';}
  function cell(t,x){return '<td style="padding:10px 12px;border-bottom:1px solid #f1f3f5;vertical-align:top;font-size:12px;'+(x||'')+'">'+t+'</td>';}
  var dash='<span style="color:var(--text4)">&#8212;</span>';
  var bc={};(D.incidents||[]).forEach(function(x){if(x.wf&&!x._archived){var b=incBatchKey(x);bc[b]=(bc[b]||0)+1;}});
  var rows=sorted.map(function(i,idx){
    var k=i._key||('r'+idx),w=incWf(i),c=incComp(i),isSel=CU.isAdmin&&_incSelKeys.has(k);
    var edge=c==='Overdue'?'var(--red)':c==='Late'?'var(--orange)':w==='Closed'?'var(--green)':'var(--blue)';
    var rbp=[i.region?'<b>'+E(i.region)+'</b>':'',i.brand?E(i.brand):''].filter(Boolean).join(' · ');
    var issue=i.issue||i.description||i.title||'';
    return '<tr style="'+(isSel?'background:#fff0f0;outline:2px solid var(--red);outline-offset:-2px;':'')+'border-left:3px solid '+edge+'">'
      +(CU.isAdmin?'<td style="padding:4px 8px;border-bottom:1px solid #f1f3f5;text-align:center;vertical-align:middle;cursor:pointer" onclick="incToggleSel(\''+k+'\')"><input type="checkbox" data-inc-key="'+k+'" '+(isSel?'checked':'')+' style="cursor:pointer;width:14px;height:14px;accent-color:var(--red)" onclick="event.stopPropagation();incToggleSel(\''+k+'\')"></td>':'')
      +cell('<b>'+E(i.incidentNo||'—')+'</b>'+(i.wf?(bc[incBatchKey(i)]>1?'<div style="font-size:10px;color:var(--blue);font-weight:600">Batch · '+bc[incBatchKey(i)]+' issues</div>':''):'<div style="font-size:10px;color:var(--text4)">Legacy</div>'),'white-space:nowrap')
      +cell('<b>'+E(i.incidentDate||i.date||'—')+'</b><div style="font-size:10px;color:var(--text4)">Logged: '+E(i.date||'—')+'</div>','white-space:nowrap')
      +cell((rbp||dash)+(i.platform?'<div style="font-size:11px;color:var(--text3)">'+E(i.platform)+'</div>':''))
      +cell(incCdmName(i)?'<b>'+E(incCdmName(i))+'</b>'+(incCdmM(i)?'':'<div style="font-size:10px;color:var(--orange)">⚠ not in Members</div>'):dash)+cell(incTlName(i)?E(incTlName(i)):dash)
      +cell('<div>'+E(issue.length>100?issue.slice(0,100)+'…':issue)+'</div>'+(i.classification?'<div style="margin-top:3px;font-size:10px;font-weight:700;color:var(--text3)">'+E(i.classification)+'</div>':''),'min-width:220px')
      +cell(incWfPill(w)+(i.appealStatus==='Under Appeal'?'<div style="margin-top:3px">'+incPill('UNDER APPEAL','var(--yellow-light)','#92400e','var(--yellow-mid)')+'</div>':'')+(i.status==='Escalated'?'<div style="margin-top:3px">'+incPill('ESCALATED','var(--orange-light)','var(--orange)','#fed7aa')+'</div>':''))
      +cell(incCompPill(c))
      +cell(i.deadlineAt?E(incFmtDue(i.deadlineAt)):dash,'white-space:nowrap')
      +'<td style="padding:8px 10px;border-bottom:1px solid #f1f3f5;vertical-align:top;white-space:nowrap"><button class="btn sm primary" onclick="openIncidentCase(\''+k+'\')">VIEW CASE</button></td></tr>';
  }).join('');
  var sc=_incSelKeys.size;
  var selBanner=CU.isAdmin&&sc>0?'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--red);border-radius:var(--radius-lg) var(--radius-lg) 0 0;flex-wrap:wrap"><span style="font-size:12px;font-weight:700;color:#fff">'+sc+' incident'+(sc!==1?'s':'')+' selected</span><button onclick="incDeleteSelected()" style="padding:5px 16px;border:none;border-radius:var(--radius);font-size:12px;font-weight:700;background:#fff;color:var(--red);cursor:pointer">🗑 Delete Selected</button><button onclick="_incSelKeys=new Set();renderIncidents()" style="padding:5px 12px;border:1px solid rgba(255,255,255,.4);border-radius:var(--radius);font-size:11px;font-weight:600;background:transparent;color:#fff;cursor:pointer">✕ Clear selection</button></div>':'';
  var fs='width:auto;padding:5px 10px;font-size:12px;margin-bottom:0';
  var filterBar='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">'
    +'<select class="finput nb" style="'+fs+'" onchange="_incFltCDM=this.value;renderIncidents()">'+opts(cdmSet,_incFltCDM,'All CDMs')+'</select>'
    +'<select class="finput nb" style="'+fs+'" onchange="_incFltTL=this.value;renderIncidents()">'+opts(tlSet,_incFltTL,'All Team Leads')+'</select>'
    +'<select class="finput nb" style="'+fs+'" onchange="_incFltStatus=this.value;renderIncidents()">'+wfOpts+'</select>'
    +'<select class="finput nb" style="'+fs+'" onchange="_incFltComp=this.value;renderIncidents()">'+cpOpts+'</select>'
    +'<input type="text" class="finput nb" style="'+fs+';min-width:180px" placeholder="🔍 Search ID, issue, brand, CDM…" value="'+E(_incFltSearch||'')+'" oninput="_incFltSearch=this.value;renderIncidents()"/>'
    +(_incFltCDM||_incFltTL||_incFltStatus||_incFltComp||_incFltSearch?'<button class="btn sm" onclick="_incFltCDM=\'\';_incFltTL=\'\';_incFltStatus=\'\';_incFltComp=\'\';_incFltSearch=\'\';renderIncidents()">✕ Clear filters</button>':'')
    +'<span style="font-size:11px;color:var(--text3);margin-left:auto">'+filtered.length+' of '+incidents.length+' incident'+(incidents.length!==1?'s':'')+' shown</span></div>';
  return filterBar+selBanner
    +'<div style="overflow:auto;max-height:calc(100vh - 360px);border-radius:'+(sc>0?'0 0 ':'')+'var(--radius-lg) var(--radius-lg);border:1px solid var(--border);box-shadow:var(--shadow-card)"><table style="width:100%;border-collapse:collapse;background:var(--surface)"><thead style="position:sticky;top:0;z-index:3"><tr>'
    +(CU.isAdmin?'<th style="'+thS+';width:36px;min-width:36px;padding:6px 8px;text-align:center"><input type="checkbox" style="cursor:pointer;width:14px;height:14px;accent-color:var(--red)" title="Select all" onchange="incSelAll(this.checked)"></th>':'')
    +th('incidentNo','Incident ID','110px')+th('incidentDate','Incident Date','105px')+th('',  'Region / Brand / Platform','170px')+th('cdm','CDM','120px')+th('cdmTL','Team Lead','120px')+th('classification','Issue / Classification','220px')+th('wf','Workflow Status','140px')+th('comp','Compliance','100px')+th('deadlineAt','Due Date','150px')+th('','Action','100px')
    +'</tr></thead><tbody>'+rows+(filtered.length?'':'<tr><td colspan="11" class="empty-state" style="padding:32px">No incidents match the current filters.</td></tr>')+'</tbody></table></div>';
}

// ── Mutations (append-only timeline; history preserved) ──
// ── BATCHING: same CDM + brand + incident date = one batch (each issue keeps its own record/ID) ──
function incBatchKey(i){return [(incCdmUser(i)||(i.cdm||'').trim().toLowerCase()),(i.brand||'').trim().toLowerCase(),i.incidentDate||i.date||''].join('|');}
function incBatch(i){
  if(!i.wf)return [i];var k=incBatchKey(i);
  return (D.incidents||[]).filter(function(x){return x.wf&&!x._archived&&incBatchKey(x)===k;}).sort(function(a,b){return String(a.incidentNo||'').localeCompare(String(b.incidentNo||''))||(a.ts||0)-(b.ts||0);});
}
function incCats(list){var m={},o=[];list.forEach(function(x){var c=x.category||'Others';if(!m[c]){m[c]=[];o.push(c);}m[c].push(x);});return o.map(function(c){return {cat:c,items:m[c]};});}
function incAckTargets(i){return incBatch(i).filter(function(x){return incWf(x)==='For Acknowledgement'&&x.appealStatus!=='Under Appeal';});}
function incAid(base,g,groups,same){return (groups.length===1||same)?base:base+'-'+g;}
function incSnip(x){var s=x.issue||x.title||'';return incRaw(s.length>90?s.slice(0,90)+'…':s);}
function incScope(i,w){var b=incBatch(i).filter(function(x){return incWf(x)===w;});return ((incDV('icf-sc')||'Batch')==='Batch'&&b.length>1)?b:[i];}

function incBatchPanel(i){
  var b=incBatch(i);if(b.length<2)return '';
  return '<div class="inc-panel"><div class="inc-ph">BATCH — '+b.length+' ISSUES · '+escHtml(i.brand||'—')+' · '+escHtml(i.incidentDate||'')+'</div>'
    +b.map(function(x){return '<div style="display:flex;gap:10px;align-items:center;padding:6px 8px;border-radius:var(--radius);font-size:12px;'+(x._key===i._key?'background:var(--blue-light);':'cursor:pointer;')+'"'+(x._key===i._key?'':' onclick="openIncidentCase(\''+x._key+'\')"')+'><b style="min-width:105px">'+escHtml(x.incidentNo||'—')+'</b><span style="min-width:110px;font-weight:600;color:var(--text3)">'+escHtml(x.category||'Others')+'</span><span style="flex:1">'+incSnip(x)+'</span>'+incWfPill(incWf(x))+(x.appealStatus==='Under Appeal'?incPill('APPEAL','var(--yellow-light)','#92400e','var(--yellow-mid)'):'')+'</div>';}).join('')
    +'<div class="inc-help">Acknowledgement is answered once per category; coaching and closure apply to the whole batch. Appeals are per incident.</div></div>';
}
function incAckForm(i){
  var tg=incAckTargets(i),gr=incCats(tg),multi=gr.length>1,same=multi&&!!incDV('icf-same'),h='';
  if(tg.length>1)h+='<div class="inc-note"><b>This acknowledgement covers '+tg.length+' incidents</b> ('+gr.map(function(g){return g.cat+' ×'+g.items.length;}).join(', ')+'). It is recorded on each one.</div>';
  if(multi)h+='<label class="inc-chk"><input type="checkbox" id="icf-same" '+(same?'checked':'')+' onchange="incDS(this.id,this.checked);renderIncCase()"/> Same root cause and corrective action for all categories</label>';
  var show=same?[{cat:'All categories',items:tg}]:gr;
  show.forEach(function(g,n){
    var lbl=multi?(' — '+g.cat+' ('+g.items.length+')'):'';
    var list=g.items.length>1||multi?'<div class="inc-help">'+g.items.map(incSnip).join('<br>')+'</div>':'';
    h+='<div class="inc-fld"><label class="flabel">Root Cause'+escHtml(lbl)+'</label><div class="inc-help">What caused '+(multi&&!same?'these issues':'this issue')+'?</div>'+list
      +'<textarea class="finput" id="'+incAid('icf-rc',n,show,same)+'" rows="3" oninput="incDS(this.id,this.value)">'+incRaw(incDV(incAid('icf-rc',n,show,same)))+'</textarea></div>'
      +'<div class="inc-fld"><label class="flabel">Corrective Action / Learning'+escHtml(lbl)+'</label><div class="inc-help">What action will you take to correct or prevent this from recurring?</div>'
      +'<textarea class="finput" id="'+incAid('icf-ca',n,show,same)+'" rows="3" oninput="incDS(this.id,this.value)">'+incRaw(incDV(incAid('icf-ca',n,show,same)))+'</textarea></div>';
  });
  return h;
}
function incCoachReview(i){
  var ct=incBatch(i).filter(function(x){return incWf(x)==='For Coaching';}),seen={},rows='';
  incCats(ct).forEach(function(g){g.items.forEach(function(x){
    var k=g.cat+'|'+(x.ack&&x.ack.rootCause)+'|'+(x.ack&&x.ack.correctiveAction);if(seen[k])return;seen[k]=1;
    rows+='<div style="margin-top:6px"><b>'+escHtml(g.cat)+'</b> ('+g.items.length+')<br><b>Root Cause:</b> '+escHtml(x.ack&&x.ack.rootCause||'')+'<br><b>Corrective Action:</b> '+escHtml(x.ack&&x.ack.correctiveAction||'')+'</div>';});});
  return '<div class="inc-note"><b>Review before coaching</b>'+(ct.length>1?' — this coaching applies to all '+ct.length+' incidents in the batch':'')
    +'<div style="margin-top:4px"><b>Findings:</b><br>'+ct.map(function(x){return escHtml(x.incidentNo||'')+' · '+incSnip(x);}).join('<br>')+'</div>'+rows+'</div>';
}
function incScopeUI(i){
  var n=incBatch(i).filter(function(x){return incWf(x)==='For Closure';}).length;if(n<2)return '';
  var sc=incDV('icf-sc')||'Batch';
  return '<div class="inc-fld"><label class="flabel">Apply close / return to:</label><label class="inc-chk"><input type="radio" name="icf-sc" '+(sc==='Batch'?'checked':'')+' onchange="incDS(\'icf-sc\',\'Batch\')"/> All '+n+' incidents in this batch</label><label class="inc-chk"><input type="radio" name="icf-sc" '+(sc==='One'?'checked':'')+' onchange="incDS(\'icf-sc\',\'One\')"/> This incident only</label><div class="inc-help">Escalate always applies to this incident only.</div></div>';
}

async function incCommitMany(items,summary){
  var up={},t=Date.now();
  items.forEach(function(it){
    Object.keys(it.fields).forEach(function(p){up[it.key+'/'+p]=it.fields[p];});
    up[it.key+'/timeline/'+fbRef('incidents/'+it.key+'/timeline').push().key]=Object.assign({ts:t,by:CU.name,username:CU.username},it.evt);
  });
  setSyncing(1);await fbRef('incidents').update(up);setSyncing(0);
  try{await logAct(0,ds(now()),CU.name,summary||items[0].evt.text,'INCIDENT');}catch(e){}
}
async function incCommit(key,fields,evt){return incCommitMany([{key:key,fields:fields,evt:evt}]);}

function incHistKey(key,bucket){return bucket+'/'+fbRef('incidents/'+key+'/'+bucket).push().key;}
function incVal(id){var e=document.getElementById(id);return e?(e.type==='checkbox'?e.checked:e.value.trim()):'';}
async function incRun(fn){if(_incBusy)return;_incBusy=true;try{await fn();}catch(e){toast('Error: '+e.message,4000);}_incBusy=false;}

function incAcknowledge(key){return incRun(async function(){
  var i=incGet(key);if(!i||incWf(i)!=='For Acknowledgement'||!incIsMember(i)||i.appealStatus==='Under Appeal'){toast('Not available');return;}
  var tg=incAckTargets(i),gr=incCats(tg),same=gr.length>1&&!!incDV('icf-same'),show=same?[{cat:'All categories',items:tg}]:gr,ans={};
  for(var n=0;n<show.length;n++){
    var rc=incVal(incAid('icf-rc',n,show,same)),ca=incVal(incAid('icf-ca',n,show,same));
    if(!rc||!ca){toast('Root Cause and Corrective Action are required'+(show.length>1?' ('+show[n].cat+')':''));return;}
    ans[n]={rc:rc,ca:ca};
  }
  if(!incVal('icf-ackchk')){toast('Please tick the acknowledgement confirmation');return;}
  var t=Date.now();
  var items=tg.map(function(x){
    var n=same?0:gr.findIndex(function(g){return g.cat===(x.category||'Others');}),re=!!x.ackHistory;
    return {key:x._key,fields:{ack:{by:CU.name,username:CU.username,rootCause:ans[n].rc,correctiveAction:ans[n].ca,ts:t,confirmed:true,batchSize:tg.length,batchCategory:x.category||'Others'},wf:'For Coaching',returnNote:null},evt:{type:re?'RE_ACK':'ACK',text:(re?'Re-acknowledged by ':'Acknowledged by ')+CU.name+(tg.length>1?' (batch of '+tg.length+')':'')}};
  });
  await incCommitMany(items,'Acknowledged '+tg.length+' incident(s) — '+CU.name);
  _incDraft={};toast(tg.length>1?tg.length+' incidents acknowledged — moved to Coaching':'Incident acknowledged — moved to Coaching');renderIncCase();
});}

function incOpenAppeal(o){_incAppealOpen=o;renderIncCase();}
function incAppeal(key){return incRun(async function(){
  var i=incGet(key);if(!i||incWf(i)!=='For Acknowledgement'||!incIsMember(i)||i.appealStatus){toast('Not available');return;}
  var r=incVal('icf-apr'),ev=incVal('icf-ape');
  if(!r||!ev){toast('Appeal reason and supporting explanation are required');return;}
  await incCommit(key,{appeal:{status:'Under Appeal',reason:r,evidence:ev,by:CU.name,username:CU.username,ts:Date.now()},appealStatus:'Under Appeal'},{type:'APPEAL',text:'Appeal submitted by '+CU.name+': '+r});
  _incDraft={};_incAppealOpen=false;toast('Appeal submitted');renderIncCase();
});}
function incReviewAppeal(key,accept){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i||i.appealStatus!=='Under Appeal'){toast('Not available');return;}
  var n=incVal('icf-apn');if(!n){toast('Add a review note');return;}
  var t=Date.now(),f={'appeal/status':accept?'Accepted':'Rejected','appeal/reviewedBy':CU.name,'appeal/reviewNote':n,'appeal/reviewedAt':t,appealStatus:accept?'Accepted':'Rejected'};
  if(accept)Object.assign(f,{wf:'Closed',cancelled:true,status:'Resolved',resolvedBy:CU.name,resolvedAt:t,closure:{by:CU.name,username:CU.username,note:n,ts:t,type:'Cancelled — appeal accepted'}});
  await incCommit(key,f,{type:accept?'APPEAL_ACCEPTED':'APPEAL_REJECTED',text:'Appeal '+(accept?'accepted — incident cancelled':'rejected — returned to acknowledgement')+' by '+CU.name});
  _incDraft={};toast('Appeal '+(accept?'accepted':'rejected'));renderIncCase();
});}
function incCoach(key){return incRun(async function(){
  var i=incGet(key);if(!i||incWf(i)!=='For Coaching'||!incIsTL(i)){toast('Not available');return;}
  var tg=incBatch(i).filter(function(x){return incWf(x)==='For Coaching'&&incIsTL(x);});
  var cn=incVal('icf-cn'),aa=incVal('icf-aa'),fu=incDV('icf-fu')==='Yes';
  if(!cn||!aa){toast('Coaching Notes and Action Agreed are required');return;}
  if(!incDV('icf-fu')){toast('Select whether follow-up is required');return;}
  if(!incVal('icf-cochk')){toast('Please tick the coaching confirmation');return;}
  var t=Date.now(),rec={by:CU.name,username:CU.username,notes:cn,actionAgreed:aa,followUpRequired:fu,followUpDate:fu?incVal('icf-fud'):'',followUpNote:fu?incVal('icf-fun'):'',ts:t,confirmed:true,batchSize:tg.length};
  await incCommitMany(tg.map(function(x){var re=!!x.coachHistory;return {key:x._key,fields:{coaching:rec,wf:'For Closure',returnNote:null,requiredDoneAt:t,lateFlag:!!(x.lateFlag||(x.deadlineAt&&t>x.deadlineAt))},evt:{type:re?'RE_COACHED':'COACHED',text:(re?'Re-coached — coaching confirmed by ':'Coaching confirmed by ')+CU.name+(tg.length>1?' (batch of '+tg.length+')':'')}};}),'Coaching confirmed for '+tg.length+' incident(s) — '+CU.name);
  _incDraft={};toast(tg.length>1?'Coaching confirmed for '+tg.length+' incidents':'Coaching confirmed — sent to Governance for closure');renderIncCase();
});}
function incClose(key){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i||incWf(i)!=='For Closure'){toast('Not available');return;}
  var n=incVal('icf-gn');if(!n){toast('Governance assessment / closure note is required');return;}
  var tg=incScope(i,'For Closure'),t=Date.now();
  await incCommitMany(tg.map(function(x){return {key:x._key,fields:{wf:'Closed',status:'Resolved',resolvedBy:CU.name,resolvedAt:t,closure:{by:CU.name,username:CU.username,note:n,ts:t,type:'Closed'}},evt:{type:'CLOSED',text:'Incident closed by Governance ('+CU.name+')'}};}),'Closed '+tg.length+' incident(s)');
  _incDraft={};toast(tg.length>1?tg.length+' incidents closed':'Incident closed');renderIncCase();
});}
function incReturn(key){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i||incWf(i)!=='For Closure'){toast('Not available');return;}
  var to=incDV('icf-rt'),n=incVal('icf-gn');
  if(!to){toast('Choose who to return it to (Member or Team Lead)');return;}
  if(!n){toast('A reason is required (use the note box)');return;}
  var tg=incScope(i,'For Closure'),t=Date.now();
  await incCommitMany(tg.map(function(x){
    var f={returnNote:{to:to,reason:n,by:CU.name,ts:t},status:x.status==='Escalated'?'Escalated':'Open'};
    if(x.coaching){f[incHistKey(x._key,'coachHistory')]=Object.assign({},x.coaching,{returnedAt:t,returnReason:n});f.coaching=null;}
    if(to==='Member'){if(x.ack){f[incHistKey(x._key,'ackHistory')]=Object.assign({},x.ack,{returnedAt:t,returnReason:n});f.ack=null;}f.wf='For Acknowledgement';}
    else f.wf='For Coaching';
    return {key:x._key,fields:f,evt:{type:'RETURNED',text:'Returned for clarification to '+to+' by '+CU.name+': '+n}};
  }),'Returned '+tg.length+' incident(s) to '+to);
  _incDraft={};toast('Returned to '+to);renderIncCase();
});}
function incEscalate(key,reason){return incRun(async function(){
  var i=incGet(key);if(!i||!(CU.isAdmin||isLead())||incWf(i)==='Closed'||i.status==='Escalated'){toast('Not available');return;}
  reason=reason||prompt('Escalation reason:');if(!reason)return;
  await incCommit(key,{status:'Escalated',escalatedBy:CU.name,escalatedAt:Date.now(),escalationReason:reason},{type:'ESCALATED',text:'Escalated by '+CU.name+': '+reason});
  toast('Escalated');renderIncCase();
});}
function incReopen(key){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i||incWf(i)!=='Closed'){toast('Not available');return;}
  var r=prompt('Reason for reopening:');if(!r)return;
  var f={status:'Open',resolvedBy:null,resolvedAt:null,cancelled:null,closure:null,wf:i.coaching?'For Closure':'For Acknowledgement'};
  if(i.closure)f[incHistKey(key,'closureHistory')]=Object.assign({},i.closure,{returnedAt:Date.now(),returnReason:r});
  if(i.appealStatus==='Accepted')f.appealStatus='Reopened';
  await incCommit(key,f,{type:'REOPENED',text:'Reopened by '+CU.name+': '+r});
  toast('Incident reopened');renderIncCase();
});}
function incEnrol(key){return incRun(async function(){
  var i=incGet(key);if(!CU.isAdmin||!i||i.wf||i.status==='Resolved'){toast('Not available');return;}
  var t=Date.now(),f={wf:'For Acknowledgement',deadlineRule:'weekly',deadlineAt:incDeadlineFor(t,'weekly'),issuedAt:t};
  if(!i.incidentNo)f.incidentNo=await incNextNo();
  if(!i.timeline)f['timeline/'+fbRef('incidents/'+key+'/timeline').push().key]={ts:i.ts||t,by:i.reportedBy||'—',type:'LOGGED',text:'Incident logged by '+(i.reportedBy||'—')};
  await incCommit(key,f,{type:'ENROLLED',text:'Moved into the acknowledgement workflow by '+CU.name});
  toast('Incident enrolled in workflow');renderIncCase();
});}

// ── Case view ──
function openIncidentCase(key){_incCaseKey=key;_incDraft={};_incAppealOpen=false;renderIncCase();openModal('modal-inc-case');}
function incRefreshCase(){
  var m=document.getElementById('modal-inc-case');if(!_incCaseKey||!m||!m.classList.contains('open'))return;
  var i=incGet(_incCaseKey);if(i&&JSON.stringify(i)!==_incCaseSig)renderIncCase();
}
function incTA(id,label,help,rows){return '<div class="inc-fld"><label class="flabel">'+label+'</label>'+(help?'<div class="inc-help">'+help+'</div>':'')+'<textarea class="finput" id="'+id+'" rows="'+(rows||3)+'" oninput="incDS(this.id,this.value)">'+incRaw(incDV(id))+'</textarea></div>';}
function incChk(id,label){return '<label class="inc-chk"><input type="checkbox" id="'+id+'" '+(incDV(id)?'checked':'')+' onchange="incDS(this.id,this.checked)"/> '+label+'</label>';}
function incRec(lines){return '<div class="inc-rec">'+lines.map(function(l){return '<div class="inc-rec-l">'+l[0]+'</div><div class="inc-rec-v">'+(l[1]?escHtml(l[1]):'—')+'</div>';}).join('')+'</div>';}
function incDone(txt,ts){return '<div class="inc-done">✓ '+incRaw(txt)+'<span>'+incFmt(ts)+'</span></div>';}
function incHist(obj,label,fn){
  var a=Object.values(obj||{}).sort(function(x,y){return (x.ts||0)-(y.ts||0);});if(!a.length)return '';
  return '<details class="inc-hist"><summary>Previous '+label+' ('+a.length+') — preserved</summary>'+a.map(function(h){return '<div class="inc-hist-i">'+fn(h)+'<div class="inc-help">Returned '+incFmt(h.returnedAt)+': '+incRaw(h.returnReason||'')+'</div></div>';}).join('')+'</details>';
}

function renderIncCase(){
  var i=incGet(_incCaseKey),body=document.getElementById('mic-body');if(!i||!body)return;
  _incCaseSig=JSON.stringify(i);
  var E=escHtml,wf=incWf(i),comp=incComp(i),legacy=!i.wf;
  var hdr=[['Incident ID',i.incidentNo||'—'],['Incident Date',i.incidentDate||i.date],['Log Date',i.date],['Region',i.region],['Brand',i.brand],['Platform',i.platform],['Category',i.category],['Classification',i.classification],['CDM',incCdmName(i)],['Team Lead',incTlName(i)],['Reported By',i.reportedBy],['Due',i.deadlineAt?incFmtDue(i.deadlineAt):'—']];
  var h='<div class="inc-top"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="inc-id">'+E(i.incidentNo||'Incident')+'</span>'+incWfPill(wf)+incCompPill(comp)
    +(i.appealStatus==='Under Appeal'?incPill('UNDER APPEAL','var(--yellow-light)','#92400e','var(--yellow-mid)'):'')+(i.status==='Escalated'?incPill('ESCALATED','var(--orange-light)','var(--orange)','#fed7aa'):'')+(legacy?incPill('LEGACY','var(--bg)','var(--text3)','var(--border)'):'')
    +'<span style="margin-left:auto;display:flex;gap:6px">'+((CU.isAdmin||isLead())&&wf!=='Closed'&&i.status!=='Escalated'?'<button class="btn sm del" onclick="incEscalate(\''+i._key+'\')">⚠ Escalate</button>':'')+'</span></div>'
    +'<div class="inc-hgrid">'+hdr.map(function(x){return '<div><div class="inc-help" style="margin:0">'+x[0]+'</div><div style="font-weight:600;font-size:13px">'+(x[1]?E(x[1]):'—')+'</div></div>';}).join('')+'</div></div>';
  // legacy banner
  if(legacy){
    h+='<div class="inc-note">This incident was logged before the workflow upgrade (status: <b>'+E(i.status||'Open')+'</b>). It is displayed as-is; compliance is not tracked.'
      +(CU.isAdmin&&i.status!=='Resolved'?' <button class="btn sm primary" onclick="incEnrol(\''+i._key+'\')">Move into workflow</button>':'')
      +((CU.isAdmin||isLead())&&i.status==='Open'?' <button class="btn sm approve" onclick="resolveInc(\''+i._key+'\');setTimeout(renderIncCase,400)">Resolve (legacy)</button>':'')+'</div>';
  }
  // stepper
  var idx=INC_WF_STAGES.indexOf(wf);
  function st(n,label,s){var cls=idx>s||wf==='Closed'?'done':idx===s?'cur':'pend';return '<div class="inc-st '+cls+'"><div class="inc-st-n">'+(cls==='done'?'✓':n)+'</div><div>'+label+'</div></div>';}
  if(!legacy)h+='<div class="inc-stepper">'+st(1,'MEMBER ACKNOWLEDGEMENT',0)+'<div class="inc-arrow">→</div>'+st(2,'TEAM LEAD COACHING',1)+'<div class="inc-arrow">→</div>'+st(3,'GOVERNANCE CLOSURE',2)+'</div>';
  h+=incLinkUI(i)+incBatchPanel(i);
  // original finding (read-only)
  h+='<div class="inc-panel"><div class="inc-ph">ORIGINAL GOVERNANCE FINDING <span class="inc-lock">🔒 read-only</span></div>'
    +incRec([['Issue / Finding',i.issue||i.description||i.title],['Remarks / Context',i.remarks],['Reported By',i.reportedBy],['Date Logged',i.date+(i.ts?' ('+incFmt(i.ts)+')':'')]])+'</div>';
  if(!legacy){
    // STEP 1
    var s1='';
    if(i.returnNote&&wf==='For Acknowledgement')s1+='<div class="inc-note warn">↩ Returned for clarification by '+E(i.returnNote.by)+': '+E(i.returnNote.reason)+'</div>';
    if(i.ack)s1+=incDone('Acknowledged by '+i.ack.by,i.ack.ts)+incRec([['Root Cause',i.ack.rootCause],['Corrective Action / Learning',i.ack.correctiveAction]]);
    s1+=incHist(i.ackHistory,'acknowledgements',function(a){return '<b>'+incRaw(a.by)+'</b> · '+incFmt(a.ts)+incRec([['Root Cause',a.rootCause],['Corrective Action',a.correctiveAction]]);});
    if(i.appeal)s1+='<div class="inc-note '+(i.appeal.status==='Under Appeal'?'warn':'')+'"><b>Appeal — '+E(i.appeal.status)+'</b> · '+E(i.appeal.by)+' · '+incFmt(i.appeal.ts)+'<br><b>Reason:</b> '+E(i.appeal.reason)+'<br><b>Explanation / evidence:</b> '+E(i.appeal.evidence)+(i.appeal.reviewedBy?'<br><b>Reviewed by '+E(i.appeal.reviewedBy)+' ('+incFmt(i.appeal.reviewedAt)+'):</b> '+E(i.appeal.reviewNote):'')+'</div>';
    if(wf==='For Acknowledgement'){
      if(i.appealStatus==='Under Appeal'){
        s1+=CU.isAdmin?incTA('icf-apn','Appeal Review Note','Required. Explain the decision.',2)+'<div class="inc-actions"><button class="btn success" onclick="incReviewAppeal(\''+i._key+'\',true)">ACCEPT APPEAL</button><button class="btn del" onclick="incReviewAppeal(\''+i._key+'\',false)">REJECT APPEAL</button></div>'
          :'<div class="inc-help">Under review by Governance. The incident is on hold until a decision is made.</div>';
      }else if(incIsMember(i)){
        if(!_incAppealOpen)s1+=incAckForm(i)
          +incChk('icf-ackchk','I acknowledge that I have reviewed and understood this incident.')
          +'<div class="inc-actions"><button class="btn primary" onclick="incAcknowledge(\''+i._key+'\')">ACKNOWLEDGE INCIDENT'+(incAckTargets(i).length>1?'S':'')+'</button>'+(i.appealStatus?'':'<button class="btn" onclick="incOpenAppeal(true)">APPEAL '+(incBatch(i).length>1?'THIS INCIDENT ONLY':'INCIDENT')+'</button>')+'</div>';
        else s1+=incTA('icf-apr','Appeal Reason','Why are you appealing this incident?',2)+incTA('icf-ape','Supporting Explanation / Evidence','Provide the facts or evidence that support your appeal.')
          +'<div class="inc-actions"><button class="btn warning" onclick="incAppeal(\''+i._key+'\')">SUBMIT APPEAL</button><button class="btn" onclick="incOpenAppeal(false)">Back</button></div>';
      }else s1+='<div class="inc-help">Awaiting acknowledgement from <b>'+E(incCdmName(i)||'the assigned CDM')+'</b>.</div>';
    }
    // STEP 2
    var s2='';
    if(i.returnNote&&wf==='For Coaching')s2+='<div class="inc-note warn">↩ Returned for clarification by '+E(i.returnNote.by)+': '+E(i.returnNote.reason)+'</div>';
    if(i.coaching){var c=i.coaching;s2+=incDone('Coaching confirmed by '+c.by,c.ts)+incRec([['Coaching Notes',c.notes],['Action Agreed',c.actionAgreed],['Follow-up Required',c.followUpRequired?'Yes'+(c.followUpDate?' — '+c.followUpDate:'')+(c.followUpNote?' — '+c.followUpNote:''):'No']]);}
    s2+=incHist(i.coachHistory,'coaching records',function(c){return '<b>'+incRaw(c.by)+'</b> · '+incFmt(c.ts)+incRec([['Coaching Notes',c.notes],['Action Agreed',c.actionAgreed]]);});
    if(wf==='For Coaching'){
      if(incIsTL(i)){
        var fu=incDV('icf-fu');
        s2+=incCoachReview(i)
          +incTA('icf-cn','Coaching Notes','What was discussed with the member?')+incTA('icf-aa','Action Agreed','What specific corrective/preventive action was agreed?',2)
          +'<div class="inc-fld"><label class="flabel">Follow-up Required?</label><label class="inc-chk"><input type="radio" name="icf-fu" '+(fu==='Yes'?'checked':'')+' onchange="incDS(\'icf-fu\',\'Yes\');renderIncCase()"/> Yes</label> <label class="inc-chk"><input type="radio" name="icf-fu" '+(fu==='No'?'checked':'')+' onchange="incDS(\'icf-fu\',\'No\');renderIncCase()"/> No</label></div>'
          +(fu==='Yes'?'<div class="fg fg2"><div><label class="flabel">Follow-up Date (optional)</label><input type="date" class="finput nb" id="icf-fud" value="'+incRaw(incDV('icf-fud'))+'" oninput="incDS(this.id,this.value)"/></div><div><label class="flabel">Follow-up Note (optional)</label><input class="finput nb" id="icf-fun" value="'+incRaw(incDV('icf-fun'))+'" oninput="incDS(this.id,this.value)"/></div></div>':'')
          +incChk('icf-cochk','I confirm that this incident has been discussed/coached with the member.')
          +'<div class="inc-actions"><button class="btn primary" onclick="incCoach(\''+i._key+'\')">CONFIRM COACHING</button></div>';
      }else s2+='<div class="inc-help">Awaiting coaching from <b>'+E(incTlName(i)||'the assigned Team Lead')+'</b>.</div>';
    }else if(wf==='For Acknowledgement'&&!i.coaching)s2+='<div class="inc-help">Starts after the member acknowledges.</div>';
    // STEP 3
    var s3='';
    if(i.closure)s3+=incDone((i.cancelled?'Cancelled':'Closed')+' by '+i.closure.by,i.closure.ts)+incRec([['Governance Closure Note',i.closure.note],['Outcome',i.closure.type]]);
    s3+=incHist(i.closureHistory,'closures',function(c){return '<b>'+incRaw(c.by)+'</b> · '+incFmt(c.ts)+incRec([['Closure Note',c.note]]);}).replace(/Returned /g,'Reopened ');
    if(i.requiredDoneAt)s3+='<div class="inc-help">Required actions completed: '+incFmt(i.requiredDoneAt)+' · Deadline: '+incFmtDue(i.deadlineAt)+' · '+incCompPill(comp)+'</div>';
    if(wf==='For Closure'){
      s3+=CU.isAdmin?incTA('icf-gn','Governance Assessment / Closure Note','Required. Used as the reason if returning for clarification or escalating.')
        +incScopeUI(i)+'<div class="inc-fld"><label class="flabel">If returning for clarification, return to:</label><label class="inc-chk"><input type="radio" name="icf-rt" '+(incDV('icf-rt')==='Member'?'checked':'')+' onchange="incDS(\'icf-rt\',\'Member\')"/> Member</label> <label class="inc-chk"><input type="radio" name="icf-rt" '+(incDV('icf-rt')==='Team Lead'?'checked':'')+' onchange="incDS(\'icf-rt\',\'Team Lead\')"/> Team Lead</label></div>'
        +'<div class="inc-actions"><button class="btn success" onclick="incClose(\''+i._key+'\')">✓ CLOSE INCIDENT</button><button class="btn" onclick="incReturn(\''+i._key+'\')">↩ RETURN FOR CLARIFICATION</button>'+(i.status!=='Escalated'?'<button class="btn del" onclick="incEscalate(\''+i._key+'\',incVal(\'icf-gn\'))">⚠ ESCALATE</button>':'')+'</div>'
        :'<div class="inc-help">Awaiting Governance review and closure.</div>';
    }else if(wf==='Closed'&&CU.isAdmin)s3+='<div class="inc-actions"><button class="btn" onclick="incReopen(\''+i._key+'\')">Reopen Incident</button></div>';
    else if(wf!=='Closed')s3+='<div class="inc-help">Starts after coaching is confirmed.</div>';
    function panel(n,t,b,s){return '<div class="inc-panel'+(s===idx||wf==='Closed'&&s===2?' cur':'')+'"><div class="inc-ph">STEP '+n+' — '+t+'</div>'+b+'</div>';}
    h+=panel(1,'MEMBER ACKNOWLEDGEMENT',s1,0)+panel(2,'TEAM LEAD COACHING',s2,1)+panel(3,'GOVERNANCE CLOSURE',s3,2);
  }
  // timeline
  var ev=Object.values(i.timeline||{});
  if(!ev.length){ev=[{ts:i.ts,type:'LOGGED',text:'Incident logged by '+(i.reportedBy||'—')}];if(i.resolvedAt)ev.push({ts:i.resolvedAt,type:'CLOSED',text:'Resolved by '+(i.resolvedBy||'—')});}
  ev.sort(function(a,b){return (a.ts||0)-(b.ts||0);});
  h+='<div class="inc-panel"><div class="inc-ph">ACTIVITY TIMELINE</div><div class="inc-tl">'+ev.map(function(e){return '<div class="inc-tl-i"><div class="inc-tl-t">'+incFmt(e.ts)+'</div><div>'+E(e.text||'')+'</div></div>';}).join('')+'</div></div>';
  body.innerHTML=h;
}

// ── Logging a new incident ──
// ── Log Incident: shared details once, then one block per issue ──
function incIssueRow(){
  return '<div class="inc-row" style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:10px;background:var(--bg)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="inc-help" style="margin:0;font-weight:700;letter-spacing:.08em">ISSUE</span><button class="btn sm del" type="button" onclick="this.closest(\'.inc-row\').remove()">Remove</button></div>'
    +'<div class="fg fg2"><div><label class="flabel">Category</label><select class="finput nb r-cat"><option value="">— Select Category —</option>'+INCIDENT_CATS.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select></div>'
    +'<div><label class="flabel">Classification</label><input class="finput nb r-cls" placeholder="e.g. Policy Violation, Wrong Category..."/></div></div>'
    +'<div class="fg"><label class="flabel">Issue / Finding</label><textarea class="finput r-issue" rows="2" placeholder="Describe the specific issue found..."></textarea></div>'
    +'<div class="fg" style="margin-bottom:0"><label class="flabel">Remarks</label><textarea class="finput r-rem" rows="2" placeholder="Additional remarks, context..."></textarea></div></div>';
}
function incAddIssueRow(){var c=document.getElementById('inc-rows');if(c)c.insertAdjacentHTML('beforeend',incIssueRow());}
function openIncidentForm(){
  const memberOpts=incMemberOpts(false),tlOpts=incMemberOpts(true);
  document.getElementById('mi-title').textContent='Log Incident';
  document.getElementById('mi-body').innerHTML=`
    <div class="fg fg3">
      <div><label class="flabel">Incident Date</label><input class="finput nb" id="inc-incdate" type="date" value="${ds(now())}"/></div>
      <div><label class="flabel">Log Date</label><input class="finput nb" id="inc-logdate" type="date" value="${ds(now())}"/></div>
      <div><label class="flabel">Region</label><select class="finput nb" id="inc-region"><option value="">— None —</option><option>MY</option><option>PH</option><option>TH</option><option>VN</option><option>ID</option><option>SG</option><option>EP</option></select></div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">Brand</label><input class="finput nb" id="inc-brand" placeholder="Brand name"/></div>
      <div><label class="flabel">Platform</label><select class="finput nb" id="inc-platform"><option value="">— None —</option><option>Lazada</option><option>Shopee</option><option>TikTok</option><option>Zalora</option><option>Qoo10</option><option>All</option></select></div>
    </div>
    <div class="fg fg2">
      <div><label class="flabel">CDM</label><select class="finput nb" id="inc-cdm"><option value="">— Select CDM —</option>${memberOpts}</select></div>
      <div><label class="flabel">CDM Team Lead</label><select class="finput nb" id="inc-cdmtl"><option value="">— Select Team Lead —</option>${tlOpts}</select></div>
    </div>
    <div class="inc-help" style="margin:4px 0 8px">Issues for the same CDM, brand and incident date are grouped into one batch, so the member acknowledges them together.</div>
    <div id="inc-rows">${incIssueRow()}</div>
    <button class="btn sm" type="button" onclick="incAddIssueRow()">+ Add another issue</button>
    <div class="form-actions">
      <button class="btn primary" onclick="saveIncident()">Log Incident(s)</button>
      <button class="btn" onclick="closeModal('modal-incident')">Cancel</button>
    </div>`;
  openModal('modal-incident');
}
async function saveIncident(){
  if(_incBusy)return;
  const logDate=document.getElementById('inc-logdate')?.value||ds(now());
  const incDate=document.getElementById('inc-incdate')?.value||logDate;
  const brand=document.getElementById('inc-brand')?.value.trim()||'';
  if(!document.getElementById('inc-cdm')?.value){toast('Select the CDM — the incident is assigned to them for acknowledgement');return;}
  const rows=[...document.querySelectorAll('#inc-rows .inc-row')].map(r=>({
    category:r.querySelector('.r-cat').value||'Others',classification:r.querySelector('.r-cls').value.trim(),
    issue:r.querySelector('.r-issue').value.trim(),remarks:r.querySelector('.r-rem').value.trim()
  })).filter(r=>r.issue);
  if(!rows.length){toast('Enter the Issue / Finding for at least one issue');return;}
  const cdmM=D.members.find(m=>m.username===document.getElementById('inc-cdm')?.value),tlM=D.members.find(m=>m.username===document.getElementById('inc-cdmtl')?.value);
  if(!cdmM){toast('Select a CDM from the Members list');return;}
  _incBusy=true;
  try{
    const ids=[];
    for(const r of rows){
      const payload=Object.assign({
        title:r.issue,incidentType:'General',incidentDate:incDate,date:logDate,severity:'Medium',
        category:r.category,region:document.getElementById('inc-region')?.value||'',brand,
        platform:document.getElementById('inc-platform')?.value||'',
        cdm:cdmM.name,cdmUser:cdmM.username,cdmTL:tlM?tlM.name:'',cdmTLUser:tlM?tlM.username:'',
        classification:r.classification,issue:r.issue,description:r.issue,remarks:r.remarks,
        reportedBy:CU.name,tagged:[cdmM.username],responses:{},status:'Open',ts:Date.now()
      },await incInitFields());
      await fbPush('incidents',payload);ids.push(payload.incidentNo);
    }
    closeModal('modal-incident');
    toast(ids.length>1?ids.length+' incidents logged ('+ids[0]+' – '+ids[ids.length-1]+')':'Incident '+ids[0]+' logged');
  }catch(e){toast('Error: '+e.message,4000);}
  _incBusy=false;
}

// ── Export (existing columns kept; workflow columns appended) ──
function exportIncidents(){
  const from=document.getElementById('inc-from')?.value;
  const to=document.getElementById('inc-to')?.value||ds(now());
  const filtered=D.incidents.filter(i=>(!from||i.date>=from)&&i.date<=to&&!i._archived);
  const ws=XLSX.utils.json_to_sheet(filtered.map(i=>{const c=incComp(i),a=i.ack||{},k=i.coaching||{},z=i.closure||{};return {
    'Log Date':i.date,'Incident Date':i.incidentDate||i.date,
    Type:i.incidentType||'General',Title:i.title,Severity:i.severity,
    Category:i.category,Region:i.region||'',Brand:i.brand||'',
    Platform:i.platform||'',CDM:incCdmName(i),
    'CDM Team Lead':incTlName(i),Classification:i.classification||'',
    Issue:i.issue||i.description||'',Remarks:i.remarks||'',
    Status:i.status,'Reported By':i.reportedBy,
    'Tagged':(i.tagged||[]).map(getMN).join(', '),
    'Supervisor Note':i.supervisorNote||'',
    'Incident ID':i.incidentNo||'','Workflow Status':incWf(i),'Compliance Status':c,
    'Root Cause':a.rootCause||'','Corrective Action':a.correctiveAction||'',
    'Acknowledged By':a.by||'','Acknowledged At':a.ts?incFmt(a.ts):'',
    'Coaching Notes':k.notes||'','Action Agreed':k.actionAgreed||'',
    'Follow-up Required':k.ts?(k.followUpRequired?'Yes':'No'):'',
    'Coached By':k.by||'','Coached At':k.ts?incFmt(k.ts):'',
    'Governance Closure Note':z.note||'','Closed By':z.by||'','Closed At':z.ts?incFmt(z.ts):'',
    'Deadline':i.deadlineAt?incFmt(i.deadlineAt):'',
    'Late / On-Time':c==='Late'?'Late':c==='On Time'?'On Time':'',
    'Appeal Status':i.appealStatus||''
  };}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Incidents');
  XLSX.writeFile(wb,`GovernanceHub_Incidents_${ds(now())}.xlsx`);
  toast(`Exported ${filtered.length} incident(s)`);
}


async function respondInc(key,u,action){
  const note=action==='Appealed'?prompt('Appeal reason (optional):'):'';
  await fbUpd(`incidents/${key}/responses/${u}`,{action,note:note||'',ts:Date.now()});
  await logAct(0,ds(now()),getMN(u),`Incident ${action}`,'INCIDENT');
  toast(`Marked as ${action}`);
}
async function resolveInc(key){var _w=D.incidents.find(function(x){return x._key===key;});if(_w&&_w.wf){openIncidentCase(key);return;}await fbUpd(`incidents/${key}`,{status:'Resolved',resolvedBy:CU.name,resolvedAt:Date.now()});await logAct(0,ds(now()),CU.name,'Incident Resolved','INCIDENT');toast('Resolved');}
async function escalateInc(key){var _w=D.incidents.find(function(x){return x._key===key;});if(_w&&_w.wf){incEscalate(key);return;}await fbUpd(`incidents/${key}`,{status:'Escalated',escalatedBy:CU.name,escalatedAt:Date.now()});await logAct(0,ds(now()),CU.name,'Incident Escalated','INCIDENT');toast('Escalated');}
async function keepEscalated(key){await logAct(0,ds(now()),CU.name,'Remain Escalated','INCIDENT');toast('Logged');}
async function escToGovernance(key){
  const i=D.incidents.find(x=>x._key===key);if(!i)return;
  await fbUpd(`incidents/${key}`,{_govEscalated:true,govEscalatedBy:CU.name,govEscalatedAt:Date.now(),status:'Escalated'});
  await logAct(0,ds(now()),CU.name,'Escalated to Governance: '+i.title,'ESC_GOVERNANCE');
  toast('Sent to Governance — admin can now see this incident.');
}
async function memberEscToGov(key){
  const i=D.incidents.find(x=>x._key===key);if(!i)return;
  const explain=document.getElementById('esc-explain-'+key)?.value.trim();
  if(!explain){toast('Please provide an explanation before escalating');return;}
  await fbUpd(`incidents/${key}`,{_govEscalated:true,govEscalatedBy:CU.name,govEscalatedAt:Date.now(),status:'Escalated',memberExplanation:explain,memberExplainedBy:CU.name});
  await logAct(0,ds(now()),CU.name,'Member Escalated to Governance: '+i.title+' — '+explain,'ESC_GOVERNANCE');
  toast('Escalated to Governance. Admin has been notified.');
}
async function saveSupervisorNote(key){
  const inp=document.getElementById('supnote-'+key);if(!inp)return;
  await fbUpd('incidents/'+key,{supervisorNote:inp.value.trim(),supervisorNoteBy:CU.name,supervisorNotedAt:Date.now()});
  toast('Note saved');
}

// ── MY TASKS (Lead / Manager / HOD / Asst Manager dashboard) ──
function renderMyTasks(){
  const el=document.getElementById('pg-my-tasks');if(!el)return;
  const date=ds(viewDate);
  const myT=allTasks().filter(t=>!(t.inactive)&&(t.assignees||[]).includes(CU.username)&&isSched(t,viewDate));
  const byS={Pending:[],Ongoing:[],'Needs Extension':[],Done:[]};
  myT.forEach(t=>{const s=getMemberStatus(t.id,date,CU.username);if(!byS[s])byS[s]=[];byS[s].push(t);});
  // Self-created personal tasks appear in the dashboard too
  const myPersonalForDash=(D.personalTasks||[]).filter(t=>t._owner===CU.username);
  myPersonalForDash.forEach(t=>{
    const bucket=(t.status==='Done')?'Done':'Pending';
    byS[bucket].push({...t,_isPersonal:true,freq:'personal',deadline:t.dueDate||'',assignees:[]});
  });

  // ── Audit Findings for this user ──
  const myAuditItems=getMyAuditItems();
  const auditFindingsCount=myAuditItems.length;

  // ── Weekly report pending for leads — shows as a task in their dashboard ──
  // Only flag reports where this lead has incidents in the covered week (baseCW-1)
  const pendingReports=isLead()&&!CU.isAdmin?(D.weeklyReports||[]).filter(r=>{
    if((r.tlResponses||{})[CU.username])return false; // already responded
    const covCW=Math.max(1,r.cw-1);
    const covWD=getWeekDatesForCW(covCW,r.year||now().getFullYear());
    const covInc=getIncidentsForWeek(D.incidents||[],covWD);
    return covInc.some(i=>{
      if((i.cdmTL||'')=== CU.name)return true;
      const tagged=i.tagged||[];
      if(tagged.includes(CU.username))return true;
      return tagged.some(u=>{const member=D.members.find(m=>m.username===u);return member&&member.reportsTo===CU.username;});
    });
  }):[];

  // ── Metrics row (6 cards: tasks + audit findings) ──
  const taskDone=byS.Done?.length||0;
  const taskOngoing=byS.Ongoing?.length||0;
  const taskPending=(byS.Pending?.length||0)+pendingReports.length; // include pending WR responses
  const pct=myT.length?Math.round(taskDone/myT.length*100):0;
  // Personal task stats (members only)
  const myPersonalAll=(!CU.isAdmin)?(D.personalTasks||[]).filter(t=>t._owner===CU.username):[];
  const personalDoneCount=myPersonalAll.filter(t=>t.status==='Done').length;
  const personalPendingCount=myPersonalAll.filter(t=>t.status!=='Done').length;
  const metricsHtml=`<div class="metrics-row" style="grid-template-columns:repeat(6,minmax(0,1fr))">
    <div class="metric-card mc-blue"><div class="mc-label">Today's Tasks</div><div class="mc-val">${myT.length}</div></div>
    <div class="metric-card mc-green"><div class="mc-label">Completed</div><div class="mc-val">${taskDone}</div></div>
    <div class="metric-card mc-yellow"><div class="mc-label">Ongoing</div><div class="mc-val">${taskOngoing}</div></div>
    <div class="metric-card mc-red"><div class="mc-label">Pending</div><div class="mc-val">${taskPending}</div></div>
    <div class="metric-card mc-black"><div class="mc-label">Completion Rate</div><div class="mc-val">${pct}%</div></div>
    <div class="metric-card" style="border-color:${auditFindingsCount>0?'var(--red-mid)':'var(--border)'};background:${auditFindingsCount>0?'var(--red-light)':'var(--surface)'}">
      <div class="mc-label" style="color:${auditFindingsCount>0?'var(--red)':'var(--text3)'}">Audit Findings</div>
      <div class="mc-val" style="color:${auditFindingsCount>0?'var(--red)':'var(--text)'}; cursor:${auditFindingsCount>0?'pointer':'default'}" ${auditFindingsCount>0?'onclick="showPage(\'audit\')" title="Click to view audit log"':''}>${auditFindingsCount}</div>
    </div>
  </div>
  <div class="prog-row"><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div><div class="prog-label">${pct}%</div><div style="font-size:11px;color:var(--text3)">${taskDone}/${myT.length} assigned tasks done${myPersonalAll.length?' · '+personalDoneCount+'/'+myPersonalAll.length+' personal tasks done':''}</div></div>`;

  // ── Audit Findings banner (if any pending) ──
  const auditBanner=auditFindingsCount?`<div style="background:var(--yellow-light);border:1px solid var(--yellow-mid);border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div>
      <div style="font-weight:700;font-size:13px;color:#92400e">📋 ${auditFindingsCount} audit finding${auditFindingsCount>1?'s':''} pending your response</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">${myAuditItems.slice(0,4).map(e=>'<b>'+e.brand+'</b> ('+e.region+') — '+e.issueType).join(' · ')}${myAuditItems.length>4?' &amp; more':''}</div>
    </div>
    <button class="btn sm warning" onclick="showPage('audit')">View &amp; Fill →</button>
  </div>`:'';

  const wrBanner=pendingReports.length?`<div style="background:var(--blue-light);border:1px solid var(--blue-mid);border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div>
      <div style="font-weight:700;font-size:13px;color:var(--blue)">📊 ${pendingReports.length} Weekly Incident Report${pendingReports.length>1?'s':''} pending your response</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">${pendingReports.map(r=>{const due=r.dueFriday?(' · Due '+new Date(r.dueFriday+'T17:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})+' 5:00 PM'):'';return'<b>CW'+r.cw+'</b>'+due;}).join(' · ')}</div>
    </div>
    <button class="btn sm primary" onclick="showPage('incidents')">View &amp; Respond →</button>
  </div>`:'';

  // Weekly report task rows (shown inside the task table for leads)
  const wrTaskRows=pendingReports.map(r=>{
    const due=r.dueFriday?new Date(r.dueFriday+'T17:00:00'):null;
    const isOv=due&&due<now();
    const dueLabel=due?due.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})+' 5:00 PM':'Friday 5:00 PM';
    return `<tr class="${isOv?'overdue-row':''}">
      <td>
        <div style="font-weight:600">📊 Weekly Incident Report — CW${r.cw}${isOv?'&nbsp;<span style="color:var(--red);font-size:10px;font-weight:700">OVERDUE</span>':''}</div>
        <span class="freq-chip fc-weekly">weekly</span>
      </td>
      <td><span class="dl-chip${isOv?' overdue':''}">${dueLabel}</span></td>
      <td><span class="sbadge sb-p"><span class="sdot sd-p"></span>Pending</span></td>
      <td><button class="btn sm primary" onclick="showPage('incidents')" style="font-size:11px">Respond →</button></td>
    </tr>`;
  }).join('');  // ── Task sections ──
  // TOD: simple grouped view (no AO widget, no rate bar — they only track attendance)
  // All others (Executive, Lead, Manager, HOD, Asst. Manager): enhanced view with AO widget + rate bar
  const allSorted=[...(byS.Pending||[]),...(byS.Ongoing||[]),...(byS['Needs Extension']||[]),...(byS.Done||[])];
  let secs='';
  if(isTOD()){
    const secCfg=[{k:'Pending',l:'Pending',c:'sh-red'},{k:'Ongoing',l:'Ongoing',c:'sh-yellow'},{k:'Needs Extension',l:'Needs Extension',c:'sh-teal'},{k:'Done',l:'Completed',c:'sh-green'}];
    secs=secCfg.map(sc=>{
      const list=byS[sc.k]||[];if(!list.length)return'';
      const rows=list.map(t=>{
        const mst=getMemberStatus(t.id,date,CU.username),ov=isOverdue(t,date)&&mst!=='Done';
        const extApproved=Object.values(D.extRequests).find(r=>r.taskId==t.id&&r.date===date&&r.memberUsername===CU.username&&r.status==='Approved');
        return `<tr class="${ov&&!extApproved?'overdue-row':''}">
          <td><div style="font-weight:600">${t.title}${ov&&!extApproved?'&nbsp;<span style="color:var(--red);font-size:10px;font-weight:700">OVERDUE</span>':''}</div><span class="freq-chip fc-${t.freq}">${t.freq}</span>${extApproved?`<span style="font-size:10px;color:var(--teal);font-weight:700;margin-left:4px">✓ Extended to ${extApproved.proposedDate}</span>`:''}</td>
          <td><span class="dl-chip${ov&&!extApproved?' overdue':''}">${t.deadline||'—'}</span></td>
          <td>${t.aoLinked||t.frLinked
            ?`<span class="sbadge ${sbc(mst)}" style="cursor:default"><span class="sdot ${sdc(mst)}"></span>${mst}</span>`
            :`<select class="finput nb" style="padding:5px 9px;font-size:12px;width:auto" onchange="myUpdSt(${t.id},'${date}',this.value)">
            <option${mst==='Pending'?' selected':''}>Pending</option><option${mst==='Ongoing'?' selected':''}>Ongoing</option>
            <option${mst==='Needs Extension'?' selected':''}>Needs Extension</option><option${mst==='Done'?' selected':''}>Done</option>
          </select>`}</td>
        </tr>`;
      }).join('');
      return `<div class="section-hdr ${sc.c}">${sc.l} <span style="opacity:.7">(${list.length})</span></div><div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Deadline</th><th>My Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join('');
    if(!secs)secs='<div class="empty-state">No tasks assigned to you for this day.</div>';
  } else {
    // All non-TOD members: enhanced view with AO widget + rate bar + overdue warnings
    // Split tasks: admin-created vs lead-created
    const adminAssigned=allSorted.filter(function(t){return !t._isLeadTask&&!t._isPersonal;});
    const leadAssigned=allSorted.filter(function(t){return t._isLeadTask;});

    function buildTaskRow(t){
      const mst=getMemberStatus(t.id,date,CU.username);
      const ov=isOverdue(t,date)&&mst!=='Done';
      const extApproved=Object.values(D.extRequests).find(r=>r.taskId==t.id&&r.date===date&&r.memberUsername===CU.username&&r.status==='Approved');
      const rate=taskCompletionRate(t.id,date);
      const aoOverdue=t.aoLinked&&ov;
      const frOverdue=t.frLinked&&ov;
      const trackerCell=t.aoLinked
        ?`<div>${buildAOInlineRegions(date)}<button class="btn sm" onclick="showPage('live-trackers')" style="margin-top:4px;font-size:11px">Edit in Tracker →</button></div>`
        :t.frLinked
        ?(function(){
            const frComp=getFRCompletionForTaskObj(t,date);
            const col=frComp.total===0?'var(--text3)':frComp.pct>=100?'var(--green)':frComp.pct>0?'var(--yellow)':'var(--red)';
            const pctLabel=frComp.total?`${frComp.done}/${frComp.total} = ${frComp.pct}%`:'No data';
            return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:13px;font-weight:700;color:${col}">${pctLabel}</span>
              ${frComp.total?`<div style="height:6px;width:80px;background:var(--border);border-radius:4px;overflow:hidden"><div style="height:100%;width:${frComp.pct}%;background:${col};border-radius:4px;transition:width .4s"></div></div>`:''}
            </div>`;
          })()
        :t._isPersonal
        ?`<button class="btn sm del" onclick="deletePersonalTask('${t._key}')" style="font-size:11px">Delete</button>`
        :`${rateBarHtml(rate.pct)}<div style="font-size:10px;color:var(--text3)">${rate.done}/${rate.total} done</div>`;
      return `<tr class="${ov&&!extApproved&&!t._isPersonal?'overdue-row':''}">
        <td>
          <div style="font-weight:600">${t.title}
            ${ov&&!extApproved&&!t._isPersonal?'&nbsp;<span style="color:var(--red);font-size:10px;font-weight:700">OVERDUE</span>':''}
            ${t.aoLinked?'&nbsp;<span style="font-size:10px;background:var(--orange-light);color:var(--orange);padding:1px 6px;border-radius:20px;font-weight:700">📊 Abnormal Orders</span>':''}
            ${t.frLinked?'&nbsp;<span style="font-size:10px;background:var(--blue-light);color:var(--blue);padding:1px 6px;border-radius:20px;font-weight:700">💰 Finance Report</span>':''}
            ${t._isPersonal?'&nbsp;<span style="font-size:10px;background:var(--green-light);color:var(--green);padding:1px 6px;border-radius:20px;font-weight:700">✅ Personal</span>':''}
          </div>
          <span class="freq-chip fc-${t.freq||'other'}">${t.freq||'personal'}</span>
          ${extApproved?`<span style="font-size:10px;color:var(--teal);font-weight:700;margin-left:4px">✓ Extended to ${extApproved.proposedDate}</span>`:''}
          ${aoOverdue?'<div style="font-size:11px;color:var(--red);margin-top:3px;font-weight:600">⚠️ Live tracker not updated on time — please update now</div>':''}
          ${frOverdue?'<div style="font-size:11px;color:var(--red);margin-top:3px;font-weight:600">⚠️ Finance report incomplete — please submit your status below</div>':''}
          ${ov&&!extApproved&&t._isLeadTask&&!t.aoLinked&&!t.frLinked?'<div style="font-size:11px;color:var(--red);margin-top:3px;font-weight:600">⚠️ Task is past its deadline — please update your status</div>':''}
        </td>
        <td><span class="dl-chip${ov&&!extApproved&&!t._isPersonal?' overdue':''}">${t.deadline||'—'}</span></td>
        <td>
          ${t._isPersonal
            ?`<select class="finput nb" style="padding:5px 9px;font-size:12px;width:auto" onchange="updatePersonalTaskStatus('${t._key}',this.value)"><option${(t.status||'Pending')==='Pending'?' selected':''}>Pending</option><option${t.status==='Done'?' selected':''}>Done</option></select>`
            :t.aoLinked
            ?`<span class="sbadge ${sbc(mst)}" style="cursor:default"><span class="sdot ${sdc(mst)}"></span>${mst}</span>`
            :t.frLinked
            ?`<select class="finput nb" style="padding:5px 9px;font-size:12px;width:auto" onchange="myUpdSt(${t.id},'${date}',this.value)">
              <option${mst==='Pending'?' selected':''}>Pending</option>
              <option${mst==='Done'?' selected':''}>Done</option>
              <option${mst==='Needs Extension'?' selected':''}>Needs Extension</option>
            </select>`
            :`<select class="finput nb" style="padding:5px 9px;font-size:12px;width:auto" onchange="myUpdSt(${t.id},'${date}',this.value)">
            <option${mst==='Pending'?' selected':''}>Pending</option>
            <option${mst==='Ongoing'?' selected':''}>Ongoing</option>
            <option${mst==='Needs Extension'?' selected':''}>Needs Extension</option>
            <option${mst==='Done'?' selected':''}>Done</option>
          </select>`}
        </td>
        <td>${trackerCell}</td>
      </tr>`;
    }

    const hasAnyTasks=adminAssigned.length||leadAssigned.length||wrTaskRows;
    if(hasAnyTasks){
      let secParts='';
      // Department-wide tasks section
      if(adminAssigned.length||wrTaskRows){
        secParts+=`<div class="section-hdr sh-gray" style="margin-bottom:6px">🏢 Department-Wide Tasks</div>`;
        secParts+=`<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Deadline</th><th>My Status</th><th>Completion / Tracker</th></tr></thead><tbody>${wrTaskRows}${adminAssigned.map(buildTaskRow).join('')}</tbody></table></div>`;
      }
      // Lead tasks section
      if(leadAssigned.length){
        // Group by lead owner for clarity
        const byLeadOwner={};
        leadAssigned.forEach(function(t){
          const owner=t._leadOwner||'unknown';
          if(!byLeadOwner[owner])byLeadOwner[owner]=[];
          byLeadOwner[owner].push(t);
        });
        secParts+=`<div class="section-hdr sh-purple" style="margin-top:12px;margin-bottom:6px">👥 Lead-Assigned Tasks</div>`;
        Object.entries(byLeadOwner).forEach(function([ownerUN,tasks]){
          secParts+=`<div style="font-size:11px;font-weight:700;color:var(--text3);padding:4px 2px 3px;margin-top:4px">From: ${getMN(ownerUN)}</div>`;
          secParts+=`<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Deadline</th><th>My Status</th><th>Completion</th></tr></thead><tbody>${tasks.map(buildTaskRow).join('')}</tbody></table></div>`;
        });
      }
      secs=secParts;
    } else {
      secs='<div class="empty-state">No tasks assigned to you for this day.</div>';
    }
  }

  // Auto-escalation notification for members — lead tasks that were auto-escalated to incidents
  const myLeadTaskIds=new Set((D.leadTasks||[]).filter(t=>(t.assignees||[]).includes(CU.username)).map(t=>t.id));
  const myEscIncs=(D.incidents||[]).filter(i=>i._leadTaskEsc&&!i._govEscalated&&
    (i._taskId&&myLeadTaskIds.has(i._taskId)||(i.tagged||[]).includes(CU.username)||(i.assignees||[]).includes(CU.username)));
  const escNotifBanner=myEscIncs.length?`<div style="background:var(--orange-light);border:1px solid #fed7aa;border-radius:var(--radius);padding:10px 14px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:18px">⚠️</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px;color:var(--orange)">${myEscIncs.length} Auto-Escalated Incident${myEscIncs.length>1?'s':''} — Action Required</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${myEscIncs.slice(0,3).map(i=>'<b>'+escHtml(i.title)+'</b>').join(' · ')}${myEscIncs.length>3?' &amp; more':''}</div>
      </div>
      <button class="btn sm warning" onclick="showPage('incidents')">View Incidents →</button>
    </div>
    ${myEscIncs.map(i=>`<div style="margin-top:8px;border-top:1px solid #fed7aa;padding-top:8px">
      <div style="font-size:12px;font-weight:600;color:var(--text2)">${escHtml(i.title)}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${i.description||''}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input id="esc-explain-${i._key}" class="finput nb" style="flex:1;min-width:180px;font-size:12px" placeholder="Explain the non-compliance (required before escalating)..."/>
        <button class="btn sm" style="background:var(--orange);color:#fff;border-color:var(--orange);font-size:11px" onclick="memberEscToGov('${i._key}')">Escalate to Governance</button>
      </div>
    </div>`).join('')}
  </div>`:'';

  el.innerHTML=`${wrBanner}${auditBanner}${escNotifBanner}<div class="page-header">
    <div><div class="page-title">Dashboard — ${fmtD(viewDate)}</div><div class="page-subtitle">Overview of today's tasks, compliance, and team activity</div></div>
    <div class="date-nav">
      <button class="nav-arrow" onclick="viewDate.setDate(viewDate.getDate()-1);renderMyTasks()">&#8592;</button>
      ${dateSel(viewDate,"viewDate=new Date(this.value+'T00:00:00');renderMyTasks()")}
      <button class="nav-arrow" onclick="viewDate.setDate(viewDate.getDate()+1);renderMyTasks()">&#8594;</button>
      <button class="btn sm" onclick="openRemind()" style="margin-left:4px">Reminders</button>
    </div>
  </div>
  ${metricsHtml}
  ${secs}
  ${!CU.isAdmin?renderPersonalTasksSection():''}`;
}

function myUpdSt(tid,date,val){smMember(tid,date,CU.username,val);}

// Mark member as Done for an AO task for a specific date — called from AO tracker Done button
async function aoMarkDone(tid,date,btn){
  await smMember(tid,date,CU.username,'Done');
  // Update the button immediately without full re-render
  if(btn){
    btn.textContent='✓ Done';
    btn.style.background='var(--green)';
    btn.style.color='#fff';
    btn.style.border='none';
    btn.style.cursor='default';
    btn.onmouseover=null;
    btn.onmouseout=null;
    btn.onclick=null;
  }
}

function renderPersonalTasksSection(){
  var myPersonal=(D.personalTasks||[]).filter(function(t){return t._owner===CU.username;});
  var done=myPersonal.filter(function(t){return t.status==='Done';}).length;
  var pct=myPersonal.length?Math.round(done/myPersonal.length*100):0;
  var col=pct>=80?'var(--green)':pct>=50?'var(--yellow)':'var(--red)';
  var rows=myPersonal.length?myPersonal.map(function(t){
    var isDone=t.status==='Done';
    return '<tr style="'+(isDone?'opacity:0.55':'')+'"><td style="font-weight:600">'+(isDone?'<s>'+escHtml(t.title)+'</s>':escHtml(t.title))+'</td>'
      +'<td style="font-size:12px;color:var(--text3)">'+(t.note?escHtml(t.note):'—')+'</td>'
      +'<td><select class="finput nb" style="padding:4px 8px;font-size:12px;width:auto" onchange="updatePersonalTaskStatus(\''+t._key+'\',this.value)">'
        +'<option'+(t.status==='Pending'?' selected':'')+'>Pending</option>'
        +'<option'+(t.status==='Done'?' selected':'')+'>Done</option>'
      +'</select></td>'
      +'<td style="white-space:nowrap">'
        +'<button class="btn sm edit" onclick="openPersonalTaskForm(\''+t._key+'\')" style="margin-right:3px">Edit</button>'
        +'<button class="btn sm del" onclick="deletePersonalTask(\''+t._key+'\')">Delete</button>'
      +'</td>'
    +'</tr>';
  }).join(''):'<tr><td colspan="4" class="empty-state">No personal tasks yet. Click "+ Personal Task" to add one.</td></tr>';

  return '<div style="margin-top:16px">'
    +'<div class="section-hdr sh-green" style="margin-bottom:8px">'
      +'✅ My Personal Tasks'
      +(myPersonal.length?' <span style="opacity:.7;font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">('+done+'/'+myPersonal.length+' done)</span>':'')
      +'<div style="margin-left:auto;display:flex;align-items:center;gap:8px">'
        +(myPersonal.length?'<span style="font-size:11px;font-weight:700;color:'+col+'">'+pct+'%</span>':'')
      +'</div>'
    +'</div>'
    +'<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Note</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
  +'</div>';
}

// ── CALENDAR ──
function calKey(d){return`${CU.username}_${d}`.replace(/[.#$\/\[\]]/g,'_');}
function getCalE(d){const k=calKey(d);return D.calEntries[k]?Object.values(D.calEntries[k]):[];}
function getExpandedCalE(d){
  const direct=getCalE(d),dDate=new Date(d+'T00:00:00'),recurring=[];
  for(const[,en]of Object.entries(D.calEntries)){if(!en)continue;for(const[,e]of Object.entries(en)){if(!e.recur||e.recur==='none')continue;const orig=new Date((e.originDate||'2000-01-01')+'T00:00:00');if(orig>=dDate||ds(orig)===d)continue;let match=e.recur==='daily'||(e.recur==='weekly'&&dDate.getDay()===orig.getDay())||(e.recur==='monthly'&&dDate.getDate()===orig.getDate());if(match)recurring.push({...e,_recurring:true});}}
  return[...direct,...recurring];
}
function renderCalendar(){
  const y=calViewDate.getFullYear(),m=calViewDate.getMonth();
  const first=new Date(y,m,1).getDay(),dim=new Date(y,m+1,0).getDate(),tds=ds(now());
  let cells='';
  for(let i=0;i<first;i++)cells+=`<div class="cal-cell other-m"></div>`;
  for(let d=1;d<=dim;d++){const dd=new Date(y,m,d),dds=ds(dd),isT=dds===tds,isSel=selCalDate===dds;const entries=getExpandedCalE(dds);const showAssignedCal=CU.isAdmin||isLead();const myA=showAssignedCal?allTasks().filter(t=>(t.assignees||[]).includes(CU.username)&&isSched(t,dd)):[];const eh=[...myA.slice(0,1).map(t=>`<div class="cal-entry assigned">${t.title}</div>`),...entries.slice(0,2).map(e=>`<div class="cal-entry ${e.type||'personal'}">${e.title}</div>`)].join('');cells+=`<div class="cal-cell${isT?' today':''}${isSel?' sel':''}" onclick="calSel('${dds}')"><span class="cal-date">${d}</span>${eh}</div>`;}
  document.getElementById('pg-calendar').innerHTML=`
    <div class="page-header"><div class="page-title">My Calendar</div><button class="btn primary" onclick="openCalEntry(selCalDate||'${tds}')">+ Add Entry</button></div>
    <div class="cal-wrap" style="margin-bottom:16px"><div class="cal-header"><button class="btn sm" onclick="calViewDate.setMonth(calViewDate.getMonth()-1);renderCalendar()">&#8592;</button><div class="cal-title">${fmtM(calViewDate)}</div><button class="btn sm" onclick="calViewDate.setMonth(calViewDate.getMonth()+1);renderCalendar()">&#8594;</button></div><div class="cal-grid">${DOW.map(d=>`<div class="cal-dh">${d}</div>`).join('')}${cells}</div></div>
    <div id="cal-day-panel">${selCalDate?calDayHTML(selCalDate):'<div class="panel"><div class="empty-state" style="padding:16px">Click any date to view or add entries</div></div>'}</div>`;
}
function calDayHTML(dds){
  const d=new Date(dds+'T00:00:00'),entries=getExpandedCalE(dds);
  const showAssigned=CU.isAdmin||isLead();
  const myA=showAssigned?allTasks().filter(t=>(t.assignees||[]).includes(CU.username)&&isSched(t,d)):[];
  const taskRows=myA.map(t=>{const mst=getMemberStatus(t.id,dds,CU.username);return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><div><div style="font-weight:600;font-size:13px">${t.title}</div><span class="dl-chip" style="font-size:11px">${t.deadline||''}</span></div><span class="sbadge ${sbc(mst)}" style="cursor:default"><span class="sdot ${sdc(mst)}"></span>${mst}</span></div>`;}).join('');
  const personalRows=entries.map(e=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><div><div style="font-weight:600;font-size:13px">${e.title}${e._recurring?' <span style="font-size:10px;color:var(--text3)">(recurring)</span>':''}</div>${e.note?`<div style="font-size:11px;color:var(--text3)">${e.note}</div>`:''}</div><div style="display:flex;align-items:center;gap:5px"><span class="cal-entry ${e.type||'personal'}" style="margin:0">${e.type||'personal'}</span>${e.recur&&e.recur!=='none'?`<span style="font-size:10px;background:var(--purple-light);color:var(--purple);padding:1px 5px;border-radius:20px;font-weight:600">${e.recur}</span>`:''}${!e._recurring?`<button class="btn sm del" onclick="calRemE('${e.originDate||dds}','${e._key}')">&#x2715;</button>`:''}</div></div>`).join('');
  return `<div class="panel"><h3>${fmtD(d)} <button class="btn sm primary" onclick="openCalEntry('${dds}')" style="float:right">+ Add</button></h3>${myA.length?`<div style="margin-bottom:12px"><div class="section-hdr sh-purple" style="margin-bottom:6px">Assigned Tasks</div>${taskRows}</div>`:''}
    <div class="section-hdr sh-blue" style="margin-bottom:6px">Personal Entries</div>${personalRows||'<div style="color:var(--text4);font-size:13px;padding:8px 0">No entries yet.</div>'}
  </div>`;
}
function renderCalDay(dds){const p=document.getElementById('cal-day-panel');if(p)p.innerHTML=calDayHTML(dds);}
function calSel(dds){selCalDate=dds;renderCalendar();}
function openCalEntry(dds){
  if(!dds)dds=ds(now());
  document.getElementById('mc-title').textContent='Add Entry — '+fmtD(new Date(dds+'T00:00:00'));
  document.getElementById('mc-body').innerHTML=`
    <div class="fg"><label class="flabel">Title</label><input class="finput nb" id="ce-t" placeholder="e.g. Submit report, Meeting..."/></div>
    <div class="fg fg2"><div><label class="flabel">Type</label><select class="finput nb" id="ce-type"><option value="personal">Personal to-do</option><option value="reminder">Reminder</option><option value="task">Custom task</option></select></div><div><label class="flabel">Time (optional)</label><input class="finput nb" id="ce-time" placeholder="e.g. 10:00 AM"/></div></div>
    <div class="fg"><label class="flabel">Recurrence</label><select class="finput nb" id="ce-recur"><option value="none">No recurrence</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
    <div class="fg"><label class="flabel">Notes</label><textarea class="finput" id="ce-note" placeholder="Details..."></textarea></div>
    <div class="form-actions"><button class="btn primary" onclick="saveCalE('${dds}')">Save</button><button class="btn" onclick="closeModal('modal-cal')">Cancel</button></div>`;
  openModal('modal-cal');
}
async function saveCalE(dds){
  const title=document.getElementById('ce-t')?.value.trim();if(!title){toast('Title required');return;}
  const type=document.getElementById('ce-type')?.value,time=document.getElementById('ce-time')?.value.trim(),note=document.getElementById('ce-note')?.value.trim(),recur=document.getElementById('ce-recur')?.value||'none';
  await fbPush(`calEntries/${calKey(dds)}`,{title:time?`${title} (${time})`:title,type,note,recur,originDate:dds});
  closeModal('modal-cal');toast('Entry saved');calSel(dds);
}
async function calRemE(dds,ek){await fbDel(`calEntries/${calKey(dds)}/${ek}`);toast('Removed');if(selCalDate)renderCalDay(selCalDate);}

// Reminders
function openRemind(){
  const date=ds(now());
  const myT=allTasks().filter(t=>{if(!isSched(t,now()))return false;return CU.isAdmin||(t.assignees||[]).includes(CU.username);});
  const getS=t=>CU.isAdmin?computeTaskOverall(t.id,date):getMemberStatus(t.id,date,CU.username);
  const rows=myT.map(t=>{const st=getS(t),ov=isOverdue(t,date)&&st!=='Done';return`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--yellow-mid);font-size:13px"><span style="font-weight:500">${t.title}${ov?' ⚠️':''}</span><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--text3)">${t.deadline}</span><span class="sbadge ${sbc(st)}" style="cursor:default;font-size:11px"><span class="sdot ${sdc(st)}"></span>${st}</span></div></div>`;}).join('');
  document.getElementById('mr-body').innerHTML=`<div style="background:var(--yellow-light);border:1px solid var(--yellow-mid);border-radius:var(--radius);padding:14px;margin-bottom:12px"><div style="font-size:13px;font-weight:700;color:#92400e;margin-bottom:8px">${fmtD(now())}</div>${rows||'<div style="color:var(--green);font-weight:600;font-size:13px">All tasks complete!</div>'}</div>`;
  openModal('modal-remind');
}
function scheduleReminders(){
  setInterval(function(){
    const n=now(),h=n.getHours(),m=n.getMinutes();
    if((h===9&&m===0)||(h===16&&m===50))openRemind();
  },60000);
  // Sweep once right away, then poll every 20s so an overdue task lands in the non-compliance
  // list within seconds of its deadline (e.g. a 12:00 deadline shows up by ~12:00:20), instead of
  // waiting up to a full minute.
  try{checkOverdueAndBroadcast();checkLeadTaskOverdue();}catch(e){}
  setInterval(checkOverdueAndBroadcast, 20000);
  setInterval(checkLeadTaskOverdue, 20000);
}

function checkOverdueAndBroadcast(){
  if(!CU) return;
  const date=ds(now());
  // Admin sweeps every admin task; a non-admin sweeps only the tasks visible to them so their
  // own overdue misses get registered the moment the deadline passes — even when no admin is
  // online. Registration is idempotent (deterministic ncId), so overlapping admin + member
  // sweeps never create duplicates.
  const sched=(CU.isAdmin?D.tasks:allTasks()).filter(function(t){return isSched(t,now());});
  sched.forEach(function(t){
    const ov=computeTaskOverall(t.id,date);
    if(ov==='Done') return;
    if(!isOverdue(t,date)) return; // not late yet, or an approved extension has moved the deadline
    // Auto-broadcast is admin-only (avoids every member firing the same overdue broadcast).
    if(CU.isAdmin){
      const alertKey='gh_alert_'+t.id+'_'+date;
      if(!localStorage.getItem(alertKey)){
        localStorage.setItem(alertKey,'1');
        const pending=(t.assignees||[]).filter(function(u){return(getMemberStatus(t.id,date,u)||'Pending')!=='Done';});
        const names=pending.map(getMN).join(', ')||'assigned team';
        const msg='⚠️ OVERDUE: '+t.title+' is past deadline ('+t.deadline+'). Pending: '+names;
        fbSet('broadcast',{msg:msg,ts:Date.now(),sentBy:'System',auto:true});
        toast('Auto-broadcast sent: '+t.title+' overdue');
      }
    }
    registerNonCompliance(t,date);
  });
}

// Register a non-compliance entry once a task (including AO/FR-linked live tracker tasks)
// passes its admin-set deadline without being completed. This lands in the nonCompliance
// registry for admin review — it is NOT auto-sent to the incident log. Skipped entirely if an
// approved extension is currently covering this task/date — extended tasks are never non-compliance.
// Returns the specific AO tracker rows that were NOT filled in for a given date.
// Each entry carries the brand, region (sheet key), CDM and Team Lead straight from
// the tracker row, so a non-compliance incident can name exactly what was missed.
// Col 0 = Brand, col 2 = CDM, col 3 = Team Lead (see buildAOTable).
function aoGetUnfilledRows(date){
  const out=[];
  const linkedEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].aoLinked;});
  if(!linkedEntry)return out;
  const trackerKey=linkedEntry[0],linked=linkedEntry[1];
  const AO_SHEETS=['MY','SG','TH','VN'];
  AO_SHEETS.forEach(function(key){
    const sh=linked.sheets&&linked.sheets[key];
    if(!sh)return;
    const row0=sh.row0||[];
    const row1=sh.row1||[];
    const dateCols=aoFindDateCols(row0,date,row1);
    if(!dateCols.length)return;
    const liveSheet=(D.trackers[trackerKey]||{}).sheets;
    const _liveObj=liveSheet&&liveSheet[key]?liveSheet[key]:sh;
    const liveRows=_liveObj&&_liveObj.rows?_liveObj.rows:(sh.rows||[]);
    liveRows.forEach(function(row,ri){
      if(!row||row[0]==null||!String(row[0]).trim())return;
      if(String(row[0]).toUpperCase()==='TOTAL')return;
      if(!aoRowIsActive(_liveObj,ri))return; // exited/inactive brands aren't obligations
      const filled=dateCols.some(function(ci){
        const v=row[ci];
        return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v).toUpperCase()!=='OFF';
      });
      if(filled)return;
      out.push({
        brand:String(row[0]).trim(),
        region:key,
        cdm:row[2]!=null?String(row[2]).trim():'',
        cdmTL:row[3]!=null?String(row[3]).trim():'',
        rowIndex:ri
      });
    });
  });
  return out;
}

// Returns the pending (unfilled) FR brand rows for a task, straight from the live tracker —
// one item per brand row that is NOT yet done in the task's active cadence column. Mirrors
// aoGetUnfilledRows so FR non-compliance names exactly which brand was missed and, crucially,
// tags the Exec/CDM CURRENTLY selected on that row in the Live Tracker (not stale task
// assignees). Inactive/exited brand rows are skipped — same filter the completion math uses —
// so a resigned member whose brands were reassigned or exited never gets flagged.
function frGetUnfilledRows(task,date){
  const out=[];
  const linked=getFRLinked();
  if(!linked||!linked.sheets)return out;
  const wantMonthly=frTaskIsMonthly(task);
  frTaskPlatforms(task).forEach(function(platform){
    const sheet=getFRSheet(linked,platform);
    if(!sheet)return;
    const colIdx=wantMonthly?frActiveMonthlyColIdx(sheet,platform):frActiveColIdx(sheet,platform);
    if(colIdx===-1)return;
    const regionCol=frFixedColIdx(sheet,platform,'region');
    const acctCol=frFixedColIdx(sheet,platform,'acct');
    const brandCol=frFixedColIdx(sheet,platform,'brand');
    const execCol=frFixedColIdx(sheet,platform,'exec');
    // Team Lead column: detect by header, else conventional position right after Exec.
    const headerRows=(sheet.headerRows)||(sheet.row0?[sheet.row0]:[[]]);
    const hr0=headerRows[0]||[];
    const tlCol=(function(){const i=hr0.findIndex(function(l){return/team.?lead|^tl$/i.test(String(l||''));});return i>=0?i:execCol+1;})();
    (sheet.rows||[]).forEach(function(row,ri){
      if(!row||row[regionCol]==null||!String(row[regionCol]).trim())return;
      const acctStatus=String(row[acctCol]||'').trim().toLowerCase();
      if(acctStatus==='inactive'||acctStatus==='exited')return; // not a live obligation
      if(frIsDone(row[colIdx]))return;                          // already submitted → not pending
      out.push({
        platform:platform,
        region:String(row[regionCol]||'').trim(),
        brand:String(row[brandCol]||'').trim()||String(row[brandCol-1]||'').trim()||'Unknown',
        exec:row[execCol]!=null?String(row[execCol]).trim():'',
        tl:row[tlCol]!=null?String(row[tlCol]).trim():'',
        rowIndex:ri
      });
    });
  });
  return out;
}

// Register overdue/failed tasks into the non-compliance REGISTRY (nonCompliance/) rather than
// pushing them straight into the incident log. Each entry is Open and waits for the governance
// admin to either "Send to Incidents" or "Dismiss". Assigned members can see their own entries.
// Dedupe key `ncId` is deterministic (task+date+who) so the same miss is never registered twice.
function registerNonCompliance(t,date){
  if(getApprovedExt(t.id,date))return;
  const platform=t.aoLinked?'Abnormal Orders':t.frLinked?(frGetPlatform(t)||'Finance Report'):'';

  // AO-linked tasks: one entry per tracker row left unfilled (names the exact brand/region/CDM).
  if(t.aoLinked){
    const missed=aoGetUnfilledRows(date);
    missed.forEach(function(r){
      const ncId='nc_'+t.id+'_'+date+'_'+r.region+'_'+r.rowIndex;
      if((D.nonCompliance||{})[ncId])return; // already registered
      const m=(D.members||[]).find(function(x){return x.name===r.cdm;});
      let tagged,cdmName,unmatched=false;
      if(m&&m.username){tagged=[m.username];cdmName=m.name;}
      else{unmatched=true;tagged=(t.assignees||[]).slice();cdmName=r.cdm||(tagged.map(getMN).join(', ')||'Unassigned');}
      fbSet('nonCompliance/'+ncId,{
        ncId:ncId,taskId:t.id,taskTitle:t.title,date:date,deadline:t.deadline||'',
        kind:'AO',platform:platform,region:r.region,brand:r.brand,
        cdm:cdmName,cdmTL:r.cdmTL||(m&&m.reportsTo?getMN(m.reportsTo):''),
        tagged:tagged,
        reason:'Failure to update the Abnormal Orders tracker for '+r.brand+' ('+r.region+') by the '+(t.deadline||'')+' deadline.',
        detail:unmatched?('Tracker CDM "'+(r.cdm||'blank')+'" did not match a registered member — tagged to task assignees.'):'',
        status:'Open',sentAsIncident:false,ts:Date.now()
      });
    });
    return;
  }

  // FR-linked tasks: one entry per pending brand ROW in the live tracker, tagged to the Exec/CDM
  // currently selected on that row. This replaces the old "one entry per task assignee" logic,
  // which flagged stale/resigned assignees who no longer own any live brand. Rows that are
  // inactive/exited, or already filled in, are skipped by frGetUnfilledRows.
  if(t.frLinked){
    const missed=frGetUnfilledRows(t,date);
    missed.forEach(function(r){
      const ncId='nc_'+t.id+'_'+date+'_'+r.platform+'_'+r.rowIndex;
      if((D.nonCompliance||{})[ncId])return; // already registered
      // Resolve the row's Exec/CDM name to a registered member so it tags a real login.
      const execName=(r.exec||'').trim();
      const m=(D.members||[]).find(function(x){return x.name&&x.name.trim().toLowerCase()===execName.toLowerCase();});
      // A row whose Exec is blank, or names someone no longer a registered/active member, has no
      // valid current owner — skip it rather than mis-tagging. The obligation follows whoever the
      // Live Tracker currently assigns; if nobody is assigned, there is no member to flag.
      if(!m||!m.username)return;
      if(m.active===false||m.approved===false)return; // resigned / deactivated → not flagged
      const tlName=(r.tl||'').trim();
      const tlM=(D.members||[]).find(function(x){return x.name&&x.name.trim().toLowerCase()===tlName.toLowerCase();});
      fbSet('nonCompliance/'+ncId,{
        ncId:ncId,taskId:t.id,taskTitle:t.title,date:date,deadline:t.deadline||'',
        kind:'FR',platform:r.platform||platform,region:r.region||m.region||'',brand:r.brand||'',
        cdm:m.name,cdmTL:tlM?tlM.name:(tlName||(m.reportsTo?getMN(m.reportsTo):'')),
        tagged:[m.username],
        reason:'Failure to complete '+t.title+' for '+r.brand+(r.region?' ('+r.region+')':'')+' by the '+(t.deadline||'')+' deadline.',
        detail:'',
        status:'Open',sentAsIncident:false,ts:Date.now()
      });
    });
    return;
  }

  // Plain (non-tracker) tasks: one entry per pending assignee.
  const pending=(t.assignees||[]).filter(function(u){return(getMemberStatus(t.id,date,u)||'Pending')!=='Done';});
  pending.forEach(function(u){
    const ncId='nc_'+t.id+'_'+date+'_'+u;
    if((D.nonCompliance||{})[ncId])return; // already registered
    const m=(D.members||[]).find(function(x){return x.username===u;})||{};
    fbSet('nonCompliance/'+ncId,{
      ncId:ncId,taskId:t.id,taskTitle:t.title,date:date,deadline:t.deadline||'',
      kind:'TASK',platform:platform,region:m.region||'',brand:'',
      cdm:getMN(u),cdmTL:m.reportsTo?getMN(m.reportsTo):'',
      tagged:[u],
      reason:'Failure to complete '+t.title+' by the '+(t.deadline||'')+' deadline.',
      detail:'',
      status:'Open',sentAsIncident:false,ts:Date.now()
    });
  });
}

// ── NON-COMPLIANCE: admin actions ──────────────────────────────────────────────
// Governance admin manually flags an already-overdue / failed task as non-compliance
// straight from the dashboard row, even if the auto-registration hasn't fired yet.
async function flagNonCompliance(taskId,date){
  if(!CU.isAdmin){toast('Only the governance admin can flag non-compliance');return;}
  const t=(D.tasks.find(x=>x.id==taskId))||(D.leadTasks||[]).find(x=>x.id==taskId);
  if(!t){toast('Task not found');return;}
  registerNonCompliance(t,date);
  toast('Flagged as non-compliance');
}

// Send a registered non-compliance entry into the formal Incident Log. Creates the incident
// using the same shape the log expects, then marks the NC entry as sent (with a back-reference)
// so the dashboard shows "✓ Sent as incident" and the admin can't double-send it.
async function sendNCToIncident(ncId){
  if(!CU.isAdmin){toast('Only the governance admin can send incidents');return;}
  const r=(D.nonCompliance||{})[ncId];
  if(!r){toast('Entry not found');return;}
  if(r.sentAsIncident){toast('Already sent as an incident');return;}
  const tagged=(r.tagged||[]).slice();
  const responses={};tagged.forEach(function(u){responses[u]={action:'Pending'};});
  const incKey=await fbPush('incidents',{
    title:'Non-Compliance: '+r.taskTitle,
    incidentType:'Compliance',
    classification:'Non-Compliance',
    category:'Compliance',
    incidentDate:r.date,
    date:ds(now()),
    severity:'Medium',
    region:r.region||'',
    brand:r.brand||'',
    platform:r.platform||'',
    cdm:r.cdm||'',
    cdmTL:r.cdmTL||'',
    issue:'Non-compliance — '+(r.reason||''),
    description:'"'+r.taskTitle+'" was not completed by the '+(r.deadline||'')+' deadline.',
    remarks:'Sent to Incidents by '+CU.name+' from the non-compliance list.'+(r.detail?' '+r.detail:''),
    reportedBy:CU.name,
    tagged:tagged,
    assignees:tagged,
    responses:responses,
    status:'Open',
    _fromNonCompliance:true,
    _ncId:ncId,
    _taskId:r.taskId,
    ts:Date.now()
  });
  await fbUpd('nonCompliance/'+ncId,{status:'Sent',sentAsIncident:true,sentBy:CU.name,sentAt:Date.now(),incidentKey:incKey});
  await logAct(r.taskId,r.date,CU.name,'Non-compliance sent to Incidents: '+r.taskTitle,'NC_SENT');
  toast('Sent to Incident Log');
}

// Admin dismisses a non-compliance entry without escalating it to an incident.
// Dismissed entries are hidden from the dashboard list immediately afterwards (see
// buildDashboardNonCompliance) — they stay in the DB as a historical record but no
// longer clutter the view.
async function dismissNC(ncId){
  if(!CU.isAdmin){toast('Only the governance admin can dismiss');return;}
  const r=(D.nonCompliance||{})[ncId];
  if(!r){toast('Entry not found');return;}
  await fbUpd('nonCompliance/'+ncId,{status:'Dismissed',sentAsIncident:false,dismissedBy:CU.name,dismissedAt:Date.now()});
  await logAct(r.taskId,r.date,CU.name,'Non-compliance dismissed: '+r.taskTitle,'NC_DISMISSED');
  (window._ncSelected||(window._ncSelected=new Set())).delete(ncId);
  toast('Dismissed');
}

// ── NON-COMPLIANCE: selection + bulk actions ────────────────────────────────────
// window._ncSelected persists a Set of selected ncId's across re-renders (same pattern
// as window._ncOpen for the collapse state). Only "Open" entries are selectable since
// bulk actions (Send to Incident / Dismiss) only make sense for still-open items.
function toggleNCSelect(ncId){
  if(!window._ncSelected)window._ncSelected=new Set();
  if(window._ncSelected.has(ncId))window._ncSelected.delete(ncId);
  else window._ncSelected.add(ncId);
  renderDashboard();
}
// Reads the currently-visible open ids from window._ncOpenIds (stashed by
// buildDashboardNonCompliance on each render) rather than taking an argument, since an
// array of string ids can't be safely inlined into an onclick="" attribute.
function toggleNCSelectAll(){
  const ids=window._ncOpenIds||[];
  if(!window._ncSelected)window._ncSelected=new Set();
  const allSelected=ids.length>0&&ids.every(id=>window._ncSelected.has(id));
  if(allSelected)ids.forEach(id=>window._ncSelected.delete(id));
  else ids.forEach(id=>window._ncSelected.add(id));
  renderDashboard();
}
function clearNCSelection(){window._ncSelected=new Set();renderDashboard();}

// Bulk-send every selected (still Open) non-compliance entry to the Incident Log.
async function bulkSendNCToIncident(){
  if(!CU.isAdmin){toast('Only the governance admin can send incidents');return;}
  const sel=Array.from(window._ncSelected||[]).filter(id=>{const r=(D.nonCompliance||{})[id];return r&&r.status==='Open';});
  if(!sel.length){toast('No open entries selected');return;}
  for(const ncId of sel){await sendNCToIncident(ncId);}
  window._ncSelected=new Set();
  toast(sel.length+' entr'+(sel.length===1?'y':'ies')+' sent to Incident Log');
  renderDashboard();
}
// Bulk-dismiss every selected (still Open) non-compliance entry.
async function bulkDismissNC(){
  if(!CU.isAdmin){toast('Only the governance admin can dismiss');return;}
  const sel=Array.from(window._ncSelected||[]).filter(id=>{const r=(D.nonCompliance||{})[id];return r&&r.status==='Open';});
  if(!sel.length){toast('No open entries selected');return;}
  for(const ncId of sel){await dismissNC(ncId);}
  window._ncSelected=new Set();
  toast(sel.length+' entr'+(sel.length===1?'y':'ies')+' dismissed');
  renderDashboard();
}

// ── NON-COMPLIANCE: dashboard section ──────────────────────────────────────────
// Is an Open FR non-compliance entry still valid — i.e. does its tagged member still exist, is
// still active/approved, and does the Live Tracker still assign them a NON-exited brand row on
// this task's platform? Entries that fail (member resigned, or their brands were reassigned/
// exited) are stale: the obligation has moved off them, so they shouldn't keep showing or count
// as open. Only Open FR entries are gated; AO/TASK entries and already Sent/Dismissed FR entries
// are left untouched (historical record).
function ncEntryStillValid(r){
  if(!r)return false;
  if(r.kind!=='FR')return true;            // only FR entries are tracker-ownership driven
  if(r.status&&r.status!=='Open')return true; // Sent/Dismissed are historical — always keep
  const u=(r.tagged||[])[0];
  if(!u)return false;
  const m=(D.members||[]).find(function(x){return x.username===u;});
  if(!m)return false;                       // tagged member no longer registered
  if(m.active===false||m.approved===false)return false; // resigned / deactivated
  // Still owns a live brand row for this task's platform?
  const linked=getFRLinked();
  if(!linked)return true;                   // tracker unavailable → don't hide on a transient gap
  const sheet=getFRSheet(linked,r.platform);
  if(!sheet)return true;
  const execCol=frFixedColIdx(sheet,r.platform,'exec');
  const headerRows=(sheet.headerRows)||(sheet.row0?[sheet.row0]:[[]]);
  const hr0=headerRows[0]||[];
  const tlCol=(function(){const i=hr0.findIndex(function(l){return/team.?lead|^tl$/i.test(String(l||''));});return i>=0?i:execCol+1;})();
  const acctCol=frFixedColIdx(sheet,r.platform,'acct');
  const nm=String(m.name||'').trim().toLowerCase();
  return (sheet.rows||[]).some(function(row){
    if(!row)return false;
    const st=String(row[acctCol]||'').trim().toLowerCase();
    if(st==='inactive'||st==='exited')return false;
    const ex=String(row[execCol]||'').trim().toLowerCase();
    const tl=String(row[tlCol]||'').trim().toLowerCase();
    return (ex&&ex===nm)||(tl&&tl===nm);
  });
}

// Admin sees ALL entries; an assigned member sees only entries tagged to them (so they can see
// their own non-compliance before/after it's escalated, per requirement).
// Dismissed entries are dropped entirely from this list — once an admin dismisses one it's
// removed from view here (it still lives in nonCompliance/ in the DB as a historical record,
// it just no longer clutters this dashboard list). Open/Sent entries are also filterable by date.
function buildDashboardNonCompliance(){
  const all=Object.values(D.nonCompliance||{}).filter(Boolean).filter(ncEntryStillValid).filter(function(r){return r.status!=='Dismissed';});
  if(!all.length)return'';
  let visible=CU.isAdmin?all:all.filter(function(r){return(r.tagged||[]).includes(CU.username);});
  if(!visible.length)return'';

  // Date filter (matches r.date, the task's scheduled/occurrence date) — From/To range,
  // same pattern used on the Incidents page.
  if(window._ncFrom===undefined)window._ncFrom='';
  if(window._ncTo===undefined)window._ncTo='';
  const filtered=visible.filter(function(r){
    if(window._ncFrom&&(r.date||'')<window._ncFrom)return false;
    if(window._ncTo&&(r.date||'')>window._ncTo)return false;
    return true;
  });

  // Sort: Open first, then Sent; newest first within each.
  const rank={Open:0,Sent:1};
  filtered.sort(function(a,b){
    const ra=rank[a.status]??0,rb=rank[b.status]??0;
    if(ra!==rb)return ra-rb;
    return (b.ts||0)-(a.ts||0);
  });
  const openCount=visible.filter(function(r){return r.status==='Open';}).length;
  const openIds=filtered.filter(function(r){return r.status==='Open';}).map(function(r){return r.ncId;});
  window._ncOpenIds=openIds; // stashed for toggleNCSelectAll (avoids inlining an array into onclick)
  if(!window._ncSelected)window._ncSelected=new Set();
  // Drop selected ids that are no longer open/visible (sent, dismissed, filtered out elsewhere)
  window._ncSelected=new Set(Array.from(window._ncSelected).filter(function(id){return openIds.includes(id);}));
  const selCount=window._ncSelected.size;

  function statusPill(r){
    if(r.status==='Sent'||r.sentAsIncident)
      return '<span style="font-size:10px;font-weight:700;color:var(--red);background:var(--red-light,#fee2e2);padding:2px 8px;border-radius:20px;white-space:nowrap">✓ Sent as incident</span>';
    return '<span style="font-size:10px;font-weight:700;color:var(--orange);background:var(--orange-light);padding:2px 8px;border-radius:20px;white-space:nowrap">⏳ Open</span>';
  }

  const rows=filtered.map(function(r){
    const who=r.cdm||(r.tagged||[]).map(getMN).join(', ')||'—';
    const scope=[r.brand,r.region,r.platform].filter(Boolean).join(' · ');
    const isOpenRow=r.status==='Open';
    const checkbox=CU.isAdmin&&isOpenRow
      ? '<input type="checkbox" style="width:15px;height:15px;cursor:pointer" '+(window._ncSelected.has(r.ncId)?'checked ':'')+'onclick="toggleNCSelect(\''+r.ncId+'\')"/>'
      : '';
    const actions=CU.isAdmin&&isOpenRow
      ? '<div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap"><button class="btn sm del" onclick="sendNCToIncident(\''+r.ncId+'\')">Send to Incident</button><button class="btn sm" onclick="dismissNC(\''+r.ncId+'\')">Dismiss</button></div>'
      : '';
    return '<tr>'
      +(CU.isAdmin?'<td style="width:3%;text-align:center">'+checkbox+'</td>':'')
      +'<td style="width:24%"><div style="font-weight:600">'+escHtml(r.taskTitle||'')+'</div>'+(scope?'<div style="font-size:11px;color:var(--text3)">'+escHtml(scope)+'</div>':'')+'</td>'
      +'<td style="width:15%">'+escHtml(who)+'</td>'
      +'<td style="width:11%;text-align:center"><span style="font-size:11px">'+escHtml(r.date||'')+'</span><div style="font-size:10px;color:var(--text4)">'+escHtml(r.deadline||'')+'</div></td>'
      +'<td style="width:24%"><div style="font-size:12px;color:var(--text2)">'+escHtml(r.reason||'')+'</div>'+(r.detail?'<div style="font-size:10px;color:var(--text4);margin-top:2px">'+escHtml(r.detail)+'</div>':'')+'</td>'
      +'<td style="width:10%;text-align:center">'+statusPill(r)+'</td>'
      +'<td style="width:13%">'+actions+'</td>'
      +'</tr>';
  }).join('');

  // Collapsible like the Activity Feed so a long non-compliance list doesn't pile up in the view.
  // Default collapsed; the header stays visible with a count badge and toggles on click.
  if(window._ncOpen===undefined)window._ncOpen=false;
  const isOpen=window._ncOpen;
  const countBadge=' <span style="opacity:.7">'
    +(openCount?'('+openCount+' open)':'('+visible.length+')')
    +'</span>'
    +(CU.isAdmin?'':' <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3)">— your flagged tasks</span>');
  const toggle='<span style="font-size:12px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">'+(isOpen?'▲ Hide':'▼ Show')+'</span>';

  const header='<div class="section-hdr sh-red" style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none"'
    +' onclick="window._ncOpen=!window._ncOpen;renderDashboard()">'
    +'<span>Non-Compliance'+countBadge+'</span>'+toggle
    +'</div>';

  if(!isOpen)return header;

  // Toolbar: date range filter + (admin) bulk selection actions
  const dateFilterBar='<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;align-items:center" onclick="event.stopPropagation()">'
    +'<label class="flabel" style="display:inline;margin-bottom:0">From</label>'
    +'<input type="date" class="finput nb" style="width:auto;margin-bottom:0" value="'+escHtml(window._ncFrom)+'" onchange="window._ncFrom=this.value;renderDashboard()"/>'
    +'<label class="flabel" style="display:inline;margin-bottom:0">To</label>'
    +'<input type="date" class="finput nb" style="width:auto;margin-bottom:0" value="'+escHtml(window._ncTo)+'" onchange="window._ncTo=this.value;renderDashboard()"/>'
    +(window._ncFrom||window._ncTo?'<button class="btn sm" onclick="window._ncFrom=\'\';window._ncTo=\'\';renderDashboard()">Clear</button>':'')
    +'</div>';

  const bulkBar=CU.isAdmin
    ? '<div style="display:flex;gap:8px;margin:0 0 8px;flex-wrap:wrap;align-items:center" onclick="event.stopPropagation()">'
      +'<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text3);cursor:pointer">'
        +'<input type="checkbox" style="width:15px;height:15px;cursor:pointer" '+(openIds.length&&openIds.every(function(id){return window._ncSelected.has(id);})?'checked ':'')+'onclick="toggleNCSelectAll()" '+(openIds.length?'':'disabled')+'/>'
        +'Select all open'
      +'</label>'
      +(selCount?'<span style="font-size:12px;font-weight:700;color:var(--text2)">'+selCount+' selected</span>'
        +'<button class="btn sm del" onclick="bulkSendNCToIncident()">Send to Incident</button>'
        +'<button class="btn sm" onclick="bulkDismissNC()">Dismiss</button>'
        +'<button class="btn sm" onclick="clearNCSelection()">Clear selection</button>'
        :'')
    +'</div>'
    : '';

  const emptyRow=!filtered.length
    ?'<div class="empty-state" style="padding:20px">No non-compliance entries in this date range.</div>'
    :'';

  return header
    +dateFilterBar
    +bulkBar
    +(filtered.length
      ? '<div class="tbl-wrap"><table><thead><tr>'
        +(CU.isAdmin?'<th style="width:3%"></th>':'')
        +'<th style="width:24%">Task</th><th style="width:15%">CDM / Assigned</th><th style="width:11%;text-align:center">Date / Deadline</th><th style="width:24%">Reason</th><th style="width:10%;text-align:center">Status</th><th style="width:13%">'+(CU.isAdmin?'Action':'')+'</th>'
        +'</tr></thead><tbody>'+rows+'</tbody></table></div>'
      : emptyRow);
}

// Called every minute for non-admin users — checks their own lead tasks for overdue auto-escalation
function checkLeadTaskOverdue(){
  if(!CU||CU.isAdmin||!isLead())return;
  const date=ds(now());
  const myLeadTasks=(D.leadTasks||[]).filter(t=>t._leadOwner===CU.username&&!t.inactive);
  myLeadTasks.forEach(function(t){
    const ov=computeTaskOverall(t.id,date);
    if(ov==='Done')return;
    // Not late yet, or an approved extension has moved the deadline — no non-compliance
    if(isOverdue(t,date)){
      // Push one lead-task-escalation incident per pending member into the shared
      // incidents path, flagged as _leadTaskEsc so only the lead sees it by default
      const pending=(t.assignees||[]).filter(u=>(getMemberStatus(t.id,date,u)||'Pending')!=='Done');
      pending.forEach(function(u){
        const escKey='gh_ltesc_'+t.id+'_'+date+'_'+u;
        if(localStorage.getItem(escKey))return;
        localStorage.setItem(escKey,'1');
        const m=(D.members||[]).find(function(x){return x.username===u;})||{};
        const responses={};responses[u]={action:'Pending'};
        fbPush('incidents',{
          title:'Overdue Task: '+t.title,
          incidentType:'Lead Task Non-Compliance',
          classification:'Non-Compliance',
          category:'Others',
          incidentDate:date,
          date:date,
          severity:'Medium',
          region:m.region||'',
          cdm:getMN(u),
          cdmTL:CU.name,
          issue:'Non-compliance — failure to complete "'+t.title+'" on time.',
          description:'Task "'+t.title+'" passed its deadline ('+t.deadline+') without completion.',
          remarks:'Auto-escalated by '+CU.name+'.',
          reportedBy:CU.name,
          tagged:[u],
          assignees:[u],
          responses:responses,
          status:'Open',
          _leadTaskEsc:true,         // marks this as a lead-private escalation
          _leadOwner:CU.username,    // only visible to this lead by default
          _govEscalated:false,       // becomes true when lead hits "Escalate to Governance"
          _taskId:t.id,
          ts:Date.now()
        });
      });
    }
  });
}


// ── AO TRACKER DASHBOARD SECTION ──
const REGIONS = [
  {key:'MY', label:'Malaysia'},
  {key:'PH', label:'Philippines'},
  {key:'SG', label:'Singapore'},
  {key:'TH', label:'Thailand'},
  {key:'VN', label:'Vietnam'},
];







// ══════════════════════════════════════════════
// AUDIT LAUNCHER
// ══════════════════════════════════════════════
let _alOpen=false;
let _alTab='SIS'; // SIS | Category | Listing

const AL_DEFAULT_TEMPLATES={
  SIS:`You are a quality auditor for Lazada stores.

Audit the STORE / SIS tab for:
- Brand: {brand}
- Market: {market}
- CDM: {cdm}
- Team Lead: {tl}
- Date: {date}

URL: lazada.{domain}/shop/{brand_slug}/?path=index.htm

STORE / SIS CHECKLIST:
(a) Spelling/grammar in all visible texts
(b) Banners & links functional, pointing to coherent content
(c) Campaign dates coherent with today's date
(d) Warranty info consistent with Lazada's 30-day standard
(e) No competitor logos in images

CAROUSEL EXTRACTION — run this JS in console on the store page:
const imgs = Array.from(document.querySelectorAll('img')).filter(img => {
  const src = img.src || '';
  return src.startsWith('https://img.lazcdn.com') && !src.includes('icon') && img.naturalWidth >= 200;
});
const results = imgs.map((img, i) => ({ i: i+1, src: img.src.split('?')[0], alt: img.alt || '', w: img.naturalWidth, h: img.naturalHeight }));
JSON.stringify(results, null, 1);

Navigate to each image URL to inspect for expired content, hardcoded prices, and alt text.

REPORTING FORMAT:
1. SIS Carousel Inventory table: # | Content | Status (✅ Evergreen / ❌ Expired)
2. Findings table: ID (S-#) | Sev. (🔴HIGH/🟡MEDIUM/🟢LOW) | Category | Description + store URL
3. Use only these 13 classification tags: outdated details, outdated asset, outdated category, linkage issue, mismatch in details, incorrect asset, incorrect details, inconsistent details, description issue, highlights issue, spelling issue, prohibited, execution issue

Report ONLY incidences (what fails). All findings in English.`,

  Category:`You are a quality auditor for Lazada stores.

Audit the CATEGORIES tab for:
- Brand: {brand}
- Market: {market}
- CDM: {cdm}
- Team Lead: {tl}
- Date: {date}

Access categories via the dropdown in the store header (no direct URL — hover each top-level item to reveal sub-levels).

CATEGORIES CHECKLIST:
(a) Products correctly classified
(b) All links working — record destination URL of each link
(c) No spelling errors in category labels

REPORTING FORMAT:
Findings table: ID (C-#) | Sev. (🔴HIGH/🟡MEDIUM/🟢LOW) | Category | Description + URL of affected link

Use only these 13 classification tags: outdated details, outdated asset, outdated category, linkage issue, mismatch in details, incorrect asset, incorrect details, inconsistent details, description issue, highlights issue, spelling issue, prohibited, execution issue

Report ONLY incidences (what fails). All findings in English.`,

  Listing:`You are a quality auditor for Lazada stores.

Audit the PRODUCTS / LISTING tab for:
- Brand: {brand}
- Market: {market}
- CDM: {cdm}
- Team Lead: {tl}
- Date: {date}

URL: lazada.{domain}/{brand_slug}/?q=All-Products&from=wangpu&langFlag=en&pageTypeId=2
(Use /{brand_slug}/ — NOT /shop/{brand_slug}/)

PRODUCTS DATA EXTRACTION — run this JS on the catalog page:
const cards = Array.from(document.querySelectorAll('[data-qa-locator="product-item"]'));
const results = cards.map((card, i) => {
  const title = card.querySelector('.RfADt')?.innerText || '';
  const price = card.querySelector('.ooOxS')?.innerText || '';
  const strike = card.querySelector('del')?.innerText || '';
  const link = card.querySelector('a')?.href?.split('?')[0] || '';
  return { i: i+1, title: title.substring(0, 120), price, strike, url: link };
});
JSON.stringify(results, null, 1);

KEY STATS TO REPORT:
- Total catalog size (pages × products per page)
- % of products with SKU codes in title
- # of products with strikethrough / sale price
- Presence of "NEW IN STORE" or similar badges

PRODUCTS CHECKLIST:
(a) Title / price / image carousel coherence
(b) Variants matching displayed images

REPORTING FORMAT:
Findings table: ID (P-#) | Sev. (🔴HIGH/🟡MEDIUM/🟢LOW) | Category | Description + at least 3–5 sample product URLs

Use only these 13 classification tags: outdated details, outdated asset, outdated category, linkage issue, mismatch in details, incorrect asset, incorrect details, inconsistent details, description issue, highlights issue, spelling issue, prohibited, execution issue

Report ONLY incidences (what fails). All findings in English.`
};

const AL_STORAGE_KEY='gh_audit_templates_v1';

function alGetTemplates(){
  try{
    const saved=localStorage.getItem(AL_STORAGE_KEY);
    if(saved){const t=JSON.parse(saved);return Object.assign({},AL_DEFAULT_TEMPLATES,t);}
  }catch(e){}
  return Object.assign({},AL_DEFAULT_TEMPLATES);
}

function alSaveTemplate(tab,text){
  try{
    const saved=localStorage.getItem(AL_STORAGE_KEY);
    const t=saved?JSON.parse(saved):{};
    t[tab]=text;
    localStorage.setItem(AL_STORAGE_KEY,JSON.stringify(t));
    toast('Template saved!');
  }catch(e){toast('Could not save template');}
}

function alResetTemplate(tab){
  try{
    const saved=localStorage.getItem(AL_STORAGE_KEY);
    if(saved){const t=JSON.parse(saved);delete t[tab];localStorage.setItem(AL_STORAGE_KEY,JSON.stringify(t));}
    _alPromptGenerated=false;_alGeneratedText='';
    toast('Reset to default');
    renderAudit();
  }catch(e){}
}

function buildAuditLauncher(){
  const tlOpts=D.members.filter(m=>m.approved&&m.active!==false&&LEAD_ROLES.includes(m.role))
    .map(m=>'<option value="'+m.name+'">'+m.name+'</option>').join('');
  const memberOpts=D.members.filter(m=>m.approved&&m.active!==false&&m.role!=='Talent on Demand')
    .map(m=>'<option value="'+m.name+'">'+m.name+'</option>').join('');
  const markets=[{v:'PH',d:'com.ph'},{v:'MY',d:'com.my'},{v:'SG',d:'sg'},{v:'TH',d:'co.th'},{v:'VN',d:'vn'},{v:'ID',d:'co.id'}];
  const marketOpts=markets.map(m=>'<option value="'+m.v+'|'+m.d+'">'+m.v+'</option>').join('');
  const tabs=['SIS','Category','Listing'];
  const tabBtns=tabs.map(t=>'<button class="al-tab'+(t===_alTab?' active':'')+'" onclick="_alTab=\''+t+'\';_alPromptGenerated=false;renderAudit()">'+t+'</button>').join('');

  return '<div class="al-wrap">'
    +'<div class="al-header" onclick="_alOpen=!_alOpen;renderAudit()">'
      +'<span style="font-size:14px">🔍</span>'
      +'<span class="al-title">Audit Launcher</span>'
      +'<button class="al-upload-btn" onclick="event.stopPropagation();document.getElementById(\'al-word-upload\').click()" title="Upload Word file to update prompt template">📄 Upload .docx</button>'
      +'<input type="file" id="al-word-upload" accept=".docx,.doc" style="display:none" onchange="alHandleWordUpload(this)"/>'
      +'<span style="font-size:11px;color:#475569;font-weight:500;margin-left:4px">Generate prompt → paste into Claude → import findings</span>'
      +'<span style="font-size:12px;color:#475569;margin-left:auto">'+(_alOpen?'▲':'▼')+'</span>'
    +'</div>'
    +(_alOpen?
      '<div class="al-body open">'
        // LEFT PANEL
        +'<div class="al-left">'
          +'<div class="al-tabs">'+tabBtns+'</div>'
          +'<div class="al-fields">'
            +'<div class="al-field"><label>Brand Name</label><input id="al-brand" placeholder="e.g. Nike"/></div>'
            +'<div class="al-field"><label>Brand Slug</label><input id="al-slug" placeholder="e.g. nike"/></div>'
            +'<div class="al-field"><label>Market</label><select id="al-market">'+marketOpts+'</select></div>'
            +'<div class="al-field"><label>CDM</label><select id="al-cdm"><option value="">— Select —</option>'+memberOpts+'</select></div>'
            +'<div class="al-field"><label>Team Lead</label><select id="al-tl"><option value="">— Select —</option>'+tlOpts+'</select></div>'
            +'<div class="al-field" style="display:flex;align-items:flex-end"><button class="al-btn ghost" onclick="alResetTemplate(\''+_alTab+'\')" style="width:100%">↺ Reset Template</button></div>'
          +'</div>'
          +'<div class="al-actions">'
            +'<button class="al-btn primary" onclick="alCreatePrompt()">✦ Create Prompt</button>'
          +'</div>'
        +'</div>'
        // RIGHT PANEL
        +'<div class="al-right">'
          +'<div class="al-right-label">Prompt Preview</div>'
          +(_alPromptGenerated
            ?'<textarea class="al-prompt-preview" id="al-prompt-out" spellcheck="false"></textarea>'
              +'<div class="al-right-actions">'
                +'<button class="al-btn copy" onclick="alCopyPrompt()">⎘ Copy Prompt</button>'
                +'<span id="al-copied" style="font-size:11px;color:#4ade80;font-weight:600;display:none">✓ Copied!</span>'
              +'</div>'
            :'<div class="al-prompt-placeholder">'
              +'<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>'
              +'<span>Fill in the fields and click <strong style="color:#3b82f6">Create Prompt</strong></span>'
            +'</div>'
          )
        +'</div>'
      +'</div>'
    :'')
  +'</div>';
}

let _alPromptGenerated=false;
let _alGeneratedText='';

function alCreatePrompt(){
  const brand=document.getElementById('al-brand')?.value.trim()||'{brand}';
  const slug=document.getElementById('al-slug')?.value.trim()||'{brand_slug}';
  const marketRaw=document.getElementById('al-market')?.value||'PH|com.ph';
  const [market,domain]=marketRaw.split('|');
  const cdm=document.getElementById('al-cdm')?.value||'{cdm}';
  const tl=document.getElementById('al-tl')?.value||'{tl}';
  const date=new Date().toLocaleDateString('en-PH',{month:'2-digit',day:'2-digit',year:'numeric'});
  const templates=alGetTemplates();
  let prompt=templates[_alTab];
  prompt=prompt.replace(/\{brand\}/g,brand).replace(/\{brand_slug\}/g,slug)
    .replace(/\{market\}/g,market).replace(/\{domain\}/g,domain)
    .replace(/\{cdm\}/g,cdm).replace(/\{tl\}/g,tl).replace(/\{date\}/g,date);
  _alGeneratedText=prompt;
  _alPromptGenerated=true;
  // Preserve field values before re-render
  const bv=document.getElementById('al-brand')?.value||'';
  const sv=document.getElementById('al-slug')?.value||'';
  const mv=document.getElementById('al-market')?.value||'';
  const cv=document.getElementById('al-cdm')?.value||'';
  const tv=document.getElementById('al-tl')?.value||'';
  renderAudit();
  // Restore field values
  const ba=document.getElementById('al-brand');if(ba)ba.value=bv;
  const sa=document.getElementById('al-slug');if(sa)sa.value=sv;
  const ma=document.getElementById('al-market');if(ma)ma.value=mv;
  const ca=document.getElementById('al-cdm');if(ca)ca.value=cv;
  const ta2=document.getElementById('al-tl');if(ta2)ta2.value=tv;
  const ta=document.getElementById('al-prompt-out');
  if(ta)ta.value=_alGeneratedText;
}

function alCopyPrompt(){
  const ta=document.getElementById('al-prompt-out');
  const text=ta?ta.value:_alGeneratedText;
  if(!text)return;
  navigator.clipboard.writeText(text).then(()=>{
    const el=document.getElementById('al-copied');
    if(el){el.style.display='inline';setTimeout(()=>el.style.display='none',2000);}
  }).catch(()=>{if(ta){ta.select();document.execCommand('copy');}toast('Copied!');});
}

function alHandleWordUpload(input){
  const file=input.files[0];
  if(!file)return;
  if(typeof mammoth==='undefined'){toast('Word reader not loaded');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    mammoth.extractRawText({arrayBuffer:e.target.result}).then(result=>{
      const text=result.value.trim();
      if(!text){toast('No text found in document');return;}
      // Save extracted text as the template for current tab
      try{
        const saved=JSON.parse(localStorage.getItem(AL_STORAGE_KEY)||'{}');
        saved[_alTab]=text;
        localStorage.setItem(AL_STORAGE_KEY,JSON.stringify(saved));
      }catch(ex){}
      _alPromptGenerated=false;
      _alGeneratedText='';
      toast('Template updated from Word file ✓');
      renderAudit();
    }).catch(()=>toast('Failed to read Word file'));
  };
  reader.readAsArrayBuffer(file);
  input.value='';
}

// ══════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════
const AUDIT_ISSUE_TYPES=['SIS','Listing','Category','Merchandise Master','Compliance','Others','No Issue'];
const AUDIT_STATUSES=['Pending (Vhino to Update)','Resolved','Explained','No Action Needed','No Issue'];
const AUDIT_PLATFORMS=['Lazada','Shopee','TikTok','Zalora','Qoo10','All'];
const AUDIT_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
let _auditFilters={region:'',brand:'',month:'',status:'',tl:'',from:'',to:'',search:''};
let _auditNewRow=false;

function getAuditStatusClass(s){
  if(!s||s==='Pending (Vhino to Update)')return'ast-pending';
  if(s==='Resolved')return'ast-resolved';
  if(s==='Explained')return'ast-explained';
  if(s==='No Action Needed')return'ast-no-action';
  if(s==='No Issue')return'ast-no-issue';
  return'';
}
function getAuditRowClass(e){
  const s=e.status||'';
  if(s==='Resolved')return'fixed';
  if(s==='Pending (Vhino to Update)')return'pending';
  if(s==='Explained')return'has-issue';
  return'';
}

function renderAudit(){
  const el=document.getElementById('pg-audit');if(!el)return;
  // Preserve scroll position across re-renders
  const _sw=document.getElementById('audit-scroll-wrap');
  const _savedX=_sw?_sw.scrollLeft:0;
  const _savedY=_sw?_sw.scrollTop:0;
  if(isTOD()){el.innerHTML='<div class="empty-state" style="padding:60px"><div style="font-size:32px;margin-bottom:12px">🔒</div><div style="font-weight:700;font-size:16px;color:var(--text2)">Access Restricted</div><div style="font-size:13px;color:var(--text3);margin-top:6px">Audit Log is not available for TOD members.</div></div>';return;}
  let entries=[...(D.auditLog||[])];
  if(_auditFilters.region)entries=entries.filter(e=>e.region===_auditFilters.region);
  if(_auditFilters.brand)entries=entries.filter(e=>(e.brand||'').toLowerCase().includes(_auditFilters.brand.toLowerCase()));
  if(_auditFilters.month)entries=entries.filter(e=>e.month===_auditFilters.month);
  if(_auditFilters.status)entries=entries.filter(e=>e.status===_auditFilters.status);
  if(_auditFilters.tl)entries=entries.filter(e=>(e.teamLead||'').toLowerCase().includes(_auditFilters.tl.toLowerCase()));
  if(_auditFilters.from)entries=entries.filter(e=>e.date>=_auditFilters.from);
  if(_auditFilters.to)entries=entries.filter(e=>e.date<=_auditFilters.to);
  if(_auditFilters.search){const q=_auditFilters.search.toLowerCase();entries=entries.filter(e=>(e.brand||'').toLowerCase().includes(q)||(e.issueType||'').toLowerCase().includes(q)||(e.issueDetails||'').toLowerCase().includes(q)||(e.cdm||'').toLowerCase().includes(q));}

  const allTLs=[...new Set((D.auditLog||[]).map(e=>e.teamLead).filter(Boolean))].sort();
  const pending=entries.filter(e=>!e.status||e.status==='Pending (Vhino to Update)').length;
  const resolved=entries.filter(e=>e.status==='Resolved').length;
  const explained=entries.filter(e=>e.status==='Explained').length;

  function fsel(id,label,opts,cur,key){
    return '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:3px">'+label+'</div>'
      +'<select class="audit-filter-sel" onchange="_auditFilters.'+key+'=this.value;renderAudit()">'
      +'<option value="">All</option>'+opts.map(function(o){return'<option value="'+o+'"'+(cur===o?' selected':'')+'>'+o+'</option>';}).join('')
      +'</select></div>';
  }

  const filterBar='<div class="audit-filters">'
    +'<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:3px">Search</div>'
      +'<input type="text" placeholder="Brand, issue, CDM..." value="'+(_auditFilters.search||'')+'" oninput="_auditFilters.search=this.value;renderAudit()" class="audit-search-input"/></div>'
    +fsel('r','Region',['MY','PH','TH','VN','ID','SG','EP'],_auditFilters.region,'region')
    +fsel('m','Month',AUDIT_MONTHS,_auditFilters.month,'month')
    +fsel('s','Status',AUDIT_STATUSES,_auditFilters.status,'status')
    +'<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:3px">Team Lead</div>'
      +'<select class="audit-filter-sel" onchange="_auditFilters.tl=this.value;renderAudit()"><option value="">All</option>'
      +allTLs.map(function(t){return'<option value="'+t+'"'+(_auditFilters.tl===t?' selected':'')+'>'+t+'</option>';}).join('')
      +'</select></div>'
    +'<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:3px">From</div>'
      +'<input type="date" value="'+(_auditFilters.from||'')+'" onchange="_auditFilters.from=this.value;renderAudit()" class="audit-date-input"/></div>'
    +'<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:3px">To</div>'
      +'<input type="date" value="'+(_auditFilters.to||'')+'" onchange="_auditFilters.to=this.value;renderAudit()" class="audit-date-input"/></div>'
    +'<div style="display:flex;align-items:flex-end"><button class="btn sm" onclick="Object.keys(_auditFilters).forEach(function(k){_auditFilters[k]=\'\';});renderAudit()">Clear</button></div>'
    +'<div style="display:flex;align-items:flex-end;gap:6px;margin-left:auto">'+'<button class="btn sm" onclick="downloadAuditTemplate()">&#11015; Template</button>'+'<button class="btn sm teal" onclick="document.getElementById(\'audit-import-f\').click()">&#11014; Import Excel</button>'+'<input type="file" id="audit-import-f" accept=".xlsx,.xls" style="display:none" onchange="importAuditExcel(event)"/>'+'<button class="btn sm" onclick="exportAudit()">Export Excel</button>'+'</div>'+'</div>';

  const memberOpts=D.members.filter(function(m){return m.approved&&m.active!==false&&m.role!=='Talent on Demand';}).map(function(m){return'<option value="'+m.name+'">'+m.name+' ('+m.role+')</option>';}).join('');
  const tlOpts=D.members.filter(function(m){return m.approved&&m.active!==false&&['HOD','Manager','Assist. Manager','Team Lead'].includes(m.role);}).map(function(m){return'<option value="'+m.name+'">'+m.name+' ('+m.role+')</option>';}).join('');

  const tableRows=entries.map(function(e){return buildAuditRow(e,memberOpts,tlOpts);}).join('');

  // Build pending findings breakdown grouped by Team Lead
  const pendingItems=(D.auditLog||[]).filter(function(e){return !e.status||e.status==='Pending (Vhino to Update)';});
  let pendingBreakdownHtml='';
  if(pendingItems.length>0){
    const byTL={};
    pendingItems.forEach(function(a){
      const tl=a.teamLead||'(No Team Lead)';
      if(!byTL[tl])byTL[tl]=[];
      byTL[tl].push(a);
    });
    const tlCards=Object.entries(byTL).sort(function(a,b){return b[1].length-a[1].length;}).map(function([tl,items]){
      const rows=items.map(function(a){
        return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px">'
          +'<span style="color:var(--text4);min-width:70px">'+a.date+'</span>'
          +'<span style="color:var(--text3);min-width:36px">'+( a.region||'—')+'</span>'
          +'<span style="font-weight:600;min-width:100px">'+(a.brand||'—')+'</span>'
          +'<span style="color:var(--text3);min-width:80px">'+(a.platform||'—')+'</span>'
          +'<span style="color:var(--text2);min-width:110px">CDM: <b>'+(a.cdm||'—')+'</b></span>'
          +'<span style="color:var(--red);font-weight:500;flex:1">'+(a.issueType||'—')+' — '+(a.issueDetails||'—')+'</span>'
        +'</div>';
      }).join('');
      return '<div style="background:var(--surface);border:1px solid var(--red-mid);border-radius:var(--radius);padding:10px 14px;margin-bottom:8px">'
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
          +'<span class="av" style="width:22px;height:22px;font-size:8px;background:var(--red-light);color:var(--red)">'+ini(tl)+'</span>'
          +'<span style="font-weight:700;font-size:13px">'+tl+'</span>'
          +'<span style="background:var(--red-light);color:var(--red);font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;border:1px solid var(--red-mid)">'+items.length+' pending</span>'
        +'</div>'
        +rows
      +'</div>';
    }).join('');
    pendingBreakdownHtml='<div style="margin-bottom:16px">'
      +'<div class="section-hdr sh-red" style="margin-bottom:8px">⚠️ Audit Findings — Pending Resolution <span style="opacity:.7">('+pendingItems.length+')</span> <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0">Items cleared when status is set to Explained, No Issue, or No Action Needed</span></div>'
      +tlCards
    +'</div>';
  }

  el.innerHTML=''
    +'<div class="page-header">'
      +'<div><div class="page-title">Audit Log <span style="font-size:13px;color:var(--text3);font-weight:400">('+entries.length+(entries.length!==D.auditLog.length?' of '+D.auditLog.length:'')+' entries)</span>'+(isNonTOD()&&!CU.isAdmin?' <span style="font-size:11px;background:var(--yellow-light);color:#92400e;padding:2px 8px;border-radius:20px;border:1px solid var(--yellow-mid)">Fill: Root Cause · What Was Done · Preventive Action · Date Fixed</span>':'')+'</div><div class="page-subtitle">Compliance findings, root causes, and corrective actions</div></div>'
      +(CU.isAdmin?'<button class="btn primary" onclick="_auditNewRow=!_auditNewRow;renderAudit()">+ Log Finding</button>':'')
    +'</div>'
    +buildAuditLauncher()
    +'<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      +'<div style="background:var(--red-light);border:1px solid var(--red-mid);border-radius:var(--radius);padding:8px 14px;display:flex;align-items:center;gap:8px">'
        +'<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--red)">Pending</span>'
        +'<span style="font-size:20px;font-weight:800;color:var(--red)">'+pending+'</span></div>'
      +'<div style="background:var(--green-light);border:1px solid var(--green-mid);border-radius:var(--radius);padding:8px 14px;display:flex;align-items:center;gap:8px">'
        +'<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--green)">Resolved</span>'
        +'<span style="font-size:20px;font-weight:800;color:var(--green)">'+resolved+'</span></div>'
      +'<div style="background:var(--blue-light);border:1px solid var(--blue-mid);border-radius:var(--radius);padding:8px 14px;display:flex;align-items:center;gap:8px">'
        +'<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--blue)">Explained</span>'
        +'<span style="font-size:20px;font-weight:800;color:var(--blue)">'+explained+'</span></div>'
    +'</div>'
    +pendingBreakdownHtml
    +filterBar
    +'<div id="audit-scroll-wrap" style="overflow:auto;max-height:calc(100vh - 340px);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow)">'
      +'<table class="audit-table">'
        +'<thead>'
          +'<tr>'
            +'<th style="min-width:30px">#</th>'
            +'<th style="min-width:70px">Month</th>'
            +'<th style="min-width:95px">Date</th>'
            +'<th style="min-width:50px">Region</th>'
            +'<th style="min-width:120px">Brand</th>'
            +'<th style="min-width:80px">Platform</th>'
            +'<th style="min-width:140px">CDM</th>'
            +'<th style="min-width:140px">Team Lead</th>'
            +'<th style="min-width:70px">Auditor</th>'
            +'<th style="min-width:120px">Issue Type</th>'
            +'<th style="min-width:200px">Issue Details</th>'
            +'<th style="min-width:80px">Screenshot</th>'
            +'<th style="min-width:160px">Status</th>'
            +'<th style="min-width:160px">Gov\'t Remarks</th>'
            +'<th style="min-width:180px;background:#fffde7">Root Cause</th>'
            +'<th style="min-width:180px;background:#fffde7">What Was Done</th>'
            +'<th style="min-width:180px;background:#fffde7">Preventive Action</th>'
            +'<th style="min-width:90px;background:#fffde7">Date Fixed</th>'
            +(CU&&CU.isAdmin?'<th style="min-width:50px"></th>':'')
          +'</tr>'
        +'</thead>'
        +'<tbody>'
          +(_auditNewRow?buildAuditNewRow():'')
          +(tableRows||'<tr><td colspan="18" class="empty-state" style="padding:32px">'+(CU.isAdmin?'No entries yet. Click "+ Log Finding" to start.':'No audit entries found.')+'</td></tr>')
        +'</tbody>'
      +'</table>'
    +'</div>';
  // Restore scroll position after re-render
  const _sw2=document.getElementById('audit-scroll-wrap');
  if(_sw2){_sw2.scrollLeft=_savedX;_sw2.scrollTop=_savedY;}
}

function buildAuditRow(e,memberOpts,tlOpts){
  var isAdmin=CU.isAdmin;
  var canEditResponse=!isTOD();
  var idx=(D.auditLog||[]).findIndex(function(x){return x._key===e._key;})+1;
  var k=e._key;

  function aCell(field,val,type,opts){
    if(!isAdmin)return'<td style="font-size:12px">'+(val||'\u2014')+'</td>';
    if(type==='select'){
      return'<td><select class="audit-cell-select" onchange="auditUpdate(\''  +k+'\',\''+field+'\',this.value)">'
        +opts.map(function(o){return'<option value="'+o+'"'+(o===val?' selected':'')+'>'+o+'</option>';}).join('')
        +'</select></td>';
    }
    if(type==='date')return'<td><input type="date" class="audit-cell-edit" value="'+(val||'')+'" onchange="auditUpdate(\''  +k+'\',\''+field+'\',this.value)"/></td>';
    return'<td><input type="text" class="audit-cell-edit" value="'+(val||'')+'" placeholder="\u2014" onchange="auditUpdate(\''  +k+'\',\''+field+'\',this.value)"/></td>';
  }
  function mCell(field,val,type){
    var bg='background:#fffde7;';
    if(!canEditResponse)return'<td style="'+bg+'font-size:12px">'+(val||'\u2014')+'</td>';
    if(type==='date')return'<td style="'+bg+'"><input type="date" class="audit-cell-edit" style="background:transparent" value="'+(val||'')+'" onchange="auditUpdate(\''  +k+'\',\''+field+'\',this.value)"/></td>';
    return'<td style="'+bg+'"><input type="text" class="audit-cell-edit" style="background:transparent" value="'+(val||'')+'" placeholder="\u2014" onchange="auditUpdate(\''  +k+'\',\''+field+'\',this.value)"/></td>';
  }

  var statusClass=getAuditStatusClass(e.status);
  var statusCell=isAdmin
    ?'<td><select class="audit-cell-select '+statusClass+'" onchange="auditUpdate(\''  +k+'\',\'status\',this.value)">'
      +AUDIT_STATUSES.map(function(s){return'<option value="'+s+'"'+(s===e.status?' selected':'')+'>'+s+'</option>';}).join('')
      +'</select></td>'
    :'<td><span class="'+statusClass+'">'+(e.status||'Pending')+'</span></td>';

  var ssCell=isAdmin
    ?'<td><input type="text" class="audit-cell-edit" value="'+(e.screenshot||'')+'" placeholder="Paste URL..." onchange="auditUpdate(\''  +k+'\',\'screenshot\',this.value)"/>'
      +(e.screenshot?'<a href="'+e.screenshot+'" target="_blank" style="font-size:10px;color:var(--blue);display:block">View \u2197</a>':'')+'</td>'
    :'<td>'+(e.screenshot?'<a href="'+e.screenshot+'" target="_blank" style="font-size:11px;color:var(--blue)">View \u2197</a>':'\u2014')+'</td>';

  var cdmCell=isAdmin
    ?'<td><select class="audit-cell-select" onchange="auditUpdate(\''  +k+'\',\'cdm\',this.value)"><option value="">\u2014</option>'+memberOpts.split('<option value="'+e.cdm+'">').join('<option value="'+e.cdm+'" selected>')+'</select></td>'
    :'<td style="font-size:12px">'+(e.cdm||'\u2014')+'</td>';
  var tlCell=isAdmin
    ?'<td><select class="audit-cell-select" onchange="auditUpdate(\''  +k+'\',\'teamLead\',this.value)"><option value="">\u2014</option>'+tlOpts.split('<option value="'+e.teamLead+'">').join('<option value="'+e.teamLead+'" selected>')+'</select></td>'
    :'<td style="font-size:12px">'+(e.teamLead||'\u2014')+'</td>';

  return'<tr class="'+getAuditRowClass(e)+'">'
    +'<td style="color:var(--text4);font-size:11px;text-align:center">'+idx+'</td>'
    +aCell('month',e.month,'select',AUDIT_MONTHS)
    +aCell('date',e.date,'date')
    +aCell('region',e.region,'select',['MY','PH','TH','VN','ID','SG','EP'])
    +aCell('brand',e.brand,'text')
    +aCell('platform',e.platform,'select',AUDIT_PLATFORMS)
    +cdmCell+tlCell
    +aCell('auditor',e.auditor||CU.name,'text')
    +aCell('issueType',e.issueType,'select',AUDIT_ISSUE_TYPES)
    +aCell('issueDetails',e.issueDetails,'text')
    +ssCell+statusCell
    +aCell('govRemarks',e.govRemarks,'text')
    +mCell('rootCause',e.rootCause,'text')
    +mCell('whatWasDone',e.whatWasDone,'text')
    +mCell('preventiveAction',e.preventiveAction,'text')
    +mCell('dateFixed',e.dateFixed,'date')
    +(isAdmin?'<td><button class="btn sm del" onclick="auditDelete(\''  +k+'\')">Del</button></td>':'')
  +'</tr>';
}



function buildAuditNewRow(){
  const memberOpts=D.members.filter(function(m){return m.approved&&m.active!==false&&m.role!=='Talent on Demand';}).map(function(m){return'<option value="'+m.name+'">'+m.name+' ('+m.role+')</option>';}).join('');
  const tlOpts=D.members.filter(function(m){return m.approved&&m.active!==false&&['HOD','Manager','Assist. Manager','Team Lead'].includes(m.role);}).map(function(m){return'<option value="'+m.name+'">'+m.name+' ('+m.role+')</option>';}).join('');
  const today=ds(now());
  const curMonth=AUDIT_MONTHS[now().getMonth()];
  return'<tr style="background:#e8f4fd">'
    +'<td style="text-align:center;color:var(--text4)">*</td>'
    +'<td><select id="an-month" class="audit-cell-select">'+AUDIT_MONTHS.map(function(m){return'<option'+(m===curMonth?' selected':'')+'>'+m+'</option>';}).join('')+'</select></td>'
    +'<td><input id="an-date" type="date" class="audit-cell-edit" value="'+today+'"/></td>'
    +'<td><select id="an-region" class="audit-cell-select"><option value="">—</option>'+['MY','PH','TH','VN','ID','SG','EP'].map(function(r){return'<option>'+r+'</option>';}).join('')+'</select></td>'
    +'<td><input id="an-brand" type="text" class="audit-cell-edit" placeholder="Brand..."/></td>'
    +'<td><select id="an-platform" class="audit-cell-select">'+AUDIT_PLATFORMS.map(function(p){return'<option>'+p+'</option>';}).join('')+'</select></td>'
    +'<td><select id="an-cdm" class="audit-cell-select"><option value="">— CDM —</option>'+memberOpts+'</select></td>'
    +'<td><select id="an-tl" class="audit-cell-select"><option value="">— TL —</option>'+tlOpts+'</select></td>'
    +'<td><input id="an-auditor" type="text" class="audit-cell-edit" value="'+CU.name+'"/></td>'
    +'<td><select id="an-issue" class="audit-cell-select">'+AUDIT_ISSUE_TYPES.map(function(t){return'<option>'+t+'</option>';}).join('')+'</select></td>'
    +'<td><input id="an-details" type="text" class="audit-cell-edit" placeholder="Issue details..."/></td>'
    +'<td><input id="an-ss" type="text" class="audit-cell-edit" placeholder="Screenshot URL..."/></td>'
    +'<td><select id="an-status" class="audit-cell-select">'+AUDIT_STATUSES.map(function(s){return'<option>'+s+'</option>';}).join('')+'</select></td>'
    +'<td><input id="an-remarks" type="text" class="audit-cell-edit" placeholder="Remarks..."/></td>'
    +'<td style="background:#fffde7" colspan="4">'
      +'<div style="display:flex;gap:6px;align-items:center;padding:2px">'
        +'<button class="btn sm primary" onclick="saveAuditEntry()">Save Row</button>'
        +'<button class="btn sm" onclick="_auditNewRow=false;renderAudit()">Cancel</button>'
        +'<span style="font-size:10px;color:var(--text3)">Member fills O–R after tagging</span>'
      +'</div>'
    +'</td>'
  +'</tr>';
}

async function saveAuditEntry(){
  const brand=document.getElementById('an-brand')?.value.trim();
  if(!brand){toast('Brand is required');return;}
  const cdmName=document.getElementById('an-cdm')?.value||'';
  const tlName=document.getElementById('an-tl')?.value||'';
  const cdmMember=D.members.find(function(m){return m.name===cdmName;});
  const taggedMembers=cdmMember?[cdmMember.username]:[];
  const entry={
    month:document.getElementById('an-month')?.value||'',
    date:document.getElementById('an-date')?.value||ds(now()),
    region:document.getElementById('an-region')?.value||'',
    brand,platform:document.getElementById('an-platform')?.value||'',
    cdm:cdmName,teamLead:tlName,
    auditor:document.getElementById('an-auditor')?.value||CU.name,
    issueType:document.getElementById('an-issue')?.value||'',
    issueDetails:document.getElementById('an-details')?.value||'',
    screenshot:document.getElementById('an-ss')?.value||'',
    status:document.getElementById('an-status')?.value||'Pending (Vhino to Update)',
    govRemarks:document.getElementById('an-remarks')?.value||'',
    taggedMembers,rootCause:'',whatWasDone:'',preventiveAction:'',dateFixed:'',
    ts:Date.now(),loggedBy:CU.name
  };
  await fbPush('auditLog',entry);
  await logAct(0,ds(now()),CU.name,'Audit Finding: '+brand+(entry.region?' ('+entry.region+')':''),'AUDIT');
  // Keep the new-row form open so admin can continue adding entries
  // Reset only the input fields
  ['an-brand','an-details','an-ss','an-remarks'].forEach(function(id){const el=document.getElementById(id);if(el)el.value='';});
  const anDate=document.getElementById('an-date');if(anDate)anDate.value=ds(now());
  toast('Audit entry saved!');
  if(taggedMembers.length&&entry.status==='Pending (Vhino to Update)'){
    await fbSet('broadcast',{msg:'📋 Audit finding logged for '+brand+' ('+entry.region+'). '+cdmName+' — please fill in your response in the Audit Log.',ts:Date.now(),sentBy:CU.name});
  }
}

async function auditUpdate(key,field,val){
  await fbUpd('auditLog/'+key,{[field]:val});
}

async function auditDelete(key){
  if(!confirm('Delete this audit entry? This cannot be undone.'))return;
  await fbDel('auditLog/'+key);
  toast('Entry deleted');
}

function exportAudit(){
  const rows=(D.auditLog||[]).map(function(e,i){
    var r={'#':i+1,Month:e.month,Date:e.date,Region:e.region,Brand:e.brand,Platform:e.platform,CDM:e.cdm,'Team Lead':e.teamLead,Auditor:e.auditor,'Issue Type':e.issueType,'Issue Details':e.issueDetails,Screenshot:e.screenshot,Status:e.status,"Gov't Remarks":e.govRemarks,'Root Cause':e.rootCause,'What Was Done':e.whatWasDone,'Preventive Action':e.preventiveAction,'Date Fixed':e.dateFixed};
    return r;
  });
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Audit Log');
  XLSX.writeFile(wb,'GovernanceHub_AuditLog_'+ds(now())+'.xlsx');
  toast('Exported!');
}

function downloadAuditTemplate(){
  const headers=['Month','Date','Region','Brand','Platform','CDM','Team Lead','Auditor','Issue Type','Issue Details','Screenshot URL','Status',"Gov't Remarks",'Root Cause','What Was Done','Preventive Action','Date Fixed'];
  const example=[
    'April','2025-04-21','PH','Brand Name','Lazada','CDM Name','TL Name','Auditor Name','No Issue','Sample issue details','https://...','Pending (Vhino to Update)','','','','',''
  ];
  const notes=[
    '→ Months: January February March April May June July August September October November December',
    '→ Date format: YYYY-MM-DD (e.g. 2025-04-21)',
    '→ Regions: MY PH TH VN ID SG EP',
    '→ Platforms: Lazada Shopee TikTok Zalora Qoo10 All',
    '→ Issue Types: SIS / Listing / Category / Merchandise Master / Compliance / Others / No Issue',
    '→ Statuses: Pending (Vhino to Update) / Resolved / Explained / No Action Needed / No Issue',
    '→ Delete this row and the notes rows before importing. Keep the header row.',
  ];
  const wb=XLSX.utils.book_new();
  const wsData=[headers,example,...notes.map(n=>[n])];
  const ws=XLSX.utils.aoa_to_sheet(wsData);
  // Column widths
  ws['!cols']=headers.map(()=>({wch:22}));
  XLSX.utils.book_append_sheet(wb,ws,'Audit Log Template');
  XLSX.writeFile(wb,'AuditLog_Template.xlsx');
  toast('Template downloaded!');
}

async function importAuditExcel(evt){
  const file=evt.target.files[0];if(!file)return;
  evt.target.value='';
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      if(rows.length<2){toast('File is empty or has no data rows.');return;}
      const header=rows[0].map(h=>String(h).trim());
      const expected=['Month','Date','Region','Brand','Platform','CDM','Team Lead','Auditor','Issue Type','Issue Details','Screenshot URL','Status',"Gov't Remarks",'Root Cause','What Was Done','Preventive Action','Date Fixed'];
      // Map columns by header name
      const idx={};
      expected.forEach(function(h){idx[h]=header.indexOf(h);});
      if(idx['Brand']===-1){toast('Invalid template. Please use the downloaded template.');return;}
      let added=0,skipped=0;
      const dataRows=rows.slice(1).filter(function(r){
        const brand=String(r[idx['Brand']]||'').trim();
        return brand&&!brand.startsWith('→');
      });
      for(const row of dataRows){
        const brand=String(row[idx['Brand']]||'').trim();
        if(!brand){skipped++;continue;}
        const cdmName=String(row[idx['CDM']]||'').trim();
        const cdmMember=D.members.find(function(m){return m.name===cdmName;});
        const taggedMembers=cdmMember?[cdmMember.username]:[];
        const entry={
          month:String(row[idx['Month']]||'').trim(),
          date:String(row[idx['Date']]||'').trim(),
          region:String(row[idx['Region']]||'').trim(),
          brand,
          platform:String(row[idx['Platform']]||'').trim(),
          cdm:cdmName,
          teamLead:String(row[idx['Team Lead']]||'').trim(),
          auditor:String(row[idx['Auditor']]||CU.name).trim(),
          issueType:String(row[idx['Issue Type']]||'').trim(),
          issueDetails:String(row[idx['Issue Details']]||'').trim(),
          screenshot:String(row[idx['Screenshot URL']]||'').trim(),
          status:String(row[idx['Status']]||'Pending (Vhino to Update)').trim(),
          govRemarks:String(row[idx["Gov't Remarks"]]||'').trim(),
          rootCause:String(row[idx['Root Cause']]||'').trim(),
          whatWasDone:String(row[idx['What Was Done']]||'').trim(),
          preventiveAction:String(row[idx['Preventive Action']]||'').trim(),
          dateFixed:String(row[idx['Date Fixed']]||'').trim(),
          taggedMembers,
          ts:Date.now(),
          loggedBy:CU.name
        };
        await fbPush('auditLog',entry);
        added++;
      }
      toast('Imported '+added+' entr'+(added===1?'y':'ies')+(skipped?' ('+skipped+' skipped)':'')+'!');
    }catch(err){toast('Import error: '+err.message);}
  };
  reader.readAsBinaryString(file);
}

function getMyAuditItems(){
  if(isTOD())return[];
  if(CU.isAdmin)return[];
  // CDM (Executive) and Team Lead: see items where their name appears in cdm or teamLead field
  return(D.auditLog||[]).filter(function(e){
    if(e.status!=='Pending (Vhino to Update)')return false;
    var myName=CU.name||'';
    var isCDM=e.cdm&&e.cdm===myName;
    var isTL=e.teamLead&&e.teamLead===myName;
    return isCDM||isTL;
  });
}

// AO Region summary cards — shown at top of dashboard like metric cards
function buildAOWidget(){return '';}

// ─── isTOD ───
function isTOD(){return CU&&!CU.isAdmin&&CU.role==='Talent on Demand';}
// Admin can grant individual TOD members access to Live Trackers (CU.ltAccess is kept in
// sync with the member record via the 'members' listener and on login).
function canSeeLiveTrackers(){return CU&&(CU.isAdmin||!isTOD()||!!CU.ltAccess);}

// ─── TOD helpers ───
function todWeekDates(){const d=[];for(let i=0;i<7;i++){const x=new Date(_todWeekStart);x.setDate(_todWeekStart.getDate()+i);d.push(x);}return d;}
function todWeekLabel(){const d=todWeekDates();return fmtD(d[0])+' \u2013 '+fmtD(d[6]);}
function todPrevWeek(){_todWeekStart.setDate(_todWeekStart.getDate()-7);renderTOD();}
function todNextWeek(){_todWeekStart.setDate(_todWeekStart.getDate()+7);renderTOD();}

// ─── TOD monthly helpers ───
// Returns Mon–Fri dates only for the month of `monthDate` (weekends auto-excluded).
function todMonthWeekdays(monthDate){
  const y=monthDate.getFullYear(),mo=monthDate.getMonth();
  const dim=new Date(y,mo+1,0).getDate();
  const out=[];
  for(let d=1;d<=dim;d++){
    const dt=new Date(y,mo,d);
    const dow=dt.getDay();
    if(dow!==0&&dow!==6)out.push(dt);
  }
  return out;
}
function todMonthLabel(){return fmtM(_todMonthDate||now());}
function todPrevMonth(){if(!_todMonthDate)_todMonthDate=new Date(now().getFullYear(),now().getMonth(),1);_todMonthDate.setMonth(_todMonthDate.getMonth()-1);renderTOD();}
function todNextMonth(){if(!_todMonthDate)_todMonthDate=new Date(now().getFullYear(),now().getMonth(),1);_todMonthDate.setMonth(_todMonthDate.getMonth()+1);renderTOD();}
function todSetView(mode){_todViewMode=mode;renderTOD();}
function todSelectMember(u){_todSelectedMember=u;renderTOD();}

// Parses "HH:MM" (24h, from <input type=time>) into {h,m}. Returns null if blank/invalid.
function parseHHMM(str){
  if(!str)return null;
  const parts=str.split(':');
  if(parts.length<2)return null;
  const h=parseInt(parts[0],10),m=parseInt(parts[1],10);
  if(isNaN(h)||isNaN(m))return null;
  return{h,m};
}
// Combines a "YYYY-MM-DD" date string with an "HH:MM" schedule time into a real Date.
function schedDateTime(dds,hhmm){
  const t=parseHHMM(hhmm);if(!t)return null;
  const parts=dds.split('-');
  return new Date(parseInt(parts[0],10),parseInt(parts[1],10)-1,parseInt(parts[2],10),t.h,t.m,0,0);
}
function fmtMinsShort(mins){
  if(mins<60)return mins+'m';
  const h=Math.floor(mins/60),m=mins%60;
  return h+'h '+(m?m+'m':'');
}
// Plain decimal hour count for billing rows, e.g. 4, 3.5, 0 (no "h m" suffix).
function hoursDecimal(ms){
  if(!ms||ms<=0)return 0;
  return Math.round((ms/3600000)*100)/100;
}
function fmtPeso(n){
  return 'PHP '+(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
// Scheduled duration for a member on a given date, derived from their Scheduled Start/End
// minus their unpaid break (e.g. 09:00–18:00 with a 60-min break = 8h). Returns 0 if no
// schedule is set. breakMins defaults to 0 if not configured on the member.
function schedHoursMs(m,dds){
  if(!m.schedStart||!m.schedEnd)return 0;
  const s=schedDateTime(dds,m.schedStart),e=schedDateTime(dds,m.schedEnd);
  if(!s||!e)return 0;
  let diff=e-s;
  if(diff<=0)diff+=24*3600000; // schedule crosses midnight
  diff-=(m.breakMins||0)*60000;
  return diff>0?diff:0;
}
// Overtime logged for a member on a given date (admin or the member themselves can log it).
// Stored as a decimal hour count in D.todOvertime[username][date].hours.
function otHoursMs(username,dds){
  const rec=(D.todOvertime[username]||{})[dds];
  if(!rec||!rec.hours)return 0;
  return Math.round(rec.hours*3600000);
}
// Billing calc for the monthly Service/Rate/Amount table. TOD members only clock in — no
// logout is required. A day "qualifies" for pay simply by logging in, and the hours paid are
// the member's regular scheduled duration for that day (e.g. 8h or 4h, minus break).
// Overtime is stored separately in otMs and must never be folded into hoursMs. A day with no schedule configured can't be priced, so it's
// not qualified even if attended (unless overtime alone was logged).
function computeBillingDayRecord(m,dds){
  const att=D.todAttendance||{};
  const rec=(att[m.username]||{})[dds]||{};
  const out={timeIn:null,hoursMs:0,otMs:0,qualified:false,attended:!!rec.timeIn};
  if(!rec.timeIn)return out;
  out.timeIn=new Date(rec.timeIn);
  out.otMs=otHoursMs(m.username,dds);
  out.hoursMs=schedHoursMs(m,dds);
  out.qualified=out.hoursMs>0;
  return out;
}
// Core attendance computation for one member on one date. Members only log a time in; worked
// regular hours are auto-computed from their schedule (Scheduled Start/End minus break).
// Overtime remains separate in otMs rather than being folded into regular hours. Lateness is still tracked
// against the scheduled start for status display.
function computeDayRecord(m,dds){
  const att=D.todAttendance||{};
  const rec=(att[m.username]||{})[dds]||{};
  const out={timeIn:null,lateMins:0,hoursMs:0,otMs:0,status:'Absent',hasSchedule:!!(m.schedStart&&m.schedEnd)};
  if(!rec.timeIn)return out;
  const inDate=new Date(rec.timeIn);
  out.timeIn=inDate;
  const schedStart=m.schedStart?schedDateTime(dds,m.schedStart):null;
  if(schedStart&&inDate>schedStart){
    out.lateMins=Math.round((inDate-schedStart)/60000);
  }
  out.otMs=otHoursMs(m.username,dds);
  out.hoursMs=schedHoursMs(m,dds);
  out.status=out.lateMins>0?('Late by '+fmtMinsShort(out.lateMins)):(out.hasSchedule?'On time':'Logged in');
  return out;
}

function renderTOD(){
  var el=document.getElementById('pg-tod');
  if(!el)return;
  if(!CU.isAdmin&&!isTOD()){el.innerHTML='<div class="empty-state" style="padding:60px"><div style="font-size:32px;margin-bottom:12px">🔒</div><div style="font-weight:700;font-size:16px;color:var(--text2)">Access Restricted</div><div style="font-size:13px;color:var(--text3);margin-top:6px">Talent on Demand is only available to admins and TOD members.</div></div>';return;}
  if(!_todWeekStart){
    var td=now();
    _todWeekStart=new Date(td);
    // Start from Monday of current week
    var day=td.getDay();
    var diff=day===0?-6:1-day; // if Sunday go back 6, else go to Monday
    _todWeekStart.setDate(td.getDate()+diff);
    _todWeekStart.setHours(0,0,0,0);
  }
  if(!_todMonthDate){_todMonthDate=new Date(now().getFullYear(),now().getMonth(),1);}

  // Quick log in for TOD members (shown in header, both view modes)
  var todayStr2=ds(now());
  var myRec=isTOD()?(D.todAttendance&&D.todAttendance[CU.username]&&D.todAttendance[CU.username][todayStr2])||{}:{};
  var quickBtns='';
  if(isTOD()){
    if(!myRec.timeIn){
      quickBtns='<button class="tod-btn-in" data-action="login" data-user="'+CU.username+'" data-date="'+todayStr2+'" style="padding:6px 16px;font-size:13px">Log In</button>';
    } else {
      var inT=new Date(myRec.timeIn).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
      var myMember=D.members.find(function(x){return x.username===CU.username;})||CU;
      var myDayC=computeDayRecord(myMember,todayStr2);
      quickBtns='<span style="font-size:12px;color:var(--green);font-weight:600">IN '+inT+'</span>'
        +(myDayC.hoursMs?'<span style="font-size:12px;color:var(--text3);margin-left:8px">'+fmtHours(myDayC.hoursMs)+(myDayC.otMs?' (incl. OT)':'')+' scheduled</span>':'');
    }
    quickBtns+='<button class="btn sm" style="margin-left:8px" onclick="openOTModal(\''+CU.username+'\',\''+todayStr2+'\')">+ Log Overtime</button>';
  }

  var viewToggle='<div style="display:flex;background:#f1f5f9;border-radius:var(--radius);padding:2px;gap:2px">'
    +'<button class="btn sm'+(_todViewMode==='weekly'?' primary':'')+'" style="padding:5px 12px" onclick="todSetView(\'weekly\')">Weekly</button>'
    +'<button class="btn sm'+(_todViewMode==='monthly'?' primary':'')+'" style="padding:5px 12px" onclick="todSetView(\'monthly\')">Summary</button>'
    +'</div>';

  el.innerHTML=''
    +'<div class="page-header">'
      +'<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        +'<div class="page-title">'+(isTOD()?'My Attendance':'Talent on Demand')+'</div>'
        +quickBtns
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+viewToggle+'</div>'
    +'</div>'
    +'<div id="tod-body"></div>';

  if(_todViewMode==='monthly')renderTODMonthly();
  else renderTODWeekly();
}

function renderTODWeekly(){
  var body=document.getElementById('tod-body');
  if(!body)return;
  var att=D.todAttendance||{};
  var dates=todWeekDates();
  var todMems=D.members.filter(function(m){return m.role==='Talent on Demand'&&m.approved;});
  var samples=todMems.length?todMems:[
    {username:'tod1',name:'TOD 1',role:'Talent on Demand'},
    {username:'tod2',name:'TOD 2',role:'Talent on Demand'},
    {username:'tod3',name:'TOD 3',role:'Talent on Demand'},
    {username:'tod4',name:'TOD 4',role:'Talent on Demand'},
    {username:'tod5',name:'TOD 5',role:'Talent on Demand'},
  ];
  var display=isTOD()?samples.filter(function(m){return m.username===CU.username;}):samples;
  var todayStr=ds(now());

  // Day headers
  var dayHdrs='';
  dates.forEach(function(d,i){
    var isT=ds(d)===todayStr;
    dayHdrs+='<th style="min-width:110px;text-align:center;background:'+(isT?'var(--blue-light)':'#f8fafc')+';color:'+(isT?'var(--blue)':'var(--text3)')+';">'
      +'<div style="font-weight:700">'+DOW[i]+'</div>'
      +'<div style="font-size:11px;font-weight:400">'+d.toLocaleDateString('en-PH',{month:'short',day:'numeric'})+'</div>'
      +'</th>';
  });

  // Data rows
  var rows='';
  display.forEach(function(m){
    var cells='';
    dates.forEach(function(d){
      var dds=ds(d);
      var rec=(att[m.username]||{})[dds]||{};
      var dayC=computeDayRecord(m,dds);
      var isT=dds===todayStr;
      var isMe=m.username===CU.username;
      var hrs=dayC.hoursMs?fmtHours(dayC.hoursMs):'';
      var canEditOT=isMe||CU.isAdmin;
      var inner='';
      if(rec.timeIn){
        var inTime=new Date(rec.timeIn).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
        inner='<div style="display:flex;flex-direction:column;align-items:center;gap:2px">'
          +'<div style="font-size:11px;font-weight:600;color:var(--green)">IN '+inTime+'</div>';
        if(dayC.lateMins>0){
          inner+='<div style="font-size:10px;font-weight:700;color:var(--red)">Late '+fmtMinsShort(dayC.lateMins)+'</div>';
        }
        if(hrs){
          inner+='<div style="font-size:10px;color:var(--text3)">'+hrs+'</div>';
        }
        if(dayC.otMs){
          inner+='<div style="font-size:9px;font-weight:700;color:#7c3aed">+OT '+fmtHours(dayC.otMs)+'</div>';
        }
        if(canEditOT){
          inner+='<button class="btn sm" style="padding:1px 6px;font-size:9px;margin-top:1px" onclick="openOTModal(\''+m.username+'\',\''+dds+'\')">'+(dayC.otMs?'Edit OT':'+ OT')+'</button>';
        }
        inner+='</div>';
      } else if(isT&&(isMe||CU.isAdmin)){
        inner='<button class="tod-btn-in" data-action="login" data-user="'+m.username+'" data-date="'+dds+'">Log In</button>';
      } else {
        inner='<span style="font-size:11px;color:var(--text4)">—</span>';
      }
      cells+='<td style="text-align:center;vertical-align:middle;background:'+(isT?'#fffbeb':'')+';padding:8px 6px;border-bottom:1px solid #f1f3f5;border-right:1px solid var(--border)">'+inner+'</td>';
    });

    // Weekly summary (uses the same schedule-aware calc, so a missing logout still counts
    // toward the total via the member's scheduled end time, minus any late minutes)
    var totalMs=0,daysP=0,daysLate=0;
    dates.forEach(function(d){
      var dds=ds(d);
      var rec=(att[m.username]||{})[dds]||{};
      if(rec.timeIn){
        daysP++;
        var dc=computeDayRecord(m,dds);
        totalMs+=dc.hoursMs;
        if(dc.lateMins>0)daysLate++;
      }
    });

    rows+='<tr>'
      +'<td style="font-weight:600;white-space:nowrap;padding:10px 12px;border-bottom:1px solid #f1f3f5;border-right:1px solid var(--border)">'
        +'<div style="display:flex;align-items:center;gap:6px">'
          +'<span class="av" style="width:24px;height:24px;font-size:9px">'+ini(m.name)+'</span>'
          +m.name
        +'</div>'
      +'</td>'
      +cells
      +'<td style="text-align:center;background:#f8fafc;font-weight:600;padding:10px 12px;border-bottom:1px solid #f1f3f5">'
        +'<div style="font-size:13px;color:var(--green)">'+fmtHours(totalMs)+'</div>'
        +'<div style="font-size:11px;color:var(--text3)">'+daysP+'/5d'+(daysLate?' · '+daysLate+' late':'')+'</div>'
      +'</td>'
    +'</tr>';
  });

  // Summary cards (admin only)
  var summaryHtml='';
  if(CU.isAdmin){
    var totalP=0;
    samples.forEach(function(m){
      dates.forEach(function(d){if((att[m.username]||{})[ds(d)]&&(att[m.username]||{})[ds(d)].timeIn)totalP++;});
    });
    var maxDays=samples.length*5;
    var rate=maxDays?Math.round(totalP/maxDays*100):0;
    summaryHtml='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">'
      +'<div class="metric-card mc-blue"><div class="mc-label">TOD Members</div><div class="mc-val">'+samples.length+'</div></div>'
      +'<div class="metric-card mc-green"><div class="mc-label">Days Logged</div><div class="mc-val">'+totalP+'</div></div>'
      +'<div class="metric-card mc-black"><div class="mc-label">Attendance Rate</div><div class="mc-val">'+rate+'%</div></div>'
    +'</div>';
  }

  var exportBtn=CU.isAdmin?'<button class="btn sm" onclick="exportTOD()">Export Excel</button>':'';

  body.innerHTML=''
    +'<div class="date-nav" style="margin-bottom:12px">'
      +'<button class="nav-arrow" onclick="todPrevWeek()">&#8592;</button>'
      +'<span style="font-size:13px;font-weight:500;padding:6px 10px">'+todWeekLabel()+'</span>'
      +'<button class="nav-arrow" onclick="todNextWeek()">&#8594;</button>'
      +exportBtn
    +'</div>'
    +summaryHtml
    +'<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow)">'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
        +'<thead>'
          +'<tr>'
            +'<th style="text-align:left;padding:10px 12px;background:#f8fafc;border-bottom:1px solid var(--border);border-right:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3);min-width:140px">Name</th>'
            +dayHdrs
            +'<th style="min-width:100px;text-align:center;background:#f8fafc;padding:10px 12px;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Week Total</th>'
          +'</tr>'
        +'</thead>'
        +'<tbody>'+(rows||'<tr><td colspan="9" class="empty-state">No TOD members yet.</td></tr>')+'</tbody>'
      +'</table>'
    +'</div>';
}

function renderTODMonthly(){
  var body=document.getElementById('tod-body');
  if(!body)return;
  var todMems=D.members.filter(function(m){return m.role==='Talent on Demand'&&m.approved;});
  var canPickMember=CU.isAdmin;
  var selUser=isTOD()?CU.username:(_todSelectedMember||(todMems[0]&&todMems[0].username)||'');
  var selMember=todMems.find(function(m){return m.username===selUser;});
  var weekdays=todMonthWeekdays(_todMonthDate);

  var memberPicker='';
  if(canPickMember){
    memberPicker='<select class="finput nb" style="width:auto;padding:6px 10px;font-size:13px" onchange="todSelectMember(this.value)">'
      +todMems.map(function(m){return '<option value="'+m.username+'"'+(m.username===selUser?' selected':'')+'>'+m.name+'</option>';}).join('')
    +'</select>';
  }

  var monthNav='<div class="date-nav" style="margin-bottom:12px">'
    +'<button class="nav-arrow" onclick="todPrevMonth()">&#8592;</button>'
    +'<span style="font-size:13px;font-weight:500;padding:6px 10px">'+todMonthLabel()+'</span>'
    +'<button class="nav-arrow" onclick="todNextMonth()">&#8594;</button>'
    +memberPicker
    +(selMember?'<button class="btn sm" onclick="exportTODMonth(\''+selMember.username+'\')">Export Excel</button>':'')
  +'</div>';

  if(!selMember){
    body.innerHTML=monthNav+'<div class="empty-state" style="padding:40px">No TOD members yet.</div>';
    return;
  }
  if(!selMember.schedStart||!selMember.schedEnd){
    body.innerHTML=monthNav+'<div class="empty-state" style="padding:20px;text-align:left;background:var(--yellow-light);border-radius:var(--radius);color:#92400e;font-size:12px">'+selMember.name+' doesn\'t have a scheduled start/end time set yet, so on-time logout (and therefore duration/pay) can\'t be computed. Set it in <b>Members → Edit</b>.</div>';
  }

  if(CU.isAdmin){renderTODMonthlyBilling(body,monthNav,selMember,weekdays);}
  else{renderTODMonthlySelf(body,monthNav,selMember,weekdays);}
}

// Admin view: the Service / Date / Time In / Duration / OT / Rate / Amount billing table.
// Members only clock in — no logout required. Duration (and therefore Amount) is the member's
// full scheduled hours for that day (e.g. 8h or 4h) as soon as they've logged in, plus any
// overtime logged for that date (paid at the same rate). A day only shows as "Not Qualified"
// if the member has no Scheduled Start/End set and no overtime logged, since hours can't be
// priced. Admin can log/edit overtime for any day directly from this table.
function renderTODMonthlyBilling(body,monthNav,selMember,weekdays){
  var todayStr=ds(now());
  var trows='',daysPresent=0,daysQualified=0,totalMs=0,totalAmount=0,totalOtMs=0;
  var rate=selMember.rate||0;
  var serviceLabel=escHtml(selMember.service||'—');

  weekdays.forEach(function(d){
    var dds=ds(d);
    var bc=computeBillingDayRecord(selMember,dds);
    if(!bc.attended)return; // only show days the member actually clocked in on, like the reference sheet

    daysPresent++;
    var dateLabel=d.toLocaleDateString('en-PH',{month:'long',day:'2-digit',year:'numeric'})+(dds===todayStr?' <span style="color:var(--blue);font-weight:700">(Today)</span>':'');
    var otLabel=bc.otMs?hoursDecimal(bc.otMs):0;
    var otBtn='<button class="btn sm" style="padding:2px 8px;font-size:10px" onclick="openOTModal(\''+selMember.username+'\',\''+dds+'\')">'+(bc.otMs?'Edit OT':'+ OT')+'</button>';

    if(bc.qualified){
      daysQualified++;
      var hrs=hoursDecimal(bc.hoursMs);
      var otHrs=hoursDecimal(bc.otMs);
      var amt=Math.round((hrs+otHrs)*rate*100)/100;
      totalMs+=bc.hoursMs;totalAmount+=amt;totalOtMs+=bc.otMs;
      var inLabel=bc.timeIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
      trows+='<tr>'
        +'<td style="padding:8px 12px;border-bottom:1px solid #f1f3f5;color:var(--blue);font-weight:600">'+serviceLabel+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+dateLabel+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+inLabel+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:600">'+hrs+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;color:#7c3aed;font-weight:600">'+(bc.otMs?otLabel:'—')+'<div>'+otBtn+'</div></td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:700">'+(hrs+otHrs)+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+rate+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:600">'+amt.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'
      +'</tr>';
    } else {
      trows+='<tr style="background:var(--green-light,#f0fdf4)">'
        +'<td colspan="4" style="padding:8px 12px;border-bottom:1px solid #f1f3f5;text-align:center;font-weight:700;color:#166534">Not Qualified <span style="font-weight:400;color:var(--text3)">(No scheduled hours set)</span></td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+otBtn+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:700">0</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+rate+'</td>'
        +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:600">0</td>'
      +'</tr>';
    }
  });

  var summaryHtml='<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">'
    +'<div class="metric-card mc-blue"><div class="mc-label">Days Logged</div><div class="mc-val">'+daysPresent+'/'+weekdays.length+'</div></div>'
    +'<div class="metric-card mc-green"><div class="mc-label">Days Qualified</div><div class="mc-val">'+daysQualified+'</div></div>'
    +'<div class="metric-card mc-black"><div class="mc-label">Total Hours</div><div class="mc-val">'+hoursDecimal(totalMs)+'</div></div>'
    +'<div class="metric-card mc-black"><div class="mc-label">Total Overtime</div><div class="mc-val">'+hoursDecimal(totalOtMs)+'</div></div>'
    +'<div class="metric-card mc-black"><div class="mc-label">Grand Total</div><div class="mc-val">'+(hoursDecimal(totalMs)+hoursDecimal(totalOtMs))+'</div></div>'
    +'<div class="metric-card mc-blue"><div class="mc-label">Total Amount</div><div class="mc-val">'+fmtPeso(totalAmount)+'</div></div>'
  +'</div>';

  body.innerHTML=monthNav+summaryHtml
    +'<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow)">'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
        +'<thead><tr>'
          +'<th style="text-align:left;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Service</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Date</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Time In</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Duration<br>(# of hours)</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Overtime</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Total Hours</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Rate</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#e8edf7;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Amount</th>'
        +'</tr></thead>'
        +'<tbody>'+(trows||'<tr><td colspan="8" class="empty-state">No attendance logged this month.</td></tr>')
          +'<tr style="background:#f8fafc;font-weight:700">'
            +'<td colspan="3" style="padding:10px 12px;text-align:center;border-top:2px solid var(--border)">Total</td>'
            +'<td style="text-align:center;padding:10px 12px;border-top:2px solid var(--border)">'+hoursDecimal(totalMs)+'</td>'
            +'<td style="text-align:center;padding:10px 12px;border-top:2px solid var(--border)">'+hoursDecimal(totalOtMs)+'</td>'
            +'<td style="text-align:center;padding:10px 12px;border-top:2px solid var(--border)">'+(hoursDecimal(totalMs)+hoursDecimal(totalOtMs))+'</td>'
            +'<td style="text-align:center;padding:10px 12px;border-top:2px solid var(--border)"></td>'
            +'<td style="text-align:center;padding:10px 12px;border-top:2px solid var(--border)">'+fmtPeso(totalAmount)+'</td>'
          +'</tr>'
        +'</tbody>'
      +'</table>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--text3);margin-top:8px">Rate and Amount are only shown here — TOD members do not see this table. Duration is the member\'s full scheduled hours for the day (minus their break), credited as soon as they log in — no logout required. Overtime is logged manually per day and paid at the same rate. Total Hours and Amount include both regular Duration and Overtime.</div>'
    +'<div style="margin-top:14px"><button class="btn sm" onclick="exportTODMonthSummary()">Export All TOD Members — Monthly Summary</button></div>';
}

// TOD self view: attendance-only, no Service/Rate/Amount — those stay admin-only.
function renderTODMonthlySelf(body,monthNav,selMember,weekdays){
  var todayStr=ds(now());
  var trows='',daysPresent=0,daysLate=0,totalMs=0,totalLateMins=0,totalOtMs=0;
  weekdays.forEach(function(d){
    var dds=ds(d);
    var dc=computeDayRecord(selMember,dds);
    var isFuture=dds>todayStr;
    if(dc.timeIn){
      daysPresent++;
      totalMs+=dc.hoursMs;
      totalOtMs+=dc.otMs;
      if(dc.lateMins>0){daysLate++;totalLateMins+=dc.lateMins;}
    }
    var statusColor=dc.lateMins>0?'var(--red)':(dc.timeIn?'var(--green)':(isFuture?'var(--text4)':'var(--text3)'));
    var statusLabel=dc.timeIn?dc.status:(isFuture?'—':'Absent');
    var inLabel=dc.timeIn?dc.timeIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):'—';
    var hoursLabel=dc.hoursMs?fmtHours(dc.hoursMs):'—';
    var otLabel=dc.otMs?fmtHours(dc.otMs):'—';
    var otBtn=!isFuture?'<button class="btn sm" style="padding:2px 8px;font-size:10px" onclick="openOTModal(\''+selMember.username+'\',\''+dds+'\')">'+(dc.otMs?'Edit':'+ Log')+'</button>':'';
    trows+='<tr>'
      +'<td style="padding:8px 12px;border-bottom:1px solid #f1f3f5">'+DOW[d.getDay()]+', '+d.toLocaleDateString('en-PH',{month:'short',day:'numeric'})+(dds===todayStr?' <span style="color:var(--blue);font-weight:700">(Today)</span>':'')+'</td>'
      +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+inLabel+'</td>'
      +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;color:'+statusColor+';font-weight:600">'+statusLabel+'</td>'
      +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;font-weight:600">'+hoursLabel+'</td>'
      +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5;color:#7c3aed;font-weight:600">'+otLabel+'</td>'
      +'<td style="text-align:center;padding:8px 12px;border-bottom:1px solid #f1f3f5">'+otBtn+'</td>'
    +'</tr>';
  });

  var summaryHtml='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">'
    +'<div class="metric-card mc-blue"><div class="mc-label">Days Worked</div><div class="mc-val">'+daysPresent+'/'+weekdays.length+'</div></div>'
    +'<div class="metric-card mc-black"><div class="mc-label">Days Late</div><div class="mc-val">'+daysLate+'</div></div>'
    +'<div class="metric-card mc-green"><div class="mc-label">Total Hours</div><div class="mc-val">'+fmtHours(totalMs)+'</div></div>'
    +'<div class="metric-card mc-blue"><div class="mc-label">Total Late Time</div><div class="mc-val">'+(totalLateMins?fmtMinsShort(totalLateMins):'0m')+'</div></div>'
    +'<div class="metric-card mc-black"><div class="mc-label">Total Overtime</div><div class="mc-val">'+(totalOtMs?fmtHours(totalOtMs):'0h 0m')+'</div></div>'
  +'</div>';

  body.innerHTML=monthNav+summaryHtml
    +'<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow)">'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px">'
        +'<thead><tr>'
          +'<th style="text-align:left;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Date</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Time In</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Status</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Hours</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)">Overtime</th>'
          +'<th style="text-align:center;padding:9px 12px;background:#f8fafc;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text3)"></th>'
        +'</tr></thead>'
        +'<tbody>'+trows+'</tbody>'
      +'</table>'
    +'</div>'
    +'<div style="font-size:11px;color:var(--text3);margin-top:8px">Hours are auto-computed from your scheduled hours once you log in — no logout needed. Log overtime for any day you worked past your schedule.</div>';
}


async function todLogIn(username,date){
  // date is passed as ds(d) which is local date string - use ISO for timestamp
  await fbSet('todAttendance/'+username+'/'+date+'/timeIn',now().toISOString());
  toast('Logged in! ✓');
}

// ─── TOD Overtime ───
// Either the member themselves or an admin can log overtime for a specific date. Stored as a
// decimal hour count (plus the raw start/end typed in, kept for reference) and layered on top
// of the member's scheduled hours in computeDayRecord / computeBillingDayRecord.
function openOTModal(username,dds){
  const m=D.members.find(x=>x.username===username);if(!m)return;
  if(!(CU.isAdmin||CU.username===username)){toast('You can only log your own overtime.');return;}
  const existing=(D.todOvertime[username]||{})[dds]||{};
  document.getElementById('mto-title').textContent='Log Overtime — '+m.name;
  document.getElementById('mto-body').innerHTML=`
    <div class="fg"><label class="flabel">Date</label><input class="finput nb" id="mto-date" type="date" value="${dds}"/></div>
    <div class="fg fg2">
      <div><label class="flabel">Start Time</label><input class="finput nb" id="mto-start" type="time" value="${existing.start||''}" onchange="mtoRecalc()"/></div>
      <div><label class="flabel">End Time</label><input class="finput nb" id="mto-end" type="time" value="${existing.end||''}" onchange="mtoRecalc()"/></div>
    </div>
    <div class="fg"><label class="flabel">Hours <span style="font-weight:400;color:var(--text3);font-size:11px">(auto-filled from the time range — override if needed)</span></label><input class="finput nb" id="mto-hours" type="number" min="0" step="0.25" value="${existing.hours||''}"/></div>
    <div class="fg"><label class="flabel">Note (optional)</label><input class="finput nb" id="mto-note" placeholder="Reason for overtime" value="${escHtml(existing.note||'')}"/></div>
    <div class="form-actions">
      <button class="btn primary" onclick="saveOT('${username}')">Save</button>
      ${existing.hours?`<button class="btn del" onclick="deleteOT('${username}')">Remove</button>`:''}
      <button class="btn" onclick="closeModal('modal-tod-ot')">Cancel</button>
    </div>`;
  openModal('modal-tod-ot');
}
function mtoRecalc(){
  const s=document.getElementById('mto-start')?.value,e=document.getElementById('mto-end')?.value;
  if(!s||!e)return;
  const sd=schedDateTime('2000-01-01',s),ed=schedDateTime('2000-01-01',e);
  if(!sd||!ed)return;
  let diff=ed-sd;if(diff<=0)diff+=24*3600000;
  const hoursEl=document.getElementById('mto-hours');
  if(hoursEl)hoursEl.value=Math.round((diff/3600000)*100)/100;
}
async function saveOT(username){
  const dds=document.getElementById('mto-date')?.value;
  const start=document.getElementById('mto-start')?.value||'',end=document.getElementById('mto-end')?.value||'';
  const hoursRaw=document.getElementById('mto-hours')?.value;
  const hours=hoursRaw?parseFloat(hoursRaw):0;
  const note=document.getElementById('mto-note')?.value.trim()||'';
  if(!dds){toast('Date required');return;}
  if(!hours||hours<=0){toast('Enter a valid number of hours (or a start/end time)');return;}
  await fbSet('todOvertime/'+username+'/'+dds,{start,end,hours,note,recordedBy:CU.username,ts:now().getTime()});
  closeModal('modal-tod-ot');
  toast('Overtime logged ✓');
}
async function deleteOT(username){
  const dds=document.getElementById('mto-date')?.value;
  if(!dds)return;
  await fbSet('todOvertime/'+username+'/'+dds,null);
  closeModal('modal-tod-ot');
  toast('Overtime removed');
}

function exportTOD(){
  const dates=todWeekDates();
  const todMems=D.members.filter(m=>m.role==='Talent on Demand'&&m.approved);
  const rows=[];
  todMems.forEach(m=>{
    const row={Name:m.name};let totalH=0,totalLate=0,totalOt=0;
    dates.forEach(d=>{
      const dds=ds(d),dc=computeDayRecord(m,dds);
      row[DOW[d.getDay()]+' In']=dc.timeIn?dc.timeIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):'';
      row[DOW[d.getDay()]+' Late']=dc.lateMins>0?fmtMinsShort(dc.lateMins):'';
      row[DOW[d.getDay()]+' Hrs']=dc.hoursMs?fmtHours(dc.hoursMs):'';
      row[DOW[d.getDay()]+' OT']=dc.otMs?fmtHours(dc.otMs):'';
      totalH+=dc.hoursMs;if(dc.lateMins>0)totalLate+=dc.lateMins;totalOt+=dc.otMs;
    });
    row['Total Hrs']=fmtHours(totalH);row['Total Late']=totalLate?fmtMinsShort(totalLate):'';row['Total OT']=totalOt?fmtHours(totalOt):'';rows.push(row);
  });
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'TOD');
  XLSX.writeFile(wb,`TOD_Week_${ds(_todWeekStart)}.xlsx`);toast('Exported!');
}

// Monthly per-day billing detail for one member — mirrors the Service/Rate/Amount table in
// renderTODMonthlyBilling, meant to be placed alongside their submitted timesheet as the
// invoice/payroll backup. Admin-only (Rate/Amount are never exported for a TOD member's own
// view).
function exportTODMonth(username){
  const m=D.members.find(x=>x.username===username);if(!m)return;
  if(!CU.isAdmin){toast('Admin only.');return;}
  const weekdays=todMonthWeekdays(_todMonthDate);
  const rate=m.rate||0,service=m.service||'';
  const rows=[];
  let totalH=0,totalAmount=0,daysPresent=0,daysQualified=0,totalOt=0;
  weekdays.forEach(d=>{
    const dds=ds(d),bc=computeBillingDayRecord(m,dds);
    if(!bc.attended)return;
    daysPresent++;
    if(bc.qualified){
      daysQualified++;
      const hrs=hoursDecimal(bc.hoursMs),otHrs=hoursDecimal(bc.otMs),amt=Math.round((hrs+otHrs)*rate*100)/100;
      totalH+=hrs;totalAmount+=amt;totalOt+=otHrs;
      rows.push({
        Service:service,
        Date:d.toLocaleDateString('en-PH',{month:'long',day:'2-digit',year:'numeric'}),
        'Time In':bc.timeIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),
        'Duration (# of hours)':hrs,
        'Overtime (hours)':bc.otMs?hoursDecimal(bc.otMs):'',
        'Total Hours':hrs+otHrs,
        Rate:rate,
        Amount:amt
      });
    } else {
      rows.push({
        Service:'Not Qualified',
        Date:d.toLocaleDateString('en-PH',{month:'long',day:'2-digit',year:'numeric'}),
        'Time In':bc.timeIn?bc.timeIn.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}):'',
        'Duration (# of hours)':0,
        'Overtime (hours)':'',
        'Total Hours':0,
        Rate:rate,
        Amount:0
      });
    }
  });
  rows.push({Service:'',Date:'',
    'Time In':'',
    'Duration (# of hours)':totalH,
    'Overtime (hours)':totalOt,
    'Total Hours':totalH+totalOt,
    Rate:'',
    Amount:'PHP '+totalAmount.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
  });
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'TOD Monthly');
  XLSX.writeFile(wb,`TOD_${m.name.replace(/\s+/g,'_')}_${fmtM(_todMonthDate).replace(/\s+/g,'_')}.xlsx`);
  toast('Exported!');
}

// Admin-only: one row per TOD member for the currently viewed month — the quick cross-check
// summary against everyone's submitted timesheets.
function exportTODMonthSummary(){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const todMems=D.members.filter(m=>m.role==='Talent on Demand'&&m.approved);
  const weekdays=todMonthWeekdays(_todMonthDate);
  const rows=todMems.map(m=>{
    const rate=m.rate||0;
    let totalH=0,totalAmount=0,daysPresent=0,daysQualified=0,totalOt=0;
    weekdays.forEach(d=>{
      const dds=ds(d),bc=computeBillingDayRecord(m,dds);
      if(bc.attended){
        daysPresent++;
        if(bc.qualified){daysQualified++;const hrs=hoursDecimal(bc.hoursMs),otHrs=hoursDecimal(bc.otMs);totalH+=hrs;totalOt+=otHrs;totalAmount+=Math.round((hrs+otHrs)*rate*100)/100;}
      }
    });
    return{
      Name:m.name,
      Service:m.service||'',
      'Scheduled Hours':(m.schedStart&&m.schedEnd)?(m.schedStart+' – '+m.schedEnd+(m.breakMins?' (−'+m.breakMins+'m break)':'')):'Not set',
      'Days Logged':daysPresent+'/'+weekdays.length,
      'Days Qualified':daysQualified,
      'Total Hours':totalH,
      'Total Overtime':totalOt,
      'Grand Total':totalH+totalOt,
      Rate:rate,
      'Total Amount':'PHP '+totalAmount.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})
    };
  });
  const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'TOD Monthly Summary');
  XLSX.writeFile(wb,`TOD_Monthly_Summary_${fmtM(_todMonthDate).replace(/\s+/g,'_')}.xlsx`);
  toast('Exported!');
}

// ─── LIVE TRACKERS ───
const LT_CATS=['AO Tracker','Finance','Inventory','Marketing','Operations','Other'];
const LT_ICONS={'AO Tracker':'\u{1F4CA}','Finance':'\u{1F4B0}','Inventory':'\u{1F4E6}','Marketing':'\u{1F4E3}','Operations':'\u2699\uFE0F','Other':'\u{1F4CB}'};

function renderLiveTrackers(){
  var el=document.getElementById('pg-live-trackers');
  if(!el)return;

  // ── FIX 3: Save scroll position before re-render so inputs don't jump ──
  var prevScrollTop=0,prevScrollLeft=0;
  var oldScroll=document.getElementById('ao-table-scroll');
  if(oldScroll){prevScrollTop=oldScroll.scrollTop;prevScrollLeft=oldScroll.scrollLeft;}
  // Also save FR table scroll if active
  var _frPrevLeft=0,_frPrevTop=0,_frPrevId=null;
  if(_activeTracker&&_activeTrackerSheet){_frPrevId='fr-tbl-'+_activeTracker+'-'+_activeTrackerSheet;var _frOld=document.getElementById(_frPrevId);if(_frOld){_frPrevLeft=_frOld.scrollLeft;_frPrevTop=_frOld.scrollTop;}}
  if(!canSeeLiveTrackers()){el.innerHTML='<div class="empty-state" style="padding:60px"><div style="font-size:32px;margin-bottom:12px">🔒</div><div style="font-weight:700;font-size:16px;color:var(--text2)">Access Restricted</div><div style="font-size:13px;color:var(--text3);margin-top:6px">Live Trackers are not available for TOD members. Ask your admin to grant access.</div></div>';return;}
  var trackers=Object.entries(D.trackers||{}).map(function(e){return Object.assign({},e[1],{_key:e[0]});});
  var qEl=document.getElementById('lt-search-val');
  var q=qEl?qEl.value.toLowerCase():'';
  var filtered=trackers.filter(function(t){return t.name&&t.name.toLowerCase().includes(q);});
  var byCat={};
  filtered.forEach(function(t){var c=t.category||'Other';if(!byCat[c])byCat[c]=[];byCat[c].push(t);});

  // Build sidebar (now rendered as a horizontal strip across the top)
  var sideHtml='';
  LT_CATS.forEach(function(c){
    if(!byCat[c])return;
    sideHtml+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);padding:6px 4px 4px;flex-shrink:0;white-space:nowrap">'+c+'</div>';
    byCat[c].forEach(function(t){
      var isActive=_activeTracker===t._key;
      var bg=isActive?'var(--blue-light)':'transparent';
      var bd=isActive?'var(--blue)':'var(--border)';
      var fw=isActive?'600':'500';
      var fc=isActive?'var(--blue)':'var(--text2)';
      var sheetCount=Object.keys(t.sheets||{}).length;
      var dateStr=t.uploadedAt?new Date(t.uploadedAt).toLocaleDateString('en-PH',{month:'short',day:'numeric'}):'—';
      var icon=LT_ICONS[t.category]||'📋';
      var linked=t.aoLinked?'<span style="font-size:9px;background:var(--orange-light);color:var(--orange);padding:1px 5px;border-radius:20px;font-weight:700">📎 Dashboard</span>':t.frLinked?'<span style="font-size:9px;background:var(--blue-light);color:var(--blue);padding:1px 5px;border-radius:20px;font-weight:700">💰 Finance Tasks</span>':'';
      sideHtml+='<div class="lt-tracker-item'+(isActive?' active':'')+'" data-trackerid="'+t._key+'" style="background:'+bg+';border:1px solid '+bd+';border-radius:var(--radius-lg);flex-shrink:0;min-width:180px">'
        +'<div style="width:28px;height:28px;border-radius:var(--radius);background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">'+icon+'</div>'
        +'<div style="flex:1;min-width:0">'
          +'<div style="font-size:12px;font-weight:'+fw+';color:'+fc+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+t.name+'</div>'
          +'<div style="font-size:10px;color:var(--text4);white-space:nowrap">'+sheetCount+' sheet(s) · '+dateStr+'</div>'
          +linked
        +'</div>'
      +'</div>';
    });
  });
  if(!trackers.length){
    sideHtml='<div style="padding:14px;text-align:center;color:var(--text4);font-size:12px;flex:1">No trackers yet. Upload your first Excel file.</div>';
  }

  // Build toolbar
  var toolbarHtml='';
  var activeT=_activeTracker&&D.trackers[_activeTracker]?D.trackers[_activeTracker]:null;
  var ltCanManage=CU.isAdmin; // Only admin can upload/manage trackers
  var ltCanEdit=CU.isAdmin||isLead(); // Leads can still export/view
  if(activeT){
    var linkedBtn='';
    if(ltCanManage){
      if(activeT.aoLinked){
        linkedBtn='<span style="font-size:11px;background:var(--orange-light);color:var(--orange);padding:3px 10px;border-radius:20px;font-weight:700">📎 AO Dashboard Linked</span>';
      } else if(activeT.frLinked){
        linkedBtn='<span style="font-size:11px;background:var(--blue-light);color:var(--blue);padding:3px 10px;border-radius:20px;font-weight:700">💰 Finance Tasks Linked</span>'
          +' <button class="btn sm" data-action="fr-relink" data-key="'+_activeTracker+'" style="font-size:11px">Re-link Tasks</button>';
      } else if(activeT.category==='AO Tracker'){
        linkedBtn='<button class="btn sm warning" data-action="link-dash" data-key="'+_activeTracker+'">📎 Link to Dashboard</button>';
      } else if(activeT.category==='Finance'){
        linkedBtn='<button class="btn sm primary" data-action="fr-link" data-key="'+_activeTracker+'">💰 Link to Finance Tasks</button>';
      }
    }
    toolbarHtml='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">'
      +'<div style="font-size:15px;font-weight:700;flex:1">'+activeT.name+'</div>'
      +linkedBtn
      +(ltCanManage&&activeT.category==='Finance'?'<button class="btn sm primary" data-action="fr-add-brand" data-key="'+_activeTracker+'">+ Add Brand</button>':'')
      +(ltCanManage&&activeT.category==='Finance'?'<button class="btn sm warning" data-action="fr-manage-dates" data-key="'+_activeTracker+'">🗑 Manage Columns</button>':'')
      +(ltCanEdit?'<button class="btn sm" data-action="export" data-key="'+_activeTracker+'">Export Excel</button>':'')
      
      +(ltCanManage?'<button class="btn sm del" data-action="delete" data-key="'+_activeTracker+'">Delete</button>':'')
      +'</div>';
  }

  // Build content area
  var contentHtml=activeT
    ?buildTrackerContent(_activeTracker)
    :'<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;text-align:center;padding:40px">'
      +'<div style="font-size:40px;margin-bottom:14px">📊</div>'
      +'<div style="font-weight:700;font-size:16px;margin-bottom:6px">Select a tracker from the sidebar</div>'
      +'<div style="color:var(--text3);font-size:13px;margin-bottom:20px">'+(ltCanManage?'Or upload a new Excel file to get started.':'Select a tracker to view and fill in your data.')+'</div>'
      +(ltCanManage?'<button class="btn primary" onclick="openAddTracker()">Upload Tracker</button>':'')
      +'</div>';

  el.innerHTML=''
    +'<div class="page-header" style="margin-bottom:12px;padding-bottom:12px">'
      +'<div><div class="page-title">Live Trackers</div><div class="page-subtitle">Real-time AO and compliance tracker sheets</div></div>'
      +(ltCanManage?'<button class="btn primary" onclick="openAddTracker()">+ Upload Tracker</button>':'<span style="font-size:12px;color:var(--text3);padding:6px 10px;background:var(--blue-light);border-radius:var(--radius)">View &amp; edit your rows only</span>')
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:8px">'
      +'<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);overflow:hidden">'
        +'<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);background:#f8fafc;flex-wrap:wrap">'
          +'<div style="font-size:13px;font-weight:700;white-space:nowrap">'+(CU.isAdmin?'My Trackers':'Trackers')+' ('+trackers.length+')</div>'
          +'<input id="lt-search-val" placeholder="Search trackers..." oninput="renderLiveTrackers()" style="flex:1;min-width:160px;max-width:280px;padding:5px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;background:var(--surface)" value="'+q+'">'
        +'</div>'
        +'<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;overflow-x:auto">'+sideHtml+'</div>'
      +'</div>'
      +'<div style="display:flex;flex-direction:column;min-width:0">'
        +toolbarHtml
        +'<div style="overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);max-width:100%">'+contentHtml+'</div>'
      +'</div>'
    +'</div>';

  // ── FIX 3 (continued): Restore scroll position after re-render ──
  if(prevScrollTop||prevScrollLeft){
    var newScroll=document.getElementById('ao-table-scroll');
    if(newScroll){newScroll.scrollTop=prevScrollTop;newScroll.scrollLeft=prevScrollLeft;}
  }
  // Restore FR table scroll position
  if(_frPrevId&&(_frPrevLeft||_frPrevTop)){
    setTimeout(function(){var w=document.getElementById(_frPrevId);if(w){w.scrollLeft=_frPrevLeft;w.scrollTop=_frPrevTop;}},30);
  }
  // Init inline tab drag for Finance trackers
  if(activeT&&activeT.category==='Finance'&&CU.isAdmin){
    setTimeout(function(){initFRTabDrag(_activeTracker);},60);
  }
}


function ltSelect(key){_activeTracker=key;const t=D.trackers[key];_activeTrackerSheet=t?.sheets?Object.keys(t.sheets)[0]:null;renderLiveTrackers();}

function buildTrackerContent(key){
  const t=D.trackers[key];if(!t)return'';
  const sheets=t.sheets||{};
  const allNames=Object.keys(sheets);
  // Respect saved tab order if present
  const savedOrder=t.tabOrder&&Array.isArray(t.tabOrder)?t.tabOrder:[];
  let names=savedOrder.length
    ?[...savedOrder.filter(n=>sheets[n]),...allNames.filter(n=>!savedOrder.includes(n))]
    :allNames.slice();
  // Finance AND AO trackers always show the "Exited" tab, even before any brand has exited,
  // so users always know where exited/inactive brands are listed. It is pinned last.
  if(t.category==='Finance'||t.category==='AO Tracker'){
    names=names.filter(n=>n!=='Exited');
    names.push('Exited');
  }
  if(!names.length)return'<div class="empty-state" style="padding:40px">No sheets in this tracker.</div>';
  // "Exited" is a valid tab for Finance/AO trackers even when its backing sheet does not exist yet.
  const _exitedVirtual=(t.category==='Finance'||t.category==='AO Tracker')&&_activeTrackerSheet==='Exited';
  if(!_activeTrackerSheet||(!sheets[_activeTrackerSheet]&&!_exitedVirtual))_activeTrackerSheet=names[0];
  const sh=sheets[_activeTrackerSheet];
  const isFin=t.category==='Finance';
  const isAdm=CU.isAdmin;
  let tabsHtml='';
  if(isFin&&isAdm){
    // Draggable tabs for Finance tracker (admin only)
    names.forEach(function(n){
      const active=n===_activeTrackerSheet;
      const isExitedN=n==='Exited';
      const fw=active?'700':'500';
      const fc=active?(isExitedN?'var(--red)':'var(--blue)'):(isExitedN?'#e57373':'var(--text3)');
      const bb=active?(isExitedN?'var(--red)':'var(--blue)'):'transparent';
      const nEsc=escHtml(n).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const kEsc=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      tabsHtml+='<div class="lt-sheet-tab fr-drag-tab" data-key="'+escHtml(key)+'" data-sheet="'+escHtml(n)+'" draggable="true"'
        +' style="padding:6px 12px;font-size:11px;font-weight:'+fw+';color:'+fc+';border-bottom:2px solid '+bb+';cursor:pointer;white-space:nowrap;transition:all .15s;user-select:none;display:flex;align-items:center;gap:5px">'
        +'<span style="font-size:10px;color:var(--text4);line-height:1;pointer-events:none">⠿</span>'
        +(isExitedN?'⛔ ':'')
        +escHtml(n)
        +'</div>';
    });
    const kEscBtn=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    tabsHtml='<div id="fr-tab-bar-'+key+'" style="border-bottom:1px solid var(--border);display:flex;overflow-x:auto;background:#fafafa;align-items:stretch" title="Hold and drag tabs to reorder">'+tabsHtml
      +'<button onclick="frOpenAddTab(\''+kEscBtn+'\')" title="Add a new platform tab (e.g. Lazada, Shopee, TikTok)" style="padding:5px 12px;margin:4px 6px;font-size:11px;font-weight:700;color:var(--blue);background:var(--blue-light);border:1px solid var(--blue-mid);border-radius:20px;cursor:pointer;white-space:nowrap;align-self:center;font-family:inherit">+ Add Tab</button>'
      +'<span style="font-size:10px;color:var(--text4);padding:6px 10px;align-self:center;white-space:nowrap;margin-left:auto">⠿ drag to reorder</span>'
      +'</div>';
  } else {
    names.forEach(function(n){
      const active=n===_activeTrackerSheet;
      const isExitedN=n==='Exited';
      const fw=active?'700':'500';
      const fc=active?(isExitedN?'var(--red)':'var(--blue)'):(isExitedN?'#e57373':'var(--text3)');
      const bb=active?(isExitedN?'var(--red)':'var(--blue)'):'transparent';
      const nEsc2=escHtml(n).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const kEsc2=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      tabsHtml+='<div class="lt-sheet-tab" data-key="'+key+'" data-sheet="'+n+'" onclick="ltSetSheet(\''+kEsc2+'\',\''+nEsc2+'\')" style="padding:6px 14px;font-size:11px;font-weight:'+fw+';color:'+fc+';border-bottom:2px solid '+bb+';cursor:pointer;white-space:nowrap;transition:all .15s">'+(isExitedN?'⛔ ':'')+escHtml(n)+'</div>';
    });
    tabsHtml='<div style="border-bottom:1px solid var(--border);display:flex;overflow-x:auto;background:#fafafa">'+tabsHtml+'</div>';
  }
  // AO tracker week bar: current week is always the live, editable one. A "◀ Prev week"
  // control lets anyone step back through past weeks (per region/sheet) as a read-only
  // reference view; "Next week ▶" steps back toward — and stops at — the current week.
  var weekNavHtml='';
  if(t.category==='AO Tracker'&&_activeTrackerSheet!=='Exited'){
    var _woKey=aoWeekOffsetKey(key,_activeTrackerSheet);
    var _wo=_aoWeekOffset[_woKey]||0;
    var mon2=new Date();
    mon2.setDate(mon2.getDate()-(mon2.getDay()===0?6:mon2.getDay()-1)+_wo*7);
    var fri2=new Date(mon2);fri2.setDate(mon2.getDate()+4);
    var wkLabel=mon2.toLocaleDateString('en-PH',{month:'short',day:'numeric'})+' – '+fri2.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
    var kEscWk=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var sEscWk=String(_activeTrackerSheet).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var isCurWk=_wo===0;
    weekNavHtml='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:'+(isCurWk?'#fff':'#fffbeb')+'">'
      +'<button onclick="aoNavWeek(\''+kEscWk+'\',\''+sEscWk+'\',-1)" title="View previous week (read-only, for reference)" style="display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;background:#fff;color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">◀ Prev week</button>'
      +'<span style="font-size:12px;font-weight:600;color:'+(isCurWk?'var(--text2)':'#92400e')+'">Week of '+wkLabel+(isCurWk?' (current)':' — reference only')+'</span>'
      +(isCurWk?'':'<button onclick="aoNavWeek(\''+kEscWk+'\',\''+sEscWk+'\',1)" title="Step forward one week" style="display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;background:#fff;color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Next week ▶</button>')
      +(isCurWk?'':'<button onclick="aoNavWeek(\''+kEscWk+'\',\''+sEscWk+'\','+(-_wo)+')" title="Jump back to the current week" style="padding:4px 10px;border:1px solid var(--blue-mid);border-radius:20px;background:var(--blue-light);color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Today ⟳</button>')
      +(isCurWk?'':'<span style="font-size:10px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:2px 8px;border-radius:20px">📌 Past week — view only, for reference</span>')
    +'</div>';
  }
  const isExitedTab=t.category==='Finance'&&_activeTrackerSheet==='Exited';
  // ── FR Week Offset banner (admin only, Finance tracker, non-Exited sheet) ──
  let frWeekBannerHtml='';
  if(t.category==='Finance'&&CU.isAdmin&&!isExitedTab&&_activeTrackerSheet&&_activeTrackerSheet!=='Exited'){
    const plat=_activeTrackerSheet;
    const offset=FR_WEEK_OFFSET[plat]||0;
    // Derive the reporting week from the ACTUAL active column the table highlights,
    // not from an offset-shifted "effective date". This guarantees the CW shown here
    // always matches the yellow-highlighted column (previously Lazada's -1 offset made
    // the banner read CW26 while the highlighted column was CW27).
    const _activeCi=frActiveColIdx(sh,plat);
    let cwNum,effLabel;
    if(_activeCi!==-1){
      const _hr=sh.headerRows||(sh.row0?[sh.row0,sh.row1].filter(r=>r&&r.length):[[]]);
      const _top=(_hr[0]||[])[_activeCi]!=null?String((_hr[0]||[])[_activeCi]).trim():'';
      const _subs=[];for(let ri=1;ri<_hr.length;ri++){const _r=_hr[ri]||[];_subs.push(_r[_activeCi]!=null?String(_r[_activeCi]).trim():'');}
      const _info=frParseHeaderInfo(plat,_top,_subs);
      // Derive the reporting week from the START of the active column's coverage period
      // (the earliest date in the header, e.g. Lazada "29 Jun" for the 29 Jun–05 Jul week),
      // so the CW label matches the week actually being worked rather than the deadline.
      const _allTxt=[_top,..._subs].join(' ');
      const _M={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      let _earliest=null,_mm;
      const _reRange=/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
      while((_mm=_reRange.exec(_allTxt))){
        const _mi=_M[_mm[2].toLowerCase().slice(0,3)];
        if(_mi===undefined)continue;
        let _d=new Date(now().getFullYear(),_mi,parseInt(_mm[1]));
        if(_d-now()>183*86400000)_d=new Date(now().getFullYear()-1,_mi,parseInt(_mm[1]));
        if(!_earliest||_d<_earliest)_earliest=_d;
      }
      const _ref=_earliest||(_info&&_info.dueDate?_info.dueDate:frEffectiveDate(plat));
      cwNum=getWeekNumber(_ref.toISOString().slice(0,10));
      effLabel=(_info&&_info.shortLabel)?_info.shortLabel:_ref.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    } else {
      const effDate=frEffectiveDate(plat);
      cwNum=getWeekNumber(effDate.toISOString().slice(0,10));
      effLabel=effDate.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    }
    const offsetLabel=offset===0?'Current week (no offset)':offset===-1?'1 week behind (showing previous week)':offset<0?Math.abs(offset)+' weeks behind':'Ahead by '+offset+' week(s)';
    frWeekBannerHtml='<div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid var(--border);background:#f0f6ff;flex-wrap:wrap">'
      +'<span style="font-size:11px;font-weight:700;color:var(--blue)">📅 Reporting Week:</span>'
      +'<span style="font-size:13px;font-weight:800;color:var(--blue);background:var(--blue-light);padding:2px 10px;border-radius:20px;border:1px solid var(--blue-mid)">CW'+cwNum+'</span>'
      +'<span style="font-size:11px;color:var(--text2)">Active column = <b>'+plat+'</b> — coverage <b>'+effLabel+'</b></span>'
      +'<span style="font-size:10px;color:var(--text3);padding:2px 8px;border-radius:20px;background:#dbeafe">'+offsetLabel+'</span>'
      +'<div style="margin-left:auto;display:flex;align-items:center;gap:6px">'
        +'<span style="font-size:11px;color:var(--text3)">Week offset (admin):</span>'
        +'<select onchange="saveFRWeekOffset(\''+plat+'\',this.value)" style="padding:3px 7px;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;font-family:inherit;background:#fff">'
          +'<option value="0"'+(offset===0?' selected':'')+'>0 — Current week</option>'
          +'<option value="-1"'+(offset===-1?' selected':'')+'">-1 — 1 week behind</option>'
          +'<option value="-2"'+(offset===-2?' selected':'')+'>-2 — 2 weeks behind</option>'
          +'<option value="1"'+(offset===1?' selected':'')+'>+1 — Next week</option>'
        +'</select>'
      +'</div>'
    +'</div>';
  }
  const isAOExitedTab=t.category==='AO Tracker'&&_activeTrackerSheet==='Exited';
  // ── FR Browse-back nav (all users, Finance tracker, non-Exited sheet) ──
  // Lets anyone step further back than the default "last week" column to review older weeks —
  // those extra columns render fully read-only (even for admins), same reference-view pattern
  // as the AO tracker's "◀ Prev week". The always-visible default window (last week + current +
  // next 3) is untouched, including admins' ability to correct last week's numbers.
  let frBrowseNavHtml='';
  if(t.category==='Finance'&&!isExitedTab&&_activeTrackerSheet&&_activeTrackerSheet!=='Exited'){
    const _frExtra=_frWeekBrowseBack[frBrowseKey(key,_activeTrackerSheet)]||0;
    const kEscFr=String(key).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const sEscFr=String(_activeTrackerSheet).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const isDefaultWin=_frExtra===0;
    frBrowseNavHtml='<div style="display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid var(--border);background:'+(isDefaultWin?'#fff':'#fffbeb')+';flex-wrap:wrap">'
      +'<button onclick="frNavWeek(\''+kEscFr+'\',\''+sEscFr+'\',1)" title="Reveal one more week further back (read-only, for reference)" style="display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;background:#fff;color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">◀ Prev week</button>'
      +'<span style="font-size:12px;font-weight:600;color:'+(isDefaultWin?'var(--text2)':'#92400e')+'">'
        +(isDefaultWin?'Showing last week + current + next 3 weeks':'Showing '+(1+_frExtra)+' past week'+(_frExtra>0?'s':'')+' back for reference')
      +'</span>'
      +(isDefaultWin?'':'<button onclick="frNavWeek(\''+kEscFr+'\',\''+sEscFr+'\',-1)" title="Hide the oldest revealed week" style="display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:20px;background:#fff;color:var(--text2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Next week ▶</button>')
      +(isDefaultWin?'':'<button onclick="frNavWeek(\''+kEscFr+'\',\''+sEscFr+'\','+(-_frExtra)+')" title="Collapse back to the default window" style="padding:4px 10px;border:1px solid var(--blue-mid);border-radius:20px;background:var(--blue-light);color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">Today ⟳</button>')
      +(isDefaultWin?'':'<span style="font-size:10px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:2px 8px;border-radius:20px">📌 Older weeks shown — view only, for reference</span>')
    +'</div>';
  }
  return tabsHtml+weekNavHtml+frBrowseNavHtml+frWeekBannerHtml+(t.category==='Finance'?(isExitedTab?buildExitedTable(key,_activeTrackerSheet,sh):buildFRTable(key,_activeTrackerSheet,sh)):(isAOExitedTab?buildAOExitedTable(key):buildAOTable(key,_activeTrackerSheet,sh)));
}

function ltSetSheet(key,sheet){_activeTrackerSheet=sheet;renderLiveTrackers();}

// ── AO Table filter state (per-session, per-user) ──
let _aoFilter={brand:'',platform:'',cdm:'',tl:''};
// Per-tracker/sheet (i.e. per-region) week-view offset for the Abnormal Orders table.
// 0 = current week (live, editable as normal). Negative = that many weeks back, shown as a
// read-only reference view via the "◀ Prev week" control next to the AO tabs. Purely local UI
// state (not persisted to Firebase) — always resets to the live current week on reload.
let _aoWeekOffset={};
function aoWeekOffsetKey(trackerKey,sheetKey){return trackerKey+'||'+sheetKey;}
function aoNavWeek(trackerKey,sheetKey,delta){
  const k=aoWeekOffsetKey(trackerKey,sheetKey);
  const next=(_aoWeekOffset[k]||0)+delta;
  if(next>0)return; // never navigate into the future — current week is the newest
  _aoWeekOffset[k]=next;
  renderLiveTrackers();
}

// ── FR Table filter state (per-session, per-user) ──
let _frFilter={region:'',brand:'',exec:'',tl:''};
// Extra past weeks (beyond the normal 1-week-back window) that the "◀ Prev week" control
// reveals for a given Finance tracker/platform, purely as a read-only reference view — mirrors
// the AO tracker's browse-back feature. 0 = default window (last week + current + next 3).
// Local UI state only (not persisted to Firebase); resets to the default window on reload.
let _frWeekBrowseBack={};
function frBrowseKey(trackerKey,sheetKey){return trackerKey+'||'+sheetKey;}
// delta is added directly to the extra-past-weeks count: +1 (Prev week) reveals one more older
// week, -1 (Next week) hides the most recently revealed one; passing -currentExtra (Today ⟳)
// collapses back to the default window. Never goes below 0 (the default window).
function frNavWeek(trackerKey,sheetKey,delta){
  const k=frBrowseKey(trackerKey,sheetKey);
  const next=(_frWeekBrowseBack[k]||0)+delta;
  if(next<0)return;
  _frWeekBrowseBack[k]=next;
  renderLiveTrackers();
}

function frSetFilter(field,val){_frFilter[field]=val;renderLiveTrackers();}

// ── AO Row Selection ──
function aoToggleRowSel(trackerKey,sheetKey,ri){
  const t=D.trackers[trackerKey];const sheet=(t&&t.sheets||{})[sheetKey];
  const row=sheet&&sheet.rows?sheet.rows[ri]:null;
  if(!CU.isAdmin&&!aoIsRowOwner(row)){toast('This brand is assigned to another member — you can only select your own brands.');return;}
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  if(!window[k])window[k]=new Set();
  const s=window[k];
  if(s.has(ri))s.delete(ri);else s.add(ri);
  renderLiveTrackers();
}
function aoSelectAll(trackerKey,sheetKey,cb){
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  if(!window[k])window[k]=new Set();
  const s=window[k];
  s.clear();
  if(cb.checked){
    const t=D.trackers[trackerKey];const sheet=(t&&t.sheets||{})[sheetKey];
    if(sheet&&sheet.rows){
      sheet.rows.forEach(function(r,ri){
        if(!r||String(r[3]||'').toUpperCase()==='TOTAL')return;
        // Non-admins can only bulk-select brands assigned to them, so "select all" can never
        // sweep up someone else's rows.
        if(!CU.isAdmin&&!aoIsRowOwner(r))return;
        s.add(ri);
      });
    }
  }
  renderLiveTrackers();
}
function aoClearSelection(trackerKey,sheetKey){
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  if(window[k])window[k].clear();
  renderLiveTrackers();
}
async function aoDeleteSelectedRows(trackerKey,sheetKey){
  if(!CU.isAdmin){toast('Only admin can delete brands.');return;}
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  const sel=window[k];
  if(!sel||!sel.size){toast('No brands selected.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet||!sheet.rows)return;
  const rows=sheet.rows;
  const namesPreview=Array.from(sel).slice(0,5).map(function(ri){const r=rows[ri];return r&&r[3]?String(r[3]):'(row '+ri+')';}).join(', ');
  const more=sel.size>5?' and '+(sel.size-5)+' more':'';
  if(!confirm('Delete '+sel.size+' brand'+(sel.size>1?'s':'')+' from this sheet?\n\n'+namesPreview+more+'\n\nThis cannot be undone.'))return;
  // Build the new rows array with selected indices removed, preserving order of the rest.
  const newRows=rows.filter(function(r,ri){return !sel.has(ri);});
  // Rebuild timestamps, remapping old row indices -> new row indices (rows that survive keep their cell timestamps).
  const oldTimestamps=sheet.timestamps||{};
  const oldToNew={};
  let newIdx=0;
  rows.forEach(function(r,ri){
    if(sel.has(ri))return;
    oldToNew[ri]=newIdx;
    newIdx++;
  });
  const newTimestamps={};
  Object.keys(oldTimestamps).forEach(function(tk){
    const parts=tk.split('_');
    const oldRi=parseInt(parts[0],10);
    if(oldToNew[oldRi]===undefined)return; // belonged to a deleted row
    newTimestamps[oldToNew[oldRi]+'_'+parts[1]]=oldTimestamps[tk];
  });
  // Remap AO status/exit-date meta (keyed by row index) the same way, so a surviving exited
  // brand keeps its status and a deleted row's meta is dropped.
  const oldMeta=sheet.aoMeta||{};
  const newMeta={};
  Object.keys(oldMeta).forEach(function(mk){
    const oldRi=parseInt(mk,10);
    if(oldToNew[oldRi]===undefined)return;
    newMeta[oldToNew[oldRi]]=oldMeta[mk];
  });
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  D.trackers[trackerKey].sheets[sheetKey].rows=newRows;
  D.trackers[trackerKey].sheets[sheetKey].timestamps=newTimestamps;
  D.trackers[trackerKey].sheets[sheetKey].aoMeta=newMeta;
  await fbUpd(path,{rows:newRows,timestamps:newTimestamps,aoMeta:newMeta});
  const delCount=sel.size;
  sel.clear();
  toast('Deleted '+delCount+' brand'+(delCount>1?'s':'')+' from tracker.');
  renderLiveTrackers();
}
async function aoSetSelectedToZero(trackerKey,sheetKey){
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  const sel=window[k];
  if(!sel||!sel.size){toast('No brands selected.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet||!sheet.rows)return;
  const rows=sheet.rows;
  const nowT=now(),todayStr=ds(nowT);
  const dowToday=nowT.getDay();
  if(dowToday===0||dowToday===6){toast('No editable column today (weekend).');return;}
  // Use the shared helper (same week-block-aware formula as everywhere else) instead of a
  // separate copy of this logic, so the two can never drift out of sync again.
  let editableCols=aoFindTodayCols(sheet);
  if(!editableCols.length){toast('No editable column found for today.');return;}
  // Ownership guard: same rule as single-cell edits (ltUpdateCell) — a non-admin may only
  // zero brands where they're the CDM or Team Lead. Previously this bulk action skipped that
  // check entirely, so selecting "all" and clicking this button would silently zero out other
  // members' brands too (with the clicker's name/timestamp landing on cells they don't own).
  const ownedIds=[],blockedIds=[];
  sel.forEach(function(ri){
    const row=rows[ri];if(!row)return;
    if(aoIsRowOwner(row))ownedIds.push(ri);else blockedIds.push(ri);
  });
  if(!ownedIds.length){toast('Blocked: none of the selected brands are assigned to you.');return;}
  const ts=ltStamp();
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const updates={};
  if(!D.trackers[trackerKey].sheets[sheetKey].timestamps)D.trackers[trackerKey].sheets[sheetKey].timestamps={};
  ownedIds.forEach(function(ri){
    const row=rows[ri];if(!row)return;
    editableCols.forEach(function(c){
      if(!D.trackers[trackerKey].sheets[sheetKey].rows)D.trackers[trackerKey].sheets[sheetKey].rows=[];
      if(!D.trackers[trackerKey].sheets[sheetKey].rows[ri])D.trackers[trackerKey].sheets[sheetKey].rows[ri]=[];
      D.trackers[trackerKey].sheets[sheetKey].rows[ri][c]=0;
      D.trackers[trackerKey].sheets[sheetKey].timestamps[ri+'_'+c]=ts;
      updates['rows/'+ri+'/'+c]=0;
      updates['timestamps/'+ri+'_'+c]=ts;
    });
  });
  await fbUpd(path,updates);
  const resetCount=ownedIds.length;
  sel.clear();
  toast('Set '+resetCount+' brand'+(resetCount>1?'s':'')+" to 0 for today only."
    +(blockedIds.length?' ('+blockedIds.length+' skipped — not assigned to you.)':''));
  renderLiveTrackers();
}

// Finds today's [orderCol, productCol] pair for a sheet — shared by the zero/clear actions.
function aoFindTodayCols(sheet){
  const nowT=now(),todayStr=ds(nowT);
  const dowToday=nowT.getDay();
  if(dowToday===0||dowToday===6)return[];
  const row0=sheet.row0||[];
  const maxCol=row0.length;
  for(let ci=4;ci<maxCol;ci+=2){
    const h0=row0[ci]!=null?String(row0[ci]):'';
    const dp=h0.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(dp){
      const colDateStr=dp[3]+'-'+dp[1].padStart(2,'0')+'-'+dp[2].padStart(2,'0');
      if(colDateStr===todayStr)return[ci,ci+1];
    }
  }
  const vBase=Math.max(maxCol,4);
  const dowToWi={1:0,2:1,3:2,4:3,5:4};
  const wi=dowToWi[dowToday];
  if(wi===undefined)return[];
  const vci=vBase+aoWeekBlock(todayStr)*10+wi*2;
  return[vci,vci+1];
}
// Admin: blank out (not zero) today's Order/Product cells for selected brands — useful for
// testing whether the "filled" state correctly reverts to truly empty.
async function aoClearSelectedToday(trackerKey,sheetKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const k='_aoSel_'+trackerKey+'_'+sheetKey;
  const sel=window[k];
  if(!sel||!sel.size){toast('No brands selected.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet||!sheet.rows)return;
  const rows=sheet.rows;
  const editableCols=aoFindTodayCols(sheet);
  if(!editableCols.length){toast('No editable column found for today.');return;}
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const updates={};
  if(!D.trackers[trackerKey].sheets[sheetKey].timestamps)D.trackers[trackerKey].sheets[sheetKey].timestamps={};
  sel.forEach(function(ri){
    const row=rows[ri];if(!row)return;
    editableCols.forEach(function(c){
      if(!D.trackers[trackerKey].sheets[sheetKey].rows)D.trackers[trackerKey].sheets[sheetKey].rows=[];
      if(!D.trackers[trackerKey].sheets[sheetKey].rows[ri])D.trackers[trackerKey].sheets[sheetKey].rows[ri]=[];
      D.trackers[trackerKey].sheets[sheetKey].rows[ri][c]='';
      delete D.trackers[trackerKey].sheets[sheetKey].timestamps[ri+'_'+c];
      updates['rows/'+ri+'/'+c]='';
      updates['timestamps/'+ri+'_'+c]=null; // null deletes the key in Firebase
    });
  });
  await fbUpd(path,updates);
  const clearCount=sel.size;
  sel.clear();
  toast('Cleared '+clearCount+' brand'+(clearCount>1?'s':'')+" to blank for today.");
  renderLiveTrackers();
}



// ── Admin: add a new brand row to a live AO tracker sheet ──
function ltOpenAddRow(trackerKey,sheetKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  let memOpts='<option value="">— Unassigned —</option>';
  (D.members||[]).filter(function(m){return m.approved&&m.active!==false;}).forEach(function(m){
    memOpts+='<option value="'+escHtml(m.name)+'">'+escHtml(m.name)+' ('+escHtml(m.role||'Member')+')</option>';
  });
  document.getElementById('mltar-body').innerHTML=
    '<div class="fg"><label class="flabel">Brand Name</label><input class="finput nb" id="ltar-brand" placeholder="e.g. NewBrand Co"/></div>'+
    '<div class="fg"><label class="flabel">Platform</label><input class="finput nb" id="ltar-platform" placeholder="e.g. Lazada, Shopee"/></div>'+
    '<div class="fg fg2">'+
      '<div><label class="flabel">CDM</label><select class="finput nb" id="ltar-cdm">'+memOpts+'</select></div>'+
      '<div><label class="flabel">Team Lead</label><select class="finput nb" id="ltar-tl">'+memOpts+'</select></div>'+
    '</div>'+
    '<div class="form-actions">'+
      '<button class="btn primary" onclick="ltSaveNewRow(\''+trackerKey+'\',\''+sheetKey+'\')">Add Brand</button>'+
      '<button class="btn" onclick="closeModal(\'modal-lt-addrow\')">Cancel</button>'+
    '</div>';
  document.getElementById('modal-lt-addrow').querySelector('h3').textContent='Add New Brand';
  openModal('modal-lt-addrow');
}
async function ltSaveNewRow(trackerKey,sheetKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const brand=(document.getElementById('ltar-brand')?.value||'').trim();
  if(!brand){toast('Brand name is required.');return;}
  const platform=(document.getElementById('ltar-platform')?.value||'').trim();
  const cdm=document.getElementById('ltar-cdm')?.value||'';
  const tl=document.getElementById('ltar-tl')?.value||'';
  const t=D.trackers[trackerKey];if(!t){toast('Tracker not found.');return;}
  const sheet=(t.sheets||{})[sheetKey];if(!sheet){toast('Sheet not found.');return;}
  const rows=(sheet.rows||[]).slice();
  const isTR=r=>r&&String(r[3]||'').toUpperCase()==='TOTAL';
  const newRow=[brand,platform,cdm,tl];
  // Insert above the TOTAL row if one exists, otherwise append at the end.
  let insertAt=rows.length;
  for(let i=0;i<rows.length;i++){if(isTR(rows[i])){insertAt=i;break;}}
  rows.splice(insertAt,0,newRow);
  // Remap timestamps: any row at/after insertAt shifts down by one index, so its
  // timestamp keys (ri_ci) must shift too or they'll attach to the wrong row.
  const oldTimestamps=sheet.timestamps||{};
  const newTimestamps={};
  Object.keys(oldTimestamps).forEach(function(tk){
    const us=tk.indexOf('_');
    const oldRi=parseInt(tk.slice(0,us),10);
    const rest=tk.slice(us);
    const newRi=oldRi>=insertAt?oldRi+1:oldRi;
    newTimestamps[newRi+rest]=oldTimestamps[tk];
  });
  D.trackers[trackerKey].sheets[sheetKey].rows=rows;
  D.trackers[trackerKey].sheets[sheetKey].timestamps=newTimestamps;
  await fbUpd('trackers/'+trackerKey+'/sheets/'+sheetKey,{rows:rows,timestamps:newTimestamps});
  closeModal('modal-lt-addrow');
  toast('Brand "'+brand+'" added to tracker.');
  renderLiveTrackers();
}

// ── Admin: add a new platform tab (sheet) to a Finance tracker ──
// Creates an empty sheet with the standard fixed-column headers so admins can
// build out Lazada / Shopee / TikTok (or any new platform) tabs directly in-app,
// without re-uploading the whole Excel workbook.
function frOpenAddTab(trackerKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];
  if(!t){toast('Tracker not found.');return;}
  if(t.category!=='Finance'){toast('Add Tab is for Finance trackers only.');return;}
  const existing=Object.keys(t.sheets||{});
  const existLabel=existing.length?existing.join(', '):'(none yet)';
  // Suggest the common platforms that aren't already present
  const common=['Lazada','Shopee','TikTok'];
  const missing=common.filter(function(p){return !existing.some(function(e){return e.toLowerCase()===p.toLowerCase();});});
  const chips=missing.map(function(p){
    return '<button type="button" class="btn sm" onclick="document.getElementById(\'frtab-name\').value=\''+p+'\'" '
      +'style="font-size:11px;padding:2px 10px">'+p+'</button>';
  }).join(' ');
  document.getElementById('mltar-body').innerHTML=
    '<div style="font-size:12px;color:var(--text3);margin-bottom:10px">Existing tabs: <b>'+escHtml(existLabel)+'</b></div>'+
    '<div class="fg"><label class="flabel">Tab / Platform Name</label>'+
      '<input class="finput nb" id="frtab-name" placeholder="e.g. Lazada, Shopee, TikTok" autocomplete="off"/></div>'+
    (chips?'<div style="margin:-4px 0 12px;display:flex;gap:6px;flex-wrap:wrap">'+chips+'</div>':'')+
    '<div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.5">'+
      'A blank tab is created with the standard fixed columns (Region, Platform, Account Status, '+
      'Synagie Merchant ID, Brand / Store Name, Exec, Team Lead). Upload the platform\'s weekly date '+
      'columns via <b>Manage Columns</b>, or add brands with <b>+ Add Brand</b>.'+
    '</div>'+
    '<div class="form-actions">'+
      '<button class="btn primary" onclick="frSaveNewTab(\''+String(trackerKey).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\')">Create Tab</button>'+
      '<button class="btn" onclick="closeModal(\'modal-lt-addrow\')">Cancel</button>'+
    '</div>';
  document.getElementById('modal-lt-addrow').querySelector('h3').textContent='Add Tab';
  openModal('modal-lt-addrow');
  setTimeout(function(){var el=document.getElementById('frtab-name');if(el)el.focus();},40);
}

async function frSaveNewTab(trackerKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const name=(document.getElementById('frtab-name')?.value||'').trim();
  if(!name){toast('Tab name is required.');return;}
  // Firebase keys can't contain . # $ [ ] or /
  if(/[.#$\[\]\/]/.test(name)){toast('Tab name can\'t contain . # $ [ ] or /');return;}
  const t=D.trackers[trackerKey];
  if(!t){toast('Tracker not found.');return;}
  const sheets=t.sheets||{};
  // Prevent duplicate tab names (case-insensitive)
  if(Object.keys(sheets).some(function(k){return k.toLowerCase()===name.toLowerCase();})){
    toast('A tab named "'+name+'" already exists.');return;
  }
  // Seed with the platform's standard fixed-column header row so the table renders
  // immediately (an empty header row is what shows "No data").
  const fixed=(FR_PLATFORM_FIXED_DEFAULTS[name]||FR_DEFAULT_FIXED).slice();
  const newSheet={headerRows:[fixed],row0:fixed,row1:[],rows:[],timestamps:{}};
  // Append to saved tab order (if any) so the new tab shows at the end.
  const order=(t.tabOrder&&Array.isArray(t.tabOrder)?t.tabOrder.slice():Object.keys(sheets));
  if(!order.includes(name))order.push(name);
  D.trackers[trackerKey].sheets=Object.assign({},sheets,{[name]:newSheet});
  D.trackers[trackerKey].tabOrder=order;
  await fbUpd('trackers/'+trackerKey,{['sheets/'+name]:newSheet,tabOrder:order});
  _activeTracker=trackerKey;
  _activeTrackerSheet=name;
  closeModal('modal-lt-addrow');
  toast('Tab "'+name+'" created.');
  renderLiveTrackers();
}

// ── Build the AO "Exited" tab — a roll-up of every brand marked Exited or Inactive across ALL
// AO sheets. Mirrors buildExitedTable (Finance). Status + exit date live in each sheet's aoMeta
// map, keyed by the row's true array index, so edits/reactivation act on the real record.
function buildAOExitedTable(trackerKey){
  const isAdmin=CU.isAdmin;
  const t=D.trackers[trackerKey]||{};
  const allSheets=t.sheets||{};
  const collected=[];
  Object.keys(allSheets).forEach(function(sk){
    if(sk==='Exited')return;
    const s=allSheets[sk];if(!s||!s.rows||!s.aoMeta)return;
    s.rows.forEach(function(r,ri){
      if(!r)return;
      const meta=s.aoMeta[ri];
      const _st=meta?String(meta.status||'').trim():'';
      if(_st!=='Exited'&&_st!=='Inactive')return;
      collected.push({row:r,srcSheet:sk,srcRowIdx:ri,status:_st,exitDate:meta.exitDate||''});
    });
  });
  // Sort roll-up by CDM name too (auto-group per CDM), then brand.
  collected.sort(function(a,b){
    const ca=String(a.row[2]||'').trim().toLowerCase();
    const cb=String(b.row[2]||'').trim().toLowerCase();
    if(ca!==cb){if(!ca)return 1;if(!cb)return -1;return ca<cb?-1:1;}
    return String(a.row[0]||'').toLowerCase()<String(b.row[0]||'').toLowerCase()?-1:1;
  });
  const COLS=[
    {label:'Brand',idx:0,w:160},
    {label:'Platform',idx:1,w:100},
    {label:'CDM',idx:2,w:130},
    {label:'Team Lead',idx:3,w:130},
  ];
  const colSpan=COLS.length+2+(isAdmin?1:0); // +Status +Offboarding Date (+Actions)
  const hdrCells=COLS.map(function(c){return'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:left;white-space:nowrap;min-width:'+c.w+'px">'+c.label+'</th>';}).join('');
  const hdr='<tr>'+hdrCells
    +'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:left;white-space:nowrap;min-width:90px">Status</th>'
    +'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:left;white-space:nowrap;min-width:140px">Offboarding Date</th>'
    +(isAdmin?'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:center;white-space:nowrap;min-width:120px">Actions</th>':'')
    +'</tr>';
  const _kEsc=String(trackerKey).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  let _prevCdm=null;
  const body=collected.length?collected.map(function(item){
    const row=item.row;
    const _src=String(item.srcSheet).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const _sri=item.srcRowIdx;
    const _isInact=item.status==='Inactive';
    const _rowBg=_isInact?'#fffbeb':'#fff8f8';
    let groupHtml='';
    const _cdm=String(row[2]||'').trim();
    const _cdmKey=_cdm.toLowerCase();
    if(_cdmKey!==_prevCdm){
      _prevCdm=_cdmKey;
      groupHtml='<tr><td colspan="'+colSpan+'" style="background:#fbe9e9;border:1px solid var(--border);padding:4px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c">👤 CDM: '+escHtml(_cdm||'— Unassigned —')+'</td></tr>';
    }
    const cells=COLS.map(function(c){
      const v=row[c.idx]!=null&&String(row[c.idx]).trim()!==''?String(row[c.idx]).trim():'—';
      const srcTag=(c.idx===0&&item.srcSheet)?'<div style="font-size:8px;color:var(--text4);margin-top:2px">from '+escHtml(item.srcSheet)+'</div>':'';
      return'<td style="padding:5px 10px;border:1px solid var(--border);font-size:12px;color:var(--text2);white-space:nowrap;background:'+_rowBg+'">'+escHtml(v)+srcTag+'</td>';
    }).join('');
    const _stColor=_isInact?'#92400e':'var(--red)';
    const _stBg=_isInact?'var(--yellow-light)':'var(--red-light)';
    const _stBd=_isInact?'var(--yellow)':'var(--red)';
    const statusCell='<td style="padding:5px 10px;border:1px solid var(--border);background:'+_rowBg+';white-space:nowrap"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:'+_stBg+';color:'+_stColor+';border:1px solid '+_stBd+'">'+escHtml(item.status)+'</span></td>';
    // Offboarding date only applies to Exited; Inactive shows a dash.
    const dateCell=(!_isInact&&isAdmin)
      ?'<td style="padding:4px 8px;border:1px solid var(--border);background:'+_rowBg+';white-space:nowrap"><input type="date" value="'+escHtml(item.exitDate||'')+'" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px;color:var(--red);font-family:inherit;width:130px" onchange="aoUpdateExitDate(\''+_kEsc+'\',\''+_src+'\','+_sri+',this.value)"/></td>'
      :'<td style="padding:5px 10px;border:1px solid var(--border);background:'+_rowBg+';font-size:12px;color:var(--red);font-weight:600;white-space:nowrap">'+escHtml(_isInact?'—':(item.exitDate||'—'))+'</td>';
    const actions=isAdmin?'<td style="padding:4px 8px;border:1px solid var(--border);background:'+_rowBg+';text-align:center;white-space:nowrap"><button onclick="aoReactivateRow(\''+_kEsc+'\',\''+_src+'\','+_sri+')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--green);background:var(--green-light);color:var(--green);font-size:11px;font-weight:700;cursor:pointer" title="Move this brand back to Active">↩ Reactivate</button></td>':'';
    return groupHtml+'<tr style="background:'+_rowBg+'">'+cells+statusCell+dateCell+actions+'</tr>';
  }).join(''):'<tr><td colspan="'+colSpan+'" class="empty-state" style="padding:32px;text-align:center;color:var(--text4)">No exited or inactive brands.</td></tr>';
  const info='<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fef2f2;border-bottom:1px solid var(--red-mid);font-size:11px;color:var(--red)"><span>⚠️</span><span>Exited / Inactive brands — <strong>'+collected.length+' record'+(collected.length!==1?'s':'')+'</strong>. These brands are no longer active in the AO tracker.</span></div>';
  return'<div style="overflow:auto;max-height:calc(100vh - 220px);position:relative">'+info+'<table style="border-collapse:collapse;font-size:12px;min-width:100%"><thead style="position:sticky;top:0;z-index:4">'+hdr+'</thead><tbody>'+body+'</tbody></table></div>';
}

function buildAOTable(trackerKey,sheetKey,sheet){
  if(!sheet)return'<div class="empty-state" style="padding:32px">Empty sheet.</div>';
  const{row0,row1,rows}=sheet;
  if(!row0||!row0.length)return'<div class="empty-state" style="padding:32px">No data. Upload your Excel file.</div>';
  const isAdmin=CU.isAdmin;

  const nowT=now(),todayStr=ds(nowT);

  // Week being viewed: 0 = live current week (default, editable as normal); a negative
  // offset (set via the "◀ Prev week" control above the tabs) steps back through past weeks
  // for reference — at least one week back is always available. See _aoWeekOffset.
  const _aoWo=_aoWeekOffset[aoWeekOffsetKey(trackerKey,sheetKey)]||0;
  const isRefWeek=_aoWo!==0;

  // Build Mon-Fri of the viewed week (current week when offset is 0)
  const weekDates=[];
  const mon=new Date(nowT);
  mon.setDate(nowT.getDate()-(nowT.getDay()===0?6:nowT.getDay()-1)+_aoWo*7);
  mon.setHours(0,0,0,0);
  for(let i=0;i<5;i++){const d=new Date(mon);d.setDate(mon.getDate()+i);weekDates.push(ds(d));}

  const maxCol=Math.max((row0||[]).length,(row1||[]).length);
  // Status is a VIRTUAL fixed column (index 4 in the display list) — it is not backed by the
  // row array (which reserves index 4+ for date columns). Its value comes from sheet.aoMeta.
  const AO_STATUS_DISP=4;
  const fixedW=[120,80,90,90,90],fixedL=['Brand','Platform','CDM','Team Lead','Status'];

  // Parse date columns from Excel headers
  const dateCols=[];
  for(let ci=4;ci<maxCol;ci+=2){
    const h0=row0[ci]!=null?String(row0[ci]):'';
    const h1a=row1&&row1[ci]!=null?String(row1[ci]):'Order';
    const h1b=row1&&row1[ci+1]!=null?String(row1[ci+1]):'Product';
    let colDateStr='',isWeekend=false;
    const dp=h0.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(dp){
      colDateStr=dp[3]+'-'+dp[1].padStart(2,'0')+'-'+dp[2].padStart(2,'0');
      const dow=new Date(colDateStr+'T00:00:00').getDay();
      isWeekend=(dow===0||dow===6);
    }
    const isToday=colDateStr===todayStr;
    const isPast=colDateStr&&colDateStr<todayStr&&!isToday;
    const isFuture=colDateStr&&colDateStr>todayStr;
    const isCurrentWeek=weekDates.includes(colDateStr);
    // Only show current week Mon-Fri + past cols, skip weekends
    if(isWeekend)continue;
    // Only show columns that belong to the target week
    if(colDateStr&&!weekDates.includes(colDateStr))continue;
    dateCols.push({ci,h0,h1a,h1b,isToday,isPast,isFuture,isCurrentWeek:weekDates.includes(colDateStr),colDateStr});
  }

  // If no cols found for this week, generate blank columns for the week
  // ALSO: if some weekdays have headers but others don't, add virtual cols for the missing days
  if(dateCols.length===0){
    // Create virtual date columns for the target week
    weekDates.forEach(function(wDate,wi){
      const dayNames=['Mon','Tue','Wed','Thu','Fri'];
      const dateObj=new Date(wDate+'T12:00:00');
      const displayDate=(dateObj.getMonth()+1)+'/'+dateObj.getDate()+'/'+dateObj.getFullYear();
      const isToday2=wDate===todayStr;
      const isPast2=wDate<todayStr;
      const isFuture2=wDate>todayStr;
      // Use col indices beyond existing data, unique per calendar week (see aoWeekBlock)
      const vci=maxCol+aoWeekBlock(wDate)*10+wi*2;
      dateCols.push({ci:vci,h0:displayDate,h1a:'Order',h1b:'Product',
        isToday:isToday2,isPast:isPast2,isFuture:isFuture2,
        isCurrentWeek:true,colDateStr:wDate,virtual:true});
    });
  } else {
    // Partial headers: some weekdays in the current week have Excel headers but others don't.
    // Generate virtual columns for any weekday that is missing from dateCols so they remain editable.
    const coveredDates=new Set(dateCols.map(function(dc){return dc.colDateStr;}));
    weekDates.forEach(function(wDate,wi){
      if(coveredDates.has(wDate))return; // already has a real Excel column
      const dateObj=new Date(wDate+'T12:00:00');
      const displayDate=(dateObj.getMonth()+1)+'/'+dateObj.getDate()+'/'+dateObj.getFullYear();
      const isToday2=wDate===todayStr;
      const isPast2=wDate<todayStr;
      const isFuture2=wDate>todayStr;
      // Virtual column index mirrors ltUpdateCell/aoFindDateCols: maxCol + weekBlock*10 + weekday-position*2
      const vci=maxCol+aoWeekBlock(wDate)*10+wi*2;
      dateCols.push({ci:vci,h0:displayDate,h1a:'Order',h1b:'Product',
        isToday:isToday2,isPast:isPast2,isFuture:isFuture2,
        isCurrentWeek:true,colDateStr:wDate,virtual:true});
    });
    // Re-sort dateCols by colDateStr so they appear in Mon→Fri order
    dateCols.sort(function(a,b){return(a.colDateStr||'').localeCompare(b.colDateStr||'');});
  }



  const isTR=r=>r&&String(r[3]||'').toUpperCase()==='TOTAL';

  // colSum reads from live local D.trackers data (written by ltUpdateCell) so totals
  // update immediately on input, and virtual columns (no Excel date headers) work too.
  function colSum(ci){
    const liveSheet=(D.trackers[trackerKey]||{}).sheets&&D.trackers[trackerKey].sheets[sheetKey];
    const liveRows=liveSheet&&liveSheet.rows?liveSheet.rows:(rows||[]);
    let s=0;
    liveRows.forEach(function(r){
      if(!r||isTR(r))return;
      const v=r[ci];
      if(v===null||v===undefined||String(v).toUpperCase()==='OFF'||String(v).trim()==='')return;
      const n=parseFloat(v);if(!isNaN(n))s+=n;
    });
    return s;
  }


  // ── Row selection state ──
  const _aoSelKey='_aoSel_'+trackerKey+'_'+sheetKey;
  if(!window[_aoSelKey])window[_aoSelKey]=new Set();
  const aoSelRows=window[_aoSelKey];

  // ── Checkbox col width ──
  const CB_W=36;

  // ── Compute per-column sticky left offsets (checkbox col = 0, then each fixed col offset) ──
  // checkbox is at left:0; fixed cols accumulate after it
  const aoFixedLefts=[CB_W]; // left offset for fixedW[0]
  for(let i=1;i<fixedW.length;i++){aoFixedLefts.push(aoFixedLefts[i-1]+fixedW[i-1]);}
  // last sticky col gets a separator shadow
  const lastFixedIdx=fixedW.length-1;

  // ── Build header row 1: checkbox col (sticky left:0) + fixed cols (individual sticky) + date headers ──
  // Done button is embedded inside each date header cell (above the date label)
  let hR1='<tr>';
  // Checkbox "select all" header cell (sticky at left:0)
  hR1+='<th rowspan="2" style="position:sticky;left:0;z-index:5;background:#f0f4f8;padding:4px 6px;border:1px solid var(--border);text-align:center;vertical-align:middle;min-width:'+CB_W+'px;width:'+CB_W+'px" title="Select / deselect all">'
    +(isRefWeek?'':'<input type="checkbox" id="ao-sel-all-'+trackerKey+'-'+sheetKey+'" style="cursor:pointer;width:14px;height:14px;accent-color:var(--blue)" onchange="aoSelectAll(\''+trackerKey+'\',\''+sheetKey+'\',this)" title="Select all brands">')
  +'</th>';
  fixedW.forEach(function(w,i){
    const sl=aoFixedLefts[i];
    const isLast=i===lastFixedIdx;
    const shadowStyle=isLast?'box-shadow:2px 0 4px rgba(0,0,0,0.08);':'';
    hR1+='<th rowspan="2" style="position:sticky;left:'+sl+'px;z-index:4;'+shadowStyle+'background:#f0f4f8;padding:6px 8px;border:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);text-align:left;vertical-align:middle;min-width:'+w+'px;white-space:nowrap">'+fixedL[i]+'</th>';
  });
  dateCols.forEach(function(dc){
    const bg=dc.isToday?'#dbeafe':dc.isPast?'#f8fafc':'#f1f5f9';
    const fg=dc.isToday?'var(--blue)':dc.isPast?'var(--text3)':'var(--text4)';
    const todayMark=dc.isToday?' ★':'';
    const dayName=dc.colDateStr?['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(dc.colDateStr+'T12:00:00').getDay()]:'';
    // Mark Done button removed from member view — status driven by tracker input only
    let doneBtnHtml='';
    hR1+='<th colspan="2" style="text-align:center;padding:5px 6px;background:'+bg+';border:1px solid var(--border);border-left:2px solid var(--blue-mid);font-size:10px;font-weight:700;color:'+fg+';white-space:nowrap;min-width:130px">'
      +'<div>'+dc.h0+'</div>'
      +'<div style="font-size:9px;font-weight:600;opacity:.7">'+dayName+todayMark+'</div>'
      +doneBtnHtml
    +'</th>';
  });
  hR1+='</tr>';

  // ── Header row 2: Order / Product sub-headers ──
  let hR2='<tr>';
  dateCols.forEach(function(dc){
    const bg=dc.isToday?'#eff6ff':dc.isPast?'#f8fafc':'#f5f5f5';
    hR2+='<th style="padding:4px 5px;background:'+bg+';border:1px solid var(--border);border-left:2px solid var(--blue-mid);font-size:10px;font-weight:600;color:var(--text3);text-align:center;min-width:60px">'+dc.h1a+'</th>';
    hR2+='<th style="padding:4px 5px;background:'+bg+';border:1px solid var(--border);font-size:10px;font-weight:600;color:var(--text3);text-align:center;min-width:60px">'+dc.h1b+'</th>';
  });
  hR2+='</tr>';

  // (no separate Done row — button is embedded in date header above)
  const hDoneRow='';

  // ── Data rows ──
  // Build an ordered index list. We keep each row's TRUE array index (ri) for edits/selection,
  // but reorder for display so all rows sharing the same CDM cluster together (auto-group per CDM
  // name). The TOTAL row is always kept pinned at the very bottom in its original position.
  const _liveSheetForOrder=(D.trackers[trackerKey]||{}).sheets&&D.trackers[trackerKey].sheets[sheetKey];
  const _metaSheet=_liveSheetForOrder||sheet;
  const _ordered=[];
  (rows||[]).forEach(function(row,ri){ if(row)_ordered.push({row:row,ri:ri}); });
  const _totalEntries=_ordered.filter(function(e){return isTR(e.row);});
  const _dataEntries=_ordered.filter(function(e){return !isTR(e.row);});
  // Stable group-by-CDM sort: primary key = CDM name (empty/unassigned sorts last); secondary
  // key = brand name, so newly-added brands slot into their CDM group in brand order automatically.
  _dataEntries.sort(function(a,b){
    const ca=String(a.row[2]||'').trim().toLowerCase();
    const cb=String(b.row[2]||'').trim().toLowerCase();
    if(ca!==cb){if(!ca)return 1;if(!cb)return -1;return ca<cb?-1:1;}
    const ba=String(a.row[0]||'').trim().toLowerCase();
    const bb=String(b.row[0]||'').trim().toLowerCase();
    if(ba!==bb)return ba<bb?-1:1;
    return a.ri-b.ri;
  });
  const _renderOrder=_dataEntries.concat(_totalEntries);
  let _prevCdmGroup=null;
  const bodyRows=_renderOrder.map(function(entry){
    const row=entry.row, ri=entry.ri;
    if(!row)return'';
    const isT=isTR(row);
    // Exited/Inactive brands never appear in the active view — they live only in the Exited tab.
    if(!isT){const _aost=aoRowStatus(_metaSheet,ri);if(_aost==='Exited'||_aost==='Inactive')return'';}
    // Apply column filters (skip total row and rows without data)
    if(!isT){
      if(_aoFilter.brand&&!String(row[0]||'').toLowerCase().includes(_aoFilter.brand.toLowerCase()))return'';
      if(_aoFilter.platform&&!String(row[1]||'').toLowerCase().includes(_aoFilter.platform.toLowerCase()))return'';
      if(_aoFilter.cdm&&!String(row[2]||'').toLowerCase().includes(_aoFilter.cdm.toLowerCase()))return'';
      if(_aoFilter.tl&&!String(row[3]||'').toLowerCase().includes(_aoFilter.tl.toLowerCase()))return'';
    }
    // ── CDM group divider row ── inserted whenever the CDM name changes between data rows.
    let groupHeaderHtml='';
    if(!isT){
      const _cdmName=String(row[2]||'').trim();
      const _cdmKey=_cdmName.toLowerCase();
      if(_cdmKey!==_prevCdmGroup){
        _prevCdmGroup=_cdmKey;
        const _label=_cdmName||'— Unassigned —';
        const _colspanTotal=1+fixedW.length+dateCols.length*2;
        groupHeaderHtml='<tr><td colspan="'+_colspanTotal+'" style="position:sticky;left:0;background:#eef2f7;border:1px solid var(--border);padding:4px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">👤 CDM: '+escHtml(_label)+'</td></tr>';
      }
    }
    const isSel=aoSelRows.has(ri);
    let cells='';
    // Checkbox cell (sticky at left:0) — skip for total rows
    if(!isT&&!isRefWeek){
      cells+='<td style="position:sticky;left:0;z-index:2;padding:3px 6px;border:1px solid var(--border);background:'+(isSel?'#dbeafe':'var(--surface)')+';text-align:center;vertical-align:middle;cursor:pointer;min-width:'+CB_W+'px;width:'+CB_W+'px" onclick="aoToggleRowSel(\''+trackerKey+'\',\''+sheetKey+'\','+ri+')" title="Select this brand">'
        +'<input type="checkbox" '+(isSel?'checked':'')+' style="cursor:pointer;width:14px;height:14px;accent-color:var(--blue)" onclick="event.stopPropagation();aoToggleRowSel(\''+trackerKey+'\',\''+sheetKey+'\','+ri+')">'
      +'</td>';
    } else {
      cells+='<td style="position:sticky;left:0;z-index:2;padding:3px 6px;border:1px solid var(--border);background:#f8fafc;min-width:'+CB_W+'px;width:'+CB_W+'px"></td>';
    }
    // Fixed sticky cols (individual left offsets)
    // CDM (i===2) and Team Lead (i===3) are admin-editable dropdowns sourced from registered
    // members, so the assignment always matches a real login name exactly (no more free-typed
    // names that don't match anyone, and no more access decided by what's in an Excel cell).
    const aoMemberOpts=(i2v)=>{
      const cur=(i2v||'').trim();
      let opts='<option value="">— Unassigned —</option>';
      const seen={};
      (D.members||[]).filter(function(m){return m.approved&&m.active!==false;}).forEach(function(m){
        seen[m.name]=1;
        opts+='<option value="'+escHtml(m.name)+'"'+(m.name===cur?' selected':'')+'>'+escHtml(m.name)+' ('+escHtml(m.role||'Member')+')</option>';
      });
      if(cur&&!seen[cur])opts+='<option value="'+escHtml(cur)+'" selected>'+escHtml(cur)+' (unmatched — pick a member)</option>';
      return opts;
    };
    fixedW.forEach(function(_,i){
      const isStatusCol=(i===AO_STATUS_DISP);
      const v=isStatusCol?'':row[i]; // Status is virtual — not in the row array
      const vS=(v===null||v===undefined)?'':String(v);
      const fixBg=isT?'#f8fafc':(isSel?'#eff6ff':'var(--surface)');
      const sl=aoFixedLefts[i];
      const isLast=i===lastFixedIdx;
      const shadowStyle=isLast?'box-shadow:2px 0 4px rgba(0,0,0,0.06);':'';
      const isAssigneeCol=!isT&&(i===2||i===3);
      let cellInner;
      if(isStatusCol){
        // Virtual Status column (Active / Inactive / Exited), sourced from sheet.aoMeta.
        if(isT){cellInner='';}
        else{
          const _st=aoRowStatus(_metaSheet,ri);
          const _isExitedRow=_st==='Exited';
          const _isInactiveRow=_st==='Inactive';
          const _stColor=_isExitedRow?'var(--red)':_isInactiveRow?'#92400e':'var(--green)';
          const _stBg=_isExitedRow?'var(--red-light)':_isInactiveRow?'var(--yellow-light)':'var(--green-light)';
          if(isAdmin){
            const _opts=['Active','Inactive','Exited'].map(function(s){return'<option value="'+s+'"'+(_st===s?' selected':'')+'>'+s+'</option>';}).join('');
            cellInner='<select onchange="aoInlineStatusChange(\''+trackerKey+'\',\''+sheetKey+'\','+ri+',this.value,this)" style="padding:2px 6px;border-radius:20px;border:1px solid '+_stColor+';background:'+_stBg+';color:'+_stColor+';font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;appearance:auto">'+_opts+'</select>';
          } else {
            cellInner='<span style="display:inline-block;padding:2px 9px;border-radius:20px;border:1px solid '+_stColor+';background:'+_stBg+';color:'+_stColor+';font-size:11px;font-weight:700">'+_st+'</span>';
          }
        }
      } else if(isAssigneeCol&&isAdmin){
        cellInner='<select onchange="ltSetRowAssignee(\''+trackerKey+'\',\''+sheetKey+'\','+ri+','+i+',this.value)" style="width:100%;max-width:'+(fixedW[i]-10)+'px;padding:2px 3px;font-size:11px;border:1px solid var(--border);border-radius:3px;background:#fff">'+aoMemberOpts(vS)+'</select>';
      } else if(isAssigneeCol&&!vS){
        cellInner='<span style="color:var(--text4)">— Unassigned —</span>';
      } else {
        cellInner=escHtml(vS);
      }
      cells+='<td style="position:sticky;left:'+sl+'px;z-index:1;'+shadowStyle+'padding:5px 8px;border:1px solid var(--border);font-weight:'+(isT?700:'normal')+';font-size:12px;text-align:left;background:'+fixBg+';white-space:nowrap">'+cellInner+'</td>';
    });
    // Date cols
    dateCols.forEach(function(dc){
      [dc.ci,dc.ci+1].forEach(function(c){
        const isLeft=c===dc.ci;
        const bl=isLeft?'border-left:2px solid var(--blue-mid);':'';
        if(isT){
          const sum=colSum(c); // always use live colSum regardless of virtual/real col
          cells+='<td data-totalri="'+ri+'" data-ci="'+c+'" data-tk="'+trackerKey+'" data-sk="'+sheetKey+'" style="padding:5px 8px;border:1px solid var(--border);'+bl+'font-weight:700;background:#f8fafc;text-align:center;font-size:12px">'+(sum||0)+'</td>';
        } else {
          const localSheetData=(D.trackers[trackerKey]||{}).sheets?D.trackers[trackerKey].sheets[sheetKey]:null;
          const localRow=localSheetData&&localSheetData.rows?localSheetData.rows[ri]:null;
          const v=localRow!=null?localRow[c]??row[c]:(dc.virtual?null:row[c]);
          const vS=(v===null||v===undefined)?'':String(v);
          const isOFF=vS.toUpperCase()==='OFF';
          // 0 is a valid filled value — only null/undefined/'' means truly empty
          const filled=v!==null&&v!==undefined&&vS!==''&&!isOFF;
          // Lock for: future dates (always), past dates for non-admins, any user who isn't the
          // row's assigned CDM/Team Lead (or admin) — view-only otherwise — and, regardless of
          // role, any week reached via "◀ Prev week" (isRefWeek): that view is reference-only
          // for everyone, admins included, so history can't be edited by accident while browsing.
          const isPastLockedForUser=(dc.isPast&&!dc.isToday&&!isAdmin)||isRefWeek;
          const owner=aoIsRowOwner(row);
          const isNotOwnerLocked=!owner&&!isPastLockedForUser&&!dc.isFuture;
          const locked=dc.isFuture||isPastLockedForUser||isNotOwnerLocked;
          const cellBg=isOFF?'#f1f5f9':filled?'var(--green-light)':dc.isToday?'#fffde7':'transparent';
          const cellCol=isOFF?'var(--text4)':filled?'var(--green)':'var(--text)';
          const localTs=localSheetData&&localSheetData.timestamps?localSheetData.timestamps[ri+'_'+c]:'';
          const ts=localTs||((sheet.timestamps||{})[ri+'_'+c])||'';
          if(locked){
            if(isPastLockedForUser){
              // Past entry (non-admin), or ANY entry while browsing a previous week via
              // "◀ Prev week" (read-only reference view for every role): show the actual
              // value with its audit stamp, no input.
              cells+='<td style="padding:3px 4px;border:1px solid var(--border);'+bl+'text-align:center;background:'+(isRefWeek?'#fffbeb':'#fafafa')+'" title="'+(isRefWeek?'Reference view — previous week (read-only for everyone)':'Past dates can only be edited by an admin')+'">'
                +'<div style="width:54px;padding:3px 4px;font-size:11px;text-align:center;color:'+cellCol+';margin:0 auto">'+escHtml(vS)+'</div>'
                +(ts?'<div class="ao-ts" style="font-size:9px;color:var(--text4);line-height:1.2">'+escHtml(ts)+'</div>':'')
              +'</td>';
            } else if(isNotOwnerLocked){
              // Not this user's CDM/Team Lead row: view-only — show the value but no input
              cells+='<td style="padding:3px 4px;border:1px solid var(--border);'+bl+'text-align:center;background:'+cellBg+'" title="View only — assigned to '+escHtml(row[2]||row[3]||'another member')+'">'
                +'<div style="width:54px;padding:3px 4px;font-size:11px;text-align:center;color:'+cellCol+';margin:0 auto">'+(vS?escHtml(vS):'—')+'</div>'
                +(ts?'<div class="ao-ts" style="font-size:9px;color:var(--text4);line-height:1.2">'+escHtml(ts)+'</div>':'')
              +'</td>';
            } else {
              // Future: read-only placeholder
              cells+='<td style="padding:3px 4px;border:1px solid var(--border);'+bl+'text-align:center;background:#fafafa">'
                +'<div style="width:54px;padding:3px 4px;font-size:11px;text-align:center;color:#ccc;margin:0 auto">—</div>'
              +'</td>';
            }
          } else {
            // Today and past: editable so figures can always be recorded/corrected
            const pastStyle=dc.isPast&&!dc.isToday?'opacity:.85;':'';
            cells+='<td style="padding:2px 3px;border:1px solid var(--border);'+bl+'text-align:center;vertical-align:middle;background:'+cellBg+';'+pastStyle+'">'
              +'<input type="text" value="'+vS+'" placeholder=""'
              +' data-ri="'+ri+'" data-ci="'+c+'" data-tk="'+trackerKey+'" data-sk="'+sheetKey+'"'
              +' style="width:54px;padding:3px 4px;border:1px solid transparent;border-radius:3px;font-size:11px;text-align:center;background:transparent;color:'+cellCol+'"'
              +' oninput="ltCellInput(this,\''+trackerKey+'\',\''+sheetKey+'\','+ri+','+c+')"'
              +' onchange="ltUpdateCell(\''+trackerKey+'\',\''+sheetKey+'\','+ri+','+c+',this.value)"'
              +' onfocus="this.style.outline=\'2px solid var(--blue)\'"'
              +' onblur="this.style.outline=\'none\'"/>'
              +(ts?'<div class="ao-ts" style="font-size:9px;color:var(--text4);line-height:1.2">'+ts+'</div>':'')
            +'</td>';
          }
        }
      });
    });
    return groupHeaderHtml+'<tr style="background:'+(isT?'#f8fafc':isSel?'#eff6ff':'')+'">' + cells + '</tr>';
  }).join('');

  const hasFilters=_aoFilter.brand||_aoFilter.platform||_aoFilter.cdm||_aoFilter.tl;
  const filterBar='<div style="display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:#f0f6ff;flex-wrap:wrap;align-items:center">'
    +'<span style="font-size:11px;font-weight:700;color:var(--blue);white-space:nowrap">🔍 Filter:</span>'
    +'<input placeholder="Brand" value="'+escHtml(_aoFilter.brand||'')+'" oninput="aoSetFilter(\'brand\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:110px;font-family:inherit" />'
    +'<input placeholder="Platform" value="'+escHtml(_aoFilter.platform||'')+'" oninput="aoSetFilter(\'platform\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:100px;font-family:inherit" />'
    +'<input placeholder="CDM" value="'+escHtml(_aoFilter.cdm||'')+'" oninput="aoSetFilter(\'cdm\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:100px;font-family:inherit" />'
    +'<input placeholder="Team Lead" value="'+escHtml(_aoFilter.tl||'')+'" oninput="aoSetFilter(\'tl\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:100px;font-family:inherit" />'
    +(hasFilters?'<button onclick="_aoFilter={brand:\'\',platform:\'\',cdm:\'\',tl:\'\'};renderLiveTrackers()" style="padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;background:#fff;cursor:pointer;color:var(--red)">✕ Clear</button>':'')
  +'</div>';

  // ── Instruction banner ── (swapped for a reference-view notice while browsing a past week)
  const instrBanner=isRefWeek
    ?'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fffbeb;border-bottom:1px solid var(--yellow-mid);font-size:11px;color:#92400e;flex-wrap:wrap">'
      +'<span style="font-size:14px">📌</span>'
      +'<span>You\'re viewing a <b>past week for reference</b> — all cells are read-only here, including for admins. Click <b>Today ⟳</b> above to return to the live, editable current week.</span>'
    +'</div>'
    :'<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:linear-gradient(135deg,#fffbeb,#fefce8);border-bottom:1px solid var(--yellow-mid);font-size:11px;color:#92400e;flex-wrap:wrap">'
    +'<span style="font-size:14px">☑️</span>'
    +'<span><b>Select brands</b> using the checkboxes, then click <b style="color:var(--red)">Set Selected to 0</b> to zero-out <b>today\'s</b> values for those brands (other days are never touched).'
      +(CU.isAdmin?' Admins can also click <b style="color:var(--red)">🗑 Delete Selected</b> to permanently remove inactive brands, or <b style="color:var(--text3)">🧹 Blank Selected (Today)</b> to clear today\'s cells back to empty.':'')
      +' Or use the top checkbox to select all.</span>'
  +'</div>';

  // ── Action bar (hidden while viewing a past week for reference — nothing here is editable) ──
  const selCount=aoSelRows.size;
  const actionBar=isRefWeek?'':'<div id="ao-action-bar-'+trackerKey+'-'+sheetKey+'" style="display:flex;align-items:center;gap:10px;padding:7px 14px;background:'+(selCount?'#fff7ed':'#fafafa')+';border-bottom:1px solid '+(selCount?'var(--yellow-mid)':'var(--border)')+';transition:background .2s">'
    +(CU.isAdmin?'<button onclick="ltOpenAddRow(\''+trackerKey+'\',\''+sheetKey+'\')" style="padding:5px 12px;border:1px solid var(--green-mid);border-radius:var(--radius);font-size:11px;font-weight:700;background:var(--green-light);color:var(--green);cursor:pointer">+ Add Brand</button>':'')
    +'<span style="font-size:12px;font-weight:600;color:'+(selCount?'var(--orange)':'var(--text4)')+'">'
      +(selCount?selCount+' brand'+(selCount>1?'s':'')+' selected':'No brands selected')
    +'</span>'
    +(selCount?'<button onclick="aoClearSelection(\''+trackerKey+'\',\''+sheetKey+'\')" style="padding:3px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;background:#fff;cursor:pointer;color:var(--text3)">✕ Clear</button>':'')
    +(CU.isAdmin?'<button onclick="aoDeleteSelectedRows(\''+trackerKey+'\',\''+sheetKey+'\')" '+(selCount?'':'disabled ')
      +'style="margin-left:auto;padding:5px 16px;border:1px solid var(--red);border-radius:var(--radius);font-size:12px;font-weight:700;background:'+(selCount?'#fff':'#f1f5f9')+';color:'+(selCount?'var(--red)':'var(--text4)')+';cursor:'+(selCount?'pointer':'not-allowed')+'">🗑 Delete Selected</button>':'')
    +(CU.isAdmin?'<button onclick="aoClearSelectedToday(\''+trackerKey+'\',\''+sheetKey+'\')" '+(selCount?'':'disabled ')
      +'style="'+(selCount?'':'margin-left:auto;')+'padding:5px 16px;border:1px solid var(--text4);border-radius:var(--radius);font-size:12px;font-weight:700;background:'+(selCount?'#fff':'#f1f5f9')+';color:'+(selCount?'var(--text3)':'var(--text4)')+';cursor:'+(selCount?'pointer':'not-allowed')+'">🧹 Blank Selected (Today)</button>':'')
    +'<button onclick="aoSetSelectedToZero(\''+trackerKey+'\',\''+sheetKey+'\')" '+(selCount?'':'disabled ')
      +'style="'+(CU.isAdmin?'':'margin-left:auto;')+'padding:5px 16px;border:none;border-radius:var(--radius);font-size:12px;font-weight:700;background:'+(selCount?'var(--red)':'#e2e8f0')+';color:'+(selCount?'#fff':'var(--text4)')+';cursor:'+(selCount?'pointer':'not-allowed')+'">⟳ Set Selected to 0</button>'
  +'</div>';

  const legend='<div style="display:flex;gap:12px;padding:8px 12px;border-bottom:1px solid var(--border);background:#fafafa;font-size:11px;color:var(--text3);flex-wrap:wrap">'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--green-light);border-radius:2px;display:inline-block"></span>Filled</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#fffde7;border-radius:2px;display:inline-block"></span>Today — editable</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#fafafa;border:1px solid #ddd;border-radius:2px;display:inline-block"></span>Past — admin-only edit</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#fafafa;border:1px solid #ddd;border-radius:2px;display:inline-block"></span>Future — locked</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#f1f5f9;border-radius:2px;display:inline-block"></span>OFF</span>'
    +'<span style="margin-left:auto;font-weight:600;color:var(--blue)">★ = Today</span>'
  +'</div>';

  return '<div style="display:flex;flex-direction:column;max-height:calc(100vh - 220px)">'
    +filterBar
    +instrBanner
    +actionBar
    +legend
    +'<div id="ao-table-scroll" style="overflow:auto;flex:1;min-height:0">'
      +'<table style="border-collapse:collapse;font-size:12px;min-width:100%">'
        +'<thead style="position:sticky;top:0;z-index:3">'+hR1+hR2+hDoneRow+'</thead>'
        +'<tbody>'+bodyRows+'</tbody>'
      +'</table>'
    +'</div>'
  +'</div>';
}
// Immediate visual feedback while typing in an AO cell (before onchange fires)
function ltCellInput(inp,trackerKey,sheetKey,ri,ci){
  const v=inp.value;
  const trimmed=v.trim();
  const isOFF=trimmed.toUpperCase()==='OFF';
  // 0 is filled — only blank string is unfilled
  const filled=trimmed!==''&&!isOFF;
  const cellBg=isOFF?'#f1f5f9':filled?'var(--green-light)':'#fffde7';
  const cellCol=isOFF?'var(--text4)':filled?'var(--green)':'var(--text)';
  inp.style.color=cellCol;
  const td=inp.closest('td');
  if(td)td.style.background=cellBg;
}

async function ltUpdateCell(trackerKey,sheetKey,ri,ci,val){
  // Guard: for AO-linked trackers, only admin or the CDM/Team Lead assigned to this row
  // may write to it. Other tracker types (e.g. Finance Report) are unaffected.
  const _tkr=D.trackers[trackerKey];
  if(_tkr&&_tkr.aoLinked){
    const _existingRow=(_tkr.sheets&&_tkr.sheets[sheetKey]&&_tkr.sheets[sheetKey].rows)?_tkr.sheets[sheetKey].rows[ri]:null;
    if(!aoIsRowOwner(_existingRow)){toast('View only — this row is assigned to another member.');renderLiveTrackers();return;}
  }
  const _firstName=(CU.name||'').split(' ')[0]||'';
  const ts=ltStamp();
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  // '' → null (clear), 'OFF' → 'OFF', numeric string (including '0') → number, else keep as string
  const trimmed=String(val).trim();
  const parsed=trimmed===''?null:(trimmed.toUpperCase()==='OFF'?'OFF':(!isNaN(Number(trimmed))&&trimmed!==''?Number(trimmed):trimmed)); // so all computations reflect the new value at once
  if(!D.trackers[trackerKey])D.trackers[trackerKey]={};
  if(!D.trackers[trackerKey].sheets)D.trackers[trackerKey].sheets={};
  if(!D.trackers[trackerKey].sheets[sheetKey])D.trackers[trackerKey].sheets[sheetKey]={rows:[],timestamps:{}};
  const localSheet=D.trackers[trackerKey].sheets[sheetKey];
  if(!localSheet.rows)localSheet.rows=[];
  if(!localSheet.rows[ri])localSheet.rows[ri]=[];
  localSheet.rows[ri][ci]=parsed;
  if(!localSheet.timestamps)localSheet.timestamps={};
  // Cleared field: drop the timestamp so it reads as a fresh, blank cell (no lingering record)
  if(parsed===null)delete localSheet.timestamps[ri+'_'+ci];
  else localSheet.timestamps[ri+'_'+ci]=ts;

  // 2. Recompute total row in local data
  const rows=localSheet.rows;
  let totalRowIdx=-1;
  for(let r=rows.length-1;r>=0;r--){if(rows[r]&&String(rows[r][3]||'').toUpperCase()==='TOTAL'){totalRowIdx=r;break;}}
  let colSum=0;
  if(totalRowIdx>=0){
    for(let r=0;r<totalRowIdx;r++){
      if(!rows[r])continue;
      const v=rows[r][ci];
      if(v===null||v===undefined||String(v).toUpperCase()==='OFF'||String(v)===''||String(v).trim()==='')continue;
      const n=parseFloat(v);if(!isNaN(n))colSum+=n;
    }
    localSheet.rows[totalRowIdx][ci]=colSum;
  }

  // 3. Surgically update the DOM — update this cell's background/color and the total row cell
  //    without re-rendering the whole table (avoids scroll reset and input disruption)
  const vS=parsed===null||parsed===undefined?'':String(parsed);
  const isOFF=vS.toUpperCase()==='OFF';
  // 0 is a valid filled value — only truly empty (null/undefined/'') means unfilled
  const filled=parsed!==null&&parsed!==undefined&&!isOFF;
  const cellBg=isOFF?'#f1f5f9':filled?'var(--green-light)':'#fffde7';
  const cellCol=isOFF?'var(--text4)':filled?'var(--green)':'var(--text)';
  // Find the input's parent td by data attributes
  const inp=document.querySelector('input[data-ri="'+ri+'"][data-ci="'+ci+'"][data-tk="'+trackerKey+'"][data-sk="'+sheetKey+'"]');
  if(inp){
    const td=inp.closest('td');
    if(td){
      td.style.background=cellBg;
      inp.style.color=cellCol;
      // Update, add, or remove timestamp label
      let tsDiv=td.querySelector('.ao-ts');
      if(parsed===null){
        // Cleared cell → no record should remain
        if(tsDiv)tsDiv.remove();
      } else if(ts){
        if(!tsDiv){tsDiv=document.createElement('div');tsDiv.className='ao-ts';tsDiv.style.cssText='font-size:9px;color:var(--text4);line-height:1.2';td.appendChild(tsDiv);}
        tsDiv.textContent=ts;
      }
    }
  }
  // Update total row cell if exists
  if(totalRowIdx>=0){
    const totalInp=document.querySelector('td[data-totalri="'+totalRowIdx+'"][data-ci="'+ci+'"][data-tk="'+trackerKey+'"][data-sk="'+sheetKey+'"]');
    if(totalInp)totalInp.textContent=colSum||0;
  }

  // 4. Write to Firebase in one update call
  const updates={};
  updates['rows/'+ri+'/'+ci]=parsed;
  updates['timestamps/'+ri+'_'+ci]=parsed===null?null:ts;
  if(totalRowIdx>=0)updates['rows/'+totalRowIdx+'/'+ci]=colSum;
  await fbUpd(path,updates);

  // 5. Always sync dashboard AO completion (works regardless of current page)
  if(D.trackers[trackerKey]&&D.trackers[trackerKey].aoLinked){
    // Determine the date this column belongs to by scanning the sheet's row0 for a header matching ci,
    // or by reversing the virtual-column formula: date = week[ci offset] if no header found.
    // For simplicity: sync status for today (the live editable day) which is always the relevant date.
    const editedDate=(function(){
      const sh=(D.trackers[trackerKey].sheets||{})[sheetKey];
      const row0=sh&&sh.row0||[];
      // Try to find an Excel header for this column
      for(let i=0;i<row0.length;i+=2){
        if(!row0[i])continue;
        const mo=String(row0[i]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if(mo&&(i===ci||i+1===ci)){return mo[3]+'-'+mo[1].padStart(2,'0')+'-'+mo[2].padStart(2,'0');}
      }
      // Virtual column: reverse-engineer the date from column index. All virtual columns
      // ever rendered belong to the CURRENT week (there is no week navigation), so we can
      // reverse using this week's block directly.
      const maxCol=Math.max(row0.length,4);
      const block=aoWeekBlock(ds(now()));
      const wi=Math.floor((ci-maxCol-block*10)/2); // Mon=0...Fri=4
      if(wi>=0&&wi<=4){
        const nowT=now();
        const mon=new Date(nowT);
        mon.setDate(nowT.getDate()-(nowT.getDay()===0?6:nowT.getDay()-1));
        mon.setHours(0,0,0,0);
        const d=new Date(mon);d.setDate(mon.getDate()+wi);
        return ds(d);
      }
      return ds(now());
    })();
    const newStatus=getAOStatusForDate(editedDate);
    (D.tasks||[]).forEach(function(task){
      if(!task.aoLinked)return;
      const k=sKey(task.id,editedDate);
      const cur=D.statuses[k]||{};
      if(cur.overall!==newStatus)fbUpd('statuses/'+k,{overall:newStatus,aoAuto:true});
    });
    // Refresh dashboard and my-tasks so completion bars and rates reflect new input
    if(_curPage==='dashboard')renderDashboard();
    else if(_curPage==='my-tasks')renderMyTasks();
    else ltPatchAODashboard(); // patch AO chips if on another page
  }
  if(D.trackers[trackerKey]&&D.trackers[trackerKey].frLinked){
    if(_curPage==='dashboard')renderDashboard();
    if(_curPage==='my-tasks')renderMyTasks();
  }
}

// Patch just the AO region stats on the dashboard without full re-render
function ltPatchAODashboard(){
  const today=ds(now());
  const aoComp=getAOCompletionForDashboard(today);
  if(!aoComp)return;
  // Update inline AO region chips if they exist in the DOM
  const aoInline=document.getElementById('ao-inline-regions');
  if(aoInline)aoInline.innerHTML=buildAOInlineRegions(today);
  // Update the overall AO done/total counter if present
  const aoProg=document.getElementById('ao-dash-progress');
  if(aoProg){
    let totalDone=0,totalTotal=0;
    Object.values(aoComp).forEach(function(r){totalDone+=r.order.done+r.product.done;totalTotal+=r.order.total+r.product.total;});
    const pct=totalTotal?Math.round(totalDone/totalTotal*100):0;
    aoProg.textContent=totalDone+'/'+totalTotal+' done';
    const pctEl=document.getElementById('ao-dash-pct');
    if(pctEl)pctEl.textContent=pct+'%';
  }
  // If on dashboard page, do a full render to keep everything in sync
  if(_curPage==='dashboard')renderDashboard();
}
function openAddTracker(){
  _ltParsed=null;
  var catOpts='';
  LT_CATS.forEach(function(c){catOpts+='<option>'+c+'</option>';});
  document.getElementById('mlt-body').innerHTML=
    '<div class="fg fg2">'+
      '<div><label class="flabel">Tracker Name</label><input class="finput nb" id="lt-name" placeholder="e.g. AO Tracker Week 17"/></div>'+
      '<div><label class="flabel">Category</label><select class="finput nb" id="lt-cat">'+catOpts+'</select></div>'+
    '</div>'+
    '<div id="lt-dz" style="border:2px dashed var(--border);border-radius:var(--radius-lg);padding:28px;text-align:center;cursor:pointer">'+
      '<div style="font-size:28px;margin-bottom:8px">&#128193;</div>'+
      '<div style="font-weight:600;font-size:14px;margin-bottom:4px">Click to upload Excel file</div>'+
      '<div style="font-size:12px;color:var(--text3)">.xlsx or .xls</div>'+
    '</div>'+
    '<input type="file" id="lt-file" accept=".xlsx,.xls" style="display:none"/>'+
    '<div id="lt-preview" style="margin-top:10px"></div>'+
    '<div class="form-actions">'+
      '<button class="btn primary" id="lt-save-btn" onclick="ltSave()" style="display:none">Save Tracker</button>'+
      '<button class="btn" id="lt-cancel-btn">Cancel</button>'+
    '</div>';
  setTimeout(function(){
    var dz=document.getElementById('lt-dz');
    var fi=document.getElementById('lt-file');
    var cb=document.getElementById('lt-cancel-btn');
    if(dz&&fi){
      dz.onclick=function(){fi.click();};
      fi.onchange=function(e){ltPreviewFile(e);};
    }
    if(cb){cb.onclick=function(){closeModal('modal-lt-upload');};}
  },30);
  openModal('modal-lt-upload');
}


let _ltParsed=null;
function ltPreviewFile(evt){
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      _ltParsed={};
      wb.SheetNames.forEach(function(name){
        const ws=wb.Sheets[name];
        // Use raw:true to get actual values; defval:'' so empty cells are '' not null
        const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:false});
        if(!raw.length){_ltParsed[name]={headerRows:[],rows:[],timestamps:{}};return;}

        // Helper: is a whole row effectively blank? (all cells null/empty)
        const _rowBlank=function(r){
          return !r||!r.some(function(c){return c!=null&&String(c).trim()!=='';});
        };
        // Helper: does a row contain the given text in any cell? (case-insensitive substring)
        const _rowHas=function(r,txt){
          if(!r)return false;
          const t=txt.toLowerCase();
          return r.some(function(c){return c!=null&&String(c).trim().toLowerCase().indexOf(t)!==-1;});
        };

        // ── Step 1: Skip leading "Sharepoint" link row(s) AND leading blank rows ──
        // Some sheets (Lazada, Shopee, TikTok) begin with a "Sharepoint" link row and/or one or
        // more blank/title/banner rows before the real column headers. Shopee often has the header
        // on the very first row (so the old code worked), but Lazada/TikTok tabs frequently carry a
        // blank or merged banner row first, which left headerRows[0] empty → "No data" even though
        // the sheet had content. Advance scanStart past any leading blank rows and any Sharepoint row.
        let scanStart=0;
        while(scanStart<raw.length&&(_rowBlank(raw[scanStart])
              ||(raw[scanStart]&&raw[scanStart][0]!=null&&String(raw[scanStart][0]).trim().toLowerCase()==='sharepoint'))){
          scanStart++;
        }
        if(scanStart>=raw.length)scanStart=0; // all-blank guard

        // ── Step 2: Find where data rows begin ──
        // Primary: first row (after scanStart) whose col[0] is a known 2-letter region code.
        // Everything from scanStart up to (but not including) that row is header rows.
        // Widen the scan window (some sheets have several header/sub-header rows) and add a
        // fallback that locates the header row by its labels when no region code is found.
        const REGIONS=['MY','SG','PH','VN','TH','ID','EP','AU','JP','KR','CN','IN','HK','TW'];
        let dataStartIdx=-1;
        for(let ri=scanStart;ri<Math.min(raw.length,40);ri++){
          const r=raw[ri];
          const v=r&&r[0]!=null?String(r[0]).trim():'';
          // Region code: exactly 2 uppercase letters in the whitelist
          if(v&&/^[A-Z]{2}$/.test(v)&&REGIONS.includes(v)){
            dataStartIdx=ri;
            break;
          }
        }
        // Fallback: no region code found. Find the last header-looking row (contains "Region",
        // "Platform", "Brand", or a date-range/report label) and treat the row after it as data.
        if(dataStartIdx===-1){
          let lastHeaderRow=scanStart;
          for(let ri=scanStart;ri<Math.min(raw.length,40);ri++){
            const r=raw[ri];
            if(_rowBlank(r))continue;
            if(_rowHas(r,'region')||_rowHas(r,'platform')||_rowHas(r,'brand')
               ||_rowHas(r,'transaction')||_rowHas(r,'income')||_rowHas(r,'payment report')
               ||_rowHas(r,'order report')||_rowHas(r,'withdrawal')){
              lastHeaderRow=ri;
            }
          }
          dataStartIdx=lastHeaderRow+1;
        }
        // Guard: must have at least one header row after scanStart
        if(dataStartIdx<=scanStart)dataStartIdx=scanStart+1;

        // ── Step 3: Slice header rows (skip Sharepoint row entirely) and data rows ──
        // headerRows = rows from scanStart to dataStartIdx (the actual column headers)
        let headerRows=raw.slice(scanStart,dataStartIdx);
        // Defensively drop any leading fully-blank header rows so headerRows[0] always carries
        // the real column labels (an empty headerRows[0] is what triggered the "No data" state
        // for Lazada/TikTok tabs whose first row was blank).
        while(headerRows.length>1&&_rowBlank(headerRows[0]))headerRows.shift();
        // data rows = from dataStartIdx onward, filtered to non-blank leading cell
        const rows=raw.slice(dataStartIdx).filter(function(r){
          return r&&r[0]!=null&&String(r[0]).trim()!=='';
        });

        // ── Step 4: Preserve multiline content in header cells ──
        // SheetJS reads \n characters correctly, but we normalize them for display
        const cleanHeaderRows=headerRows.map(function(hr){
          return (hr||[]).map(function(cell){
            if(cell==null)return null;
            return String(cell);
          });
        });

        // Also store row0/row1 aliases for AO tracker compatibility
        _ltParsed[name]={
          headerRows:cleanHeaderRows,
          row0:cleanHeaderRows[0]||[],
          row1:cleanHeaderRows[1]||[],
          rows:rows,
          timestamps:{}
        };
      });
      const prev=document.getElementById('lt-preview');
      if(prev)prev.innerHTML='<div style="background:var(--green-light);border:1px solid var(--green-mid);border-radius:var(--radius);padding:10px 14px;font-size:13px;color:var(--green)">&#10003; Ready: '+wb.SheetNames.length+' sheet(s) — '+wb.SheetNames.join(', ')+'</div>';
      const btn=document.getElementById('lt-save-btn');
      if(btn)btn.style.display='';
    }catch(err){
      const prev=document.getElementById('lt-preview');
      if(prev)prev.innerHTML='<div style="color:var(--red);font-size:13px">Error: '+err.message+'</div>';
    }
  };
  reader.readAsBinaryString(file);
}

async function ltSave(){
  const nameEl=document.getElementById('lt-name');
  const name=nameEl?nameEl.value.trim():'';
  if(!name){toast('Tracker name required');return;}
  if(!_ltParsed){toast('Please upload a file first');return;}
  const catEl=document.getElementById('lt-cat');
  const cat=catEl?catEl.value:'Other';
  try{
    const isAO=cat==='AO Tracker';
    const isFR=cat==='Finance';
    const key=await fbPush('trackers',{name:name,category:cat,sheets:_ltParsed,uploadedAt:Date.now(),uploadedBy:CU.name,aoLinked:isAO,frLinked:isFR});
    if(isAO){
      const allKeys=Object.keys(D.trackers||{});
      for(const k of allKeys){if(k!==key)await fbUpd('trackers/'+k,{aoLinked:false});}
    }
    if(isFR){
      const allKeys=Object.keys(D.trackers||{});
      for(const k of allKeys){if(k!==key)await fbUpd('trackers/'+k,{frLinked:false});}
      await frLinkTasks();
    }
    _ltParsed=null;_activeTracker=key;_activeTrackerSheet=null;
    closeModal('modal-lt-upload');
    toast('Tracker "'+name+'" saved!'+(isAO?' & linked to AO Dashboard':isFR?' & linked to Finance Report tasks':''));
  }catch(e){toast('Error saving: '+e.message);}
}

async function frLinkTasks(){
  // Mark finance report tasks (ids 5=Lazada, 6=Shopee, 7=TikTok) as frLinked
  const platMap={'5':'Lazada','6':'Shopee','7':'TikTok'};
  const existing=await fbGet('tasks')||{};
  for(const[fbKey,t]of Object.entries(existing)){
    if(t&&platMap[String(t.id)]){
      await fbUpd('tasks/'+fbKey,{frLinked:true,frPlatform:platMap[String(t.id)]});
    }
  }
}

async function frLinkTracker(key){
  const allKeys=Object.keys(D.trackers||{});
  for(const k of allKeys){await fbUpd('trackers/'+k,{frLinked:k===key});}
  await frLinkTasks();
  toast('Finance tracker linked to Finance Report tasks!');
}

async function ltLinkDash(key){
  // First unlink all trackers, then link the selected one
  const allKeys=Object.keys(D.trackers||{});
  for(const k of allKeys){
    await fbUpd('trackers/'+k,{aoLinked:k===key});
  }
  toast('Linked to Dashboard AO widget!');
}
async function ltDelete(key){
  if(!confirm('Delete this tracker? Cannot be undone.'))return;
  await fbDel(`trackers/${key}`);
  if(_activeTracker===key){_activeTracker=null;_activeTrackerSheet=null;}
  toast('Tracker deleted');
}
function ltExport(key){
  const t=D.trackers[key];if(!t)return;
  const wb=XLSX.utils.book_new();
  Object.entries(t.sheets||{}).forEach(([name,sh])=>{
    const data=[];
    // Use headerRows if available, fallback to row0/row1
    if(sh.headerRows&&sh.headerRows.length){sh.headerRows.forEach(r=>data.push(r||[]));}
    else{if(sh.row0)data.push(sh.row0);if(sh.row1)data.push(sh.row1);}
    (sh.rows||[]).forEach(r=>data.push(r||[]));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),name);
  });
  XLSX.writeFile(wb,`${t.name}_${ds(now())}.xlsx`);toast('Exported!');
}

// AO completion from linked tracker - Order and Product separately
// date param: if omitted, defaults to today (live tracker view); pass viewDate for dashboard accuracy
function getAOCompletionForDashboard(date){
  // Future dates have no inputs — always 0%
  if(date>ds(now())) return null;
  // Use live D.trackers so local edits from ltUpdateCell are reflected immediately
  const linkedEntry=Object.entries(D.trackers||{}).find(function(e){return e[1]&&e[1].aoLinked;});
  if(!linkedEntry)return null;
  const linked=linkedEntry[1];
  const today=date||ds(now());
  const AO_R=[{key:'MY'},{key:'SG'},{key:'TH'},{key:'VN'}];
  const results={};
  AO_R.forEach(function(r){
    const sh=linked.sheets&&linked.sheets[r.key];
    if(!sh){results[r.key]={order:{done:0,total:0,pct:0},product:{done:0,total:0,pct:0}};return;}
    const row0=sh.row0||[];
    const row1=sh.row1||[];
    // Use aoFindDateCols so both Excel-header and virtual-column (partial/absent headers) work correctly
    const cols=aoFindDateCols(row0,today,row1);
    const orderCols=cols.length?[cols[0]]:[];
    const productCols=cols.length>1?[cols[1]]:[];
    if(!orderCols.length){results[r.key]={order:{done:0,total:0,pct:0},product:{done:0,total:0,pct:0}};return;}
    // Build data rows, merging live local row data over the original sheet rows
    const baseRows=sh.rows||[];
    const liveSheet=(D.trackers[linkedEntry[0]]||{}).sheets;
    const _liveSheetObj=liveSheet&&liveSheet[r.key]?liveSheet[r.key]:sh;
    const liveRows=_liveSheetObj&&_liveSheetObj.rows?_liveSheetObj.rows:baseRows;
    // Exited / Inactive brands are hidden from the tracker and never receive inputs, so they must
    // NOT count toward the completion denominator — otherwise a fully-filled region can never reach
    // 100%. Their status lives in aoMeta, keyed by the row's true array index.
    const _aoMeta=_liveSheetObj&&_liveSheetObj.aoMeta?_liveSheetObj.aoMeta:{};
    function _aoRowActive(ri){
      const m=_aoMeta[ri];
      const st=m&&m.status?String(m.status).trim().toLowerCase():'';
      return st!=='exited'&&st!=='inactive';
    }
    const dataRows=liveRows.filter(function(row,ri){
      if(!(row&&row[0]!=null&&String(row[0]).trim()&&String(row[0]).toUpperCase()!=='TOTAL'))return false;
      return _aoRowActive(ri);
    });
    const total=dataRows.length;
    if(!total){results[r.key]={order:{done:0,total:0,pct:0},product:{done:0,total:0,pct:0}};return;}
    function isFilledVal(v){return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v).toUpperCase()!=='OFF';}
    function countFilled(colArr){
      return dataRows.filter(function(row){return colArr.some(function(ci){return isFilledVal(row[ci]);});}).length;
    }
    function colTotal(colArr){
      var s=0;
      dataRows.forEach(function(row){colArr.forEach(function(ci){var v=row[ci];if(!isFilledVal(v))return;var n=parseFloat(v);if(!isNaN(n))s+=n;});});
      return s;
    }
    const orderDone=countFilled(orderCols);
    const productDone=countFilled(productCols);
    const orderSum=colTotal(orderCols);
    const productSum=colTotal(productCols);
    results[r.key]={
      order:{done:orderDone,total:total,pct:total?Math.round(orderDone/total*100):0,sum:orderSum},
      product:{done:productDone,total:total,pct:total?Math.round(productDone/total*100):0,sum:productSum}
    };
  });
  return results;
}

// ── FINANCE REPORT TRACKER ──
// Platform → due day of week (2=Tue for Lazada, 4=Thu for Shopee/TikTok)
const FR_DOW={Lazada:2,Shopee:4,TikTok:4};

// Platform → how many weeks behind the report is (negative = look back N weeks)
// Lazada is 1 week behind by default. Configurable by admin via frConfig/weekOffsets in Firebase.
// NOTE: the actual declaration lives near the top of the file (search "FR_WEEK_OFFSET declared early")
// so it can't hit a temporal-dead-zone error when Finance render helpers reference it before this point.

// Load FR config from Firebase on init
function loadFRConfig(){
  fbListen('frConfig',function(v){
    if(v&&v.weekOffsets){
      Object.assign(FR_WEEK_OFFSET,v.weekOffsets);
    }
    // Re-render affected pages
    if(_curPage==='live-trackers')renderLiveTrackers();
    if(_curPage==='dashboard')renderDashboard();
    if(_curPage==='my-tasks')renderMyTasks();
  });
}

async function saveFRWeekOffset(platform,offset){
  if(!CU.isAdmin){toast('Admin only.');return;}
  FR_WEEK_OFFSET[platform]=parseInt(offset)||0;
  await fbSet('frConfig/weekOffsets/'+platform,parseInt(offset)||0);
  toast('Week offset for '+platform+' updated.');
  renderLiveTrackers();
  renderDashboard();
}

// Fixed column labels — use actual header from Excel, fallback to these platform-specific defaults
const FR_DEFAULT_FIXED=['Region','Platform','Account Status','Synagie Merchant ID','Brand / Store Name','Exec','Team Lead'];
const FR_PLATFORM_FIXED_DEFAULTS={
  'Lazada':['Region','Platform','Account Status','Synagie Merchant ID','Brand / Store Name','Exec','Team Lead'],
  'Shopee':['Region','Platform','Account Status','Synagie Merchant ID','Brand / Store Name','Exec','Team Lead'],
  'TikTok':['Region','Platform','Account Status','Synagie Merchant ID','Brand / Store Name','Exec','Team Lead'],
};

// Return the effective "reference date" for a platform, applying its week offset
function frEffectiveDate(platform){
  const offset=FR_WEEK_OFFSET[platform]||0;
  const d=new Date(now());
  d.setDate(d.getDate()+(offset*7));
  return d;
}

// ── Hardcoded column header map from Finance_Platform_Reports_2026.xlsx ──
// Key: raw header text (trimmed). Value: { shortLabel, rows[] }
// Covers Lazada, Shopee, TikTok, and Miravia tabs exactly as defined in the Excel.
const FR_HEADER_MAP = {
  // ── LAZADA ──
  'Transaction:  29 Jun - 05 Jul  Withdrawal:  06 Jul Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'29 Jun–05 Jul', rows:[{l:'Transaction',v:'29 Jun – 05 Jul'},{l:'Withdrawal',v:'06 Jul'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 06 Jul - 12 Jul Withdrawal: 13 Jul Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'06–12 Jul', rows:[{l:'Transaction',v:'06 Jul – 12 Jul'},{l:'Withdrawal',v:'13 Jul'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 13 Jul - 19 Jul Withdrawal: 20 Jul Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'13–19 Jul', rows:[{l:'Transaction',v:'13 Jul – 19 Jul'},{l:'Withdrawal',v:'20 Jul'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 20 Jul - 26 Jul Withdrawal: 27 Jul Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'20–26 Jul', rows:[{l:'Transaction',v:'20 Jul – 26 Jul'},{l:'Withdrawal',v:'27 Jul'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 27 Jul - 02 Aug Withdrawal: 03 Aug Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'27 Jul–02 Aug', rows:[{l:'Transaction',v:'27 Jul – 02 Aug'},{l:'Withdrawal',v:'03 Aug'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  July  01 - 31  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Jul 01–31 (Monthly)', rows:[{l:'Monthly Report',v:'Jul 01 - 31'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },
  'Transaction: 03 Aug - 09 Aug Withdrawal: 10 Aug Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'03–09 Aug', rows:[{l:'Transaction',v:'03 Aug – 09 Aug'},{l:'Withdrawal',v:'10 Aug'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 10 Aug - 16 Aug Withdrawal: 17 Aug Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'10–16 Aug', rows:[{l:'Transaction',v:'10 Aug – 16 Aug'},{l:'Withdrawal',v:'17 Aug'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 17 Aug - 23 Aug Withdrawal: 24 Aug Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'17–23 Aug', rows:[{l:'Transaction',v:'17 Aug – 23 Aug'},{l:'Withdrawal',v:'24 Aug'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 24 Aug - 30 Aug Withdrawal: 31 Aug Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'24–30 Aug', rows:[{l:'Transaction',v:'24 Aug – 30 Aug'},{l:'Withdrawal',v:'31 Aug'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 31 Aug - 06 Sep Withdrawal: 07 Sep Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'31 Aug–06 Sep', rows:[{l:'Transaction',v:'31 Aug – 06 Sep'},{l:'Withdrawal',v:'07 Sep'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  Aug 01 - 31  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Aug 01–31 (Monthly)', rows:[{l:'Monthly Report',v:'Aug 01 - 31'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },
  'Transaction: 07 Sep - 13 Sep Withdrawal: 14 Sep Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'07–13 Sep', rows:[{l:'Transaction',v:'07 Sep – 13 Sep'},{l:'Withdrawal',v:'14 Sep'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 14 Sep - 20 Sep Withdrawal: 21 Sep Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'14–20 Sep', rows:[{l:'Transaction',v:'14 Sep – 20 Sep'},{l:'Withdrawal',v:'21 Sep'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 21 Sep - 27 Sep Withdrawal: 28 Sep Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'21–27 Sep', rows:[{l:'Transaction',v:'21 Sep – 27 Sep'},{l:'Withdrawal',v:'28 Sep'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 28 Sep - 04 Oct Withdrawal: 05 Oct Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'28 Sep–04 Oct', rows:[{l:'Transaction',v:'28 Sep – 04 Oct'},{l:'Withdrawal',v:'05 Oct'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  Sept 01 - 30  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Sep 01–30 (Monthly)', rows:[{l:'Monthly Report',v:'Sep 01 - 30'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },
  'Transaction: 05 Oct - 11 Oct Withdrawal: 12 Oct Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'05–11 Oct', rows:[{l:'Transaction',v:'05 Oct – 11 Oct'},{l:'Withdrawal',v:'12 Oct'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 12 Oct - 18 Oct Withdrawal: 19 Oct Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'12–18 Oct', rows:[{l:'Transaction',v:'12 Oct – 18 Oct'},{l:'Withdrawal',v:'19 Oct'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 19 Oct - 25 Oct Withdrawal: 26 Oct Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'19–25 Oct', rows:[{l:'Transaction',v:'19 Oct – 25 Oct'},{l:'Withdrawal',v:'26 Oct'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 26 Oct - 01 Nov Withdrawal: 02 Nov Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'26 Oct–01 Nov', rows:[{l:'Transaction',v:'26 Oct – 01 Nov'},{l:'Withdrawal',v:'02 Nov'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  Oct 01 - 31  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Oct 01–31 (Monthly)', rows:[{l:'Monthly Report',v:'Oct 01 - 31'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },
  'Transaction: 02 Nov - 08 Nov Withdrawal: 09 Nov Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'02–08 Nov', rows:[{l:'Transaction',v:'02 Nov – 08 Nov'},{l:'Withdrawal',v:'09 Nov'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 09 Nov - 15 Nov Withdrawal: 16 Nov Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'09–15 Nov', rows:[{l:'Transaction',v:'09 Nov – 15 Nov'},{l:'Withdrawal',v:'16 Nov'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 16 Nov - 22 Nov Withdrawal: 23 Nov Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'16–22 Nov', rows:[{l:'Transaction',v:'16 Nov – 22 Nov'},{l:'Withdrawal',v:'23 Nov'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 23 Nov - 29 Nov Withdrawal: 30 Nov Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'23–29 Nov', rows:[{l:'Transaction',v:'23 Nov – 29 Nov'},{l:'Withdrawal',v:'30 Nov'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 30 Nov - 06 Dec Withdrawal: 07 Dec Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'30 Nov–06 Dec', rows:[{l:'Transaction',v:'30 Nov – 06 Dec'},{l:'Withdrawal',v:'07 Dec'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  Nov 01 - 30  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Nov 01–30 (Monthly)', rows:[{l:'Monthly Report',v:'Nov 01 - 30'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },
  'Transaction: 07 Dec - 13 Dec Withdrawal: 14 Dec Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'07–13 Dec', rows:[{l:'Transaction',v:'07 Dec – 13 Dec'},{l:'Withdrawal',v:'14 Dec'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 14 Dec - 20 Dec Withdrawal: 21 Dec Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'14–20 Dec', rows:[{l:'Transaction',v:'14 Dec – 20 Dec'},{l:'Withdrawal',v:'21 Dec'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 21 Dec - 27 Dec Withdrawal: 28 Dec Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'21–27 Dec', rows:[{l:'Transaction',v:'21 Dec – 27 Dec'},{l:'Withdrawal',v:'28 Dec'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Transaction: 28 Dec - 03 Jan Withdrawal: 04 Jan Withdrawal - Screenshots  MY, SG, PH, ID, TH, VN':
    { shortLabel:'28 Dec–03 Jan', rows:[{l:'Transaction',v:'28 Dec – 03 Jan'},{l:'Withdrawal',v:'04 Jan'},{l:'Withdrawal - Screenshots',v:''},{l:'Regions',v:'MY, SG, PH, ID, TH, VN'}] },
  'Monthly Report  Dec 01 - 31  Transaction Report  MY Withdrawal Report  SG Withdrawal Report  Withdrawal - Screenshots':
    { shortLabel:'Dec 01–31 (Monthly)', rows:[{l:'Monthly Report',v:'Dec 01 - 31'},{l:'Transaction Report',v:'MY'},{l:'Withdrawal Report',v:'SG'},{l:'Withdrawal - Screenshots',v:''}] },

  // ── SHOPEE ──
  'Income: 01 Jul - 07 Jul  SW: 02 Jul - 08 Jul  Order Report: 02 Jul - 08 Jul  SW - Screenshots':
    { shortLabel:'01–07 Jul', rows:[{l:'Income',v:'01 Jul – 07 Jul'},{l:'SW',v:'02 Jul – 08 Jul'},{l:'Order Report',v:'02 Jul – 08 Jul'},{l:'SW - Screenshots',v:''}] },
  'Income: 08 Jul - 14 Jul  SW: 09 Jul - 15 Jul  Order Report: 09 Jul - 15 Jul  SW - Screenshots':
    { shortLabel:'08–14 Jul', rows:[{l:'Income',v:'08 Jul – 14 Jul'},{l:'SW',v:'09 Jul – 15 Jul'},{l:'Order Report',v:'09 Jul – 15 Jul'},{l:'SW - Screenshots',v:''}] },
  'Income: 15 Jul - 21 Jul  SW: 16 Jul - 22 Jul  Order Report: 16 Jul - 22 Jul  SW - Screenshots':
    { shortLabel:'15–21 Jul', rows:[{l:'Income',v:'15 Jul – 21 Jul'},{l:'SW',v:'16 Jul – 22 Jul'},{l:'Order Report',v:'16 Jul – 22 Jul'},{l:'SW - Screenshots',v:''}] },
  'Income: 22 Jul - 28 Jul  SW: 23 Jul - 29 Jul  Order Report: 23 Jul - 29 Jul  SW - Screenshots':
    { shortLabel:'22–28 Jul', rows:[{l:'Income',v:'22 Jul – 28 Jul'},{l:'SW',v:'23 Jul – 29 Jul'},{l:'Order Report',v:'23 Jul – 29 Jul'},{l:'SW - Screenshots',v:''}] },
  'Income: 29 Jul - 04 Aug  SW: 30 Jul - 05 Aug  Order Report: 30 Jul - 05 Aug  SW - Screenshots':
    { shortLabel:'29 Jul–04 Aug', rows:[{l:'Income',v:'29 Jul – 04 Aug'},{l:'SW',v:'30 Jul – 05 Aug'},{l:'Order Report',v:'30 Jul – 05 Aug'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: July 01 - 31  SW: July 01 - 31  Order Report: July 01 - 31  SW - Screenshots':
    { shortLabel:'Jul 01–31 (Monthly)', rows:[{l:'Monthly Income',v:'Jul 01 - 31'},{l:'SW',v:'Jul 01 - 31'},{l:'Order Report',v:'Jul 01 - 31'},{l:'SW - Screenshots',v:''}] },
  'Income: 05 Aug - 11 Aug  SW: 06 Aug - 12 Aug  Order Report: 06 Aug - 12 Aug  SW - Screenshots':
    { shortLabel:'05–11 Aug', rows:[{l:'Income',v:'05 Aug – 11 Aug'},{l:'SW',v:'06 Aug – 12 Aug'},{l:'Order Report',v:'06 Aug – 12 Aug'},{l:'SW - Screenshots',v:''}] },
  'Income: 12 Aug - 18 Aug  SW: 13 Aug - 19 Aug  Order Report: 13 Aug - 19 Aug  SW - Screenshots':
    { shortLabel:'12–18 Aug', rows:[{l:'Income',v:'12 Aug – 18 Aug'},{l:'SW',v:'13 Aug – 19 Aug'},{l:'Order Report',v:'13 Aug – 19 Aug'},{l:'SW - Screenshots',v:''}] },
  'Income: 19 Aug - 25 Aug  SW: 20 Aug - 26 Aug  Order Report: 20 Aug - 26 Aug  SW - Screenshots':
    { shortLabel:'19–25 Aug', rows:[{l:'Income',v:'19 Aug – 25 Aug'},{l:'SW',v:'20 Aug – 26 Aug'},{l:'Order Report',v:'20 Aug – 26 Aug'},{l:'SW - Screenshots',v:''}] },
  'Income: 26 Aug - 01 Sep  SW: 27 Aug - 02 Sep  Order Report: 27 Aug - 02 Sep  SW - Screenshots':
    { shortLabel:'26 Aug–01 Sep', rows:[{l:'Income',v:'26 Aug – 01 Sep'},{l:'SW',v:'27 Aug – 02 Sep'},{l:'Order Report',v:'27 Aug – 02 Sep'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: Aug 01 - 31  SW: Aug 01 - 31  Order Report: Aug 01 - 31  SW - Screenshots':
    { shortLabel:'Aug 01–31 (Monthly)', rows:[{l:'Monthly Income',v:'Aug 01 - 31'},{l:'SW',v:'Aug 01 - 31'},{l:'Order Report',v:'Aug 01 - 31'},{l:'SW - Screenshots',v:''}] },
  'Income: 02 Sep - 08 Sep  SW: 03 Sep - 09 Sep  Order Report: 03 Sep - 09 Sep  SW - Screenshots':
    { shortLabel:'02–08 Sep', rows:[{l:'Income',v:'02 Sep – 08 Sep'},{l:'SW',v:'03 Sep – 09 Sep'},{l:'Order Report',v:'03 Sep – 09 Sep'},{l:'SW - Screenshots',v:''}] },
  'Income: 09 Sep - 15 Sep  SW: 10 Sep - 16 Sep  Order Report: 10 Sep - 16 Sep  SW - Screenshots':
    { shortLabel:'09–15 Sep', rows:[{l:'Income',v:'09 Sep – 15 Sep'},{l:'SW',v:'10 Sep – 16 Sep'},{l:'Order Report',v:'10 Sep – 16 Sep'},{l:'SW - Screenshots',v:''}] },
  'Income: 16 Sep - 22 Sep  SW: 17 Sep - 23 Sep  Order Report: 17 Sep - 23 Sep  SW - Screenshots':
    { shortLabel:'16–22 Sep', rows:[{l:'Income',v:'16 Sep – 22 Sep'},{l:'SW',v:'17 Sep – 23 Sep'},{l:'Order Report',v:'17 Sep – 23 Sep'},{l:'SW - Screenshots',v:''}] },
  'Income: 23 Sep - 29 Sep  SW: 24 Sep - 30 Sep  Order Report: 24 Sep - 30 Sep  SW - Screenshots':
    { shortLabel:'23–29 Sep', rows:[{l:'Income',v:'23 Sep – 29 Sep'},{l:'SW',v:'24 Sep – 30 Sep'},{l:'Order Report',v:'24 Sep – 30 Sep'},{l:'SW - Screenshots',v:''}] },
  'Income: 30 Sep - 06 Oct  SW: 01 Oct - 07 Oct  Order Report: 01 Oct - 07 Oct  SW - Screenshots':
    { shortLabel:'30 Sep–06 Oct', rows:[{l:'Income',v:'30 Sep – 06 Oct'},{l:'SW',v:'01 Oct – 07 Oct'},{l:'Order Report',v:'01 Oct – 07 Oct'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: Sept 01 - 30  SW: Sept 01 - 30  Order Report: Sept 01 - 30  SW - Screenshots':
    { shortLabel:'Sep 01–30 (Monthly)', rows:[{l:'Monthly Income',v:'Sep 01 - 30'},{l:'SW',v:'Sep 01 - 30'},{l:'Order Report',v:'Sep 01 - 30'},{l:'SW - Screenshots',v:''}] },
  'Income: 07 Oct - 13 Oct  SW: 08 Oct - 14 Oct  Order Report: 08 Oct - 14 Oct  SW - Screenshots':
    { shortLabel:'07–13 Oct', rows:[{l:'Income',v:'07 Oct – 13 Oct'},{l:'SW',v:'08 Oct – 14 Oct'},{l:'Order Report',v:'08 Oct – 14 Oct'},{l:'SW - Screenshots',v:''}] },
  'Income: 14 Oct - 20 Oct  SW: 15 Oct - 21 Oct  Order Report: 15 Oct - 21 Oct  SW - Screenshots':
    { shortLabel:'14–20 Oct', rows:[{l:'Income',v:'14 Oct – 20 Oct'},{l:'SW',v:'15 Oct – 21 Oct'},{l:'Order Report',v:'15 Oct – 21 Oct'},{l:'SW - Screenshots',v:''}] },
  'Income: 21 Oct - 27 Oct  SW: 22 Oct - 28 Oct  Order Report: 22 Oct - 28 Oct  SW - Screenshots':
    { shortLabel:'21–27 Oct', rows:[{l:'Income',v:'21 Oct – 27 Oct'},{l:'SW',v:'22 Oct – 28 Oct'},{l:'Order Report',v:'22 Oct – 28 Oct'},{l:'SW - Screenshots',v:''}] },
  'Income: 28 Oct - 03 Nov  SW: 29 Oct - 04 Nov  Order Report: 29 Oct - 04 Nov  SW - Screenshots':
    { shortLabel:'28 Oct–03 Nov', rows:[{l:'Income',v:'28 Oct – 03 Nov'},{l:'SW',v:'29 Oct – 04 Nov'},{l:'Order Report',v:'29 Oct – 04 Nov'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: Oct 01 - 31  SW: Oct 01 - 31  Order Report: Oct 01 - 31  SW - Screenshots':
    { shortLabel:'Oct 01–31 (Monthly)', rows:[{l:'Monthly Income',v:'Oct 01 - 31'},{l:'SW',v:'Oct 01 - 31'},{l:'Order Report',v:'Oct 01 - 31'},{l:'SW - Screenshots',v:''}] },
  'Income: 04 Nov - 10 Nov  SW: 05 Nov - 11 Nov  Order Report: 05 Nov - 11 Nov  SW - Screenshots':
    { shortLabel:'04–10 Nov', rows:[{l:'Income',v:'04 Nov – 10 Nov'},{l:'SW',v:'05 Nov – 11 Nov'},{l:'Order Report',v:'05 Nov – 11 Nov'},{l:'SW - Screenshots',v:''}] },
  'Income: 11 Nov - 17 Nov  SW: 12 Nov - 18 Nov  Order Report: 12 Nov - 18 Nov  SW - Screenshots':
    { shortLabel:'11–17 Nov', rows:[{l:'Income',v:'11 Nov – 17 Nov'},{l:'SW',v:'12 Nov – 18 Nov'},{l:'Order Report',v:'12 Nov – 18 Nov'},{l:'SW - Screenshots',v:''}] },
  'Income: 18 Nov - 24 Nov  SW: 19 Nov - 25 Nov  Order Report: 19 Nov - 25 Nov  SW - Screenshots':
    { shortLabel:'18–24 Nov', rows:[{l:'Income',v:'18 Nov – 24 Nov'},{l:'SW',v:'19 Nov – 25 Nov'},{l:'Order Report',v:'19 Nov – 25 Nov'},{l:'SW - Screenshots',v:''}] },
  'Income: 25 Nov - 01 Dec  SW: 26 Nov - 02 Dec  Order Report: 26 Nov - 02 Dec  SW - Screenshots':
    { shortLabel:'25 Nov–01 Dec', rows:[{l:'Income',v:'25 Nov – 01 Dec'},{l:'SW',v:'26 Nov – 02 Dec'},{l:'Order Report',v:'26 Nov – 02 Dec'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: Nov 01 - 30  SW: Nov 01 - 30  Order Report: Nov 01 - 30  SW - Screenshots':
    { shortLabel:'Nov 01–30 (Monthly)', rows:[{l:'Monthly Income',v:'Nov 01 - 30'},{l:'SW',v:'Nov 01 - 30'},{l:'Order Report',v:'Nov 01 - 30'},{l:'SW - Screenshots',v:''}] },
  'Income: 02 Dec - 08 Dec  SW: 03 Dec - 09 Dec  Order Report: 03 Dec - 09 Dec  SW - Screenshots':
    { shortLabel:'02–08 Dec', rows:[{l:'Income',v:'02 Dec – 08 Dec'},{l:'SW',v:'03 Dec – 09 Dec'},{l:'Order Report',v:'03 Dec – 09 Dec'},{l:'SW - Screenshots',v:''}] },
  'Income: 09 Dec - 15 Dec  SW: 10 Dec - 16 Dec  Order Report: 10 Dec - 16 Dec  SW - Screenshots':
    { shortLabel:'09–15 Dec', rows:[{l:'Income',v:'09 Dec – 15 Dec'},{l:'SW',v:'10 Dec – 16 Dec'},{l:'Order Report',v:'10 Dec – 16 Dec'},{l:'SW - Screenshots',v:''}] },
  'Income: 16 Dec - 22 Dec  SW: 17 Dec - 23 Dec  Order Report: 17 Dec - 23 Dec  SW - Screenshots':
    { shortLabel:'16–22 Dec', rows:[{l:'Income',v:'16 Dec – 22 Dec'},{l:'SW',v:'17 Dec – 23 Dec'},{l:'Order Report',v:'17 Dec – 23 Dec'},{l:'SW - Screenshots',v:''}] },
  'Income: 23 Dec - 29 Dec  SW: 24 Dec - 30 Dec  Order Report: 24 Dec - 30 Dec  SW - Screenshots':
    { shortLabel:'23–29 Dec', rows:[{l:'Income',v:'23 Dec – 29 Dec'},{l:'SW',v:'24 Dec – 30 Dec'},{l:'Order Report',v:'24 Dec – 30 Dec'},{l:'SW - Screenshots',v:''}] },
  'Income: 30 Dec - 05 Jan  SW: 31 Dec - 06 Jan  Order Report: 31 Dec - 06 Jan  SW - Screenshots':
    { shortLabel:'30 Dec–05 Jan', rows:[{l:'Income',v:'30 Dec – 05 Jan'},{l:'SW',v:'31 Dec – 06 Jan'},{l:'Order Report',v:'31 Dec – 06 Jan'},{l:'SW - Screenshots',v:''}] },
  'Monthly Income: Dec 01 - 31  SW: Dec 01 - 31  Order Report: Dec 01 - 31  SW - Screenshots':
    { shortLabel:'Dec 01–31 (Monthly)', rows:[{l:'Monthly Income',v:'Dec 01 - 31'},{l:'SW',v:'Dec 01 - 31'},{l:'Order Report',v:'Dec 01 - 31'},{l:'SW - Screenshots',v:''}] },

  // ── TIKTOK ──
  'Payment Report: 02 Jul - 08 Jul  Order Report: 02 Jul - 08 Jul  Payment Report - Screenshots':
    { shortLabel:'02–08 Jul', rows:[{l:'Payment Report',v:'02 Jul – 08 Jul'},{l:'Order Report',v:'02 Jul – 08 Jul'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 09 Jul - 15 Jul  Order Report: 09 Jul - 15 Jul  Payment Report - Screenshots':
    { shortLabel:'09–15 Jul', rows:[{l:'Payment Report',v:'09 Jul – 15 Jul'},{l:'Order Report',v:'09 Jul – 15 Jul'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 16 Jul - 22 Jul  Order Report: 16 Jul - 22 Jul  Payment Report - Screenshots':
    { shortLabel:'16–22 Jul', rows:[{l:'Payment Report',v:'16 Jul – 22 Jul'},{l:'Order Report',v:'16 Jul – 22 Jul'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 23 Jul - 29 Jul  Order Report: 23 Jul - 29 Jul  Payment Report - Screenshots':
    { shortLabel:'23–29 Jul', rows:[{l:'Payment Report',v:'23 Jul – 29 Jul'},{l:'Order Report',v:'23 Jul – 29 Jul'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 30 Jul - 05 Aug  Order Report: 30 Jul - 05 Aug  Payment Report - Screenshots':
    { shortLabel:'30 Jul–05 Aug', rows:[{l:'Payment Report',v:'30 Jul – 05 Aug'},{l:'Order Report',v:'30 Jul – 05 Aug'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: July 01 - 31  Order Report: July 01 - 31  Payment Report - Screenshots':
    { shortLabel:'Jul 01–31 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Jul 01 - 31'},{l:'Order Report',v:'Jul 01 - 31'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 06 Aug - 12 Aug  Order Report: 06 Aug - 12 Aug  Payment Report - Screenshots':
    { shortLabel:'06–12 Aug', rows:[{l:'Payment Report',v:'06 Aug – 12 Aug'},{l:'Order Report',v:'06 Aug – 12 Aug'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 13 Aug - 19 Aug  Order Report: 13 Aug - 19 Aug  Payment Report - Screenshots':
    { shortLabel:'13–19 Aug', rows:[{l:'Payment Report',v:'13 Aug – 19 Aug'},{l:'Order Report',v:'13 Aug – 19 Aug'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 20 Aug - 26 Aug  Order Report: 20 Aug - 26 Aug  Payment Report - Screenshots':
    { shortLabel:'20–26 Aug', rows:[{l:'Payment Report',v:'20 Aug – 26 Aug'},{l:'Order Report',v:'20 Aug – 26 Aug'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 27 Aug - 02 Sep  Order Report: 27 Aug - 02 Sep  Payment Report - Screenshots':
    { shortLabel:'27 Aug–02 Sep', rows:[{l:'Payment Report',v:'27 Aug – 02 Sep'},{l:'Order Report',v:'27 Aug – 02 Sep'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: Aug 01 - 31  Order Report: Aug 01 - 31  Payment Report - Screenshots':
    { shortLabel:'Aug 01–31 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Aug 01 - 31'},{l:'Order Report',v:'Aug 01 - 31'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 03 Sep - 09 Sep  Order Report: 03 Sep - 09 Sep  Payment Report - Screenshots':
    { shortLabel:'03–09 Sep', rows:[{l:'Payment Report',v:'03 Sep – 09 Sep'},{l:'Order Report',v:'03 Sep – 09 Sep'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 10 Sep - 16 Sep  Order Report: 10 Sep - 16 Sep  Payment Report - Screenshots':
    { shortLabel:'10–16 Sep', rows:[{l:'Payment Report',v:'10 Sep – 16 Sep'},{l:'Order Report',v:'10 Sep – 16 Sep'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 17 Sep - 23 Sep  Order Report: 17 Sep - 23 Sep  Payment Report - Screenshots':
    { shortLabel:'17–23 Sep', rows:[{l:'Payment Report',v:'17 Sep – 23 Sep'},{l:'Order Report',v:'17 Sep – 23 Sep'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 24 Sep - 30 Sep  Order Report: 24 Sep - 30 Sep  Payment Report - Screenshots':
    { shortLabel:'24–30 Sep', rows:[{l:'Payment Report',v:'24 Sep – 30 Sep'},{l:'Order Report',v:'24 Sep – 30 Sep'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: Sept 01 - 30  Order Report: Sept 01 - 30  Payment Report - Screenshots':
    { shortLabel:'Sep 01–30 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Sep 01 - 30'},{l:'Order Report',v:'Sep 01 - 30'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 01 Oct - 07 Oct  Order Report: 01 Oct - 07 Oct  Payment Report - Screenshots':
    { shortLabel:'01–07 Oct', rows:[{l:'Payment Report',v:'01 Oct – 07 Oct'},{l:'Order Report',v:'01 Oct – 07 Oct'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 08 Oct - 14 Oct  Order Report: 08 Oct - 14 Oct  Payment Report - Screenshots':
    { shortLabel:'08–14 Oct', rows:[{l:'Payment Report',v:'08 Oct – 14 Oct'},{l:'Order Report',v:'08 Oct – 14 Oct'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 15 Oct - 21 Oct  Order Report: 15 Oct - 21 Oct  Payment Report - Screenshots':
    { shortLabel:'15–21 Oct', rows:[{l:'Payment Report',v:'15 Oct – 21 Oct'},{l:'Order Report',v:'15 Oct – 21 Oct'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 22 Oct - 28 Oct  Order Report: 22 Oct - 28 Oct  Payment Report - Screenshots':
    { shortLabel:'22–28 Oct', rows:[{l:'Payment Report',v:'22 Oct – 28 Oct'},{l:'Order Report',v:'22 Oct – 28 Oct'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 29 Oct - 04 Nov  Order Report: 29 Oct - 04 Nov  Payment Report - Screenshots':
    { shortLabel:'29 Oct–04 Nov', rows:[{l:'Payment Report',v:'29 Oct – 04 Nov'},{l:'Order Report',v:'29 Oct – 04 Nov'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: Oct 01 - 31  Order Report: Oct 01 - 31  Payment Report - Screenshots':
    { shortLabel:'Oct 01–31 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Oct 01 - 31'},{l:'Order Report',v:'Oct 01 - 31'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 05 Nov - 11 Nov  Order Report: 05 Nov - 11 Nov  Payment Report - Screenshots':
    { shortLabel:'05–11 Nov', rows:[{l:'Payment Report',v:'05 Nov – 11 Nov'},{l:'Order Report',v:'05 Nov – 11 Nov'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 12 Nov - 18 Nov  Order Report: 12 Nov - 18 Nov  Payment Report - Screenshots':
    { shortLabel:'12–18 Nov', rows:[{l:'Payment Report',v:'12 Nov – 18 Nov'},{l:'Order Report',v:'12 Nov – 18 Nov'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 19 Nov - 25 Nov  Order Report: 19 Nov - 25 Nov  Payment Report - Screenshots':
    { shortLabel:'19–25 Nov', rows:[{l:'Payment Report',v:'19 Nov – 25 Nov'},{l:'Order Report',v:'19 Nov – 25 Nov'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 26 Nov - 02 Dec  Order Report: 26 Nov - 02 Dec  Payment Report - Screenshots':
    { shortLabel:'26 Nov–02 Dec', rows:[{l:'Payment Report',v:'26 Nov – 02 Dec'},{l:'Order Report',v:'26 Nov – 02 Dec'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: Nov 01 - 30  Order Report: Nov 01 - 30  Payment Report - Screenshots':
    { shortLabel:'Nov 01–30 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Nov 01 - 30'},{l:'Order Report',v:'Nov 01 - 30'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 03 Dec - 09 Dec  Order Report: 03 Dec - 09 Dec  Payment Report - Screenshots':
    { shortLabel:'03–09 Dec', rows:[{l:'Payment Report',v:'03 Dec – 09 Dec'},{l:'Order Report',v:'03 Dec – 09 Dec'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 10 Dec - 16 Dec  Order Report: 10 Dec - 16 Dec  Payment Report - Screenshots':
    { shortLabel:'10–16 Dec', rows:[{l:'Payment Report',v:'10 Dec – 16 Dec'},{l:'Order Report',v:'10 Dec – 16 Dec'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 17 Dec - 23 Dec  Order Report: 17 Dec - 23 Dec  Payment Report - Screenshots':
    { shortLabel:'17–23 Dec', rows:[{l:'Payment Report',v:'17 Dec – 23 Dec'},{l:'Order Report',v:'17 Dec – 23 Dec'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 24 Dec - 30 Dec  Order Report: 24 Dec - 30 Dec  Payment Report - Screenshots':
    { shortLabel:'24–30 Dec', rows:[{l:'Payment Report',v:'24 Dec – 30 Dec'},{l:'Order Report',v:'24 Dec – 30 Dec'},{l:'Payment Report - Screenshots',v:''}] },
  'Payment Report: 31 Dec - 06 Jan  Order Report: 31 Dec - 06 Jan  Payment Report - Screenshots':
    { shortLabel:'31 Dec–06 Jan', rows:[{l:'Payment Report',v:'31 Dec – 06 Jan'},{l:'Order Report',v:'31 Dec – 06 Jan'},{l:'Payment Report - Screenshots',v:''}] },
  'Monthly Payment Report: Dec 01 - 31  Order Report: Dec 01 - 31  Payment Report - Screenshots':
    { shortLabel:'Dec 01–31 (Monthly)', rows:[{l:'Monthly Payment Report',v:'Dec 01 - 31'},{l:'Order Report',v:'Dec 01 - 31'},{l:'Payment Report - Screenshots',v:''}] },
};

// ── Generic header parser ──────────────────────────────────────────────
// Reads whatever label/date text is actually in the uploaded Excel's column
// header and extracts { shortLabel, rows:[{l,v}] } from it directly, instead
// of requiring every week/month's exact header text to be pre-typed into a
// lookup table. Works for Lazada/Shopee/TikTok's "Label: dd Mon - dd Mon"
// and "Monthly Report/Income Mon dd - dd" conventions, plus a trailing
// region-code list like "MY, SG, PH, ID, TH, VN" if present.
const FR_LABEL_MARKERS = [
  'Withdrawal - Screenshots','Withdrawal Report','Withdrawal',
  'Transaction Report','Transaction',
  'Monthly Report','Monthly Income',
  'SW - Screenshots','SW',
  'Payment Report - Screenshots','Payment Report',
  'Order Report','Income'
];
const FR_MONTH_RE='(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';

function frCapMonth(s){ s=String(s||'').slice(0,3); return s.charAt(0).toUpperCase()+s.slice(1).toLowerCase(); }

function frParseHeaderInfo(platform, rawTopLabel, rawSubLabels) {
  const allText = [rawTopLabel||'', ...(rawSubLabels||[])].join(' ').replace(/\s+/g,' ').trim();
  if (!allText) return { shortLabel: null, rows: [] };

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const markerRe = new RegExp('(' + FR_LABEL_MARKERS.map(escRe).join('|') + ')\\s*:?\\s*', 'g');

  const hits = [];
  let m;
  while ((m = markerRe.exec(allText))) hits.push({ label: m[1], start: m.index, valueStart: markerRe.lastIndex });
  if (!hits.length) return { shortLabel: null, rows: [] };

  let rows = hits.map(function(h, i) {
    const end = i + 1 < hits.length ? hits[i+1].start : allText.length;
    return { l: h.label, v: allText.slice(h.valueStart, end).trim().replace(/\s+/g,' ') };
  });

  // Some source headers repeat the same label verbatim for two physical
  // columns (e.g. Lazada's monthly cell literally has "Withdrawal Report"
  // twice). Collapse adjacent same-label rows, keeping whichever has a value.
  rows = rows.filter(function(r, i) {
    return i === 0 || r.l !== rows[i-1].l || (r.v && !rows[i-1].v);
  });

  // Trailing region-code list, e.g. "MY, SG, PH, ID, TH, VN", sometimes
  // rides along on the last labeled value instead of having its own label.
  const regionsMatch = allText.match(/\b([A-Z]{2,3}(?:,\s*[A-Z]{2,3}){2,})\s*$/);
  if (regionsMatch) {
    const last = rows[rows.length - 1];
    if (last && last.v.endsWith(regionsMatch[1])) last.v = last.v.slice(0, last.v.length - regionsMatch[1].length).trim();
    rows.push({ l: 'Regions', v: regionsMatch[1] });
  }

  const isMonthly = /monthly/i.test(allText);
  let shortLabel = null;
  const rangeRe = new RegExp('(\\d{1,2})\\s*('+FR_MONTH_RE+')\\s*[-–]\\s*(\\d{1,2})\\s*('+FR_MONTH_RE+')?', 'i');
  const monthOnceRe = new RegExp('('+FR_MONTH_RE+')\\.?\\s*(\\d{1,2})\\s*-\\s*(\\d{1,2})', 'i');
  for (const r of rows) {
    let rm = r.v.match(rangeRe);
    if (rm) {
      const mo1 = frCapMonth(rm[2]), mo2 = frCapMonth(rm[4] || rm[2]);
      shortLabel = isMonthly ? (mo1 + ' ' + rm[1] + '–' + rm[3] + ' (Monthly)')
        : (mo1 === mo2 ? (rm[1] + '–' + rm[3] + ' ' + mo1) : (rm[1] + ' ' + mo1 + '–' + rm[3] + ' ' + mo2));
      break;
    }
    rm = r.v.match(monthOnceRe);
    if (rm) { shortLabel = frCapMonth(rm[1]) + ' ' + rm[2] + '–' + rm[3] + (isMonthly ? ' (Monthly)' : ''); break; }
  }

  // ── Due date ──
  // Instead of relying on a manually-set "week offset" to guess which column
  // is currently active, read the real deadline straight out of the header:
  // the reporting deadline is always the day after the latest date mentioned
  // anywhere in the column (the Monday after a Lazada withdrawal date, the
  // Thursday after a Shopee/TikTok order-report window, the 1st of the month
  // after a monthly "May 01 - 31" window, etc). Self-corrects every period —
  // nothing to keep configured in sync.
  const MONTHS_IDX={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  function frResolveYear(mIdx, day) {
    const yr = now().getFullYear();
    let d = new Date(yr, mIdx, day);
    if (d - now() > 183*86400000) d = new Date(yr-1, mIdx, day);
    return d;
  }
  let latestDate = null;
  function considerDate(mIdx, day) {
    if (mIdx===undefined) return;
    const d = frResolveYear(mIdx, day);
    if (!latestDate || d > latestDate) latestDate = d;
  }
  const ddMonRe = /(\d{1,2})\s+([A-Za-z]{3,9})\b/g;
  const monDdDdRe = new RegExp('('+FR_MONTH_RE+')\\.?\\s*(\\d{1,2})\\s*-\\s*(\\d{1,2})', 'gi');
  for (const r of rows) {
    let mm;
    monDdDdRe.lastIndex = 0;
    while ((mm = monDdDdRe.exec(r.v))) {
      const mi = MONTHS_IDX[mm[1].toLowerCase().slice(0,3)];
      considerDate(mi, parseInt(mm[2])); considerDate(mi, parseInt(mm[3]));
    }
    ddMonRe.lastIndex = 0;
    while ((mm = ddMonRe.exec(r.v))) {
      const mi = MONTHS_IDX[mm[2].toLowerCase().slice(0,3)];
      considerDate(mi, parseInt(mm[1]));
    }
  }
  let dueDate = null;
  if (latestDate) { dueDate = new Date(latestDate.getTime()); dueDate.setDate(dueDate.getDate()+1); }

  return { shortLabel: shortLabel || (rows[0] && rows[0].v) || null, rows, dueDate, isMonthly, latestDate };
}

// ── Look up header display info ──
// Tries the generic parser first (works for any current or future week/month
// automatically); falls back to the legacy hardcoded map only for old header
// text the parser doesn't recognize.
// Returns { shortLabel, tooltipHTML } or { shortLabel:null, tooltipHTML:null }
function frGetColDateRanges(platform, colDate, rawTopLabel, rawSubLabels) {
  let entry = frParseHeaderInfo(platform, rawTopLabel, rawSubLabels);
  if (!entry.shortLabel) {
    // Build the full raw key the same way extract-text produced it
    const allText = [rawTopLabel||'', ...(rawSubLabels||[])].join('  ').replace(/\s+/g,' ').trim();
    let legacy = FR_HEADER_MAP[rawTopLabel ? rawTopLabel.trim() : ''];
    if (!legacy) legacy = FR_HEADER_MAP[allText];
    if (!legacy) {
      const norm = s => s.replace(/\s+/g,' ').trim();
      const normKey = norm(rawTopLabel||'');
      const found = Object.keys(FR_HEADER_MAP).map(k=>({k,n:norm(k)})).find(x=>x.n===normKey);
      if (found) legacy = FR_HEADER_MAP[found.k];
    }
    if (legacy) entry = legacy;
  }
  if (!entry || !entry.shortLabel) return { shortLabel: null, tooltipHTML: null };

  const rowsHTML = entry.rows.map(function(r) {
    return '<div style="display:flex;align-items:baseline;gap:6px;line-height:1.9">'
      + '<span style="font-weight:700;color:#93c5fd;min-width:130px;font-size:11px">' + r.l + ':</span>'
      + '<span style="color:#e2e8f0;font-size:11px">' + (r.v || '&nbsp;') + '</span>'
      + '</div>';
  }).join('');

  const tooltipHTML = '<div style="font-size:12px;font-weight:700;color:#fbbf24;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.15);padding-bottom:5px;letter-spacing:.03em">'
    + platform + ' · ' + entry.shortLabel + '</div>' + rowsHTML;

  return { shortLabel: entry.shortLabel, tooltipHTML };
}

function frGetPlatform(task){
  if(!task||!task.frLinked)return null;
  if(task.frPlatform)return task.frPlatform;
  const t=String(task.title||'').toLowerCase();
  if(t.includes('lazada'))return'Lazada';
  if(t.includes('shopee'))return'Shopee';
  if(t.includes('tiktok')||t.includes('tik tok'))return'TikTok';
  return null;
}

function getFRLinked(){
  return Object.values(D.trackers||{}).find(t=>t.frLinked)||null;
}

function getFRSheet(linked,platform){
  const sheets=linked.sheets||{};
  if(sheets[platform])return sheets[platform];
  const key=Object.keys(sheets).find(k=>k.toLowerCase().includes(platform.toLowerCase()));
  return key?sheets[key]:null;
}

// Parse "Apr-21" style header into a Date object
function frParseDateHeader(h){
  if(!h)return null;
  const s=String(h).trim();
  const mo=s.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if(!mo)return null;
  const MONTHS={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const mIdx=MONTHS[mo[1]];
  if(mIdx===undefined)return null;
  const day=parseInt(mo[2]);
  const yr=now().getFullYear();
  let d=new Date(yr,mIdx,day);
  // If more than 6 months in the future, it's probably last year
  if(d-now()>183*86400000)d=new Date(yr-1,mIdx,day);
  return d;
}

// Find the active column index for the current week based on platform due day
// Uses frEffectiveDate which applies the platform's week offset (e.g. Lazada is 1 week behind)
function frFindActiveCol(sheet,platform){
  const row0=(sheet.headerRows&&sheet.headerRows[0])||sheet.row0||[];
  const targetDow=FR_DOW[platform]||4;
  const todayD=frEffectiveDate(platform); // applies week offset
  // Use the sheet's real fixed-column count (matches buildFRTable / _frScanDateCols).
  let fixedCount=frFixedCount(sheet,platform);
  let bestColIdx=-1,bestDiff=Infinity;
  let lastValidColIdx=-1;
  for(let ci=fixedCount;ci<row0.length;ci++){
    const d=frParseDateHeader(row0[ci]);
    if(!d||d.getDay()!==targetDow)continue;
    lastValidColIdx=ci;
    const diff=todayD-d;
    if(diff>=0&&diff<bestDiff){bestDiff=diff;bestColIdx=ci;}
  }
  if(bestColIdx===-1){
    let minFuture=Infinity;
    for(let ci=fixedCount;ci<row0.length;ci++){
      const d=frParseDateHeader(row0[ci]);
      if(!d||d.getDay()!==targetDow)continue;
      const diff=d-todayD;
      if(diff>=0&&diff<minFuture){minFuture=diff;bestColIdx=ci;}
    }
  }
  // If still nothing, just return the last col with any parseable date
  if(bestColIdx===-1){
    for(let ci=fixedCount;ci<row0.length;ci++){
      const d=frParseDateHeader(row0[ci]);
      if(d){const diff=todayD-d;if(diff>=0&&diff<bestDiff){bestDiff=diff;bestColIdx=ci;}}
    }
  }
  // Final fallback: use the last valid DOW-matching column found
  if(bestColIdx===-1&&lastValidColIdx!==-1)bestColIdx=lastValidColIdx;
  return bestColIdx;
}

// A cell counts as "done" once the member has typed ANYTHING into it.
// Members fill the active column with freetext, and any status they enter — "Done",
// "Done (No Data)", "No Data", "No Withdrawal", a note, etc. — means they have handled
// that brand for the week. So completion is driven purely by whether the cell is non-empty,
// not by whether it literally starts with the word "done". (Previously only values starting
// with "done" counted, so a member who typed "No Data" filled the cell yet still showed as
// incomplete — which is why reports looked unfinished even after everything was entered.)
function frIsDone(v){
  return !(v===null||v===undefined||String(v).trim()==='');
}

// Compute completion for one platform sheet
function frGetSheetCompletion(sheet,platform){
  if(!sheet)return{done:0,total:0,pct:0,regions:{}};
  // Use the SAME active-column resolver the Live Tracker table and the mass-update
  // ("Set Selected to Done") use, so the dashboard reads the exact column that writes
  // land in. The old frFindActiveCol expected "Apr-21" headers and returned -1 for the
  // real "Order Report: 02 Jul - 08 Jul" style headers, so Done never registered here.
  const colIdx=frActiveColIdx(sheet,platform);
  if(colIdx===-1)return{done:0,total:0,pct:0,regions:{}};
  const regionCol=frFixedColIdx(sheet,platform,'region');
  const acctCol=frFixedColIdx(sheet,platform,'acct');
  const brandCol=frFixedColIdx(sheet,platform,'brand');
  const dataRows=(sheet.rows||[]).filter(function(r){
    if(!r||r[regionCol]==null||!String(r[regionCol]).trim())return false;
    const acctStatus=String(r[acctCol]||'').trim().toLowerCase();
    return acctStatus!=='inactive'&&acctStatus!=='exited';
  });
  let total=0,done=0;
  const regions={};
  dataRows.forEach(function(row){
    const region=String(row[regionCol]||'').trim()||'—';
    const val=row[colIdx];
    const isDone=frIsDone(val);
    total++;
    if(isDone)done++;
    if(!regions[region])regions[region]={done:0,total:0,notDone:[]};
    regions[region].total++;
    if(isDone){
      regions[region].done++;
    } else {
      const brand=String(row[brandCol]||'').trim()||String(row[brandCol-1]||'').trim()||'Unknown';
      regions[region].notDone.push(brand);
    }
  });
  return{done,total,pct:total?Math.round(done/total*100):0,regions};
}

function getFRStatusForTask(platform){
  const linked=getFRLinked();
  if(!linked)return'Pending';
  const sheet=getFRSheet(linked,platform);
  if(!sheet)return'Pending';
  const c=frGetSheetCompletion(sheet,platform);
  if(!c.total)return'Pending';
  if(c.pct>=100)return'Done';
  if(c.pct>0)return'Ongoing';
  return'Pending';
}

function getFRCompletionForTask(platform){
  const linked=getFRLinked();
  if(!linked)return{done:0,total:0,pct:0};
  const sheet=getFRSheet(linked,platform);
  if(!sheet)return{done:0,total:0,pct:0};
  const c=frGetSheetCompletion(sheet,platform);
  return{done:c.done,total:c.total,pct:c.pct};
}

// ── Multi-platform, cadence-aware completion ──────────────────────────────
// A Finance Report task may span ALL platforms (Lazada + Shopee + TikTok), not
// just one. frGetPlatform() only ever returns a single platform, so the old
// per-task completion could not see brands marked Done on the other platforms —
// e.g. Dulux Done on Shopee never moved a Lazada-inferred task. It also always
// read the WEEKLY column even for monthly reports, so an Aug-1 monthly "Done"
// (which lives in the monthly column) never registered.
//
// frTaskPlatforms() returns every platform the task applies to. If the task
// pins one explicitly (task.frPlatform) we honour it; otherwise, if the title
// names a platform we use that one; if it names none (e.g. "Monthly Platform
// Reports") the task is treated as spanning ALL platform sheets present on the
// linked tracker.
function frTaskPlatforms(task){
  if(!task||!task.frLinked)return[];
  if(task.frPlatform)return[task.frPlatform];
  const t=String(task.title||'').toLowerCase();
  const named=[];
  if(t.includes('lazada'))named.push('Lazada');
  if(t.includes('shopee'))named.push('Shopee');
  if(t.includes('tiktok')||t.includes('tik tok'))named.push('TikTok');
  if(named.length)return named;
  // No platform named → span every sheet the linked tracker actually has.
  const linked=getFRLinked();
  if(!linked||!linked.sheets)return[];
  return Object.keys(linked.sheets);
}

// Does this task track the MONTHLY column rather than the weekly one? Driven by
// the task's own frequency so a "Monthly …" task reads the monthly (Input Date)
// column that the Live Tracker highlights green, not the weekly column.
function frTaskIsMonthly(task){
  return !!(task&&(task.freq==='monthly'||task.freq==='eom'||task.frMonthly));
}

// Completion for one sheet against a chosen cadence column (weekly or monthly).
// Mirrors frGetSheetCompletion but lets the caller pick the column resolver so
// monthly tasks read the monthly column.
function frGetSheetCompletionCadence(sheet,platform,wantMonthly,refDateStr){
  if(!sheet)return{done:0,total:0,pct:0,regions:{}};
  const colIdx=wantMonthly?frActiveMonthlyColIdx(sheet,platform,refDateStr):frActiveColIdx(sheet,platform,refDateStr);
  if(colIdx===-1)return{done:0,total:0,pct:0,regions:{}};
  const regionCol=frFixedColIdx(sheet,platform,'region');
  const acctCol=frFixedColIdx(sheet,platform,'acct');
  const brandCol=frFixedColIdx(sheet,platform,'brand');
  const dataRows=(sheet.rows||[]).filter(function(r){
    if(!r||r[regionCol]==null||!String(r[regionCol]).trim())return false;
    const acctStatus=String(r[acctCol]||'').trim().toLowerCase();
    return acctStatus!=='inactive'&&acctStatus!=='exited';
  });
  let total=0,done=0;const regions={};
  dataRows.forEach(function(row){
    const region=String(row[regionCol]||'').trim()||'—';
    const isDone=frIsDone(row[colIdx]);
    total++;if(isDone)done++;
    if(!regions[region])regions[region]={done:0,total:0,notDone:[]};
    regions[region].total++;
    if(isDone)regions[region].done++;
    else{const brand=String(row[brandCol]||'').trim()||String(row[brandCol-1]||'').trim()||'Unknown';regions[region].notDone.push(brand);}
  });
  return{done,total,pct:total?Math.round(done/total*100):0,regions};
}

// Aggregate completion for a task across ALL of its platforms and the correct
// cadence column. Each brand-row per platform counts as one unit (1:1), which
// is exactly how the roll-up should sum Lazada + Shopee + TikTok.
// `refDateStr` (optional): resolve completion against the cycle covering that specific
// date instead of today's live cycle — see _frResolveColByCadence. This is what lets the
// dashboard show a PAST week's Shopee/TikTok report as Pending again once a new week's
// cycle has started, instead of always echoing today's live tracker state.
function getFRCompletionForTaskObj(task,refDateStr){
  const linked=getFRLinked();
  if(!linked)return{done:0,total:0,pct:0};
  const wantMonthly=frTaskIsMonthly(task);
  let done=0,total=0;
  frTaskPlatforms(task).forEach(function(plat){
    const sheet=getFRSheet(linked,plat);
    if(!sheet)return;
    const c=frGetSheetCompletionCadence(sheet,plat,wantMonthly,refDateStr);
    done+=c.done;total+=c.total;
  });
  return{done,total,pct:total?Math.round(done/total*100):0};
}

function getFRStatusForTaskObj(task,refDateStr){
  const c=getFRCompletionForTaskObj(task,refDateStr);
  if(!c.total)return'Pending';
  if(c.pct>=100)return'Done';
  if(c.pct>0)return'Ongoing';
  return'Pending';
}

// ── Per-member section completion (for the "confirm my section" prompt) ──
// Returns how many of THE CURRENT USER's own assigned brands (matched by Exec or Team Lead
// name, without the admin-sees-all override) in the active reporting column are filled.
// A brand is "filled" as soon as its active-column cell has any freetext (see frIsDone).
// Inactive/exited brands are excluded, mirroring the completion math.
function frGetMySectionCompletion(sheet,platform){
  const empty={done:0,total:0,complete:false};
  if(!sheet||!CU||!CU.name)return empty;
  const colIdx=frActiveColIdx(sheet,platform);
  if(colIdx===-1)return empty;
  const headerRows=(sheet.headerRows)||(sheet.row0?[sheet.row0]:[[]]);
  const hr0=headerRows[0]||[];
  const execCol=(function(){const i=hr0.findIndex(function(l){return/exec/i.test(String(l||''));});return i>=0?i:5;})();
  const tlCol=(function(){const i=hr0.findIndex(function(l){return/team.?lead|^tl$/i.test(String(l||''));});return i>=0?i:6;})();
  const nm=String(CU.name||'').trim().toLowerCase();
  const regionCol=frFixedColIdx(sheet,platform,'region');
  const acctCol=frFixedColIdx(sheet,platform,'acct');
  let done=0,total=0;
  (sheet.rows||[]).forEach(function(r){
    if(!r||r[regionCol]==null||!String(r[regionCol]).trim())return;
    const st=String(r[acctCol]||'').trim().toLowerCase();
    if(st==='inactive'||st==='exited')return;
    const ex=String(r[execCol]||'').trim().toLowerCase();
    const tl=String(r[tlCol]||'').trim().toLowerCase();
    if(!((ex&&ex===nm)||(tl&&tl===nm)))return; // not this member's brand
    total++;
    if(frIsDone(r[colIdx]))done++;
  });
  return{done,total,complete:total>0&&done>=total};
}

// Build inline region chips for dashboard (hover shows pending brands).
// `wantMonthly` picks which cadence column the per-region breakdown reads. It MUST match the
// cadence the task's overall completion cell uses (getFRCompletionForTaskObj → frTaskIsMonthly),
// otherwise a monthly task shows its right-side bar from the monthly column while these region
// chips read the (still-empty) weekly column — the exact mismatch that made Lazada look 36%
// incomplete here while the completion cell correctly read 100% from the monthly column.
function buildFRInlineRegions(platform,wantMonthly,refDateStr,cwRefStr){
  if(!platform)return'';
  const linked=getFRLinked();
  if(!linked){
    return'<div style="font-size:11px;color:var(--text3);margin-top:4px">No finance tracker linked — '
      +'<button class="btn sm" onclick="showPage(\'live-trackers\')" style="font-size:10px;padding:2px 8px">Link Tracker</button></div>';
  }
  const sheet=getFRSheet(linked,platform);
  if(!sheet)return'<div style="font-size:11px;color:var(--text3);margin-top:4px">No '+platform+' sheet in tracker</div>';
  const comp=frGetSheetCompletionCadence(sheet,platform,!!wantMonthly,refDateStr);
  if(!comp.total)return'<div style="font-size:11px;color:var(--text3);margin-top:4px">No data for '+(refDateStr?'that cycle':'current cycle')+'</div>';

  // Overall progress
  const totalDone=comp.done,totalAll=comp.total;
  const overallPct=totalAll?Math.round(totalDone/totalAll*100):0;
  const barCol=overallPct>=100?'var(--green)':overallPct>0?'var(--blue)':'var(--red)';

  // Determine current CW from effective date
  const effDate=frEffectiveDate(platform);
  // CW badge = WORK week (task's due/origin date, else today) — NOT shifted by the platform's
  // coverage offset. The offset only decides which coverage column/date range is read (effLabel).
  const cwNum=getWeekNumber(cwRefStr||ds(now()));
  const cwLabel='CW'+cwNum;
  const offset=FR_WEEK_OFFSET[platform]||0;
  const effLabel=effDate.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});

  // Region chips
  const chips=Object.entries(comp.regions).map(function([reg,rd]){
    const pct=rd.total?Math.round(rd.done/rd.total*100):0;
    const col=pct>=100?'var(--green)':pct>0?'var(--yellow)':'var(--red)';
    const tipContent=rd.notDone.length
      ?'<b style="color:#fca5a5">Pending ('+rd.notDone.length+'):</b><br>'+rd.notDone.slice(0,8).join('<br>')+(rd.notDone.length>8?'<br>+more':'')
      :'<span style="color:#4ade80">All done ✓</span>';
    return'<div class="tt-wrap" style="display:inline-block;margin:2px">'
      +'<div style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:20px;background:'+col+'18;border:1px solid '+col+'44;cursor:default">'
        +'<span style="font-size:10px;font-weight:700;color:'+col+'">'+reg+'</span>'
        +'<span style="font-size:10px;color:'+col+'">'+rd.done+'/'+rd.total+'</span>'
      +'</div>'
      +'<div class="tt-box" style="min-width:180px;white-space:normal;line-height:1.6">'+tipContent+'</div>'
    +'</div>';
  }).join('');

  // Cadence label chip with tooltip. Monthly-cadence breakdowns show a "Monthly" chip keyed to
  // the current month rather than a weekly CW number (which would be misleading — the region
  // counts come from the monthly column, not the weekly one).
  const monthLabel=now().toLocaleDateString('en-PH',{month:'long',year:'numeric'});
  const weekChip=wantMonthly
    ?'<div class="tt-wrap" style="display:inline-block;margin:2px">'
      +'<span style="font-size:10px;color:var(--green);background:var(--green-light);padding:2px 7px;border-radius:20px;font-weight:700;cursor:default;display:inline-block">🗓️ Monthly</span>'
      +'<div class="tt-box" style="min-width:180px;white-space:normal;line-height:1.5;font-size:11px;font-weight:400">'
        +'<b>'+monthLabel+' monthly report</b><br>'
        +'Counts read from the monthly column. Hover region chips to see pending stores.'
      +'</div>'
    +'</div>'
    :'<div class="tt-wrap" style="display:inline-block;margin:2px">'
      +'<span style="font-size:10px;color:var(--blue);background:var(--blue-light);padding:2px 7px;border-radius:20px;font-weight:700;cursor:default;display:inline-block">📅 '+cwLabel+'</span>'
      +'<div class="tt-box" style="min-width:180px;white-space:normal;line-height:1.5;font-size:11px;font-weight:400">'
        +'<b>Work week '+cwLabel+'</b><br>Coverage: '+effLabel+'<br>'
        +(offset!==0?'<span style="color:#fca5a5">Offset: '+(offset<0?Math.abs(offset)+' week(s) behind':'ahead by '+offset+'w')+'</span><br>':'')
        +'Hover region chips to see pending stores.'
      +'</div>'
    +'</div>';

  // Progress bar + summary line
  const progressBar='<div style="display:flex;align-items:center;gap:6px;margin-top:5px;margin-bottom:3px">'
    +'<div style="flex:1;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;min-width:60px">'
      +'<div style="height:100%;width:'+overallPct+'%;background:'+barCol+';border-radius:3px;transition:width .4s cubic-bezier(.4,0,.2,1)"></div>'
    +'</div>'
    +'<span style="font-size:10px;font-weight:800;color:'+barCol+';min-width:34px">'+overallPct+'%</span>'
    +'<span style="font-size:10px;color:var(--text3)">'+totalDone+'/'+totalAll+' done</span>'
  +'</div>';

  return progressBar
    +'<div style="margin-top:2px;display:flex;flex-wrap:wrap;gap:2px;align-items:center">'+chips+weekChip+'</div>';
}

// Inline region breakdown for a task, spanning every platform it applies to.
// Single-platform tasks render exactly as before; multi-platform tasks stack
// one labelled block per platform (Lazada / Shopee / TikTok).
function buildFRInlineRegionsForTask(task,refDateStr){
  const plats=frTaskPlatforms(task);
  const wantMonthly=frTaskIsMonthly(task);
  const cwRef=task._carryOrigin||refDateStr||ds(now());
  if(plats.length<=1)return buildFRInlineRegions(plats[0]||null,wantMonthly,refDateStr,cwRef);
  return plats.map(function(p){
    const sheet=getFRSheet(getFRLinked()||{},p);
    if(!sheet)return'';
    return'<div style="margin-top:6px">'
      +'<div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">'+p+'</div>'
      +buildFRInlineRegions(p,wantMonthly,refDateStr,cwRef)
    +'</div>';
  }).join('');
}

// ── FR CW Header Tooltip (fixed-position, immune to sticky thead overflow clipping) ──
(function(){
  let _tip=null;
  window.frShowCWTip=function(el,htmlContent){
    if(!_tip){
      _tip=document.createElement('div');
      _tip.id='fr-cw-floating-tip';
      _tip.style.cssText='position:fixed;z-index:99999;background:#1f2937;color:#fff;border-radius:10px;padding:12px 16px;font-size:12px;font-weight:400;line-height:1.6;min-width:230px;max-width:300px;white-space:normal;box-shadow:0 10px 28px rgba(0,0,0,.45);pointer-events:none;display:none;border:1px solid rgba(96,165,250,.25)';
      // Arrow pointing up
      const arrow=document.createElement('div');
      arrow.style.cssText='position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:6px solid #1f2937';
      _tip.appendChild(arrow);
      document.body.appendChild(_tip);
    }
    // Replace content (keep arrow as first child)
    while(_tip.childNodes.length>1)_tip.removeChild(_tip.lastChild);
    const content=document.createElement('div');
    // Support rich HTML tooltips (from frGetColDateRanges) or plain text fallback
    if(htmlContent&&(htmlContent.indexOf('<')!==-1)){
      content.innerHTML=htmlContent;
    } else {
      content.textContent=htmlContent||'';
    }
    _tip.appendChild(content);
    _tip.style.display='block';
    // Position below the element
    const r=el.getBoundingClientRect();
    const tipW=250;
    let left=r.left+r.width/2-tipW/2;
    left=Math.max(8,Math.min(left,window.innerWidth-tipW-8));
    _tip.style.width=tipW+'px';
    _tip.style.left=left+'px';
    _tip.style.top=(r.bottom+8)+'px';
    // Reposition arrow horizontally to point at element center
    const arrowEl=_tip.querySelector('div');
    if(arrowEl){const elCenter=r.left+r.width/2;arrowEl.style.left=(elCenter-left)+'px';arrowEl.style.transform='none';}
  };
  window.frHideCWTip=function(){if(_tip)_tip.style.display='none';};
})();

// Build the Finance Report tracker table view
function buildFRTable(trackerKey,sheetKey,sheet){
  if(!sheet)return'<div class="empty-state" style="padding:32px">Empty sheet.</div>';

  // Support both old format (row0/row1) and new format (headerRows)
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(r=>r&&r.length):[[]]); 
  const rows=sheet.rows||[];
  if(!headerRows.length||!headerRows[0].length)return'<div class="empty-state" style="padding:32px">No data. Upload your Finance Report Excel file.</div>';

  const platform=sheetKey;
  const targetDow=FR_DOW[platform]||4;
  const isAdmin=CU.isAdmin;
  const myName=CU.name;

  // ── Detect fixed columns vs date columns ──
  // Fixed columns are at the start and contain non-date labels like Region, Platform, etc.
  // Date columns come after. We detect by finding where date-like values start in row0.
  const row0=headerRows[0]||[];

  // Find where date columns start: first col index where the header looks like a date group
  // (contains "Income", "SW", "Order", date patterns, or is a date serial)
  // For known platforms default to the standard 7 fixed columns — but allow the admin to
  // override this per-sheet (via Manage Columns) when the real Excel has a different number
  // of fixed columns, e.g. extra/renamed roles that were previously misclassified as date columns.
  const defaultFixed=FR_DEFAULT_FIXED;
  const platformFixedDefaults=FR_PLATFORM_FIXED_DEFAULTS;
  const activeDefaults=(platformFixedDefaults[platform]||defaultFixed);
  let fixedCount=(sheet.fixedColCount!=null&&sheet.fixedColCount>0)?sheet.fixedColCount:activeDefaults.length;
  const fixedLabels=[];
  for(let i=0;i<fixedCount;i++){
    const v=row0[i]!=null?String(row0[i]).trim():'';
    fixedLabels.push(v||activeDefaults[i]||defaultFixed[i]||'Col '+(i+1));
  }

  // ── Fixed-column detection + display order ──
  // Data indices never change (edits/storage stay stable); we only reorder for DISPLAY:
  //   • Synagie Merchant ID is hidden on every tab.
  //   • Account Status is moved to render right AFTER Team Lead (it lives near the start in the
  //     data, but the user wants it shown last among the fixed columns).
  const _synagieIdx=fixedLabels.findIndex(function(l){return /synagie|merchant/i.test(String(l||''));});
  const _acctIdx=fixedLabels.findIndex(function(l){return /account.?status|acct.?status/i.test(String(l||''));});
  const _tlIdx=fixedCount-1; // Team Lead is the last fixed column in the data
  const fixedRenderOrder=[];
  for(let i=0;i<fixedCount;i++){
    if(i===_synagieIdx)continue;          // hidden entirely
    if(i===_acctIdx)continue;             // deferred — inserted after Team Lead below
    fixedRenderOrder.push(i);
    if(i===_tlIdx&&_acctIdx>=0)fixedRenderOrder.push(_acctIdx); // Status right after Team Lead
  }
  // Edge case: if Status column wasn't detected but Team Lead is, order is already fine.

  // ── Build date column groups ──
  // Each date column group spans one column and may have sub-rows from headerRows[1], [2], etc.
  const dateColGroups=[];
  for(let ci=fixedCount;ci<row0.length;ci++){
    const topLabel=row0[ci]!=null?String(row0[ci]).trim():'';
    const subLabels=[];
    for(let ri=1;ri<headerRows.length;ri++){
      const hr=headerRows[ri]||[];
      subLabels.push(hr[ci]!=null?String(hr[ci]).trim():'');
    }
    // Parse date from any sub-label or the top label
    let parsedDate=frParseDateHeader(topLabel);
    if(!parsedDate){for(const sl of subLabels){parsedDate=frParseDateHeader(sl);if(parsedDate)break;}}
    // Try to extract a date from embedded text like "Income: 23 Dec - 29 Dec"
    if(!parsedDate){
      const allText=[topLabel,...subLabels].join(' ');
      const dm=allText.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
      if(dm){
        const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
        const mIdx=MONTHS[dm[2].toLowerCase()];
        if(mIdx!==undefined){
          const yr=now().getFullYear();
          parsedDate=new Date(yr,mIdx,parseInt(dm[1]));
          if(parsedDate-now()>183*86400000)parsedDate=new Date(yr-1,mIdx,parseInt(dm[1]));
        }
      }
    }
    // Skip fully-blank "ghost" columns — these are leftover remnants from earlier delete attempts
    // (before the column-delete fix) that have no header text and no parseable date at all.
    // Rendering them produces a headerless column that visually misaligns everything after it
    // (including the completion % footer) and makes the freeze boundary look wrong.
    const hasAnyLabel=topLabel||subLabels.some(function(s){return s;});
    if(!hasAnyLabel&&!parsedDate)continue;
    // Real reporting deadline for this column, read straight from its header text
    // (see frParseHeaderInfo) — no manually-set week offset involved.
    const entry=frParseHeaderInfo(platform,topLabel,subLabels);
    dateColGroups.push({ci,topLabel,subLabels,parsedDate,dueDate:entry.dueDate||null,entry,isActive:false,isPast:false,isFuture:false});
  }

  // ── Mark active/past/future ──
  // Use the shared resolver so the highlighted column, the reporting-week banner,
  // and the mass-update actions always agree. frActiveColIdx applies the platform's
  // week offset (Lazada = -1, reporting on a one-week lag; Shopee/TikTok = 0).
  const _activeCiTbl=frActiveColIdx(sheet,platform);          // current WEEKLY column (yellow)
  const _activeMonthlyCiTbl=frActiveMonthlyColIdx(sheet,platform); // current MONTHLY column (green)
  let activeIdx=-1;
  dateColGroups.forEach(function(dc,i){if(dc.ci===_activeCiTbl)activeIdx=i;});
  // Flag which columns are monthly reports (e.g. Lazada's "Monthly Report: June 01 - 30").
  // Monthly columns must NOT participate in the rolling weekly Report-Date sequence — their
  // date is always the 1st of the month following their coverage, and they must not consume a
  // week slot (otherwise the weekly column after them skips a week, e.g. Jul 14 going missing).
  dateColGroups.forEach(function(dc){
    const _e=dc.entry||frParseHeaderInfo(platform,dc.topLabel,dc.subLabels);
    dc.isMonthlyCol=!!(_e&&_e.isMonthly);
    // The current monthly column gets its own independent "active" flag → green highlight.
    // Resolved separately from the weekly one so both can be current in the same view.
    dc.isActiveMonthly=(dc.ci===_activeMonthlyCiTbl);
  });
  // isActive = current WEEKLY column (yellow). Past/future greying is driven off the weekly
  // active index, but the current MONTHLY column is exempt: it's neither past nor future, it
  // carries its own green "active" state so it never renders greyed-out alongside the weekly.
  dateColGroups.forEach(function(dc,i){
    if(i===activeIdx)dc.isActive=true;
    else if(dc.isActiveMonthly){/* current monthly — highlighted green, not past/future */}
    else if(activeIdx>=0&&i<activeIdx)dc.isPast=true;
    else dc.isFuture=true;
  });
  // Week offset from the active column, counting ONLY weekly (non-monthly) columns so the
  // rolling date sequence stays contiguous regardless of interleaved monthly columns.
  // 0 = active weekly column, -1 = previous weekly column, +1 = next weekly column, etc.
  (function(){
    if(activeIdx<0){dateColGroups.forEach(function(dc){dc.weekOffset=null;});return;}
    // Walk outward from the active column, incrementing the counter only on weekly columns.
    let cnt=0;
    for(let i=activeIdx;i<dateColGroups.length;i++){
      const dc=dateColGroups[i];
      if(dc.isMonthlyCol){dc.weekOffset=null;continue;}
      dc.weekOffset=cnt;cnt++;
    }
    cnt=0;
    for(let i=activeIdx-1;i>=0;i--){
      const dc=dateColGroups[i];
      if(dc.isMonthlyCol){dc.weekOffset=null;continue;}
      cnt--;dc.weekOffset=cnt;
    }
  })();

  // ── Limit visible columns: rolling window anchored on the active (current) week ──
  // The Finance tab shows exactly the weeks that matter right now, keyed off each column's
  // own Report Date via the weekOffset computed above (0 = current/active week, -1 = last
  // week, +1..+3 = the next three weeks). That yields five weekly columns in view:
  //   last week + current week + next 3 weeks.
  // Older weeks (offset <= -2) and anything further out than +3 are hidden — they still exist
  // in the data and simply scroll back into view as time advances and the active column rolls
  // forward. Monthly columns (weekOffset === null) don't consume a weekly slot; a monthly
  // column is kept only when its own date falls inside the date span of the visible weekly
  // window, so e.g. an Aug-1 monthly report shows alongside the late-July/early-Aug weeks.
  const FR_WIN_PAST=1;    // how many past weeks to show by default (1 = last week)
  const FR_WIN_FUTURE=3;  // how many future weeks to show (next 3)
  // Extra past weeks revealed via the "◀ Prev week" control (see frBrowseNavHtml) — purely
  // additive to the default window, and always rendered read-only (see dc.isRefOnly below).
  const _frExtraPast=_frWeekBrowseBack[frBrowseKey(trackerKey,sheetKey)]||0;
  const FR_WIN_PAST_EFF=FR_WIN_PAST+_frExtraPast;
  (function(){
    if(activeIdx===-1)return; // no active col found — show all
    // Weekly columns inside the window.
    const weeklyKept=dateColGroups.filter(function(dc){
      return dc.weekOffset!==null && dc.weekOffset!==undefined
        && dc.weekOffset>=-FR_WIN_PAST_EFF && dc.weekOffset<=FR_WIN_FUTURE;
    });
    const visibleSet=new Set(weeklyKept.map(function(dc){return dc.ci;}));
    // Date span covered by the visible weekly columns (used to place monthly columns).
    // parsedDate is each weekly column's coverage-START, so extend spanMax by 6 days to reach
    // the last visible week's coverage-END — this keeps a month-end monthly (e.g. Jul 31) in
    // view even when it lands in the final days of the last visible week.
    let spanMin=null,spanMax=null;
    weeklyKept.forEach(function(dc){
      if(!dc.parsedDate)return;
      if(spanMin===null||dc.parsedDate<spanMin)spanMin=dc.parsedDate;
      if(spanMax===null||dc.parsedDate>spanMax)spanMax=dc.parsedDate;
    });
    if(spanMax){ spanMax=new Date(spanMax.getFullYear(),spanMax.getMonth(),spanMax.getDate()+6); }
    // Keep a monthly column when the week it BELONGS TO is on screen. A monthly's coverage
    // starts on the 1st (dc.parsedDate = e.g. Jul 1), which sits far before the visible weekly
    // span, so testing coverage-start wrongly hides it. Instead test the monthly's month-END —
    // its latestDate (last day of the covered month) and its Report Date (month-end + 1) — since
    // the monthly is meant to appear right after the week that crosses that month boundary. This
    // is what makes the monthly show up exactly "when switching months".
    dateColGroups.forEach(function(dc){
      if(!(dc.weekOffset===null||dc.weekOffset===undefined))return; // weekly cols handled above
      if(!dc.isMonthlyCol)return;
      // Anchor dates that place the monthly next to its month-end week.
      const _e=dc.entry||frParseHeaderInfo(platform,dc.topLabel,dc.subLabels);
      const monthEnd=(_e&&_e.latestDate)?_e.latestDate:null;      // e.g. Jul 31
      const reportDate=(_e&&_e.dueDate)?_e.dueDate:null;          // e.g. Aug 1
      const inSpan=function(d){ return d&&spanMin!==null&&spanMax!==null&&d>=spanMin&&d<=spanMax; };
      if(inSpan(monthEnd)||inSpan(reportDate)){ visibleSet.add(dc.ci); return; }
      if(!monthEnd&&!reportDate&&dc.isActive){ visibleSet.add(dc.ci); }
    });
    // Always keep the current weekly AND current monthly columns, whatever their date —
    // the current monthly's coverage can start before the visible weekly span (e.g. a
    // Jul 01–31 monthly whose window begins Jul 20), so keep it by its active flag, not its date.
    dateColGroups.forEach(function(dc){ if(dc.isActive||dc.isActiveMonthly)visibleSet.add(dc.ci); });
    for(let i=dateColGroups.length-1;i>=0;i--){
      if(!visibleSet.has(dateColGroups[i].ci))dateColGroups.splice(i,1);
    }
  })();
  // Columns only reachable via "◀ Prev week" (older than the normal default 1-past-week
  // window) are marked reference-only: they render fully read-only for every role, including
  // admins, since this view exists purely for looking things up, not correcting them.
  dateColGroups.forEach(function(dc){
    dc.isRefOnly=!!(dc.weekOffset!==null&&dc.weekOffset!==undefined&&dc.weekOffset<-FR_WIN_PAST);
  });

  // ── Build header HTML ──
  // Row 0: fixed cols (rowspan = headerRows.length) + date col top labels
  const numHeaderRows=Math.max(headerRows.length,1);
  let hdr='';

  // First header row: fixed + top date labels
  hdr+='<tr>';
  // All users (including admin) get a checkbox select-all column at the start
  hdr+='<th rowspan="'+numHeaderRows+'" style="position:sticky;left:0;z-index:6;background:#0f1e3c;padding:4px 6px;border:1px solid #1e3a5f;text-align:center;vertical-align:middle;min-width:36px;width:36px" title="Select / deselect all">'
    +'<input type="checkbox" style="cursor:pointer;width:14px;height:14px;accent-color:var(--blue)" onchange="frSelectAll(\''+trackerKey+'\',\''+sheetKey+'\',this)" title="Select all brands">'
  +'</th>';
  // Sticky left offsets — shift by 36px for the checkbox col (present for all users)
  const _frCbOffset=36;
  // Hidden columns (Synagie) are already excluded from fixedRenderOrder. Compute per-data-index
  // widths, then accumulate sticky-left offsets in VISUAL (render) order so the moved Status
  // column and every other fixed column sit at the correct frozen position with no gaps.
  const SYNAGIE_IDX=_synagieIdx;
  const isHiddenFixedCol=function(i){return i===SYNAGIE_IDX;};
  const COL_WIDTHS_DEFAULT=[80,80,110,130,150,130,130];
  const COL_WIDTHS=Array.from({length:fixedCount},function(_,i){return isHiddenFixedCol(i)?0:(COL_WIDTHS_DEFAULT[i]||130);});
  const stickyLefts=[];stickyLefts.length=fixedCount;
  (function(){var acc=_frCbOffset;fixedRenderOrder.forEach(function(i){stickyLefts[i]=acc;acc+=(COL_WIDTHS[i]||0);});})();
  // The last VISUAL fixed column (now Team Lead's Status, if present) carries the freeze shadow.
  const _lastRenderIdx=fixedRenderOrder.length?fixedRenderOrder[fixedRenderOrder.length-1]:(fixedCount-1);
  fixedRenderOrder.forEach(function(i){
    const l=fixedLabels[i];
    const sl=stickyLefts[i]!==undefined?stickyLefts[i]:0;
    const minW=COL_WIDTHS[i]||80;
    const isLastSticky=i===_lastRenderIdx;
    const stickyStyle='position:sticky;left:'+sl+'px;z-index:5;'+(isLastSticky?'box-shadow:2px 0 4px rgba(0,0,0,0.08);':'');
    // Admin can edit fixed column header labels inline
    const headerContent=isAdmin
      ?'<input type="text" value="'+escHtml(l)+'" title="Click to edit column header"'
        +' onchange="frUpdateFixedHeader(\''+trackerKey+'\',\''+sheetKey+'\','+i+',this.value)"'
        +' style="background:transparent;border:none;outline:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94b8d8;width:100%;cursor:text;font-family:inherit"'
        +' onfocus="this.style.background=\'#fff\';this.style.border=\'1px solid var(--blue)\';this.style.borderRadius=\'3px\';this.style.padding=\'1px 4px\'"'
        +' onblur="this.style.background=\'transparent\';this.style.border=\'none\';this.style.padding=\'0\'"/>'
      :escHtml(l);
    hdr+='<th rowspan="'+numHeaderRows+'" data-sticky="1" style="'+stickyStyle+'background:#0f1e3c;padding:4px 6px;border:1px solid #1e3a5f;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94b8d8;text-align:left;vertical-align:middle;white-space:nowrap;min-width:'+minW+'px">'+headerContent+'</th>';
  });
  dateColGroups.forEach(function(dc){
    // ── Dark navy header styling (matches source file) ──
    const bg = '#0f1e3c';
    const fg = '#ffffff';

    // ── Resolve header entry: generic parser first, legacy map as fallback ──
    let entry = dc.entry || frParseHeaderInfo(platform, dc.topLabel, dc.subLabels);
    if (!entry.shortLabel) {
      const _allText = [dc.topLabel||'', ...dc.subLabels].join('  ').replace(/\s+/g,' ').trim();
      const _norm = function(s){return s.replace(/\s+/g,' ').trim();};
      let legacy = FR_HEADER_MAP[dc.topLabel ? dc.topLabel.trim() : ''];
      if (!legacy) legacy = FR_HEADER_MAP[_allText];
      if (!legacy) {
        const _ek = Object.keys(FR_HEADER_MAP).find(function(k){ return _norm(k) === _norm(dc.topLabel||''); });
        if (_ek) legacy = FR_HEADER_MAP[_ek];
      }
      if (!legacy) {
        const _ek2 = Object.keys(FR_HEADER_MAP).find(function(k){ return _norm(k) === _norm(_allText); });
        if (_ek2) legacy = FR_HEADER_MAP[_ek2];
      }
      if (legacy) entry = legacy;
      else entry = null;
    }

    // ── Compute Report Date ──
    // Two distinct rules, applied identically on Lazada, Shopee and TikTok:
    //  • MONTHLY column  → report date is always the 1st of the month FOLLOWING its coverage
    //                      (June coverage → Jul 1, July coverage → Aug 1). It is NOT part of the
    //                      weekly sequence and never shifts the weekly dates.
    //  • WEEKLY column   → rolling anchored due-day: anchor today (shifted by the platform's
    //                      reporting lag), snap forward to the platform's due day-of-week, then
    //                      shift by this column's weekOffset (which counts weekly columns only,
    //                      so an interleaved monthly column never eats a week slot).
    var MONTHS_IDX={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    var MONTHS_STR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var reportDateStr = '';
    var _dueDow = (FR_DOW[platform]!==undefined ? FR_DOW[platform] : 4); // Shopee/TikTok=Thu(4), Lazada=Tue(2)

    if (dc.isMonthlyCol) {
      // Monthly report → 1st of the month after the coverage month. Prefer the latest date the
      // header parser found (e.g. June 30 → July); fall back to scanning the header text for a month.
      var _covMonth = null, _covYear = now().getFullYear();
      if (entry && entry.latestDate) { _covMonth = entry.latestDate.getMonth(); _covYear = entry.latestDate.getFullYear(); }
      if (_covMonth === null && entry && entry.rows) {
        for (var _ri=0; _ri<entry.rows.length; _ri++) {
          var _mm = String(entry.rows[_ri].v||'').match(/([A-Za-z]{3,})/);
          if (_mm) { var _mi=MONTHS_IDX[_mm[1].toLowerCase().slice(0,3)]; if(_mi!==undefined){_covMonth=_mi;break;} }
        }
      }
      if (_covMonth !== null) {
        var _nm = _covMonth + 1, _ny = _covYear;
        if (_nm > 11) { _nm = 0; _ny = _covYear + 1; }
        var _md = new Date(_ny, _nm, 1);
        reportDateStr = MONTHS_STR[_md.getMonth()] + ' ' + _md.getDate();
      }
    } else if (dc.weekOffset !== null && dc.weekOffset !== undefined) {
      // ── Report Date is derived from THIS column's own coverage window ──
      // The report is due on the platform's due day-of-week (Lazada=Tue, Shopee/TikTok=Thu)
      // on or immediately after the latest date the column covers. Reading the date straight
      // from each column (instead of anchoring on "today" and counting week slots) makes every
      // column self-correct and stay aligned to its real coverage:
      //   • Lazada  Transaction 20–26 Jul (Withdrawal 27 Jul) → Tue 28 Jul
      //   • Lazada  Transaction 27 Jul–02 Aug (Withdrawal 03 Aug) → Tue 04 Aug
      //   • Shopee  Income 22–28 Jul / SW & Order 23–29 Jul → Thu 30 Jul
      var _snapOnOrAfter = function (date, dow) {
        var d = new Date(date.getTime());
        for (var i = 0; i < 8; i++) { if (d.getDay() === dow) return d; d.setDate(d.getDate() + 1); }
        return d;
      };
      var _cov = (dc.entry && dc.entry.latestDate) ? dc.entry.latestDate
               : (entry && entry.latestDate) ? entry.latestDate : null;
      if (_cov) {
        var _rd = _snapOnOrAfter(new Date(_cov.getFullYear(), _cov.getMonth(), _cov.getDate()), _dueDow);
        reportDateStr = MONTHS_STR[_rd.getMonth()] + ' ' + _rd.getDate();
      } else {
        // Fallback: no parseable coverage date on this column — anchor on today + week slot.
        var _platLag = (typeof FR_WEEK_OFFSET !== 'undefined' && FR_WEEK_OFFSET[platform]) ? FR_WEEK_OFFSET[platform] : 0;
        var _anchor = new Date(now().getFullYear(), now().getMonth(), now().getDate());
        _anchor.setDate(_anchor.getDate() + _platLag*7);
        var _dowMon = (_anchor.getDay() + 6) % 7;                 // Mon=0 … Sun=6
        _anchor.setDate(_anchor.getDate() - _dowMon);             // back to Monday of this week
        _anchor.setDate(_anchor.getDate() + ((_dueDow + 6) % 7)); // forward to due day, same week
        _anchor.setDate(_anchor.getDate() + dc.weekOffset*7);
        reportDateStr = MONTHS_STR[_anchor.getMonth()] + ' ' + _anchor.getDate();
      }
    } else if (entry && entry.rows) {
      // Fallback: no active column resolved — derive from the column's own header text.
      function _parseFirstDate(str) {
        if (!str) return null;
        var m = String(str).match(/(\d{1,2})\s+([A-Za-z]{3})/);
        if (!m) return null;
        var mIdx = MONTHS_IDX[m[2].toLowerCase()];
        if (mIdx === undefined) return null;
        var yr = new Date().getFullYear();
        var d = new Date(yr, mIdx, parseInt(m[1]));
        if (d - new Date() > 183*86400000) d = new Date(yr-1, mIdx, parseInt(m[1]));
        return d;
      }
      function _nextDow(date, dow) {
        var d = new Date(date.getTime());
        for (var i=0;i<8;i++){if(d.getDay()===dow)return d;d.setDate(d.getDate()+1);}
        return d;
      }
      function _findRow(pat) { return entry.rows.find(function(r){return pat.test(r.l);}) || null; }
      var rdDate = null;
      var incRow = _findRow(/^income$/i) || _findRow(/^withdrawal$/i);
      if (incRow && incRow.v) { var id=_parseFirstDate(incRow.v); if(id)rdDate=_nextDow(id,_dueDow); }
      if (rdDate) reportDateStr = MONTHS_STR[rdDate.getMonth()] + ' ' + rdDate.getDate();
    }

    // ── Build 4 data rows ──
    // For Lazada the 4 rows are: Monthly Report, Transaction Report, Withdrawal Report, Withdrawal - Screenshots
    var DEFAULT_ROW_LABELS_LZ = ['Monthly Report','Transaction Report','Withdrawal Report','Withdrawal - Screenshots'];
    var dataRowsHtml = '';
    var entryRows = (entry && entry.rows) ? entry.rows.map(function(r){return {l:r.l,v:r.v};})
      : DEFAULT_ROW_LABELS_LZ.map(function(l){ return {l:l, v:''}; });
    // Pad to at least 4 rows so admin always sees all 4 inputs
    while(entryRows.length < DEFAULT_ROW_LABELS_LZ.length){
      entryRows = entryRows.concat([{l: DEFAULT_ROW_LABELS_LZ[entryRows.length], v:''}]);
    }
    // Apply any admin overrides saved via frUpdateCWRowValue
    var _cwOverrides = ((sheet.cwRowValues||{})[dc.ci])||{};
    entryRows = entryRows.map(function(r,i){
      return (_cwOverrides[i]!==undefined && _cwOverrides[i]!==null) ? {l:r.l, v:_cwOverrides[i]} : r;
    });
    var _dcCiEsc = dc.ci;
    dataRowsHtml = entryRows.map(function(r, rIdx){
      var valHtml = isAdmin
        ? '<input type="text" value="'+escHtml(r.v||'')+'" placeholder="—"'
            +' onchange="frUpdateCWRowValue(\''+trackerKey+'\',\''+sheetKey+'\','+_dcCiEsc+','+rIdx+',this.value)"'
            +' style="background:transparent;border:none;border-bottom:1px dashed rgba(255,255,255,.25);outline:none;font-size:9px;font-weight:500;color:#fff;width:80px;text-align:right;font-family:inherit;cursor:text"'
            +' onfocus="this.style.background=\'rgba(255,255,255,.1)\';this.style.borderRadius=\'3px\';this.style.borderBottom=\'1px solid var(--blue)\'"'
            +' onblur="this.style.background=\'transparent\';this.style.borderRadius=\'0\';this.style.borderBottom=\'1px dashed rgba(255,255,255,.25)\'"/>'
        : (r.v ? '<span style="color:#fff;font-size:9px;font-weight:500;text-align:right">'+escHtml(r.v)+'</span>' : '');
      return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:2px 0;white-space:nowrap">'
        + '<span style="color:rgba(255,255,255,.75);font-size:9px;font-weight:600;flex-shrink:0">'+escHtml(r.l)+':</span>'
        + valHtml
        + '</div>';
    }).join('');

    // ── Build Input Date row ──
    // Standardized label across every column (weekly, monthly, past, current, future):
    // always "Input Date :" — the date shown is the day the report is input/submitted.
    var reportDateLabel = 'Input Date :';
    var reportRowHtml = reportDateStr
      ? '<div style="margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.2);display:flex;justify-content:space-between;align-items:baseline;gap:8px;white-space:nowrap">'
          + '<span style="color:rgba(255,255,255,.65);font-size:9px;font-weight:600">' + reportDateLabel + '</span>'
          + '<span style="color:#fff;font-size:9px;font-weight:700">' + reportDateStr + '</span>'
          + '</div>'
      : '';

    // ── Build tooltip (hover) ──
    const _colDR = frGetColDateRanges(platform, dc.parsedDate, dc.topLabel, dc.subLabels);
    const colTooltipHTML = _colDR.tooltipHTML || '';

    // ── Assemble cell content ──
    const cellContent = '<div style="width:100%;position:relative">'
      + dataRowsHtml
      + reportRowHtml
      + (colTooltipHTML
          ? '<button onmouseenter="frShowCWTip(this,\'' + colTooltipHTML.replace(/\\/g,'\\\\').replace(/'/g,'&#39;').replace(/"/g,'&quot;') + '\')" onmouseleave="frHideCWTip()" style="position:absolute;bottom:0;right:0;background:rgba(255,255,255,.15);border:none;border-radius:3px;color:#fff;font-size:9px;padding:1px 5px;cursor:pointer;line-height:1.4">▾</button>'
          : '')
      + '</div>';

    // Header accent: current weekly → amber top border, current monthly → green top border,
    // reference-only (older week revealed via "◀ Prev week") → dashed amber border + pin marker,
    // so the two current columns AND any reference-only columns are distinguishable at a glance.
    const _hdrAccent=(dc.isActive||dc.isActiveMonthly)?'border-top:3px solid #22c55e;':(dc.isRefOnly?'border-top:3px dashed #f59e0b;':'');
    hdr+='<th ' + (dc.isActive?'data-active="1" ':'') + (dc.isActiveMonthly?'data-active-monthly="1" ':'') + (dc.isRefOnly?'title="Reference view — older week (read-only for everyone)" ':'') + ' class="fr-cw-th-cell" style="text-align:left;padding:8px 10px;background:' + (dc.isRefOnly?'#1a2942':bg) + ';border:1px solid #1e3a5f;'+_hdrAccent+'color:' + fg + ';min-width:160px;white-space:normal;line-height:1.4;vertical-align:top;position:relative">'
      + (dc.isRefOnly?'<span style="position:absolute;top:4px;right:6px;font-size:11px" title="Reference view — read only">📌</span>':'')
      + cellContent
    + '</th>';
  });
    hdr+='</tr>';

  // Sub-header rows
  for(let ri=1;ri<numHeaderRows;ri++){
    hdr+='<tr>';
    dateColGroups.forEach(function(dc){
      const bg='#0f1e3c';
      const fg='#94b8d8';
      const sub=dc.subLabels[ri-1]||'';
      // Abbreviated label: extract type keyword (SW, Income, Order, etc.) for compact display
      const subKeyMatch=sub.match(/^([A-Za-z\s]+?)[:：\s]/);
      const subKey=subKeyMatch?subKeyMatch[1].trim():sub.slice(0,8);
      const subContent=isAdmin
        ?'<input type="text" value="'+escHtml(sub)+'" title="Edit sub-header"'
          +' onchange="frUpdateDateColHeader(\''+trackerKey+'\',\''+sheetKey+'\','+dc.ci+','+ri+',this.value)"'
          +' style="background:transparent;border:none;outline:none;font-size:9px;font-weight:600;color:'+fg+';width:100%;text-align:center;cursor:text;font-family:inherit"'
          +' onfocus="this.style.background=\'#fff\';this.style.border=\'1px solid var(--blue)\';this.style.borderRadius=\'3px\';this.style.padding=\'1px 3px\';this.style.color=\'var(--text)\'"'
          +' onblur="this.style.background=\'transparent\';this.style.border=\'none\';this.style.padding=\'0\';this.style.color=\''+fg+'\'"/>'
        :(sub?'<span style="font-size:9px;font-weight:500;color:'+fg+';cursor:default;white-space:normal">'+escHtml(sub)+'</span>':'');
      hdr+='<th style="display:none">'+subContent+'</th>';
    });
    hdr+='</tr>';
  }

  // ── Dynamically detect which fixed column index is Account Status and Brand/Store Name ──
  // This avoids bugs when the Excel has fewer/more fixed columns than the default 7.
  const ACCT_STATUS_IDX=fixedLabels.findIndex(function(l){return /account.?status|acct.?status/i.test(l);});
  const BRAND_IDX=fixedLabels.findIndex(function(l){return /brand|store.?name/i.test(l);});
  const EXEC_IDX=fixedLabels.findIndex(function(l){return /exec/i.test(l);});
  const EXIT_DATE_IDX=fixedLabels.findIndex(function(l){return /exit|offboard/i.test(l);});
  // Fallback to positional defaults if not found
  const acctStatusCol=ACCT_STATUS_IDX>=0?ACCT_STATUS_IDX:2;
  const brandCol=BRAND_IDX>=0?BRAND_IDX:4;
  const execCol=EXEC_IDX>=0?EXEC_IDX:5;
  const exitDateCol=EXIT_DATE_IDX>=0?EXIT_DATE_IDX:7;
  const tlCol=fixedCount-1; // Team Lead is last fixed col
  // Build a dropdown of registered members for Exec/CDM and Team Lead assignment — mirrors the
  // AO tracker's aoMemberOpts so access control always matches a real login name exactly.
  const frMemberOpts=function(i2v){
    const cur=(i2v||'').trim();
    let opts='<option value="">— Unassigned —</option>';
    const seen={};
    (D.members||[]).filter(function(m){return m.approved&&m.active!==false;}).forEach(function(m){
      seen[m.name]=1;
      opts+='<option value="'+escHtml(m.name)+'"'+(m.name===cur?' selected':'')+'>'+escHtml(m.name)+' ('+escHtml(m.role||'Member')+')</option>';
    });
    if(cur&&!seen[cur])opts+='<option value="'+escHtml(cur)+'" selected>'+escHtml(cur)+' (unmatched — pick a member)</option>';
    return opts;
  };

  // Get members tagged to FR tasks for this platform
  const frTask=(D.tasks||[]).find(function(t){return t.frLinked&&(t.frPlatform===platform||(String(t.title||'').toLowerCase().includes(platform.toLowerCase())));});
  const taggedMembers=frTask?(frTask.assignees||[]):[];

  // ── Unique table ID for row selection state ──
  const selStateKey='_frSel_'+trackerKey+'_'+sheetKey;
  if(!window[selStateKey])window[selStateKey]=new Set();
  const selRows=window[selStateKey];

  // ── Data rows ──
  const dataRows=rows.filter(function(r){
    if(!r||r[0]==null||!String(r[0]).trim())return false;
    // Exited / Inactive brands never appear in the active platform view — they live exclusively
    // in the Exited roll-up tab. (Previously they were rendered here greyed-out, which is what
    // left an exited Lazada brand lingering in the active tab.)
    const _st=String(r[acctStatusCol]||'').trim().toLowerCase();
    if(_st==='exited'||_st==='inactive')return false;
    // Apply text filters
    if(_frFilter.region&&!String(r[0]||'').toLowerCase().includes(_frFilter.region.toLowerCase()))return false;
    if(_frFilter.brand&&!String(r[brandCol]||'').toLowerCase().includes(_frFilter.brand.toLowerCase()))return false;
    if(_frFilter.exec&&!String(r[execCol]||'').toLowerCase().includes(_frFilter.exec.toLowerCase()))return false;
    if(_frFilter.tl&&!String(r[tlCol]||'').toLowerCase().includes(_frFilter.tl.toLowerCase()))return false;
    return true;
  });
  // ── Auto-group per CDM name, then brand name ──
  // FR's CDM is the Exec column. Sorting here (not the underlying rows array) keeps each row's
  // true index intact for edits, since bodyRows resolves rowIdx via rows.indexOf(row). Newly-added
  // brands therefore slot into their CDM group in brand order automatically on the next render.
  dataRows.sort(function(a,b){
    const ca=String(a[execCol]||'').trim().toLowerCase();
    const cb=String(b[execCol]||'').trim().toLowerCase();
    if(ca!==cb){if(!ca)return 1;if(!cb)return -1;return ca<cb?-1:1;}
    const ba=String(a[brandCol]||'').trim().toLowerCase();
    const bb=String(b[brandCol]||'').trim().toLowerCase();
    if(ba!==bb)return ba<bb?-1:1;
    return rows.indexOf(a)-rows.indexOf(b);
  });
  // Total number of columns in a full row (checkbox + visible fixed + date groups), for the
  // group-divider colspan. Subtract any hidden fixed columns (Synagie Merchant ID).
  const _hiddenFixedCount=(SYNAGIE_IDX>=0&&SYNAGIE_IDX<fixedCount)?1:0;
  const _frTotalCols=1+(fixedCount-_hiddenFixedCount)+dateColGroups.length;
  let _frPrevCdm=null;
  const bodyRows=dataRows.map(function(row){
    const rowIdx=rows.indexOf(row);
    // CDM group divider whenever the Exec/CDM changes between rows.
    let _frGroupHtml='';
    const _cdmName=String(row[execCol]||'').trim();
    const _cdmKey=_cdmName.toLowerCase();
    if(_cdmKey!==_frPrevCdm){
      _frPrevCdm=_cdmKey;
      _frGroupHtml='<tr><td colspan="'+_frTotalCols+'" style="position:sticky;left:0;background:#eef2f7;border:1px solid var(--border);padding:4px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3)">👤 CDM: '+escHtml(_cdmName||'— Unassigned —')+'</td></tr>';
    }
    const execName=String(row[execCol]||'').trim();
    const isTaggedRow=taggedMembers.some(function(u){const m=D.members.find(function(x){return x.username===u;});return m&&(m.name===execName||execName.toLowerCase().includes((m.name||'').toLowerCase()));});
    const acctStatus=String(row[acctStatusCol]||'').trim().toLowerCase();
    const isInactive=acctStatus==='inactive';
    const isExited=acctStatus==='exited';
    const rowOpacity=isInactive||isExited?'opacity:.55;':'';
    const isSel=selRows.has(rowIdx);
    const rowStyle=isExited?'background:#fff8f8;'+rowOpacity:(isInactive?'background:#fffbeb;'+rowOpacity:(isSel?'background:#eff6ff;outline:2px solid var(--blue);outline-offset:-2px;':(isTaggedRow?'background:rgba(37,99,235,0.04);border-left:3px solid var(--blue-mid);':'')));

    let cells='';
    // Selection checkbox cell — all users (including admin) can select rows
    if(!isExited&&!isInactive){
      cells+='<td style="position:sticky;left:0;z-index:3;padding:3px 6px;border:1px solid var(--border);background:'+(isSel?'#dbeafe':'var(--surface)')+';text-align:center;vertical-align:middle;cursor:pointer;min-width:36px;width:36px" onclick="frToggleRowSel(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+')" title="Click to select this brand">'
        +'<input type="checkbox" '+(isSel?'checked':'')+' data-frsel-row="'+rowIdx+'" data-frsel-tk="'+trackerKey+'" data-frsel-sk="'+sheetKey+'" style="cursor:pointer;width:14px;height:14px;accent-color:var(--blue)" onclick="event.stopPropagation();frToggleRowSel(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+')">'
        +'</td>';
    } else {
      cells+='<td style="position:sticky;left:0;z-index:3;padding:3px 6px;border:1px solid var(--border);background:var(--surface);min-width:36px;width:36px"></td>';
    }

    // Fixed cells — rendered in fixedRenderOrder (Synagie hidden, Status moved after Team Lead).
    fixedRenderOrder.forEach(function(i){
      const v=(row[i]===null||row[i]===undefined)?'':String(row[i]);
      const sl=stickyLefts[i]!==undefined?stickyLefts[i]:0;
      const isLastStickyCell=i===_lastRenderIdx;
      const stickyTdStyle='position:sticky;left:'+sl+'px;z-index:2;'+(isLastStickyCell?'box-shadow:2px 0 4px rgba(0,0,0,0.06);':'');
      if(i===acctStatusCol){
        // Acct Status — inline dropdown (admin: all options; CDM: Active/Inactive only on own row)
        const isMyRow=execName===myName;
        const canChangeStatus=isAdmin||isMyRow;
        const statusColor=v.toLowerCase()==='active'?'var(--green)':v.toLowerCase()==='inactive'?'var(--yellow)':v.toLowerCase()==='exited'?'var(--red)':'var(--text3)';
        const statusBg=v.toLowerCase()==='active'?'var(--green-light)':v.toLowerCase()==='inactive'?'var(--yellow-light)':v.toLowerCase()==='exited'?'var(--red-light)':'var(--bg)';
        const exitDateStr=String(row[exitDateCol]||'').trim();
        const exitInfo=(v.toLowerCase()==='exited'&&exitDateStr)?'<div style="font-size:9px;color:var(--red);margin-top:2px">Exit: '+escHtml(exitDateStr)+'</div>':'';
        if(canChangeStatus){
          const statusOpts=(isAdmin?['Active','Inactive','Exited']:['Active','Inactive'])
            .map(function(s){return'<option value="'+s+'"'+(v===s?' selected':'')+'>'+s+'</option>';}).join('');
          cells+='<td style="'+stickyTdStyle+'padding:4px 8px;border:1px solid var(--border);background:var(--surface);white-space:nowrap">'
            +'<div style="display:flex;flex-direction:column;align-items:flex-start">'
              +'<select onchange="frInlineStatusChange(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+',this.value,this)"'
              +' style="padding:2px 6px;border-radius:20px;border:1px solid '+statusColor+';background:'+statusBg+';color:'+statusColor+';font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;appearance:auto">'
              +statusOpts
              +'</select>'
              +exitInfo
            +'</div>'
          +'</td>';
        } else {
          cells+='<td style="'+stickyTdStyle+'padding:4px 8px;border:1px solid var(--border);background:var(--surface);white-space:nowrap">'
            +'<div style="display:flex;flex-direction:column;align-items:flex-start">'
              +'<span style="padding:2px 9px;border-radius:20px;border:1px solid '+statusColor+';background:'+statusBg+';color:'+statusColor+';font-size:11px;font-weight:700;white-space:nowrap">'+(v||'—')+'</span>'
              +exitInfo
            +'</div>'
          +'</td>';
        }
      } else if(i===execCol||i===tlCol){
        // Exec/CDM and Team Lead — admin-editable dropdown sourced from registered members,
        // same pattern as the AO tracker, so row-level edit access always matches a real login.
        if(isAdmin){
          cells+='<td style="'+stickyTdStyle+'padding:4px 6px;border:1px solid var(--border);background:var(--surface);white-space:nowrap">'
            +'<select onchange="frSetRowAssignee(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+','+i+',this.value)" style="width:100%;max-width:'+((COL_WIDTHS[i]||130)-6)+'px;padding:2px 3px;font-size:11px;border:1px solid var(--border);border-radius:3px;background:#fff">'+frMemberOpts(v)+'</select>'
          +'</td>';
        } else {
          cells+='<td style="'+stickyTdStyle+'padding:5px 8px;border:1px solid var(--border);font-size:12px;background:var(--surface);white-space:nowrap;color:var(--text2)">'+(v?escHtml(v):'<span style="color:var(--text4)">— Unassigned —</span>')+'</td>';
        }
      } else if(i===brandCol){
        // Brand / Store Name — admin-editable text input; plain text for everyone else
        if(isAdmin){
          cells+='<td style="'+stickyTdStyle+'padding:3px 6px;border:1px solid var(--border);background:var(--surface);white-space:nowrap">'
            +'<input type="text" value="'+escHtml(v).replace(/"/g,'&quot;')+'" onchange="frUpdateFixedCell(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+','+i+',this.value)" style="width:100%;max-width:'+((COL_WIDTHS[i]||150)-10)+'px;padding:3px 6px;font-size:12px;font-weight:600;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--text2)" onfocus="this.style.background=\'#fff\';this.style.border=\'1px solid var(--blue)\'" onblur="this.style.background=\'transparent\';this.style.border=\'1px solid transparent\'"/>'
          +'</td>';
        } else {
          cells+='<td style="'+stickyTdStyle+'padding:5px 8px;border:1px solid var(--border);font-size:12px;background:var(--surface);white-space:nowrap;color:var(--text2);font-weight:600">'+escHtml(v)+'</td>';
        }
      } else {
        // Region, Platform, Synagie Merchant ID, etc. — admin-editable text input
        if(isAdmin){
          cells+='<td style="'+stickyTdStyle+'padding:3px 6px;border:1px solid var(--border);background:var(--surface);white-space:nowrap">'
            +'<input type="text" value="'+escHtml(v).replace(/"/g,'&quot;')+'" onchange="frUpdateFixedCell(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+','+i+',this.value)" style="width:100%;max-width:'+((COL_WIDTHS[i]||80)-10)+'px;padding:3px 6px;font-size:12px;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--text2)" onfocus="this.style.background=\'#fff\';this.style.border=\'1px solid var(--blue)\'" onblur="this.style.background=\'transparent\';this.style.border=\'1px solid transparent\'"/>'
          +'</td>';
        } else {
          cells+='<td style="'+stickyTdStyle+'padding:5px 8px;border:1px solid var(--border);font-size:12px;background:var(--surface);white-space:nowrap;color:var(--text2)">'+escHtml(v)+'</td>';
        }
      }
    });

    // Date cols — past columns are admin-only to edit/correct; active & future remain editable
    // for the row's assigned Exec/CDM or Team Lead (or their buddy, or admin); everyone else is
    // read-only, same ownership model as the AO tracker. TOD members follow the exact same rule
    // now — they can edit rows they're assigned to, and are read-only everywhere else.
    const rowOwner=frIsRowOwner(row,execCol,tlCol);
    dateColGroups.forEach(function(dc){
      const v=row[dc.ci];
      const vS=(v===null||v===undefined)?'':String(v);
      const isDone=frIsDone(v);
      const pastLockedForUser=dc.isPast&&(!isAdmin||dc.isRefOnly);
      const notOwnerLocked=!rowOwner&&!pastLockedForUser&&!dc.isFuture;
      if(pastLockedForUser||notOwnerLocked){
        // Past column locked to admin, or this row isn't assigned to the current user: read-only
        // Highlight priority: Done (green fill) → current monthly (mint/green) → current weekly (yellow)
        // → past (grey) → future (indigo tint).
        const bg=isDone?'#e8f5e9':(dc.isActiveMonthly||dc.isActive)?'#e7f7ec':dc.isPast?'#fafafa':'#f5f7ff';
        const col=isDone?'#388e3c':(dc.isActiveMonthly||dc.isActive)?'#15803d':dc.isPast?'#9ca3af':'#c7d2fe';
        const frTs=((sheet.frTimestamps||{})[rowIdx+'_'+dc.ci])||'';
        const lockTitle=dc.isRefOnly?' title="Reference view — older week (read-only for everyone)"':(pastLockedForUser?' title="Past dates can only be edited by an admin"':(notOwnerLocked?' title="View only — this brand is assigned to another Exec/Team Lead"':''));
        cells+='<td style="padding:5px 8px;border:1px solid var(--border);text-align:center;background:'+(dc.isRefOnly?'#fffbeb':bg)+'"'+lockTitle+'>'
          +'<span style="font-size:11px;color:'+col+';font-weight:'+(isDone?'700':'400')+'">'+escHtml(vS)+'</span>'
          +(frTs?'<div style="font-size:9px;color:var(--text4);line-height:1.2;text-align:center">'+escHtml(frTs)+'</div>':'')
        +'</td>';
      } else {
        // Editable input for active & future columns (and past, for admins)
        // Current monthly column → green tint + green outline; current weekly → yellow + blue outline.
        const bg=isDone?'var(--green-light)':(dc.isActiveMonthly||dc.isActive)?'#e7f7ec':dc.isPast?'#fafafa':'#f5f7ff';
        const col=isDone?'var(--green)':(dc.isActiveMonthly||dc.isActive)?'#15803d':dc.isPast?'#6b7280':'#6366f1';
        const placeholderTxt='';
        const frTs=((sheet.frTimestamps||{})[rowIdx+'_'+dc.ci])||'';
        const _outline=(dc.isActiveMonthly||dc.isActive)?';outline:1px solid #86efac;outline-offset:-1px':'';
        cells+='<td style="padding:3px 4px;border:1px solid var(--border);text-align:center;background:'+bg+_outline+'">'
          +'<input type="text" value="'+vS.replace(/"/g,'&quot;')+'" placeholder="'+placeholderTxt+'"'
          +' style="width:150px;padding:4px 6px;border:1px solid transparent;border-radius:4px;font-size:11px;text-align:center;background:transparent;color:'+col+'"'
          +' onchange="frUpdateCell(\''+trackerKey+'\',\''+sheetKey+'\','+rowIdx+','+dc.ci+',this.value)"'
          +' onfocus="this.style.outline=\'2px solid var(--blue)\';this.style.background=\'#fff\'"'
          +' onblur="this.style.outline=\'none\';this.style.background=\'transparent\'"/>'
          +(frTs?'<div style="font-size:9px;color:var(--text4);line-height:1.2;text-align:center">'+escHtml(frTs)+'</div>':'')
        +'</td>';
      }
    });
    return _frGroupHtml+'<tr style="'+rowStyle+'">'+cells+'</tr>';
  }).join('');

  // ── Footer: completion row ──
  // +1 to account for the leading checkbox column (rowspan'd in the header) so the
  // percentage cells line up under their correct date columns instead of being shifted left.
  const totalFixedCols=(fixedCount-_hiddenFixedCount)+1;
  let footerCells='<td colspan="'+totalFixedCols+'" style="position:sticky;left:0;z-index:2;box-shadow:2px 0 4px rgba(0,0,0,0.08);padding:6px 10px;font-size:11px;font-weight:700;background:#f8fafc;border:1px solid var(--border);color:var(--text2)">Completion (Active only)</td>';
  dateColGroups.forEach(function(dc){
    const colRows=dataRows.filter(function(r){
      if(!r||r[0]==null||!String(r[0]).trim())return false;
      const st=String(r[2]||'').trim().toLowerCase();
      return st!=='inactive'&&st!=='exited';
    });
    const colDone=colRows.filter(function(r){return frIsDone(r[dc.ci]);}).length;
    const colTotal=colRows.length;
    const pct=colTotal?Math.round(colDone/colTotal*100):0;
    const col=pct>=100?'var(--green)':pct>0?'var(--yellow)':'var(--red)';
    footerCells+='<td style="text-align:center;padding:6px 8px;background:#f8fafc;border:1px solid var(--border);font-weight:700;color:'+col+'">'+colDone+'/'+colTotal+' ('+pct+'%)</td>';
  });

  const selStateKey2='_frSel_'+trackerKey+'_'+sheetKey;
  const selCount=window[selStateKey2]?window[selStateKey2].size:0;

  // ── Instruction banner (shown to all users) ──
  const instrBanner='<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:linear-gradient(135deg,#eff6ff,#f0fdf4);border-bottom:2px solid var(--blue-mid)">'
      +'<span style="font-size:18px;line-height:1;flex-shrink:0">📋</span>'
      +'<div style="font-size:12px;color:var(--text2);line-height:1.6">'
        +'<div style="font-weight:700;color:var(--blue);margin-bottom:2px">How to mass-update brands to Done:</div>'
        +'<ol style="margin:0;padding-left:18px;font-size:11px;color:var(--text2)">'
          +'<li>Check the <b>☑ checkbox</b> next to each brand row you want to update — or use the <b>top checkbox</b> to select all.</li>'
          +'<li>Selected rows will be highlighted in <span style="background:#dbeafe;padding:0 4px;border-radius:3px;color:var(--blue);font-weight:600">blue</span>.</li>'
          +'<li>Click the <b style="color:var(--green)">✓ Set Selected to Done</b> button that appears to apply <b>Done</b> to the <u>current week\'s column</u> for all selected brands.</li>'
          +(isAdmin?'':'<li>Past-date columns are locked once the day has passed — only an admin can edit or correct historical entries.</li>')
        +'</ol>'
      +'</div>'
    +'</div>'
    +'<div id="fr-sel-banner-'+trackerKey+'-'+sheetKey+'" style="display:'+(selCount>0?'flex':'none')+';align-items:center;gap:10px;padding:8px 14px;background:var(--blue);border-bottom:1px solid #1d4ed8;flex-wrap:wrap">'
      +'<span id="fr-sel-count-'+trackerKey+'-'+sheetKey+'" style="font-size:12px;font-weight:700;color:#fff">'+(selCount>0?selCount+' brand'+(selCount!==1?'s':'')+' selected':'')+'</span>'
      +'<button onclick="frApplySelToDone(\''+trackerKey+'\',\''+sheetKey+'\')" style="padding:6px 18px;border:none;border-radius:var(--radius);font-size:12px;font-weight:700;background:#fff;color:var(--green);cursor:pointer;display:flex;align-items:center;gap:5px">✓ Set Selected to Done</button>'
      +'<button onclick="frSelectAll(\''+trackerKey+'\',\''+sheetKey+'\',{checked:false});renderLiveTrackers()" style="padding:6px 12px;border:1px solid rgba(255,255,255,.4);border-radius:var(--radius);font-size:11px;font-weight:600;background:transparent;color:#fff;cursor:pointer">✕ Clear selection</button>'
    +'</div>';

  const legend='<div style="display:flex;gap:14px;padding:8px 12px;border-bottom:1px solid var(--border);background:#fafafa;font-size:11px;color:var(--text3);flex-wrap:wrap;align-items:center">'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:var(--green-light);border-radius:2px;display:inline-block"></span>Done</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#e7f7ec;border:1px solid #86efac;border-radius:2px;display:inline-block"></span>Current weekly column</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#e7f7ec;border:1px solid #86efac;border-radius:2px;display:inline-block"></span>Current monthly column</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#fafafa;border:1px solid #ddd;border-radius:2px;display:inline-block"></span>Past — still editable</span>'
    +'<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;background:#f5f7ff;border:1px solid #c7d2fe;border-radius:2px;display:inline-block"></span>Future — still editable</span>'
    +(isAdmin?'<span style="font-size:10px;color:var(--blue);font-weight:600">✏️ Hover CW headers to see dates · Click sub-rows to rename</span>':'')
    +'<span style="font-size:10px;color:var(--blue);font-weight:600">'+platform+' — due every '+(targetDow===2?'Tuesday':'Thursday')+'</span>'
    +'</div>'
    ;

  const hasFRFilters=_frFilter.region||_frFilter.brand||_frFilter.exec||_frFilter.tl;
  const frFilterBar='<div style="display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);background:#f0f6ff;flex-wrap:wrap;align-items:center">'
    +'<span style="font-size:11px;font-weight:700;color:var(--blue);white-space:nowrap">🔍 Filter:</span>'
    +'<input placeholder="Region" value="'+escHtml(_frFilter.region||'')+'" oninput="frSetFilter(\'region\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:100px;font-family:inherit" />'
    +'<input placeholder="Brand" value="'+escHtml(_frFilter.brand||'')+'" oninput="frSetFilter(\'brand\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:110px;font-family:inherit" />'
    +'<input placeholder="Exec / CDM" value="'+escHtml(_frFilter.exec||'')+'" oninput="frSetFilter(\'exec\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:110px;font-family:inherit" />'
    +'<input placeholder="Team Lead" value="'+escHtml(_frFilter.tl||'')+'" oninput="frSetFilter(\'tl\',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;width:100px;font-family:inherit" />'
    +(hasFRFilters?'<button onclick="_frFilter={region:\'\',brand:\'\',exec:\'\',tl:\'\'};renderLiveTrackers()" style="padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);font-size:11px;background:#fff;cursor:pointer;color:var(--red)">✕ Clear</button>':'')
  +'</div>';

  const frTblId='fr-tbl-'+trackerKey+'-'+sheetKey;
  return'<div style="display:flex;flex-direction:column;max-height:calc(100vh - 200px);border-radius:0 0 var(--radius-lg) var(--radius-lg)">'
    +instrBanner
    +frFilterBar
    +legend
    +'<div id="'+frTblId+'" style="overflow:auto;flex:1;min-height:0;position:relative">'
      +'<table style="border-collapse:collapse;font-size:12px;min-width:100%;width:max-content">'
        +'<thead style="position:sticky;top:0;z-index:4">'+hdr+'</thead>'
        +'<tbody>'+(bodyRows||'<tr><td colspan="'+(fixedCount+1+dateColGroups.length)+'" class="empty-state">No data rows found.</td></tr>')+'</tbody>'
        +'<tfoot><tr>'+footerCells+'</tr></tfoot>'
      +'</table>'
    +'</div>'
  +'</div>'
  +'<script>(function(){setTimeout(function(){'
    +'var wrap=document.getElementById(\''+frTblId+'\');if(!wrap)return;'
    +'var active=wrap.querySelector(\'thead th[data-active="1"]\');'
    +'if(active){'
      +'var frozen=wrap.querySelectorAll(\'thead th[data-sticky="1"]\');'
      +'var frozenW=0;frozen.forEach(function(s){frozenW+=s.offsetWidth;});'
      +'wrap.scrollLeft=Math.max(0,active.offsetLeft-frozenW-4);'
    +'}'
  +'},120);})();<\/script>';
}

// Build the Exited tab — simplified view with only key columns + offboarding date
// ── Admin: add a new brand row to a Finance Report sheet ──
function frOpenAddBrand(trackerKey,sheetKey){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey]||{};
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0]:[[]]);
  const row0=headerRows[0]||[];
  const platform=sheetKey;
  const activeDefaults=(FR_PLATFORM_FIXED_DEFAULTS[platform]||FR_DEFAULT_FIXED);
  const fixedCount=(sheet.fixedColCount!=null&&sheet.fixedColCount>0)?sheet.fixedColCount:activeDefaults.length;
  const fixedLabels=[];
  for(let i=0;i<fixedCount;i++){
    const v=row0[i]!=null?String(row0[i]).trim():'';
    fixedLabels.push(v||activeDefaults[i]||FR_DEFAULT_FIXED[i]||'Col '+(i+1));
  }
  const acctStatusCol=fixedLabels.findIndex(function(l){return /account.?status|acct.?status/i.test(l);});
  const execCol=fixedLabels.findIndex(function(l){return /exec/i.test(l);});
  const tlCol=fixedCount-1;
  let memOpts='<option value="">— Unassigned —</option>';
  (D.members||[]).filter(function(m){return m.approved&&m.active!==false;}).forEach(function(m){
    memOpts+='<option value="'+escHtml(m.name)+'">'+escHtml(m.name)+' ('+escHtml(m.role||'Member')+')</option>';
  });
  let fieldsHtml='';
  for(let i=0;i<fixedCount;i++){
    const label=fixedLabels[i];
    if(/synagie|merchant/i.test(String(label||'')))continue; // Synagie Merchant ID hidden — left blank
    if(i===acctStatusCol){
      fieldsHtml+='<div class="fg"><label class="flabel">'+escHtml(label)+'</label><select class="finput nb" id="frab-f-'+i+'"><option>Active</option><option>Inactive</option><option>Exited</option></select></div>';
    } else if(i===execCol||i===tlCol){
      fieldsHtml+='<div class="fg"><label class="flabel">'+escHtml(label)+'</label><select class="finput nb" id="frab-f-'+i+'">'+memOpts+'</select></div>';
    } else {
      fieldsHtml+='<div class="fg"><label class="flabel">'+escHtml(label)+'</label><input class="finput nb" id="frab-f-'+i+'" placeholder="e.g. '+escHtml(label)+'"/></div>';
    }
  }
  document.getElementById('mltar-body').innerHTML=fieldsHtml
    +'<div class="form-actions">'
      +'<button class="btn primary" onclick="frSaveNewBrand(\''+trackerKey+'\',\''+sheetKey+'\','+fixedCount+')">Add Brand</button>'
      +'<button class="btn" onclick="closeModal(\'modal-lt-addrow\')">Cancel</button>'
    +'</div>';
  document.getElementById('modal-lt-addrow').querySelector('h3').textContent='Add New Brand — '+sheetKey;
  openModal('modal-lt-addrow');
}
async function frSaveNewBrand(trackerKey,sheetKey,fixedCount){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];if(!t){toast('Tracker not found.');return;}
  const sheet=(t.sheets||{})[sheetKey];if(!sheet){toast('Sheet not found.');return;}
  const newRow=[];
  for(let i=0;i<fixedCount;i++){
    const el=document.getElementById('frab-f-'+i);
    newRow.push(el?el.value.trim():'');
  }
  if(!newRow[0]&&!newRow.some(function(v,i){return i!==0&&v;})){toast('Please fill in at least the Region/Brand fields.');return;}
  const rows=(sheet.rows||[]).slice();
  rows.push(newRow);
  D.trackers[trackerKey].sheets[sheetKey].rows=rows;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows',rows);
  closeModal('modal-lt-addrow');
  toast('Brand added to '+sheetKey+'.');
  renderLiveTrackers();
}

function buildExitedTable(trackerKey,sheetKey,sheet){
  const COLS=[
    {label:'Region',idx:0,w:80},
    {label:'Team Lead',idx:6,w:130},
    {label:'Exec',idx:5,w:140},
    {label:'Platform',idx:1,w:100},
    {label:'Store Name',idx:4,w:180},
    {label:'Status',idx:2,w:90},
    {label:'Offboarding Date',idx:7,w:130},
  ];
  const isAdmin=CU.isAdmin;
  const t=D.trackers[trackerKey]||{};
  const allSheets=t.sheets||{};
  // ── Aggregate every Exited / Inactive brand across ALL platform tabs ──
  // The Exited tab is a single roll-up of all offboarded/inactive accounts, no matter which
  // platform sheet they physically live in and no matter HOW their status was set — whether
  // through the in-app status toggle (which also copies them into the dedicated "Exited" sheet)
  // or imported already-exited from Excel (which does NOT). Scanning the live platform sheets
  // here — rather than reading only the separate "Exited" sheet — means a brand marked Exited/
  // Inactive anywhere shows up here automatically, self-healing rows the old copy-based flow
  // missed (e.g. a Lazada brand imported as Exited that stayed stuck in the active tab).
  // Each collected row remembers its SOURCE sheet + row index so admin edits (offboarding date,
  // delete) act on the real record, not on a detached copy.
  function _statusOf(r){
    // Account Status lives in col 2 by default; detect dynamically from that sheet's header.
    return r? String(r[2]||'').trim().toLowerCase() : '';
  }
  const collected=[];
  const seen=new Set();
  Object.keys(allSheets).forEach(function(sk){
    if(sk==='Exited')return; // handled below as a fallback source
    const s=allSheets[sk];if(!s||!s.rows)return;
    s.rows.forEach(function(r,ri){
      if(!r)return;
      const st=_statusOf(r);
      if(st!=='exited'&&st!=='inactive')return;
      const idKey=String(r[3]||'').trim()+'||'+String(r[4]||'').trim();
      if(seen.has(idKey))return;
      seen.add(idKey);
      collected.push({row:r,srcSheet:sk,srcRowIdx:ri});
    });
  });
  // Also fold in the dedicated "Exited" sheet for any records whose original platform row was
  // already deleted but which should still appear in the roll-up (deduped against live rows).
  const exitedSheet=allSheets['Exited'];
  if(exitedSheet&&exitedSheet.rows){
    exitedSheet.rows.forEach(function(r,ri){
      if(!r)return;
      const idKey=String(r[3]||'').trim()+'||'+String(r[4]||'').trim();
      if(seen.has(idKey))return;
      seen.add(idKey);
      collected.push({row:r,srcSheet:'Exited',srcRowIdx:ri});
    });
  }
  const deduped=collected;
  const colSpan=COLS.length+(isAdmin?1:0);
  const hdrCells=COLS.map(c=>'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:left;white-space:nowrap;min-width:'+c.w+'px">'+c.label+'</th>').join('');
  const hdr='<tr>'+hdrCells+(isAdmin?'<th style="padding:5px 10px;background:#ffeaea;border:1px solid var(--border);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b91c1c;text-align:center;white-space:nowrap;min-width:80px">Actions</th>':'')+'</tr>';
  const _sheetEsc=function(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");};
  const body=deduped.length?deduped.map(function(item){
    const row=item.row;
    const _src=_sheetEsc(item.srcSheet);
    const _sri=item.srcRowIdx;
    const cells=COLS.map(function(c){
      const v=row[c.idx]!=null?String(row[c.idx]).trim():'—';
      if(c.idx===2){
        const _sv=(v&&v!=='—')?v:'Exited';
        const _isInact=_sv.toLowerCase()==='inactive';
        const _bg=_isInact?'var(--yellow-light)':'var(--red-light)';
        const _fg=_isInact?'#92400e':'var(--red)';
        const _bd=_isInact?'var(--yellow)':'var(--red)';
        // Show which platform tab the brand came from, so the roll-up stays traceable.
        const _srcTag=(item.srcSheet&&item.srcSheet!=='Exited')?'<div style="font-size:8px;color:var(--text4);margin-top:2px">from '+escHtml(item.srcSheet)+'</div>':'';
        return'<td style="padding:5px 10px;border:1px solid var(--border);background:#fff8f8;white-space:nowrap"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:'+_bg+';color:'+_fg+';border:1px solid '+_bd+'">'+escHtml(_sv)+'</span>'+_srcTag+'</td>';
      }
      if(c.idx===7){
        if(isAdmin){return'<td style="padding:4px 8px;border:1px solid var(--border);background:#fff8f8;white-space:nowrap"><input type="date" value="'+escHtml(v==='—'?'':v)+'" style="border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-size:12px;color:var(--red);font-family:inherit;width:120px" onchange="frUpdateExitDate(\''+trackerKey+'\',\''+_src+'\','+_sri+',this.value)"/></td>';}
        return'<td style="padding:5px 10px;border:1px solid var(--border);background:#fff8f8;font-size:12px;color:var(--red);font-weight:600;white-space:nowrap">'+escHtml(v)+'</td>';
      }
      return'<td style="padding:5px 10px;border:1px solid var(--border);font-size:12px;color:var(--text2);white-space:nowrap">'+escHtml(v)+'</td>';
    }).join('');
    const deleteBtn=isAdmin?'<td style="padding:4px 8px;border:1px solid var(--border);background:#fff8f8;text-align:center;white-space:nowrap"><button onclick="frDeleteExitedRow(\''+trackerKey+'\',\''+_src+'\','+_sri+')" style="padding:2px 8px;border-radius:4px;border:1px solid var(--red);background:var(--red-light);color:var(--red);font-size:11px;font-weight:700;cursor:pointer" title="Remove this brand from the tracker">\ud83d\uddd1 Delete</button></td>':'';
    return'<tr style="background:#fff8f8">'+cells+deleteBtn+'</tr>';
  }).join(''):'<tr><td colspan="'+colSpan+'" class="empty-state" style="padding:32px;text-align:center;color:var(--text4)">No exited accounts.</td></tr>';
  const info='<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fef2f2;border-bottom:1px solid var(--red-mid);font-size:11px;color:var(--red)"><span>\u26a0\ufe0f</span><span>Exited accounts \u2014 <strong>'+deduped.length+' record'+(deduped.length!==1?'s':'')+'</strong>. These brands are no longer active.</span></div>';
  return'<div style="overflow:auto;max-height:calc(100vh - 200px);position:relative">'+info+'<table style="border-collapse:collapse;font-size:12px;min-width:100%"><thead style="position:sticky;top:0;z-index:4">'+hdr+'</thead><tbody>'+body+'</tbody></table></div>';
}
async function frDeleteExitedRow(trackerKey,sheetKey,rowIdx){
  if(!CU.isAdmin){toast('Admin only.');return;}
  if(!confirm('Delete this exited account entry? This cannot be undone.'))return;
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const rows=[...(sheet.rows||[])];
  rows.splice(rowIdx,1);
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows',rows);
  toast('Entry deleted.');
  renderLiveTrackers();
}
async function frUpdateExitDate(trackerKey,sheetKey,rowIdx,val){
  const t=D.trackers[trackerKey];
  const sheet=t&&t.sheets?t.sheets[sheetKey]:null;
  let xIdx=7;
  if(sheet){
    const _hr0=(sheet.headerRows&&sheet.headerRows[0])||sheet.row0||[];
    const _exitI=_hr0.findIndex(function(l){return/exit|offboard/i.test(String(l||''));});
    if(_exitI>=0)xIdx=_exitI;
  }
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+xIdx,val||'');
  toast('Offboarding date updated.');
}

async function frUpdateFixedHeader(trackerKey,sheetKey,colIdx,newLabel){
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(Boolean):[[]]);
  const row0=[...(headerRows[0]||[])];
  row0[colIdx]=newLabel;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/headerRows/0',row0);
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/row0',row0);
  toast('Header updated!');
}

// Edit a date column header label (top row = rowInHeader 0, sub-rows = 1, 2, ...)
async function frUpdateDateColHeader(trackerKey,sheetKey,colIdx,rowInHeader,newLabel){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(Boolean):[[]]);
  const updatedRow=[...(headerRows[rowInHeader]||[])];
  // Pad if needed
  while(updatedRow.length<=colIdx)updatedRow.push(null);
  updatedRow[colIdx]=newLabel||null;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/headerRows/'+rowInHeader,updatedRow);
  // Also keep legacy row0/row1 in sync
  if(rowInHeader===0)await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/row0',updatedRow);
  if(rowInHeader===1)await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/row1',updatedRow);
  toast('Date header updated!');
}

// Save an edited value inside a date column header row (e.g. Monthly Report value)
async function frUpdateCWRowValue(trackerKey, sheetKey, colIdx, rowIdx, newVal){
  if(!CU.isAdmin){toast('Admin only.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  // Persist into a dedicated map: cwRowValues[colIdx][rowIdx] = newVal
  if(!sheet.cwRowValues)sheet.cwRowValues={};
  if(!sheet.cwRowValues[colIdx])sheet.cwRowValues[colIdx]={};
  sheet.cwRowValues[colIdx][rowIdx]=newVal;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/cwRowValues/'+colIdx+'/'+rowIdx, newVal||null);
  toast('Header value updated!');
}


async function frInlineStatusChange(trackerKey,sheetKey,rowIdx,newStatus,selectEl){
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const rows=sheet.rows||[];
  const row=rows[rowIdx];if(!row)return;
  // Dynamically detect column indices from actual header
  const _hr0=(sheet.headerRows&&sheet.headerRows[0])||sheet.row0||[];
  const _brandI=_hr0.findIndex(function(l){return/brand|store.?name/i.test(String(l||''));});
  const _execI=_hr0.findIndex(function(l){return/exec/i.test(String(l||''));});
  const _acctI=_hr0.findIndex(function(l){return/account.?status|acct.?status/i.test(String(l||''));});
  const _exitI=_hr0.findIndex(function(l){return/exit|offboard/i.test(String(l||''));});
  const _bIdx=_brandI>=0?_brandI:4, _eIdx=_execI>=0?_execI:5, _aIdx=_acctI>=0?_acctI:2, _xIdx=_exitI>=0?_exitI:7;
  const brand=String(row[_bIdx]||row[_bIdx-1]||'').trim()||'This account';

  // Non-admin CDM: only their own row, only Active/Inactive
  if(!CU.isAdmin){
    const execName=String(row[_eIdx]||'').trim();
    if(execName!==CU.name){toast('You can only change status for your own accounts.');if(selectEl)selectEl.value=String(row[_aIdx]||'Active');return;}
    if(newStatus==='Exited'){toast('Only admin can set Exited status.');if(selectEl)selectEl.value=String(row[_aIdx]||'Active');return;}
  }

  // If changing to Exited, prompt for exit date via modal
  if(newStatus==='Exited'&&CU.isAdmin){
    const currentExitDate=String(row[_xIdx]||'').trim()||ds(now());
    document.getElementById('mlt-body').innerHTML=`
      <div style="margin-bottom:12px;font-size:14px;font-weight:600">${escHtml(brand)}</div>
      <div class="fg" style="margin-bottom:12px">
        <div style="display:inline-block;padding:3px 12px;border-radius:20px;border:1px solid var(--red);background:var(--red-light);color:var(--red);font-size:12px;font-weight:700">Exited</div>
      </div>
      <div style="padding:12px;background:var(--red-light);border:1px solid var(--red-mid);border-radius:var(--radius)">
        <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ Offboarding Date Required</div>
        <label class="flabel">Offboarding / Exit Date</label>
        <input class="finput nb" id="fr-exit-date" type="date" value="${currentExitDate}"/>
        <div style="font-size:11px;color:var(--red);margin-top:4px">This account will be moved to the Exited tab.</div>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn primary" onclick="frSaveAccountStatus('${trackerKey}','${sheetKey}',${rowIdx})">Confirm Exit</button>
        <button class="btn" onclick="closeModal('modal-lt-upload');renderLiveTrackers()">Cancel</button>
      </div>`;
    document.getElementById('modal-lt-upload').querySelector('h3').textContent='Set Account as Exited';
    document.getElementById('fr-exit-date').dataset.newStatus='Exited';
    openModal('modal-lt-upload');
    if(selectEl)selectEl.value=String(row[_aIdx]||'Active');
    return;
  }

  // If changing to Inactive, confirm first — on confirm the brand is also listed in the Exited tab.
  if(newStatus==='Inactive'){
    document.getElementById('mlt-body').innerHTML=`
      <div style="margin-bottom:12px;font-size:14px;font-weight:600">${escHtml(brand)}</div>
      <div class="fg" style="margin-bottom:12px">
        <div style="display:inline-block;padding:3px 12px;border-radius:20px;border:1px solid var(--yellow);background:var(--yellow-light);color:#92400e;font-size:12px;font-weight:700">Inactive</div>
      </div>
      <div style="padding:12px;background:var(--yellow-light);border:1px solid var(--yellow);border-radius:var(--radius)">
        <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px">⚠️ Confirm Status Change</div>
        <div style="font-size:12px;color:#92400e">Set this account as <b>Inactive</b>? It will be removed from the active report view and listed in the <b>Exited</b> tab.</div>
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn primary" onclick="frSaveAccountStatus('${trackerKey}','${sheetKey}',${rowIdx})">Confirm</button>
        <button class="btn" onclick="closeModal('modal-lt-upload');renderLiveTrackers()">Cancel</button>
      </div>`;
    document.getElementById('modal-lt-upload').querySelector('h3').textContent='Set Account as Inactive';
    document.getElementById('mlt-body').dataset.newStatus='Inactive';
    openModal('modal-lt-upload');
    if(selectEl)selectEl.value=String(row[_aIdx]||'Active');
    return;
  }

  // Direct save for Active
  const frTblId='fr-tbl-'+trackerKey+'-'+sheetKey;
  const frWrap=document.getElementById(frTblId);
  const _sl=frWrap?frWrap.scrollLeft:0,_st=frWrap?frWrap.scrollTop:0;
  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+_aIdx,newStatus);
  if(newStatus==='Inactive')await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+_xIdx,'');
  toast('Status updated to '+newStatus+' — '+brand);
  renderLiveTrackers();
  setTimeout(function(){const w=document.getElementById(frTblId);if(w){w.scrollLeft=_sl;w.scrollTop=_st;}},50);
}


function frToggleRowSel(trackerKey,sheetKey,rowIdx){
  const k='_frSel_'+trackerKey+'_'+sheetKey;
  if(!window[k])window[k]=new Set();
  if(window[k].has(rowIdx))window[k].delete(rowIdx);else window[k].add(rowIdx);
  // Surgically update just that row's checkbox and background without full re-render
  const chk=document.querySelector('input[data-frsel-row="'+rowIdx+'"][data-frsel-tk="'+trackerKey+'"][data-frsel-sk="'+sheetKey+'"]');
  if(chk){
    const isSel=window[k].has(rowIdx);
    chk.checked=isSel;
    const tr=chk.closest('tr');
    if(tr)tr.style.cssText=isSel?'background:#eff6ff;outline:2px solid var(--blue);outline-offset:-2px;':'';
    const td=chk.closest('td');
    if(td)td.style.background=isSel?'#dbeafe':'var(--surface)';
  }
  // Update selection count banner
  const banner=document.getElementById('fr-sel-banner-'+trackerKey+'-'+sheetKey);
  if(banner){
    const cnt=window[k].size;
    banner.style.display=cnt>0?'flex':'none';
    const lbl=document.getElementById('fr-sel-count-'+trackerKey+'-'+sheetKey);
    if(lbl)lbl.textContent=cnt+' brand'+(cnt!==1?'s':'')+' selected';
  }
}

function frSelectAll(trackerKey,sheetKey,chkEl){
  const k='_frSel_'+trackerKey+'_'+sheetKey;
  if(!window[k])window[k]=new Set();
  const allChks=document.querySelectorAll('input[data-frsel-tk="'+trackerKey+'"][data-frsel-sk="'+sheetKey+'"]');
  const checked=chkEl.checked;
  allChks.forEach(function(c){
    const ri=parseInt(c.dataset.frselRow);
    if(checked)window[k].add(ri);else window[k].delete(ri);
    c.checked=checked;
    const tr=c.closest('tr');if(tr)tr.style.cssText=checked?'background:#eff6ff;outline:2px solid var(--blue);outline-offset:-2px;':'';
    const td=c.closest('td');if(td)td.style.background=checked?'#dbeafe':'var(--surface)';
  });
  const banner=document.getElementById('fr-sel-banner-'+trackerKey+'-'+sheetKey);
  if(banner){
    const cnt=window[k].size;
    banner.style.display=cnt>0?'flex':'none';
    const lbl=document.getElementById('fr-sel-count-'+trackerKey+'-'+sheetKey);
    if(lbl)lbl.textContent=cnt+' brand'+(cnt!==1?'s':'')+' selected';
  }
}

// ── Shared active-column resolver ──────────────────────────────────────
// Returns the sheet column index of the CURRENT (active) reporting column —
// the exact same column buildFRTable highlights in yellow. Both the table and
// the mass-update actions MUST use this so they never disagree.
//
// Rule (identical to buildFRTable): the active column is the one whose real
// reporting deadline (dueDate, parsed straight from the header via
// frParseHeaderInfo) is soonest without having already passed. Fallback: the
// most recently passed deadline. This is header-driven and needs NO week
// offset — which is why the old frParseDateHeader/frEffectiveDate logic here
// (which picked a different, offset-shifted column) caused mass update to
// write to the wrong week.
// ── Shared column scanner: read every date column's Report Date + cadence ──
// Returns [{ci, dueDate, isMonthly}] for all non-fixed columns, using the header
// parser so each column's Report Date (dueDate = coverage-end + 1) and its cadence
// (weekly vs monthly) come straight from the sheet — nothing to keep configured.
// ── Shared fixed-column geometry (single source of truth) ──
// buildFRTable derives the number of leading "fixed" (non-date) columns from the
// sheet's own override first, then the platform default. The completion resolvers
// MUST use the identical value or they scan the wrong date columns. Keeping this in
// one helper guarantees the dashboard and the tracker table never disagree.
function frFixedCount(sheet,platform){
  const activeDefaults=(FR_PLATFORM_FIXED_DEFAULTS[platform]||FR_DEFAULT_FIXED);
  return (sheet&&sheet.fixedColCount!=null&&sheet.fixedColCount>0)?sheet.fixedColCount:activeDefaults.length;
}
// Resolve the index of a fixed column by matching its header label (same detection the
// table uses), falling back to the conventional position. Used so completion reads the
// correct Region / Account Status / Brand cells even when fixed columns are customised.
function frFixedColIdx(sheet,platform,which){
  const headerRows=sheet&&(sheet.headerRows||(sheet.row0?[sheet.row0]:[[]]))||[[]];
  const row0=headerRows[0]||[];
  const fixedCount=frFixedCount(sheet,platform);
  const test={
    region:/region/i,
    acct:/account.?status|acct.?status/i,
    brand:/brand|store.?name/i,
    exec:/exec/i
  }[which];
  const fallback={region:0,acct:2,brand:4,exec:5}[which];
  if(test){
    for(let i=0;i<fixedCount;i++){if(test.test(String(row0[i]||'')))return i;}
  }
  return fallback;
}

function _frScanDateCols(sheet,platform){
  if(!sheet)return [];
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(r=>r&&r.length):[[]]);
  const row0=headerRows[0]||[];
  // Use the SAME fixed-column count the table (buildFRTable) uses, not a hardcoded 7.
  // If an admin adjusts a sheet's fixed columns via "Manage Columns" (sheet.fixedColCount),
  // date columns start at a different index — a hardcoded 7 here would scan the wrong
  // columns, so the active-column resolver returned an index that didn't line up with the
  // cells members actually fill, making completion read empty and show 0/N.
  const fixedCount=frFixedCount(sheet,platform);
  const groups=[];
  for(let ci=fixedCount;ci<row0.length;ci++){
    const topLabel=row0[ci]!=null?String(row0[ci]).trim():'';
    const subLabels=[];
    for(let ri=1;ri<headerRows.length;ri++){
      const hr=headerRows[ri]||[];
      subLabels.push(hr[ci]!=null?String(hr[ci]).trim():'');
    }
    const entry=frParseHeaderInfo(platform,topLabel,subLabels);
    groups.push({ci,dueDate:entry&&entry.dueDate?entry.dueDate:null,isMonthly:!!(entry&&entry.isMonthly)});
  }
  return groups;
}

// ── Core cadence-aware resolver (Rule B) ──
// Among columns of ONE cadence (weekly OR monthly), the current column is the one
// whose Report Date is the NEAREST one on-or-before today — i.e. the report whose
// deadline has most recently arrived, the one currently being worked/finalised. It
// stays current through its whole reporting week and rolls forward only when the
// NEXT column of the same cadence reaches its own Report Date. If none has come due
// yet (start of history), fall back to the nearest upcoming Report Date.
//
// Weekly and monthly are resolved SEPARATELY so a monthly column can never steal the
// weekly highlight (the old bug: on Jul 29 the Aug-1 monthly out-competed the Jul-28
// weekly). Example, Lazada weekly (Tue deadline), today Wed Jul 29:
//   • weekly 20–26 Jul → Report Date Tue Jul 28 (yesterday) → CURRENT weekly (yellow)
//   • weekly 27 Jul–02 Aug → Report Date Tue Aug 4 (upcoming) → not yet
//   • monthly Jul 01–31 → Report Date Aug 1 → resolved on the MONTHLY track (green), not here
// `refDateStr` (optional, 'YYYY-MM-DD') picks which day's cycle to resolve against.
// Omitted → today (live/current — used everywhere edits happen: the table highlight,
// edit-locking, mass-update, etc). Passed → the column whose Report Date covers that
// SPECIFIC day, so a dashboard viewing a past or future week's occurrence of a
// Finance-Report task reads that occurrence's own cycle instead of today's live column.
// Future dates (beyond today) have no column yet — return -1 (Pending), mirroring
// how the AO tracker already treats future dates as having no data.
function _frResolveColByCadence(sheet,platform,wantMonthly,refDateStr){
  const groups=_frScanDateCols(sheet,platform).filter(function(g){return g.isMonthly===wantMonthly;});
  const refD=refDateStr?new Date(refDateStr+'T00:00:00'):now();
  const refMid=new Date(refD.getFullYear(),refD.getMonth(),refD.getDate());
  if(refDateStr){
    const todayMid=new Date(now().getFullYear(),now().getMonth(),now().getDate());
    if(refMid>todayMid)return -1; // future occurrence — nothing reported yet
  }
  // Nearest Report Date on-or-before the reference day.
  let idx=-1,bestPast=Infinity;
  groups.forEach(function(g,i){
    if(!g.dueDate)return;
    const diff=refMid-g.dueDate;               // >=0 → due on/before the reference day
    if(diff>=0&&diff<bestPast){bestPast=diff;idx=i;}
  });
  if(idx===-1&&!refDateStr){
    // Nothing due yet — fall back to the soonest upcoming Report Date. (Only for the
    // "today" case — a historical refDateStr with nothing due yet genuinely has no cycle.)
    let bestFuture=Infinity;
    groups.forEach(function(g,i){
      if(!g.dueDate)return;
      const diff=g.dueDate-refMid;
      if(diff>=0&&diff<bestFuture){bestFuture=diff;idx=i;}
    });
  }
  return idx===-1?-1:groups[idx].ci;
}

// Current WEEKLY column (yellow highlight). Used everywhere the "active column" is
// read: the table highlight, the reporting-week banner, edit-locking, the visible-week
// window, and the completion dashboard — all of which track the weekly cadence.
// Pass `refDateStr` to resolve a PAST/FUTURE occurrence's own column instead of today's.
function frActiveColIdx(sheet,platform,refDateStr){
  if(!sheet)return -1;
  return _frResolveColByCadence(sheet,platform,false,refDateStr);
}

// Current MONTHLY column (green highlight). Independent of the weekly resolver so both
// can be current in the same view (e.g. a Jul-28 weekly and an Aug-1 monthly both shown).
function frActiveMonthlyColIdx(sheet,platform,refDateStr){
  if(!sheet)return -1;
  return _frResolveColByCadence(sheet,platform,true,refDateStr);
}

async function frApplySelToDone(trackerKey,sheetKey){
  const k='_frSel_'+trackerKey+'_'+sheetKey;
  const sel=window[k];
  if(!sel||!sel.size){toast('No brands selected — click the checkboxes on the rows you want to update.');return;}
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet||!sheet.rows)return;
  const rows=sheet.rows;
  // Use the SAME active column the table highlights (see frActiveColIdx).
  const activeColIdx=frActiveColIdx(sheet,sheetKey);
  if(activeColIdx===-1){toast('Could not determine active column.');return;}
  const firstName=(CU.name||'').split(' ')[0]||'';
  const ts=ltStamp();
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const updates={};
  sel.forEach(function(rowIdx){
    const row=rows[rowIdx];if(!row)return;
    if(!D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx])D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx]=[];
    D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx][activeColIdx]='Done';
    updates['rows/'+rowIdx+'/'+activeColIdx]='Done';
    if(!D.trackers[trackerKey].sheets[sheetKey].frTimestamps)D.trackers[trackerKey].sheets[sheetKey].frTimestamps={};
    D.trackers[trackerKey].sheets[sheetKey].frTimestamps[rowIdx+'_'+activeColIdx]=ts;
    updates['frTimestamps/'+rowIdx+'_'+activeColIdx]=ts;
  });
  await fbUpd(path,updates);
  window[k]=new Set();// clear selection
  toast('✓ Done applied to '+sel.size+' brand'+(sel.size!==1?'s':'')+'!');
  renderLiveTrackers();
}

async function frMassResetToDone(trackerKey,sheetKey,brandFilter){
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet||!sheet.rows)return;
  const rows=sheet.rows;
  // Use the SAME active column the table highlights (see frActiveColIdx).
  const activeColIdx=frActiveColIdx(sheet,sheetKey);
  if(activeColIdx===-1){toast('Could not determine active column.');return;}
  const firstName=(CU.name||'').split(' ')[0]||'';
  const ts=ltStamp();
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const updates={};
  const dataRows=rows.filter(function(r){return r&&r[0]!=null&&String(r[0]).trim()!=='';});
  dataRows.forEach(function(row){
    const rowIdx=rows.indexOf(row);
    const acctStatus=String(row[2]||'').trim().toLowerCase();
    if(acctStatus==='inactive'||acctStatus==='exited')return;// skip inactive/exited
    if(brandFilter){const bv=String(row[4]||'').toLowerCase();if(!bv.includes(brandFilter.toLowerCase()))return;}
    if(!D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx])D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx]=[];
    D.trackers[trackerKey].sheets[sheetKey].rows[rowIdx][activeColIdx]='Done';
    updates['rows/'+rowIdx+'/'+activeColIdx]='Done';
    // Store timestamp
    if(!D.trackers[trackerKey].sheets[sheetKey].frTimestamps)D.trackers[trackerKey].sheets[sheetKey].frTimestamps={};
    D.trackers[trackerKey].sheets[sheetKey].frTimestamps[rowIdx+'_'+activeColIdx]=ts;
    updates['frTimestamps/'+rowIdx+'_'+activeColIdx]=ts;
  });
  await fbUpd(path,updates);
  toast('Mass update to "Done" applied!');
  renderLiveTrackers();
}

async function frUpdateCell(trackerKey,sheetKey,rowIdx,colIdx,val){
  const path='trackers/'+trackerKey+'/sheets/'+sheetKey;
  const parsed=val===''?null:val;
  const firstName=(CU.name||'').split(' ')[0]||'';
  const ts=ltStamp();
  // ── FIX 3: Save FR table scroll position before any re-render ──
  const frTblId='fr-tbl-'+trackerKey+'-'+sheetKey;
  const frWrap=document.getElementById(frTblId);
  const _frScrollLeft=frWrap?frWrap.scrollLeft:0;
  const _frScrollTop=frWrap?frWrap.scrollTop:0;
  // Update local D.trackers immediately so timestamp shows on re-render without waiting for fbListen
  if(!D.trackers[trackerKey])D.trackers[trackerKey]={};
  if(!D.trackers[trackerKey].sheets)D.trackers[trackerKey].sheets={};
  if(!D.trackers[trackerKey].sheets[sheetKey])D.trackers[trackerKey].sheets[sheetKey]={rows:[],frTimestamps:{}};
  const _frLocalSheet=D.trackers[trackerKey].sheets[sheetKey];
  if(!_frLocalSheet.rows)_frLocalSheet.rows=[];
  if(!_frLocalSheet.rows[rowIdx])_frLocalSheet.rows[rowIdx]=[];
  _frLocalSheet.rows[rowIdx][colIdx]=parsed;
  if(!_frLocalSheet.frTimestamps)_frLocalSheet.frTimestamps={};
  const _frTsKey=rowIdx+'_'+colIdx;
  if(parsed===null){
    // Cleared field: remove any prior value + timestamp so it reads as a fresh, blank cell
    delete _frLocalSheet.frTimestamps[_frTsKey];
    await fbSet(path+'/rows/'+rowIdx+'/'+colIdx,null);
    await fbSet(path+'/frTimestamps/'+_frTsKey,null);
  } else {
    _frLocalSheet.frTimestamps[_frTsKey]=ts;
    await fbSet(path+'/rows/'+rowIdx+'/'+colIdx,parsed);
    await fbSet(path+'/frTimestamps/'+_frTsKey,ts);
  }
  if(_curPage==='live-trackers'){
    renderLiveTrackers();
    // Restore scroll after re-render
    setTimeout(function(){
      const newWrap=document.getElementById(frTblId);
      if(newWrap){newWrap.scrollLeft=_frScrollLeft;newWrap.scrollTop=_frScrollTop;}
    },50);
  } else if(_curPage==='dashboard'){
    renderDashboard();
  } else if(_curPage==='my-tasks'){
    renderMyTasks();
  }
  // ── "Confirm my section is done" prompt ──
  // Once a member has filled every one of their own assigned brands in the active column,
  // surface a one-tap confirmation right here in the tracker — no separate dashboard step.
  // Completion already auto-reflects to the dashboard (it reads the same filled cells), so this
  // is an explicit accountability sign-off, not a gate. We only fire it on the transition into
  // "all my rows filled" (not on every later keystroke) and only for the active column, for a
  // non-admin member editing their own section.
  if(!CU.isAdmin && parsed!==null){
    const _sheetNow=D.trackers[trackerKey].sheets[sheetKey];
    const _activeCi=frActiveColIdx(_sheetNow,sheetKey);
    if(_activeCi===colIdx){
      const _mine=frGetMySectionCompletion(_sheetNow,sheetKey);
      const _flagKey='_frSectionPrompted_'+trackerKey+'_'+sheetKey;
      if(_mine.complete && _mine.total>0){
        if(!window[_flagKey]){
          window[_flagKey]=true;
          frShowSectionConfirm(trackerKey,sheetKey,_mine.total);
        }
      } else {
        // Not complete anymore (e.g. a cell was cleared) — allow the prompt to fire again later.
        window[_flagKey]=false;
      }
    }
  }
  // Always patch FR inline regions on dashboard regardless of current page
  ltPatchFRDashboard();
}

// Show the in-tracker confirmation once a member's whole section is filled.
function frShowSectionConfirm(trackerKey,sheetKey,total){
  const body=document.getElementById('mlt-body');
  if(!body){
    // Modal not available for some reason — fall back to a toast.
    toast('\u2705 All '+total+' of your '+sheetKey+' brands are filled in. Nice work!');
    return;
  }
  body.innerHTML=''
    +'<div style="text-align:center;padding:4px 0 8px">'
    +'<div style="font-size:34px;line-height:1;margin-bottom:8px">\u2705</div>'
    +'<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">Section complete</div>'
    +'<div style="font-size:12px;color:var(--text3);margin-bottom:14px">You\u2019ve filled in all <strong>'+total+'</strong> of your '+escHtml(sheetKey)+' brand'+(total!==1?'s':'')+' for this reporting week. Confirm your section is done \u2014 this reflects to the dashboard automatically.</div>'
    +'<div style="display:flex;gap:8px;justify-content:center">'
    +'<button class="btn primary" onclick="frConfirmSectionDone(\''+String(trackerKey).replace(/'/g,"\\'")+'\',\''+String(sheetKey).replace(/'/g,"\\'")+'\')">Confirm Done</button>'
    +'<button class="btn" onclick="closeModal(\'modal-lt-upload\')">Not yet</button>'
    +'</div>'
    +'</div>';
  const h3=document.getElementById('modal-lt-upload').querySelector('h3');
  if(h3)h3.textContent='Confirm Completion';
  openModal('modal-lt-upload');
}

// Record a member's explicit section sign-off (accountability trail; dashboard completion is
// already driven by the filled cells themselves).
async function frConfirmSectionDone(trackerKey,sheetKey){
  const ts=ltStamp();
  const who=(CU&&CU.username)||'';
  try{
    await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/frConfirmations/'+who,{name:(CU&&CU.name)||who,at:ts});
  }catch(e){/* non-fatal — the sign-off is a convenience record */}
  closeModal('modal-lt-upload');
  toast('\u2705 Section confirmed \u2014 thanks! It\u2019s reflected on the dashboard.');
  if(_curPage==='live-trackers')renderLiveTrackers();
}

// Patch just the FR region chips on the dashboard without a full re-render. The dashboard renders
// one block per FR task keyed by task id (fr-inline-regions-<taskId>), so patch those — and use
// each task's own cadence so a monthly task keeps reading the monthly column here too.
function ltPatchFRDashboard(){
  [...(D.tasks||[]),...(D.leadTasks||[])].forEach(function(t){
    if(!t||!t.frLinked)return;
    const el=document.getElementById('fr-inline-regions-'+t.id);
    if(el)el.innerHTML=buildFRInlineRegionsForTask(t);
  });
}
// ── LEAVES ──
const LV_TYPES=[
  {v:'AL',l:'Annual Leave'},
  {v:'BL',l:'Birthday Leave'},
  {v:'RL',l:'Replacement Leave'},
  {v:'ML',l:'Maternity Leave'},
  {v:'CL',l:'Compassionate'},
  {v:'O1',l:'OIL'},
  {v:'HD1',l:'AM Leave'},
  {v:'HD2',l:'PM Leave'},
  {v:'O2',l:'Others'},
];
const LV_STATUSES=['Done','Pending','N/A'];
const LV_REGIONS=['MY','PH','TH','VN','ID','SG','EP'];
const LV_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

let _lvTab='log',_lvSumMonth=null,_lvSumRegion='',_lvFltRegion='',_lvFltMonth='',_lvFltType='',_lvFltStatus='',_lvSearch='';

function lvGetMembers(){
  return (D.members||[]).filter(m=>m.approved).sort((a,b)=>a.name.localeCompare(b.name));
}

function lvTypeBadge(type){
  return `<span class="sbadge lv-type-${type}" style="font-size:10px;padding:2px 7px">${type}</span>`;
}

function lvStatusClass(s){return s==='Done'?'sd-d':s==='Pending'?'sd-p':'sd-ne';}
function lvStatusTextClass(s){return s==='Done'?'mc-green':s==='Pending'?'mc-red':'';}

function renderLeaves(){
  const el=document.getElementById('pg-leaves');if(!el)return;
  const now_year=new Date().getFullYear();
  if(!_lvSumMonth)_lvSumMonth=LV_MONTHS[new Date().getMonth()]+' '+now_year;

  const tabBar=`<div style="display:flex;gap:6px;border-bottom:1px solid var(--border);margin-bottom:16px;padding-bottom:0">
    ${['log','records','summary'].map(t=>`<button onclick="_lvTab='${t}';renderLeaves()" style="padding:7px 14px;border:none;background:transparent;font-size:13px;font-weight:${_lvTab===t?'700':'500'};color:${_lvTab===t?'var(--text)':'var(--text3)'};cursor:pointer;border-bottom:${_lvTab===t?'2px solid var(--text)':'2px solid transparent'};margin-bottom:-1px">${t==='log'?'Log leave':t==='records'?'Records':'Monthly summary'}</button>`).join('')}
  </div>`;

  let content='';
  if(_lvTab==='log') content=lvRenderLogForm();
  else if(_lvTab==='records') content=lvRenderRecords();
  else content=lvRenderSummary();

  el.innerHTML=`<div class="page-header"><div class="page-title">Leave Tracker</div>${_lvTab==='records'?`<button class="btn success" onclick="lvExportCSV()">&#8595; Export CSV</button>`:_lvTab==='summary'?`<button class="btn success" onclick="lvExportSummaryCSV()">&#8595; Export CSV</button>`:''}</div>${tabBar}${content}`;
}

function lvRenderLogForm(){
  const mems=lvGetMembers();
  const memOpts=mems.map(m=>`<option value="${m.name}">${m.name}${m.region?' ('+m.region+')':''}</option>`).join('');
  const buddyOpts='<option value="">— None —</option>'+mems.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
  const typeOpts=LV_TYPES.map(t=>`<option value="${t.v}">${t.l} (${t.v})</option>`).join('');
  const statusOpts=LV_STATUSES.map(s=>`<option>${s}</option>`).join('');
  const yr=new Date().getFullYear();
  const monthOpts=[yr-1,yr,yr+1].flatMap(y=>LV_MONTHS.map(m=>`<option>${m} ${y}</option>`)).join('');

  return `<div class="panel">
    <div class="fg fg3">
      <div><label class="flabel">Month</label><select class="finput nb" id="lv-f-month">${monthOpts}</select></div>
      <div><label class="flabel">Leave date(s)</label><input class="finput nb" id="lv-f-date" placeholder="e.g. Jan 2 or Jan 2–5 or Jan 9 &amp; 16"/></div>
      <div><label class="flabel">CDM name</label><select class="finput nb" id="lv-f-cdm"><option value="">— Select member —</option>${memOpts}</select></div>
    </div>
    <div class="fg fg4">
      <div><label class="flabel">Leave type</label><select class="finput nb" id="lv-f-type">${typeOpts}</select></div>
      <div><label class="flabel">No. of days</label><input class="finput nb" id="lv-f-days" type="number" min="0.5" step="0.5" value="1"/></div>
      <div><label class="flabel">Buddy</label><select class="finput nb" id="lv-f-buddy">${buddyOpts}</select></div>
      <div><label class="flabel">Handover document</label><select class="finput nb" id="lv-f-handover">${statusOpts}</select></div>
    </div>
    <div class="fg fg3">
      <div><label class="flabel">Buddy briefing</label><select class="finput nb" id="lv-f-briefing">${statusOpts}</select></div>
      <div><label class="flabel">Calendar invite</label><select class="finput nb" id="lv-f-cal">${statusOpts}</select></div>
      <div><label class="flabel">Remarks</label><input class="finput nb" id="lv-f-remarks" placeholder="Optional"/></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="lvClearForm()">Clear</button>
      <button class="btn primary" onclick="lvSubmit()">Add entry</button>
    </div>
  </div>
  <div id="lv-form-msg"></div>`;
}

function lvClearForm(){
  ['lv-f-date','lv-f-remarks'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const days=document.getElementById('lv-f-days');if(days)days.value='1';
  ['lv-f-handover','lv-f-briefing','lv-f-cal'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='Done';});
}

async function lvSubmit(){
  const cdm=document.getElementById('lv-f-cdm')?.value;
  const date=document.getElementById('lv-f-date')?.value.trim();
  const month=document.getElementById('lv-f-month')?.value;
  if(!cdm){toast('Please select a CDM name');return;}
  if(!date){toast('Please enter a leave date');return;}
  const mem=(D.members||[]).find(m=>m.name===cdm);
  const entry={
    month,date,cdm,
    region:mem?.region||'',
    type:document.getElementById('lv-f-type')?.value||'AL',
    days:parseFloat(document.getElementById('lv-f-days')?.value)||1,
    buddy:document.getElementById('lv-f-buddy')?.value||'',
    handover:document.getElementById('lv-f-handover')?.value||'Done',
    briefing:document.getElementById('lv-f-briefing')?.value||'Done',
    cal:document.getElementById('lv-f-cal')?.value||'Done',
    remarks:document.getElementById('lv-f-remarks')?.value.trim()||'',
    ts:Date.now(),
    addedBy:CU.name,
  };
  await fbPush('leaves',entry);
  lvClearForm();
  toast('Leave entry added');
}

async function lvDelete(key){
  if(!confirm('Delete this leave entry?'))return;
  await fbDel('leaves/'+key);
  toast('Entry deleted');
}

async function lvUpdateStatus(key,field,val){
  await fbUpd('leaves/'+key,{[field]:val});
  toast('Status updated');
}

function lvFiltered(){
  return (D.leaves||[]).filter(e=>{
    if(_lvFltRegion&&e.region!==_lvFltRegion)return false;
    if(_lvFltMonth&&e.month!==_lvFltMonth)return false;
    if(_lvFltType&&e.type!==_lvFltType)return false;
    if(_lvFltStatus&&e.handover!==_lvFltStatus&&e.briefing!==_lvFltStatus&&e.cal!==_lvFltStatus)return false;
    if(_lvSearch&&!e.cdm.toLowerCase().includes(_lvSearch.toLowerCase()))return false;
    return true;
  });
}

function lvRenderRecords(){
  const rows=lvFiltered();
  const totalDays=rows.reduce((s,e)=>s+(parseFloat(e.days)||0),0);
  const pending=rows.filter(e=>e.handover==='Pending'||e.briefing==='Pending'||e.cal==='Pending').length;
  const unique=new Set(rows.map(e=>e.cdm)).size;

  const yr=new Date().getFullYear();
  const monthOpts=['<option value="">All months</option>',...[yr-1,yr,yr+1].flatMap(y=>LV_MONTHS.map(m=>`<option${_lvFltMonth===m+' '+y?' selected':''}>${m} ${y}</option>`))].join('');
  const regionOpts='<option value="">All regions</option>'+LV_REGIONS.map(r=>`<option${_lvFltRegion===r?' selected':''}>${r}</option>`).join('');
  const typeOpts='<option value="">All types</option>'+LV_TYPES.map(t=>`<option value="${t.v}"${_lvFltType===t.v?' selected':''}>${t.v}</option>`).join('');
  const statusOpts='<option value="">All statuses</option>'+LV_STATUSES.map(s=>`<option${_lvFltStatus===s?' selected':''}>${s}</option>`).join('');

  const metrics=`<div class="metrics-row" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px">
    <div class="metric-card mc-black"><div class="mc-label">Entries</div><div class="mc-val">${rows.length}</div></div>
    <div class="metric-card mc-blue"><div class="mc-label">Total days</div><div class="mc-val">${totalDays}</div></div>
    <div class="metric-card mc-yellow"><div class="mc-label">With pending</div><div class="mc-val">${pending}</div></div>
    <div class="metric-card mc-green"><div class="mc-label">Unique CDMs</div><div class="mc-val">${unique}</div></div>
  </div>`;

  const filters=`<div class="lv-filters">
    <select onchange="_lvFltRegion=this.value;renderLeaves()">${regionOpts}</select>
    <select onchange="_lvFltMonth=this.value;renderLeaves()">${monthOpts}</select>
    <select onchange="_lvFltType=this.value;renderLeaves()">${typeOpts}</select>
    <select onchange="_lvFltStatus=this.value;renderLeaves()">${statusOpts}</select>
    <input placeholder="Search CDM name..." value="${_lvSearch}" oninput="_lvSearch=this.value;renderLeaves()" style="min-width:160px"/>
  </div>`;

  function stCol(s){return s==='Done'?'color:var(--green);font-weight:700':s==='Pending'?'color:var(--red);font-weight:700':'color:var(--text3)';}
  function stSelect(key,field,val){
    return `<select onchange="lvUpdateStatus('${key}','${field}',this.value)" style="${stCol(val)};border:1px solid var(--border);border-radius:var(--radius);padding:3px 6px;font-size:12px;font-family:inherit;background:#fff;cursor:pointer">`
      +LV_STATUSES.map(s=>`<option${val===s?' selected':''}>${s}</option>`).join('')
      +`</select>`;
  }

  const tbody=rows.length?rows.map(e=>`<tr>
    <td>${e.month||'—'}</td>
    <td style="white-space:nowrap">${e.date||'—'}</td>
    <td style="font-weight:600;white-space:nowrap">${e.cdm}</td>
    <td><span class="lv-region">${e.region||'—'}</span></td>
    <td>${lvTypeBadge(e.type)}</td>
    <td style="text-align:center">${e.days}</td>
    <td style="color:var(--text3);white-space:nowrap">${e.buddy||'—'}</td>
    <td>${stSelect(e._key,'handover',e.handover)}</td>
    <td>${stSelect(e._key,'briefing',e.briefing)}</td>
    <td>${stSelect(e._key,'cal',e.cal)}</td>
    <td style="color:var(--text3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.remarks||'—'}</td>
    ${CU.isAdmin?`<td><button class="btn sm del" onclick="lvDelete('${e._key}')">Delete</button></td>`:'<td></td>'}
  </tr>`).join(''):`<tr><td colspan="12" class="empty-state">No entries found.</td></tr>`;

  return `${filters}${metrics}<div class="tbl-wrap"><table><thead><tr>
    <th>Month</th><th>Leave date</th><th>CDM name</th><th>Region</th><th>Type</th><th>Days</th>
    <th>Buddy</th><th>Handover</th><th>Briefing</th><th>Cal invite</th><th>Remarks</th><th></th>
  </tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function lvRenderSummary(){
  const yr=new Date().getFullYear();
  const monthOpts=[yr-1,yr,yr+1].flatMap(y=>LV_MONTHS.map(m=>`<option${_lvSumMonth===m+' '+y?' selected':''}>${m} ${y}</option>`)).join('');
  const regionOpts='<option value="">All regions</option>'+LV_REGIONS.map(r=>`<option${_lvSumRegion===r?' selected':''}>${r}</option>`).join('');

  const [mName,mYrStr]=(_lvSumMonth||'').split(' ');
  const mYr=parseInt(mYrStr)||new Date().getFullYear();
  const mIdx=LV_MONTHS.indexOf(mName);
  const dim=mIdx>=0?new Date(mYr,mIdx+1,0).getDate():30;
  const todayStr=ds(new Date());

  let members=(D.members||[]).filter(m=>m.approved);
  if(_lvSumRegion)members=members.filter(m=>m.region===_lvSumRegion);
  members.sort((a,b)=>a.name.localeCompare(b.name));

  const monthLeaves=(D.leaves||[]).filter(e=>e.month===_lvSumMonth);

  function getEntryForDay(cdm,day){
    return monthLeaves.filter(e=>e.cdm===cdm).find(e=>lvEntryCoversDay(e,day,dim));
  }

  const days=Array.from({length:dim},(_,i)=>i+1);
  const colHeaders=days.map(d=>{
    const ds_val=`${mYr}-${String(mIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return `<th${ds_val===todayStr?' class="lv-today-col"':''}>${d}</th>`;
  }).join('');

  const tbody=members.map(m=>{
    const empLeaves=monthLeaves.filter(e=>e.cdm===m.name);
    const totalDays=empLeaves.reduce((s,e)=>s+(parseFloat(e.days)||0),0);
    const cells=days.map(d=>{
      const ds_val=`${mYr}-${String(mIdx+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const entry=getEntryForDay(m.name,d);
      return `<td${ds_val===todayStr?' class="lv-today-col"':''}>${entry?`<span class="lv-code lv-type-${entry.type}">${entry.type}</span>`:''}</td>`;
    }).join('');
    return `<tr><td class="lv-name-td">${m.name}${m.region?` <span class="lv-region">${m.region}</span>`:''}</td>${cells}<td style="text-align:center;font-weight:700;color:var(--text)">${totalDays||''}</td></tr>`;
  }).join('');

  const legend=LV_TYPES.map(t=>`<div class="lv-legend-item"><div class="lv-legend-dot lv-type-${t.v}"></div>${t.v} = ${t.l}</div>`).join('');

  return `<div class="lv-filters">
    <select onchange="_lvSumMonth=this.value;renderLeaves()">${monthOpts}</select>
    <select onchange="_lvSumRegion=this.value;renderLeaves()">${regionOpts}</select>
  </div>
  <div class="lv-legend">${legend}</div>
  <div class="lv-summary-wrap"><table class="lv-sum-table"><thead><tr>
    <th class="lv-name-th">CDM Name</th>${colHeaders}<th>Total</th>
  </tr></thead><tbody>${tbody||'<tr><td colspan="'+(dim+2)+'" class="empty-state">No members found.</td></tr>'}</tbody></table></div>`;
}

function lvEntryCoversDay(e,day,dim){
  const raw=e.date||'';
  // Range: Jan 2–5 or Jan 2-5
  const rangeM=raw.match(/(\d{1,2})[–\-](\d{1,2})/);
  if(rangeM)return day>=parseInt(rangeM[1])&&day<=parseInt(rangeM[2]);
  // Multi: Jan 9 & 16
  if(raw.includes('&')){return raw.split('&').some(p=>{const m=p.match(/(\d{1,2})/);return m&&parseInt(m[1])===day;});}
  // Single: Jan 2
  const m=raw.match(/\b(\d{1,2})\b/);
  return m?parseInt(m[1])===day:false;
}

function lvExportCSV(){
  const rows=lvFiltered();
  const header='Month,Leave Date,CDM Name,Region,Leave Type,No. of Days,Buddy,Handover Document,Buddy Briefing,Calendar Invite,Remarks';
  const csv=[header,...rows.map(e=>[e.month,e.date,e.cdm,e.region,e.type,e.days,e.buddy,e.handover,e.briefing,e.cal,e.remarks].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  lvDownload('leave_monitoring_'+(_lvFltMonth||'all')+'.csv',csv,'text/csv');
  toast('Exported!');
}

function lvExportSummaryCSV(){
  const [mName,mYrStr]=(_lvSumMonth||'').split(' ');
  const mYr=parseInt(mYrStr)||new Date().getFullYear();
  const mIdx=LV_MONTHS.indexOf(mName);
  const dim=mIdx>=0?new Date(mYr,mIdx+1,0).getDate():30;
  let members=(D.members||[]).filter(m=>m.approved);
  if(_lvSumRegion)members=members.filter(m=>m.region===_lvSumRegion);
  members.sort((a,b)=>a.name.localeCompare(b.name));
  const monthLeaves=(D.leaves||[]).filter(e=>e.month===_lvSumMonth);
  const days=Array.from({length:dim},(_,i)=>i+1);
  const header=['CDM Name','Region',...days.map(String),'Total'].join(',');
  const rows=members.map(m=>{
    const empLeaves=monthLeaves.filter(e=>e.cdm===m.name);
    const total=empLeaves.reduce((s,e)=>s+(parseFloat(e.days)||0),0);
    const cells=days.map(d=>{const en=empLeaves.find(e=>lvEntryCoversDay(e,d,dim));return en?en.type:'';});
    return[m.name,m.region||'',...cells,total||''].map(v=>`"${v}"`).join(',');
  });
  lvDownload('leave_summary_'+_lvSumMonth.replace(/ /g,'_')+'.csv',[header,...rows].join('\n'),'text/csv');
  toast('Exported!');
}

function lvDownload(name,content,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name;a.click();
}

// Close dropdowns on outside click

// Event delegation for Live Trackers sidebar, toolbar, and TOD buttons
document.addEventListener('click',function(e){
  // Sheet tab clicks are handled via inline onclick (ltSetSheet) on each tab.

  // Tracker sidebar item
  var ti=e.target.closest('.lt-tracker-item[data-trackerid]');
  if(ti){ltSelect(ti.dataset.trackerid);return;}

  // Toolbar buttons
  var btn=e.target.closest('[data-action]');
  if(btn){
    var action=btn.dataset.action,key=btn.dataset.key;
    if(action==='link-dash'&&key){ltLinkDash(key);return;}
    if(action==='fr-link'&&key){frLinkTracker(key);return;}
    if(action==='fr-relink'&&key){frLinkTasks().then(()=>toast('Finance tasks re-linked!'));return;}
    if(action==='export'&&key){ltExport(key);return;}
    if(action==='delete'&&key){ltDelete(key);return;}
    if(action==='fr-manage-platforms'&&key){frManagePlatforms(key);return;}
    if(action==='fr-manage-dates'&&key){frManageDates(key);return;}
    if(action==='fr-add-brand'&&key){frOpenAddBrand(key,_activeTrackerSheet||Object.keys((D.trackers[key]||{}).sheets||{})[0]);return;}
    if(action==='fr-status-change'){frChangeAccountStatus(btn.dataset.tk,btn.dataset.sk,parseInt(btn.dataset.ri),btn.dataset.val);return;}
    // TOD buttons
    if(action==='login'){todLogIn(btn.dataset.user,btn.dataset.date);return;}
  }
});

document.addEventListener('click',e=>{
  const dd=document.getElementById('nav-dd-data');if(dd&&!dd.contains(e.target))closeNavDD();
  const wsdd=document.getElementById('nav-dd-ws');if(wsdd&&!wsdd.contains(e.target))closeNavWsDD();
  ['ft-mdrop','grp-mdrop','inc-tag-drop'].forEach(id=>{const d=document.getElementById(id);if(d&&!d.contains(e.target)){const s=document.getElementById(id==='ft-mdrop'?'ft-ms':id==='grp-mdrop'?'grp-ms':'inc-tag-ms');if(s&&!s.contains(e.target))d.style.display='none';}});
});
document.querySelectorAll('.modal-bg').forEach(bg=>bg.addEventListener('click',e=>{if(e.target===bg)bg.classList.remove('open');}));

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');}

// ── PLATFORM TAB REORDERING (Admin) ──
function frManagePlatforms(key){
  const t=D.trackers[key];if(!t)return;
  const sheets=t.sheets||{};
  const names=Object.keys(sheets);
  document.getElementById('mlt-body').innerHTML=`
    <div style="margin-bottom:12px;font-size:13px;color:var(--text3)">Drag to reorder platform tabs. Click ✕ to remove a tab (does not delete data).</div>
    <div id="platform-sort-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      ${names.map((n,i)=>`
        <div class="platform-sort-item" data-name="${n}" draggable="true"
          style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:grab">
          <span style="color:var(--text4);cursor:grab">⠿</span>
          <span style="flex:1;font-weight:600">${escHtml(n)}</span>
          <button onclick="this.closest('.platform-sort-item').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px">✕</button>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input id="new-platform-name" class="finput nb" placeholder="New platform name..." style="flex:1"/>
      <button class="btn sm primary" onclick="frAddPlatformTab('${key}')">+ Add</button>
    </div>
    <div class="form-actions">
      <button class="btn primary" onclick="frSavePlatformOrder('${key}')">Save Order</button>
      <button class="btn" onclick="closeModal('modal-lt-upload')">Cancel</button>
    </div>`;
  document.querySelector('.modal-lt-upload h3,#modal-lt-upload h3')||null;
  document.getElementById('modal-lt-upload').querySelector('h3').textContent='Manage Platform Tabs';
  // Enable drag-and-drop
  setTimeout(()=>initPlatformDrag(),50);
  openModal('modal-lt-upload');
}

function initPlatformDrag(){
  const list=document.getElementById('platform-sort-list');if(!list)return;
  let dragging=null;
  list.querySelectorAll('.platform-sort-item').forEach(item=>{
    item.addEventListener('dragstart',()=>{dragging=item;item.style.opacity='.4';});
    item.addEventListener('dragend',()=>{dragging=null;item.style.opacity='1';});
    item.addEventListener('dragover',e=>{e.preventDefault();if(dragging&&dragging!==item){
      const rect=item.getBoundingClientRect();
      const mid=rect.top+rect.height/2;
      if(e.clientY<mid)list.insertBefore(dragging,item);
      else list.insertBefore(dragging,item.nextSibling);
    }});
  });
}

function frAddPlatformTab(key){
  const name=document.getElementById('new-platform-name').value.trim();
  if(!name){toast('Enter a platform name');return;}
  const list=document.getElementById('platform-sort-list');
  const div=document.createElement('div');
  div.className='platform-sort-item';
  div.dataset.name=name;
  div.draggable=true;
  div.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);cursor:grab';
  div.innerHTML=`<span style="color:var(--text4);cursor:grab">⠿</span><span style="flex:1;font-weight:600">${escHtml(name)}</span><button onclick="this.closest('.platform-sort-item').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px">✕</button>`;
  list.appendChild(div);
  document.getElementById('new-platform-name').value='';
  initPlatformDrag();
}

async function frSavePlatformOrder(key){
  const t=D.trackers[key];if(!t)return;
  const items=document.querySelectorAll('#platform-sort-list .platform-sort-item');
  const newOrder=[...items].map(el=>el.dataset.name);
  const oldSheets=t.sheets||{};
  // Rebuild sheets in new order, preserving data, adding empty for new ones
  const newSheets={};
  newOrder.forEach(n=>{newSheets[n]=oldSheets[n]||{row0:[],row1:[],rows:[]};});
  await fbSet('trackers/'+key+'/sheets',newSheets);
  _activeTrackerSheet=newOrder[0]||null;
  closeModal('modal-lt-upload');
  toast('Platform tabs updated!');
  renderLiveTrackers();
}

// ── INLINE DRAG-TO-REORDER FINANCE TABS ──
function initFRTabDrag(key){
  const bar=document.getElementById('fr-tab-bar-'+key);
  if(!bar)return;
  const t=D.trackers[key];if(!t)return;
  let dragSrc=null;
  let didReorder=false;      // whether tabs actually changed position during this drag
  let downX=0,downY=0,downTab=null;  // for click-vs-drag detection

  function selectTab(tab){
    if(!tab)return;
    const sheet=tab.dataset.sheet;
    if(sheet==null)return;
    ltSetSheet(key,sheet);
  }

  bar.querySelectorAll('.fr-drag-tab').forEach(function(tab){
    // ── Click detection via pointer (native 'click' is unreliable on draggable els) ──
    tab.addEventListener('mousedown',function(e){
      downTab=tab;downX=e.clientX;downY=e.clientY;
    });
    tab.addEventListener('mouseup',function(e){
      // If this is the same tab we pressed on, and the pointer barely moved,
      // AND no HTML5 drag reorder happened, treat it as a click.
      const moved=Math.abs(e.clientX-downX)>5||Math.abs(e.clientY-downY)>5;
      if(downTab===tab&&!moved&&!didReorder){
        selectTab(tab);
      }
      downTab=null;
    });

    // ── HTML5 drag reorder ──
    tab.addEventListener('dragstart',function(e){
      dragSrc=tab;
      didReorder=false;
      tab.style.opacity='.4';
      e.dataTransfer.effectAllowed='move';
    });
    tab.addEventListener('dragend',function(){
      tab.style.opacity='1';
      bar.querySelectorAll('.fr-drag-tab').forEach(function(t2){t2.classList.remove('fr-drag-over');});
    });
    tab.addEventListener('dragover',function(e){
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      if(dragSrc&&dragSrc!==tab){
        didReorder=true;
        bar.querySelectorAll('.fr-drag-tab').forEach(function(t2){t2.classList.remove('fr-drag-over');});
        tab.classList.add('fr-drag-over');
        const rect=tab.getBoundingClientRect();
        if(e.clientX<rect.left+rect.width/2) bar.insertBefore(dragSrc,tab);
        else bar.insertBefore(dragSrc,tab.nextSibling);
      }
    });
    tab.addEventListener('drop',function(e){e.preventDefault();});
  });

  // Save order once, when the whole drag gesture ends — only if something moved.
  bar.addEventListener('dragend',async function(){
    const src=dragSrc;
    dragSrc=null;
    if(!src||!didReorder){didReorder=false;return;}
    didReorder=false;
    const keepActive=_activeTrackerSheet;   // don't yank the user to tab 0
    const newOrder=[...bar.querySelectorAll('.fr-drag-tab')].map(function(el){return el.dataset.sheet;});
    const oldSheets=t.sheets||{};
    const newSheets={};
    newOrder.forEach(function(n){if(oldSheets[n])newSheets[n]=oldSheets[n];});
    Object.keys(oldSheets).forEach(function(n){if(!newSheets[n])newSheets[n]=oldSheets[n];});
    await fbSet('trackers/'+key+'/sheets',newSheets);
    await fbSet('trackers/'+key+'/tabOrder',newOrder);
    D.trackers[key].sheets=newSheets;
    D.trackers[key].tabOrder=newOrder;
    if(keepActive&&newSheets[keepActive])_activeTrackerSheet=keepActive;
    toast('Tab order saved!');
    renderLiveTrackers();
  },true);
}


function frManageDates(key){
  const t=D.trackers[key];if(!t)return;
  const sheetKey=_activeTrackerSheet||Object.keys(t.sheets||{})[0];
  const sheet=(t.sheets||{})[sheetKey]||{};
  const headerRows=sheet.headerRows||(sheet.row0?[sheet.row0]:[[]]); 
  const row0=headerRows[0]||[];
  // Use the SAME fixed-column count as buildFRTable (default 7: Region, Platform, Account Status,
  // Synagie Merchant ID, Brand/Store Name, Exec, Team Lead) — but this is now admin-adjustable per
  // sheet (sheet.fixedColCount), so a mismatch between the table and this modal can't happen, and
  // any column that's landed in the wrong "side" of the boundary can be pulled back into view.
  const fixedCount=(sheet.fixedColCount!=null&&sheet.fixedColCount>0)?sheet.fixedColCount:7;
  const dateCols=[];
  for(let i=fixedCount;i<row0.length;i++){
    const colSubLabels=[];
    for(let ri=1;ri<headerRows.length;ri++){colSubLabels.push((headerRows[ri]||[])[i]!=null?String((headerRows[ri]||[])[i]).trim():'');}
    dateCols.push({idx:i,label:String(row0[i]!=null?row0[i]:'').trim(),subLabels:colSubLabels});
  }
  const numSubRows=headerRows.length-1;
  const dateList=dateCols.map(dc=>{
    const isBlank=!dc.label&&!dc.subLabels.some(s=>s);
    return `
    <div style="display:flex;justify-content:center;margin:2px 0">
      <button type="button" onclick="frInsertDateFieldBefore(this,${numSubRows})" title="Insert a new column here (before this one) — use this to slot in a missed week"
        style="background:none;border:1px dashed var(--border);color:var(--text3);border-radius:20px;font-size:10px;padding:1px 10px;cursor:pointer">+ Insert column here</button>
    </div>
    <div style="background:${isBlank?'#fff7ed':'var(--bg)'};border:1px solid ${isBlank?'var(--orange)':'var(--border)'};border-radius:var(--radius);padding:8px 10px;margin-bottom:6px">
      <div style="font-size:9px;color:var(--text4);margin-bottom:3px">Column index ${dc.idx}${isBlank?' — ⚠ blank/leftover, hidden from the table already. Click ✕ to remove it for good.':''}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <input class="finput nb" style="flex:1;font-size:12px;font-weight:600" value="${escHtml(dc.label)}" data-colidx="${dc.idx}" data-rowoffset="0" placeholder="Top label e.g. Income: 23 Dec - 29 Dec"/>
        <button onclick="this.closest('div.date-entry-wrap').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px">✕</button>
      </div>
      ${dc.subLabels.map((sl,ri)=>`<input class="finput nb" style="width:100%;font-size:11px;margin-bottom:3px" value="${escHtml(sl)}" data-colidx="${dc.idx}" data-rowoffset="${ri+1}" placeholder="Sub-row ${ri+1} e.g. SW: 24 Dec - 30 Dec"/>`).join('')}
    </div>`;
  }).join('').replace(/<div style="background/g,'<div class="date-entry-wrap" style="background');
  const subRowControls=Array.from({length:numSubRows},(_, ri)=>`<span style="font-size:11px;color:var(--text3)">Sub-row ${ri+1} label</span>`).join(' | ');
  const fixedPreview=Array.from({length:fixedCount},function(_,i){return escHtml(String(row0[i]!=null?row0[i]:'')||'(blank)');}).join(' · ');
  document.getElementById('mlt-body').innerHTML=`
    <div style="margin-bottom:10px;font-size:13px;color:var(--text3)">
      Sheet: <b>${escHtml(sheetKey)}</b> — Edit date column headers. Each column can have a top label and sub-labels matching your Excel rows.
    </div>
    <div style="background:#f0f6ff;border:1px solid var(--blue-mid);border-radius:var(--radius);padding:10px 12px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:4px">Fixed columns boundary</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Columns 0–${fixedCount-1} are treated as fixed (Region…Team Lead) and never show up below. If a column you expect to see/delete here is missing, it likely landed inside this range — lower the number and click Apply. Current: <b>${escHtml(fixedPreview)}</b></div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" min="1" max="20" id="fr-fixedcount-input" value="${fixedCount}" class="finput nb" style="width:70px"/>
        <button class="btn sm" onclick="frSetFixedCount('${key}','${sheetKey}')">Apply</button>
      </div>
    </div>
    <div id="date-col-list">${dateList}</div>
    <button class="btn sm" onclick="frAddDateField(${numSubRows})" style="margin-bottom:14px">+ Add Date Column</button>
    <div class="form-actions">
      <button class="btn primary" onclick="frSaveDates('${key}','${sheetKey}',${numSubRows})">Save Dates</button>
      <button class="btn" onclick="closeModal('modal-lt-upload')">Cancel</button>
    </div>`;
  document.getElementById('modal-lt-upload').querySelector('h3').textContent='Manage Date Columns';
  openModal('modal-lt-upload');
}

function frBuildBlankDateEntryDiv(numSubRows){
  const ns=numSubRows||0;
  const div=document.createElement('div');
  div.className='date-entry-wrap';
  div.style.cssText='background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;margin-bottom:6px';
  let inner=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
    <input class="finput nb" style="flex:1;font-size:12px;font-weight:600" data-colidx="new" data-rowoffset="0" placeholder="Top label e.g. Income: 01 May - 07 May"/>
    <button onclick="this.closest('.date-entry-wrap').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:2px 4px">✕</button>
  </div>`;
  for(let ri=0;ri<ns;ri++){inner+=`<input class="finput nb" style="width:100%;font-size:11px;margin-bottom:3px" data-colidx="new" data-rowoffset="${ri+1}" placeholder="Sub-row ${ri+1}"/>`;}
  div.innerHTML=inner;
  return div;
}

function frAddDateField(numSubRows){
  document.getElementById('date-col-list').appendChild(frBuildBlankDateEntryDiv(numSubRows));
}

// Inserts a new blank date column card immediately before the existing column whose
// "+ Insert column here" button was clicked — lets an admin slot a missed week into
// its correct chronological position instead of it landing at the end of the list.
function frInsertDateFieldBefore(btnEl,numSubRows){
  const insertRow=btnEl.parentElement; // the "+ Insert column here" wrapper row
  const targetCard=insertRow.nextElementSibling; // the actual column card right after it
  const div=frBuildBlankDateEntryDiv(numSubRows);
  if(targetCard&&targetCard.parentNode)targetCard.parentNode.insertBefore(div,targetCard);
  else document.getElementById('date-col-list').appendChild(div);
}

// Lets admin move the fixed/date-column boundary for a sheet — used when a column has landed on
// the wrong side (e.g. a leftover "Exec"/"Team Lead" column that isn't showing up as deletable).
async function frSetFixedCount(key,sheetKey){
  const input=document.getElementById('fr-fixedcount-input');
  const val=parseInt(input&&input.value);
  if(!val||val<1){toast('Enter a valid number of fixed columns');return;}
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/fixedColCount',val);
  toast('Fixed-column boundary updated to '+val);
  frManageDates(key); // refresh the modal with the new boundary
}

async function frSaveDates(key,sheetKey,numSubRows){
  const t=D.trackers[key];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const ns=numSubRows||0;
  const existingHeaderRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(Boolean):[[]]);
  // Use the SAME fixed-column count as buildFRTable and frManageDates (admin-adjustable, default 7).
  const fixedCount=(sheet.fixedColCount!=null&&sheet.fixedColCount>0)?sheet.fixedColCount:7;
  const existingRows=sheet.rows||[];
  const existingCwRowValues=sheet.cwRowValues||{};
  const existingFrTimestamps=sheet.frTimestamps||{};
  // Rebuild headerRows: keep fixed portion, rebuild date portion from form
  const newHeaderRows=[];
  for(let ri=0;ri<=ns;ri++){
    const base=(existingHeaderRows[ri]||[]).slice(0,fixedCount);
    // Pad to fixedCount
    while(base.length<fixedCount)base.push(null);
    newHeaderRows.push(base);
  }
  // Collect date columns grouped by entry, in their current (post-delete/reorder) DOM order.
  // Track each surviving entry's ORIGINAL column index so we can carry its row data, cwRowValues,
  // and frTimestamps along with it — deleted columns are simply dropped instead of leaving stale
  // data at the old indices (which made the table look unchanged after a "delete").
  const entries=document.querySelectorAll('#date-col-list .date-entry-wrap');
  const keptOriginalIdx=[]; // parallel to the new date-column order; null = brand-new column
  entries.forEach(entry=>{
    const inputs=entry.querySelectorAll('input[data-rowoffset]');
    const firstInput=inputs[0];
    const origIdx=(firstInput&&firstInput.dataset.colidx!=='new')?parseInt(firstInput.dataset.colidx):null;
    keptOriginalIdx.push(Number.isNaN(origIdx)?null:origIdx);
    inputs.forEach(inp=>{
      const ri=parseInt(inp.dataset.rowoffset)||0;
      const val=inp.value.trim();
      if(!newHeaderRows[ri])newHeaderRows[ri]=[...((existingHeaderRows[ri]||[]).slice(0,fixedCount))];
      while(newHeaderRows[ri].length<fixedCount)newHeaderRows[ri].push(null);
      newHeaderRows[ri].push(val||null);
    });
  });
  // Rebuild each data row: keep the fixed cells, then for each surviving date column pull the
  // value from its ORIGINAL column index (brand-new columns start blank).
  const newRows=existingRows.map(function(r){
    const fixedPart=(r||[]).slice(0,fixedCount);
    while(fixedPart.length<fixedCount)fixedPart.push(null);
    const datePart=keptOriginalIdx.map(function(origIdx){
      return (origIdx!=null&&(r||[])[origIdx]!=null)?r[origIdx]:null;
    });
    return fixedPart.concat(datePart);
  });
  // Remap cwRowValues (keyed by column index) to the new column positions
  const newCwRowValues={};
  keptOriginalIdx.forEach(function(origIdx,newPos){
    if(origIdx==null)return;
    const vals=existingCwRowValues[origIdx];
    if(vals!=null)newCwRowValues[fixedCount+newPos]=vals;
  });
  // Remap frTimestamps (keyed "rowIdx_colIdx") to the new column positions
  const newFrTimestamps={};
  Object.keys(existingFrTimestamps).forEach(function(k){
    const m=k.match(/^(\d+)_(\d+)$/);
    if(!m)return;
    const oldCi=parseInt(m[2]);
    const newPos=keptOriginalIdx.indexOf(oldCi);
    if(newPos===-1)return; // that column was deleted
    newFrTimestamps[m[1]+'_'+(fixedCount+newPos)]=existingFrTimestamps[k];
  });
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/headerRows',newHeaderRows);
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/row0',newHeaderRows[0]||[]);
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/row1',newHeaderRows[1]||[]);
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/rows',newRows);
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/cwRowValues',newCwRowValues);
  await fbSet('trackers/'+key+'/sheets/'+sheetKey+'/frTimestamps',newFrTimestamps);
  closeModal('modal-lt-upload');
  toast('Date columns saved!');
  renderLiveTrackers();
}
// Called by admin or CDM from Finance Report table
async function frChangeAccountStatus(trackerKey,sheetKey,rowIdx,currentStatus){
  const statuses=['Active','Inactive','Exited'];
  const isAdmin=CU.isAdmin;
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const rows=sheet.rows||[];
  const row=rows[rowIdx];if(!row)return;
  const brand=String(row[4]||row[3]||'').trim()||'This account';

  // CDM can only toggle Active<->Inactive on their own row
  if(!isAdmin){
    const execName=String(row[5]||'').trim();
    const myName=CU.name;
    if(execName!==myName){toast('You can only change status for your own accounts.');return;}
    // CDM can only set Active or Inactive
    const newStatus=currentStatus==='Active'?'Inactive':'Active';
    const _hr0c=(sheet.headerRows&&sheet.headerRows[0])||sheet.row0||[];
    const _acctIc=_hr0c.findIndex(function(l){return/account.?status|acct.?status/i.test(String(l||''));});
    const _aIdxC=_acctIc>=0?_acctIc:2;
    await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+_aIdxC,newStatus);
    toast('Status updated to '+newStatus);
    renderLiveTrackers();
    return;
  }

  // Admin full status change
  const opts=statuses.map(s=>`<option value="${s}"${s===currentStatus?' selected':''}>${s}</option>`).join('');
  document.getElementById('mlt-body').innerHTML=`
    <div style="margin-bottom:12px;font-size:14px;font-weight:600">${escHtml(brand)}</div>
    <div class="fg">
      <label class="flabel">Account Status</label>
      <select class="finput nb" id="fr-new-status" onchange="frStatusSelectChange()">${opts}</select>
    </div>
    <div id="fr-exit-date-wrap" style="display:${currentStatus==='Exited'?'block':'none'};margin-top:10px;padding:12px;background:var(--red-light);border:1px solid var(--red-mid);border-radius:var(--radius)">
      <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ Offboarding Date Required</div>
      <label class="flabel">Offboarding / Exit Date</label>
      <input class="finput nb" id="fr-exit-date" type="date" value="${String(row[7]||'').trim()||ds(now())}"/>
      <div style="font-size:11px;color:var(--red);margin-top:4px">This account will be moved to the Exited tab.</div>
    </div>
    <div class="form-actions" style="margin-top:14px">
      <button class="btn primary" onclick="frSaveAccountStatus('${trackerKey}','${sheetKey}',${rowIdx})">Save Status</button>
      <button class="btn" onclick="closeModal('modal-lt-upload')">Cancel</button>
    </div>`;
  document.getElementById('modal-lt-upload').querySelector('h3').textContent='Change Account Status';
  openModal('modal-lt-upload');
}

function frStatusSelectChange(){
  const sel=document.getElementById('fr-new-status');
  const wrap=document.getElementById('fr-exit-date-wrap');
  if(wrap)wrap.style.display=sel&&sel.value==='Exited'?'block':'none';
}

async function frSaveAccountStatus(trackerKey,sheetKey,rowIdx){
  const newStatus=document.getElementById('fr-new-status')?.value
    || document.getElementById('fr-exit-date')?.dataset?.newStatus
    || document.getElementById('mlt-body')?.dataset?.newStatus;
  const exitDate=document.getElementById('fr-exit-date')?.value||'';
  if(!newStatus)return;
  const t=D.trackers[trackerKey];if(!t)return;
  const sheet=(t.sheets||{})[sheetKey];if(!sheet)return;
  const rows=sheet.rows||[];
  const row=rows[rowIdx];if(!row)return;

  // Dynamic column detection
  const _hr0=(sheet.headerRows&&sheet.headerRows[0])||sheet.row0||[];
  const _acctI=_hr0.findIndex(function(l){return/account.?status|acct.?status/i.test(String(l||''));});
  const _exitI=_hr0.findIndex(function(l){return/exit|offboard/i.test(String(l||''));});
  const _aIdx=_acctI>=0?_acctI:2;
  const _xIdx=_exitI>=0?_exitI:7;

  await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+_aIdx,newStatus);
  if(newStatus==='Exited'||newStatus==='Inactive'){
    await fbSet('trackers/'+trackerKey+'/sheets/'+sheetKey+'/rows/'+rowIdx+'/'+_xIdx,newStatus==='Exited'?exitDate:'');
  }

  // If Exited or Inactive, also list the brand in the Exited tab.
  if(newStatus==='Exited'||newStatus==='Inactive'){
    const existingSheets=t.sheets||{};
    let exitedSheet=existingSheets['Exited'];
    if(!exitedSheet){
      // Create Exited sheet with same structure — preserve headerRows format
      const srcHeaderRows=sheet.headerRows||(sheet.row0?[sheet.row0,sheet.row1].filter(r=>r&&r.length):[]);
      exitedSheet={headerRows:srcHeaderRows.map(r=>[...r]),row0:[...(sheet.row0||[])],row1:[...(sheet.row1||[])],rows:[]};
    }
    const exitedRows=[...(exitedSheet.rows||[])];
    // Dedup on Merchant ID + Store Name so re-toggling status doesn't create duplicates.
    const _key=String(row[3]||'').trim()+'||'+String(row[4]||'').trim();
    const _existingIdx=exitedRows.findIndex(function(r){return (String(r[3]||'').trim()+'||'+String(r[4]||'').trim())===_key;});
    const updatedRow=[...row];
    updatedRow[_aIdx]=newStatus;
    updatedRow[_xIdx]=newStatus==='Exited'?exitDate:'';
    if(_existingIdx>=0)exitedRows[_existingIdx]=updatedRow;else exitedRows.push(updatedRow);
    await fbSet('trackers/'+trackerKey+'/sheets/Exited',{...exitedSheet,rows:exitedRows});
    toast('Account marked as '+newStatus+' and listed in the Exited tab.');
  } else {
    // Reverting to Active — remove any matching entry from the Exited tab.
    const exitedSheet=(t.sheets||{})['Exited'];
    if(exitedSheet&&exitedSheet.rows&&exitedSheet.rows.length){
      const _key=String(row[3]||'').trim()+'||'+String(row[4]||'').trim();
      const _filtered=exitedSheet.rows.filter(function(r){return (String(r[3]||'').trim()+'||'+String(r[4]||'').trim())!==_key;});
      if(_filtered.length!==exitedSheet.rows.length){
        await fbSet('trackers/'+trackerKey+'/sheets/Exited',{...exitedSheet,rows:_filtered});
      }
    }
    toast('Status updated to '+newStatus);
  }
  closeModal('modal-lt-upload');
  renderLiveTrackers();
}

// ─────────────────────────────────────────────
// SIDEBAR NAV
// ─────────────────────────────────────────────
let _sidebarCollapsed=false;
function toggleSidebar(){
  _sidebarCollapsed=!_sidebarCollapsed;
  const sb=document.getElementById('sidebar');
  if(sb)sb.classList.toggle('collapsed',_sidebarCollapsed);
  localStorage.setItem('gh_sb_collapsed',_sidebarCollapsed?'1':'0');
  const icon=document.getElementById('sidebar-toggle-icon');
  if(icon)icon.setAttribute('d',_sidebarCollapsed?'M9 18l6-6-6-6':'M15 18l-6-6 6-6');
}

function buildNav(){
  // Legacy nav-center — keep empty (hidden by CSS)
  const n=document.getElementById('nav-center');if(n)n.innerHTML='';

  const sn=document.getElementById('sidebar-nav');
  if(!sn)return;

  const badges=getNavBadges();
  const sp=p=>"showPage('"+p+"')";

  function sItem(page,icon,label,badgeCount,extraCls){
    var badge=badgeCount>0?'<span class="sidebar-item-badge">'+(badgeCount>99?'99+':badgeCount)+'</span>':'';
    var active=(_curPage===page)?'active':'';
    return '<button class="sidebar-item '+active+' '+(extraCls||'')+'" data-page="'+page+'" onclick="'+sp(page)+'" title="'+label+'"><span class="sidebar-item-icon">'+icon+'</span><span class="sidebar-item-label">'+label+'</span>'+badge+'<span class="sidebar-tooltip">'+label+'</span></button>';
  }

  const ICONS={
    dashboard:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    tasks:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    trackers:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    audit:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    tod:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    campaigns:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/></svg>',
    calendar:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    members:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    incidents:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    reports:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    leaves:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    workspace:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    notes:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    bulletin:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>',
  };

  let html='';
  const totalBulletin=badges.bulletin||0;
  const totalData=(badges.incidents||0)+(badges.reports||0)+(badges.members||0)+(badges.leaves||0);

  if(CU.isAdmin){
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Overview</div>'
      +sItem('dashboard',ICONS.dashboard,'Dashboard',badges.dashboard||0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Operations</div>'
      +sItem('tasks',ICONS.tasks,'Task Management',badges.tasks||0)
      +sItem('live-trackers',ICONS.trackers,'Live Trackers',0)
      +sItem('tod',ICONS.tod,'Talent on Demand',0)
      +sItem('calendar',ICONS.calendar,'My Calendar',0)
      +sItem('campaigns',ICONS.campaigns,'Campaign Center',0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Data & Activity</div>'
      +sItem('members',ICONS.members,'Members',badges.members||0)
      +sItem('incidents',ICONS.incidents,'Incidents',badges.incidents||0)
      +sItem('reports',ICONS.reports,'Reports',badges.reports||0)
      +sItem('leaves',ICONS.leaves,'Leaves',badges.leaves||0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">WorkSpace</div>'
      +sItem('notes',ICONS.notes,'Notes',0)
      +sItem('bulletin',ICONS.bulletin,'Announcements',totalBulletin)
      +'</div>';
  } else if(isLead()){
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Overview</div>'
      +sItem('dashboard',ICONS.dashboard,'Dashboard',badges.dashboard||badges['my-tasks']||0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Operations</div>'
      +sItem('tasks',ICONS.tasks,'Task Management',badges.tasks||0)
      +sItem('live-trackers',ICONS.trackers,'Live Trackers',0)
      +sItem('calendar',ICONS.calendar,'My Calendar',0)
      +sItem('campaigns',ICONS.campaigns,'Campaign Center',0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Data & Activity</div>'
      +sItem('members',ICONS.members,'Members',badges.members||0)
      +sItem('incidents',ICONS.incidents,'Incidents',badges.incidents||0)
      +sItem('reports',ICONS.reports,'Reports',badges.reports||0)
      +sItem('leaves',ICONS.leaves,'Leaves',badges.leaves||0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">WorkSpace</div>'
      +sItem('notes',ICONS.notes,'Notes',0)
      +sItem('bulletin',ICONS.bulletin,'Announcements',totalBulletin)
      +'</div>';
  } else if(isTOD()){
    html+='<div class="sidebar-section">'
      +sItem('dashboard',ICONS.dashboard,'Dashboard',badges.dashboard||badges['my-tasks']||0)
      +sItem('tod',ICONS.tod,'Talent on Demand',0)
      +(CU.ltAccess?sItem('live-trackers',ICONS.trackers,'Live Trackers',0):'')
      +sItem('leaves',ICONS.leaves,'Leaves',0)
      +sItem('calendar',ICONS.calendar,'My Calendar',0)
      +sItem('campaigns',ICONS.campaigns,'Campaign Center',0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">WorkSpace</div>'
      +sItem('notes',ICONS.notes,'Notes',0)
      +sItem('bulletin',ICONS.bulletin,'Announcements',totalBulletin)
      +'</div>';
  } else {
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Overview</div>'
      +sItem('dashboard',ICONS.dashboard,'Dashboard',badges.dashboard||badges['my-tasks']||0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">Operations</div>'
      +sItem('tasks',ICONS.tasks,'Task Management',badges.tasks||0)
      +sItem('live-trackers',ICONS.trackers,'Live Trackers',0)
      +sItem('incidents',ICONS.incidents,'Incidents',badges.incidents||0)
      +sItem('leaves',ICONS.leaves,'Leaves',0)
      +sItem('calendar',ICONS.calendar,'My Calendar',0)
      +sItem('campaigns',ICONS.campaigns,'Campaign Center',0)
      +'</div>';
    html+='<div class="sidebar-section"><div class="sidebar-section-label">WorkSpace</div>'
      +sItem('notes',ICONS.notes,'Notes',0)
      +sItem('bulletin',ICONS.bulletin,'Announcements',totalBulletin)
      +'</div>';
  }

  sn.innerHTML=html;

  // Restore active state
  document.querySelectorAll('.sidebar-item,.sidebar-sub-item').forEach(el=>{
    el.classList.toggle('active',el.dataset.page===_curPage);
  });
}

// ─────────────────────────────────────────────
// CMD PALETTE (Ctrl+K / Cmd+K)
// ─────────────────────────────────────────────
let _cmdSelIdx=-1;
let _cmdItems=[];

function openCmd(){
  document.getElementById('cmd-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('cmd-input').focus(),50);
  cmdFilter('');
}
function closeCmd(){
  document.getElementById('cmd-overlay').classList.remove('open');
  document.getElementById('cmd-input').value='';
  _cmdSelIdx=-1;
}

function cmdFilter(q){
  q=(q||'').toLowerCase().trim();
  const results=[];

  // Navigation pages
  const pages=[
    {p:'dashboard',l:'Dashboard',sub:'Overview of todays tasks',icon:'🏠',cat:'Navigate',col:'ci-blue'},
    {p:'tasks',l:'Task Management',sub:'View and manage all tasks',icon:'✅',cat:'Navigate',col:'ci-blue'},
    {p:'live-trackers',l:'Live Trackers',sub:'AO and tracker sheets',icon:'📊',cat:'Navigate',col:'ci-blue'},
    {p:'members',l:'Members',sub:'Team members list',icon:'👥',cat:'Navigate',col:'ci-blue'},
    {p:'incidents',l:'Incidents',sub:'Log and track incidents',icon:'⚠️',cat:'Navigate',col:'ci-red'},
    {p:'reports',l:'Reports',sub:'Weekly reports',icon:'📈',cat:'Navigate',col:'ci-blue'},
    {p:'leaves',l:'Leaves',sub:'Leave monitoring',icon:'🌴',cat:'Navigate',col:'ci-green'},
    {p:'calendar',l:'My Calendar',sub:'Personal schedule',icon:'📅',cat:'Navigate',col:'ci-teal'},
    {p:'campaigns',l:'Campaign Center',sub:'Campaign dates, regions & checklists',icon:'🚩',cat:'Navigate',col:'ci-blue'},
    ...((CU.isAdmin||isTOD())?[{p:'tod',l:'Talent on Demand',sub:'TOD attendance & billing tracker',icon:'⏱️',cat:'Navigate',col:'ci-yellow'}]:[]),
    {p:'workspace',l:'WorkSpace',sub:'Notes and announcements',icon:'🗂️',cat:'Navigate',col:'ci-blue'},
    {p:'my-tasks',l:'My Dashboard',sub:'Your personal task view',icon:'🎯',cat:'Navigate',col:'ci-green'},
  ];
  pages.forEach(pg=>{
    if(!q||pg.l.toLowerCase().includes(q)||pg.sub.toLowerCase().includes(q)||pg.cat.toLowerCase().includes(q)){
      results.push({type:'page',...pg});
    }
  });

  // Tasks
  if(!q||'task'.includes(q)){
    const allT=[...(D.tasks||[]),...(D.leadTasks||[])].filter(t=>!t.inactive);
    allT.filter(t=>!q||t.title.toLowerCase().includes(q)).slice(0,5).forEach(t=>{
      results.push({type:'task',l:t.title,sub:'Task · '+t.freq,icon:'✅',cat:'Tasks',col:'ci-yellow',action:()=>showPage('tasks')});
    });
  }

  // Members
  if(!q||'member'.includes(q)){
    (D.members||[]).filter(m=>m.approved&&(!q||m.name.toLowerCase().includes(q)||m.role.toLowerCase().includes(q))).slice(0,4).forEach(m=>{
      results.push({type:'member',l:m.name,sub:m.role+(m.region?' · '+m.region:''),icon:'👤',cat:'Members',col:'ci-green',action:()=>showPage('members')});
    });
  }

  // Incidents
  if(!q||'incident'.includes(q)){
    (D.incidents||[]).filter(i=>i.status==='Open'&&(!q||((i.description||'').toLowerCase().includes(q)))).slice(0,3).forEach(i=>{
      results.push({type:'incident',l:(i.description||'Incident').slice(0,50),sub:'Open · '+i.severity,icon:'⚠️',cat:'Incidents',col:'ci-red',action:()=>showPage('incidents')});
    });
  }

  _cmdItems=results;
  _cmdSelIdx=results.length>0?0:-1;
  renderCmdResults(q);
}

function renderCmdResults(q){
  const el=document.getElementById('cmd-results');
  if(!_cmdItems.length){el.innerHTML='<div class="cmd-empty">No results for "'+escHtml(q||'')+'"</div>';return;}
  const byCat={};
  _cmdItems.forEach((item,i)=>{
    if(!byCat[item.cat])byCat[item.cat]=[];
    byCat[item.cat].push({...item,_idx:i});
  });
  let html='';
  Object.entries(byCat).forEach(([cat,items])=>{
    html+='<div class="cmd-section-label">'+cat+'</div>';
    items.forEach(item=>{
      html+='<div class="cmd-item'+(item._idx===_cmdSelIdx?' sel':'')+'" data-idx="'+item._idx+'" onclick="cmdSelect('+item._idx+')" onmouseover="cmdHover('+item._idx+')">'
        +'<div class="cmd-item-icon '+item.col+'">'+item.icon+'</div>'
        +'<div class="cmd-item-text"><div class="cmd-item-label">'+escHtml(item.l)+'</div><div class="cmd-item-sub">'+escHtml(item.sub||'')+'</div></div>'
        +'<div class="cmd-item-tag">'+cat+'</div>'
        +'</div>';
    });
  });
  el.innerHTML=html;
}

function cmdHover(idx){_cmdSelIdx=idx;renderCmdResults(document.getElementById('cmd-input').value);}

function cmdSelect(idx){
  const item=_cmdItems[idx];
  if(!item)return;
  if(item.action)item.action();
  else if(item.p)showPage(item.p);
  closeCmd();
}

function cmdKey(e){
  if(e.key==='Escape'){closeCmd();return;}
  if(e.key==='ArrowDown'){e.preventDefault();_cmdSelIdx=Math.min(_cmdSelIdx+1,_cmdItems.length-1);renderCmdResults(e.target.value);scrollCmdSel();return;}
  if(e.key==='ArrowUp'){e.preventDefault();_cmdSelIdx=Math.max(_cmdSelIdx-1,0);renderCmdResults(e.target.value);scrollCmdSel();return;}
  if(e.key==='Enter'){e.preventDefault();if(_cmdSelIdx>=0)cmdSelect(_cmdSelIdx);return;}
}

function scrollCmdSel(){
  const el=document.querySelector('.cmd-item.sel');
  if(el)el.scrollIntoView({block:'nearest'});
}

// Global Ctrl+K / Cmd+K listener
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openCmd();}
});

