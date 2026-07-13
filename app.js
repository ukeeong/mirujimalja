(function(){
'use strict';
const $ = (s)=>document.querySelector(s);
const DAY_START = 6; // 하루 시작: 아침 6시
const CATS = ['식비','쇼핑','구독','교통','기타'];
const IMPULSE_KINDS = ['게임','유튜브','쇼핑','간식','기타'];

// ----- 저장 -----
function save(k,v){ localStorage.setItem('mnj.'+k, JSON.stringify(v)); }
function load(k,d){ try{ const v = JSON.parse(localStorage.getItem('mnj.'+k)); return v ?? d; }catch{ return d; } }

let tasks = load('tasks', []);
let impulses = load('impulses', []);
let expenses = load('expenses', []);
let postponeLog = load('postponeLog', []);
let daylogs = load('daylogs', {}); // {dateKey:{unauthorized,freeday}}
let lastCheckin = load('lastCheckin', null);
let activeId = load('activeId', null);
let notified = {}; // {taskId:{t10,t0}}

// ----- 유틸 -----
function uid(){ return (crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(16)+Math.random().toString(16).slice(2); }
function pad(n){ return String(n).padStart(2,'0'); }
function fmtHMS(sec){ sec=Math.max(0,Math.floor(sec)); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad(h)}:${pad(m)}:${pad(s)}`; }
function fmtShort(sec){
  sec = Math.floor(Math.abs(sec));
  if(sec>=86400) return Math.floor(sec/86400)+'일';
  if(sec>=3600) return Math.floor(sec/3600)+'시간';
  return Math.max(1,Math.floor(sec/60))+'분';
}
function dayKey(t){
  const d = new Date((t??Date.now()) - DAY_START*3600*1000);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function todayKey(){ return dayKey(); }
function toLocalDT(date){ const d=new Date(date); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16); }
function tomorrowAt10(){ const d=new Date(); d.setDate(d.getDate()+1); d.setHours(10,0,0,0); return d; }
function won(n){ return n.toLocaleString('ko-KR')+'원'; }

// ----- 게이트 -----
function visibleTasks(){ return tasks.filter(t=>!t.dropped); }
function todayTasks(){ return visibleTasks().filter(t=>t.list==='today'); }
function gate(){
  if((daylogs[todayKey()]||{}).freeday) return { state:'freeday', label:'🏖 프리데이', cls:'dim' };
  const musts = todayTasks().filter(t=>t.must);
  const done = musts.filter(t=>t.done);
  if(musts.length===0) return { state:'none', label:'무조건 없음', cls:'dim' };
  if(done.length < musts.length) return { state:'locked', label:`🔒 게임 잠김 ${done.length}/${musts.length}`, cls:'' };
  return { state:'open', label:'🔓 오늘 게임 OK', cls:'ok' };
}
function renderGate(){
  const g = gate();
  const el = $('#gateBadge');
  el.textContent = g.label;
  el.className = 'pill '+g.cls;
  $('#streakBadge').textContent = '🔥 '+streak().now+'일';
}

// ----- 스트릭 / 기록 -----
function dayStatus(key){
  const log = daylogs[key]||{};
  if(log.unauthorized) return 'r';
  if(log.freeday) return 'f';
  const dones = tasks.filter(t=>t.done && t.doneAt && dayKey(t.doneAt)===key);
  if(dones.some(t=>t.must)) return 'g';
  if(dones.length>0) return 'y';
  return 'e';
}
function streak(){
  let now=0, best=0, cur=0;
  const oneDay=86400000;
  for(let i=0;i<365;i++){
    const st = dayStatus(dayKey(Date.now()-i*oneDay));
    if(st==='f') continue; // 프리데이는 스트릭을 깨지 않음
    if(i===0 && st!=='g') continue; // 오늘은 아직 진행 중일 수 있으니 어제부터 이어짐
    if(st==='g') now++; else break;
  }
  for(let i=364;i>=0;i--){
    const st = dayStatus(dayKey(Date.now()-i*oneDay));
    if(st==='f') continue;
    if(st==='g'){ cur++; best=Math.max(best,cur); } else cur=0;
  }
  return { now, best };
}

// ----- 알림 -----
function playMelody(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
    const ctx = new AC();
    let t = ctx.currentTime;
    [[880,.14],[987.77,.14],[1174.66,.18],[987.77,.16],[1046.5,.2]].forEach(([f,d])=>{
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type='square'; o.frequency.value=f;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.2,t+.04); g.gain.linearRampToValueAtTime(0,t+d);
      o.start(t); o.stop(t+d+.05); t+=d;
    });
    setTimeout(()=>ctx.close(),1200);
  }catch(e){}
}
function notify(title, body){
  try{
    if(!('Notification' in window)) return;
    if(Notification.permission==='granted') new Notification(title,{body});
    else if(Notification.permission==='default') Notification.requestPermission().then(p=>{ if(p==='granted') new Notification(title,{body}); });
  }catch(e){}
}

// ----- 할 일 목록 렌더 -----
function remainPill(t){
  const span = document.createElement('span');
  if(t.done){ span.className='pill ok'; span.textContent='완료'; return span; }
  if(!t.deadline){ span.className='pill dim'; span.textContent='마감 없음'; return span; }
  span.className='pill remain'; span.dataset.dl = t.deadline;
  updateRemainPill(span);
  return span;
}
function updateRemainPill(span){
  const diff = (new Date(span.dataset.dl) - Date.now())/1000;
  if(diff>=0){
    span.textContent = fmtShort(diff)+' 남음';
    span.className = 'pill remain '+(diff>=10800?'ok':diff>3600?'warn':'bad');
  } else {
    span.textContent = fmtShort(diff)+' 초과';
    span.className = 'pill remain bad';
  }
}
function buildRow(t, ctx){
  const row = document.createElement('div');
  row.className = 'item'+(t.done?' done':'')+(t.id===activeId?' active':'');

  const chk = document.createElement('button');
  chk.className='chk'; chk.textContent='✓'; chk.title='완료 토글';
  chk.addEventListener('click',(e)=>{ e.stopPropagation(); toggleDone(t.id); });
  row.appendChild(chk);

  const body = document.createElement('div'); body.className='body';
  const title = document.createElement('div'); title.className='title'; title.textContent=t.title;
  const meta = document.createElement('div'); meta.className='meta';
  const parts=[];
  if(t.deadline) parts.push('마감 '+new Date(t.deadline).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}));
  meta.textContent = parts.join(' · ');
  if(t.postponed>0){ const pp=document.createElement('span'); pp.className='pp'; pp.textContent=(parts.length?' · ':'')+t.postponed+'회 미룸'; meta.appendChild(pp); }
  body.appendChild(title); body.appendChild(meta);
  row.appendChild(body);
  row.appendChild(remainPill(t));

  const actions = document.createElement('div'); actions.className='actions';
  const flag = document.createElement('button');
  flag.className='mini flag'+(t.must?' on':''); flag.textContent='🚩'; flag.title='오늘 무조건';
  flag.addEventListener('click',(e)=>{ e.stopPropagation(); toggleMust(t.id); });
  actions.appendChild(flag);
  if(ctx==='today' && !t.done){
    const pb = document.createElement('button'); pb.className='mini'; pb.textContent='내일로';
    pb.addEventListener('click',(e)=>{ e.stopPropagation(); postpone(t.id); });
    actions.appendChild(pb);
  }
  if(ctx==='inbox'){
    const tb = document.createElement('button'); tb.className='mini'; tb.textContent='오늘로';
    tb.addEventListener('click',(e)=>{ e.stopPropagation(); moveToToday(t.id); });
    actions.appendChild(tb);
  }
  const del = document.createElement('button'); del.className='mini'; del.textContent='✕'; del.title='포기(삭제)';
  del.addEventListener('click',(e)=>{ e.stopPropagation(); dropTask(t.id); });
  actions.appendChild(del);
  row.appendChild(actions);

  row.addEventListener('click',()=>{ activeId = t.id; save('activeId',activeId); notified[t.id]=null; renderAll(); });
  return row;
}
function sortTasks(arr){
  return arr.slice().sort((a,b)=>{
    if(a.done!==b.done) return a.done?1:-1;
    if(!!a.deadline!==!!b.deadline) return a.deadline?-1:1;
    if(a.deadline&&b.deadline) return new Date(a.deadline)-new Date(b.deadline);
    return (a.createdAt||0)-(b.createdAt||0);
  });
}
function renderToday(){
  const musts = sortTasks(todayTasks().filter(t=>t.must));
  const rest = sortTasks(todayTasks().filter(t=>!t.must));
  const ml = $('#mustList'), tl = $('#todayList');
  ml.innerHTML=''; tl.innerHTML='';
  musts.forEach(t=>ml.appendChild(buildRow(t,'today')));
  rest.forEach(t=>tl.appendChild(buildRow(t,'today')));
  renderNow();
}
function renderInbox(){
  const inbox = visibleTasks().filter(t=>t.list==='inbox');
  const soon = sortTasks(inbox.filter(t=>t.deadline && (new Date(t.deadline)-Date.now()) < 3*86400000));
  const rest = sortTasks(inbox.filter(t=>!soon.includes(t)));
  const il = $('#imminentList'), rl = $('#inboxList');
  il.innerHTML=''; rl.innerHTML='';
  soon.forEach(t=>il.appendChild(buildRow(t,'inbox')));
  rest.forEach(t=>rl.appendChild(buildRow(t,'inbox')));
}
function renderNow(){
  const t = tasks.find(x=>x.id===activeId && !x.dropped);
  const titleEl=$('#nowTitle'), bigEl=$('#nowBig'), stEl=$('#nowStatus'), doneBtn=$('#nowDone');
  if(!t){ titleEl.textContent='선택된 일 없음'; bigEl.textContent='--:--:--'; bigEl.className='now-big'; stEl.textContent=''; doneBtn.hidden=true; return; }
  titleEl.textContent = t.title;
  doneBtn.hidden = false;
  doneBtn.textContent = t.done ? '완료됨 ✓' : '완료';
  if(t.done){ bigEl.textContent='완료'; bigEl.className='now-big'; bigEl.style.color='var(--ok)'; stEl.textContent=''; return; }
  bigEl.style.color='';
  if(!t.deadline){ bigEl.textContent='--:--:--'; bigEl.className='now-big'; stEl.textContent='마감 없음'; return; }
  const diff = Math.floor((new Date(t.deadline)-Date.now())/1000);
  if(diff>=0){
    bigEl.textContent = fmtHMS(diff); bigEl.className='now-big';
    const cls = diff>=10800?'ok':diff>3600?'warn':'bad';
    stEl.innerHTML = `<span class="pill ${cls}">${diff>=10800?'여유':diff>3600?'주의':'위험'}</span> 마감 ${new Date(t.deadline).toLocaleString('ko-KR')}`;
    const n = notified[t.id] || (notified[t.id]={t10:false,t0:false});
    if(diff<=600 && !n.t10){ n.t10=true; playMelody(); notify('10분 전이에요!', t.title); }
  } else {
    bigEl.textContent = '+'+fmtHMS(-diff); bigEl.className='now-big over';
    stEl.innerHTML = `<span class="pill bad">마감 지남</span> +${fmtShort(diff)} 초과`;
    const n = notified[t.id] || (notified[t.id]={t10:false,t0:false});
    if(!n.t0){ n.t0=true; playMelody(); notify('마감 시간을 넘겼어요.', t.title); }
  }
}

// ----- 할 일 조작 -----
function addTask(title, deadline, must, list){
  if(!title.trim()){ alert('제목을 입력해주세요.'); return false; }
  const t = { id:uid(), title:title.trim(), deadline: deadline||null, must:!!must, done:false, doneAt:null,
              list, postponed:0, dropped:false, createdAt:Date.now() };
  tasks.push(t); save('tasks',tasks);
  if(list==='today' && !activeId){ activeId=t.id; save('activeId',activeId); }
  renderAll();
  return true;
}
function toggleDone(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save('tasks',tasks);
  const g = gate();
  renderAll();
  if(t.done && g.state==='open'){ playMelody(); }
}
function toggleMust(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  if(t.must){ alert('무조건은 끌 수 없어요. 아침의 나와 한 약속!\n정 안 되겠으면 ✕(포기)로.'); return; }
  t.must = true;
  if(t.list!=='today') t.list='today';
  save('tasks',tasks); renderAll();
}
function postpone(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  if(t.must && !confirm('무조건으로 걸어둔 일이야. 미루면 오늘 게이트는 잠긴 채 끝나. 그래도 미룰까?')) return;
  if(t.postponed>=2 && !confirm(`벌써 ${t.postponed+1}회째 미루는 중. 진짜 할 일 맞아?\n(쪼개거나 버리는 것도 방법)`)) return;
  t.postponed++; t.list='inbox'; t.must=false;
  postponeLog.push(Date.now());
  save('tasks',tasks); save('postponeLog',postponeLog);
  if(activeId===id){ activeId=null; save('activeId',activeId); }
  renderAll();
}
function moveToToday(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  t.list='today'; save('tasks',tasks); renderAll();
}
function dropTask(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  if(!confirm(`"${t.title}" 버릴까? (기록만 남아)`)) return;
  t.dropped = true; save('tasks',tasks);
  if(activeId===id){ activeId=null; save('activeId',activeId); }
  renderAll();
}

// ----- 아침 체크인 -----
const ci = { triage:{}, musts:new Set() };
function yesterdayKey(){ return dayKey(Date.now()-86400000); }
function todayStartTs(){
  const d = new Date(Date.now()-DAY_START*3600000);
  d.setHours(0,0,0,0);
  return d.getTime()+DAY_START*3600000;
}
function leftoverTasks(){ return tasks.filter(t=>!t.dropped && t.list==='today' && !t.done); }
function freedaysUsedThisMonth(){
  const prefix = todayKey().slice(0,7);
  return Object.keys(daylogs).filter(k=>k.startsWith(prefix) && daylogs[k].freeday).length;
}
function ciMaybeOpen(){
  const tk = todayKey();
  if(!lastCheckin){ lastCheckin=tk; save('lastCheckin',tk); return; } // 첫 사용은 체크인 생략
  if(lastCheckin===tk) return;
  if(!$('#checkinModal').hidden) return;
  ciOpen();
}
function ciOpen(){
  ci.triage={}; ci.musts=new Set();
  $('#ciDate').textContent = new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
  $('#checkinModal').hidden=false;
  const yk = yesterdayKey();
  const needQ1 = !(daylogs[yk]||{}).freeday && dayStatus(yk)!=='g';
  ciShow(needQ1 ? 'q1' : (leftoverTasks().length ? 'q2' : 'q3'));
}
function ciShow(step){
  $('#ciQ1').hidden = step!=='q1';
  $('#ciQ2').hidden = step!=='q2';
  $('#ciQ3').hidden = step!=='q3';
  if(step==='q2') ciBuildTriage();
  if(step==='q3') ciBuildQ3();
}
function ciBuildTriage(){
  const box = $('#ciTriage'); box.innerHTML='';
  leftoverTasks().forEach(t=>{
    ci.triage[t.id] = ci.triage[t.id] || '나중에';
    const row = document.createElement('div'); row.className='item';
    const body = document.createElement('div'); body.className='body';
    const title = document.createElement('div'); title.className='title'; title.textContent=t.title;
    const meta = document.createElement('div'); meta.className='meta';
    const bits=[];
    if(t.postponed>0) bits.push(t.postponed+'회 미룸');
    if(t.deadline && new Date(t.deadline)<Date.now()) bits.push(fmtShort((new Date(t.deadline)-Date.now())/1000)+' 초과');
    meta.textContent = bits.join(' · ');
    body.appendChild(title); body.appendChild(meta);
    row.appendChild(body);
    const seg = document.createElement('div'); seg.className='seg';
    ['오늘 또','나중에','버리기'].forEach(choice=>{
      const b = document.createElement('button');
      b.type='button'; b.className='mini'+(ci.triage[t.id]===choice?' on':''); b.textContent=choice;
      b.addEventListener('click',()=>{
        if(choice==='오늘 또' && t.postponed>=3 && ci.triage[t.id]!=='오늘 또'){
          if(!confirm(`벌써 ${t.postponed}회 미룬 일이야. 진짜 할 일 맞아?\n(쪼개거나 버리는 것도 방법)`)) return;
        }
        ci.triage[t.id]=choice;
        seg.querySelectorAll('.mini').forEach(x=>x.classList.toggle('on',x.textContent===choice));
      });
      seg.appendChild(b);
    });
    row.appendChild(seg);
    box.appendChild(row);
  });
}
function ciApplyTriage(){
  Object.entries(ci.triage).forEach(([id,choice])=>{
    const t = tasks.find(x=>x.id===id); if(!t) return;
    if(choice==='오늘 또'){ t.postponed++; t.must=false; }
    else if(choice==='나중에'){ t.list='inbox'; t.must=false; }
    else if(choice==='버리기'){ t.dropped=true; if(activeId===id){activeId=null;save('activeId',activeId);} }
  });
  // 어제 완료한 일은 보드에서 정리 (기록엔 남음)
  const start = todayStartTs();
  tasks.forEach(t=>{ if(t.list==='today' && t.done && t.doneAt && t.doneAt<start) t.list='archive'; });
  save('tasks',tasks);
}
function ciBuildQ3(){
  const box = $('#ciCandidates'); box.innerHTML='';
  const cands = tasks.filter(t=>!t.dropped && !t.done && (
    t.list==='today' || (t.list==='inbox' && t.deadline && (new Date(t.deadline)-Date.now()) < 2*86400000)
  ));
  if(cands.length===0){
    const p = document.createElement('p'); p.className='subline'; p.textContent='후보가 없어. 보드에서 새로 추가해도 돼';
    box.appendChild(p);
  }
  cands.forEach(t=>{
    const row = document.createElement('div'); row.className='item';
    const body = document.createElement('div'); body.className='body';
    const title = document.createElement('div'); title.className='title'; title.textContent=t.title;
    const meta = document.createElement('div'); meta.className='meta';
    meta.textContent = t.deadline ? '마감 '+new Date(t.deadline).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : (t.list==='inbox'?'인박스':'');
    body.appendChild(title); body.appendChild(meta);
    row.appendChild(body);
    const b = document.createElement('button');
    b.type='button'; b.className='mini'+(ci.musts.has(t.id)?' on':''); b.textContent='🚩 무조건';
    b.addEventListener('click',()=>{
      if(ci.musts.has(t.id)) ci.musts.delete(t.id); else ci.musts.add(t.id);
      b.classList.toggle('on',ci.musts.has(t.id));
      $('#ciMustCount').textContent = ci.musts.size+'개';
    });
    row.appendChild(b);
    box.appendChild(row);
  });
  $('#ciMustCount').textContent = ci.musts.size+'개';
  // 프리데이: 정오 전 + 월 4회 한도
  const used = freedaysUsedThisMonth();
  const beforeNoon = new Date().getHours() < 12;
  const row = $('#ciFreedayRow');
  row.hidden = !beforeNoon || used>=4;
  $('#ciFreedayInfo').textContent = `이번 달 ${used}/4 사용`;
  $('#ciFreeday').checked = false;
}
$('#ciQ1Yes').addEventListener('click',()=>{
  const yk = yesterdayKey();
  daylogs[yk] = Object.assign(daylogs[yk]||{}, {unauthorized:true});
  save('daylogs',daylogs);
  ciShow(leftoverTasks().length ? 'q2' : 'q3');
});
$('#ciQ1No').addEventListener('click',()=>{ ciShow(leftoverTasks().length ? 'q2' : 'q3'); });
$('#ciQ2Next').addEventListener('click',()=>{ ciApplyTriage(); ciShow('q3'); });
$('#ciFinish').addEventListener('click',()=>{
  const start = todayStartTs();
  tasks.forEach(t=>{ if(t.list==='today' && t.done && t.doneAt && t.doneAt<start) t.list='archive'; });
  ci.musts.forEach(id=>{
    const t = tasks.find(x=>x.id===id); if(!t) return;
    t.must=true; t.list='today';
  });
  const tk = todayKey();
  if($('#ciFreeday').checked && !$('#ciFreedayRow').hidden){
    daylogs[tk] = Object.assign(daylogs[tk]||{}, {freeday:true});
    save('daylogs',daylogs);
  }
  lastCheckin = tk; save('lastCheckin',lastCheckin);
  save('tasks',tasks);
  $('#checkinModal').hidden=true;
  renderAll();
});

// ----- 충동 -----
let impKind = null, impTimer = null, impRemain = 0;
function impShow(step){
  $('#impPick').hidden = step!=='pick';
  $('#impRun').hidden = step!=='run';
  $('#impResult').hidden = step!=='result';
}
function impOpen(){
  $('#impulseModal').hidden = false;
  impKind = null;
  document.querySelectorAll('#impKinds .btn').forEach(b=>b.classList.remove('sel'));
  impShow('pick');
}
function impCloseAll(){
  if(impTimer){ clearInterval(impTimer); impTimer=null; }
  $('#impulseModal').hidden = true;
}
function impStart(){
  if(!impKind){ alert('종류를 골라줘!'); return; }
  impRemain = 600;
  $('#impRunLabel').textContent = impKind+' 충동 지나가는 중';
  impShow('run');
  drawImp();
  impTimer = setInterval(()=>{
    impRemain--;
    drawImp();
    if(impRemain<=0){ clearInterval(impTimer); impTimer=null; playMelody(); notify('10분 지났어!','아직도 하고 싶어?'); impShow('result'); }
  },1000);
}
function drawImp(){ $('#impBig').textContent = pad(Math.floor(impRemain/60))+':'+pad(impRemain%60); }
function impRecord(result){
  const rec = { id:uid(), at:Date.now(), kind:impKind, result };
  if(result==='passed' && impKind==='쇼핑'){
    const v = prompt('얼마짜리 참았어? (원 단위, 모르면 비워도 돼)');
    const amt = parseInt(v,10);
    if(amt>0) rec.amount = amt;
  }
  impulses.push(rec); save('impulses',impulses);
  impCloseAll(); renderAll();
}

// ----- 가계부 -----
let exCat = CATS[0];
function renderBudget(){
  const now = new Date();
  const month = expenses.filter(e=>{ const d=new Date(e.at); return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth(); });
  $('#monthTotal').textContent = won(month.reduce((s,e)=>s+e.amount,0));
  $('#savedTotal').textContent = won(impulses.filter(i=>i.result==='passed'&&i.amount).reduce((s,i)=>s+i.amount,0));
  const cl = $('#catList'); cl.innerHTML='';
  CATS.forEach(c=>{
    const sum = month.filter(e=>e.cat===c).reduce((s,e)=>s+e.amount,0);
    if(!sum) return;
    const row = document.createElement('div'); row.className='item';
    row.innerHTML = `<div class="body"><div class="title">${c}</div></div><span class="pill dim">${won(sum)}</span>`;
    cl.appendChild(row);
  });
  const el = $('#exList'); el.innerHTML='';
  expenses.slice(-5).reverse().forEach(e=>{
    const row = document.createElement('div'); row.className='item';
    const d = new Date(e.at);
    row.innerHTML = `<div class="body"><div class="title">${e.memo||e.cat}</div><div class="meta">${d.getMonth()+1}/${d.getDate()} · ${e.cat}</div></div><span class="pill dim">${won(e.amount)}</span>`;
    el.appendChild(row);
  });
}
function renderCatButtons(){
  const box = $('#exCats'); box.innerHTML='';
  CATS.forEach(c=>{
    const b = document.createElement('button');
    b.type='button'; b.className='btn sm'+(c===exCat?' sel':''); b.textContent=c;
    b.addEventListener('click',()=>{ exCat=c; renderCatButtons(); });
    box.appendChild(b);
  });
}

// ----- 기록 -----
function renderRecords(){
  const s = streak();
  $('#streakNow').textContent = s.now+'일';
  $('#streakBest').textContent = s.best+'일';
  const hm = $('#heatmap'); hm.innerHTML='';
  const tk = todayKey();
  for(let i=27;i>=0;i--){
    const key = dayKey(Date.now()-i*86400000);
    const cell = document.createElement('div');
    const st = dayStatus(key);
    cell.className = 'hm-cell'+(st!=='e'?' '+st:'')+(key===tk?' today':'');
    cell.title = key;
    hm.appendChild(cell);
  }
  const wk = Date.now()-7*86400000;
  $('#wkDone').textContent = tasks.filter(t=>t.done&&t.doneAt>wk).length;
  $('#wkImpulse').textContent = impulses.filter(i=>i.at>wk&&i.result==='passed').length;
  $('#wkPostpone').textContent = postponeLog.filter(ts=>ts>wk).length;
}

// ----- 내보내기 / 불러오기 -----
$('#exportBtn').addEventListener('click',()=>{
  const blob = new Blob([JSON.stringify({tasks,impulses,expenses,postponeLog,activeId},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='mirujimalja_backup.json'; a.click();
  URL.revokeObjectURL(url);
});
$('#importBtn').addEventListener('click',()=>$('#importFile').click());
$('#importFile').addEventListener('change',async(e)=>{
  const f = e.target.files[0]; if(!f) return;
  try{
    const data = JSON.parse(await f.text());
    if(!Array.isArray(data.tasks)) throw new Error('형식 오류');
    tasks=data.tasks; impulses=data.impulses||[]; expenses=data.expenses||[]; postponeLog=data.postponeLog||[]; activeId=data.activeId??null;
    save('tasks',tasks); save('impulses',impulses); save('expenses',expenses); save('postponeLog',postponeLog); save('activeId',activeId);
    renderAll(); alert('불러오기 완료!');
  }catch(err){ alert('불러오기 실패: '+err.message); }
  finally{ e.target.value=''; }
});

// ----- 탭 -----
let curView = 'today';
document.querySelectorAll('.tab').forEach(b=>{
  b.addEventListener('click',()=>{
    curView = b.dataset.view;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));
    document.querySelectorAll('.view').forEach(v=>v.hidden = v.id!=='view-'+curView);
    renderAll();
  });
});

// ----- 입력 이벤트 -----
$('#taTomorrow').addEventListener('click',()=>{ $('#taDeadline').value = toLocalDT(tomorrowAt10()); });
$('#ibTomorrow').addEventListener('click',()=>{ $('#ibDeadline').value = toLocalDT(tomorrowAt10()); });
$('#taAdd').addEventListener('click',()=>{
  const dl = $('#taDeadline').value ? new Date($('#taDeadline').value).toISOString() : null;
  if(addTask($('#taTitle').value, dl, $('#taMust').checked, 'today')){
    $('#taTitle').value=''; $('#taMust').checked=false;
  }
});
$('#ibAdd').addEventListener('click',()=>{
  const dl = $('#ibDeadline').value ? new Date($('#ibDeadline').value).toISOString() : null;
  if(addTask($('#ibTitle').value, dl, false, 'inbox')){ $('#ibTitle').value=''; }
});
$('#taTitle').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#taAdd').click(); });
$('#ibTitle').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#ibAdd').click(); });
$('#nowDone').addEventListener('click',()=>{ if(activeId) toggleDone(activeId); });

// 충동 모달
$('#impulseBtn').addEventListener('click',impOpen);
$('#impClose').addEventListener('click',()=>{
  if(impTimer && !confirm('타이머 도는 중인데 닫을까? (기록 안 남아)')) return;
  impCloseAll();
});
(function(){
  const box = $('#impKinds');
  IMPULSE_KINDS.forEach(k=>{
    const b = document.createElement('button');
    b.type='button'; b.className='btn sm'; b.textContent=k;
    b.addEventListener('click',()=>{
      impKind=k;
      box.querySelectorAll('.btn').forEach(x=>x.classList.toggle('sel',x===b));
    });
    box.appendChild(b);
  });
})();
$('#impStart').addEventListener('click',impStart);
$('#impGiveup').addEventListener('click',()=>{ if(impTimer){clearInterval(impTimer);impTimer=null;} impRecord('did'); });
$('#impPassed').addEventListener('click',()=>impRecord('passed'));
$('#impDid').addEventListener('click',()=>impRecord('did'));

// ----- 렌더 루프 -----
function renderAll(){
  renderGate();
  if(curView==='today') renderToday();
  else if(curView==='inbox') renderInbox();
  else if(curView==='budget') renderBudget();
  else if(curView==='records') renderRecords();
}
setInterval(()=>{
  ciMaybeOpen(); // 앱 켜둔 채 날이 바뀌어도 체크인이 뜨게
  if(curView==='today'){
    renderNow();
    document.querySelectorAll('.remain').forEach(updateRemainPill);
  }
},1000);

renderCatButtons();
$('#exAdd').addEventListener('click',()=>{
  const amt = parseInt($('#exAmount').value,10);
  if(!(amt>0)){ alert('금액을 입력해주세요.'); return; }
  expenses.push({ id:uid(), at:Date.now(), amount:amt, cat:exCat, memo:$('#exMemo').value.trim() });
  save('expenses',expenses);
  $('#exAmount').value=''; $('#exMemo').value='';
  renderBudget();
});

// PWA
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }

renderAll();
ciMaybeOpen();
})();
