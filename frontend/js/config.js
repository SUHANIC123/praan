// Global config shared by all pages
const CONFIG = {
  API_BASE: 'http://localhost:3001/api',
  SOCKET_URL: 'http://localhost:3001',
  /* Manipal University Jaipur — campus area (Dehmi Kalan) */
  DEFAULT_LAT: 26.8433,
  DEFAULT_LNG: 75.5655,
  /**
   * Paste your browser Maps key here so the map works even if /api/config/client cannot be reached.
   * Should match GOOGLE_MAPS_API_KEY in backend/.env (Maps JavaScript API + Directions API enabled).
   */
  GOOGLE_MAPS_API_KEY: 'AIzaSyBwaeImlXfKbluZWSsSONs4J0ETNu2Hrz8',
  // OpenRouteService — still used by the API server for dispatch/matrix (not the track map)
  ORS_API_KEY: '5b3ce3597851110001cf62485eb83b6eeaab45eea4bc48b4b7e86b54',
  /** WhatsApp (E.164, no +) for paramedic / crew voice coordination — opens wa.me chat */
  PARAMEDIC_WHATSAPP_E164: '919082615043'
};

// googleMapsCore.js reads window.CONFIG; top-level `const` does not create window.CONFIG in browsers.
window.CONFIG = CONFIG;

// Session helpers — store active incident in localStorage
const Session = {
  setIncident(id, shareToken) {
    localStorage.setItem('pran_incident_id', id);
    localStorage.setItem('pran_share_token', shareToken || '');
  },
  getIncidentId() { return localStorage.getItem('pran_incident_id'); },
  getShareToken() { return localStorage.getItem('pran_share_token'); },
  clear() {
    localStorage.removeItem('pran_incident_id');
    localStorage.removeItem('pran_share_token');
  }
};

/** Logged-in patient session (JWT + profile snapshot) */
const Auth = {
  TOKEN_KEY: 'pran_auth_token',
  USER_KEY: 'pran_user',
  getToken() { return localStorage.getItem(this.TOKEN_KEY); },
  setSession(token, user) {
    if (token) localStorage.setItem(this.TOKEN_KEY, token);
    else localStorage.removeItem(this.TOKEN_KEY);
    if (user) localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(this.USER_KEY);
    if (typeof updateNavAuthUI === 'function') updateNavAuthUI();
  },
  getUser() {
    try {
      const s = localStorage.getItem(this.USER_KEY);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
  clear() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    if (typeof updateNavAuthUI === 'function') updateNavAuthUI();
  },
  isLoggedIn() { return !!this.getToken(); },
  logout() {
    this.clear();
    window.location.href = 'login.html';
  }
};

function updateNavAuthUI() {
  const user = Auth.getUser();
  const logged = Auth.isLoggedIn() && user;
  const name = logged ? (user.name || 'User') : 'Guest';
  const av = logged ? String(user.name || 'U')[0].toUpperCase() : 'G';
  document.querySelectorAll('[data-nav-username]').forEach(el => { el.textContent = name; });
  document.querySelectorAll('[data-nav-avatar]').forEach(el => { el.textContent = av; });
  document.querySelectorAll('[data-auth-show]').forEach(el => { el.style.display = logged ? '' : 'none'; });
  document.querySelectorAll('[data-guest-show]').forEach(el => { el.style.display = logged ? 'none' : ''; });
}

if (typeof window !== 'undefined') {
  window.Auth = Auth;
  window.updateNavAuthUI = updateNavAuthUI;
  document.addEventListener('DOMContentLoaded', updateNavAuthUI);
}

// Toast utility
function showToast(msg, type = '', duration = 3500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, duration);
}

// API helper
async function apiFetch(path, options = {}) {
  const res = await fetch(CONFIG.API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { error: res.status === 404 ? 'Not found (check API URL or restart backend)' : (res.statusText || 'Bad response') };
  }
  if (!res.ok) {
    const msg = [data.error, data.hint].filter(Boolean).join(' — ');
    throw new Error(msg || 'Request failed');
  }
  return data;
}

/** Same as apiFetch but sends Bearer token when logged in */
async function apiFetchAuth(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const t = Auth.getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  return apiFetch(path, { ...options, headers });
}

// Haversine distance (km)
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
