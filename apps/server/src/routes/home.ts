import { Hono } from "hono";

// ponytail: single inline HTML, no framework, no build step. Design system
// uses CSS custom properties for consistent spacing/color. Hash-routed SPA.
// OpenRouter-style: zinc palette, Inter font, sidebar nav, dense tables.

const HTML = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Baishui</title>
<style>
:root {
  --bg: #09090b; --bg-card: #18181b; --bg-hover: #27272a; --bg-input: #09090b;
  --border: #27272a; --border-hover: #3f3f46;
  --text: #fafafa; --text-2: #a1a1aa; --text-3: #71717a;
  --accent: #6366f1; --accent-hover: #818cf8; --accent-bg: #6366f11a;
  --green: #22c55e; --green-bg: #22c55e1a; --red: #ef4444; --red-bg: #ef44441a;
  --amber: #f59e0b; --amber-bg: #f59e0b1a;
  --r: 6px; --r-sm: 4px; --r-lg: 8px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  --sidebar-w: 240px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
button{font-family:var(--font);cursor:pointer;border:none;border-radius:var(--r-sm);font-size:13px;font-weight:500;padding:var(--sp-2) var(--sp-3);transition:all .15s}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{background:var(--accent-hover)}
.btn-ghost{background:transparent;color:var(--text-2);border:1px solid var(--border)}.btn-ghost:hover{background:var(--bg-hover);color:var(--text)}
.btn-danger{background:var(--red-bg);color:var(--red);border:1px solid var(--red)} .btn-danger:hover{background:var(--red);color:#fff}
.btn-sm{padding:var(--sp-1) var(--sp-2);font-size:12px}
input,select,textarea{font-family:var(--font);font-size:13px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:var(--sp-2) var(--sp-3);width:100%;outline:none;transition:border .15s}
input:focus{border-color:var(--accent)}
label{display:block;font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:var(--sp-1)}

/* layout */
.app{display:flex;min-height:100vh}
.sidebar{width:var(--sidebar-w);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;height:100vh;z-index:10}
.sidebar-brand{padding:var(--sp-4) var(--sp-6);font-weight:700;font-size:15px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:var(--sp-2)}
.sidebar-brand svg{width:20px;height:20px;color:var(--accent)}
.sidebar-nav{flex:1;padding:var(--sp-3);overflow-y:auto}
.nav-item{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3);border-radius:var(--r-sm);color:var(--text-2);font-size:13px;font-weight:500;cursor:pointer;margin-bottom:2px;transition:all .1s}
.nav-item:hover{background:var(--bg-hover);color:var(--text)}
.nav-item.active{background:var(--accent-bg);color:var(--accent)}
.nav-item svg{width:16px;height:16px;flex-shrink:0}
.nav-section{font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;padding:var(--sp-4) var(--sp-3) var(--sp-1)}
.sidebar-user{padding:var(--sp-3);border-top:1px solid var(--border);display:flex;align-items:center;gap:var(--sp-2);font-size:12px}
.sidebar-user .avatar{width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;color:#fff;flex-shrink:0}
.main{flex:1;margin-left:var(--sidebar-w);min-width:0}
.topbar{height:48px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 var(--sp-6);position:sticky;top:0;background:var(--bg);z-index:5}
.topbar h2{font-size:14px;font-weight:600}
.content{padding:var(--sp-6);max-width:1200px}

/* mobile: sidebar collapses, hamburger in topbar */
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9}
.hamburger{display:none;background:none;border:none;color:var(--text);cursor:pointer;padding:var(--sp-2);margin-right:var(--sp-2)}
.hamburger svg{width:20px;height:20px}
@media(max-width:768px){
  .sidebar{transform:translateX(-100%);transition:transform .2s ease}
  .sidebar.open{transform:translateX(0)}
  .sidebar.open+.sidebar-overlay{display:block}
  .main{margin-left:0}
  .content{padding:var(--sp-3)}
  .topbar{padding:0 var(--sp-3)}
  .hamburger{display:flex;align-items:center}
  .stats-grid{grid-template-columns:1fr 1fr;gap:var(--sp-3)}
  .card-body{padding:var(--sp-2)}
  table{font-size:12px}
  th,td{padding:var(--sp-2)}
  .modal{max-width:calc(100vw - 2rem);padding:var(--sp-4)}
}
@media(max-width:480px){
  .stats-grid{grid-template-columns:1fr}
}

/* cards + tables */
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden}
.card-header{padding:var(--sp-4);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.card-header h3{font-size:13px;font-weight:600}
.card-body{padding:var(--sp-4)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:var(--sp-2) var(--sp-4);font-weight:500;font-size:12px;color:var(--text-2);border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--bg-hover)}
.mono{font-family:var(--mono);font-size:12px}

/* badges */
.badge{display:inline-flex;align-items:center;gap:var(--sp-1);padding:2px var(--sp-2);border-radius:99px;font-size:11px;font-weight:500}
.badge-green{background:var(--green-bg);color:var(--green)}.badge-red{background:var(--red-bg);color:var(--red)}.badge-amber{background:var(--amber-bg);color:var(--amber)}.badge-accent{background:var(--accent-bg);color:var(--accent)}.badge-zinc{background:var(--bg-hover);color:var(--text-2)}
.dot{width:6px;height:6px;border-radius:50%}.dot-green{background:var(--green)}.dot-red{background:var(--red)}.dot-amber{background:var(--amber)}

/* stats */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--sp-4)}
.stat{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:var(--sp-4)}
.stat-label{font-size:12px;color:var(--text-2);font-weight:500}
.stat-value{font-size:24px;font-weight:700;margin-top:var(--sp-1);font-family:var(--mono)}
.stat-sub{font-size:11px;color:var(--text-3);margin-top:var(--sp-1)}

/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;display:flex;align-items:center;justify-content:center}
.modal{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);width:100%;max-width:440px;padding:var(--sp-6)}
.modal h3{font-size:16px;font-weight:600;margin-bottom:var(--sp-4)}
.modal-field{margin-bottom:var(--sp-3)}
.modal-actions{display:flex;gap:var(--sp-2);justify-content:flex-end;margin-top:var(--sp-6)}

/* toast */
.toast{position:fixed;bottom:var(--sp-6);right:var(--sp-6);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r);padding:var(--sp-3) var(--sp-4);font-size:13px;z-index:200;display:flex;align-items:center;gap:var(--sp-2);box-shadow:0 4px 12px rgba(0,0,0,.3)}
.toast.ok{border-color:var(--green)}.toast.err{border-color:var(--red)}

/* misc */
.empty{text-align:center;padding:var(--sp-8);color:var(--text-3)}
.empty svg{width:32px;height:32px;margin-bottom:var(--sp-3);opacity:.5}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.hidden{display:none!important}
.flex{display:flex}.gap-2{gap:var(--sp-2)}.gap-4{gap:var(--sp-4)}.items-center{align-items:center}.justify-between{justify-content:space-between}
.mt-4{margin-top:var(--sp-4)}.mt-6{margin-top:var(--sp-6)}.mb-2{margin-bottom:var(--sp-2)}.mb-4{margin-bottom:var(--sp-4)}
.text-2{color:var(--text-2)}.text-3{color:var(--text-3)}.text-sm{font-size:12px}.text-xs{font-size:11px}
.copy-btn{cursor:pointer;color:var(--text-3);transition:color .15s}.copy-btn:hover{color:var(--text)}
.center-screen{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:var(--sp-6)}
.auth-card{width:100%;max-width:360px}
.auth-header{text-align:center;margin-bottom:var(--sp-6)}
.auth-header h1{font-size:18px;font-weight:700}.auth-header p{font-size:13px;color:var(--text-2);margin-top:var(--sp-1)}
.auth-form .field{margin-bottom:var(--sp-4)}
.auth-footer{margin-top:var(--sp-4);text-align:center;font-size:12px;color:var(--text-3)}
</style>
</head>
<body>

<!-- Auth screens (setup + login) — full-screen, no sidebar -->
<div id="auth-screen" class="center-screen hidden">
  <div class="auth-card">
    <div class="auth-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:32px;height:32px;margin:0 auto var(--sp-3);color:var(--accent)"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      <h1 id="auth-title">Baishui</h1>
      <p id="auth-subtitle">Sign in to continue</p>
    </div>
    <div id="auth-form-container"></div>
  </div>
</div>

<!-- Dashboard shell -->
<div id="app-shell" class="app hidden">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      Baishui
    </div>
    <nav class="sidebar-nav" id="sidebar-nav"></nav>
    <div class="sidebar-user">
      <div class="avatar" id="user-avatar">U</div>
      <div style="overflow:hidden">
        <div id="user-email" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        <div class="text-3 text-xs" id="user-role-label">member</div>
      </div>
    </div>
  </aside>
  <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>
  <div class="main">
    <div class="topbar">
      <div style="display:flex;align-items:center">
        <button class="hamburger" onclick="toggleSidebar()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
        <h2 id="page-title">Overview</h2>
      </div>
      <div id="topbar-actions"></div>
    </div>
    <div class="content" id="page-content"></div>
  </div>
</div>

<!-- toast + modal containers -->
<div id="toast-container"></div>
<div id="modal-container"></div>

<script data-cfasync="false">
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = async (p, o) => { const r = await fetch(p, {headers:{"Content-Type":"application/json"}, ...o}); const b = await r.json().catch(()=>({})); return {ok:r.ok, status:r.status, body:b}; };
const toast = (msg, type="ok") => { const t = document.createElement("div"); t.className = "toast " + type; t.textContent = msg; $("#toast-container").appendChild(t); setTimeout(() => t.remove(), 3000); };
const copy = async (text) => { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); };

// ─── nav items ──────────────────────────────────────────────
const NAV = [
  { id: "overview", label: "Overview", icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>' },
  { id: "requests", label: "Requests", icon: '<path d="M4 4h16v12H4z"/><path d="M4 16l4-4"/><path d="M12 12l4 4"/><path d="M20 16l-4-4"/>' },
  { id: "providers", label: "Providers", icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { id: "loadbalancing", label: "Load Balancing", icon: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
  { id: "routing", label: "Routing", icon: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="12" r="3"/><path d="M6 9v6"/><path d="M6 12h6"/><path d="M12 12l3 0"/>' },
  { id: "keys", label: "API Keys", icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>' },
  { id: "analytics", label: "Analytics", icon: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>' },
  { id: "audit", label: "Audit Log", icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>' },
  { id: "users", label: "Users", icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
];

let currentUser = null;

// ─── bootstrap ──────────────────────────────────────────────
async function bootstrap() {
  try {
    const setup = await api("/api/setup/status");
    if (setup.ok && setup.body.needed) { showSetup(); return; }
    const me = await api("/api/auth/me");
    if (me.ok) { currentUser = me.body.user; showApp(); return; }
    showLogin();
  } catch {
    $("#auth-screen").classList.remove("hidden");
    $("#auth-form-container").innerHTML = '<div class="empty">Backend unreachable. Is the service running?</div>';
  }
}

// ─── auth screens ───────────────────────────────────────────
function showSetup() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  $("#auth-title").textContent = "Create your account";
  $("#auth-subtitle").textContent = "First-run setup. This becomes the owner account.";
  $("#auth-form-container").innerHTML = \`
    <div class="auth-form">
      <div class="field"><label>Email</label><input id="su-email" type="email" autocomplete="email" required></div>
      <div class="field"><label>Display name (optional)</label><input id="su-name" type="text" autocomplete="name"></div>
      <div class="field"><label>Password (min 8 chars)</label><input id="su-pw" type="password" autocomplete="new-password" required></div>
      <div class="field"><label>Confirm password</label><input id="su-pw2" type="password" autocomplete="new-password" required></div>
      <button class="btn-primary" style="width:100%" id="su-btn">Create owner account</button>
      <div id="su-err" class="text-sm" style="color:var(--red);margin-top:var(--sp-2);min-height:1em"></div>
    </div>\`;
  $("#su-btn").onclick = async () => {
    const pw = $("#su-pw").value, pw2 = $("#su-pw2").value;
    if (pw !== pw2) { $("#su-err").textContent = "Passwords do not match"; return; }
    if (pw.length < 8) { $("#su-err").textContent = "Password must be at least 8 characters"; return; }
    $("#su-btn").disabled = true;
    const r = await api("/api/setup", { method: "POST", body: JSON.stringify({ email: $("#su-email").value, name: $("#su-name").value, password: pw }) });
    $("#su-btn").disabled = false;
    if (r.ok) { window.location.href = window.location.pathname + "?t=" + Date.now(); } else $("#su-err").textContent = r.body?.error?.message || "Setup failed";
  };
}

function showLogin() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  $("#auth-title").textContent = "Baishui";
  $("#auth-subtitle").textContent = "Sign in to continue";
  $("#auth-form-container").innerHTML = \`
    <div class="auth-form">
      <div class="field"><label>Email</label><input id="lg-email" type="email" autocomplete="email" required></div>
      <div class="field"><label>Password</label><input id="lg-pw" type="password" autocomplete="current-password" required></div>
      <button class="btn-primary" style="width:100%" id="lg-btn">Sign in</button>
      <a href="/api/auth/github" style="display:block;text-align:center;margin-top:var(--sp-3);font-size:13px;color:var(--text-2)">Sign in with GitHub →</a>
      <div id="lg-err" class="text-sm" style="color:var(--red);margin-top:var(--sp-2);min-height:1em"></div>
    </div>\`;
  $("#lg-btn").onclick = async () => {
    $("#lg-err").textContent = "";
    $("#lg-btn").disabled = true;
    const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("#lg-email").value, password: $("#lg-pw").value }) });
    $("#lg-btn").disabled = false;
    if (r.ok) { window.location.href = window.location.pathname + "?t=" + Date.now(); } else $("#lg-err").textContent = r.body?.error?.message || "Login failed";
  };
}

// ─── app shell ──────────────────────────────────────────────
function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-email").textContent = currentUser.email;
  $("#user-avatar").textContent = currentUser.email[0].toUpperCase();
  $("#user-role-label").textContent = currentUser.role;
  // build nav — hide Users for non-admins
  const navEl = $("#sidebar-nav");
  const items = currentUser.role === "admin" || currentUser.role === "owner" ? NAV : NAV.filter(n => n.id !== "users" && n.id !== "audit");
  navEl.innerHTML = items.map(n => \`
    <div class="nav-item" data-page="\${n.id}" onclick="navigate('\${n.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\${n.icon}</svg>
      \${n.label}
    </div>\`).join("");
  const hash = location.hash.slice(2) || "overview";
  navigate(items.some(n => n.id === hash) ? hash : "overview");
}

window.navigate = (page) => {
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === page));
  location.hash = "#/" + page;
  const titles = { overview: "Overview", requests: "Requests", providers: "Providers", loadbalancing: "Load Balancing", routing: "Routing", keys: "API Keys", analytics: "Analytics", audit: "Audit Log", users: "Users" };
  $("#page-title").textContent = titles[page] || page;
  $("#topbar-actions").innerHTML = "";
  $("#page-content").innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  closeSidebar(); // ponytail: close sidebar on mobile after nav
  ({ overview: renderOverview, requests: renderRequests, providers: renderProviders, loadbalancing: renderLoadBalancing, routing: renderRouting, keys: renderKeys, analytics: renderAnalytics, audit: renderAudit, users: renderUsers }[page] || renderOverview)();
};

window.toggleSidebar = () => { $("#sidebar").classList.toggle("open"); };
window.closeSidebar = () => { $("#sidebar").classList.remove("open"); };

// ─── overview ───────────────────────────────────────────────
async function renderOverview() {
  const [summary, lifetimeStats, providers, keys] = await Promise.all([
    api("/api/analytics/summary").catch(() => ({ ok: false, body: {} })),
    api("/api/requests/stats?range=lifetime").catch(() => ({ ok: false, body: { stats: {} } })),
    api("/api/providers").catch(() => ({ ok: false, body: { providers: [] } })),
    api("/api/keys").catch(() => ({ ok: false, body: { keys: [] } })),
  ]);
  const s = summary.ok ? summary.body.summary : {};
  const lt = lifetimeStats.ok ? (lifetimeStats.body.stats || {}) : {};
  const formatNum = (v) => v !== null && v !== undefined ? Number(v).toLocaleString() : "—";
  const formatCost = (v) => v !== null && v !== undefined && Number(v) > 0 ? "$" + Number(v).toFixed(2) : "—";
  $("#page-content").innerHTML = \`
    <div class="stats-grid mb-4">
      <div class="stat"><div class="stat-label">Requests (24h)</div><div class="stat-value">\${formatNum(s.requests)}</div><div class="stat-sub">total proxied</div></div>
      <div class="stat"><div class="stat-label">Cost (24h)</div><div class="stat-value">\${formatCost(s.cost)}</div><div class="stat-sub">estimated spend</div></div>
      <div class="stat"><div class="stat-label">Total requests</div><div class="stat-value">\${formatNum(lt.total)}</div><div class="stat-sub">all time</div></div>
      <div class="stat"><div class="stat-label">Total cost</div><div class="stat-value" style="color:var(--accent)">\${formatCost(lt.total_cost)}</div><div class="stat-sub">all time</div></div>
      <div class="stat"><div class="stat-label">Input tokens (24h)</div><div class="stat-value">\${formatNum(s.input_tokens)}</div><div class="stat-sub">prompt tokens</div></div>
      <div class="stat"><div class="stat-label">Output tokens (24h)</div><div class="stat-value">\${formatNum(s.output_tokens)}</div><div class="stat-sub">completion tokens</div></div>
      <div class="stat"><div class="stat-label">Errors (24h)</div><div class="stat-value" style="color:\${(s.errors||0) > 0 ? "var(--red)" : "var(--green)"}">\${formatNum(s.errors)}</div><div class="stat-sub">status ≥ 400</div></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Providers</h3><span class="badge badge-zinc">\${providers.ok ? (providers.body.providers || []).length : 0}</span></div>
      <div class="card-body" style="padding:0">
        \${providers.ok && providers.body.providers?.length ? \`
        <table><thead><tr><th>Name</th><th>Type</th><th>Status</th></tr></thead><tbody>
        \${providers.body.providers.map(p => \`<tr><td style="font-weight:500">\${p.name}</td><td class="mono">\${p.type}</td><td>\${p.enabled ? '<span class="badge badge-green"><span class="dot dot-green"></span>active</span>' : '<span class="badge badge-zinc">disabled</span>'}</td></tr>\`).join("")}
        </tbody></table>\` : '<div class="empty">No providers configured. Add one to start proxying.</div>'}
      </div>
    </div>
  \`;
}

// ─── requests (OpenRouter-style log) ────────────────────────
let reqFilter = { errorsOnly: false, offset: 0 };

async function renderRequests() {
  reqFilter = { errorsOnly: false, offset: 0 };
  $("#topbar-actions").innerHTML = '<label style="display:flex;align-items:center;gap:var(--sp-2);font-size:12px;color:var(--text-2);cursor:pointer"><input type="checkbox" id="req-errors-only" style="width:auto" onchange="toggleErrorsOnly()"> Errors only</label>';
  $("#req-errors-only")?.addEventListener("change", () => { reqFilter.errorsOnly = $("#req-errors-only").checked; loadRequests(); });
  await loadRequests();
}

async function loadRequests() {
  $("#page-content").innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  const params = new URLSearchParams({ limit: "50", offset: String(reqFilter.offset) });
  if (reqFilter.errorsOnly) params.set("errors", "true");
  const [reqs, stats] = await Promise.all([
    api("/api/requests?" + params).catch(() => ({ ok: false, body: { requests: [] } })),
    api("/api/requests/stats").catch(() => ({ ok: false, body: { stats: {} } })),
  ]);
  const list = reqs.ok ? (reqs.body.requests || []) : [];
  const s = stats.ok ? (stats.body.stats || {}) : {};
  const fmt = (v) => v !== null && v !== undefined ? Number(v).toLocaleString() : "—";
  const fmtCost = (v) => v !== null && v !== undefined && Number(v) > 0 ? "$" + Number(v).toFixed(2) : "—";
  const fmtTime = (t) => { const d = new Date(t); return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }); };
  const fmtMs = (v) => v !== null && v !== undefined ? v + "ms" : "—";

  // Fetch lifetime stats in parallel
  const ltRes = await api("/api/requests/stats?range=lifetime").catch(() => ({ ok: false, body: { stats: {} } }));
  const lt = ltRes.ok ? (ltRes.body.stats || {}) : {};

  $("#page-content").innerHTML = \`
    <div class="stats-grid mb-4">
      <div class="stat"><div class="stat-label">Total (24h)</div><div class="stat-value">\${fmt(s.total)}</div></div>
      <div class="stat"><div class="stat-label">Successes (24h)</div><div class="stat-value" style="color:var(--green)">\${fmt(s.successes)}</div></div>
      <div class="stat"><div class="stat-label">Errors (24h)</div><div class="stat-value" style="color:\${(s.errors||0)>0?"var(--red)":"var(--green)"}">\${fmt(s.errors)}</div></div>
      <div class="stat"><div class="stat-label">Cost (24h)</div><div class="stat-value">\${fmtCost(s.total_cost)}</div></div>
      <div class="stat"><div class="stat-label">Total requests</div><div class="stat-value">\${fmt(lt.total)}</div><div class="stat-sub">all time</div></div>
      <div class="stat"><div class="stat-label">Total cost</div><div class="stat-value" style="color:var(--accent)">\${fmtCost(lt.total_cost)}</div><div class="stat-sub">all time</div></div>
      <div class="stat"><div class="stat-label">Avg latency</div><div class="stat-value">\${fmtMs(s.avg_latency_ms)}</div></div>
      <div class="stat"><div class="stat-label">Input tokens (24h)</div><div class="stat-value">\${fmt(s.total_input_tokens)}</div></div>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        \${list.length ? \`
        <table style="font-size:12px">
          <thead><tr>
            <th>Time</th><th>Model</th><th>Provider</th><th>Status</th><th>Latency</th>
            <th>In</th><th>Out</th><th>Cost</th><th>Stream</th><th>Error</th>
          </tr></thead>
          <tbody>
          \${list.map(r => {
            const ok = r.status === 200;
            const servedDiff = r.served_by_model && r.served_by_model !== r.model;
            const cost = r.cost_estimate ? "$" + Number(r.cost_estimate).toFixed(4) : "—";
            return \`<tr style="cursor:pointer" onclick="requestDetail('\${r.id}')">
              <td class="mono text-2">\${fmtTime(r.created_at)}</td>
              <td class="mono">\${r.model || "—"}\${servedDiff ? ' <span class="badge badge-amber" title="served via fallback">'+r.served_by_model+'</span>' : ''}</td>
              <td class="text-2">\${r.provider_name || "—"}</td>
              <td><span class="badge badge-\${ok ? 'green' : r.status >= 500 ? 'red' : 'amber'}"><span class="dot dot-\${ok ? 'green' : r.status >= 500 ? 'red' : 'amber'}"></span>\${r.status || "—"}</span></td>
              <td class="mono text-2">\${fmtMs(r.latency_ms)}</td>
              <td class="mono">\${fmt(r.input_tokens)}</td>
              <td class="mono">\${fmt(r.output_tokens)}</td>
              <td class="mono text-2">\${cost}</td>
              <td class="text-2">\${r.stream ? "✓" : ""}</td>
              <td class="text-2" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${(r.error_msg||"").slice(0,200)}">\${r.error_code || ""}</td>
            </tr>\`;
          }).join("")}
          </tbody>
        </table>\` : '<div class="empty">No requests logged yet.</div>'}
      </div>
    </div>
    \${list.length >= 50 ? \`<div style="text-align:center;margin-top:var(--sp-4)"><button class="btn-ghost btn-sm" onclick="loadMoreRequests()">Load more</button></div>\` : ""}
  \`;
}

window.toggleErrorsOnly = () => { reqFilter.errorsOnly = !reqFilter.errorsOnly; loadRequests(); };
window.loadMoreRequests = () => { reqFilter.offset += 50; loadRequests(); };
window.loadRequests = loadRequests;

window.requestDetail = async (id) => {
  const r = await api("/api/requests/" + id);
  if (!r.ok) { toast("Failed to load", "err"); return; }
  const q = r.body.request;
  const fmtTime = (t) => new Date(t).toLocaleString();
  const cost = q.cost_estimate ? "$" + Number(q.cost_estimate).toFixed(6) : "—";
  const ok = q.status === 200;
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:520px">
        <h3>Request #\${q.id}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)">
          <div><div class="text-3 text-xs">Time</div><div class="mono text-sm">\${fmtTime(q.created_at)}</div></div>
          <div><div class="text-3 text-xs">Status</div><span class="badge badge-\${ok?'green':q.status>=500?'red':'amber'}"><span class="dot dot-\${ok?'green':q.status>=500?'red':'amber'}"></span>\${q.status}</span></div>
          <div><div class="text-3 text-xs">Model requested</div><div class="mono text-sm">\${q.model || "—"}</div></div>
          <div><div class="text-3 text-xs">Served by</div><div class="mono text-sm">\${q.served_by_model || "—"}\${q.served_by_model && q.served_by_model !== q.model ? ' <span class="badge badge-amber">fallback</span>' : ''}</div></div>
          <div><div class="text-3 text-xs">Provider</div><div class="text-sm">\${q.provider_name || "—"}</div></div>
          <div><div class="text-3 text-xs">Key</div><div class="text-sm">\${q.key_label || "—"}</div></div>
          <div><div class="text-3 text-xs">Latency</div><div class="mono text-sm">\${q.latency_ms || "—"}ms</div></div>
          <div><div class="text-3 text-xs">Cost</div><div class="mono text-sm">\${cost}</div></div>
          <div><div class="text-3 text-xs">Input tokens</div><div class="mono text-sm">\${q.input_tokens || "—"}</div></div>
          <div><div class="text-3 text-xs">Output tokens</div><div class="mono text-sm">\${q.output_tokens || "—"}</div></div>
          <div><div class="text-3 text-xs">Streaming</div><div class="text-sm">\${q.stream ? "Yes" : "No"}</div></div>
          <div><div class="text-3 text-xs">User</div><div class="text-sm">\${q.user_email || "—"}</div></div>
        </div>
        \${q.error_code || q.error_msg ? \`
          <div style="margin-top:var(--sp-4);padding:var(--sp-3);background:var(--red-bg);border:1px solid var(--red);border-radius:var(--r-sm)">
            <div class="text-xs" style="color:var(--red);font-weight:500">\${q.error_code || "Error"}</div>
            <div class="text-sm text-2" style="margin-top:var(--sp-1);word-break:break-word">\${(q.error_msg||"").slice(0,500)}</div>
          </div>\` : ""}
        <div class="modal-actions"><button class="btn-primary" onclick="closeModal()">Close</button></div>
      </div>
    </div>\`;
};

// ─── providers ──────────────────────────────────────────────
async function renderProviders() {
  const r = await api("/api/providers");
  const list = r.ok ? (r.body.providers || []) : [];
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner";
  if (isAdmin) {
    $("#topbar-actions").innerHTML = '<button class="btn-ghost btn-sm" onclick="exportProviders()">Export</button> <button class="btn-ghost btn-sm" onclick="document.getElementById(\\'import-file\\').click()">Import</button> <input type="file" id="import-file" accept=".json" style="display:none" onchange="importProviders(event)"> <button class="btn-primary btn-sm" id="add-prov-btn">+ Add provider</button>';
    setTimeout(() => { const b = $("#add-prov-btn"); if (b) b.onclick = providerModal; }, 0);
  }
  $("#page-content").innerHTML = \`
    <div class="card">
      <div class="card-body" style="padding:0">
        \${list.length ? \`
        <table><thead><tr><th>Name</th><th>Type</th><th>Base URL</th><th>Keys</th><th>Status</th>\${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>
        \${list.map(p => \`<tr>
          <td style="font-weight:500">\${p.name}</td>
          <td class="mono">\${p.type}</td>
          <td class="mono text-2">\${p.baseUrl || "—"}</td>
          <td><span class="badge badge-zinc" onclick="loadKeys('\${p.id}')" style="cursor:pointer">view keys</span> <span class="badge badge-zinc" onclick="loadModels('\${p.id}')" style="cursor:pointer">view models</span></td>
          <td>\${p.enabled ? '<span class="badge badge-green"><span class="dot dot-green"></span>active</span>' : '<span class="badge badge-zinc">disabled</span>'}</td>
          \${isAdmin ? \`<td><button class="btn-ghost btn-sm" onclick="syncProvider('\${p.id}')">Sync</button> <button class="btn-ghost btn-sm" onclick="scrapePrices('\${p.id}')">Scrape Prices</button> <button class="btn-danger btn-sm" onclick="deleteProvider('\${p.id}')">Delete</button></td>\` : ""}
        </tr>\`).join("")}
        </tbody></table>\` : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>No providers configured.</div>'}
      </div>
    </div>
    <div id="keys-panel" class="mt-4 hidden"></div>
    <div id="models-panel" class="mt-4 hidden"></div>
  \`;
}

window.loadKeys = async (pid) => {
  const r = await api("/api/providers/" + pid + "/keys");
  const keys = r.ok ? (r.body.keys || []) : [];
  $("#keys-panel").classList.remove("hidden");
  $("#keys-panel").innerHTML = \`
    <div class="card"><div class="card-header"><h3>Provider Keys</h3>
    \${currentUser.role === "admin" || currentUser.role === "owner" ? '<button class="btn-primary btn-sm" id="add-key-btn" data-pid="' + pid + '">+ Add key</button>' : ''}
    </div><div class="card-body" style="padding:0">
    \${keys.length ? \`
    <table><thead><tr><th>Label</th><th>Status</th><th>Health</th><th>Added</th><th></th></tr></thead><tbody>
    \${keys.map(k => \`<tr><td style="font-weight:500">\${k.label}</td><td><span class="badge badge-\${k.status === 'active' ? 'green' : 'red'}"><span class="dot dot-\${k.status === 'active' ? 'green' : 'red'}"></span>\${k.status}</span></td><td id="health-\${k.id}" class="text-2 text-xs"><span class="spinner" style="width:12px;height:12px"></span></td><td class="mono text-2">\${new Date(k.addedAt).toLocaleDateString()}</td>\${currentUser.role === "admin" || currentUser.role === "owner" ? \`<td><button class="btn-danger btn-sm" onclick="deleteKey('\${pid}','\${k.id}')">Delete</button></td>\` : ""}</tr>\`).join("")}
    </tbody></table>\` : '<div class="empty">No keys for this provider.</div>'}
    </div></div>\`;
  // Load key health from Redis
  const hr = await api("/api/providers/" + pid + "/health");
  if (hr.ok) {
    (hr.body.keys || []).forEach(h => {
      const el = $("#health-" + h.id);
      if (!el) return;
      if (h.healthy) {
        el.innerHTML = '<span class="badge badge-green"><span class="dot dot-green"></span>healthy</span>' + (h.inflight > 0 ? ' <span class="text-3">' + h.inflight + ' inflight</span>' : '');
      } else if (h.circuitOpen) {
        el.innerHTML = '<span class="badge badge-red"><span class="dot dot-red"></span>circuit open</span>';
      } else if (h.cooldownMs > 0) {
        const secs = Math.ceil(h.cooldownMs / 1000);
        el.innerHTML = '<span class="badge badge-amber"><span class="dot dot-amber"></span>cooldown ' + secs + 's</span>';
      } else {
        el.innerHTML = '<span class="badge badge-zinc">idle</span>';
      }
    });
  }
  const addKeyBtn = $("#add-key-btn");
  if (addKeyBtn) addKeyBtn.onclick = () => keyModal(addKeyBtn.dataset.pid);
};

let modelCache = [];
let modelCachePid = null;

window.loadModels = async (pid) => {
  modelCachePid = pid;
  const r = await api("/api/providers/" + pid + "/models");
  modelCache = r.ok ? (r.body.models || []) : [];
  renderModelsTable();
};

function renderModelsTable() {
  const pid = modelCachePid;
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner";
  const search = ($("#model-search")?.value || "").toLowerCase();
  const filtered = search ? modelCache.filter(m => m.displayName.toLowerCase().includes(search)) : modelCache;
  $("#models-panel").classList.remove("hidden");
  $("#keys-panel").classList.add("hidden");
  $("#models-panel").innerHTML = \`
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:var(--sp-2)">
        <h3>Models (\${filtered.length}\${search ? ' of ' + modelCache.length : ''})</h3>
        \${isAdmin && filtered.length > 0 ? \`
          <div style="display:flex;gap:var(--sp-2);align-items:center">
            <button class="btn-ghost btn-sm" onclick="bulkToggle(true)">Enable filtered</button>
            <button class="btn-ghost btn-sm" onclick="bulkToggle(false)">Disable filtered</button>
          </div>\` : ''}
      </div>
      <div style="padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border)">
        <input id="model-search" type="text" placeholder="Search models..." value="\${search}" oninput="renderModelsTable()">
      </div>
      <div class="card-body" style="padding:0;max-height:500px;overflow-y:auto">
        \${filtered.length ? \`
        <table><thead><tr><th>Model</th><th>Enabled</th><th>Input $/1M</th><th>Output $/1M</th><th>Last synced</th>\${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>
        \${filtered.map(m => \`<tr id="model-row-\${m.id}" style="\${!m.enabled ? 'opacity:0.5' : ''}">
          <td class="mono" style="font-weight:500">\${m.displayName}</td>
          <td>
            <label style="display:inline-flex;align-items:center;cursor:\${isAdmin?'pointer':'default'};gap:0">
              <input type="checkbox" id="toggle-\${m.id}" style="display:none" \${m.enabled?'checked':''} \${isAdmin?'':'disabled'} onchange="toggleModel('\${m.id}')">
              <span style="position:relative;width:32px;height:18px;background:\${m.enabled?'var(--green)':'var(--border)'};border-radius:99px;transition:background .15s;display:inline-block">
                <span style="position:absolute;top:2px;left:\${m.enabled?'16px':'2px'};width:14px;height:14px;background:#fff;border-radius:50%;transition:left .15s"></span>
              </span>
            </label>
          </td>
          <td class="mono text-2">\${m.inputPricePer1m || "—"}</td>
          <td class="mono text-2">\${m.outputPricePer1m || "—"}</td>
          <td class="mono text-2">\${m.lastSyncedAt ? new Date(m.lastSyncedAt).toLocaleDateString() : "—"}</td>
          \${isAdmin ? \`<td><button class="btn-ghost btn-sm" id="edit-\${m.id}" data-mid="\${m.id}">Edit prices</button></td>\` : ""}
        </tr>\`).join("")}
        </tbody></table>\` : '<div class="empty">No models found. Click Sync on the provider to fetch models.</div>'}
      </div>
    </div>\`;
  // Wire up edit buttons
  if (isAdmin) {
    filtered.forEach(m => {
      const btn = $("#edit-" + m.id);
      if (btn) btn.onclick = () => modelEditModal(pid, m.id, m);
    });
  }
  // Restore focus to search
  const searchEl = $("#model-search");
  if (searchEl && document.activeElement !== searchEl && search) {
    searchEl.focus();
    searchEl.setSelectionRange(search.length, search.length);
  }
}

window.toggleModel = async (mid) => {
  const m = modelCache.find(x => x.id === mid);
  if (!m) return;
  const newEnabled = !m.enabled;
  const r = await api("/api/providers/" + modelCachePid + "/models/" + mid, { method: "PATCH", body: JSON.stringify({ enabled: newEnabled }) });
  if (r.ok) {
    m.enabled = newEnabled;
    renderModelsTable();
  } else {
    toast(r.body?.error?.message || "Failed", "err");
    renderModelsTable();
  }
};

window.bulkToggle = async (enabled) => {
  const search = ($("#model-search")?.value || "").toLowerCase();
  const filtered = search ? modelCache.filter(m => m.displayName.toLowerCase().includes(search)) : modelCache;
  const ids = filtered.map(m => m.id);
  if (ids.length === 0) return;
  const r = await api("/api/providers/" + modelCachePid + "/models/bulk/enabled", { method: "PATCH", body: JSON.stringify({ modelIds: ids, enabled }) });
  if (r.ok) {
    filtered.forEach(m => m.enabled = enabled);
    renderModelsTable();
    toast((enabled ? "Enabled " : "Disabled ") + (r.body.updated ?? ids.length) + " models");
  } else {
    toast(r.body?.error?.message || "Failed", "err");
  }
};

window.modelEditModal = (pid, mid, m) => {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Edit: \${m.upstreamId}</h3>
        <div class="modal-field"><label>Display name (what clients request as "model")</label><input id="me-display-name" placeholder="\${m.upstreamId}" value="\${m.displayName || ''}"></div>
        <div class="text-3 text-xs mb-4" style="margin-top:-var(--sp-2)">Rename to match across providers for auto-fallback. Upstream ID stays "\${m.upstreamId}".</div>
        <div class="modal-field"><label>Input price per 1M tokens ($)</label><input id="me-input-price" type="number" step="0.000001" placeholder="5.00" value="\${m.inputPricePer1m || ''}"></div>
        <div class="modal-field"><label>Output price per 1M tokens ($)</label><input id="me-output-price" type="number" step="0.000001" placeholder="15.00" value="\${m.outputPricePer1m || ''}"></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" onclick="saveModel('\${pid}','\${mid}')">Save</button></div>
      </div>
    </div>\`;
};

window.saveModel = async (pid, mid) => {
  const updates = {
    displayName: $("#me-display-name").value || undefined,
    inputPricePer1m: $("#me-input-price").value || null,
    outputPricePer1m: $("#me-output-price").value || null,
  };
  const r = await api("/api/providers/" + pid + "/models/" + mid, { method: "PATCH", body: JSON.stringify(updates) });
  if (r.ok) {
    const m = modelCache.find(x => x.id === mid);
    if (m) { if (updates.displayName) m.displayName = updates.displayName; m.inputPricePer1m = updates.inputPricePer1m; m.outputPricePer1m = updates.outputPricePer1m; }
    closeModal();
    toast("Model updated");
    renderModelsTable();
  } else toast(r.body?.error?.message || "Failed", "err");
};

window.providerModal = () => {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Add provider</h3>
        <div class="modal-field"><label>Name</label><input id="pv-name" placeholder="OpenAI"></div>
        <div class="modal-field"><label>Type</label>
          <select id="pv-type"><option value="openai_compatible">OpenAI-compatible</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="mistral">Mistral</option><option value="together">Together</option><option value="groq">Groq</option><option value="deepseek">DeepSeek</option><option value="custom">Custom</option></select>
        </div>
        <div class="modal-field"><label>Base URL</label><input id="pv-url" placeholder="https://api.openai.com"></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" onclick="createProvider()">Create</button></div>
      </div>
    </div>\`;
};

window.createProvider = async () => {
  const r = await api("/api/providers", { method: "POST", body: JSON.stringify({ name: $("#pv-name").value, type: $("#pv-type").value, baseUrl: $("#pv-url").value }) });
  if (r.ok) { closeModal(); toast("Provider created"); navigate("providers"); } else toast(r.body?.error?.message || "Failed", "err");
};

window.deleteProvider = async (id) => {
  if (!confirm("Delete this provider and all its keys/models?")) return;
  const r = await api("/api/providers/" + id, { method: "DELETE" });
  if (r.ok) { toast("Provider deleted"); navigate("providers"); } else toast("Failed", "err");
};

window.syncProvider = async (id) => {
  toast("Syncing models...");
  const r = await api("/api/providers/" + id + "/sync", { method: "POST" });
  if (r.ok) toast("Synced: +" + r.body.sync.added + " new, " + r.body.sync.updated + " updated (prices auto-extracted)"); else toast(r.body?.error?.message || "Sync failed", "err");
};

window.scrapePrices = async (id) => {
  toast("Scraping prices...");
  const r = await api("/api/providers/" + id + "/scrape-prices", { method: "POST" });
  if (r.ok) toast("Prices: " + r.body.scraped + " found (" + r.body.fromAPI + " from API, " + r.body.fromTable + " from table, " + r.body.unknown + " unknown)"); else toast("Failed", "err");
};

window.keyModal = (pid) => {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Add provider key</h3>
        <div class="modal-field"><label>Label</label><input id="pk-label" placeholder="production"></div>
        <div class="modal-field"><label>Secret (API key)</label><input id="pk-secret" type="password" placeholder="sk-..."></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" onclick="createKey('\${pid}')">Add key</button></div>
      </div>
    </div>\`;
};

window.createKey = async (pid) => {
  const r = await api("/api/providers/" + pid + "/keys", { method: "POST", body: JSON.stringify({ secret: $("#pk-secret").value, label: $("#pk-label").value || "default" }) });
  if (r.ok) { closeModal(); toast("Key added"); loadKeys(pid); } else toast(r.body?.error?.message || "Failed", "err");
};

window.deleteKey = async (pid, kid) => {
  if (!confirm("Delete this key?")) return;
  const r = await api("/api/providers/" + pid + "/keys/" + kid, { method: "DELETE" });
  if (r.ok) { toast("Key deleted"); loadKeys(pid); } else toast("Failed", "err");
};

window.closeModal = () => { $("#modal-container").innerHTML = ""; };

// ─── import / export providers ──────────────────────────────
window.exportProviders = async () => {
  const r = await api("/api/providers/export/all");
  if (!r.ok) { toast("Export failed", "err"); return; }
  const blob = new Blob([JSON.stringify(r.body, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "baishui-providers.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Providers exported");
};

window.importProviders = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { toast("Invalid JSON file", "err"); return; }
  if (!confirm("Import " + (data.providers?.length || 0) + " providers? This will update existing providers by name and create new ones. Secrets are NOT imported.")) return;
  const r = await api("/api/providers/import/all", { method: "POST", body: JSON.stringify(data) });
  if (r.ok) {
    const i = r.body.import;
    toast("Imported: +" + i.providersAdded + " providers, ~" + i.modelsAdded + " models");
    navigate("providers");
  } else toast(r.body?.error?.message || "Import failed", "err");
  event.target.value = ""; // reset file input
};

// ─── load balancing dashboard ───────────────────────────────
async function renderLoadBalancing() {
  $("#page-content").innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  const r = await api("/api/loadbalancing");
  const list = r.ok ? (r.body.models || []) : [];
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner";

  $("#page-content").innerHTML = \`
    <div class="card" style="margin-bottom:var(--sp-4)">
      <div class="card-body">
        <div class="text-2 text-sm" style="margin-bottom:var(--sp-2)">Load Balancing Strategy</div>
        <div class="text-3 text-xs">Models that exist on multiple providers can use <b>failover</b> (try provider 1, fall back to 2 on error) or <b>round-robin</b> (distribute evenly across all healthy providers). Round-robin within a provider's keys is always active.</div>
      </div>
    </div>
    \${list.length ? list.map(m => \`
    <div class="card" style="margin-bottom:var(--sp-4)">
      <div class="card-header">
        <h3>\${m.model}</h3>
        <div style="display:flex;align-items:center;gap:var(--sp-3)">
          <span class="badge badge-zinc">\${m.providerCount} provider\${m.providerCount > 1 ? 's' : ''}</span>
          \${isAdmin && m.providerCount > 1 ? \`
            <select id="lb-strat-\${m.model}" onchange="setLBStrategy('\${m.model}', this.value)" style="width:auto;padding:4px 8px;font-size:12px">
              <option value="failover" \${m.strategy === 'failover' ? 'selected' : ''}>Failover</option>
              <option value="round_robin" \${m.strategy === 'round_robin' ? 'selected' : ''}>Round-robin</option>
            </select>\` : '<span class="badge badge-accent">' + m.strategy + '</span>'}
        </div>
      </div>
      <div class="card-body" style="padding:0">
        <table><thead><tr><th>Provider</th><th>Upstream ID</th><th>Keys</th><th>Requests (24h)</th><th>Key Health</th></tr></thead><tbody>
        \${m.providers.map((p, i) => \`
          <tr>
            <td style="font-weight:500">\${p.providerName}</td>
            <td class="mono text-2">\${(m.upstreamIds || [])[i] || '—'}</td>
            <td>\${p.keyCount}</td>
            <td class="mono">\${p.requests}</td>
            <td>
              \${p.keys.length ? p.keys.map(k => {
                const cls = k.healthy ? 'green' : k.circuitOpen ? 'red' : k.cooldownMs > 0 ? 'amber' : 'zinc';
                const label = k.healthy ? 'healthy' + (k.inflight > 0 ? ' (' + k.inflight + ' inflight)' : '') : k.circuitOpen ? 'circuit open' : k.cooldownMs > 0 ? 'cooldown ' + Math.ceil(k.cooldownMs/1000) + 's' : 'idle';
                return '<span class="badge badge-' + cls + '" style="margin-right:4px"><span class="dot dot-' + cls + '"></span>' + k.label + ': ' + label + '</span>';
              }).join('') : '<span class="text-3">no keys</span>'}
            </td>
          </tr>\`).join("")}
        </tbody></table>
      </div>
    </div>\`).join("") : '<div class="empty">No models found. Add providers and sync models to see load balancing options.</div>'}
  \`;
}

window.setLBStrategy = async (model, strategy) => {
  const r = await api("/api/loadbalancing/strategy", { method: "PATCH", body: JSON.stringify({ model, strategy }) });
  if (r.ok) toast("Strategy set: " + strategy); else toast("Failed", "err");
};

// ─── routing (cross-provider fallback chains) ──────────────
async function renderRouting() {
  const [routesRes, modelsRes] = await Promise.all([
    api("/api/routes").catch(() => ({ ok: false, body: { routes: [] } })),
    api("/api/routes/models").catch(() => ({ ok: false, body: { models: [] } })),
  ]);
  const routes = routesRes.ok ? (routesRes.body.routes || []) : [];
  const allModels = modelsRes.ok ? (modelsRes.body.models || []) : [];
  const isAdmin = currentUser.role === "admin" || currentUser.role === "owner";
  if (isAdmin) {
    $("#topbar-actions").innerHTML = '<button class="btn-primary btn-sm" id="add-route-btn">+ Add route</button>';
    setTimeout(() => { const b = $("#add-route-btn"); if (b) b.onclick = () => routeModal(allModels); }, 0);
  }
  $("#page-content").innerHTML = \`
    <div class="card"><div class="card-body" style="padding:0">
    \${routes.length ? \`
    <table><thead><tr><th>Alias</th><th>Primary</th><th>Fallbacks</th><th>Status</th>\${isAdmin ? "<th></th>" : ""}</tr></thead><tbody>
    \${routes.map(r => \`<tr>
      <td class="mono" style="font-weight:500">\${r.alias}</td>
      <td><span class="mono">\${r.primary.model}</span> <span class="text-3 text-xs">via \${r.primary.provider}</span></td>
      <td>\${r.fallbacks.map((f,i) => '<div class="text-sm"><span class="text-3">#'+(i+1)+'</span> <span class="mono">'+f.model+'</span> <span class="text-3 text-xs">via '+f.provider+'</span></div>').join("") || '<span class="text-3">none</span>'}</td>
      <td>\${r.enabled ? '<span class="badge badge-green"><span class="dot dot-green"></span>active</span>' : '<span class="badge badge-zinc">disabled</span>'}</td>
      \${isAdmin ? \`<td><button class="btn-danger btn-sm" onclick="deleteRoute('\${r.id}')">Delete</button></td>\` : ""}
    </tr>\`).join("")}
    </tbody></table>\` : '<div class="empty">No routes configured. Create one to enable cross-provider fallback.</div>'}
    </div></div>
  \`;
}

window.routeModal = (allModels) => {
  const modelOpts = allModels.map(m => '<option value="' + m.id + '">' + m.displayName + ' (' + m.providerName + ')</option>').join("");
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:560px">
        <h3>Create route</h3>
        <div class="modal-field"><label>Alias (what clients send as "model")</label><input id="rt-alias" placeholder="smart-model"></div>
        <div class="modal-field"><label>Primary model</label><select id="rt-primary">\${modelOpts}</select></div>
        <div class="modal-field"><label>Fallback chain (optional — try in order if primary fails)</label>
          <div id="rt-fallbacks"></div>
          <button class="btn-ghost btn-sm mt-4" id="rt-add-fallback">+ Add fallback</button>
        </div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="rt-create">Create</button></div>
      </div>
    </div>\`;
  let fbList = [];
  const updateFallbacks = () => {
    $("#rt-fallbacks").innerHTML = fbList.map((f, i) => \`
      <div class="flex gap-2 items-center mb-2">
        <span class="text-3 text-xs" style="min-width:20px">#\${i+2}</span>
        <select id="rt-fb-\${i}" style="flex:1">\${modelOpts}</select>
        <button class="btn-ghost btn-sm" onclick="fbList.splice(\${i},1);updateFallbacks()">✕</button>
      </div>\`).join("");
  };
  $("#rt-add-fallback").onclick = () => { fbList.push(""); updateFallbacks(); };
  $("#rt-create").onclick = async () => {
    const alias = $("#rt-alias").value;
    const primaryModelId = $("#rt-primary").value;
    const fallbackChain = fbList.map((_, i) => {
      const sel = $("#rt-fb-" + i);
      return { modelId: sel.value, priority: i + 1 };
    });
    const r = await api("/api/routes", { method: "POST", body: JSON.stringify({ alias, primaryModelId, fallbackChain }) });
    if (r.ok) { closeModal(); toast("Route created"); navigate("routing"); } else toast(r.body?.error?.message || "Failed", "err");
  };
};

window.deleteRoute = async (id) => {
  if (!confirm("Delete this route?")) return;
  const r = await api("/api/routes/" + id, { method: "DELETE" });
  if (r.ok) { toast("Route deleted"); navigate("routing"); } else toast("Failed", "err");
};

// ─── API keys ───────────────────────────────────────────────
async function renderKeys() {
  const r = await api("/api/keys");
  const list = r.ok ? (r.body.keys || []) : [];
  $("#topbar-actions").innerHTML = '<button class="btn-primary btn-sm" id="create-key-btn">+ Create key</button>';
  setTimeout(() => { const b = $("#create-key-btn"); if (b) b.onclick = keyCreateModal; }, 0);
  const fmtLimit = (v) => v !== null && v !== undefined ? v : "∞";
  $("#page-content").innerHTML = \`
    <div class="card"><div class="card-body" style="padding:0">
    \${list.length ? \`
    <table><thead><tr><th>Name</th><th>Prefix</th><th>RPM</th><th>Tokens/day</th><th>Cost/day</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>
    \${list.map(k => \`<tr>
      <td style="font-weight:500">\${k.name || "—"}</td>
      <td class="mono">\${k.keyPrefix}</td>
      <td class="mono text-2">\${fmtLimit(k.rateLimitRpm)}</td>
      <td class="mono text-2">\${fmtLimit(k.tokenLimitDaily)}</td>
      <td class="mono text-2">\${k.costLimitDaily ? "$" + Number(k.costLimitDaily).toFixed(2) : "∞"}</td>
      <td class="mono text-2">\${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "never"}</td>
      <td>\${k.revokedAt ? '<span class="badge badge-red"><span class="dot dot-red"></span>revoked</span>' : '<span class="badge badge-green"><span class="dot dot-green"></span>active</span>'}</td>
      <td>\${k.revokedAt ? "" : \`<button class="btn-ghost btn-sm" id="edit-key-\${k.id}" data-kid="\${k.id}">Edit</button> <button class="btn-danger btn-sm" onclick="revokeKey('\${k.id}')">Revoke</button>\`}</td>
    </tr>\`).join("")}
    </tbody></table>\` : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>No API keys yet. Create one to use the proxy.</div>'}
    </div></div>
  \`;
  // wire up edit buttons
  list.forEach(k => {
    const btn = $("#edit-key-" + k.id);
    if (btn) btn.onclick = () => keyEditModal(k);
  });
}

function keyCreateModal() {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Create API key</h3>
        <div class="modal-field"><label>Key name (optional)</label><input id="ck-name" placeholder="ci-bot"></div>
        <div class="modal-field"><label>Rate limit (requests/min) — blank = unlimited</label><input id="ck-rpm" type="number" placeholder="100"></div>
        <div class="modal-field"><label>Daily token limit — blank = unlimited</label><input id="ck-tokens" type="number" placeholder="100000"></div>
        <div class="modal-field"><label>Daily cost limit ($) — blank = unlimited</label><input id="ck-cost" type="number" step="0.01" placeholder="5.00"></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="ck-create">Create</button></div>
      </div>
    </div>\`;
  $("#ck-create").onclick = async () => {
    const body = {
      name: $("#ck-name").value || undefined,
      rateLimitRpm: $("#ck-rpm").value ? Number($("#ck-rpm").value) : null,
      tokenLimitDaily: $("#ck-tokens").value ? Number($("#ck-tokens").value) : null,
      costLimitDaily: $("#ck-cost").value ? $("#ck-cost").value : null,
    };
    const r = await api("/api/keys", { method: "POST", body: JSON.stringify(body) });
    if (r.ok && r.body.key) {
      closeModal();
      $("#modal-container").innerHTML = \`
        <div class="modal-bg" onclick="if(event.target===this)closeModal()">
          <div class="modal">
            <h3>API key created</h3>
            <p class="text-2 text-sm mb-4">Copy this key now — it won't be shown again.</p>
            <div class="flex gap-2 items-center mb-4" style="background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r-sm);padding:var(--sp-3)">
              <code class="mono" style="flex:1;word-break:break-all;font-size:12px">\${r.body.key}</code>
              <span class="copy-btn" onclick="copy('\${r.body.key}')">📋</span>
            </div>
            <div class="modal-actions"><button class="btn-primary" onclick="closeModal();navigate('keys')">Done</button></div>
          </div>
        </div>\`;
    } else toast(r.body?.error?.message || "Failed", "err");
  };
}

function keyEditModal(k) {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Edit key: \${k.name || k.keyPrefix}</h3>
        <div class="modal-field"><label>Rate limit (requests/min) — blank = unlimited</label><input id="ek-rpm" type="number" value="\${k.rateLimitRpm ?? ''}"></div>
        <div class="modal-field"><label>Daily token limit — blank = unlimited</label><input id="ek-tokens" type="number" value="\${k.tokenLimitDaily ?? ''}"></div>
        <div class="modal-field"><label>Daily cost limit ($) — blank = unlimited</label><input id="ek-cost" type="number" step="0.01" value="\${k.costLimitDaily ?? ''}"></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" id="ek-save">Save</button></div>
      </div>
    </div>\`;
  $("#ek-save").onclick = async () => {
    const body = {
      rateLimitRpm: $("#ek-rpm").value ? Number($("#ek-rpm").value) : null,
      tokenLimitDaily: $("#ek-tokens").value ? Number($("#ek-tokens").value) : null,
      costLimitDaily: $("#ek-cost").value ? $("#ek-cost").value : null,
    };
    const r = await api("/api/keys/" + k.id, { method: "PATCH", body: JSON.stringify(body) });
    if (r.ok) { closeModal(); toast("Limits updated"); navigate("keys"); } else toast("Failed", "err");
  };
}

window.revokeKey = async (id) => {
  if (!confirm("Revoke this API key? This cannot be undone.")) return;
  const r = await api("/api/keys/" + id, { method: "DELETE" });
  if (r.ok) { toast("Key revoked"); navigate("keys"); } else toast("Failed", "err");
};

// ─── analytics ──────────────────────────────────────────────
async function renderAnalytics() {
  const [summary, byModel] = await Promise.all([
    api("/api/analytics/summary").catch(() => ({ ok: false, body: {} })),
    api("/api/analytics/by-model").catch(() => ({ ok: false, body: {} })),
  ]);
  const s = summary.ok ? summary.body.summary : {};
  const models = byModel.ok ? (byModel.body.by_model || []) : [];
  const fmt = (v) => v !== null && v !== undefined ? Number(v).toLocaleString() : "—";
  $("#page-content").innerHTML = \`
    <div class="stats-grid mb-4">
      <div class="stat"><div class="stat-label">Requests</div><div class="stat-value">\${fmt(s.requests)}</div></div>
      <div class="stat"><div class="stat-label">Input tokens</div><div class="stat-value">\${fmt(s.input_tokens)}</div></div>
      <div class="stat"><div class="stat-label">Output tokens</div><div class="stat-value">\${fmt(s.output_tokens)}</div></div>
      <div class="stat"><div class="stat-label">Errors</div><div class="stat-value" style="color:\${(s.errors||0)>0?"var(--red)":"var(--green)"}">\${fmt(s.errors)}</div></div>
    </div>
    <div class="card"><div class="card-header"><h3>By Model</h3></div><div class="card-body" style="padding:0">
    \${models.length ? \`
    <table><thead><tr><th>Model</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th></tr></thead><tbody>
    \${models.map(m => \`<tr><td class="mono">\${m.model || "unknown"}</td><td>\${fmt(m.requests)}</td><td>\${fmt(m.input_tokens)}</td><td>\${fmt(m.output_tokens)}</td></tr>\`).join("")}
    </tbody></table>\` : '<div class="empty">No data yet.</div>'}
    </div></div>\`;
}

// ─── audit ──────────────────────────────────────────────────
async function renderAudit() {
  const r = await api("/api/audit?limit=100");
  const entries = r.ok ? (r.body.entries || []) : [];
  $("#page-content").innerHTML = \`
    <div class="card"><div class="card-body" style="padding:0">
    \${entries.length ? \`
    <table><thead><tr><th>Action</th><th>Target</th><th>Time</th></tr></thead><tbody>
    \${entries.map(e => \`<tr><td class="mono">\${e.action}</td><td class="text-2">\${e.targetType || "—"} \${e.targetId ? e.targetId.slice(0,8) : ""}</td><td class="mono text-2">\${new Date(e.createdAt).toLocaleString()}</td></tr>\`).join("")}
    </tbody></table>\` : '<div class="empty">No audit entries.</div>'}
    </div></div>\`;
}

// ─── users ──────────────────────────────────────────────────
async function renderUsers() {
  const r = await api("/api/users");
  if (!r.ok) { $("#page-content").innerHTML = '<div class="empty">You do not have access to user management.</div>'; return; }
  const list = r.body.users || [];
  $("#topbar-actions").innerHTML = '<button class="btn-primary btn-sm" onclick="userModal()">+ Add user</button>';
  $("#page-content").innerHTML = \`
    <div class="card"><div class="card-body" style="padding:0">
    <table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Last login</th><th></th></tr></thead><tbody>
    \${list.map(u => \`<tr>
      <td style="font-weight:500">\${u.email}</td>
      <td class="text-2">\${u.name || "—"}</td>
      <td><span class="badge badge-\${u.role === 'owner' ? 'accent' : u.role === 'admin' ? 'green' : 'zinc'}">\${u.role}</span></td>
      <td class="mono text-2">\${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "never"}</td>
      <td>\${u.role !== "owner" && u.id !== currentUser.id ? '<button class="btn-danger btn-sm" onclick="deleteUser(\\'' + u.id + '\\')">Delete</button>' : ""}</td>
    </tr>\`).join("")}
    </tbody></table>
    </div></div>\`;
}

window.userModal = () => {
  $("#modal-container").innerHTML = \`
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>Add user</h3>
        <div class="modal-field"><label>Email</label><input id="us-email" type="email"></div>
        <div class="modal-field"><label>Name</label><input id="us-name"></div>
        <div class="modal-field"><label>Role</label><select id="us-role"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>
        <div class="modal-field"><label>Temp password (min 8 chars)</label><input id="us-pw" type="password"></div>
        <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button><button class="btn-primary" onclick="createUser()">Create</button></div>
      </div>
    </div>\`;
};

window.createUser = async () => {
  const r = await api("/api/users", { method: "POST", body: JSON.stringify({ email: $("#us-email").value, name: $("#us-name").value, role: $("#us-role").value, password: $("#us-pw").value }) });
  if (r.ok) { closeModal(); toast("User created"); navigate("users"); } else toast(r.body?.error?.message || "Failed", "err");
};

window.deleteUser = async (id) => {
  if (!confirm("Delete this user? All their sessions and API keys will be revoked.")) return;
  const r = await api("/api/users/" + id, { method: "DELETE" });
  if (r.ok) { toast("User deleted"); navigate("users"); } else toast(r.body?.error?.message || "Failed", "err");
};

// ─── logout ─────────────────────────────────────────────────
// ponytail: logout is a sidebar action, not a nav page
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

bootstrap();
</script>
</body>
</html>`;

export function homeRoutes(): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return c.html(HTML);
  });
  return app;
}