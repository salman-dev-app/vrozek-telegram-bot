/**
 * VROZEK AI — Web Admin Dashboard.
 * Hono app mounted at /dashboard (SPA) + /api (JSON) — both behind Basic Auth.
 * Credentials come from env DASHBOARD_USERNAME / DASHBOARD_PASSWORD (never hardcoded).
 */

import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from '../db/db';
import { getSetting, setSetting } from '../db/db';
import { getUserRole } from '../lib/auth';
import { runBroadcast } from '../services/broadcast';
import { logEvent } from '../lib/log';
import { getAllCatalog } from '../services/catalog';
import { rateLimit } from '../lib/limiter';
import { TgClient } from '../lib/telegram';

export function createDashboard(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (c, next) => {
    const user = c.env.DASHBOARD_USERNAME;
    const pass = c.env.DASHBOARD_PASSWORD;
    if (!user || !pass) {
      return c.text('Dashboard is disabled: set DASHBOARD_USERNAME and DASHBOARD_PASSWORD', 503);
    }
    const auth = basicAuth({ username: user, password: pass });
    return auth(c, next);
  });

  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'GET') return next();
    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    if (!rateLimit(`api:${ip}`, 30, 60000)) return c.json({ error: 'rate limited, slow down' }, 429);
    return next();
  });

  app.get('/', (c) =>
    c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VROZEK AI — Admin</title>
<style>
:root{--bg:#0b1020;--card:#141b31;--line:#24304f;--tx:#e6ecff;--mut:#8b97b8;--acc:#6c8cff;--ok:#3ddc84;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--tx)}
header{padding:16px 24px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:5}
header h1{font-size:17px;margin:0}header small{color:var(--mut)}
.layout{display:flex;min-height:100vh}
nav{width:190px;border-right:1px solid var(--line);padding:14px 10px;flex-shrink:0}
nav button{display:block;width:100%;text-align:left;background:none;border:none;color:var(--mut);padding:9px 12px;border-radius:8px;cursor:pointer;font-size:14px;margin-bottom:2px}
nav button:hover{background:#1a2340;color:var(--tx)}
nav button.active{background:#22305c;color:var(--tx)}
main{flex:1;padding:22px 26px;max-width:1100px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px}
.card h2{margin:0 0 4px;font-size:15px}
.card .sub{color:var(--mut);font-size:12.5px;margin:0 0 14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase}
input,select,textarea{background:#0d1428;border:1px solid var(--line);color:var(--tx);border-radius:8px;padding:8px 10px;font-size:13.5px;width:100%}
textarea{min-height:80px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.kpi b{font-size:26px;display:block}.kpi span{color:var(--mut);font-size:12.5px}
button.btn{background:var(--acc);color:#fff;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px}
button.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--mut)}
button.btn.danger{background:transparent;border:1px solid var(--bad);color:var(--bad)}
button.btn.ok{background:var(--ok);color:#05230f}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11.5px;border:1px solid var(--line);color:var(--mut)}
.badge.on{color:var(--ok);border-color:var(--ok)}.badge.off{color:var(--bad);border-color:var(--bad)}
.toast{position:fixed;bottom:20px;right:20px;background:#1f2a4d;border:1px solid var(--acc);border-radius:10px;padding:12px 16px;display:none;max-width:340px}
.pad{margin-top:8px}
@media(max-width:760px){.layout{flex-direction:column}nav{width:100%;border-right:none;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap}nav button{width:auto}}
</style></head><body>
<header><h1>🤖 VROZEK AI</h1><small>Admin Dashboard</small></header>
<div class="layout">
<nav id="nav"></nav>
<main id="view"></main>
</div>
<div class="toast" id="toast"></div>
<script>
const $ = (s,r=document)=>r.querySelector(s);
const fmt = (v)=>v??0;
const esc = (s)=>(s??'').toString().replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
async function api(path,opts={}){
  const r = await fetch(path,{headers:{'Content-Type':'application/json'},...opts});
  if(r.status===401){location.reload();throw new Error('auth');}
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
  return d;
}
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',2600);}
const SECTIONS=['dashboard','admins','groups','products','knowledge','moderation','stickers','broadcast','analytics','logs','settings'];
const LABELS={dashboard:'⚡ Dashboard',admins:'🛡 Admins',groups:'👥 Groups',products:'📦 Products',knowledge:'🧠 Knowledge',moderation:'🛡 Moderation',stickers:'😄 Stickers',broadcast:'📢 Broadcast',analytics:'📊 Analytics',logs:'📜 Logs',settings:'⚙️ Settings'};
let cur='dashboard';
function navRender(){const n=$('#nav');n.innerHTML=SECTIONS.map(s=>\`<button class="\${cur===s?'active':''}" data-s="\${s}">\${LABELS[s]}</button>\`).join('');n.querySelectorAll('button').forEach(b=>b.onclick=()=>show(b.dataset.s));}
async function show(s){cur=s;navRender();const v=$('#view');v.innerHTML='<p>Loading…</p>';try{await ROUTES[s](v);}catch(e){v.innerHTML='<p style="color:var(--bad)">Failed: '+esc(e.message)+'</p>';}}
const ROUTES={};

ROUTES.dashboard=async(v)=>{
  const s=await api('/api/stats');
  v.innerHTML=\`<div class="grid">
    \${[['👤 Users',s.users],['👥 Groups',s.groups],['📦 Products',s.products],['🛡 Knowledge',s.knowledge],['✓ Stickers',s.stickers],['🛡 Moderation actions',s.moderation]].map(([l,n])=>\`<div class="kpi"><b>\${fmt(n)}</b><span>\${l}</span></div>\`).join('')}
  </div>
  <div class="card"><h2>Quick actions</h2>
  <div class="row pad"><button class="btn" onclick="show('broadcast')">📢 New broadcast</button>
  <button class="btn ghost" onclick="show('products')">+ Add product</button>
  <button class="btn ghost" onclick="show('knowledge')">+ Add knowledge</button></div></div>\`;
};

ROUTES.admins=async(v)=>{
  const a=await api('/api/admins');
  v.innerHTML=\`<div class="card"><h2>Administrators</h2><p class="sub">Roles: super_admin &gt; admin &gt; moderator</p>
  <form class="row" onsubmit="addAdmin(event)">
    <input id="aid" type="number" placeholder="Telegram User ID" required style="max-width:180px"/>
    <select id="arole" style="max-width:140px"><option>super_admin</option><option>admin</option><option>moderator</option></select>
    <button class="btn">+ Add</button>
  </form>
  <table class="pad"><tr><th>User ID</th><th>Role</th><th>Added</th><th></th></tr>
  \${a.map(x=>\`<tr><td><code>\${x.user_id}</code></td><td>\${esc(x.role)}</td><td>\${esc(x.created_at||'')}</td><td><button class="btn danger" onclick="delAdmin(\${x.user_id})">Remove</button></td></tr>\`).join('')}</table></div>\`;
};
window.addAdmin=async(e)=>{e.preventDefault();try{await api('/api/admins',{method:'POST',body:JSON.stringify({user_id:+$('#aid').value,role:$('#arole').value})});toast('Added');show('admins');}catch(err){toast(err.message);}};
window.delAdmin=async(id)=>{try{await api('/api/admins/'+id,{method:'DELETE'});toast('Removed');show('admins');}catch(err){toast(err.message);}};

ROUTES.groups=async(v)=>{
  const g=await api('/api/groups');
  v.innerHTML=\`<div class="card"><h2>Authorized Groups</h2><p class="sub">The bot only operates in these groups. Each group has independent settings.</p>
  <form class="row" onsubmit="addGroup(event)">
    <input id="gid" type="number" placeholder="Group ID (from @getidsbot)" required style="max-width:190px"/>
    <input id="gtitle" placeholder="Group title (optional)" style="max-width:220px"/>
    <button class="btn">+ Authorize</button>
  </form></div>
  \${g.map(x=>\`
  <div class="card"><div class="row" style="justify-content:space-between">
    <div><b>\${esc(x.title||('Group '+x.id))}</b> <code>\${x.id}</code>
      <span class="badge \${x.enabled?'on':'off'}">\${x.enabled?'active':'disabled'}</span></div>
    <div class="row">
      <button class="btn ghost" onclick="toggleGroup(\${x.id})">\${x.enabled?'Disable':'Enable'}</button>
      <button class="btn danger" onclick="delGroup(\${x.id})">Remove</button>
    </div></div>
    <div class="grid pad">
      \${['ai_enabled','welcome_enabled','goodbye_enabled','moderation_enabled','sticker_enabled','products_enabled'].map(k=>\`
        <label class="row" style="justify-content:space-between"><span>\${k}</span>
        <input type="checkbox" style="width:auto" \${x.settings[k]?'checked':''} onchange="setGroup(\${x.id},'\${k}',this.checked)"/></label>\`).join('')}
    </div>
    <div class="row pad"><input id="wt\${x.id}" placeholder="Welcome text ({name})" value="\${esc(x.settings.welcome_text||'')}"/>
    <input id="gt\${x.id}" placeholder="Goodbye text ({name})" value="\${esc(x.settings.goodbye_text||'')}"/>
    <button class="btn ghost" onclick="setTexts(\${x.id})">Save texts</button></div>
  </div>\`).join('')}\`;
};
window.addGroup=async(e)=>{e.preventDefault();try{await api('/api/groups',{method:'POST',body:JSON.stringify({id:+$('#gid').value,title:$('#gtitle').value})});toast('Group authorized');show('groups');}catch(err){toast(err.message);}};
window.delGroup=async(id)=>{try{await api('/api/groups/'+id,{method:'DELETE'});toast('Removed');show('groups');}catch(err){toast(err.message);}};
window.toggleGroup=async(id)=>{try{await api('/api/groups/'+id+'/toggle',{method:'POST'});show('groups');}catch(err){toast(err.message);}};
window.setGroup=async(id,k,c)=>{try{await api('/api/groups/'+id+'/settings',{method:'POST',body:JSON.stringify({[k]:c})});toast('Saved');}catch(err){toast(err.message);}};
window.setTexts=async(id)=>{try{await api('/api/groups/'+id+'/settings',{method:'POST',body:JSON.stringify({welcome_text:$('#wt'+id).value,goodbye_text:$('#gt'+id).value})});toast('Saved');}catch(err){toast(err.message);}};

ROUTES.products=async(v)=>{
  const p=await api('/api/products');
  window.__prods=p;
  v.innerHTML=`<div class="card"><h2>Product Catalog</h2><p class="sub">Single source: <b>catalog/products.json</b> (repo root). Edit it, then redeploy. The bot only recommends these links.</p>
  <div class="row"><input id="pq" placeholder="Search products…" style="max-width:230px" oninput="renderProds()"/>
  <select id="pc" style="max-width:190px" onchange="renderProds()"><option value="">All categories</option>${[...new Set(p.map(x=>x.category).filter(Boolean))].map(cat=>`<option>${esc(cat)}</option>`).join('')}</select>
  <span style="color:var(--mut);font-size:12.5px">${p.length} items</span></div></div>
  <div class="card" id="plist"></div>`;
  renderProds();
};
window.renderProds=()=>{
  const q=($('#pq').value||'').toLowerCase();
  const c=$('#pc').value||'';
  const list=(window.__prods||[]).filter(x=>(!q||(x.name+' '+x.description+' '+x.category).toLowerCase().includes(q))&&(!c||x.category===c));
  $('#plist').innerHTML=`<table><tr><th>Name</th><th>Category</th><th>Description</th><th>Link</th></tr>`+
    (list.map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.category||'')}</td><td>${esc(x.description||'')}</td><td><a href="${esc(x.url)}" target="_blank">open</a></td></tr>`).join('')||'<tr><td colspan=4>No products in catalog.</td></tr>')+`</table>`;
};
ROUTES.knowledge=async(v)=>{
  const k=await api('/api/knowledge');
  v.innerHTML=\`<div class="card"><h2>Knowledge Base</h2><p class="sub">Verified Q&amp;A the AI can use when relevant.</p>
  <form onsubmit="addKb(event)"><div class="row"><input id="kq" placeholder="Question / keyword (e.g. shipping)" required style="max-width:260px"/>
  <input id="kc" placeholder="Category (optional)" style="max-width:140px"/></div>
  <textarea id="ka" placeholder="Verified answer" required class="pad"></textarea>
  <button class="btn pad">+ Add entry</button></form></div>
  <div class="card"><table><tr><th>Question</th><th>Answer</th><th></th></tr>
  \${k.map(x=>\`<tr><td><b>\${esc(x.question)}</b></td><td>\${esc(String(x.answer).slice(0,120))}</td>
  <td><button class="btn danger" onclick="delKb(\${x.id})">Del</button></td></tr>\`).join('')}</table></div>\`;
};
window.addKb=async(e)=>{e.preventDefault();try{await api('/api/knowledge',{method:'POST',body:JSON.stringify({question:$('#kq').value,answer:$('#ka').value,category:$('#kc').value})});toast('Added');show('knowledge');}catch(err){toast(err.message);}};
window.delKb=async(id)=>{try{await api('/api/knowledge/'+id,{method:'DELETE'});toast('Deleted');show('knowledge');}catch(err){toast(err.message);}};

ROUTES.moderation=async(v)=>{
  const m=await api('/api/moderation');
  v.innerHTML=\`<div class="card"><h2>Moderation</h2><p class="sub">Configured per group under <b>Groups</b>. Deleting only happens at high confidence; low confidence is ignored to avoid false positives.</p>
  <table><tr><th>Group</th><th>User</th><th>Action</th><th>Category</th><th>When</th></tr>
  \${m.map(x=>\`<tr><td>\${esc(x.group_id)}</td><td>\${esc(x.user_name||x.user_id)}</td><td>\${esc(x.action)}</td><td>\${esc(x.category)}</td><td>\${esc(x.created_at||'')}</td></tr>\`).join('')||'<tr><td colspan=5>No moderation actions yet.</td></tr>'}</table></div>\`;
};

ROUTES.stickers=async(v)=>{
  const s=await api('/api/stickers');
  v.innerHTML=\`<div class="card"><h2>Stickers</h2><p class="sub">Send any sticker to the bot privately to add it, or add a file_id here. The bot never spams stickers.</p>
  <form class="row" onsubmit="addStk(event)"><input id="sf" placeholder="Sticker file_id" required style="max-width:300px"/>
  <select id="sc" style="max-width:150px"><option>reaction</option><option>funny</option><option>happy</option><option>greeting</option><option>celebration</option><option>thinking</option><option>normal</option></select>
  <button class="btn">+ Add</button></form></div>
  <div class="card"><table><tr><th>Category</th><th>Label</th><th>file_id</th><th></th></tr>
  \${s.map(x=>\`<tr><td>\${esc(x.category)}</td><td>\${esc(x.label||'')}</td><td><code>\${esc(x.file_id).slice(0,40)}…</code></td><td><button class="btn danger" onclick="delStk(\${x.id})">Del</button></td></tr>\`).join('')||'<tr><td colspan=4>No stickers yet.</td></tr>'}</table></div>\`;
};
window.addStk=async(e)=>{e.preventDefault();try{await api('/api/stickers',{method:'POST',body:JSON.stringify({file_id:$('#sf').value,category:$('#sc').value})});toast('Added');show('stickers');}catch(err){toast(err.message);}};
window.delStk=async(id)=>{try{await api('/api/stickers/'+id,{method:'DELETE'});toast('Deleted');show('stickers');}catch(err){toast(err.message);}};

ROUTES.broadcast=async(v)=>{
  const g=await api('/api/groups');
  v.innerHTML=\`<div class="card"><h2>Broadcast</h2><p class="sub">Sent to all authorized (enabled) groups, or a single group.</p>
  <form onsubmit="sendBc(event)"><textarea id="btext" placeholder="Broadcast message" required></textarea>
  <div class="row pad"><select id="btarget" style="max-width:280px"><option value="">All authorized groups</option>\${g.map(x=>\`<option value="\${x.id}">\${esc(x.title||x.id)}</option>\`).join('')}</select>
  <button class="btn ok">📢 Send</button></div></form></div>
  <div class="card"><h2>Recent broadcasts</h2><table><tr><th>When</th><th>Total</th><th>OK</th><th>Failed</th></tr>
  \${(await api('/api/broadcasts')).map(b=>\`<tr><td>\${esc(b.created_at||'')}</td><td>\${b.total}</td><td style="color:var(--ok)">\${b.success}</td><td style="color:var(--bad)">\${b.failed}</td></tr>\`).join('')||'<tr><td colspan=4>None yet.</td></tr>'}</table></div>\`;
};
window.sendBc=async(e)=>{e.preventDefault();try{const r=await api('/api/broadcast',{method:'POST',body:JSON.stringify({text:$('#btext').value,group_id:$('#btarget').value?+$('#btarget').value:null})});toast('Sent: '+r.success+'/'+r.total);show('broadcast');}catch(err){toast(err.message);}};

ROUTES.analytics=async(v)=>{
  const s=await api('/api/stats');
  const a=await api('/api/analytics');
  v.innerHTML=\`<div class="grid">
    \${[['👤 Users',s.users],['👥 Groups',s.groups],['📦 Products (all)',s.products_total],['✓ Active products',s.products],['🧠 Knowledge',s.knowledge],['😄 Stickers',s.stickers]].map(([l,n])=>\`<div class="kpi"><b>\${fmt(n)}</b><span>\${l}</span></div>\`).join('')}
  </div><div class="card"><h2>Moderation by category</h2>
  <table><tr><th>Category</th><th>Actions</th></tr>\${a.by_category.map(c=>\`<tr><td>\${esc(c.category)}</td><td>\${c.n}</td></tr>\`).join('')||'<tr><td colspan=2>None.</td></tr>'}</table></div>\`;
};

ROUTES.logs=async(v)=>{
  const l=await api('/api/logs');
  v.innerHTML=\`<div class="card"><h2>System Logs</h2><p class="sub">Admin actions, groups added/removed, moderation, errors.</p>
  <table><tr><th>When</th><th>Type</th><th>Message</th></tr>
  \${l.map(x=>\`<tr><td>\${esc(x.created_at||'')}</td><td><span class="badge">\${esc(x.type)}</span></td><td>\${esc(x.message)}</td></tr>\`).join('')||'<tr><td colspan=3>No logs.</td></tr>'}</table></div>\`;
};

ROUTES.settings=async(v)=>{
  const s=await api('/api/settings');
  const keys=['gemini_api_key','gemini_model','system_prompt','personal_automation'];
  v.innerHTML=\`<div class="card"><h2>Settings</h2><p class="sub">Stored in D1. Never put secrets in code. The bot token lives in a Worker secret.</p>
  <table><tr><th>Key</th><th>Value</th><th></th></tr>
  \${keys.map(k=>\`<tr><td><code>\${k}</code></td><td>
    \${k==='gemini_api_key'?('<input id="sv_'+k+'" type="password" value="'+esc(s[k]||'')+'"/>'):k==='system_prompt'?('<textarea id="sv_'+k+'">'+esc(s[k]||'')+'</textarea>'):k==='personal_automation'?('<select id="sv_'+k+'"><option '+(s[k]==='on'?'selected':'')+'>on</option><option '+(s[k]!=='on'?'selected':'')+'>off</option></select>'):('<input id="sv_'+k+'" value="'+esc(s[k]||'')+'"/>')}
    </td><td><button class="btn ghost" onclick="setKey('\${k}')">Save</button></td></tr>\`).join('')}
  </table></div>\`;
};
window.setKey=async(k)=>{try{await api('/api/settings',{method:'POST',body:JSON.stringify({key:k,value:$('#sv_'+k).value})});toast('Saved');}catch(err){toast(err.message);}};

navRender();show('dashboard');
</script></body></html>`)
  );

  /* -------------------------------------------- API -------------------------------------------- */

  app.get('/api/stats', async (c) => {
    const one = async (sql: string) => (await c.env.DB.prepare(sql).first<{ n: number }>())?.n || 0;
    return c.json({
      users: await one('SELECT COUNT(*) AS n FROM users'),
      groups: await one('SELECT COUNT(*) AS n FROM groups WHERE enabled = 1'),
      products: await one('SELECT COUNT(*) AS n FROM products WHERE active = 1'),
      products_total: await one('SELECT COUNT(*) AS n FROM products'),
      knowledge: await one('SELECT COUNT(*) AS n FROM knowledge'),
      stickers: await one('SELECT COUNT(*) AS n FROM stickers'),
      moderation: await one('SELECT COUNT(*) AS n FROM moderation_logs'),
    });
  });

  app.get('/api/analytics', async (c) => {
    const byCat = await c.env.DB.prepare(
      'SELECT category, COUNT(*) AS n FROM moderation_logs GROUP BY category ORDER BY n DESC'
    ).all<{ category: string; n: number }>();
    return c.json({ by_category: byCat.results });
  });

  app.get('/api/admins', async (c) => {
    const rows = await c.env.DB.prepare('SELECT user_id, role, created_at FROM admins ORDER BY created_at').all();
    return c.json(rows.results);
  });
  app.post('/api/admins', async (c) => {
    const b = await c.req.json<{ user_id: number; role: string }>();
    if (!b.user_id) return c.json({ error: 'user_id required' }, 400);
    const role = ['super_admin', 'admin', 'moderator'].includes(b.role) ? b.role : 'moderator';
    await c.env.DB.prepare('INSERT OR REPLACE INTO admins (user_id, role, added_by) VALUES (?1, ?2, 0)')
      .bind(b.user_id, role)
      .run();
    await logEvent(c.env, 'admin', `Admin ${b.user_id} added as ${role} via dashboard`);
    return c.json({ ok: true });
  });
  app.delete('/api/admins/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const me = await getUserRole(c.env, id);
    if (me === 'super_admin') return c.json({ error: 'Cannot remove a super admin here' }, 400);
    await c.env.DB.prepare('DELETE FROM admins WHERE user_id = ?1').bind(id).run();
    await logEvent(c.env, 'admin', `Admin ${id} removed via dashboard`);
    return c.json({ ok: true });
  });

  app.get('/api/groups', async (c) => {
    const rows = await c.env.DB.prepare('SELECT id, title, enabled, created_at FROM groups ORDER BY created_at').all<{
      id: number; title: string; enabled: number; created_at: string;
    }>();
    const out = [];
    for (const g of rows.results) {
      const s = await c.env.DB.prepare('SELECT * FROM group_settings WHERE group_id = ?1').bind(g.id).first();
      out.push({ ...g, settings: s || {} });
    }
    return c.json(out);
  });
  app.post('/api/groups', async (c) => {
    const b = await c.req.json<{ id: number; title?: string }>();
    if (!b.id) return c.json({ error: 'group id required' }, 400);
    await c.env.DB.prepare('INSERT OR IGNORE INTO groups (id, title) VALUES (?1, ?2)').bind(b.id, b.title || '').run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO group_settings (group_id) VALUES (?1)').bind(b.id).run();
    await logEvent(c.env, 'group', `Group ${b.id} authorized via dashboard`);
    return c.json({ ok: true });
  });
  app.post('/api/groups/:id/toggle', async (c) => {
    const id = Number(c.req.param('id'));
    const g = await c.env.DB.prepare('SELECT enabled FROM groups WHERE id = ?1').bind(id).first<{ enabled: number }>();
    await c.env.DB.prepare('UPDATE groups SET enabled = ?1 WHERE id = ?2').bind(g?.enabled ? 0 : 1, id).run();
    return c.json({ ok: true });
  });
  app.post('/api/groups/:id/settings', async (c) => {
    const id = Number(c.req.param('id'));
    const b: Record<string, unknown> = await c.req.json();
    const allowed = ['ai_enabled', 'welcome_enabled', 'goodbye_enabled', 'moderation_enabled', 'sticker_enabled', 'products_enabled', 'lang', 'welcome_text', 'goodbye_text'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of Object.keys(b)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = ?${sets.length + 1}`);
      vals.push(typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : String(b[k] ?? ''));
    }
    if (!sets.length) return c.json({ error: 'no valid keys' }, 400);
    await c.env.DB.prepare(
      `INSERT INTO group_settings (group_id, ${allowed.join(', ')}) VALUES (?1, 1,1,1,1,1,1,'','')
       ON CONFLICT(group_id) DO UPDATE SET ${sets.join(', ')}`
    ).bind(id, ...vals).run();
    return c.json({ ok: true });
  });
  app.delete('/api/groups/:id', async (c) => {
    const id = Number(c.req.param('id'));
    await c.env.DB.prepare('DELETE FROM groups WHERE id = ?1').bind(id).run();
    await c.env.DB.prepare('DELETE FROM group_settings WHERE group_id = ?1').bind(id).run();
    await logEvent(c.env, 'group', `Group ${id} removed via dashboard`);
    return c.json({ ok: true });
  });

  app.get('/api/products', async (c) => {
    // Catalog is file-driven (catalog/products.json); dashboard shows it read-only.
    return c.json(getAllCatalog().map((p, i) => ({ id: i + 1, name: p.name, category: p.category, description: p.description, url: p.url, keywords: p.keywords, active: 1 })));
  });
app.get('/api/knowledge', async (c) => {
    const rows = await c.env.DB.prepare('SELECT * FROM knowledge ORDER BY id DESC').all();
    return c.json(rows.results);
  });
  app.post('/api/knowledge', async (c) => {
    const b = await c.req.json();
    if (!b.question || !b.answer) return c.json({ error: 'question and answer required' }, 400);
    await c.env.DB.prepare('INSERT INTO knowledge (question, answer, category, created_by) VALUES (?1,?2,?3,0)')
      .bind(String(b.question), String(b.answer), String(b.category || '')).run();
    return c.json({ ok: true });
  });
  app.delete('/api/knowledge/:id', async (c) => {
    await c.env.DB.prepare('DELETE FROM knowledge WHERE id = ?1').bind(Number(c.req.param('id'))).run();
    return c.json({ ok: true });
  });

  app.get('/api/stickers', async (c) => {
    const rows = await c.env.DB.prepare('SELECT * FROM stickers ORDER BY id DESC').all();
    return c.json(rows.results);
  });
  app.post('/api/stickers', async (c) => {
    const b = await c.req.json();
    if (!b.file_id) return c.json({ error: 'file_id required' }, 400);
    await c.env.DB.prepare('INSERT INTO stickers (file_id, category, label, created_by) VALUES (?1,?2,?3,0)')
      .bind(String(b.file_id), String(b.category || 'reaction'), String(b.label || '')).run();
    return c.json({ ok: true });
  });
  app.delete('/api/stickers/:id', async (c) => {
    await c.env.DB.prepare('DELETE FROM stickers WHERE id = ?1').bind(Number(c.req.param('id'))).run();
    return c.json({ ok: true });
  });

  app.post('/api/settings', async (c) => {
    const b = await c.req.json();
    if (!b.key) return c.json({ error: 'key required' }, 400);
    await setSetting(c.env, String(b.key), String(b.value ?? ''));
    return c.json({ ok: true });
  });
  app.get('/api/settings', async (c) => {
    const rows = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
    const out: Record<string, string> = {};
    rows.results.forEach((r) => (out[r.key] = r.value));
    return c.json(out);
  });

  app.get('/api/logs', async (c) => {
    const rows = await c.env.DB.prepare('SELECT type, message, created_at FROM logs ORDER BY id DESC LIMIT 80').all();
    return c.json(rows.results);
  });
  app.get('/api/moderation', async (c) => {
    const rows = await c.env.DB.prepare(
      'SELECT group_id, user_id, user_name, action, category, created_at FROM moderation_logs ORDER BY id DESC LIMIT 60'
    ).all();
    return c.json(rows.results);
  });
  app.get('/api/broadcasts', async (c) => {
    const rows = await c.env.DB.prepare('SELECT total, success, failed, created_at FROM broadcast_logs ORDER BY id DESC LIMIT 20').all();
    return c.json(rows.results);
  });

  app.post('/api/broadcast', async (c) => {
    const b = await c.req.json<{ text: string; group_id?: number | null }>();
    if (!b.text) return c.json({ error: 'text required' }, 400);
    const tg = new TgClient(c.env.TELEGRAM_BOT_TOKEN);
    const res = await runBroadcast(c.env, tg, b.text, b.group_id || undefined, 0);
    await logEvent(c.env, 'broadcast', `Dashboard broadcast: ${res.success}/${res.total} OK`);
    return c.json(res);
  });

  return app;
}
