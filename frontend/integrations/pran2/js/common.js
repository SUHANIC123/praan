/**
 * common.js — shared utilities for all Pran patient portal pages
 */

const API_BASE   = window.location.protocol === 'file:' ? 'http://localhost:3001' : '';
const SOCKET_URL = window.location.protocol === 'file:' ? 'http://localhost:3001' : window.location.origin;

// ─── Distance & time ──────────────────────────────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return s > 0 ? `${m} min ${s} sec` : `${m} min`;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function getEmergencyId()  { return new URLSearchParams(window.location.search).get('id'); }
function getShareToken()   { return new URLSearchParams(window.location.search).get('token'); }
function getParam(name)    { return new URLSearchParams(window.location.search).get(name); }

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function formatClock(date) {
  return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function reverseGeocode(lat, lng) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
}

async function forwardGeocode(address) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
    const data = await res.json();
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
  } catch { return null; }
}

// ─── Toast notifications ──────────────────────────────────────────────────────

let _toastContainer = null;

function getToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.style.cssText = [
    'position:fixed', 'top:80px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:9999', 'display:flex', 'flex-direction:column', 'align-items:center',
    'gap:8px', 'pointer-events:none'
  ].join(';');
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

function showToast(message, type = 'info') {
  const colors = {
    info:    'background:#1e293b;color:#f8fafc',
    success: 'background:#064e3b;color:#d1fae5',
    warning: 'background:#78350f;color:#fef3c7',
    error:   'background:#7f1d1d;color:#fee2e2'
  };
  const toast = document.createElement('div');
  toast.style.cssText = [
    colors[type] || colors.info,
    'padding:10px 20px', 'border-radius:9999px',
    'font-size:14px', 'font-weight:600', 'font-family:Inter,sans-serif',
    'box-shadow:0 4px 20px rgba(0,0,0,0.25)',
    'opacity:0', 'transition:opacity 0.25s ease',
    'pointer-events:auto', 'white-space:nowrap'
  ].join(';');
  toast.textContent = message;
  getToastContainer().appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Smooth number animation ──────────────────────────────────────────────────

function animateNumber(element, from, to, durationMs = 800) {
  const start = performance.now();
  function step(now) {
    const t        = Math.min((now - start) / durationMs, 1);
    const eased    = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    const current  = Math.round(from + (to - from) * eased);
    element.textContent = current;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http / older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ─── Offline / online detection ───────────────────────────────────────────────

(function initOfflineBanner() {
  let banner = null;

  function showOfflineBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#7f1d1d', 'color:#fee2e2',
      'font-size:13px', 'font-weight:600', 'font-family:Inter,sans-serif',
      'padding:10px 20px', 'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.3)'
    ].join(';');
    banner.innerHTML = `
      <span>⚠ You appear to be offline. Emergency request may not go through.</span>
      <button onclick="location.reload()" style="background:rgba(255,255,255,0.2);border:none;color:inherit;padding:4px 12px;border-radius:20px;cursor:pointer;font-weight:700">Retry</button>
    `;
    document.body.prepend(banner);
  }

  function hideOfflineBanner() {
    if (banner) { banner.remove(); banner = null; }
    showToast('Back online', 'success');
  }

  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online',  hideOfflineBanner);
  if (!navigator.onLine) {
    document.addEventListener('DOMContentLoaded', showOfflineBanner, { once: true });
  }
})();

// ─── Constants ────────────────────────────────────────────────────────────────

const AMB_COLORS = {
  BLS:      '#3b82f6',
  ALS:      '#f97316',
  ICU:      '#b8101e',
  Neonatal: '#a855f7'
};
