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
let savings = load('savings', []); // 직접 기록한 참은돈 [{id,at,amount,memo}]
let postponeLog = load('postponeLog', []);
let daylogs = load('daylogs', {}); // {dateKey:{unauthorized,freeday}}
let routines = load('routines', []); // [{id,name,type,days,perWeek,paused,reward,createdAt}]
let rlogs = load('rlogs', []); // [{rid,day}]
let gateTarget = load('gateTarget', { emoji:'🎮', name:'게임' }); // 게이트가 잠그는 대상
let lastCheckin = load('lastCheckin', null);
let activeId = load('activeId', null);
let notified = {}; // {taskId:{t10,t0}}

// ----- 유틸 -----
function uid(){ return (crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(16)+Math.random().toString(16).slice(2); }
function pad(n){ return String(n).padStart(2,'0'); }
function fmtHMS(sec){ sec=Math.max(0,Math.floor(sec)); const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60; return `${pad(h)}:${pad(m)}:${pad(s)}`; }
function fmtShort(sec){
  sec = Math.floor(Math.abs(sec));
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60);
  if(d>0) return `${d}일`;
  return `${h}:${pad(m)}`; // 예: 2:19, 0:44
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
function dayFailed(key){
  return postponesOn(key)>=2 || !!(daylogs[key]||{}).mustPostponed;
}
function gate(){
  const tk = todayKey();
  if((daylogs[tk]||{}).freeday) return { state:'freeday', label:'🏖 프리데이', cls:'dim' };
  if(dayFailed(tk)) return { state:'failed', label:`🚫 오늘 ${gateTarget.name} 불가`, cls:'bad' };
  const musts = todayTasks().filter(t=>t.must);
  const done = musts.filter(t=>t.done);
  if(musts.length===0) return { state:'none', label:'무조건 없음', cls:'dim' };
  if(done.length < musts.length) return { state:'locked', label:`🔒 ${gateTarget.name} 잠김 ${done.length}/${musts.length}`, cls:'' };
  return { state:'open', label:`🔓 오늘 ${gateTarget.name} OK`, cls:'ok' };
}
function renderGate(){
  const g = gate();
  // 오늘의 게이트 결과를 기록 (히트맵·스트릭은 이 스냅샷을 봄 — 무조건 전부 완료해야 성공)
  const tk = todayKey();
  const log = daylogs[tk] || (daylogs[tk] = {});
  if(log.gate !== g.state){ log.gate = g.state; save('daylogs', daylogs); }
  $('#streakBadge').textContent = '🔥 '+streak().now+'일';
  // 큰 게이트 배너 (오늘 보드 최상단)
  const musts = todayTasks().filter(t=>t.must);
  const done = musts.filter(t=>t.done).length;
  const banner = $('#gateBanner');
  const icon = $('#gbIcon'), label = $('#gbLabel'), sub = $('#gbSub'), barWrap = $('#gbBarWrap'), bar = $('#gbBar');
  $('#mustHint').textContent = `(다 끝내면 ${gateTarget.emoji} ${gateTarget.name} 해금)`;
  if(g.state==='freeday'){
    banner.className='gatebanner none';
    icon.textContent='🏖'; label.textContent='프리데이';
    sub.textContent='오늘은 게이트 없음. 편하게 쉬어';
    barWrap.hidden=true;
  } else if(g.state==='failed'){
    banner.className='gatebanner locked';
    icon.textContent='🚫'; label.textContent=`오늘 ${gateTarget.name} 불가`;
    sub.textContent='미루기로 오늘은 실패 처리됐어. 남은 일을 해도 안 열려 — 내일 다시!';
    barWrap.hidden=true;
  } else if(g.state==='none'){
    banner.className='gatebanner none';
    icon.textContent=gateTarget.emoji; label.textContent='무조건 없는 날 — 게이트 꺼짐';
    sub.textContent=`잠그고 싶으면 할 일에 🚩 무조건을 걸어봐 · 여길 탭하면 잠글 대상(${gateTarget.name}) 변경`;
    barWrap.hidden=true;
  } else if(g.state==='locked'){
    banner.className='gatebanner locked';
    icon.textContent='🔒'; label.textContent=`${gateTarget.emoji} ${gateTarget.name} 잠김`;
    sub.textContent=`무조건 ${musts.length-done}개 남음 — 다 끝내면 해금 (${done}/${musts.length})`;
    barWrap.hidden=false;
    bar.style.width = Math.round(done/musts.length*100)+'%';
  } else {
    banner.className='gatebanner open';
    icon.textContent='🔓'; label.textContent=`오늘 ${gateTarget.name} OK`;
    sub.textContent=`무조건 ${musts.length}개 전부 완료! ${gateTarget.emoji} 죄책감 없이 즐겨`;
    barWrap.hidden=false;
    bar.style.width='100%';
  }
}
// 게이트 대상 설정 모달
const GT_EMOJIS = ['🎮','📺','📱','🍺','🛒','🍰','😴','🚬','☕','💬','🎰','🌐'];
let gtSel = gateTarget.emoji;
(function(){
  const box = $('#gtEmojis');
  GT_EMOJIS.forEach(e=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini gt-emoji'+(e===gtSel?' on':''); b.textContent=e;
    b.addEventListener('click',()=>{
      gtSel=e;
      box.querySelectorAll('.mini').forEach(x=>x.classList.toggle('on',x.textContent===e));
    });
    box.appendChild(b);
  });
})();
function openGateModal(){
  gtSel = gateTarget.emoji;
  document.querySelectorAll('#gtEmojis .mini').forEach(x=>x.classList.toggle('on',x.textContent===gtSel));
  $('#gtName').value = gateTarget.name;
  $('#gateModal').hidden = false;
}
$('#gateBanner').addEventListener('click',openGateModal);
$('#gateBadge').addEventListener('click',openGateModal);
$('#gtSave').addEventListener('click',()=>{
  const name = $('#gtName').value.trim();
  if(!name){ alert('행동 이름을 입력해줘!'); return; }
  gateTarget = { emoji: gtSel, name };
  save('gateTarget', gateTarget);
  $('#gateModal').hidden = true;
  renderAll();
});
$('#gtClose').addEventListener('click',()=>{
  // 설정 없이 닫아도 기본값(게임)을 저장해서 매번 다시 묻지 않음
  if(localStorage.getItem('mnj.gateTarget')===null) save('gateTarget', gateTarget);
  $('#gateModal').hidden = true;
});

// ----- 스트릭 / 기록 -----
function postponesOn(key){ return postponeLog.filter(ts=>dayKey(ts)===key).length; }
function dayStatus(key){
  const log = daylogs[key]||{};
  if(log.unauthorized) return 'p'; // 무단 잠금행동 (보라)
  if(dayFailed(key)) return 'r'; // 2회 이상 미룸 or 무조건 미룸 = 일정 실패 (빨강)
  if(log.freeday) return 'f';
  const dones = tasks.filter(t=>t.done && t.doneAt && dayKey(t.doneAt)===key);
  if(log.gate){
    // 게이트 스냅샷 기준: 무조건을 '전부' 끝낸 날만 성공
    if(log.gate==='open') return 'g';
    return dones.length>0 ? 'y' : 'e';
  }
  // 스냅샷 없는 과거 데이터용 (구버전 호환)
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
  row.className = 'item'+(t.done?' done':'')+(t.id===activeId?' active':'')+(t.must&&!t.done?' must':'');

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
  const pill = remainPill(t);
  if(!t.done){
    pill.style.cursor='pointer'; pill.title='탭해서 마감 수정';
    pill.addEventListener('click',(e)=>{ e.stopPropagation(); openEdit(t.id); });
  }
  row.appendChild(pill);

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

  if(ctx==='inbox'){
    row.addEventListener('click',()=>openEdit(t.id)); // 인박스에서는 탭하면 바로 수정
  } else {
    row.addEventListener('click',()=>{ activeId = t.id; save('activeId',activeId); notified[t.id]=null; renderAll(); });
  }
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
  const titleEl=$('#nowTitle'), bigEl=$('#nowBig'), stEl=$('#nowStatus'), doneBtn=$('#nowDone'), tools=$('#nowTools');
  if(!t){ titleEl.textContent='선택된 일 없음'; bigEl.textContent='--:--:--'; bigEl.className='now-big'; stEl.textContent=''; tools.hidden=true; return; }
  titleEl.textContent = t.title;
  tools.hidden = false;
  doneBtn.textContent = t.done ? '완료됨 ✓' : '완료';
  $('#nowPlus1').hidden = t.done;
  $('#nowPlus3').hidden = t.done;
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
  const tk = todayKey();
  if(t.must && !confirm(`무조건으로 걸어둔 일이야. 미루면 오늘은 실패가 되고 ${gateTarget.name}도 잠긴 채 끝나. 그래도 미룰까?`)) return;
  if(!t.must && postponesOn(tk)===1 && !dayFailed(tk) && !confirm(`오늘 두 번째 미루기야. 미루면 오늘은 일정 실패로 기록되고 ${gateTarget.name}도 안 열려. 그래도?`)) return;
  if(t.postponed>=2 && !confirm(`벌써 ${t.postponed+1}회째 미루는 중. 진짜 할 일 맞아?\n(쪼개거나 버리는 것도 방법)`)) return;
  if(t.must){
    const log = daylogs[tk] || (daylogs[tk]={});
    log.mustPostponed = true;
    save('daylogs',daylogs);
  }
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

// ----- 루틴 -----
const WEEKDAYS = ['일','월','화','수','목','금','토'];
function shiftedDate(t){ return new Date((t??Date.now()) - DAY_START*3600000); }
function keyToDate(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y, m-1, d); }
function weekStartOfKey(key){
  const d = keyToDate(key);
  d.setDate(d.getDate() - (d.getDay()+6)%7); // 월요일 시작
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function rlogHas(rid, day){ return rlogs.some(l=>l.rid===rid && l.day===day); }
function rlogCount(rid){ return rlogs.filter(l=>l.rid===rid).length; }
function weekCount(rid, refKey){
  const ws = weekStartOfKey(refKey ?? todayKey());
  return rlogs.filter(l=>l.rid===rid && weekStartOfKey(l.day)===ws).length;
}
function dueToday(r){
  if(r.paused) return false;
  if(r.type==='daily') return true;
  if(r.type==='days') return r.days.includes(shiftedDate().getDay());
  if(r.type==='weekly') return rlogHas(r.id, todayKey()) || weekCount(r.id) < r.perWeek;
  return false;
}
function routineStreak(r){
  const oneDay = 86400000;
  let now=0, best=0, cur=0, unit = r.type==='weekly' ? '주' : '일';
  if(r.type==='weekly'){
    const thisWs = weekStartOfKey(todayKey());
    for(let w=0; w<104; w++){
      const ref = dayKey(Date.now()-w*7*oneDay);
      const met = weekCount(r.id, ref) >= r.perWeek;
      if(w===0 && !met && weekStartOfKey(ref)===thisWs) continue; // 이번 주는 아직 진행 중
      if(met) now++; else break;
    }
    for(let w=103; w>=0; w--){
      const met = weekCount(r.id, dayKey(Date.now()-w*7*oneDay)) >= r.perWeek;
      if(met){ cur++; best=Math.max(best,cur); } else cur=0;
    }
    return { now, best, unit };
  }
  const scheduled = (key)=>{
    if(r.type==='daily') return !(daylogs[key]||{}).freeday; // 프리데이는 건너뜀
    return r.days.includes(keyToDate(key).getDay());
  };
  for(let i=0; i<365; i++){
    const key = dayKey(Date.now()-i*oneDay);
    if(!scheduled(key)) continue;
    if(rlogHas(r.id,key)) now++;
    else { if(i===0) continue; break; } // 오늘은 아직 진행 중
  }
  cur=0;
  for(let i=364; i>=0; i--){
    const key = dayKey(Date.now()-i*oneDay);
    if(!scheduled(key)) continue;
    if(rlogHas(r.id,key)){ cur++; best=Math.max(best,cur); } else cur=0;
  }
  return { now, best, unit };
}
function rewardProgress(r){
  if(!r.reward) return null;
  const rw = r.reward;
  const done = Math.max(0, rlogCount(r.id) - rw.base);
  const achieved = !!rw.achievedAt;
  const expired = !achieved && rw.due && Date.now() > rw.due;
  const dleft = rw.due ? Math.max(0, Math.ceil((rw.due - Date.now())/86400000)) : null;
  return { done, goal: rw.goal, left: Math.max(0, rw.goal-done), achieved, expired, dleft };
}
function toggleRoutineToday(rid){
  const r = routines.find(x=>x.id===rid); if(!r) return;
  const day = todayKey();
  const i = rlogs.findIndex(l=>l.rid===rid && l.day===day);
  if(i>=0) rlogs.splice(i,1); else rlogs.push({rid, day});
  save('rlogs', rlogs);
  if(r.reward && !r.reward.achievedAt){
    const rp = rewardProgress(r);
    if(!rp.expired && rp.done >= rp.goal){
      r.reward.achievedAt = Date.now();
      save('routines', routines);
      playMelody();
      setTimeout(()=>alert(`🎁 보상 달성!\n"${r.name}" ${r.reward.goal}회 완료 — ${r.reward.text}\n루틴 탭에서 [보상 받았어]를 눌러줘!`), 50);
    }
  }
  renderAll();
}
function routineSummary(r){
  if(r.type==='daily') return '매일';
  if(r.type==='days') return r.days.slice().sort().map(d=>WEEKDAYS[d]).join('');
  return `주 ${r.perWeek}회`;
}
function routineBadge(r){
  const s = routineStreak(r);
  if(r.type==='weekly') return `이번 주 ${weekCount(r.id)}/${r.perWeek}`;
  return s.now>0 ? `${s.now}일째` : '';
}
function renderRoutineToday(){
  const due = routines.filter(dueToday);
  $('#rtTodayTitle').hidden = due.length===0;
  const box = $('#rtTodayList'); box.innerHTML='';
  due.forEach(r=>{
    const row = document.createElement('div'); row.className='item'+(rlogHas(r.id,todayKey())?' done':'');
    const chk = document.createElement('button'); chk.className='chk'; chk.textContent='✓';
    chk.addEventListener('click',(e)=>{ e.stopPropagation(); toggleRoutineToday(r.id); });
    const body = document.createElement('div'); body.className='body';
    body.innerHTML = `<div class="title">${r.name}</div>`;
    const pill = document.createElement('span'); pill.className='pill dim'; pill.textContent = routineBadge(r) || routineSummary(r);
    row.appendChild(chk); row.appendChild(body); row.appendChild(pill);
    box.appendChild(row);
  });
}
let rtCalOpen = null;
function renderRoutines(){
  const box = $('#rtList'); box.innerHTML='';
  routines.forEach(r=>{
    const card = document.createElement('div'); card.className='card rt-card';
    if(r.paused) card.style.opacity=.55;
    const s = routineStreak(r);
    const top = document.createElement('div'); top.className='rt-top';
    top.innerHTML = `<span class="title">${r.name}</span><span class="pill dim">🔥 ${s.now}${s.unit} (최고 ${s.best})</span>`;
    card.appendChild(top);
    const sub = document.createElement('div'); sub.className='meta';
    let subTxt = routineSummary(r);
    if(r.type==='weekly') subTxt += ` · 이번 주 ${'●'.repeat(weekCount(r.id))}${'○'.repeat(Math.max(0,r.perWeek-weekCount(r.id)))}`;
    sub.textContent = subTxt;
    card.appendChild(sub);
    const rp = rewardProgress(r);
    if(rp){
      const rw = document.createElement('div'); rw.className='rt-reward';
      if(rp.achieved){
        rw.innerHTML = `<span>🎁 달성! ${r.reward.text}</span>`;
        const claim = document.createElement('button'); claim.className='mini'; claim.textContent='보상 받았어';
        claim.addEventListener('click',()=>{ r.reward=null; save('routines',routines); renderAll(); });
        rw.appendChild(claim);
      } else if(rp.expired){
        rw.innerHTML = `<span>⏳ 기간 종료 — ${rp.done}/${rp.goal}회 (${r.reward.text})</span>`;
        const retry = document.createElement('button'); retry.className='mini'; retry.textContent='🔄 다시 도전';
        retry.addEventListener('click',()=>{
          r.reward.base = rlogCount(r.id);
          r.reward.due = Date.now() + (r.reward.periodDays||14)*86400000;
          r.reward.achievedAt = null;
          save('routines',routines); renderAll();
        });
        const drop = document.createElement('button'); drop.className='mini'; drop.textContent='지우기';
        drop.addEventListener('click',()=>{ r.reward=null; save('routines',routines); renderAll(); });
        const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='6px';
        btns.appendChild(retry); btns.appendChild(drop);
        rw.appendChild(btns);
      } else {
        const dday = rp.dleft!=null ? ` · <b>D-${rp.dleft}</b>` : '';
        rw.innerHTML = `<span>🎁 ${r.reward.text}까지 <b>${rp.left}회</b>${dday}</span><div class="rt-bar"><div style="width:${Math.min(100,Math.round(rp.done/rp.goal*100))}%"></div></div>`;
      }
      card.appendChild(rw);
    }
    const tools = document.createElement('div'); tools.className='tools'; tools.style.marginTop='8px';
    const calBtn = document.createElement('button'); calBtn.className='mini'; calBtn.textContent = rtCalOpen===r.id?'달력 접기':'📅 달력';
    calBtn.addEventListener('click',()=>{ rtCalOpen = rtCalOpen===r.id?null:r.id; renderRoutines(); });
    const pauseBtn = document.createElement('button'); pauseBtn.className='mini'; pauseBtn.textContent = r.paused?'재개':'일시정지';
    pauseBtn.addEventListener('click',()=>{ r.paused=!r.paused; save('routines',routines); renderAll(); });
    const delBtn = document.createElement('button'); delBtn.className='mini'; delBtn.textContent='삭제';
    delBtn.addEventListener('click',()=>{
      if(!confirm(`"${r.name}" 루틴을 삭제할까? (기록도 사라져)`)) return;
      routines = routines.filter(x=>x.id!==r.id);
      rlogs = rlogs.filter(l=>l.rid!==r.id);
      save('routines',routines); save('rlogs',rlogs); renderAll();
    });
    tools.appendChild(calBtn); tools.appendChild(pauseBtn); tools.appendChild(delBtn);
    card.appendChild(tools);
    if(rtCalOpen===r.id){
      const cal = document.createElement('div');
      cal.className='heatmap rt-cal'; cal.style.marginTop='8px';
      for(let i=34;i>=0;i--){
        const key = dayKey(Date.now()-i*86400000);
        const cell = document.createElement('div');
        cell.className = 'hm-cell'+(rlogHas(r.id,key)?' g':'')+(key===todayKey()?' today':'');
        cell.title = key;
        cal.appendChild(cell);
      }
      card.appendChild(cal);
    }
    box.appendChild(card);
  });
  if(routines.length===0) box.innerHTML = '<p class="subline">아직 루틴이 없어. 위에서 첫 루틴을 만들어봐!</p>';
}
// 루틴 추가 폼
let rtType = 'daily', rtSelDays = new Set(), rtPeriod = 14;
(function(){
  const box = $('#rtRewardPeriod');
  const lbl = document.createElement('span');
  lbl.className='hint'; lbl.textContent='기간:'; lbl.style.alignSelf='center';
  box.appendChild(lbl);
  [['1주',7],['2주',14],['4주',28]].forEach(([label,d])=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini'+(d===rtPeriod?' on':''); b.dataset.d=d; b.textContent=label;
    b.addEventListener('click',()=>{
      rtPeriod=d;
      box.querySelectorAll('.mini').forEach(x=>x.classList.toggle('on',Number(x.dataset.d)===d));
    });
    box.appendChild(b);
  });
  const syncPeriodRow = ()=>{
    box.hidden = !($('#rtRewardGoal').value || $('#rtRewardText').value.trim());
  };
  $('#rtRewardGoal').addEventListener('input', syncPeriodRow);
  $('#rtRewardText').addEventListener('input', syncPeriodRow);
})();
(function(){
  const typesBox = $('#rtTypes');
  [['daily','매일'],['days','요일 지정'],['weekly','주 N회']].forEach(([k,label])=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini'+(k===rtType?' on':''); b.dataset.k=k; b.textContent=label;
    b.addEventListener('click',()=>{
      rtType=k;
      typesBox.querySelectorAll('.mini').forEach(x=>x.classList.toggle('on',x.dataset.k===k));
      $('#rtDays').hidden = k!=='days';
      $('#rtWeeklyRow').hidden = k!=='weekly';
      $('#rtHint').textContent = k==='daily'?'매일 반복 (프리데이는 스트릭 안 끊김)':k==='days'?'선택한 요일에만':'일주일 안에 채우면 OK, 언제 하든 자유';
    });
    typesBox.appendChild(b);
  });
  const daysBox = $('#rtDays');
  [1,2,3,4,5,6,0].forEach(d=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini'; b.textContent=WEEKDAYS[d];
    b.addEventListener('click',()=>{
      if(rtSelDays.has(d)) rtSelDays.delete(d); else rtSelDays.add(d);
      b.classList.toggle('on', rtSelDays.has(d));
    });
    daysBox.appendChild(b);
  });
})();
$('#rtAdd').addEventListener('click',()=>{
  const name = $('#rtName').value.trim();
  if(!name){ alert('루틴 이름을 입력해줘!'); return; }
  if(rtType==='days' && rtSelDays.size===0){ alert('요일을 골라줘!'); return; }
  const perWeek = Math.min(7, Math.max(1, parseInt($('#rtPerWeek').value,10)||3));
  const goal = parseInt($('#rtRewardGoal').value,10);
  const text = $('#rtRewardText').value.trim();
  if((goal>0) !== !!text){ alert('보상을 걸려면 횟수(N회)와 보상 내용 둘 다 적어줘!'); return; }
  const reward = (goal>0 && text) ? { goal, text, base:0, periodDays:rtPeriod, due: Date.now()+rtPeriod*86400000, achievedAt:null } : null;
  routines.push({ id:uid(), name, type:rtType, days:[...rtSelDays], perWeek, paused:false, reward, createdAt:Date.now() });
  save('routines',routines);
  $('#rtName').value=''; $('#rtRewardGoal').value=''; $('#rtRewardText').value='';
  $('#rtRewardPeriod').hidden=true;
  renderAll();
});

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
let ciSnoozed = false; // '나중에' 누르면 이번 실행 동안은 안 뜸
function ciMaybeOpen(){
  const tk = todayKey();
  if(!lastCheckin){
    // 진짜 첫 사용만 체크인 생략. 사용자가 직접 만든 데이터가 있으면(불러오기 등) 바로 체크인
    // (daylogs는 앱이 자동 기록하므로 판단 기준에서 제외 — 새 방문자 오작동 방지)
    const hasData = tasks.length>0 || routines.length>0 || rlogs.length>0 || expenses.length>0 || impulses.length>0;
    lastCheckin = hasData ? yesterdayKey() : tk;
    save('lastCheckin', lastCheckin);
    if(!hasData) return;
  }
  if(lastCheckin===tk || ciSnoozed) return;
  if(!$('#checkinModal').hidden) return;
  ciOpen();
}
function ciOpen(){
  ci.triage={}; ci.musts=new Set();
  $('#ciDate').textContent = new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
  $('#ciQ1 .ci-q').textContent = `어제 무단 ${gateTarget.name} 했어?`;
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
    if(choice==='오늘 또'){
      t.postponed++; t.must=false;
      // 오늘 다시 하는 일은 마감을 오늘 16:00으로 (이미 지났으면 지금+3시간)
      const d = new Date(); d.setHours(16,0,0,0);
      if(d <= new Date()) d.setTime(Date.now() + 3*3600000);
      t.deadline = d.toISOString();
      notified[t.id] = null;
    }
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
$('#ciLater').addEventListener('click',()=>{
  ciSnoozed = true; // lastCheckin은 안 바꿈 → 다음 실행 때 다시 물어봄
  $('#checkinModal').hidden = true;
  renderAll();
});
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
let exMode = 'spend'; // 'spend' | 'saved'
function savedTotal(){
  return impulses.filter(i=>i.result==='passed'&&i.amount).reduce((s,i)=>s+i.amount,0)
       + savings.reduce((s,x)=>s+x.amount,0);
}
function renderBudget(){
  const now = new Date();
  const month = expenses.filter(e=>{ const d=new Date(e.at); return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth(); });
  $('#monthTotal').textContent = won(month.reduce((s,e)=>s+e.amount,0));
  $('#savedTotal').textContent = won(savedTotal());
  const cl = $('#catList'); cl.innerHTML='';
  CATS.forEach(c=>{
    const sum = month.filter(e=>e.cat===c).reduce((s,e)=>s+e.amount,0);
    if(!sum) return;
    const row = document.createElement('div'); row.className='item';
    row.innerHTML = `<div class="body"><div class="title">${c}</div></div><span class="pill dim">${won(sum)}</span>`;
    cl.appendChild(row);
  });
  const el = $('#exList'); el.innerHTML='';
  const spendItems = expenses.map(e=>({...e, kind:'spend'}));
  const savedItems = savings.map(s=>({...s, kind:'saved'}))
    .concat(impulses.filter(i=>i.result==='passed'&&i.amount).map(i=>({id:i.id, at:i.at, amount:i.amount, memo:'충동 참기 성공', kind:'saved'})));
  spendItems.concat(savedItems).sort((a,b)=>b.at-a.at).slice(0,7).forEach(e=>{
    const row = document.createElement('div'); row.className='item';
    const d = new Date(e.at);
    if(e.kind==='saved'){
      row.innerHTML = `<div class="body"><div class="title">💰 ${e.memo||'참은돈'}</div><div class="meta">${d.getMonth()+1}/${d.getDate()} · 안 쓴 돈</div></div><span class="pill ok">+${won(e.amount)}</span>`;
    } else {
      row.innerHTML = `<div class="body"><div class="title">${e.memo||e.cat}</div><div class="meta">${d.getMonth()+1}/${d.getDate()} · ${e.cat}</div></div><span class="pill dim">${won(e.amount)}</span>`;
    }
    el.appendChild(row);
  });
}
$('#exModeSpend').addEventListener('click',()=>{
  exMode='spend';
  $('#exModeSpend').classList.add('on'); $('#exModeSaved').classList.remove('on');
  $('#exCats').hidden=false;
  $('#exMemo').placeholder='메모 (선택)';
});
$('#exModeSaved').addEventListener('click',()=>{
  exMode='saved';
  $('#exModeSaved').classList.add('on'); $('#exModeSpend').classList.remove('on');
  $('#exCats').hidden=true;
  $('#exMemo').placeholder='뭘 참았어? (예: 키보드 지름 참음)';
});
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
  $('#legendP').textContent = `무단 ${gateTarget.name}`;
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
  const blob = new Blob([JSON.stringify({tasks,impulses,expenses,savings,postponeLog,daylogs,routines,rlogs,lastCheckin,activeId},null,2)],{type:'application/json'});
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
    tasks=data.tasks; impulses=data.impulses||[]; expenses=data.expenses||[]; savings=data.savings||[]; postponeLog=data.postponeLog||[];
    daylogs=data.daylogs||{}; routines=data.routines||[]; rlogs=data.rlogs||[]; lastCheckin=data.lastCheckin??lastCheckin; activeId=data.activeId??null;
    save('tasks',tasks); save('impulses',impulses); save('expenses',expenses); save('savings',savings); save('postponeLog',postponeLog);
    save('daylogs',daylogs); save('routines',routines); save('rlogs',rlogs); save('lastCheckin',lastCheckin); save('activeId',activeId);
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

// ----- 빠른 마감 입력 (2탭: 날짜 + 시간) -----
function setupQuickPanel(ids){
  const el = (id)=>document.getElementById(id);
  const form=el(ids.form), title=ids.title?el(ids.title):null, badge=el(ids.badge), panel=el(ids.panel);
  const daysBox=el(ids.days), hoursBox=el(ids.hours), relBox=el(ids.rel), dl=el(ids.dl);
  let day=null, hour=null, rel=null;

  function dayOffset(){ return day==='tmr'?1 : day==='d2'?2 : 0; }
  function compute(){
    if(rel!=null) return new Date(Date.now()+rel*3600000);
    if(day==='pick') return dl.value ? new Date(dl.value) : null;
    if(hour==null) return null;
    const d = new Date(); d.setDate(d.getDate()+dayOffset()); d.setHours(hour,0,0,0);
    if(hour===24){ d.setHours(0,0,0,0); d.setDate(d.getDate()+1); }
    if(day==null && d < new Date()) d.setDate(d.getDate()+1); // 시간만 골랐는데 지났으면 자동으로 내일
    return d;
  }
  function badgeText(d){
    const now = new Date();
    const diffDays = Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate()) - new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
    const dayLabel = diffDays===0?'오늘':diffDays===1?'내일':diffDays===2?'모레':`${d.getMonth()+1}/${d.getDate()}`;
    return `${dayLabel} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function paint(){
    daysBox.querySelectorAll('.mini').forEach(b=>b.classList.toggle('on', b.dataset.k===day));
    relBox.querySelectorAll('.mini').forEach(b=>b.classList.toggle('on', b.dataset.r!=='' && Number(b.dataset.r)===rel));
    hoursBox.querySelectorAll('.mini').forEach(b=>{
      const h = Number(b.dataset.h);
      b.classList.toggle('on', h===hour);
      // '오늘'을 명시적으로 고른 상태에선 지난 시간 비활성
      let past = false;
      if(day==='today'){ const d=new Date(); d.setHours(h,0,0,0); if(h===24){d.setHours(0,0,0,0);d.setDate(d.getDate()+1);} past = d < new Date(); }
      b.disabled = past;
    });
    dl.hidden = day!=='pick';
    const d = compute();
    badge.hidden = !d;
    if(d) badge.textContent = badgeText(d);
  }

  [['today','오늘'],['tmr','내일'],['d2','모레'],['pick','📅 날짜']].forEach(([k,label])=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini'; b.dataset.k=k; b.textContent=label;
    b.addEventListener('click',()=>{
      rel=null; day = (day===k?null:k); paint();
      if(k==='pick' && day==='pick'){ try{ dl.showPicker(); }catch(e){} } // 달력 바로 열기
    });
    daysBox.appendChild(b);
  });
  dl.addEventListener('click',()=>{ try{ dl.showPicker(); }catch(e){} });
  for(let h=1; h<=24; h++){
    const b = document.createElement('button');
    b.type='button'; b.className='mini'; b.dataset.h=h; b.textContent=h;
    b.addEventListener('click',()=>{ rel=null; if(day==='pick') day=null; hour = (hour===h?null:h); paint(); });
    hoursBox.appendChild(b);
  }
  [['1시간 뒤',1],['3시간 뒤',3]].forEach(([label,h])=>{
    const b = document.createElement('button');
    b.type='button'; b.className='mini'; b.dataset.r=h; b.textContent=label;
    b.addEventListener('click',()=>{ rel = (rel===h?null:h); if(rel!=null){ day=null; hour=null; } paint(); });
    relBox.appendChild(b);
  });
  const clearBtn = document.createElement('button');
  clearBtn.type='button'; clearBtn.className='mini'; clearBtn.dataset.r=''; clearBtn.textContent='마감 없음';
  clearBtn.addEventListener('click',()=>{ day=null; hour=null; rel=null; dl.value=''; paint(); });
  relBox.appendChild(clearBtn);
  dl.addEventListener('change', paint);

  if(title){
    title.addEventListener('focus',()=>{ panel.hidden=false; });
    title.addEventListener('click',()=>{ panel.hidden=false; });
    panel.addEventListener('mousedown',(e)=>{ if(e.target.tagName!=='INPUT') e.preventDefault(); }); // 버튼 눌러도 입력창 포커스 유지
    document.addEventListener('click',(e)=>{ if(!form.contains(e.target)) panel.hidden=true; });
  }

  paint();
  return {
    deadline(){ const d = compute(); return d ? d.toISOString() : null; },
    reset(){ day=null; hour=null; rel=null; dl.value=''; paint(); },
    set(iso){ // 기존 마감으로 프리셋 (수정용)
      day=null; hour=null; rel=null; dl.value='';
      if(iso){ day='pick'; dl.value=toLocalDT(iso); }
      paint();
    }
  };
}
const taQuick = setupQuickPanel({form:'taForm',title:'taTitle',badge:'taBadge',panel:'taPanel',days:'taDays',hours:'taHours',rel:'taRel',dl:'taDeadline'});
const ibQuick = setupQuickPanel({form:'ibForm',title:'ibTitle',badge:'ibBadge',panel:'ibPanel',days:'ibDays',hours:'ibHours',rel:'ibRel',dl:'ibDeadline'});
const edQuick = setupQuickPanel({form:'editModal',badge:'edBadge',panel:'edPanel',days:'edDays',hours:'edHours',rel:'edRel',dl:'edDeadline'});

// ----- 마감 수정 모달 -----
let editingId = null;
function openEdit(id){
  const t = tasks.find(x=>x.id===id); if(!t) return;
  editingId = id;
  $('#edName').value = t.title;
  edQuick.set(t.deadline);
  $('#editModal').hidden = false;
}
$('#edSave').addEventListener('click',()=>{
  const t = tasks.find(x=>x.id===editingId);
  if(t){
    const name = $('#edName').value.trim();
    if(name) t.title = name;
    t.deadline = edQuick.deadline();
    notified[t.id]=null;
    save('tasks',tasks);
  }
  $('#editModal').hidden = true;
  renderAll();
});
$('#edClose').addEventListener('click',()=>{ $('#editModal').hidden = true; });

// ----- 마감 연장 -----
function extendActive(hours){
  const t = tasks.find(x=>x.id===activeId && !x.dropped);
  if(!t || t.done) return;
  const base = t.deadline ? new Date(t.deadline) : new Date();
  base.setHours(base.getHours()+hours);
  t.deadline = base.toISOString();
  notified[t.id] = null;
  save('tasks',tasks); renderAll();
}

// ----- 입력 이벤트 -----
$('#taAdd').addEventListener('click',()=>{
  if(addTask($('#taTitle').value, taQuick.deadline(), $('#taMust').checked, 'today')){
    $('#taTitle').value=''; $('#taMust').checked=false; taQuick.reset();
    $('#taTitle').focus();
  }
});
$('#ibAdd').addEventListener('click',()=>{
  if(addTask($('#ibTitle').value, ibQuick.deadline(), false, 'inbox')){
    $('#ibTitle').value=''; ibQuick.reset();
    $('#ibTitle').focus();
  }
});
$('#taTitle').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#taAdd').click(); });
$('#ibTitle').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#ibAdd').click(); });
$('#nowDone').addEventListener('click',()=>{ if(activeId) toggleDone(activeId); });
$('#nowPlus1').addEventListener('click',()=>extendActive(1));
$('#nowPlus3').addEventListener('click',()=>extendActive(3));

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
  if(curView==='today'){ renderRoutineToday(); renderToday(); }
  else if(curView==='routine') renderRoutines();
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
  if(exMode==='saved'){
    savings.push({ id:uid(), at:Date.now(), amount:amt, memo:$('#exMemo').value.trim() });
    save('savings',savings);
  } else {
    expenses.push({ id:uid(), at:Date.now(), amount:amt, cat:exCat, memo:$('#exMemo').value.trim() });
    save('expenses',expenses);
  }
  $('#exAmount').value=''; $('#exMemo').value='';
  renderBudget();
});

// PWA
if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }

renderAll();
ciMaybeOpen();
// 첫 방문 온보딩: 잠금 대상을 아직 설정 안 했으면 설정 유도
if(localStorage.getItem('mnj.gateTarget')===null && $('#checkinModal').hidden){
  openGateModal();
}
})();
