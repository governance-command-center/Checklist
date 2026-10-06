/* ════════════════════════════════════════════════════════════════════
   CAMPAIGN CONTROL CENTER  (loaded after app.js — reuses its globals:
   D, CU, ds, now, fmtM, escHtml, toast, openModal/closeModal,
   fbGet/fbSet/fbUpd/fbPush/fbDel, isLead, logAct, AUDIT_PLATFORMS)

   Firebase:  campaigns/{campaignId} = {
       name, type, month:'YYYY-MM', createdAt/By, updatedAt/By,
       schedules:{ {sid}:{ region, platform, teasing, dday, end } },   // one row = Region + Platform
       links:{ {REGION_Platform_kind}:{ taskId, owner, kind, region, platform, date, createdAt, createdBy } }
   }
   Checklist tasks are ordinary GovernanceHub tasks (tasks/ for admin,
   leadTasks/{user}/ for leads) with campaignId/campaignKind fields added.
   ════════════════════════════════════════════════════════════════════ */

const CMP_REGIONS=['MY','PH','SG','TH','VN','ID'];
const CMP_TYPES={
  'double-digit':{l:'Double Digit'},
  'mid-month':{l:'Mid-Month'},
  'payday':{l:'Payday'},
  'other':{l:'Other'}
};
const CMP_KINDS={
  teasing:{l:'Teasing Checklist',s:'Teasing',f:'teasing',b:'T'},
  dday:{l:'D-Day Checklist',s:'D-Day',f:'dday',b:'D'},
  post:{l:'Post-Campaign Checklist',s:'Post-Campaign',f:'end',b:'P'}
};
const CMP_KIND_ORDER=['teasing','dday','post'];

let _cmp={view:'overview',region:'ALL',platform:'ALL',month:null,tl:'date'};
let _cmpForm=null,_cmpGenCid=null,_cmpGenSel={teasing:true,dday:true,post:true,scope:'all'},_cmpBusy=false;

/* ── small helpers ── */
const cmpE=s=>escHtml(s==null?'':String(s));
const cmpCan=()=>!!CU&&(CU.isAdmin||isLead());
function cmpPlatforms(){
  const base=(typeof AUDIT_PLATFORMS!=='undefined'&&AUDIT_PLATFORMS)||['Lazada','Shopee','TikTok','Zalora','Qoo10','All'];
  return base.filter(p=>p!=='All');
}
function cmpPD(s){const p=String(s).split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
function cmpAdd(s,n){const d=cmpPD(s);d.setDate(d.getDate()+n);return ds(d);}
function cmpFmt(s){return s?cmpPD(s).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';}
function cmpFmtY(s){return s?cmpPD(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';}
function cmpDowS(s){return cmpPD(s).toLocaleDateString('en-US',{weekday:'short'});}
function cmpDeadlineLabel(date){return cmpFmtY(date)+' · 5:00 PM';}
function cmpTypeCls(c){return 'cmp-t-'+(CMP_TYPES[c.type]?c.type:'other');}
function cmpTypeLabel(c){return (CMP_TYPES[c.type]||CMP_TYPES.other).l;}
function cmpMonthKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}

function cmpCampaigns(){
  return Object.entries(D.campaigns||{}).filter(([k,c])=>c&&typeof c==='object').map(([id,c])=>({...c,id}));
}
function cmpScheds(c){
  return Object.entries(c.schedules||{})
    .filter(([k,s])=>s&&s.region&&s.teasing&&s.dday&&s.end)
    .map(([sid,s])=>({...s,sid}))
    .sort((a,b)=>CMP_REGIONS.indexOf(a.region)-CMP_REGIONS.indexOf(b.region)||String(a.platform).localeCompare(String(b.platform)));
}
function cmpMatch(s){return (_cmp.region==='ALL'||s.region===_cmp.region)&&(_cmp.platform==='ALL'||s.platform===_cmp.platform);}
function cmpFilterActive(){return _cmp.region!=='ALL'||_cmp.platform!=='ALL';}
function cmpSpan(ss){
  if(!ss.length)return null;
  return {
    start:ss.reduce((a,s)=>s.teasing<a?s.teasing:a,ss[0].teasing),
    live:ss.reduce((a,s)=>s.dday<a?s.dday:a,ss[0].dday),
    end:ss.reduce((a,s)=>s.end>a?s.end:a,ss[0].end)
  };
}
/* Campaigns visible for the viewed month, with schedules already narrowed by the region/platform filter */
function cmpMonthCampaigns(){
  if(!_cmp.month)_cmp.month=new Date(now().getFullYear(),now().getMonth(),1);
  const y=_cmp.month.getFullYear(),m=_cmp.month.getMonth();
  const mStart=ds(new Date(y,m,1)),mEnd=ds(new Date(y,m+1,0)),mKey=cmpMonthKey(_cmp.month);
  const out=[];
  cmpCampaigns().forEach(c=>{
    const ss=cmpScheds(c).filter(cmpMatch),span=cmpSpan(ss);
    if(span){if(span.start<=mEnd&&span.end>=mStart)out.push({c,ss,span});}
    else if(!cmpFilterActive()&&!cmpScheds(c).length&&c.month===mKey)out.push({c,ss:[],span:null});
  });
  out.sort((a,b)=>(a.span?a.span.start:'9999').localeCompare(b.span?b.span.start:'9999')||String(a.c.name).localeCompare(String(b.c.name)));
  return out;
}

/* ── checklist link helpers ── */
function cmpLinkKey(region,platform,kind){return (region+'_'+platform+'_'+kind).replace(/[.#$\/\[\]\s]/g,'_');}
function cmpTaskPath(link){return link.owner==='admin'?'tasks/'+link.taskId:'leadTasks/'+link.owner+'/'+link.taskId;}
/* A link only counts if its task still exists. If we can't verify (another lead's private task) we assume it does,
   so we never create a duplicate by mistake. */
function cmpTaskExists(link){
  if(!link)return false;
  if(link.owner==='admin')return D._tLoaded?(D.tasks||[]).some(t=>String(t.id)===String(link.taskId)):true;
  const found=(D.leadTasks||[]).some(t=>String(t.id)===String(link.taskId)&&t._leadOwner===link.owner);
  if(found)return true;
  return !(CU&&CU.username===link.owner);
}
/* 'none' = not generated · 'ok' = generated & dates match · 'drift' = generated but campaign date has since changed */
function cmpLinkState(c,s,kind){
  const link=(c.links||{})[cmpLinkKey(s.region,s.platform,kind)];
  if(!link||!cmpTaskExists(link))return 'none';
  return link.date===s[CMP_KINDS[kind].f]?'ok':'drift';
}
function cmpDrift(c){
  const ss=cmpScheds(c),changes=[],orphans=[];
  Object.entries(c.links||{}).forEach(([key,link])=>{
    if(!link||!cmpTaskExists(link))return;
    const s=ss.find(x=>x.region===link.region&&x.platform===link.platform);
    if(!s){orphans.push(key);return;}
    const nd=s[CMP_KINDS[link.kind].f];
    if(nd&&nd!==link.date)changes.push({key,link,newDate:nd});
  });
  return {changes,orphans};
}

/* ════════════ PAGE ════════════ */
function renderCampaigns(){
  const el=document.getElementById('pg-campaigns');if(!el||!CU)return;
  const list=cmpMonthCampaigns(),can=cmpCan();
  const plats=cmpPlatforms();
  const tab=(v,l)=>`<button class="cmp-tab${_cmp.view===v?' on':''}" onclick="cmpSetView('${v}')">${l}</button>`;
  const chip=r=>`<button class="cmp-chip${_cmp.region===r?' on':''}" onclick="cmpSetRegion('${r}')">${r==='ALL'?'ALL':r}</button>`;
  const body=_cmp.view==='overview'?cmpOverviewHTML(list):_cmp.view==='region'?cmpRegionHTML(list):cmpTimelineHTML(list);
  el.innerHTML=`
    <div class="page-header">
      <div><div class="page-title">Campaign Control Center</div>
        <div style="font-size:13px;color:var(--text3);margin-top:4px">One schedule per campaign — regions, platforms and Governance checklist dates in one place.</div></div>
      ${can?`<button class="btn primary" onclick="cmpOpenForm()">+ Add Campaign</button>`:''}
    </div>
    <div class="panel cmp-toolbar">
      <div class="cmp-tabs">${tab('overview','Overview')}${tab('region','By Region')}${tab('checklist','Checklist Timeline')}</div>
      <div class="cmp-monthnav">
        <button class="btn sm" onclick="cmpMonthStep(-1)">&#8592;</button>
        <div class="cal-title" style="min-width:130px;text-align:center">${fmtM(_cmp.month)}</div>
        <button class="btn sm" onclick="cmpMonthStep(1)">&#8594;</button>
        <button class="btn sm" onclick="cmpMonthStep(0)">Today</button>
      </div>
      <div class="cmp-filters">
        <div class="cmp-chips">${['ALL',...CMP_REGIONS].map(chip).join('')}</div>
        <select class="finput nb cmp-plat" onchange="cmpSetPlatform(this.value)" title="Platform filter">
          <option value="ALL"${_cmp.platform==='ALL'?' selected':''}>All platforms</option>
          ${plats.map(p=>`<option value="${cmpE(p)}"${_cmp.platform===p?' selected':''}>${cmpE(p)}</option>`).join('')}
        </select>
      </div>
    </div>
    ${body}`;
}
function cmpSetView(v){_cmp.view=v;renderCampaigns();}
function cmpSetRegion(r){_cmp.region=r;renderCampaigns();}
function cmpSetPlatform(p){_cmp.platform=p;renderCampaigns();}
function cmpMonthStep(n){
  if(n===0)_cmp.month=new Date(now().getFullYear(),now().getMonth(),1);
  else _cmp.month=new Date(_cmp.month.getFullYear(),_cmp.month.getMonth()+n,1);
  renderCampaigns();
}
function cmpEmpty(msg){
  const none=!cmpCampaigns().length;
  return `<div class="panel"><div class="empty-state"><div class="empty-state-icon">🚩</div>
    <div class="empty-state-title">${none?'No campaigns yet':'No campaigns match'}</div>
    <div class="empty-state-sub">${none?(cmpCan()?'Use “+ Add Campaign” to create the first one.':'Campaigns will appear here once they are created.'):msg}</div></div></div>`;
}

/* ════════════ VIEW 1 — OVERVIEW ════════════ */
function cmpOverviewHTML(list){
  const y=_cmp.month.getFullYear(),m=_cmp.month.getMonth(),first=new Date(y,m,1).getDay(),dim=new Date(y,m+1,0).getDate(),today=ds(now());
  /* greedy lane packing so a campaign keeps the same row across every day it spans */
  const items=list.filter(x=>x.span),lanes=[];
  items.forEach(it=>{let l=0;while(lanes[l]!==undefined&&lanes[l]>=it.span.start)l++;lanes[l]=it.span.end;it.lane=l;});
  const SHOW=3,L=Math.min(lanes.length,SHOW);
  let cells='';
  for(let i=0;i<first;i++)cells+='<div class="cal-cell cmp-cell other-m"></div>';
  for(let d=1;d<=dim;d++){
    const dd=new Date(y,m,d),dds=ds(dd),dow=dd.getDay();
    const active=items.filter(it=>dds>=it.span.start&&dds<=it.span.end);
    let bars='';
    for(let l=0;l<L;l++){
      const it=active.find(a=>a.lane===l);
      if(!it){bars+='<div class="cmp-spacer"></div>';continue;}
      const tease=dds<it.span.live,segStart=dds===it.span.start||dds===it.span.live;
      const label=(segStart||dow===0||d===1)?cmpE(it.c.name):'&nbsp;';
      bars+=`<div class="cmp-bar ${cmpTypeCls(it.c)}${tease?' tease':''}${dds===it.span.start?' first':''}${dds===it.span.end?' last':''}" title="${cmpE(it.c.name)} — ${tease?'teasing period':'live'}" onclick="cmpOpen('${it.c.id}')">${label}</div>`;
    }
    const hidden=active.filter(a=>a.lane>=SHOW).length;
    if(hidden)bars+=`<div class="cmp-more">+${hidden} more</div>`;
    cells+=`<div class="cal-cell cmp-cell${dds===today?' today':''}"><span class="cal-date">${d}</span>${bars}</div>`;
  }
  const cards=list.map(({c,ss,span})=>{
    const regs=[...new Set(ss.map(s=>s.region))].sort((a,b)=>CMP_REGIONS.indexOf(a)-CMP_REGIONS.indexOf(b));
    return `<div class="cmp-card ${cmpTypeCls(c)}" onclick="cmpOpen('${c.id}')">
      <div class="cmp-card-top"><div class="cmp-card-name">${cmpE(c.name)}</div><span class="cmp-type">${cmpTypeLabel(c)}</span></div>
      <div class="cmp-card-sub">${span?`${cmpFmt(span.start)} – ${cmpFmt(span.end)} · ${ss.length} schedule${ss.length===1?'':'s'}`:'No regional schedule yet'}</div>
      <div class="cmp-card-regs">${regs.map(r=>`<span class="cmp-rg">${r}</span>`).join('')||'<span style="font-size:12px;color:var(--text4)">—</span>'}</div>
    </div>`;
  }).join('');
  if(!list.length)return cmpEmpty('Nothing is scheduled for this month with the current filters.');
  return `
    <div class="cal-wrap" style="margin-bottom:16px">
      <div class="cal-header"><div class="cal-title">What’s running in ${fmtM(_cmp.month)}</div>
        <div class="cmp-legend"><span><i class="cmp-sw tease"></i>Teasing</span><span><i class="cmp-sw live"></i>Live (D-Day → End)</span>
        <span class="cmp-lg-t" style="--c:#7c3aed"><i class="cmp-dot"></i>Double Digit</span><span style="--c:#db2777" class="cmp-lg-t"><i class="cmp-dot"></i>Mid-Month</span><span style="--c:#16a34a" class="cmp-lg-t"><i class="cmp-dot"></i>Payday</span><span style="--c:#64748b" class="cmp-lg-t"><i class="cmp-dot"></i>Other</span></div></div>
      <div class="cal-grid">${DOW.map(x=>`<div class="cal-dh">${x}</div>`).join('')}${cells}</div>
    </div>
    <div class="section-hdr sh-blue" style="margin-bottom:10px">Campaigns this month</div>
    <div class="cmp-cards">${cards}</div>`;
}

/* ════════════ VIEW 2 — BY REGION (mini Gantt) ════════════ */
function cmpPhase(s,day){
  if(day<s.teasing||day>s.end)return '';
  if(day===s.dday&&day===s.end)return 'dend';
  if(day===s.dday)return 'dday';
  if(day===s.end)return 'end';
  if(day<s.dday)return 'tease';
  return 'live';
}
function cmpRegionHTML(list){
  if(!list.length)return cmpEmpty('Nothing is scheduled for this month with the current filters.');
  const today=ds(now());
  const legend=`<div class="cmp-legend" style="margin-bottom:12px">
    <span><b class="cmp-bd tease">T</b>Teasing</span><span><b class="cmp-bd dday">D</b>D-Day</span><span><b class="cmp-bd live"></b>Campaign live</span><span><b class="cmp-bd end">E</b>Campaign End</span></div>`;
  const panels=list.filter(x=>x.span).map(({c,ss,span})=>{
    const days=[];for(let d=span.start;d<=span.end;d=cmpAdd(d,1))days.push(d);
    const head=days.map(d=>`<th class="cmp-mx-h${d===today?' today':''}"><div>${cmpFmt(d)}</div><div class="cmp-mx-dow">${cmpDowS(d)}</div></th>`).join('');
    const rows=ss.map((s,i)=>{
      const prev=ss[i-1],showRg=!prev||prev.region!==s.region;
      const tds=days.map(d=>{
        const ph=cmpPhase(s,d),lbl={tease:'T',dday:'D',end:'E',dend:'D·E',live:''}[ph]||'';
        const tip={tease:'Teasing',dday:'D-Day',end:'Campaign End',dend:'D-Day & Campaign End',live:'Campaign'}[ph]||'';
        return `<td class="cmp-c ph-${ph||'none'}${d===today?' today':''}" ${tip?`title="${s.region} ${cmpE(s.platform)} · ${tip} · ${cmpFmt(d)}"`:''}>${lbl}</td>`;
      }).join('');
      return `<tr><td class="cmp-mx-rg">${showRg?`<span class="cmp-rg">${s.region}</span>`:''}</td><td class="cmp-mx-pl">${cmpE(s.platform)}</td>${tds}</tr>`;
    }).join('');
    return `<div class="panel cmp-panel ${cmpTypeCls(c)}">
      <div class="cmp-panel-hd"><div><span class="cmp-dot big"></span><b>${cmpE(c.name)}</b> <span class="cmp-type">${cmpTypeLabel(c)}</span></div>
        <button class="btn sm" onclick="cmpOpen('${c.id}')">Details</button></div>
      <div class="cmp-scroll"><table class="cmp-mx"><thead><tr><th class="cmp-mx-rg"></th><th class="cmp-mx-pl">Platform</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }).join('');
  return legend+panels;
}

/* ════════════ VIEW 3 — CHECKLIST TIMELINE ════════════ */
function cmpItems(list){
  const out=[];
  list.forEach(({c,ss})=>ss.forEach(s=>CMP_KIND_ORDER.forEach(k=>{
    out.push({c,s,kind:k,date:s[CMP_KINDS[k].f],state:cmpLinkState(c,s,k)});
  })));
  return out;
}
const CMP_STATE_LBL={ok:'Generated',drift:'Dates changed',none:'Not generated'};
function cmpTimelineHTML(list){
  if(!list.length)return cmpEmpty('Nothing is scheduled for this month with the current filters.');
  const y=_cmp.month.getFullYear(),m=_cmp.month.getMonth(),mStart=ds(new Date(y,m,1)),mEnd=ds(new Date(y,m+1,0)),today=ds(now());
  const all=cmpItems(list),inMonth=all.filter(i=>i.date>=mStart&&i.date<=mEnd);
  const gen=inMonth.filter(i=>i.state==='ok').length,drift=inMonth.filter(i=>i.state==='drift').length,none=inMonth.filter(i=>i.state==='none').length;
  const mode=`<div class="cmp-tabs sm"><button class="cmp-tab${_cmp.tl==='date'?' on':''}" onclick="cmpSetTl('date')">By date</button><button class="cmp-tab${_cmp.tl==='schedule'?' on':''}" onclick="cmpSetTl('schedule')">By schedule</button></div>`;
  const head=`<div class="panel cmp-sum">
    <div class="cmp-sum-stats"><div><b>${inMonth.length}</b> checklist dates this month</div><div><b style="color:var(--green)">${gen}</b> generated</div>
      ${drift?`<div><b style="color:var(--yellow)">${drift}</b> need a date update</div>`:''}<div><b style="color:var(--text3)">${none}</b> not generated</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${mode}${cmpCan()?`<button class="btn primary" onclick="cmpGenOpen()">Generate Campaign Checklists</button>`:''}</div></div>`;
  if(_cmp.tl==='schedule'){
    const rows=list.filter(x=>x.ss.length).map(({c,ss})=>ss.map((s,i)=>{
      const cell=k=>{const st=cmpLinkState(c,s,k);return `<td><div class="cmp-dt">${cmpFmt(s[CMP_KINDS[k].f])}<span class="cmp-st sm ${st}" title="${CMP_STATE_LBL[st]}">${st==='ok'?'✓':st==='drift'?'!':'–'}</span></div></td>`;};
      return `<tr class="${cmpTypeCls(c)}">${i===0?`<td rowspan="${ss.length}" class="cmp-tl-camp"><span class="cmp-dot big"></span><a onclick="cmpOpen('${c.id}')">${cmpE(c.name)}</a></td>`:''}<td><span class="cmp-rg">${s.region}</span></td><td>${cmpE(s.platform)}</td>${cell('teasing')}${cell('dday')}${cell('post')}</tr>`;
    }).join('')).join('');
    return head+`<div class="panel" style="padding:0;overflow:hidden"><div class="cmp-scroll"><table class="cmp-tbl"><thead><tr><th>Campaign</th><th>Region</th><th>Platform</th><th>Teasing Checklist</th><th>D-Day Checklist</th><th>Checklist End / Post-Campaign</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="cmp-legend"><span><b class="cmp-st sm ok">✓</b>Generated</span><span><b class="cmp-st sm drift">!</b>Dates changed</span><span><b class="cmp-st sm none">–</b>Not generated</span></div>`;
  }
  inMonth.sort((a,b)=>a.date.localeCompare(b.date)||CMP_KIND_ORDER.indexOf(a.kind)-CMP_KIND_ORDER.indexOf(b.kind)||CMP_REGIONS.indexOf(a.s.region)-CMP_REGIONS.indexOf(b.s.region)||String(a.s.platform).localeCompare(String(b.s.platform)));
  if(!inMonth.length)return head+`<div class="panel"><div class="empty-state"><div class="empty-state-title">No checklist dates in ${fmtM(_cmp.month)}</div><div class="empty-state-sub">These campaigns’ checklist dates fall in another month — use the arrows above.</div></div></div>`;
  const groups={};inMonth.forEach(i=>(groups[i.date]=groups[i.date]||[]).push(i));
  const body=Object.keys(groups).sort().map(date=>`
    <div class="cmp-day${date===today?' is-today':''}${date<today?' is-past':''}">
      <div class="cmp-day-h">${cmpPD(date).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}${date===today?'<span class="cmp-today-tag">Today</span>':''}</div>
      ${groups[date].map(i=>`<div class="cmp-item ${cmpTypeCls(i.c)}" onclick="cmpOpen('${i.c.id}')">
        <span class="cmp-k k-${i.kind}">${CMP_KINDS[i.kind].l}</span>
        <span class="cmp-rg">${i.s.region}</span><span class="cmp-plat-t">${cmpE(i.s.platform)}</span>
        <span class="cmp-it-name"><i class="cmp-dot"></i>${cmpE(i.c.name)}</span>
        <span class="cmp-st ${i.state}">${CMP_STATE_LBL[i.state]}</span></div>`).join('')}
    </div>`).join('');
  return head+`<div class="panel cmp-agenda">${body}</div>`;
}
function cmpSetTl(v){_cmp.tl=v;renderCampaigns();}

/* ════════════ CAMPAIGN DETAIL (click a campaign anywhere) ════════════ */
function cmpOpen(cid){
  const c=(D.campaigns||{})[cid];if(!c){toast('Campaign not found');return;}
  c.id=cid;
  const ss=cmpScheds(c),can=cmpCan(),dr=cmpDrift(c);
  document.getElementById('mcp-title').textContent=c.name;
  const rows=ss.map((s,i)=>{
    const prev=ss[i-1],showRg=!prev||prev.region!==s.region;
    const ck=CMP_KIND_ORDER.map(k=>{const st=cmpLinkState(c,s,k);return `<span class="cmp-ck ${st}" title="${CMP_KINDS[k].l}: ${CMP_STATE_LBL[st]}">${CMP_KINDS[k].b}</span>`;}).join('');
    const dt=d=>`${cmpFmt(d)} <span class="cmp-dow">${cmpDowS(d)}</span>`;
    return `<tr><td>${showRg?`<span class="cmp-rg">${s.region}</span>`:''}</td><td>${cmpE(s.platform)}</td><td>${dt(s.teasing)}</td><td><b>${dt(s.dday)}</b></td><td>${dt(s.end)}</td><td>${ck}</td></tr>`;
  }).join('');
  document.getElementById('mcp-body').innerHTML=`
    <div class="${cmpTypeCls(c)}" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <span class="cmp-type">${cmpTypeLabel(c)}</span>
      <span style="font-size:13px;color:var(--text3)">${c.month?fmtM(new Date(c.month+'-01T00:00:00')):''} · ${[...new Set(ss.map(s=>s.region))].length} region(s) · ${ss.length} schedule(s)</span>
    </div>
    ${ss.length?`<div class="cmp-scroll"><table class="cmp-tbl"><thead><tr><th>Region</th><th>Platform</th><th>Teasing</th><th>D-Day</th><th>Campaign End</th><th>Checklists</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="cmp-legend" style="margin-top:10px"><span><b class="cmp-ck ok">T</b>Generated</span><span><b class="cmp-ck drift">T</b>Dates changed</span><span><b class="cmp-ck none">T</b>Not generated</span><span style="color:var(--text4)">T Teasing · D D-Day · P Post-Campaign</span></div>`
    :'<div class="empty-state" style="padding:20px">No regional schedules yet.</div>'}
    ${dr.changes.length?`<div class="esc-banner" style="margin-top:12px"><div style="font-size:13px;flex:1"><b>${dr.changes.length} linked checklist deadline(s)</b> no longer match the campaign dates.</div>${can?`<button class="btn sm warning" onclick="cmpSync('${cid}')">Review &amp; update</button>`:''}</div>`:''}
    ${dr.orphans.length?`<div style="font-size:12px;color:var(--text3);margin-top:10px">${dr.orphans.length} linked checklist(s) belong to a region/platform that is no longer in this schedule — they were left untouched.</div>`:''}
    ${can?`<div class="form-actions"><button class="btn primary" onclick="cmpGenOpen('${cid}')">Generate Campaign Checklists</button><button class="btn" onclick="cmpOpenForm('${cid}')">Edit</button><button class="btn" style="margin-left:auto;color:var(--red)" onclick="cmpDelete('${cid}')">Delete</button></div>`:''}`;
  openModal('modal-camp');
}
async function cmpDelete(cid){
  const c=D.campaigns[cid];if(!c||!cmpCan())return;
  const n=Object.keys(c.links||{}).length;
  if(!confirm(`Delete campaign “${c.name}”?`+(n?`\n\n${n} checklist task(s) were generated from it. They will NOT be deleted — remove them in Task Management if needed.`:'')))return;
  await fbDel('campaigns/'+cid);closeModal('modal-camp');toast('Campaign deleted');
}

/* ════════════ ADD / EDIT FORM ════════════ */
function cmpBlankRow(prev,used){
  const free=cmpPlatforms().find(p=>!used.includes(p))||cmpPlatforms()[0];
  return {sid:'',platform:free,teasing:prev?prev.teasing:'',dday:prev?prev.dday:'',end:prev?prev.end:''};
}
function cmpOpenForm(cid){
  if(!cmpCan()){toast('Only admins and team leads can edit campaigns');return;}
  const c=cid?D.campaigns[cid]:null;
  if(c){
    const regs=[];
    cmpScheds(c).forEach(s=>{
      let r=regs.find(x=>x.region===s.region);if(!r){r={region:s.region,rows:[]};regs.push(r);}
      r.rows.push({sid:s.sid,platform:s.platform,teasing:s.teasing,dday:s.dday,end:s.end});
    });
    if(!regs.length)regs.push({region:CMP_REGIONS[0],rows:[cmpBlankRow(null,[])]});
    _cmpForm={id:cid,name:c.name||'',type:c.type||'other',month:c.month||cmpMonthKey(_cmp.month||now()),regions:regs};
  }else{
    _cmpForm={id:null,name:'',type:'mid-month',month:cmpMonthKey(_cmp.month||now()),regions:[{region:CMP_REGIONS[0],rows:[cmpBlankRow(null,[])]}]};
  }
  cmpFormRender();openModal('modal-camp');
}
function cmpFormCollect(){
  const g=id=>document.getElementById(id);if(!_cmpForm||!g('cf-name'))return;
  _cmpForm.name=g('cf-name').value;_cmpForm.type=g('cf-type').value;_cmpForm.month=g('cf-month').value;
  _cmpForm.regions.forEach((r,i)=>{
    r.region=g('cf-r'+i).value;
    r.rows.forEach((w,j)=>{w.platform=g(`cf-p${i}-${j}`).value;w.teasing=g(`cf-t${i}-${j}`).value;w.dday=g(`cf-d${i}-${j}`).value;w.end=g(`cf-e${i}-${j}`).value;});
  });
}
function cmpFormRender(){
  const f=_cmpForm,plats=cmpPlatforms();
  document.getElementById('mcp-title').textContent=f.id?'Edit Campaign':'Add Campaign';
  const opt=(arr,sel)=>arr.map(v=>`<option value="${cmpE(v)}"${v===sel?' selected':''}>${cmpE(v)}</option>`).join('');
  const blocks=f.regions.map((r,i)=>`
    <div class="cmp-reg-block">
      <div class="cmp-reg-hd"><div style="display:flex;align-items:center;gap:8px"><label class="flabel" style="margin:0">Region</label>
        <select class="finput nb" style="width:90px" id="cf-r${i}">${opt(CMP_REGIONS,r.region)}</select></div>
        <button class="btn sm" style="color:var(--red)" onclick="cmpFormDelRegion(${i})">Remove region</button></div>
      <div class="cmp-row-grid cmp-row-head"><span>Platform</span><span>Teasing date</span><span>D-Day</span><span>Campaign end</span><span></span></div>
      ${r.rows.map((w,j)=>`<div class="cmp-row-grid">
        <select class="finput nb" id="cf-p${i}-${j}">${opt(plats,w.platform)}</select>
        <input class="finput nb" type="date" id="cf-t${i}-${j}" value="${cmpE(w.teasing)}"/>
        <input class="finput nb" type="date" id="cf-d${i}-${j}" value="${cmpE(w.dday)}"/>
        <input class="finput nb" type="date" id="cf-e${i}-${j}" value="${cmpE(w.end)}"/>
        <button class="btn sm" title="Remove platform" onclick="cmpFormDelPlat(${i},${j})">&#x2715;</button></div>`).join('')}
      <button class="btn sm" onclick="cmpFormAddPlat(${i})">+ Add Platform</button>
    </div>`).join('');
  document.getElementById('mcp-body').innerHTML=`
    <div class="fg fg3">
      <div style="grid-column:span 1"><label class="flabel">Campaign Name</label><input class="finput nb" id="cf-name" value="${cmpE(f.name)}" placeholder="e.g. Mid-Month Sale"/></div>
      <div><label class="flabel">Campaign Type</label><select class="finput nb" id="cf-type">${Object.entries(CMP_TYPES).map(([k,v])=>`<option value="${k}"${f.type===k?' selected':''}>${v.l}</option>`).join('')}</select></div>
      <div><label class="flabel">Month</label><input class="finput nb" type="month" id="cf-month" value="${cmpE(f.month)}"/></div>
    </div>
    <div class="section-hdr sh-blue" style="margin:14px 0 8px">Regional Schedule</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px">Teasing runs from the teasing date up to the day before D-Day. Campaign End is also the Post-Campaign checklist date.</div>
    ${blocks}
    <button class="btn sm" onclick="cmpFormAddRegion()">+ Add Region</button>
    <div class="form-actions"><button class="btn primary" onclick="cmpFormSave()">${f.id?'Save Changes':'Save Campaign'}</button><button class="btn" onclick="${f.id?`cmpOpen('${f.id}')`:`closeModal('modal-camp')`}">Cancel</button></div>`;
}
function cmpFormAddRegion(){
  cmpFormCollect();const used=_cmpForm.regions.map(r=>r.region),next=CMP_REGIONS.find(r=>!used.includes(r));
  if(!next){toast('All 6 regions are already added');return;}
  _cmpForm.regions.push({region:next,rows:[cmpBlankRow(null,[])]});cmpFormRender();
}
function cmpFormDelRegion(i){
  cmpFormCollect();if(_cmpForm.regions.length<2){toast('At least one region is required');return;}
  _cmpForm.regions.splice(i,1);cmpFormRender();
}
function cmpFormAddPlat(i){
  cmpFormCollect();const r=_cmpForm.regions[i],used=r.rows.map(w=>w.platform);
  if(cmpPlatforms().every(p=>used.includes(p))){toast('All platforms are already added for '+r.region);return;}
  r.rows.push(cmpBlankRow(r.rows[r.rows.length-1],used));cmpFormRender();
}
function cmpFormDelPlat(i,j){
  cmpFormCollect();const r=_cmpForm.regions[i];if(r.rows.length<2){toast('Each region needs at least one platform — remove the region instead');return;}
  r.rows.splice(j,1);cmpFormRender();
}
async function cmpFormSave(){
  if(_cmpBusy)return;cmpFormCollect();const f=_cmpForm;
  const name=f.name.trim();if(!name){toast('Campaign name is required');return;}
  if(!f.month){toast('Month is required');return;}
  const schedules={},seenReg=new Set();let idx=0;
  for(const r of f.regions){
    if(seenReg.has(r.region)){toast(`Region ${r.region} is added twice — put its platforms in one region block`);return;}
    seenReg.add(r.region);const seenP=new Set();
    for(const w of r.rows){
      const tag=`${r.region} · ${w.platform}`;
      if(seenP.has(w.platform)){toast(`${tag}: platform listed twice`);return;}seenP.add(w.platform);
      if(!w.teasing||!w.dday||!w.end){toast(`${tag}: fill in Teasing, D-Day and Campaign End`);return;}
      if(w.teasing>w.dday){toast(`${tag}: Teasing date must be on or before D-Day`);return;}
      if(w.dday>w.end){toast(`${tag}: D-Day must be on or before Campaign End`);return;}
      schedules[w.sid||('s'+Date.now().toString(36)+(idx++))]={region:r.region,platform:w.platform,teasing:w.teasing,dday:w.dday,end:w.end};
    }
  }
  _cmpBusy=true;
  try{
    const old=f.id?D.campaigns[f.id]:null;
    const base={name,type:f.type,month:f.month,schedules,updatedAt:Date.now(),updatedBy:CU.name};
    let cid=f.id;
    if(cid)await fbUpd('campaigns/'+cid,base);
    else cid=await fbPush('campaigns',{...base,createdAt:Date.now(),createdBy:CU.name});
    closeModal('modal-camp');toast('Campaign saved');
    _cmp.month=new Date(+f.month.slice(0,4),+f.month.slice(5,7)-1,1);
    if(old&&old.links){
      const dr=cmpDrift({...old,schedules});
      if(dr.changes.length)await cmpPromptSync(cid,dr.changes);
    }
  }catch(e){console.error(e);toast('Could not save campaign — check connection');}
  finally{_cmpBusy=false;renderCampaigns();}
}

/* ════════════ LINKED CHECKLIST DATE SYNC (always asks first) ════════════ */
async function cmpPromptSync(cid,changes){
  const lines=changes.slice(0,12).map(x=>`• ${x.link.region} · ${x.link.platform} · ${CMP_KINDS[x.link.kind].s}: ${cmpFmt(x.link.date)} → ${cmpFmt(x.newDate)}`);
  if(changes.length>12)lines.push(`…and ${changes.length-12} more`);
  if(confirm('Campaign schedule changed. Update linked checklist deadlines?\n\n'+lines.join('\n')))await cmpApplyChanges(cid,changes);
  else toast('Linked checklists left unchanged — they’re flagged “Dates changed”');
}
async function cmpApplyChanges(cid,changes){
  const upd={};
  for(const x of changes){
    await fbUpd(cmpTaskPath(x.link),{startDate:x.newDate,endDate:x.newDate,deadline:cmpDeadlineLabel(x.newDate)});
    upd['links/'+x.key+'/date']=x.newDate;
  }
  await fbUpd('campaigns/'+cid,upd);
  toast(`${changes.length} checklist deadline(s) updated`);
}
async function cmpSync(cid){
  if(!cmpCan())return;const c=D.campaigns[cid];if(!c)return;
  const dr=cmpDrift(c);if(!dr.changes.length){toast('Everything is already in sync');return;}
  await cmpPromptSync(cid,dr.changes);cmpOpen(cid);
}

/* ════════════ GENERATE CAMPAIGN CHECKLISTS ════════════ */
function cmpGenOpen(cid){
  if(!cmpCan()){toast('Only admins and team leads can generate checklists');return;}
  const all=cmpCampaigns().filter(c=>cmpScheds(c).length);
  if(!all.length){toast('Add a campaign with a regional schedule first');return;}
  const inMonth=cmpMonthCampaigns().filter(x=>x.ss.length);
  _cmpGenCid=(cid&&D.campaigns[cid])?cid:(inMonth[0]?inMonth[0].c.id:all[0].id);
  _cmpGenSel={teasing:true,dday:true,post:true,scope:'all'};
  closeModal('modal-camp');cmpGenRender();openModal('modal-camp-gen');
}
function cmpGenPlan(c,links){
  let ss=cmpScheds(c);if(_cmpGenSel.scope==='filter')ss=ss.filter(cmpMatch);
  const todo=[];let skip=0,stale=0;
  ss.forEach(s=>CMP_KIND_ORDER.forEach(k=>{
    if(!_cmpGenSel[k])return;
    const key=cmpLinkKey(s.region,s.platform,k),link=(links||{})[key];
    if(link&&cmpTaskExists(link)){skip++;if(link.date!==s[CMP_KINDS[k].f])stale++;}
    else todo.push({s,kind:k,key,date:s[CMP_KINDS[k].f]});
  }));
  return {todo,skip,stale};
}
function cmpGenRender(){
  const all=cmpCampaigns().filter(c=>cmpScheds(c).length).sort((a,b)=>String(b.month).localeCompare(String(a.month))||String(a.name).localeCompare(String(b.name)));
  const c=D.campaigns[_cmpGenCid];if(!c){closeModal('modal-camp-gen');return;}
  const plan=cmpGenPlan(c,c.links),sel=_cmpGenSel;
  const cb=k=>`<label class="cmp-cb"><input type="checkbox" ${sel[k]?'checked':''} onchange="cmpGenToggle('${k}',this.checked)"/> ${CMP_KINDS[k].l}</label>`;
  document.getElementById('mcg-body').innerHTML=`
    <div class="fg"><div><label class="flabel">Campaign</label><select class="finput nb" onchange="cmpGenPick(this.value)">
      ${all.map(x=>`<option value="${x.id}"${x.id===_cmpGenCid?' selected':''}>${cmpE(x.name)}${x.month?' — '+cmpE(x.month):''}</option>`).join('')}</select></div></div>
    <div class="flabel" style="margin-top:6px">Create</div>
    <div class="cmp-cbs">${CMP_KIND_ORDER.map(cb).join('')}</div>
    ${cmpFilterActive()?`<div class="fg" style="margin-top:12px"><div><label class="flabel">Scope</label><select class="finput nb" onchange="cmpGenScope(this.value)">
      <option value="all"${sel.scope==='all'?' selected':''}>All regions &amp; platforms</option>
      <option value="filter"${sel.scope==='filter'?' selected':''}>Current filter only (${_cmp.region==='ALL'?'all regions':_cmp.region} · ${_cmp.platform==='ALL'?'all platforms':cmpE(_cmp.platform)})</option></select></div></div>`:''}
    <div class="cmp-gen-sum">
      <div><b>${plan.todo.length}</b> new checklist task${plan.todo.length===1?'':'s'} will be created</div>
      <div style="color:var(--text3)">${plan.skip} already generated — skipped, no duplicates</div>
      ${plan.stale?`<div style="color:var(--yellow)">${plan.stale} of those have outdated dates — use “Review &amp; update” in the campaign details.</div>`:''}
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:10px">Each task carries the campaign name, region, platform and its date (due 5:00 PM). They are created unassigned — assign owners in Task Management.</div>
    <div class="form-actions"><button class="btn primary" ${plan.todo.length&&!_cmpBusy?'':'disabled'} onclick="cmpGenRun()">${plan.todo.length?`Generate ${plan.todo.length} Checklist${plan.todo.length===1?'':'s'}`:'Nothing to generate'}</button><button class="btn" onclick="closeModal('modal-camp-gen')">Cancel</button></div>`;
}
function cmpGenPick(id){_cmpGenCid=id;cmpGenRender();}
function cmpGenToggle(k,v){_cmpGenSel[k]=v;cmpGenRender();}
function cmpGenScope(v){_cmpGenSel.scope=v;cmpGenRender();}
async function cmpGenRun(){
  if(_cmpBusy)return;
  if(!D._tLoaded){toast('Tasks are still loading — try again in a moment');return;}
  const cid=_cmpGenCid,c=D.campaigns[cid];if(!c)return;
  _cmpBusy=true;cmpGenRender();
  try{
    /* re-read links from Firebase right before writing so two people generating at once can't create duplicates */
    const fresh=await fbGet('campaigns/'+cid+'/links')||{};
    const plan=cmpGenPlan(c,fresh);
    if(!plan.todo.length){toast('Nothing new to generate');return;}
    const isAdm=!!CU.isAdmin,owner=isAdm?'admin':CU.username,ltKey='leadTaskNextId_'+CU.username;
    let nid=isAdm?((await fbGet('taskNextId'))||10):((await fbGet(ltKey))||1000);
    const linkUpd={};
    for(const t of plan.todo){
      const kd=CMP_KINDS[t.kind];
      const data={
        id:nid,title:`[${t.s.region}] ${t.s.platform} · ${c.name} — ${kd.s} Checklist`,
        freq:'other',dow:null,dayOfMonth:null,time:'5:00 PM',deadline:cmpDeadlineLabel(t.date),
        startDate:t.date,startTime:'',endDate:t.date,endTime:'17:00',dh:17,dm:0,
        note:`Auto-generated from campaign “${c.name}” · ${t.s.region} · ${t.s.platform} · ${kd.l}.`,
        assignees:[],aoLinked:false,frLinked:false,
        campaignId:cid,campaignKind:t.kind,campaignRegion:t.s.region,campaignPlatform:t.s.platform
      };
      await fbSet((isAdm?'tasks/':'leadTasks/'+CU.username+'/')+nid,data);
      if(isAdm){try{await logAct(nid,ds(now()),CU.name,'Task Added','TASK_ADDED');}catch(e){}}
      linkUpd['links/'+t.key]={taskId:nid,owner,kind:t.kind,region:t.s.region,platform:t.s.platform,date:t.date,createdAt:Date.now(),createdBy:CU.name};
      nid++;
    }
    await fbSet(isAdm?'taskNextId':ltKey,nid);
    await fbUpd('campaigns/'+cid,linkUpd);
    closeModal('modal-camp-gen');
    toast(`${plan.todo.length} checklist task(s) created`);
  }catch(e){console.error(e);toast('Could not generate checklists — check connection');}
  finally{_cmpBusy=false;if(document.getElementById('modal-camp-gen').classList.contains('open'))cmpGenRender();renderCampaigns();}
}
