// Gastherm Service — εφαρμογή πελατών, εγκαταστάσεων και συντηρήσεων
// Supabase (βάση, λογαριασμοί, ζωντανός συγχρονισμός) + Leaflet/OpenStreetMap (χάρτης)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm';

const VERSION = '1.0.0';

/* =====================================================================
   Ρυθμίσεις και σταθερές
   ===================================================================== */
const C = Object.assign({
  appName: 'Gastherm Service',
  companyName: 'Gastherm',
  mapCenter: [39.6390, 22.4191],
  mapZoom: 10,
  base: null,
  soonDays: 30,
  categories: ['Φυσικό αέριο', 'Υγραέριο (LPG)', 'Πετρέλαιο', 'Αντλία θερμότητας', 'Κλιματισμός', 'Άλλο']
}, window.APP_CONFIG || {});

const TABLES = ['profiles', 'customers', 'installations', 'visits'];
const KINDS = { maintenance: 'Συντήρηση', inspection: 'Μέτρηση καυσαερίων', repair: 'Βλάβη', installation: 'Εγκατάσταση', other: 'Άλλο' };
const RESETS = ['maintenance', 'inspection', 'installation']; // είδη που μηδενίζουν τον μετρητή συντήρησης
const VSTATUS = { scheduled: 'Προγραμματισμένη', done: 'Ολοκληρώθηκε', cancelled: 'Ακυρώθηκε' };
const ISTATUS = { overdue: 'Εκπρόθεσμη', soon: 'Λήγει σύντομα', scheduled: 'Έχει ραντεβού', ok: 'Εντάξει', none: 'Χωρίς ημερομηνία', inactive: 'Ανενεργή' };
const RANK = { overdue: 0, soon: 1, scheduled: 2, none: 3, ok: 4, inactive: 5 };
const TECH_COLORS = [['#1D55D6', 'Μπλε'], ['#0F8A7A', 'Πετρόλ'], ['#7C4DCC', 'Μωβ'], ['#C2410C', 'Πορτοκαλί'], ['#B4237A', 'Ματζέντα'], ['#3F7D20', 'Πράσινο'], ['#5B6475', 'Γκρι']];
const MEAS = [
  ['co_ppm', 'CO', 'ppm'], ['co2_pct', 'CO₂', '%'], ['o2_pct', 'O₂', '%'],
  ['flue_c', 'Θερμ. καυσαερίων', '°C'], ['eff_pct', 'Απόδοση', '%'], ['draft_pa', 'Ελκυσμός', 'Pa']
];
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/* =====================================================================
   Βοηθητικά
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => toISO(new Date());
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const addMonths = (iso, n) => {
  const d = parseISO(iso); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + Number(n));
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
};
const diffDays = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const fDate = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
const fDay = new Intl.DateTimeFormat('el-GR', { weekday: 'short', day: 'numeric', month: 'short' });
const fLong = new Intl.DateTimeFormat('el-GR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fMonth = new Intl.DateTimeFormat('el-GR', { month: 'long', year: 'numeric' });
const fStamp = new Intl.DateTimeFormat('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDate = iso => iso ? fDate.format(parseISO(iso)) : '—';
const fmtDay = iso => iso ? fDay.format(parseISO(iso)) : '—';
const fmtTime = t => t ? String(t).slice(0, 5) : '';
const fmtNum = (n, d = 2) => n == null || n === '' ? '' : Number(n).toLocaleString('el-GR', { maximumFractionDigits: d });
const fmtMoney = n => n == null ? '' : Number(n).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
function rel(iso) {
  const d = diffDays(today(), iso);
  if (d === 0) return 'σήμερα';
  if (d === 1) return 'αύριο';
  if (d === -1) return 'χθες';
  if (d > 1) return d <= 60 ? `σε ${d} ημέρες` : `σε ${Math.round(d / 30)} μήνες`;
  return -d <= 60 ? `πριν ${-d} ημέρες` : `πριν ${Math.round(-d / 30)} μήνες`;
}
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const parseNum = s => {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const telHref = p => 'tel:' + String(p).replace(/[^\d+]/g, '');
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'el');
const vKey = v => `${v.scheduled_date} ${v.scheduled_time || '99:99'}`;
const byWhen = (a, b) => vKey(a).localeCompare(vKey(b));

function parseCoords(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const m = s.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
    || s.match(/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i)
    || s.match(/(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.')), lng = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
const hasLoc = i => i && i.lat != null && i.lng != null;
const gmapsSearch = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
function navHref(i) {
  if (hasLoc(i)) return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${i.lat},${i.lng}`;
  const a = instAddr(i);
  return a ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(a)}` : null;
}
function routeHref(insts) {
  const pts = insts.map(i => hasLoc(i) ? `${i.lat},${i.lng}` : encodeURIComponent(instAddr(i))).filter(Boolean).slice(0, 10);
  if (!pts.length) return null;
  const dest = pts.pop();
  let u = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${dest}`;
  if (C.base && C.base.lat != null) u += `&origin=${C.base.lat},${C.base.lng}`;
  if (pts.length) u += `&waypoints=${pts.join('%7C')}`;
  return u;
}

/* =====================================================================
   Εικονίδια
   ===================================================================== */
const ICONS = {
  today: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><rect x="7" y="12.5" width="4" height="4" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>',
  flame: '<path d="M12 3c1 3.5 6 6 6 11a6 6 0 0 1-12 0c0-2.6 1.4-4.4 3-5.8.2 2 1 3.2 2.2 3.9C10.8 8.9 10.9 5.6 12 3Z"/>',
  map: '<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2Z"/>',
  nav: '<path d="M3 11 21 3l-8 18-2.2-7.8L3 11Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  left: '<path d="m14.5 5-7 7 7 7"/>',
  right: '<path d="m9.5 5 7 7-7 7"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l2 2M14 9l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'
};
const ico = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const LOGO = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#1D55D6"/><path d="M20 6.5c3.6 5.2 8 8.4 8 14.3a8 8 0 0 1-16 0c0-5.9 4.4-9.1 8-14.3Z" fill="#fff"/><path d="M20 15.5c1.8 2.6 4 4.1 4 6.9a4 4 0 0 1-8 0c0-2.8 2.2-4.3 4-6.9Z" fill="#1D55D6"/><rect x="9" y="32" width="22" height="3" rx="1.5" fill="#E0A200"/></svg>';
const brandHTML = (cls = '') => `<div class="brand ${cls}">${LOGO}<div><div class="brand-name">${esc(C.companyName)}</div><div class="brand-sub">Πελάτες &amp; συντηρήσεις</div></div></div>`;

/* =====================================================================
   Κατάσταση
   ===================================================================== */
const S = {
  sb: null, session: null, me: null, channel: null, live: 'connecting',
  profiles: new Map(), customers: new Map(), installations: new Map(), visits: new Map(),
  idx: { vb: new Map(), sb: new Map(), ic: new Map() },
  route: { view: null, sheet: null, id: null },
  ui: {}, map: null, cluster: null, pickMap: null, mine: new Map(), recovering: false
};
const cust = id => S.customers.get(id);
const inst = id => S.installations.get(id);
const prof = id => (id ? S.profiles.get(id) : null);
const isAdmin = () => S.me?.role === 'admin';
const canEditVisit = v => isAdmin() || (v.assigned_to && v.assigned_to === S.me?.id);
const roleLabel = r => r === 'admin' ? 'Διαχειριστής' : 'Τεχνικός';
const inScope = v => S.ui.scope === 'all' || v.assigned_to === S.me?.id;

function instName(i) {
  if (!i) return '—';
  if (i.title) return i.title;
  const bm = [i.brand, i.model].filter(Boolean).join(' ');
  return [i.category, bm].filter(Boolean).join(' · ') || 'Εγκατάσταση';
}
function instAddr(i) {
  if (!i) return '';
  const c = cust(i.customer_id);
  return [i.address || c?.address, i.city || c?.city].filter(Boolean).join(', ');
}
function techColor(p) {
  if (!p) return 'var(--grey)';
  if (p.color) return p.color;
  const ids = [...S.profiles.keys()].sort();
  return TECH_COLORS[Math.max(0, ids.indexOf(p.id)) % TECH_COLORS.length][0];
}
const avatar = (p, cls = '') => `<span class="avatar ${cls}" style="--av:${esc(techColor(p))}" aria-hidden="true">${esc(initials(p?.full_name || p?.email))}</span>`;
const techChip = p => p ? `<span class="tech">${avatar(p)}${esc(p.full_name || p.email)}</span>` : '<span class="tech muted">Χωρίς ανάθεση</span>';

function derive() {
  const vb = new Map(), sb = new Map(), ic = new Map();
  for (const v of S.visits.values()) {
    if (!vb.has(v.installation_id)) vb.set(v.installation_id, []);
    vb.get(v.installation_id).push(v);
    if (v.status === 'scheduled') {
      const cur = sb.get(v.installation_id);
      if (!cur || vKey(v) < vKey(cur)) sb.set(v.installation_id, v);
    }
  }
  const histKey = v => (v.status === 'done' ? v.completed_date || v.scheduled_date : v.scheduled_date) + ' ' + (v.scheduled_time || '');
  for (const arr of vb.values()) arr.sort((a, b) => histKey(b).localeCompare(histKey(a)));
  for (const i of S.installations.values()) {
    if (!ic.has(i.customer_id)) ic.set(i.customer_id, []);
    ic.get(i.customer_id).push(i);
  }
  for (const arr of ic.values()) arr.sort((a, b) => instName(a).localeCompare(instName(b), 'el'));
  S.idx = { vb, sb, ic };
}
function instStatus(i) {
  if (i.active === false) return 'inactive';
  if (S.idx.sb.has(i.id)) return 'scheduled';
  if (!i.next_service_date) return 'none';
  const d = diffDays(today(), i.next_service_date);
  if (d < 0) return 'overdue';
  if (d <= C.soonDays) return 'soon';
  return 'ok';
}
function custSummary(cid) {
  const all = S.idx.ic.get(cid) || [];
  const act = all.filter(i => i.active !== false);
  let worst = null, next = null;
  for (const i of act) {
    const st = instStatus(i);
    if (worst == null || RANK[st] < RANK[worst]) worst = st;
    if (i.next_service_date && (!next || i.next_service_date < next)) next = i.next_service_date;
  }
  return { worst: worst || 'none', next, count: all.length };
}
const pill = st => `<span class="pill st-${st}">${ISTATUS[st]}</span>`;
const vpill = v => `<span class="pill v-${v.status}">${VSTATUS[v.status]}</span>`;

/* =====================================================================
   Οθόνες: φόρτωση, σύνδεση, μηνύματα
   ===================================================================== */
function showScreen(name, html) {
  $('#screen-loading').hidden = name !== 'loading';
  $('#screen-app').hidden = name !== 'app';
  const m = $('#screen-msg');
  m.hidden = name !== 'msg';
  if (name === 'msg') m.innerHTML = html;
}
const configured = () => C.supabaseUrl && C.supabaseKey && !/XXXX/.test(C.supabaseUrl + C.supabaseKey);

function setupScreen() {
  showScreen('msg', `<div class="card-center wide">${brandHTML('lg')}
    <h1>Η εφαρμογή δεν έχει συνδεθεί ακόμη με βάση δεδομένων</h1>
    <ol>
      <li>Δημιουργήστε δωρεάν project στο <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
      <li>Στο <b>SQL Editor</b> τρέξτε το αρχείο <code>supabase/schema.sql</code>.</li>
      <li>Από <b>Project Settings → API Keys</b> αντιγράψτε το Project URL και το Publishable key.</li>
      <li>Συμπληρώστε τα στο αρχείο <code>js/config.js</code> και ανεβάστε το ξανά.</li>
    </ol></div>`);
}

function loginScreen(msg = '', info = '') {
  showScreen('msg', `<form class="card-center" id="login-form" novalidate>
    ${brandHTML('lg')}
    <p>Είσοδος στην εφαρμογή πελατών και συντηρήσεων.</p>
    <div class="field"><label for="lg-email">Email</label><input class="input" id="lg-email" name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="lg-pass">Κωδικός</label><input class="input" id="lg-pass" name="password" type="password" autocomplete="current-password" required></div>
    <p class="form-err" id="lg-err" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
    <p class="muted small" id="lg-info" ${info ? '' : 'hidden'}>${esc(info)}</p>
    <button class="btn primary" type="submit">Είσοδος</button>
    <button class="link-btn" type="button" id="lg-forgot">Ξέχασα τον κωδικό</button>
  </form>`);
  const form = $('#login-form'), err = $('#lg-err'), infoEl = $('#lg-info');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true; infoEl.hidden = true;
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !password) { err.textContent = 'Συμπληρώστε email και κωδικό.'; err.hidden = false; return; }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    const { error } = await S.sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { err.textContent = errMsg(error); err.hidden = false; }
  });
  $('#lg-forgot').addEventListener('click', async () => {
    err.hidden = true; infoEl.hidden = true;
    const email = form.email.value.trim();
    if (!email) { err.textContent = 'Γράψτε πρώτα το email σας και πατήστε ξανά.'; err.hidden = false; return; }
    const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
    infoEl.textContent = 'Στάλθηκε email με σύνδεσμο για νέο κωδικό. Ανοίξτε τον από αυτή τη συσκευή.';
    infoEl.hidden = false;
  });
  setTimeout(() => $('#lg-email')?.focus(), 30);
}

function recoveryScreen() {
  showScreen('msg', `<form class="card-center" id="rec-form" novalidate>
    ${brandHTML('lg')}
    <h1>Νέος κωδικός</h1>
    <div class="field"><label for="rec-1">Νέος κωδικός</label><input class="input" id="rec-1" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="rec-2">Επανάληψη κωδικού</label><input class="input" id="rec-2" type="password" autocomplete="new-password"></div>
    <p class="form-err" id="rec-err" hidden></p>
    <button class="btn primary" type="submit">Αποθήκευση κωδικού</button>
  </form>`);
  $('#rec-form').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#rec-1').value, b = $('#rec-2').value, err = $('#rec-err');
    err.hidden = true;
    if (a.length < 8) { err.textContent = 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'Οι δύο κωδικοί δεν ταιριάζουν.'; err.hidden = false; return; }
    const { error } = await S.sb.auth.updateUser({ password: a });
    if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
    S.recovering = false;
    history.replaceState(null, '', location.pathname + '#/today');
    start();
  });
}

function msgScreen(title, text, retry = false) {
  showScreen('msg', `<div class="card-center">${brandHTML('lg')}<h1>${esc(title)}</h1><p>${esc(text)}</p>
    <div class="sheet-acts">${retry ? '<button class="btn primary" id="msg-retry">Δοκιμή ξανά</button>' : ''}<button class="btn" id="msg-out">${ico('logout')}Αποσύνδεση</button></div></div>`);
  $('#msg-out').addEventListener('click', () => S.sb.auth.signOut());
  $('#msg-retry')?.addEventListener('click', () => start());
}

function errMsg(e) {
  const m = e?.message || String(e || '');
  if (/row-level security|permission denied/i.test(m)) return 'Δεν έχετε δικαίωμα για αυτή την ενέργεια.';
  if (/PGRST116|multiple \(or no\) rows|no rows/i.test(m + (e?.code || ''))) return 'Η εγγραφή δεν βρέθηκε ή δεν έχετε δικαίωμα να την αλλάξετε.';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Δεν υπάρχει σύνδεση με τον διακομιστή. Ελέγξτε το ίντερνετ και δοκιμάστε ξανά.';
  if (/Invalid login credentials/i.test(m)) return 'Λάθος email ή κωδικός.';
  if (/Email not confirmed/i.test(m)) return 'Ο λογαριασμός δεν έχει επιβεβαιωθεί. Ζητήστε από τον διαχειριστή να τον επιβεβαιώσει στο Supabase.';
  if (/Password should be|weak password/i.test(m)) return 'Ο κωδικός είναι πολύ σύντομος ή απλός. Δοκιμάστε μεγαλύτερο.';
  if (/rate limit|too many/i.test(m)) return 'Πολλές προσπάθειες σε λίγο χρόνο. Περιμένετε λίγα λεπτά και δοκιμάστε ξανά.';
  if (/same_password|different from the old/i.test(m)) return 'Ο νέος κωδικός πρέπει να διαφέρει από τον παλιό.';
  return m || 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.';
}

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  const box = $('#toasts');
  box.appendChild(t);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
}

/* =====================================================================
   Σύνδεση χρήστη και φόρτωση δεδομένων
   ===================================================================== */
async function boot() {
  if (!configured()) { setupScreen(); return; }
  try {
    S.sb = createClient(C.supabaseUrl, C.supabaseKey);
  } catch (e) { msgScreen('Λάθος ρυθμίσεις', 'Ελέγξτε το Project URL και το key στο js/config.js. ' + errMsg(e)); return; }
  S.sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onAuth(event, session), 0); });
}

function onAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') { S.recovering = true; S.session = session; recoveryScreen(); return; }
  if (!session) { teardown(); S.session = null; loginScreen(); return; }
  const changed = !S.session || S.session.user.id !== session.user.id || !S.me;
  S.session = session;
  if (S.recovering) return;
  if (changed) start();
}

function teardown() {
  if (S.channel && S.sb) S.sb.removeChannel(S.channel);
  S.channel = null;
  destroyMap();
  for (const t of TABLES) S[t] = new Map();
  S.me = null;
  S.route = { view: null, sheet: null, id: null };
  $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true;
}

async function start() {
  if (!S.session) return;
  if (S.starting) { S.restart = true; return; }
  S.starting = true;
  try { await startOnce(); } finally { S.starting = false; }
  if (S.restart) { S.restart = false; start(); }
}
async function startOnce() {
  const uid = S.session.user.id;
  teardown();
  showScreen('loading');
  try { await loadAll(); }
  catch (e) { msgScreen('Δεν φορτώθηκαν τα δεδομένα', errMsg(e) + (/relation|does not exist|schema cache/i.test(e?.message || '') ? ' Μάλλον δεν έχει τρέξει το schema.sql στο Supabase.' : ''), true); return; }
  S.me = S.profiles.get(uid) || null;
  if (!S.me) { msgScreen('Ο λογαριασμός δεν έχει προφίλ', 'Τρέξτε ξανά το αρχείο schema.sql στο Supabase (SQL Editor) ώστε να δημιουργηθεί το προφίλ σας.', true); return; }
  if (!S.me.active) { msgScreen('Ο λογαριασμός είναι ανενεργός', 'Ο διαχειριστής έχει απενεργοποιήσει αυτόν τον λογαριασμό. Επικοινωνήστε μαζί του.'); return; }
  loadUi();
  buildShell();
  showScreen('app');
  subscribe();
  onRoute();
}

async function fetchAll(table) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await S.sb.from(table).select('*').order('id').range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
async function loadAll() {
  const res = await Promise.all(TABLES.map(fetchAll));
  TABLES.forEach((t, k) => { S[t] = new Map(res[k].map(r => [r.id, r])); });
  derive();
}

function subscribe() {
  if (S.channel) S.sb.removeChannel(S.channel);
  let first = true;
  const ch = S.sb.channel('gastherm-db');
  for (const t of TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => applyChange(t, p));
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      setLive('on');
      if (!first) resync();
      first = false;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      setLive('off');
    }
  });
  S.channel = ch;
}
async function resync() {
  try {
    await loadAll();
    const me = S.profiles.get(S.me?.id);
    if (me) S.me = me;
    invalidate();
  } catch { /* η επόμενη επανασύνδεση θα ξαναδοκιμάσει */ }
}

const markMine = id => S.mine.set(id, Date.now());
const isMine = id => Date.now() - (S.mine.get(id) || 0) < 8000;

function applyChange(table, p) {
  const map = S[table];
  if (p.eventType === 'DELETE') {
    const id = p.old?.id;
    if (id) map.delete(id);
  } else if (p.new?.id) {
    const prev = map.get(p.new.id);
    map.set(p.new.id, p.new);
    if (table === 'visits' && !isMine(p.new.id)) remoteNotice(prev, p.new);
  }
  if (table === 'profiles' && S.me) {
    const me = S.profiles.get(S.me.id);
    if (!me || !me.active) { start(); return; }
    const roleChanged = me.role !== S.me.role;
    S.me = me;
    buildShell();
    if (roleChanged) { renderView(); }
  }
  invalidate();
}
function remoteNotice(prev, v) {
  const c = cust(v.customer_id);
  const who = c ? c.name : 'πελάτη';
  if (!prev && v.status === 'scheduled') toast(`Νέο ραντεβού: ${who}, ${fmtDay(v.scheduled_date)}`);
  else if (prev && prev.status !== 'done' && v.status === 'done') toast(`Ολοκληρώθηκε: ${who}`);
  else if (prev && v.status === 'scheduled' && prev.scheduled_date !== v.scheduled_date) toast(`Μετάθεση: ${who} → ${fmtDay(v.scheduled_date)}`);
}

function setLive(state) {
  S.live = state;
  const txt = state === 'on' ? 'Ζωντανή σύνδεση' : state === 'off' ? 'Εκτός σύνδεσης' : 'Σύνδεση…';
  $$('[data-live]').forEach(el => { el.className = 'live ' + state; el.textContent = el.closest('.topbar') ? '' : txt; el.title = txt; });
}

let raf = 0;
function invalidate() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (!S.me) return;
    derive();
    refreshShell();
    renderBody();
    renderSheet();
  });
}

/* =====================================================================
   Εγγραφές στη βάση
   ===================================================================== */
const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : null);
async function save(table, row, id) {
  // το id σημειώνεται πριν φύγει η αλλαγή, ώστε η ζωντανή ειδοποίηση να μη δείχνει τις δικές μας αλλαγές ως ξένες
  if (!id) { const nid = newId(); if (nid) row = { id: nid, ...row }; }
  if (id || row.id) markMine(id || row.id);
  const q = id
    ? S.sb.from(table).update(row).eq('id', id).select().single()
    : S.sb.from(table).insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  markMine(data.id);
  S[table].set(data.id, data);
  invalidate();
  return data;
}
async function removeRow(table, id) {
  const { data, error } = await S.sb.from(table).delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || !data.length) throw new Error('Δεν έχετε δικαίωμα για αυτή την ενέργεια.');
  S[table].delete(id);
  invalidate();
}
async function refreshRow(table, id) {
  const { data } = await S.sb.from(table).select('*').eq('id', id).maybeSingle();
  if (data) { S[table].set(id, data); invalidate(); }
}
function pickRow(f, keys) {
  const o = {};
  for (const k of keys) { const v = f[k]; o[k] = v === '' || v === undefined ? null : v; }
  return o;
}

/* =====================================================================
   Κέλυφος: πλοήγηση, μπάρες
   ===================================================================== */
const NAV = [
  ['today', 'Σήμερα', 'today', 'Σήμερα'],
  ['customers', 'Πελάτες', 'users', 'Πελάτες'],
  ['installations', 'Εγκαταστάσεις', 'flame', 'Εγκαταστ.'],
  ['map', 'Χάρτης', 'map', 'Χάρτης'],
  ['calendar', 'Ημερολόγιο', 'calendar', 'Ημερολόγιο']
];
function buildShell() {
  const me = S.me;
  $('#rail').innerHTML = `${brandHTML()}
    <nav class="nav">${NAV.map(([k, l, i]) => `<a class="nav-a" href="#/${k}" data-nav="${k}">${ico(i)}<span>${l}</span><span class="badge" data-badge="${k}" hidden></span></a>`).join('')}
      <div class="nav-sep"></div>
      <a class="nav-a" href="#/more" data-nav="more">${ico('settings')}<span>${isAdmin() ? 'Ρυθμίσεις &amp; χρήστες' : 'Ρυθμίσεις'}</span></a>
    </nav>
    <div class="rail-foot">
      <div class="me">${avatar(me)}<div class="me-txt"><div class="me-name">${esc(me.full_name || me.email)}</div><div class="me-role">${roleLabel(me.role)}</div></div></div>
      <span class="live" data-live></span>
    </div>`;
  $('#topbar').innerHTML = `${brandHTML()}<span class="live" data-live></span><a class="me-btn" href="#/more" aria-label="Ρυθμίσεις και λογαριασμός">${avatar(me)}</a>`;
  $('#tabbar').innerHTML = NAV.map(([k, , i, s]) => `<a class="tab" href="#/${k}" data-nav="${k}">${ico(i)}<span>${s}</span><span class="badge" data-badge="${k}" hidden></span></a>`).join('');
  setLive(S.live);
  refreshShell();
}
function refreshShell() {
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === S.route.view));
  const t = today();
  let n = 0;
  for (const i of S.installations.values()) if (instStatus(i) === 'overdue') n++;
  for (const v of S.visits.values()) if (v.status === 'scheduled' && v.scheduled_date < t && inScope(v)) n++;
  $$('[data-badge="today"]').forEach(b => { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; });
}

/* =====================================================================
   Δρομολόγηση
   ===================================================================== */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = VIEWS[parts[0]] ? parts[0] : 'today';
  return { view, sheet: parts[1] || null, id: parts[2] || null };
}
function onRoute() {
  if (!S.me) return;
  const r = parseRoute();
  const changed = r.view !== S.route.view;
  S.route = r;
  if (changed) renderView();
  renderSheet();
  refreshShell();
}
function go(view, sheet, id) {
  const h = '#/' + view + (sheet ? `/${sheet}/${id}` : '');
  if (location.hash === h) onRoute(); else location.hash = h;
}
const openSheet = (type, id) => go(S.route.view || 'today', type, id);
const closeSheet = () => { if (S.route.sheet) go(S.route.view); };

function renderView() {
  destroyMap();
  const v = VIEWS[S.route.view];
  $('#view').innerHTML = `<div class="view-inner"><header class="view-head">${v.head()}</header><div id="view-body" class="stack"></div></div>`;
  v.mount?.($('#view-body'));
  renderBody();
  window.scrollTo(0, 0);
}
function renderBody() {
  const v = VIEWS[S.route.view];
  const b = $('#view-body');
  if (!v || !b) return;
  if (v.update) v.update(b); else b.innerHTML = v.body();
}
let bodyTimer = 0;
const renderBodySoon = () => { clearTimeout(bodyTimer); bodyTimer = setTimeout(renderBody, 120); };

/* =====================================================================
   Κοινά κομμάτια λιστών
   ===================================================================== */
function visitRow(v, opts = {}) {
  const i = inst(v.installation_id);
  const c = cust(v.customer_id || i?.customer_id);
  const p = prof(v.assigned_to);
  const nav = i ? navHref(i) : null;
  const acts = v.status === 'scheduled' && canEditVisit(v)
    ? `<button class="btn xs" data-act="complete" data-id="${v.id}">${ico('check')}Ολοκλήρωση</button><button class="btn xs" data-act="resched" data-id="${v.id}">${ico('clock')}Μετάθεση</button>`
    : (v.status !== 'scheduled' ? vpill(v) : '');
  const sub = [instName(i), instAddr(i)].filter(Boolean).join(' · ');
  const who = p ? (p.full_name || p.email) : 'Χωρίς ανάθεση';
  return `<div class="row vrow ${v.status}" data-act="open" data-type="visit" data-id="${v.id}">
    <div class="time">${opts.date ? `<small>${esc(fmtDay(v.scheduled_date))}</small>` : ''}${esc(fmtTime(v.scheduled_time) || '—')}</div>
    <div class="main"><div class="t">${esc(c?.name || '—')}</div><div class="s"><span class="kind">${KINDS[v.kind] || ''}</span>${v.reschedule_count ? `<span class="kind" title="Μεταθέσεις">↻ ${v.reschedule_count}</span>` : ''}${esc(sub)}</div><div class="s who">${p ? avatar(p, 'xs') : ''}${esc(who)}</div></div>
    <div class="acts">${acts}${nav ? `<a class="btn xs icon" href="${esc(nav)}" target="_blank" rel="noopener" title="Πλοήγηση" aria-label="Πλοήγηση">${ico('nav')}</a>` : ''}</div>
  </div>`;
}
function instRow(i, st = instStatus(i)) {
  const c = cust(i.customer_id);
  const sub = [instName(i), [i.brand, i.model].filter(Boolean).join(' ') && i.title ? [i.brand, i.model].filter(Boolean).join(' ') : '', i.serial_number ? 'S/N ' + i.serial_number : '', i.city || c?.city].filter(Boolean).join(' · ');
  const next = i.next_service_date;
  const sched = S.idx.sb.get(i.id);
  const due = sched
    ? `<div class="due">${pill(st)}<span>${esc(fmtDate(sched.scheduled_date))}</span><small>ραντεβού ${esc(rel(sched.scheduled_date))}</small></div>`
    : `<div class="due">${pill(st)}<span>${next ? esc(fmtDate(next)) : '—'}</span><small>${next ? esc(rel(next)) : 'χωρίς ημερομηνία'}</small></div>`;
  return `<div class="row irow" data-act="open" data-type="inst" data-id="${i.id}">
    <div class="main"><div class="t">${esc(c?.name || '—')}</div><div class="s">${esc(sub)}</div></div>
    ${due}
    <div class="acts">${!sched && i.active !== false ? `<button class="btn xs" data-act="sched" data-inst="${i.id}">${ico('plus')}Ραντεβού</button>` : ''}</div>
  </div>`;
}
function timelineItem(v) {
  const p = prof(v.assigned_to);
  const date = v.status === 'done' ? (v.completed_date || v.scheduled_date) : v.scheduled_date;
  const text = [v.work_done, v.notes].filter(Boolean).join('\n');
  return `<div class="tl v-${v.status}" data-act="open" data-type="visit" data-id="${v.id}">
    <div class="h"><span class="d">${esc(fmtDate(date))}</span><span class="k">${KINDS[v.kind] || ''}</span>${v.status !== 'done' ? vpill(v) : ''}<span class="muted small">${esc(p ? (p.full_name || p.email) : '')}</span></div>
    ${text ? `<div class="b">${esc(text)}</div>` : ''}
    ${measLine(v.measurements)}
  </div>`;
}
function measLine(m) {
  if (!m || typeof m !== 'object') return '';
  const parts = MEAS.filter(([k]) => m[k] != null && m[k] !== '').map(([k, l, u]) => `<span>${esc(l)} <b>${esc(fmtNum(m[k], 2))}</b> ${esc(u)}</span>`);
  return parts.length ? `<div class="meas">${parts.join('')}</div>` : '';
}
const empty = (text, btn = '') => `<div class="empty"><span>${text}</span>${btn}</div>`;
function groupByDay(list) {
  let out = '', last = null;
  for (const v of list) {
    if (v.scheduled_date !== last) { out += `<div class="day-h">${esc(cap(fmtDay(v.scheduled_date)))} · ${esc(rel(v.scheduled_date))}</div>`; last = v.scheduled_date; }
    out += visitRow(v);
  }
  return out;
}

/* =====================================================================
   Προβολές
   ===================================================================== */
const VIEWS = {};

VIEWS.today = {
  head() {
    return `<div class="titles"><h1>Σήμερα</h1><div class="sub">${esc(cap(fLong.format(new Date())))}</div></div>
      <div class="tools">
        <div class="seg" role="group" aria-label="Ποια ραντεβού">
          <button type="button" data-act="scope" data-v="mine" class="${S.ui.scope === 'mine' ? 'on' : ''}">Δικά μου</button>
          <button type="button" data-act="scope" data-v="all" class="${S.ui.scope === 'all' ? 'on' : ''}">Όλων</button>
        </div>
        <button class="btn primary" data-act="new-visit">${ico('plus')}Νέο ραντεβού</button>
      </div>`;
  },
  body() {
    const t = today();
    const sched = [...S.visits.values()].filter(v => v.status === 'scheduled' && inScope(v));
    const todays = sched.filter(v => v.scheduled_date === t).sort(byWhen);
    const doneToday = [...S.visits.values()].filter(v => v.status === 'done' && v.completed_date === t && inScope(v)).sort(byWhen);
    const backlog = sched.filter(v => v.scheduled_date < t).sort(byWhen);
    const end = addDays(t, 7);
    const upcoming = sched.filter(v => v.scheduled_date > t && v.scheduled_date <= end).sort(byWhen);
    const act = [...S.installations.values()].filter(i => i.active !== false);
    const overdue = [], soon = [];
    for (const i of act) { const s = instStatus(i); if (s === 'overdue') overdue.push(i); else if (s === 'soon') soon.push(i); }
    const need = [...overdue, ...soon].sort((a, b) => a.next_service_date.localeCompare(b.next_service_date));
    const route = routeHref(todays.map(v => inst(v.installation_id)).filter(Boolean));
    const kpi = (k, label, n, d, st, alert) => `<button type="button" class="kpi ${st} ${alert ? 'alert' : ''}" data-act="kpi" data-k="${k}"><span class="k">${label}</span><span class="v">${n}</span><span class="d">${d}</span></button>`;
    return `
      <div class="kpis">
        ${kpi('overdue', 'Εκπρόθεσμες', overdue.length, 'συντηρήσεις χωρίς ραντεβού', 'st-overdue', overdue.length > 0)}
        ${kpi('soon', `Λήγουν σε ${C.soonDays} ημ.`, soon.length, 'συντηρήσεις χωρίς ραντεβού', 'st-soon', false)}
        ${kpi('today', 'Ραντεβού σήμερα', todays.length, doneToday.length ? `και ${doneToday.length} ολοκληρωμένα` : 'προγραμματισμένα', 'st-scheduled', false)}
        ${kpi('backlog', 'Ανοιχτά από πριν', backlog.length, 'πέρασε η ημέρα, δεν έκλεισαν', 'st-none', backlog.length > 0)}
      </div>
      <div class="cols">
        <div class="stack">
          <section class="panel" id="p-today">
            <div class="panel-h"><h2>Πρόγραμμα ημέρας</h2><span class="count">${todays.length}</span>
              ${route ? `<a class="btn sm" href="${esc(route)}" target="_blank" rel="noopener">${ico('route')}Διαδρομή στο Google Maps</a>` : ''}</div>
            <div class="panel-b rows">${todays.length || doneToday.length
              ? todays.map(v => visitRow(v)).join('') + doneToday.map(v => visitRow(v)).join('')
              : empty('Δεν υπάρχουν ραντεβού για σήμερα.', `<button class="btn sm" data-act="new-visit" data-date="${t}">${ico('plus')}Κλείσε ραντεβού</button>`)}</div>
          </section>
          ${backlog.length ? `<section class="panel" id="p-backlog">
            <div class="panel-h"><h2>Ανοιχτά από προηγούμενες ημέρες</h2><span class="count">${backlog.length}</span></div>
            <div class="panel-b rows">${backlog.map(v => visitRow(v, { date: true })).join('')}</div>
          </section>` : ''}
          <section class="panel">
            <div class="panel-h"><h2>Επόμενες 7 ημέρες</h2><span class="count">${upcoming.length}</span></div>
            <div class="panel-b rows">${upcoming.length ? groupByDay(upcoming) : empty('Δεν υπάρχουν ραντεβού την επόμενη εβδομάδα.')}</div>
          </section>
        </div>
        <section class="panel">
          <div class="panel-h"><h2>Θέλουν ραντεβού</h2><span class="count">${need.length}</span></div>
          <div class="panel-b rows">${need.length ? need.slice(0, 40).map(i => instRow(i)).join('') + (need.length > 40 ? `<div class="empty"><button class="btn sm" data-act="kpi" data-k="overdue">Όλες οι εκπρόθεσμες</button></div>` : '')
            : empty(S.installations.size ? 'Όλες οι εγκαταστάσεις έχουν ραντεβού ή δεν λήγουν σύντομα.' : 'Δεν έχουν καταχωρηθεί ακόμη εγκαταστάσεις.', S.installations.size || !isAdmin() ? '' : `<button class="btn sm primary" data-act="new-cust">${ico('plus')}Πρώτος πελάτης</button>`)}</div>
        </section>
      </div>`;
  }
};

VIEWS.customers = {
  head() {
    return `<div class="titles"><h1>Πελάτες</h1></div>
      <div class="tools">
        <label class="search">${ico('search')}<input class="input" id="q-cust" type="search" placeholder="Όνομα, τηλέφωνο, διεύθυνση, σειριακός…" value="${esc(S.ui.custQ)}" aria-label="Αναζήτηση πελατών"></label>
        <select class="input" id="s-cust" aria-label="Ταξινόμηση" style="width:auto">
          <option value="name" ${S.ui.custSort === 'name' ? 'selected' : ''}>Αλφαβητικά</option>
          <option value="due" ${S.ui.custSort === 'due' ? 'selected' : ''}>Επόμενη συντήρηση</option>
          <option value="new" ${S.ui.custSort === 'new' ? 'selected' : ''}>Πιο πρόσφατοι</option>
        </select>
        ${isAdmin() ? `<button class="btn primary" data-act="new-cust">${ico('plus')}Νέος πελάτης</button>` : ''}
      </div>`;
  },
  body() {
    const q = norm(S.ui.custQ);
    let list = [...S.customers.values()];
    if (q) list = list.filter(c => {
      const insts = (S.idx.ic.get(c.id) || []).map(i => [i.serial_number, i.brand, i.model, i.title, i.address, i.city].join(' ')).join(' ');
      return norm([c.name, c.phone, c.phone2, c.email, c.address, c.city, c.vat_number, insts].join(' ')).includes(q);
    });
    const sum = new Map(list.map(c => [c.id, custSummary(c.id)]));
    if (S.ui.custSort === 'due') list.sort((a, b) => (sum.get(a.id).next || '9999').localeCompare(sum.get(b.id).next || '9999') || byName(a, b));
    else if (S.ui.custSort === 'new') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    else list.sort(byName);
    const rows = list.slice(0, 500).map(c => {
      const s = sum.get(c.id);
      return `<div class="row crow" data-act="open" data-type="cust" data-id="${c.id}">
        <div class="main"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.address || '')}${s.count ? ` · ${s.count} εγκατ.` : ''}</div></div>
        <div class="c-city s">${esc(c.city || '')}</div>
        <div class="ph">${esc(c.phone || '')}</div>
        <div class="due">${s.count ? pill(s.worst) : '<span class="muted small">χωρίς εγκατάσταση</span>'}${s.next ? `<small>${esc(fmtDate(s.next))}</small>` : ''}</div>
      </div>`;
    }).join('');
    return `<section class="panel">
      <div class="panel-h"><h2>${q ? 'Αποτελέσματα' : 'Όλοι οι πελάτες'}</h2><span class="count">${list.length}</span></div>
      <div class="panel-b rows">
        ${list.length ? `<div class="row crow list-head"><div>Πελάτης</div><div class="c-city">Πόλη</div><div>Τηλέφωνο</div><div style="text-align:right">Κατάσταση</div></div>${rows}` + (list.length > 500 ? `<div class="empty">Εμφανίζονται οι πρώτοι 500. Χρησιμοποιήστε την αναζήτηση.</div>` : '')
          : empty(q ? 'Δεν βρέθηκε πελάτης με αυτά τα στοιχεία.' : 'Δεν υπάρχουν ακόμη πελάτες.', !q && isAdmin() ? `<button class="btn sm primary" data-act="new-cust">${ico('plus')}Νέος πελάτης</button>` : '')}
      </div></section>`;
  }
};

const IFILTERS = [['all', 'Όλες', ''], ['overdue', 'Εκπρόθεσμες', 'var(--red)'], ['soon', 'Λήγουν σύντομα', 'var(--amber)'], ['scheduled', 'Με ραντεβού', 'var(--flame)'], ['ok', 'Εντάξει', 'var(--green)'], ['none', 'Χωρίς ημερομηνία', 'var(--grey)'], ['noloc', 'Χωρίς θέση στον χάρτη', ''], ['inactive', 'Ανενεργές', '']];
const catOptions = (val, all) => `<option value="">${all}</option>` + [...new Set([...C.categories, ...[...S.installations.values()].map(i => i.category).filter(Boolean)])].map(c => `<option ${c === val ? 'selected' : ''}>${esc(c)}</option>`).join('');

VIEWS.installations = {
  head() {
    return `<div class="titles"><h1>Εγκαταστάσεις</h1></div>
      <div class="tools">
        <label class="search">${ico('search')}<input class="input" id="q-inst" type="search" placeholder="Πελάτης, μάρκα, μοντέλο, σειριακός…" value="${esc(S.ui.instQ)}" aria-label="Αναζήτηση εγκαταστάσεων"></label>
        <select class="input" id="flt-cat" aria-label="Κατηγορία" style="width:auto">${catOptions(S.ui.instCat, 'Όλες οι κατηγορίες')}</select>
        ${isAdmin() ? `<button class="btn" data-act="export-csv">${ico('download')}Excel</button><button class="btn primary" data-act="new-inst">${ico('plus')}Νέα εγκατάσταση</button>` : ''}
      </div>`;
  },
  body() {
    const q = norm(S.ui.instQ);
    const all = [...S.installations.values()];
    const st = new Map(all.map(i => [i.id, instStatus(i)]));
    const base = all.filter(i => (!S.ui.instCat || i.category === S.ui.instCat) && (!q || norm([cust(i.customer_id)?.name, i.title, i.category, i.brand, i.model, i.serial_number, instAddr(i)].join(' ')).includes(q)));
    const test = (i, f) => f === 'all' ? i.active !== false : f === 'noloc' ? (i.active !== false && !hasLoc(i)) : st.get(i.id) === f;
    const counts = Object.fromEntries(IFILTERS.map(([f]) => [f, base.filter(i => test(i, f)).length]));
    const f = S.ui.instStatus || 'all';
    const list = base.filter(i => test(i, f)).sort((a, b) => (a.next_service_date || '9999').localeCompare(b.next_service_date || '9999') || (cust(a.customer_id)?.name || '').localeCompare(cust(b.customer_id)?.name || '', 'el'));
    return `<div class="chips" role="group" aria-label="Κατάσταση">${IFILTERS.map(([k, l, c]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" data-act="ist" data-v="${k}">${c ? `<span class="dot" style="--c:${c}"></span>` : ''}${l}<span class="n">${counts[k]}</span></button>`).join('')}</div>
      <section class="panel"><div class="panel-b rows" style="padding-top:6px">
        ${list.length ? list.slice(0, 600).map(i => instRow(i, st.get(i.id))).join('') + (list.length > 600 ? '<div class="empty">Εμφανίζονται οι πρώτες 600. Χρησιμοποιήστε την αναζήτηση ή τα φίλτρα.</div>' : '')
          : empty(S.installations.size ? 'Καμία εγκατάσταση σε αυτό το φίλτρο.' : 'Δεν υπάρχουν ακόμη εγκαταστάσεις. Καταχωρήστε πρώτα πελάτη και μετά την εγκατάστασή του.', isAdmin() && !S.installations.size ? `<button class="btn sm primary" data-act="new-cust">${ico('plus')}Νέος πελάτης</button>` : '')}
      </div></section>`;
  }
};

const MSTATUS = ['overdue', 'soon', 'scheduled', 'ok', 'none'];
VIEWS.map = {
  head() {
    return `<div class="titles"><h1>Χάρτης</h1><div class="sub">Οι εγκαταστάσεις με χρώμα ανάλογα με την κατάσταση συντήρησης</div></div>
      <div class="tools"><select class="input" id="flt-mapcat" aria-label="Κατηγορία" style="width:auto">${catOptions(S.ui.mapCat, 'Όλες οι κατηγορίες')}</select></div>`;
  },
  mount(b) {
    b.innerHTML = `<div class="chips" id="map-chips" role="group" aria-label="Κατάσταση"></div>
      <div class="map-wrap"><div id="map"></div><div class="map-note" id="map-note" hidden></div></div>`;
    setTimeout(() => { ensureMap(); renderBody(); }, 0);
  },
  update() {
    const all = [...S.installations.values()].filter(i => i.active !== false && (!S.ui.mapCat || i.category === S.ui.mapCat));
    const st = new Map(all.map(i => [i.id, instStatus(i)]));
    const on = new Set(S.ui.mapSt);
    const chips = $('#map-chips');
    if (chips) chips.innerHTML = MSTATUS.map(k => {
      const n = all.filter(i => st.get(i.id) === k && hasLoc(i)).length;
      return `<button type="button" class="chip ${on.has(k) ? 'on' : ''}" data-act="mst" data-v="${k}"><span class="dot st-${k}" style="background:var(--c)"></span>${ISTATUS[k]}<span class="n">${n}</span></button>`;
    }).join('');
    const noloc = all.filter(i => !hasLoc(i)).length;
    const note = $('#map-note');
    if (note) {
      note.hidden = !noloc;
      note.innerHTML = noloc ? `${noloc} εγκαταστάσεις δεν έχουν θέση. <button class="link-btn" data-act="goto-noloc">Προβολή</button>` : '';
    }
    if (!S.map || !S.cluster) return;
    S.cluster.clearLayers();
    const pts = [];
    for (const i of all) {
      if (!hasLoc(i) || !on.has(st.get(i.id))) continue;
      const s = st.get(i.id);
      const mk = L.marker([i.lat, i.lng], { st: s, title: cust(i.customer_id)?.name || '', icon: L.divIcon({ className: '', html: `<div class="pin st-${s}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8] }) });
      mk.bindPopup(() => popupHTML(i.id), { maxWidth: 300 });
      S.cluster.addLayer(mk);
      pts.push([i.lat, i.lng]);
    }
    if (!S.mapFitted && pts.length) { S.map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 }); S.mapFitted = true; }
  }
};
function popupHTML(id) {
  const i = inst(id);
  if (!i) return 'Η εγκατάσταση διαγράφηκε.';
  const c = cust(i.customer_id);
  const s = instStatus(i);
  const sched = S.idx.sb.get(i.id);
  const nav = navHref(i);
  return `<div class="pop"><div class="t">${esc(c?.name || '—')}</div><div class="muted">${esc(instName(i))}</div><div>${pill(s)}</div>
    <div class="small">${sched ? `Ραντεβού: <b>${esc(fmtDay(sched.scheduled_date))} ${esc(fmtTime(sched.scheduled_time))}</b>` : `Επόμενη συντήρηση: <b>${esc(fmtDate(i.next_service_date))}</b>`}</div>
    ${c?.phone ? `<div class="small mono">${esc(c.phone)}</div>` : ''}
    <div class="acts"><button class="btn xs primary" data-act="open" data-type="inst" data-id="${i.id}">Άνοιγμα</button>${!sched ? `<button class="btn xs" data-act="sched" data-inst="${i.id}">Ραντεβού</button>` : ''}${nav ? `<a class="btn xs" href="${esc(nav)}" target="_blank" rel="noopener">${ico('nav')}Πλοήγηση</a>` : ''}</div></div>`;
}
function ensureMap() {
  const el = $('#map');
  if (!el) return null;
  if (!window.L) { el.innerHTML = '<div class="empty">Ο χάρτης δεν φορτώθηκε. Ελέγξτε τη σύνδεση στο ίντερνετ και ανανεώστε τη σελίδα.</div>'; return null; }
  if (S.map) return S.map;
  const m = L.map(el, { zoomControl: true }).setView(C.mapCenter, C.mapZoom);
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTR }).addTo(m);
  S.cluster = L.markerClusterGroup
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon })
    : L.layerGroup();
  m.addLayer(S.cluster);
  // τα κουμπιά μέσα στα αναδυόμενα του χάρτη δουλεύουν ακόμη κι αν ο Leaflet σταματήσει το click
  m.on('popupopen', ev => ev.popup.getElement()?.addEventListener('click', handleClick));
  S.map = m;
  S.mapFitted = false;
  setTimeout(() => m.invalidateSize(), 50);
  return m;
}
function clusterIcon(cl) {
  const ms = cl.getAllChildMarkers();
  let worst = 'ok';
  for (const mk of ms) if (RANK[mk.options.st] < RANK[worst]) worst = mk.options.st;
  return L.divIcon({ html: `<div class="cluster st-${worst}">${ms.length}</div>`, className: '', iconSize: [38, 38] });
}
function destroyMap() {
  if (S.map) { S.map.remove(); S.map = null; S.cluster = null; }
}

VIEWS.calendar = {
  head() {
    const [y, m] = S.ui.calMonth.split('-').map(Number);
    const techs = [...S.profiles.values()].filter(p => p.active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'el'));
    return `<div class="titles"><h1>Ημερολόγιο</h1></div>
      <div class="tools">
        <div class="cal-nav">
          <button class="btn icon sm" data-act="cal-prev" aria-label="Προηγούμενος μήνας">${ico('left')}</button>
          <span class="m">${esc(cap(fMonth.format(new Date(y, m - 1, 1))))}</span>
          <button class="btn icon sm" data-act="cal-next" aria-label="Επόμενος μήνας">${ico('right')}</button>
          <button class="btn sm" data-act="cal-today">Σήμερα</button>
        </div>
        <select class="input" id="flt-caltech" aria-label="Τεχνικός" style="width:auto">
          <option value="">Όλοι οι τεχνικοί</option>
          ${techs.map(p => `<option value="${p.id}" ${S.ui.calTech === p.id ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}
          <option value="none" ${S.ui.calTech === 'none' ? 'selected' : ''}>Χωρίς ανάθεση</option>
        </select>
        <button class="btn primary" data-act="new-visit">${ico('plus')}Νέο ραντεβού</button>
      </div>`;
  },
  body() {
    const [y, m] = S.ui.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const off = (first.getDay() + 6) % 7;
    const dim = new Date(y, m, 0).getDate();
    const weeks = Math.ceil((off + dim) / 7);
    const t = today();
    const techOk = v => !S.ui.calTech || (S.ui.calTech === 'none' ? !v.assigned_to : v.assigned_to === S.ui.calTech);
    const byDay = new Map();
    for (const v of S.visits.values()) {
      if (v.status === 'cancelled' || !techOk(v)) continue;
      const d = v.status === 'done' ? (v.completed_date || v.scheduled_date) : v.scheduled_date;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(v);
    }
    for (const arr of byDay.values()) arr.sort(byWhen);
    const dues = new Map();
    for (const i of S.installations.values()) {
      if (i.active === false || !i.next_service_date || S.idx.sb.has(i.id)) continue;
      if (!dues.has(i.next_service_date)) dues.set(i.next_service_date, []);
      dues.get(i.next_service_date).push(i);
    }
    let cells = '';
    for (let k = 0; k < weeks * 7; k++) {
      const d = new Date(y, m - 1, 1 - off + k);
      const iso = toISO(d);
      const vs = byDay.get(iso) || [];
      const ds = dues.get(iso) || [];
      const cls = ['cell', d.getMonth() !== m - 1 ? 'out' : '', iso === t ? 'today' : '', iso === S.ui.calDay ? 'sel' : '', k % 7 >= 5 ? 'we' : ''].join(' ');
      cells += `<div class="${cls}" data-act="cal-day" data-d="${iso}" data-drop="${iso}">
        <span class="dn">${d.getDate()}</span>
        ${vs.slice(0, 3).map(calChip).join('')}
        ${vs.length > 3 ? `<span class="more-n">+${vs.length - 3} ακόμη</span>` : ''}
        ${ds.length ? `<span class="dues">${ds.length} ${ds.length === 1 ? 'λήξη' : 'λήξεις'}</span>` : ''}
        <span class="dots">${vs.slice(0, 5).map(v => `<i style="--tc:${esc(techColor(prof(v.assigned_to)))}"></i>`).join('')}${ds.length ? '<i class="due"></i>' : ''}</span>
      </div>`;
    }
    const day = S.ui.calDay;
    const dvs = [...S.visits.values()].filter(v => techOk(v) && ((v.status === 'done' ? (v.completed_date || v.scheduled_date) : v.scheduled_date) === day)).sort(byWhen);
    const dds = dues.get(day) || [];
    return `<div class="cal-layout">
      <div class="cal"><div class="cal-wd">${['Δευ', 'Τρι', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ', 'Κυρ'].map(w => `<div>${w}</div>`).join('')}</div><div class="cal-grid">${cells}</div></div>
      <section class="panel" id="p-day">
        <div class="panel-h"><h2>${esc(cap(fLong.format(parseISO(day))))}</h2><button class="btn sm" data-act="new-visit" data-date="${day}">${ico('plus')}Ραντεβού</button></div>
        <div class="panel-b rows">
          ${dvs.length ? dvs.map(v => visitRow(v)).join('') : empty('Κανένα ραντεβού αυτή την ημέρα.')}
          ${dds.length ? `<div class="day-h">Λήγει η συντήρηση</div>${dds.map(i => instRow(i)).join('')}` : ''}
        </div>
      </section>
    </div>`;
  }
};
function calChip(v) {
  const c = cust(v.customer_id);
  const drag = v.status === 'scheduled' && canEditVisit(v);
  return `<span class="vchip ${v.status}" style="--tc:${esc(techColor(prof(v.assigned_to)))}" data-act="open" data-type="visit" data-id="${v.id}" ${drag ? `draggable="true" data-drag="${v.id}"` : ''} title="${esc(KINDS[v.kind] + ' · ' + (c?.name || ''))}"><b>${esc(fmtTime(v.scheduled_time))}</b>${esc(c?.name || '—')}</span>`;
}

VIEWS.more = {
  head() { return `<div class="titles"><h1>Ρυθμίσεις</h1><div class="sub">${esc(C.appName)} · έκδοση ${VERSION}</div></div>`; },
  body() {
    const me = S.me;
    const users = [...S.profiles.values()].sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) || (a.full_name || '').localeCompare(b.full_name || '', 'el'));
    const host = (() => { try { return new URL(C.supabaseUrl).host; } catch { return C.supabaseUrl; } })();
    return `<div class="settings">
      <section class="panel"><div class="panel-h"><h2>Ο λογαριασμός μου</h2></div><div class="panel-b">
        <div class="me">${avatar(me)}<div class="me-txt"><div class="me-name">${esc(me.full_name || me.email)}</div><div class="me-role">${esc(me.email || '')} · ${roleLabel(me.role)}</div></div></div>
        <div class="sheet-acts">
          <button class="btn sm" data-act="edit-user" data-id="${me.id}">${ico('edit')}Τα στοιχεία μου</button>
          <button class="btn sm" data-act="password">${ico('key')}Αλλαγή κωδικού</button>
          <button class="btn sm" data-act="logout">${ico('logout')}Αποσύνδεση</button>
        </div>
      </div></section>
      ${isAdmin() ? `<section class="panel"><div class="panel-h"><h2>Χρήστες</h2><span class="count">${users.length}</span></div><div class="panel-b">
        <div class="rows">${users.map(p => `<div class="row urow">
          <div class="me">${avatar(p)}<div class="me-txt"><div class="me-name">${esc(p.full_name || p.email)}</div><div class="me-role">${esc(p.email || '')}</div></div></div>
          <div class="u-role small">${roleLabel(p.role)}</div>
          <div class="u-state">${p.active ? '<span class="pill st-ok">Ενεργός</span>' : '<span class="pill st-none">Ανενεργός</span>'}</div>
          <div class="acts"><button class="btn xs" data-act="edit-user" data-id="${p.id}">${ico('edit')}Αλλαγή</button></div>
        </div>`).join('')}</div>
        <div class="sec"><div class="sec-h"><h3>Νέος χρήστης</h3></div>
          <ol class="steps">
            <li>Στο Supabase ανοίξτε <b>Authentication → Users → Add user → Create new user</b>.</li>
            <li>Γράψτε email και κωδικό και επιλέξτε <b>Auto Confirm User</b>.</li>
            <li>Ο χρήστης εμφανίζεται εδώ αμέσως ως Τεχνικός. Δώστε του το email, τον κωδικό και τη διεύθυνση της εφαρμογής.</li>
          </ol>
        </div>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Δεδομένα</h2></div><div class="panel-b">
        <p class="muted small" style="margin:0">Εξαγωγή για Excel (διαχωριστικό ελληνικού Excel) ή πλήρες αντίγραφο ασφαλείας.</p>
        <div class="sheet-acts">
          <button class="btn sm" data-act="export-csv">${ico('download')}Εγκαταστάσεις (Excel/CSV)</button>
          <button class="btn sm" data-act="export-visits">${ico('download')}Επισκέψεις (Excel/CSV)</button>
          <button class="btn sm" data-act="export-json">${ico('download')}Αντίγραφο ασφαλείας (JSON)</button>
        </div>
      </div></section>` : ''}
      <section class="panel"><div class="panel-h"><h2>Σύνδεση</h2></div><div class="panel-b">
        <div><span class="live ${S.live}">${S.live === 'on' ? 'Ζωντανή σύνδεση: οι αλλαγές των άλλων εμφανίζονται αμέσως' : S.live === 'off' ? 'Εκτός σύνδεσης: οι αλλαγές θα εμφανιστούν μόλις επανέλθει' : 'Σύνδεση…'}</span></div>
        <div class="small muted">Διακομιστής <span class="mono">${esc(host)}</span> · ${S.customers.size} πελάτες · ${S.installations.size} εγκαταστάσεις · ${S.visits.size} επισκέψεις</div>
      </div></section>
    </div>`;
  }
};

/* =====================================================================
   Πάνελ λεπτομερειών
   ===================================================================== */
const closeBtn = `<button class="btn ghost icon" data-act="close-sheet" aria-label="Κλείσιμο">${ico('x')}</button>`;
function renderSheet() {
  const el = $('#sheet'), bd = $('#sheet-backdrop');
  const { sheet, id } = S.route;
  let html = null;
  if (sheet === 'cust') html = cust(id) ? custSheet(cust(id)) : null;
  else if (sheet === 'inst') html = inst(id) ? instSheet(inst(id)) : null;
  else if (sheet === 'visit') html = S.visits.get(id) ? visitSheet(S.visits.get(id)) : null;
  if (sheet && !html) html = `<div class="sheet-h"><div class="titles"><h2>Δεν βρέθηκε</h2></div>${closeBtn}</div><div class="sheet-b"><p class="muted">Η εγγραφή διαγράφηκε ή δεν έχετε πρόσβαση σε αυτήν.</p></div>`;
  if (!html) { el.hidden = true; bd.hidden = true; el.innerHTML = ''; el.dataset.key = ''; return; }
  const key = sheet + ':' + id;
  const keep = el.dataset.key === key ? $('.sheet-b', el)?.scrollTop || 0 : 0;
  el.innerHTML = html;
  el.dataset.key = key;
  el.hidden = false; bd.hidden = false;
  const b = $('.sheet-b', el);
  if (b) b.scrollTop = keep;
}

function custSheet(c) {
  const insts = S.idx.ic.get(c.id) || [];
  const visits = insts.flatMap(i => S.idx.vb.get(i.id) || []).sort((a, b) => ((b.completed_date || b.scheduled_date) || '').localeCompare((a.completed_date || a.scheduled_date) || ''));
  const addr = [c.address, c.postal_code, c.city].filter(Boolean).join(', ');
  return `<div class="sheet-h"><div class="titles"><span class="tag">Πελάτης</span><h2>${esc(c.name)}</h2>${c.city ? `<div class="crumb">${esc(c.city)}</div>` : ''}</div>${closeBtn}</div>
  <div class="sheet-b">
    <div class="sheet-acts">
      ${c.phone ? `<a class="btn sm" href="${telHref(c.phone)}">${ico('phone')}<span class="mono">${esc(c.phone)}</span></a>` : ''}
      ${c.phone2 ? `<a class="btn sm" href="${telHref(c.phone2)}">${ico('phone')}<span class="mono">${esc(c.phone2)}</span></a>` : ''}
      ${addr ? `<a class="btn sm" href="${esc(gmapsSearch(addr))}" target="_blank" rel="noopener">${ico('pin')}Google Maps</a>` : ''}
      ${isAdmin() ? `<button class="btn sm" data-act="edit-cust" data-id="${c.id}">${ico('edit')}Επεξεργασία</button>` : ''}
    </div>
    <dl class="kv">
      <div class="full"><dt>Διεύθυνση</dt><dd>${esc(addr || '—')}</dd></div>
      <div><dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd></div>
      <div><dt>ΑΦΜ</dt><dd class="mono">${esc(c.vat_number || '—')}</dd></div>
    </dl>
    ${c.notes ? `<div class="note">${esc(c.notes)}</div>` : ''}
    <section class="sec"><div class="sec-h"><h3>Εγκαταστάσεις · ${insts.length}</h3>${isAdmin() ? `<button class="btn xs" data-act="new-inst" data-cust="${c.id}">${ico('plus')}Νέα εγκατάσταση</button>` : ''}</div>
      ${insts.length ? insts.map(icard).join('') : '<p class="muted small" style="margin:0">Δεν έχει καταχωρηθεί εγκατάσταση.</p>'}
    </section>
    <section class="sec"><div class="sec-h"><h3>Ιστορικό επισκέψεων</h3></div>
      ${visits.length ? `<div class="timeline">${visits.slice(0, 30).map(timelineItem).join('')}</div>` : '<p class="muted small" style="margin:0">Καμία επίσκεψη ακόμη.</p>'}
    </section>
    ${isAdmin() ? `<div><button class="btn sm danger" data-act="del-cust" data-id="${c.id}">${ico('trash')}Διαγραφή πελάτη</button></div>` : ''}
  </div>`;
}
function icard(i) {
  const s = instStatus(i);
  const sched = S.idx.sb.get(i.id);
  return `<div class="icard" data-act="open" data-type="inst" data-id="${i.id}">
    <div class="top">${pill(s)}<span class="t">${esc(instName(i))}</span></div>
    <div class="meta">
      ${sched ? `<span>Ραντεβού <b class="mono">${esc(fmtDate(sched.scheduled_date))}</b></span>` : `<span>Επόμενη <b class="mono">${esc(fmtDate(i.next_service_date))}</b>${i.next_service_date ? ` · ${esc(rel(i.next_service_date))}` : ''}</span>`}
      ${i.serial_number ? `<span class="mono">S/N ${esc(i.serial_number)}</span>` : ''}
      <span>κάθε ${i.service_interval_months} μήνες</span>
    </div>
  </div>`;
}
function instSheet(i) {
  const c = cust(i.customer_id);
  const s = instStatus(i);
  const hist = (S.idx.vb.get(i.id) || []).filter(v => v.status !== 'scheduled');
  const upcoming = (S.idx.vb.get(i.id) || []).filter(v => v.status === 'scheduled').sort(byWhen);
  const nav = navHref(i);
  const next = i.next_service_date;
  const hot = s === 'overdue' || s === 'soon';
  const wExp = i.warranty_until && i.warranty_until < today();
  return `<div class="sheet-h"><div class="titles"><span class="tag">Εγκατάσταση${i.category ? ' · ' + esc(i.category) : ''}</span><h2>${esc(instName(i))}</h2>
    <div class="crumb"><button class="link-btn" data-act="open" data-type="cust" data-id="${i.customer_id}">${esc(c?.name || '—')}</button>${instAddr(i) ? ' · ' + esc(instAddr(i)) : ''}</div></div>${closeBtn}</div>
  <div class="sheet-b">
    <div class="sheet-acts">
      ${!upcoming.length && i.active !== false ? `<button class="btn sm primary" data-act="sched" data-inst="${i.id}">${ico('plus')}Κλείσε ραντεβού</button>` : ''}
      <button class="btn sm" data-act="record" data-inst="${i.id}">${ico('clip')}Καταχώρηση εργασίας</button>
      ${nav ? `<a class="btn sm" href="${esc(nav)}" target="_blank" rel="noopener">${ico('nav')}Πλοήγηση</a>` : ''}
      ${c?.phone ? `<a class="btn sm" href="${telHref(c.phone)}">${ico('phone')}Κλήση</a>` : ''}
      ${isAdmin() ? `<button class="btn sm" data-act="edit-inst" data-id="${i.id}">${ico('edit')}Επεξεργασία</button>` : ''}
    </div>
    <div>${pill(s)}</div>
    <div class="dates">
      <div class="date-box"><span class="lbl">Τελευταία συντήρηση</span><span class="val">${esc(fmtDate(i.last_service_date))}</span><span class="rel">${i.last_service_date ? esc(rel(i.last_service_date)) : 'δεν έχει καταγραφεί'}</span></div>
      <div class="date-box ${hot ? 'hot st-' + s : ''}"><span class="lbl">Επόμενη συντήρηση</span><span class="val">${esc(fmtDate(next))}</span><span class="rel">${next ? esc(rel(next)) : 'ορίστε ημερομηνία'}</span></div>
    </div>
    ${upcoming.length ? `<section class="sec"><div class="sec-h"><h3>Κλεισμένα ραντεβού</h3></div><div class="rows">${upcoming.map(v => visitRow(v, { date: true })).join('')}</div></section>` : ''}
    <dl class="kv">
      <div><dt>Μάρκα</dt><dd>${esc(i.brand || '—')}</dd></div>
      <div><dt>Μοντέλο</dt><dd>${esc(i.model || '—')}</dd></div>
      <div><dt>Σειριακός αριθμός</dt><dd class="mono">${esc(i.serial_number || '—')}</dd></div>
      <div><dt>Ισχύς</dt><dd class="mono">${i.power_kw != null ? esc(fmtNum(i.power_kw)) + ' kW' : '—'}</dd></div>
      <div><dt>Εγκατάσταση</dt><dd>${esc(fmtDate(i.install_date))}</dd></div>
      <div><dt>Εγγύηση έως</dt><dd>${esc(fmtDate(i.warranty_until))}${wExp ? ' <span class="muted small">(έληξε)</span>' : ''}</dd></div>
      <div><dt>Συντήρηση κάθε</dt><dd>${i.service_interval_months} μήνες</dd></div>
      <div><dt>Θέση στον χάρτη</dt><dd class="mono small">${hasLoc(i) ? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}` : '<span class="muted">δεν έχει οριστεί</span>'}</dd></div>
    </dl>
    ${i.notes ? `<div class="note">${esc(i.notes)}</div>` : ''}
    <section class="sec"><div class="sec-h"><h3>Ιστορικό</h3></div>
      ${hist.length ? `<div class="timeline">${hist.map(timelineItem).join('')}</div>` : '<p class="muted small" style="margin:0">Δεν έχει καταγραφεί εργασία.</p>'}
    </section>
    ${isAdmin() ? `<div><button class="btn sm danger" data-act="del-inst" data-id="${i.id}">${ico('trash')}Διαγραφή εγκατάστασης</button></div>` : ''}
  </div>`;
}
function visitSheet(v) {
  const i = inst(v.installation_id);
  const c = cust(v.customer_id || i?.customer_id);
  const p = prof(v.assigned_to);
  const edit = canEditVisit(v);
  const nav = i ? navHref(i) : null;
  const log = Array.isArray(v.reschedule_log) ? v.reschedule_log : [];
  return `<div class="sheet-h"><div class="titles"><span class="tag">Επίσκεψη · ${KINDS[v.kind] || ''}</span><h2>${esc(c?.name || '—')}</h2>
    <div class="crumb"><button class="link-btn" data-act="open" data-type="inst" data-id="${v.installation_id}">${esc(instName(i))}</button>${i && instAddr(i) ? ' · ' + esc(instAddr(i)) : ''}</div></div>${closeBtn}</div>
  <div class="sheet-b">
    <div class="sheet-acts">
      ${v.status === 'scheduled' && edit ? `<button class="btn sm primary" data-act="complete" data-id="${v.id}">${ico('check')}Ολοκλήρωση</button><button class="btn sm" data-act="resched" data-id="${v.id}">${ico('clock')}Μετάθεση</button><button class="btn sm" data-act="cancel" data-id="${v.id}">${ico('x')}Ακύρωση</button>` : ''}
      ${nav ? `<a class="btn sm" href="${esc(nav)}" target="_blank" rel="noopener">${ico('nav')}Πλοήγηση</a>` : ''}
      ${c?.phone ? `<a class="btn sm" href="${telHref(c.phone)}">${ico('phone')}<span class="mono">${esc(c.phone)}</span></a>` : ''}
      ${edit ? `<button class="btn sm" data-act="edit-visit" data-id="${v.id}">${ico('edit')}Επεξεργασία</button>` : ''}
      ${v.status !== 'scheduled' && edit ? `<button class="btn sm" data-act="reopen" data-id="${v.id}">${ico('undo')}Επαναφορά σε ανοιχτή</button>` : ''}
    </div>
    <div>${vpill(v)}</div>
    <dl class="kv">
      <div><dt>Ημερομηνία</dt><dd>${esc(cap(fDay.format(parseISO(v.scheduled_date))))}</dd></div>
      <div><dt>Ώρα</dt><dd class="mono">${esc(fmtTime(v.scheduled_time) || '—')}${v.duration_min ? ` <span class="muted small">· ${v.duration_min}′</span>` : ''}</dd></div>
      <div><dt>Τεχνικός</dt><dd>${techChip(p)}</dd></div>
      ${v.status === 'done' ? `<div><dt>Ολοκληρώθηκε</dt><dd>${esc(fmtDate(v.completed_date))}</dd></div>` : ''}
      ${v.cost != null ? `<div><dt>Κόστος</dt><dd class="mono">${esc(fmtMoney(v.cost))}</dd></div>` : ''}
      ${v.status === 'done' ? `<div><dt>Φύλλο ελέγχου</dt><dd>${v.control_sheet ? 'Εκδόθηκε' : 'Όχι'}</dd></div>` : ''}
      ${v.next_due_date ? `<div><dt>Επόμενη συντήρηση</dt><dd>${esc(fmtDate(v.next_due_date))}</dd></div>` : ''}
    </dl>
    ${v.work_done ? `<section class="sec"><div class="sec-h"><h3>Εργασίες</h3></div><div class="note">${esc(v.work_done)}</div></section>` : ''}
    ${measLine(v.measurements) ? `<section class="sec"><div class="sec-h"><h3>Μετρήσεις καυσαερίων</h3></div>${measLine(v.measurements)}</section>` : ''}
    ${v.notes ? `<section class="sec"><div class="sec-h"><h3>Σημειώσεις</h3></div><div class="note">${esc(v.notes)}</div></section>` : ''}
    ${log.length ? `<section class="sec"><div class="sec-h"><h3>Μεταθέσεις · ${log.length}</h3></div><div class="timeline">${log.slice().reverse().map(l => `<div class="tl" style="cursor:default"><div class="h"><span class="d">${esc(fmtDay(l.from_date))}${l.from_time ? ' ' + esc(fmtTime(l.from_time)) : ''} → ${esc(fmtDay(l.to_date))}${l.to_time ? ' ' + esc(fmtTime(l.to_time)) : ''}</span></div><div class="b">${esc(l.reason || 'Χωρίς αιτιολογία')}<span class="muted small"> · ${esc(prof(l.by)?.full_name || '')} ${l.at ? esc(fStamp.format(new Date(l.at))) : ''}</span></div></div>`).join('')}</div></section>` : ''}
    ${isAdmin() ? `<div><button class="btn sm danger" data-act="del-visit" data-id="${v.id}">${ico('trash')}Διαγραφή επίσκεψης</button></div>` : ''}
  </div>`;
}

/* =====================================================================
   Φόρμες
   ===================================================================== */
const fld = (label, inner, o = {}) => `<div class="field ${o.cls || ''}">${label ? `<label for="${o.for || ''}">${label}</label>` : ''}${inner}${o.hint ? `<div class="hint">${o.hint}</div>` : ''}</div>`;
const inp = (name, val, o = {}) => `<input class="input ${o.mono ? 'mono' : ''}" id="f-${name}" name="${name}" value="${esc(val ?? '')}" type="${o.type || 'text'}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.im ? ` inputmode="${o.im}"` : ''}${o.ac ? ` autocomplete="${o.ac}"` : ' autocomplete="off"'}${o.dis ? ' disabled' : ''}>`;
const sel = (name, options, val, o = {}) => `<select class="input" id="f-${name}" name="${name}"${o.dis ? ' disabled' : ''}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const txt = (name, val, o = {}) => `<textarea class="input" id="f-${name}" name="${name}" rows="${o.rows || 3}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}>${esc(val ?? '')}</textarea>`;
const chk = (name, val, label) => `<label class="check"><input type="checkbox" name="${name}" id="f-${name}"${val ? ' checked' : ''}> ${label}</label>`;
const fail = msg => { throw new Error(msg); };

function openDialog({ title, body, submit = 'Αποθήκευση', danger = false, narrow = false, onSubmit, onMount }) {
  const d = $('#dlg');
  if (d.open) d.close();
  d.className = narrow ? 'narrow' : '';
  d.innerHTML = `<form class="dlg" id="dlg-form" novalidate>
    <div class="dlg-h"><h2>${esc(title)}</h2><button type="button" class="btn ghost icon sm" data-close aria-label="Κλείσιμο">${ico('x')}</button></div>
    <div class="dlg-b">${body}</div>
    <div class="dlg-f"><p class="form-err err" hidden></p><button type="button" class="btn" data-close>Άκυρο</button><button type="submit" class="btn ${danger ? 'danger solid' : 'primary'}">${esc(submit)}</button></div>
  </form>`;
  const form = $('#dlg-form');
  $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('.form-err', form);
    err.hidden = true;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await onSubmit(form, formData(form));
      if (r !== false) d.close();
    } catch (ex) {
      err.textContent = errMsg(ex);
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  d.showModal();
  onMount?.(form);
  if (!matchMedia('(max-width: 820px)').matches) {
    const first = form.querySelector('.dlg-b input:not([type=checkbox]):not([disabled]), .dlg-b select:not([disabled]), .dlg-b textarea');
    first?.focus();
  }
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = String(el.value).trim();
  }
  return o;
}
function confirmDialog({ title, text, submit, danger = true, onConfirm }) {
  openDialog({ title, narrow: true, danger, submit, body: `<p style="margin:0">${text}</p>`, onSubmit: onConfirm });
}

/* ---------- Πελάτης ---------- */
function custForm(c) {
  const e = c || {};
  openDialog({
    title: c ? 'Επεξεργασία πελάτη' : 'Νέος πελάτης',
    body: `${fld('Ονοματεπώνυμο ή επωνυμία *', inp('name', e.name), { for: 'f-name' })}
      <div class="grid2">${fld('Τηλέφωνο', inp('phone', e.phone, { type: 'tel', mono: true }), { for: 'f-phone' })}${fld('Δεύτερο τηλέφωνο', inp('phone2', e.phone2, { type: 'tel', mono: true }), { for: 'f-phone2' })}</div>
      ${fld('Email', inp('email', e.email, { type: 'email' }), { for: 'f-email' })}
      ${fld('Διεύθυνση', inp('address', e.address, { ph: 'Οδός και αριθμός' }), { for: 'f-address' })}
      <div class="grid3">${fld('Πόλη ή χωριό', inp('city', e.city), { for: 'f-city', cls: 'span2' })}${fld('Τ.Κ.', inp('postal_code', e.postal_code, { mono: true, im: 'numeric' }), { for: 'f-postal_code' })}</div>
      ${fld('ΑΦΜ', inp('vat_number', e.vat_number, { mono: true, im: 'numeric' }), { for: 'f-vat_number' })}
      ${fld('Σημειώσεις', txt('notes', e.notes, { ph: 'π.χ. κλειδί στον γείτονα, ώρες που βρίσκεται σπίτι' }), { for: 'f-notes' })}`,
    async onSubmit(form, f) {
      if (!f.name) fail('Συμπληρώστε το όνομα του πελάτη.');
      const row = pickRow(f, ['name', 'phone', 'phone2', 'email', 'address', 'city', 'postal_code', 'vat_number', 'notes']);
      const saved = await save('customers', row, c?.id);
      toast(c ? 'Ο πελάτης ενημερώθηκε.' : 'Ο πελάτης καταχωρήθηκε.');
      if (!c) setTimeout(() => openSheet('cust', saved.id), 0);
    }
  });
}

/* ---------- Εγκατάσταση ---------- */
function instForm(i, custId) {
  const e = i || { customer_id: custId || '', service_interval_months: 12, active: true };
  const custOpts = [['', '— Επιλέξτε πελάτη —'], ...[...S.customers.values()].sort(byName).map(c => [c.id, c.name + (c.city ? ' · ' + c.city : '')])];
  const cats = [...new Set([...C.categories, e.category].filter(Boolean))];
  const ints = [...new Set([3, 6, 12, 18, 24, 36, 48, 60, Number(e.service_interval_months) || 12])].sort((a, b) => a - b);
  const c0 = cust(e.customer_id);
  const coords = hasLoc(e) ? `${Number(e.lat).toFixed(6)}, ${Number(e.lng).toFixed(6)}` : '';
  openDialog({
    title: i ? 'Επεξεργασία εγκατάστασης' : 'Νέα εγκατάσταση',
    body: `${fld('Πελάτης *', sel('customer_id', custOpts, e.customer_id), { for: 'f-customer_id' })}
      <div class="grid2">
        ${fld('Κατηγορία', sel('category', [['', '—'], ...cats.map(c => [c, c])], e.category), { for: 'f-category' })}
        ${fld('Περιγραφή', inp('title', e.title, { ph: 'π.χ. Λέβητας υπογείου' }), { for: 'f-title', hint: 'Προαιρετικά· αλλιώς εμφανίζεται κατηγορία και μοντέλο.' })}
      </div>
      <div class="grid3">
        ${fld('Μάρκα', inp('brand', e.brand), { for: 'f-brand' })}
        ${fld('Μοντέλο', inp('model', e.model), { for: 'f-model' })}
        ${fld('Σειριακός αριθμός', inp('serial_number', e.serial_number, { mono: true }), { for: 'f-serial_number' })}
      </div>
      <div class="grid3">
        ${fld('Ισχύς (kW)', inp('power_kw', e.power_kw != null ? String(e.power_kw).replace('.', ',') : '', { mono: true, im: 'decimal', ph: '24' }), { for: 'f-power_kw' })}
        ${fld('Ημ. εγκατάστασης', inp('install_date', e.install_date, { type: 'date' }), { for: 'f-install_date' })}
        ${fld('Εγγύηση έως', inp('warranty_until', e.warranty_until, { type: 'date' }), { for: 'f-warranty_until' })}
      </div>
      <div class="form-sec">Συντήρηση</div>
      <div class="grid3">
        ${fld('Συντήρηση κάθε', sel('service_interval_months', ints.map(n => [n, n === 1 ? '1 μήνα' : `${n} μήνες`]), e.service_interval_months), { for: 'f-service_interval_months' })}
        ${fld('Τελευταία συντήρηση', inp('last_service_date', e.last_service_date, { type: 'date' }), { for: 'f-last_service_date' })}
        ${fld('Επόμενη συντήρηση', inp('next_service_date', e.next_service_date, { type: 'date' }), { for: 'f-next_service_date', hint: 'Αν μείνει κενή, υπολογίζεται αυτόματα.' })}
      </div>
      <div class="form-sec">Θέση</div>
      <div class="grid3">
        ${fld('Διεύθυνση εγκατάστασης', inp('address', e.address, { ph: c0?.address || 'Ίδια με του πελάτη' }), { for: 'f-address', cls: 'span2' })}
        ${fld('Πόλη ή χωριό', inp('city', e.city, { ph: c0?.city || '' }), { for: 'f-city' })}
      </div>
      ${fld('Συντεταγμένες', inp('coords', coords, { mono: true, ph: '39.639000, 22.419100 ή σύνδεσμος Google Maps' }), { for: 'f-coords', hint: 'Πατήστε στον χάρτη ή σύρετε την πινέζα. Μπορείτε και να επικολλήσετε συντεταγμένες ή σύνδεσμο από το Google Maps.' })}
      <div class="quick">
        <button type="button" class="btn sm" data-geo>${ico('search')}Εύρεση από διεύθυνση</button>
        <button type="button" class="btn sm" data-here>${ico('locate')}Η θέση μου τώρα</button>
        <button type="button" class="btn sm ghost" data-clear>Καθαρισμός</button>
      </div>
      <div class="geo-results" id="geo-res"></div>
      <div class="pick-map" id="pick-map"></div>
      <div class="form-sec">Λοιπά</div>
      ${fld('Σημειώσεις', txt('notes', e.notes, { ph: 'π.χ. τύπος καμινάδας, ανταλλακτικά, ιδιαιτερότητες' }), { for: 'f-notes' })}
      ${chk('active', e.active !== false, 'Ενεργή (εμφανίζεται στον προγραμματισμό συντηρήσεων)')}`,
    onMount(form) {
      initPicker(form);
      const custSel = form.customer_id;
      custSel.addEventListener('change', () => {
        const c = cust(custSel.value);
        form.address.placeholder = c?.address || 'Ίδια με του πελάτη';
        form.city.placeholder = c?.city || '';
      });
      $('[data-geo]', form).addEventListener('click', async () => {
        const c = cust(custSel.value);
        const a = form.address.value || c?.address || '';
        const city = form.city.value || c?.city || '';
        const res = $('#geo-res', form);
        if (!a && !city) { res.innerHTML = '<span class="hint">Συμπληρώστε διεύθυνση ή πόλη (εδώ ή στον πελάτη).</span>'; return; }
        res.innerHTML = '<span class="hint">Αναζήτηση…</span>';
        try {
          let list = await geocode([a, city, 'Ελλάδα'].filter(Boolean).join(', '));
          if (!list.length && a && city) list = await geocode(`${city}, Ελλάδα`);
          res.innerHTML = list.length
            ? list.map((r, k) => `<button type="button" data-k="${k}">${esc(r.name)}</button>`).join('') + '<span class="hint">Επιλέξτε το σωστό και διορθώστε με την πινέζα αν χρειάζεται.</span>'
            : '<span class="hint">Δεν βρέθηκε η διεύθυνση. Πατήστε απευθείας στον χάρτη.</span>';
          $$('button[data-k]', res).forEach(b => b.addEventListener('click', () => { const r = list[+b.dataset.k]; S.pickSet?.(r.lat, r.lng, true); res.innerHTML = ''; }));
        } catch (ex) { res.innerHTML = `<span class="hint">${esc(errMsg(ex))}</span>`; }
      });
      $('[data-here]', form).addEventListener('click', () => {
        if (!navigator.geolocation) { toast('Η συσκευή δεν δίνει θέση.', 'err'); return; }
        navigator.geolocation.getCurrentPosition(
          p => S.pickSet?.(p.coords.latitude, p.coords.longitude, true),
          () => toast('Δεν δόθηκε πρόσβαση στη θέση. Επιτρέψτε την από τις ρυθμίσεις του browser.', 'err'),
          { enableHighAccuracy: true, timeout: 15000 }
        );
      });
      $('[data-clear]', form).addEventListener('click', () => S.pickClear?.());
    },
    async onSubmit(form, f) {
      if (!f.customer_id) fail('Επιλέξτε πελάτη.');
      const power = parseNum(f.power_kw);
      if (Number.isNaN(power)) fail('Η ισχύς πρέπει να είναι αριθμός (π.χ. 24 ή 24,5).');
      let lat = null, lng = null;
      if (f.coords) {
        const p = parseCoords(f.coords);
        if (!p) fail('Οι συντεταγμένες δεν αναγνωρίστηκαν. Γράψτε τες ως «39.639, 22.419».');
        lat = p.lat; lng = p.lng;
      }
      const interval = Number(f.service_interval_months) || 12;
      let next = f.next_service_date || null;
      const lastChanged = i && (f.last_service_date || null) !== (i.last_service_date || null);
      const intChanged = i && interval !== i.service_interval_months;
      if (!next || (i && next === i.next_service_date && (lastChanged || intChanged))) {
        if (f.last_service_date) next = addMonths(f.last_service_date, interval);
        else if (!next && f.install_date) next = addMonths(f.install_date, interval);
      }
      const row = {
        ...pickRow(f, ['customer_id', 'category', 'title', 'brand', 'model', 'serial_number', 'install_date', 'warranty_until', 'last_service_date', 'address', 'city', 'notes']),
        power_kw: power, service_interval_months: interval, next_service_date: next, lat, lng, active: !!f.active
      };
      const saved = await save('installations', row, i?.id);
      toast(i ? 'Η εγκατάσταση ενημερώθηκε.' : 'Η εγκατάσταση καταχωρήθηκε.');
      if (!i) setTimeout(() => openSheet('inst', saved.id), 0);
    }
  });
}
function initPicker(form) {
  const box = $('#pick-map', form);
  const ci = form.coords;
  S.pickSet = null; S.pickClear = null;
  if (!box) return;
  if (!window.L) { box.hidden = true; return; }
  const cur = parseCoords(ci.value);
  const m = L.map(box).setView(cur ? [cur.lat, cur.lng] : C.mapCenter, cur ? 16 : C.mapZoom);
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTR }).addTo(m);
  let mk = null;
  const fmt = (a, b) => `${a.toFixed(6)}, ${b.toFixed(6)}`;
  const set = (lat, lng, pan) => {
    ci.value = fmt(lat, lng);
    if (!mk) {
      mk = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="pin big st-scheduled"></div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(m);
      mk.on('dragend', () => { const p = mk.getLatLng(); ci.value = fmt(p.lat, p.lng); });
    } else mk.setLatLng([lat, lng]);
    if (pan) m.setView([lat, lng], Math.max(m.getZoom(), 16));
  };
  if (cur) set(cur.lat, cur.lng);
  m.on('click', e => set(e.latlng.lat, e.latlng.lng));
  ci.addEventListener('change', () => { const p = parseCoords(ci.value); if (p) set(p.lat, p.lng, true); });
  S.pickSet = set;
  S.pickClear = () => { ci.value = ''; if (mk) { m.removeLayer(mk); mk = null; } };
  S.pickMap = m;
  setTimeout(() => m.invalidateSize(), 80);
}
async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=gr&accept-language=el&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Η αναζήτηση διεύθυνσης δεν απάντησε. Δοκιμάστε σε λίγο ή πατήστε στον χάρτη.');
  const j = await r.json();
  return j.map(x => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}

/* ---------- Επίσκεψη: προγραμματισμός / επεξεργασία ---------- */
function techOptions(allowNone) {
  const list = [...S.profiles.values()].filter(p => p.active).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'el'));
  return [...(allowNone ? [['', 'Χωρίς ανάθεση']] : []), ...list.map(p => [p.id, (p.full_name || p.email) + (p.role === 'admin' ? ' (διαχειριστής)' : '')])];
}
function instOptions(q, selected) {
  const nq = norm(q);
  let html = '<option value="">— Επιλέξτε εγκατάσταση —</option>';
  for (const c of [...S.customers.values()].sort(byName)) {
    const items = (S.idx.ic.get(c.id) || []).filter(i => (i.active !== false || i.id === selected) && (!nq || i.id === selected || norm([c.name, c.phone, instName(i), instAddr(i), i.serial_number].join(' ')).includes(nq)));
    if (!items.length) continue;
    html += `<optgroup label="${esc(c.name)}">${items.map(i => `<option value="${i.id}"${i.id === selected ? ' selected' : ''}>${esc(instName(i))}${instAddr(i) ? ' · ' + esc(instAddr(i)) : ''}</option>`).join('')}</optgroup>`;
  }
  return html;
}
function defaultDate(instId) {
  const i = inst(instId);
  const t = today();
  if (i?.next_service_date && i.next_service_date > t) return i.next_service_date;
  return addDays(t, 1);
}
function visitForm(v, preset = {}) {
  if (!S.installations.size) { toast('Καταχωρήστε πρώτα πελάτη και εγκατάσταση.', 'err'); return; }
  const admin = isAdmin();
  const e = v || {
    kind: 'maintenance', installation_id: preset.inst || '', duration_min: 60,
    scheduled_date: preset.date || defaultDate(preset.inst),
    assigned_to: admin ? '' : S.me.id
  };
  const lockInst = !!v && !admin;
  const durs = [[30, '30 λεπτά'], [60, '1 ώρα'], [90, '1,5 ώρα'], [120, '2 ώρες'], [180, '3 ώρες'], [240, '4 ώρες'], [480, 'Όλη μέρα']];
  openDialog({
    title: v ? 'Επεξεργασία ραντεβού' : 'Νέο ραντεβού',
    body: `${!lockInst && !preset.inst && !v ? fld('', `<label class="search" style="max-width:none">${ico('search')}<input class="input" id="f-instq" type="search" placeholder="Φιλτράρισμα: πελάτης, τηλέφωνο, διεύθυνση" aria-label="Φιλτράρισμα εγκαταστάσεων"></label>`) : ''}
      ${fld('Εγκατάσταση *', `<select class="input" id="f-installation_id" name="installation_id"${lockInst ? ' disabled' : ''}>${instOptions('', e.installation_id)}</select>`, { for: 'f-installation_id' })}
      <div class="grid2">
        ${fld('Είδος', sel('kind', Object.entries(KINDS), e.kind), { for: 'f-kind' })}
        ${fld('Τεχνικός', sel('assigned_to', techOptions(admin), e.assigned_to || '', { dis: !admin }), { for: 'f-assigned_to' })}
      </div>
      <div class="grid3">
        ${fld('Ημερομηνία *', inp('scheduled_date', e.scheduled_date, { type: 'date' }), { for: 'f-scheduled_date' })}
        ${fld('Ώρα', inp('scheduled_time', fmtTime(e.scheduled_time), { type: 'time' }), { for: 'f-scheduled_time' })}
        ${fld('Διάρκεια', sel('duration_min', durs, e.duration_min || 60), { for: 'f-duration_min' })}
      </div>
      <div class="hint" id="f-hint"></div>
      ${fld('Σημειώσεις', txt('notes', e.notes, { ph: 'π.χ. να φέρει ηλεκτρόδια, ο πελάτης θέλει πρωινή ώρα' }), { for: 'f-notes' })}`,
    onMount(form) {
      const q = $('#f-instq', form);
      const selEl = form.installation_id;
      const hint = $('#f-hint', form);
      const showHint = () => {
        const i = inst(selEl.value);
        hint.textContent = i ? `Επόμενη συντήρηση: ${fmtDate(i.next_service_date)}${i.next_service_date ? ' (' + rel(i.next_service_date) + ')' : ''} · κάθε ${i.service_interval_months} μήνες` : '';
      };
      q?.addEventListener('input', () => { const cur = selEl.value; selEl.innerHTML = instOptions(q.value, cur); if (!cur) { const first = selEl.querySelector('option[value]:not([value=""])'); if (first && q.value) first.selected = true; } showHint(); });
      selEl.addEventListener('change', () => { if (!v && !preset.date) form.scheduled_date.value = defaultDate(selEl.value); showHint(); });
      showHint();
    },
    async onSubmit(form, f) {
      const instId = lockInst ? v.installation_id : f.installation_id;
      if (!instId) fail('Επιλέξτε εγκατάσταση.');
      if (!f.scheduled_date) fail('Επιλέξτε ημερομηνία.');
      const row = {
        kind: f.kind, scheduled_date: f.scheduled_date, scheduled_time: f.scheduled_time || null,
        duration_min: Number(f.duration_min) || 60, notes: f.notes || null
      };
      if (admin) { row.installation_id = instId; row.assigned_to = f.assigned_to || null; }
      else if (!v) { row.installation_id = instId; row.assigned_to = S.me.id; }
      if (v && (row.scheduled_date !== v.scheduled_date || (row.scheduled_time || null) !== (fmtTime(v.scheduled_time) || null))) row.reschedule_reason = null;
      if (v && row.scheduled_time && fmtTime(v.scheduled_time) === row.scheduled_time) row.scheduled_time = v.scheduled_time;
      await save('visits', row, v?.id);
      toast(v ? 'Το ραντεβού ενημερώθηκε.' : `Κλείστηκε ραντεβού για ${fmtDay(row.scheduled_date)}.`);
    }
  });
}

/* ---------- Επίσκεψη: ολοκλήρωση ή καταχώρηση εργασίας ---------- */
function completeForm(v, instId) {
  const i = inst(v ? v.installation_id : instId);
  if (!i) return;
  const c = cust(i.customer_id);
  const admin = isAdmin();
  const rec = !v;
  const t = today();
  const date0 = v ? (v.scheduled_date <= t ? v.scheduled_date : t) : t;
  const kind0 = v ? v.kind : 'maintenance';
  const interval = i.service_interval_months || 12;
  const m0 = (v && v.measurements) || {};
  openDialog({
    title: rec ? 'Καταχώρηση εργασίας' : 'Ολοκλήρωση επίσκεψης',
    submit: rec ? 'Καταχώρηση' : 'Ολοκλήρωση',
    body: `<p class="muted small" style="margin:0">${esc(c?.name || '')} · ${esc(instName(i))}${!rec ? ' · ' + KINDS[kind0] : ''}</p>
      ${rec ? `<div class="grid2">${fld('Είδος', sel('kind', Object.entries(KINDS), kind0), { for: 'f-kind' })}${fld('Τεχνικός', sel('assigned_to', techOptions(true), admin ? '' : S.me.id, { dis: !admin }), { for: 'f-assigned_to' })}</div>` : ''}
      <div class="grid2">
        ${fld('Ημερομηνία εργασίας *', inp('completed_date', date0, { type: 'date' }), { for: 'f-completed_date' })}
        ${fld('Κόστος (€)', inp('cost', v?.cost != null ? String(v.cost).replace('.', ',') : '', { mono: true, im: 'decimal', ph: '0,00' }), { for: 'f-cost' })}
      </div>
      ${fld('Εργασίες που έγιναν', txt('work_done', v?.work_done, { rows: 4, ph: 'π.χ. καθαρισμός θαλάμου καύσης, αλλαγή ηλεκτροδίων, έλεγχος στεγανότητας' }), { for: 'f-work_done' })}
      <details class="meas-box"${Object.keys(m0).length ? ' open' : ''}><summary>Μετρήσεις καυσαερίων</summary>
        <div class="grid3 keep">${MEAS.map(([k, l, u]) => fld(`${l} (${u})`, inp('m_' + k, m0[k] != null ? String(m0[k]).replace('.', ',') : '', { mono: true, im: 'decimal' }), { for: 'f-m_' + k })).join('')}</div>
      </details>
      ${chk('control_sheet', v?.control_sheet, 'Εκδόθηκε Φύλλο Ελέγχου και Ρύθμισης')}
      <div id="next-wrap" class="stack" style="gap:12px">
        <div class="form-sec">Επόμενη συντήρηση</div>
        <div class="grid2">${fld('Ημερομηνία', inp('next_due_date', addMonths(date0, interval), { type: 'date' }), { for: 'f-next_due_date', hint: `Κάθε ${interval} μήνες από την ημερομηνία εργασίας. Αλλάξτε την αν χρειάζεται.` })}</div>
        ${chk('book_next', false, 'Κλείσε από τώρα ραντεβού για αυτή την ημερομηνία')}
      </div>
      ${fld('Σημειώσεις', txt('notes', v?.notes, { rows: 2 }), { for: 'f-notes' })}`,
    onMount(form) {
      let touched = false;
      const nd = form.next_due_date, cd = form.completed_date, wrap = $('#next-wrap', form);
      nd.addEventListener('input', () => { touched = true; });
      cd.addEventListener('change', () => { if (!touched && cd.value) nd.value = addMonths(cd.value, interval); });
      const sync = () => { const k = rec ? form.kind.value : kind0; wrap.hidden = !RESETS.includes(k); };
      if (rec) form.kind.addEventListener('change', sync);
      sync();
    },
    async onSubmit(form, f) {
      if (!f.completed_date) fail('Συμπληρώστε την ημερομηνία εργασίας.');
      if (f.completed_date > t) fail('Η ημερομηνία εργασίας δεν μπορεί να είναι μελλοντική.');
      const cost = parseNum(f.cost);
      if (Number.isNaN(cost)) fail('Το κόστος πρέπει να είναι αριθμός (π.χ. 65 ή 65,50).');
      const meas = {};
      for (const [k] of MEAS) {
        const n = parseNum(f['m_' + k]);
        if (Number.isNaN(n)) fail('Οι μετρήσεις πρέπει να είναι αριθμοί.');
        if (n != null) meas[k] = n;
      }
      const kind = rec ? f.kind : kind0;
      const resets = RESETS.includes(kind);
      const next = resets ? (f.next_due_date || null) : null;
      const row = {
        status: 'done', completed_date: f.completed_date, work_done: f.work_done || null, cost,
        measurements: Object.keys(meas).length ? meas : null, control_sheet: !!f.control_sheet,
        next_due_date: next, notes: f.notes || null
      };
      let assigned;
      if (rec) {
        assigned = admin ? (f.assigned_to || null) : S.me.id;
        await save('visits', { ...row, installation_id: i.id, kind, scheduled_date: f.completed_date, assigned_to: assigned });
      } else {
        assigned = v.assigned_to;
        await save('visits', row, v.id);
      }
      await refreshRow('installations', i.id);
      if (resets && next && f.book_next) {
        await save('visits', { installation_id: i.id, kind: 'maintenance', scheduled_date: next, assigned_to: admin ? assigned : S.me.id });
        toast(`Καταχωρήθηκε. Νέο ραντεβού: ${fmtDate(next)}.`);
      } else {
        toast(resets && next ? `Καταχωρήθηκε. Επόμενη συντήρηση: ${fmtDate(next)}.` : 'Η εργασία καταχωρήθηκε.');
      }
    }
  });
}

/* ---------- Μετάθεση / ακύρωση / επαναφορά ---------- */
function reschedForm(v, date) {
  const base = date || v.scheduled_date;
  const quick = [[1, '+1 ημέρα'], [7, '+1 εβδομάδα'], [14, '+2 εβδομάδες'], ['m1', '+1 μήνα']];
  openDialog({
    title: 'Μετάθεση ραντεβού', narrow: true, submit: 'Μετάθεση',
    body: `<p class="muted small" style="margin:0">${esc(cust(v.customer_id)?.name || '')} · τώρα ${esc(fmtDay(v.scheduled_date))} ${esc(fmtTime(v.scheduled_time))}</p>
      <div class="grid2">${fld('Νέα ημερομηνία', inp('scheduled_date', base, { type: 'date' }), { for: 'f-scheduled_date' })}${fld('Ώρα', inp('scheduled_time', fmtTime(v.scheduled_time), { type: 'time' }), { for: 'f-scheduled_time' })}</div>
      <div class="quick">${quick.map(([d, l]) => `<button type="button" class="btn xs" data-q="${d}">${l}</button>`).join('')}</div>
      ${fld('Λόγος', inp('reason', '', { ph: 'π.χ. ο πελάτης λείπει, έλλειψη ανταλλακτικού' }), { for: 'f-reason' })}
      ${v.reschedule_count ? `<p class="hint" style="margin:0">Έχει ήδη μετατεθεί ${v.reschedule_count} ${v.reschedule_count === 1 ? 'φορά' : 'φορές'}.</p>` : ''}`,
    onMount(form) {
      $$('[data-q]', form).forEach(b => b.addEventListener('click', () => {
        const cur = form.scheduled_date.value || v.scheduled_date;
        form.scheduled_date.value = b.dataset.q === 'm1' ? addMonths(cur, 1) : addDays(cur, Number(b.dataset.q));
      }));
    },
    async onSubmit(form, f) {
      if (!f.scheduled_date) fail('Επιλέξτε ημερομηνία.');
      const time = f.scheduled_time || null;
      if (f.scheduled_date === v.scheduled_date && time === (fmtTime(v.scheduled_time) || null)) fail('Επιλέξτε διαφορετική ημερομηνία ή ώρα.');
      await save('visits', { scheduled_date: f.scheduled_date, scheduled_time: time, reschedule_reason: f.reason || null }, v.id);
      toast(`Μετατέθηκε για ${fmtDay(f.scheduled_date)}.`);
    }
  });
}
function cancelForm(v) {
  openDialog({
    title: 'Ακύρωση ραντεβού', narrow: true, danger: true, submit: 'Ακύρωση ραντεβού',
    body: `<p style="margin:0">${esc(cust(v.customer_id)?.name || '')} · ${esc(fmtDay(v.scheduled_date))}</p>${fld('Λόγος', inp('reason', '', { ph: 'π.χ. ο πελάτης δεν θέλει συντήρηση φέτος' }), { for: 'f-reason' })}`,
    async onSubmit(form, f) {
      const notes = [v.notes, f.reason ? `Ακύρωση: ${f.reason}` : 'Ακυρώθηκε'].filter(Boolean).join('\n');
      await save('visits', { status: 'cancelled', notes }, v.id);
      toast('Το ραντεβού ακυρώθηκε.');
    }
  });
}

/* ---------- Χρήστες ---------- */
function userForm(p) {
  const self = p.id === S.me.id;
  const admin = isAdmin();
  openDialog({
    title: self ? 'Τα στοιχεία μου' : 'Στοιχεία χρήστη', narrow: true,
    body: `<p class="muted small" style="margin:0">${esc(p.email || '')}</p>
      ${fld('Ονοματεπώνυμο', inp('full_name', p.full_name), { for: 'f-full_name' })}
      ${fld('Τηλέφωνο', inp('phone', p.phone, { type: 'tel', mono: true }), { for: 'f-phone' })}
      ${fld('Χρώμα στο ημερολόγιο', sel('color', [['', 'Αυτόματο'], ...TECH_COLORS.map(([c, n]) => [c, n])], p.color || ''), { for: 'f-color' })}
      ${admin ? `${fld('Ρόλος', sel('role', [['technician', 'Τεχνικός: βλέπει τα πάντα, κλείνει και ολοκληρώνει τα δικά του ραντεβού'], ['admin', 'Διαχειριστής: πλήρης πρόσβαση']], p.role), { for: 'f-role' })}
        ${self ? '' : chk('active', p.active, 'Ενεργός λογαριασμός (αν το αφαιρέσετε, ο χρήστης χάνει την πρόσβαση)')}` : ''}`,
    async onSubmit(form, f) {
      const row = { full_name: f.full_name || null, phone: f.phone || null, color: f.color || null };
      if (admin) { row.role = f.role; if (!self) row.active = !!f.active; }
      await save('profiles', row, p.id);
      if (self) { S.me = S.profiles.get(p.id); buildShell(); }
      toast('Τα στοιχεία αποθηκεύτηκαν.');
    }
  });
}
function passwordForm() {
  openDialog({
    title: 'Αλλαγή κωδικού', narrow: true,
    body: `${fld('Νέος κωδικός', `<input class="input" id="f-p1" name="p1" type="password" autocomplete="new-password">`, { for: 'f-p1', hint: 'Τουλάχιστον 8 χαρακτήρες.' })}
      ${fld('Επανάληψη', `<input class="input" id="f-p2" name="p2" type="password" autocomplete="new-password">`, { for: 'f-p2' })}`,
    async onSubmit(form) {
      const a = form.p1.value, b = form.p2.value;
      if (a.length < 8) fail('Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.');
      if (a !== b) fail('Οι δύο κωδικοί δεν ταιριάζουν.');
      const { error } = await S.sb.auth.updateUser({ password: a });
      if (error) throw error;
      toast('Ο κωδικός άλλαξε.');
    }
  });
}

/* =====================================================================
   Εξαγωγή
   ===================================================================== */
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const csv = rows => '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
function exportInstallations() {
  const rows = [['Πελάτης', 'Τηλέφωνο', 'Διεύθυνση', 'Πόλη', 'Εγκατάσταση', 'Κατηγορία', 'Μάρκα', 'Μοντέλο', 'Σειριακός', 'Ισχύς kW', 'Συντήρηση κάθε (μήνες)', 'Τελευταία συντήρηση', 'Επόμενη συντήρηση', 'Επόμενο ραντεβού', 'Κατάσταση', 'Πλάτος', 'Μήκος']];
  const list = [...S.installations.values()].sort((a, b) => (cust(a.customer_id)?.name || '').localeCompare(cust(b.customer_id)?.name || '', 'el'));
  for (const i of list) {
    const c = cust(i.customer_id) || {};
    const s = S.idx.sb.get(i.id);
    rows.push([c.name, c.phone, i.address || c.address, i.city || c.city, instName(i), i.category, i.brand, i.model, i.serial_number, i.power_kw != null ? fmtNum(i.power_kw) : '', i.service_interval_months, fmtDate(i.last_service_date), fmtDate(i.next_service_date), s ? fmtDate(s.scheduled_date) : '', ISTATUS[instStatus(i)], i.lat ?? '', i.lng ?? '']);
  }
  download(`egkatastaseis-${today()}.csv`, csv(rows), 'text/csv;charset=utf-8');
}
function exportVisits() {
  const rows = [['Ημερομηνία', 'Ώρα', 'Κατάσταση', 'Είδος', 'Πελάτης', 'Εγκατάσταση', 'Τεχνικός', 'Ολοκληρώθηκε', 'Εργασίες', 'Κόστος', 'CO ppm', 'CO2 %', 'O2 %', 'Θερμ. καυσαερίων °C', 'Απόδοση %', 'Ελκυσμός Pa', 'Φύλλο ελέγχου', 'Μεταθέσεις', 'Σημειώσεις']];
  const list = [...S.visits.values()].sort((a, b) => vKey(b).localeCompare(vKey(a)));
  for (const v of list) {
    const i = inst(v.installation_id), c = cust(v.customer_id) || {}, p = prof(v.assigned_to), m = v.measurements || {};
    rows.push([fmtDate(v.scheduled_date), fmtTime(v.scheduled_time), VSTATUS[v.status], KINDS[v.kind], c.name, instName(i), p ? p.full_name || p.email : '', v.completed_date ? fmtDate(v.completed_date) : '', v.work_done, v.cost != null ? fmtNum(v.cost) : '', ...MEAS.map(([k]) => m[k] != null ? fmtNum(m[k]) : ''), v.control_sheet ? 'Ναι' : '', v.reschedule_count || '', v.notes]);
  }
  download(`episkepseis-${today()}.csv`, csv(rows), 'text/csv;charset=utf-8');
}
function exportJSON() {
  const data = { app: C.appName, version: VERSION, exported_at: new Date().toISOString() };
  for (const t of TABLES) data[t] = [...S[t].values()];
  download(`gastherm-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/* =====================================================================
   Ενέργειες
   ===================================================================== */
const getVisit = id => S.visits.get(id);
const ACTIONS = {
  open: d => openSheet(d.type, d.id),
  'close-sheet': () => closeSheet(),
  scope: d => { S.ui.scope = d.v; saveUi(); renderView(); refreshShell(); },
  kpi: d => {
    if (d.k === 'overdue' || d.k === 'soon') { S.ui.instStatus = d.k; S.ui.instQ = ''; saveUi(); go('installations'); }
    else $('#p-' + d.k)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'new-visit': d => visitForm(null, { date: d.date || (S.route.view === 'calendar' ? S.ui.calDay : undefined), inst: d.inst }),
  sched: d => visitForm(null, { inst: d.inst }),
  record: d => completeForm(null, d.inst),
  complete: d => { const v = getVisit(d.id); if (v) completeForm(v); },
  resched: d => { const v = getVisit(d.id); if (v) reschedForm(v, d.date); },
  cancel: d => { const v = getVisit(d.id); if (v) cancelForm(v); },
  reopen: d => {
    const v = getVisit(d.id); if (!v) return;
    confirmDialog({
      title: 'Επαναφορά σε ανοιχτή', danger: false, submit: 'Επαναφορά',
      text: 'Η επίσκεψη θα ξαναγίνει προγραμματισμένη. Οι ημερομηνίες συντήρησης της εγκατάστασης δεν αλλάζουν αυτόματα· διορθώστε τες στην εγκατάσταση αν χρειάζεται.',
      onConfirm: async () => { await save('visits', { status: 'scheduled' }, v.id); toast('Η επίσκεψη είναι ξανά ανοιχτή.'); }
    });
  },
  'edit-visit': d => { const v = getVisit(d.id); if (v) visitForm(v); },
  'del-visit': d => {
    const v = getVisit(d.id); if (!v) return;
    confirmDialog({ title: 'Διαγραφή επίσκεψης', submit: 'Διαγραφή', text: 'Η επίσκεψη και οι μετρήσεις της θα διαγραφούν οριστικά.', onConfirm: async () => { await removeRow('visits', v.id); closeSheet(); toast('Η επίσκεψη διαγράφηκε.'); } });
  },
  'new-cust': () => custForm(null),
  'edit-cust': d => { const c = cust(d.id); if (c) custForm(c); },
  'del-cust': d => {
    const c = cust(d.id); if (!c) return;
    const n = (S.idx.ic.get(c.id) || []).length;
    confirmDialog({
      title: 'Διαγραφή πελάτη', submit: 'Οριστική διαγραφή',
      text: `Θα διαγραφεί ο πελάτης <b>${esc(c.name)}</b>${n ? `, οι ${n} εγκαταστάσεις του και όλο το ιστορικό επισκέψεων` : ''}. Η ενέργεια δεν αναιρείται.`,
      onConfirm: async () => {
        await removeRow('customers', c.id);
        for (const i of [...S.installations.values()]) if (i.customer_id === c.id) S.installations.delete(i.id);
        for (const v of [...S.visits.values()]) if (v.customer_id === c.id) S.visits.delete(v.id);
        closeSheet(); invalidate(); toast('Ο πελάτης διαγράφηκε.');
      }
    });
  },
  'new-inst': d => { if (!S.customers.size) { toast('Καταχωρήστε πρώτα πελάτη.', 'err'); custForm(null); return; } instForm(null, d.cust); },
  'edit-inst': d => { const i = inst(d.id); if (i) instForm(i); },
  'del-inst': d => {
    const i = inst(d.id); if (!i) return;
    confirmDialog({
      title: 'Διαγραφή εγκατάστασης', submit: 'Οριστική διαγραφή',
      text: `Θα διαγραφεί η εγκατάσταση <b>${esc(instName(i))}</b> και όλο το ιστορικό της. Αν απλώς δεν τη συντηρείτε πια, προτιμήστε να την κάνετε «ανενεργή» από την επεξεργασία.`,
      onConfirm: async () => {
        await removeRow('installations', i.id);
        for (const v of [...S.visits.values()]) if (v.installation_id === i.id) S.visits.delete(v.id);
        closeSheet(); invalidate(); toast('Η εγκατάσταση διαγράφηκε.');
      }
    });
  },
  ist: d => { S.ui.instStatus = d.v; saveUi(); renderBody(); },
  mst: d => { const s = new Set(S.ui.mapSt); s.has(d.v) ? s.delete(d.v) : s.add(d.v); S.ui.mapSt = [...s]; saveUi(); renderBody(); },
  'goto-noloc': () => { S.ui.instStatus = 'noloc'; saveUi(); go('installations'); },
  'cal-prev': () => shiftMonth(-1),
  'cal-next': () => shiftMonth(1),
  'cal-today': () => { S.ui.calMonth = today().slice(0, 7); S.ui.calDay = today(); renderView(); },
  'cal-day': d => {
    S.ui.calDay = d.d;
    if (d.d.slice(0, 7) !== S.ui.calMonth) { S.ui.calMonth = d.d.slice(0, 7); renderView(); }
    else renderBody();
    if (matchMedia('(max-width: 1100px)').matches) $('#p-day')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  'edit-user': d => { const p = prof(d.id); if (p) userForm(p); },
  password: () => passwordForm(),
  logout: () => S.sb.auth.signOut(),
  'export-csv': () => exportInstallations(),
  'export-visits': () => exportVisits(),
  'export-json': () => exportJSON()
};
function shiftMonth(n) {
  const [y, m] = S.ui.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  S.ui.calMonth = toISO(d).slice(0, 7);
  S.ui.calDay = S.ui.calMonth === today().slice(0, 7) ? today() : toISO(d);
  renderView();
}

function handleClick(e) {
  if (e._gsHandled) return;
  e._gsHandled = true;
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = e.target.closest('a[href]');
  if (a && a !== el && el.contains(a)) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el.dataset, el, e);
}
document.addEventListener('click', handleClick);
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q-cust') { S.ui.custQ = t.value; renderBodySoon(); }
  else if (t.id === 'q-inst') { S.ui.instQ = t.value; renderBodySoon(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  const set = { 's-cust': 'custSort', 'flt-cat': 'instCat', 'flt-mapcat': 'mapCat', 'flt-caltech': 'calTech' }[t.id];
  if (set) { S.ui[set] = t.value; saveUi(); renderBody(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#dlg').open && S.route.sheet) closeSheet();
});
// Μετάθεση με σύρσιμο στο ημερολόγιο (υπολογιστής)
document.addEventListener('dragstart', e => {
  const c = e.target.closest?.('[data-drag]');
  if (!c) return;
  e.dataTransfer.setData('text/plain', c.dataset.drag);
  e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', e => {
  const cell = e.target.closest?.('[data-drop]');
  if (!cell) return;
  e.preventDefault();
  $$('.cell.drop').forEach(x => x !== cell && x.classList.remove('drop'));
  cell.classList.add('drop');
});
document.addEventListener('dragleave', e => { const cell = e.target.closest?.('[data-drop]'); if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('drop'); });
document.addEventListener('drop', e => {
  const cell = e.target.closest?.('[data-drop]');
  if (!cell) return;
  e.preventDefault();
  cell.classList.remove('drop');
  const v = getVisit(e.dataTransfer.getData('text/plain'));
  if (v && v.scheduled_date !== cell.dataset.drop) reschedForm(v, cell.dataset.drop);
});
$('#dlg').addEventListener('close', () => { if (S.pickMap) { S.pickMap.remove(); S.pickMap = null; } S.pickSet = null; S.pickClear = null; });
window.addEventListener('hashchange', onRoute);
window.addEventListener('offline', () => setLive('off'));
setInterval(() => { if (S.me) invalidate(); }, 5 * 60 * 1000);

/* =====================================================================
   Προτιμήσεις προβολής (μόνο σε αυτή τη συσκευή)
   ===================================================================== */
const UI_KEY = 'gastherm-ui-v1';
function loadUi() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { saved = {}; }
  S.ui = Object.assign({
    scope: isAdmin() ? 'all' : 'mine', custSort: 'name', instStatus: 'all', instCat: '',
    mapSt: [...MSTATUS], mapCat: '', calTech: ''
  }, saved, { custQ: '', instQ: '', calMonth: today().slice(0, 7), calDay: today() });
  if (!Array.isArray(S.ui.mapSt)) S.ui.mapSt = [...MSTATUS];
}
function saveUi() {
  try {
    const { scope, custSort, instStatus, instCat, mapSt, mapCat, calTech } = S.ui;
    localStorage.setItem(UI_KEY, JSON.stringify({ scope, custSort, instStatus, instCat, mapSt, mapCat, calTech }));
  } catch { /* η αποθήκευση προτιμήσεων δεν είναι απαραίτητη */ }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.title = C.appName;
boot();
