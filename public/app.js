const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let me = null;

async function api(path, options={}) {
  const res = await fetch(path, {headers:{"content-type":"application/json",...(options.headers||{})}, ...options});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || "通信エラー");
  return data;
}

function show(id, visible=true){ $(id).classList.toggle("hidden",!visible); }

async function boot(){
  try{
    const d = await api("/api/me");
    if(d.loggedIn) enter(d.member); else showAuth();
  }catch{ showAuth(); }
}
function showAuth(){show("#loginView",true);show("#registerView",false);show("#appView",false);show("#logoutBtn",false)}
function enter(member){
  me=member; show("#loginView",false);show("#registerView",false);show("#appView",true);show("#logoutBtn",true);
  $("#welcomeName").textContent=member.gameName;
  $("#roleBadge").textContent=member.role.toUpperCase();
  if(member.role!=="member") show("#addScheduleBtn",true);
  loadHome(); loadMembers(); loadUnits(); loadProgress(); loadSchedules();
}
async function loadHome(){
  try{
    const m=await api("/api/members"), u=await api("/api/units");
    $("#homeMembers").textContent=m.members.length+"人";
    $("#homeUnits").textContent=u.units.length+"種";
  }catch{}
}
async function loadMembers(){
  try{
    const d=await api("/api/members");
    $("#memberList").innerHTML=d.members.map(x=>`
      <div class="item row"><div><div class="member-name">${esc(x.game_name)}</div><div class="muted">登録 ${new Date(x.created_at.replace(" ","T")+"Z").toLocaleDateString("ja-JP")}</div></div><span class="role">${x.role==="member"?"一門員":x.role==="officer"?"幹部":"管理者"}</span></div>
    `).join("");
  }catch(e){$("#memberList").innerHTML=`<div class="card">${esc(e.message)}</div>`}
}
async function loadUnits(){
  try{
    const d=await api("/api/my-units");
    const types=["馬","弓","槍","鉄砲"];
    $("#myUnits").innerHTML=d.units.map(x=>`
      <div class="item">
        <div class="row"><span class="unit-name">${esc(x.unit_name)}</span><span class="level">Lv.${x.level}</span></div>
        <div class="levelbar"><i style="width:${x.level*2}%"></i></div>
        <div class="edit-grid">
          <label><span class="muted">育成Lv</span>
            <select data-unit="${x.id}" class="lvsel">${Array.from({length:50},(_,i)=>`<option ${i+1===x.level?"selected":""}>${i+1}</option>`).join("")}</select>
          </label>
          <label><span class="muted">兵種</span>
            <select data-unit="${x.id}" class="typesel">${types.map(t=>`<option ${t===x.troop_type?"selected":""}>${t}</option>`).join("")}</select>
          </label>
        </div>
      </div>`).join("");
    const save=async unitId=>{
      const lv=Number(document.querySelector(`.lvsel[data-unit="${unitId}"]`).value);
      const troopType=document.querySelector(`.typesel[data-unit="${unitId}"]`).value;
      await api("/api/my-units",{method:"PUT",body:JSON.stringify({unitId:Number(unitId),level:lv,troopType})});
      loadUnits(); loadProgress();
    };
    $$(".lvsel,.typesel").forEach(s=>s.addEventListener("change",async e=>{try{await save(e.target.dataset.unit)}catch(err){alert(err.message)}}));
  }catch(e){$("#myUnits").innerHTML=`<div class="card">${esc(e.message)}</div>`}
}
async function loadProgress(){
  try{
    const d=await api("/api/progress");
    const map={};
    d.rows.forEach(x=>(map[x.member_id]??={name:x.game_name,units:[]}).units.push(x));
    $("#progressList").innerHTML=Object.values(map).map(m=>`
      <div class="item"><div class="row"><strong>${esc(m.name)}</strong><span class="muted">${m.units.length}部隊</span></div>
      ${m.units.map(u=>`<div style="margin-top:9px"><div class="row"><span>${esc(u.unit_name)} <span class="muted">${esc(u.troop_type||"馬")}</span></span><b>Lv.${u.level}</b></div><div class="levelbar"><i style="width:${u.level*2}%"></i></div></div>`).join("")}
      </div>`).join("");
  }catch(e){$("#progressList").innerHTML=`<div class="card">${esc(e.message)}</div>`}
}
async function loadSchedules(){
  try{
    const d=await api("/api/schedules");
    $("#scheduleList").innerHTML=d.schedules.length?d.schedules.map(x=>`
      <div class="item"><div class="muted">${formatDate(x.start_at)}</div><h3 style="margin:5px 0">${esc(x.title)}</h3><div>${esc(x.description)}</div></div>`).join("")
      :`<div class="card muted">予定はまだありません。</div>`;
  }catch(e){$("#scheduleList").innerHTML=`<div class="card">${esc(e.message)}</div>`}
}
function formatDate(v){const d=new Date(v);return isNaN(d)?esc(v):d.toLocaleString("ja-JP",{month:"numeric",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit"})}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

$$(".tabs button").forEach(b=>b.addEventListener("click",()=>{
  $$(".tabs button").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  $$(".tab").forEach(x=>x.classList.add("hidden")); $("#tab-"+b.dataset.tab).classList.remove("hidden");
}));
$("#showRegister").onclick=()=>{show("#loginView",false);show("#registerView",true)};
$("#showLogin").onclick=()=>{show("#registerView",false);show("#loginView",true)};
$("#loginBtn").onclick=async()=>{
  $("#loginMsg").textContent="";
  try{await api("/api/login",{method:"POST",body:JSON.stringify({gameName:$("#loginName").value,password:$("#loginPass").value})});boot()}
  catch(e){$("#loginMsg").textContent=e.message}
};
$("#registerBtn").onclick=async()=>{
  $("#regMsg").textContent="";
  try{await api("/api/register",{method:"POST",body:JSON.stringify({gameName:$("#regName").value,password:$("#regPass").value})});boot()}
  catch(e){$("#regMsg").textContent=e.message}
};
$("#logoutBtn").onclick=async()=>{await api("/api/logout",{method:"POST"});location.reload()};
$("#addScheduleBtn").onclick=async()=>{
  const title=prompt("予定名");
  if(!title)return;
  const startAt=prompt("日時（例: 2026-09-12T21:00）");
  if(!startAt)return;
  const description=prompt("内容（任意）")||"";
  try{await api("/api/schedules",{method:"POST",body:JSON.stringify({title,startAt,description})});loadSchedules();}
  catch(e){alert(e.message)}
};
boot();
