// Pran dispatch UI — wired to main Pran backend (/api + /api/portal). Copied/adapted from pran2.
(function () {
  const API_BASE = window.PORTAL_API_ORIGIN || 'http://localhost:3001';
  const SOCKET_URL = window.PORTAL_SOCKET_ORIGIN || API_BASE;
  const API = API_BASE + '/api';

  const dispatchSocket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
  const AMB_COLORS = { BLS: '#3b82f6', ALS: '#f97316', ICU: '#b8101e', NEONATAL: '#a855f7', Neonatal: '#a855f7' };

  let dispatchLat = 26.8433, dispatchLng = 75.5655;
  let dispatchMap, ambLayer = [], hospitalLayer = [], incidentLayer = [];

  function showToast(msg) {
    if (window.console) console.info('[dispatch]', msg);
  }

  async function initDispatchMap() {
    dispatchMap = new google.maps.Map(document.getElementById('dispatch-map'), {
      mapId: 'dispatch_pran_portal',
      center: { lat: dispatchLat, lng: dispatchLng },
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM }
    });
  }

  async function createMarker(map, lat, lng, htmlContent, popupContent) {
    const div = document.createElement('div');
    div.innerHTML = htmlContent;
    const MarkerCtor = google.maps.marker && google.maps.marker.AdvancedMarkerElement;
    let marker;
    if (MarkerCtor) {
      marker = new MarkerCtor({ map, position: { lat, lng }, content: div });
    } else {
      marker = new google.maps.Marker({
        map,
        position: { lat, lng },
        icon: { url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="#b8101e"/></svg>') }
      });
    }
    if (popupContent) {
      const info = new google.maps.InfoWindow({ content: popupContent });
      marker.addListener('click', () => {
        if (marker.position) info.open({ anchor: marker, map });
        else info.open(map, marker);
      });
    }
    return marker;
  }

  async function loadDispatchAmbulances() {
    try {
      const res = await fetch(`${API}/ambulances/nearby?lat=${dispatchLat}&lng=${dispatchLng}&maxDistance=50000`);
      if (!res.ok) return;
      const ambulances = await res.json();
      ambLayer.forEach(m => {
        if (m.map !== undefined) m.map = null;
        else if (m.setMap) m.setMap(null);
      });
      ambLayer = [];
      for (const amb of ambulances) {
        const coords = amb.location && amb.location.coordinates;
        if (!coords) continue;
        const [lng, lat] = coords;
        const color = AMB_COLORS[amb.type] || '#3b82f6';
        const label = amb.unitId || amb.licensePlate || 'AMB';
        const h = `<div style="background:${color};color:white;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25)">${label} · ${amb.type}</div>`;
        const crew = (amb.crew && amb.crew[0]) ? amb.crew.map(c => c.name).join(', ') : '';
        ambLayer.push(await createMarker(dispatchMap, lat, lng, h, `<b>${amb.type} — ${label}</b><br>${crew ? 'Crew: ' + crew + '<br>' : ''}Status: ${amb.status}`));
      }
    } catch (e) { console.warn('Ambulance load failed:', e.message); }
  }

  async function loadDispatchHospitals() {
    try {
      const res = await fetch(`${API}/hospitals/nearby?lat=${dispatchLat}&lng=${dispatchLng}&maxDistance=50000`);
      if (!res.ok) return;
      const hospitals = await res.json();
      hospitalLayer.forEach(m => {
        if (m.map !== undefined) m.map = null;
        else if (m.setMap) m.setMap(null);
      });
      hospitalLayer = [];
      for (const h of hospitals) {
        const coords = h.location && h.location.coordinates;
        if (!coords) continue;
        const [lng, lat] = coords;
        const short = h.name.split(' ').slice(0, 2).join(' ');
        const hHTML = `<div style="background:#004779;color:white;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25)">🏥 ${short}</div>`;
        const bedInfo = `Beds: ${h.availableBeds ?? '—'} · ICU free: ${h.availableIcuBeds ?? '—'}`;
        hospitalLayer.push(await createMarker(dispatchMap, lat, lng, hHTML, `<b>${h.name}</b><br>${h.address || ''}<br><small>${bedInfo}</small>`));
      }
    } catch (e) { console.warn('Hospital load failed:', e.message); }
  }

  async function loadPortalQueue(dispatchQueue) {
    try {
      const res = await fetch(`${API}/portal/incidents?dispatchQueue=${dispatchQueue}&limit=100`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.warn('Portal incidents failed:', e.message);
      return [];
    }
  }

  async function loadPortalStats() {
    try {
      const res = await fetch(`${API}/portal/stats`);
      if (!res.ok) return;
      const s = await res.json();
      const el = document.getElementById('stat-tracking');
      if (el) el.textContent = `${s.incidentsTracking || 0} Tracking`;
      const pe = document.getElementById('stat-pending');
      if (pe) pe.textContent = `${s.pendingDispatch || 0} Pending`;
      const en = document.getElementById('stat-enroute');
      if (en) en.textContent = `${s.ambulancesEnRouteTotal || 0} En Route`;
      const av = document.getElementById('stat-available');
      if (av) av.textContent = `${s.ambulancesAvailable || 0} Available`;
      const badge = document.getElementById('incident-count-badge');
      if (badge) badge.textContent = `${(s.pendingDispatch || 0) + (s.incidentsTracking || 0)}`;
    } catch (_) {}
  }

  function severityColor(sev) {
    if (sev === 'Critical' || sev === 'High') return '#b8101e';
    if (sev === 'Medium') return '#f97316';
    return '#eab308';
  }

  function renderPendingQueue(incidents) {
    const queue = document.getElementById('dispatch-pending-queue');
    if (!queue) return;
    if (!incidents.length) {
      queue.innerHTML = '<p class="text-center text-slate-400 text-xs py-4 px-2">No pending requests.</p>';
      return;
    }
    queue.innerHTML = incidents.map(inc => {
      const sev = inc.severity || 'Medium';
      const col = severityColor(sev);
      const addr = (inc.pickupLocation && inc.pickupLocation.address) ? inc.pickupLocation.address : '—';
      const caseType = inc.caseType || 'Emergency';
      const phone = (inc.patient && inc.patient.phone) ? inc.patient.phone : '';
      return `
      <div class="incident-card shrink-0 bg-surface-container-lowest rounded-lg shadow-[0_4px_24px_rgba(24,29,26,0.07)] p-4 relative overflow-hidden transition-transform active:scale-95"
           data-id="${inc._id}">
        <div class="absolute left-0 top-0 bottom-0 w-1" style="background:${col}"></div>
        <div class="flex justify-between items-start mb-3">
          <span class="text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter" style="background:${col}">${sev}</span>
          <span class="text-[9px] font-bold uppercase text-amber-600">Awaiting</span>
        </div>
        <h3 class="font-headline text-[15px] font-extrabold mb-1">${caseType}</h3>
        <div class="flex items-center gap-1 text-slate-500 text-[12px] mb-4">
          <span class="material-symbols-outlined text-[14px]">location_on</span>
          <span>${addr}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <button type="button" class="accept-btn bg-gradient-to-br from-emerald-500 to-emerald-600 text-white py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider shadow-sm">Accept</button>
          <button type="button" class="reject-btn bg-surface-container-high text-on-surface py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider">Decline</button>
        </div>
        ${phone ? `<p class="text-[10px] text-slate-400">Patient: ${phone}</p>` : ''}
      </div>`;
    }).join('');

    queue.querySelectorAll('.accept-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const card = btn.closest('.incident-card');
        const id = card && card.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        try {
          const r = await fetch(`${API}/incidents/${id}/dispatch-accept`, { method: 'PATCH' });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || 'Accept failed');
          showSuccess('Ambulance assigned — patient can track live.');
          await refreshPortal();
        } catch (err) {
          alert(err.message || 'Accept failed');
        } finally {
          btn.disabled = false;
        }
      });
    });
    queue.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const card = btn.closest('.incident-card');
        const id = card && card.getAttribute('data-id');
        if (!id || !confirm('Decline this request?')) return;
        btn.disabled = true;
        try {
          const r = await fetch(`${API}/incidents/${id}/dispatch-reject`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Declined by dispatch' })
          });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || 'Decline failed');
          showSuccess('Request declined.');
          await refreshPortal();
        } catch (err) {
          alert(err.message || 'Decline failed');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderTrackingQueue(incidents) {
    const queue = document.getElementById('dispatch-tracking-queue');
    if (!queue) return;
    if (!incidents.length) {
      queue.innerHTML = '<p class="text-center text-slate-400 text-xs py-4 px-2">No active incidents.</p>';
      return;
    }
    queue.innerHTML = incidents.map(inc => {
      const sev = inc.severity || 'Medium';
      const col = severityColor(sev);
      const addr = (inc.pickupLocation && inc.pickupLocation.address) ? inc.pickupLocation.address : '—';
      const caseType = inc.caseType || 'Emergency';
      const eta = inc.estimatedArrival != null ? `${inc.estimatedArrival} min` : '—';
      const amb = inc.assignedAmbulance;
      const ambLabel = amb ? (amb.unitId || '') : '—';
      const [lng, lat] = (inc.pickupLocation && inc.pickupLocation.coordinates) ? inc.pickupLocation.coordinates : [dispatchLng, dispatchLat];
      const intake = [inc.reportName, inc.chiefComplaint].filter(Boolean).join(' · ');
      const intakeSafe = intake.replace(/</g, '&lt;');
      return `
      <div class="incident-card shrink-0 bg-surface-container-lowest rounded-lg shadow-[0_4px_24px_rgba(24,29,26,0.07)] p-4 relative overflow-hidden transition-transform active:scale-95 cursor-pointer"
           data-id="${inc._id}" data-type="${String(caseType).replace(/"/g, '&quot;')}" data-address="${String(addr).replace(/"/g, '&quot;')}"
           data-priority="${sev}" data-amb="${ambLabel}" data-eta="${eta}"
           data-lat="${lat}" data-lng="${lng}">
        <div class="absolute left-0 top-0 bottom-0 w-1" style="background:${col}"></div>
        <div class="flex justify-between items-start mb-3">
          <span class="text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter" style="background:${col}">${sev}</span>
          <div class="flex flex-col items-end gap-0.5">
            <span class="font-headline text-[13px] font-bold tabular-nums text-slate-600">${inc.status}</span>
            <span class="text-[9px] text-slate-400 font-medium">ETA <span class="font-bold driver-eta">${eta}</span></span>
          </div>
        </div>
        <h3 class="font-headline text-[15px] font-extrabold mb-1">${caseType}</h3>
        ${intake ? `<p class="text-[11px] text-slate-500 mb-1">${intakeSafe}</p>` : ''}
        <div class="flex items-center gap-1 text-slate-500 text-[12px] mb-2">
          <span class="material-symbols-outlined text-[14px]">location_on</span>
          <span>${addr}</span>
        </div>
        <p class="text-[11px] text-slate-600 font-medium">Unit: ${ambLabel}</p>
      </div>`;
    }).join('');
  }

  async function drawIncidentMarkers(incidents) {
    incidentLayer.forEach(m => {
      if (m.map !== undefined) m.map = null;
      else if (m.setMap) m.setMap(null);
    });
    incidentLayer = [];
    for (const em of incidents) {
      if (!em.pickupLocation || !em.pickupLocation.coordinates) continue;
      const [lng, lat] = em.pickupLocation.coordinates;
      const color = severityColor(em.severity || 'Medium');
      const emHTML = `<div style="position:relative;display:flex;align-items:center;justify-content:center"><div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 6px ${color}33,0 2px 10px ${color}99"></div></div>`;
      incidentLayer.push(await createMarker(dispatchMap, lat, lng, emHTML, `<b>🚨 ${em.caseType || 'Incident'}</b><br>${em.status}<br>${em.pickupLocation.address || ''}`));
    }
  }

  async function loadDispatchActivityLog() {
    const el = document.getElementById('dispatch-activity-log');
    if (!el) return;
    try {
      const res = await fetch(`${API}/portal/dispatch/logs?limit=40`);
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) {
        el.innerHTML = '<p class="text-slate-400 text-[10px]">No log entries yet.</p>';
        return;
      }
      el.innerHTML = rows.map(r => {
        const t = r.createdAt ? new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        const inc = r.incidentId && r.incidentId.incidentId ? r.incidentId.incidentId : '';
        const ev = r.eventType || '';
        const msg = (r.message || '').replace(/</g, '&lt;');
        return `<div class="border-b border-slate-100/80 pb-1"><span class="text-slate-400">${t}</span> <span class="text-primary-container font-bold">${ev}</span>${inc ? ` · ${inc}` : ''}<br/><span class="text-slate-600">${msg}</span></div>`;
      }).join('');
    } catch (_) {
      el.innerHTML = '<p class="text-slate-400">Log unavailable</p>';
    }
  }

  async function refreshPortal() {
    const [pending, tracking] = await Promise.all([
      loadPortalQueue('pending'),
      loadPortalQueue('tracking')
    ]);
    renderPendingQueue(pending);
    renderTrackingQueue(tracking);
    await drawIncidentMarkers(tracking);
    await loadPortalStats();
    await loadDispatchActivityLog();
  }


  async function initializeApp() {
    await initDispatchMap();
    dispatchSocket.emit('join_dispatch');
    dispatchSocket.on('new_incident', () => { refreshPortal(); loadDispatchAmbulances(); });
    dispatchSocket.on('dispatch_incident_update', () => { refreshPortal(); loadDispatchAmbulances(); });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        dispatchLat = pos.coords.latitude;
        dispatchLng = pos.coords.longitude;
        if (dispatchMap) dispatchMap.setCenter({ lat: dispatchLat, lng: dispatchLng });
      }, () => {}, { timeout: 8000 });
    }

    await loadDispatchAmbulances();
    await loadDispatchHospitals();
    await refreshPortal();
    setInterval(loadDispatchAmbulances, 20000);
    setInterval(refreshPortal, 25000);
  }

  initializeApp();

  function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    if (el && document.getElementById('live-clock')) {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  function showSuccess(msg) {
    const toast = document.getElementById('success-toast');
    const msgEl = document.getElementById('success-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.display = 'flex';
    setTimeout(() => {
      toast.style.display = 'none';
      toast.classList.add('hidden');
    }, 3000);
  }

  const tc = document.getElementById('toast-close');
  if (tc) tc.addEventListener('click', () => {
    const t = document.getElementById('incoming-toast');
    if (t) t.style.display = 'none';
  });
  setTimeout(() => {
    const t = document.getElementById('incoming-toast');
    if (t) t.style.display = 'none';
  }, 8000);
})();
