/* ============================================================
   TRACK PAGE — Google Maps + Directions API, live socket updates
   Phase 1: ambulance → pickup  |  Phase 2: pickup / amb → hospital
   ============================================================ */

let map;
let directionsRendererAmb;
let directionsRendererHosp;
let ambulanceMarker, originMarker, hospitalMarker;
let socket;
let incidentData       = null;
let selectedHospitalId = null;
let rerouteTimer       = null;
let lastRenderedStatus = null;
let rerouteHospLL      = null;
let mapRoutesTimer     = null;
let lastMapHospitalId  = null;

/** Prefer live incident document (socket updates); fallback to session — avoids stale localStorage id. */
function activeIncidentId() {
  const docId = incidentData?._id;
  if (docId != null && docId !== '') return String(docId).trim();
  const s = Session.getIncidentId();
  return s ? String(s).trim() : '';
}

function paramedicWhatsAppE164() {
  return (typeof CONFIG !== 'undefined' && CONFIG.PARAMEDIC_WHATSAPP_E164) || '919082615043';
}

/** Opens WhatsApp chat to the configured paramedic/crew number. */
function openWhatsAppParamedic(message) {
  const id = Session.getIncidentId() || '';
  const text = message || `Pran EMS — need paramedic. Incident: ${id}`;
  const url = `https://wa.me/${paramedicWhatsAppE164()}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function incidentPickupLL(inc) {
  const c = inc?.pickupLocation?.coordinates;
  return c ? [c[1], c[0]] : null;
}

function incidentAmbLL(inc) {
  const c = inc?.assignedAmbulance?.location?.coordinates;
  return c ? [c[1], c[0]] : null;
}

function incidentHospLL(inc) {
  const c = inc?.assignedHospital?.location?.coordinates;
  return c ? [c[1], c[0]] : null;
}

// ─── Map Init (Google) ───────────────────────────────────
async function initMap(incident) {
  const el = document.getElementById('track-map');
  try {
    await PranMaps.loadScript();
  } catch (e) {
    el.innerHTML = '<div style="padding:32px;text-align:center;font:14px system-ui;color:#C8102E;max-width:420px;margin:auto">'
      + e.message + '</div>';
    return;
  }

  const pickupCoords = incidentPickupLL(incident);
  const hospCoords   = incidentHospLL(incident);
  const ambCoords    = incidentAmbLL(incident);
  const center       = pickupCoords || [CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LNG];
  const ambStart     = ambCoords || pickupCoords || center;
  const hideAmbMarker = incident.status === 'requested';

  try {
    map = PranMaps.createMap(el, center);
  } catch (err) {
    el.innerHTML = '<div style="padding:32px;text-align:center;font:14px system-ui;color:#C8102E;max-width:420px;margin:auto">'
      + 'Could not create map: ' + (err && err.message ? err.message : String(err)) + '</div>';
    return;
  }

  requestAnimationFrame(() => {
    try {
      google.maps.event.trigger(map, 'resize');
    } catch (_) { /* ignore */ }
  });

  directionsRendererAmb = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    preserveViewport: false,
    polylineOptions: { strokeColor: '#F97316', strokeWeight: 5, strokeOpacity: 0.92, zIndex: 1 }
  });
  directionsRendererHosp = new google.maps.DirectionsRenderer({
    map: null,
    suppressMarkers: true,
    preserveViewport: false,
    polylineOptions: { strokeColor: '#C8102E', strokeWeight: 6, strokeOpacity: 0.9, zIndex: 2 }
  });

  ambulanceMarker = new google.maps.Marker({
    map,
    position: PranMaps.fromLatLngArray(ambStart),
    icon: PranMaps.emojiMarkerIcon('🚑'),
    optimized: true,
    visible: !hideAmbMarker,
    zIndex: google.maps.Marker.MAX_ZINDEX + 1,
    title: 'Ambulance'
  });

  if (pickupCoords) {
    originMarker = new google.maps.Marker({
      map,
      position: PranMaps.fromLatLngArray(pickupCoords),
      icon: PranMaps.pillMarkerIcon('YOU', '#1D4ED8', '#ffffff'),
      title: 'Pickup location'
    });
  }

  if (hospCoords) {
    hospitalMarker = new google.maps.Marker({
      map,
      position: PranMaps.fromLatLngArray(hospCoords),
      icon: PranMaps.pillMarkerIcon('HOSPITAL', '#C8102E', '#ffffff'),
      title: 'Hospital'
    });
  }

  scheduleUpdateMapRoutes();
}

async function updateMapRoutes() {
  if (!map || !directionsRendererAmb || !directionsRendererHosp || !incidentData) return;

  const pickupLL = incidentPickupLL(incidentData);
  if (!pickupLL) return;

  const ambLL  = incidentAmbLL(incidentData) || pickupLL;
  const hospLL = incidentHospLL(incidentData);
  const st     = incidentData.status;

  try {
    if (st === 'requested') {
      directionsRendererAmb.setMap(null);
      directionsRendererHosp.setMap(null);
      if (pickupLL) {
        map.setCenter(PranMaps.fromLatLngArray(pickupLL));
        map.setZoom(14);
      }
    } else if (st === 'transporting' && hospLL) {
      directionsRendererAmb.setMap(null);
      directionsRendererHosp.setMap(map);
      const { result, distanceM, bounds } = await PranMaps.computeDrivingRoute(
        PranMaps.fromLatLngArray(ambLL),
        PranMaps.fromLatLngArray(hospLL)
      );
      directionsRendererHosp.setDirections(result);
      updateKmPill(distanceM / 1000);
      map.fitBounds(bounds, { top: 72, right: 72, bottom: 72, left: 72 });
    } else if (st === 'on_scene' && hospLL) {
      directionsRendererAmb.setMap(null);
      directionsRendererHosp.setMap(map);
      const { result, distanceM, bounds } = await PranMaps.computeDrivingRoute(
        PranMaps.fromLatLngArray(pickupLL),
        PranMaps.fromLatLngArray(hospLL)
      );
      directionsRendererHosp.setDirections(result);
      updateKmPill(distanceM / 1000);
      map.fitBounds(bounds, { top: 72, right: 72, bottom: 72, left: 72 });
    } else if (st === 'dispatched') {
      directionsRendererHosp.setMap(null);
      directionsRendererAmb.setMap(map);
      const { result, distanceM, bounds } = await PranMaps.computeDrivingRoute(
        PranMaps.fromLatLngArray(ambLL),
        PranMaps.fromLatLngArray(pickupLL)
      );
      directionsRendererAmb.setDirections(result);
      updateKmPill(distanceM / 1000);
      map.fitBounds(bounds, { top: 72, right: 72, bottom: 72, left: 72 });

      if (hospLL) {
        directionsRendererHosp.setMap(map);
        const leg = await PranMaps.computeDrivingRoute(
          PranMaps.fromLatLngArray(pickupLL),
          PranMaps.fromLatLngArray(hospLL)
        );
        directionsRendererHosp.setDirections(leg.result);
      }
    } else {
      directionsRendererAmb.setMap(null);
      directionsRendererHosp.setMap(null);
    }
  } catch (e) {
    console.warn('Google Directions:', e.message);
  }
}

function scheduleUpdateMapRoutes() {
  clearTimeout(mapRoutesTimer);
  mapRoutesTimer = setTimeout(() => updateMapRoutes().catch(() => {}), 200);
}

function updateKmPill(km) {
  const pill = document.getElementById('kmPill');
  const txt  = document.getElementById('kmPillText');
  if (km > 0) {
    pill.style.display = '';
    txt.textContent    = `${km.toFixed(1)} km remaining`;
  }
  document.getElementById('kmRemaining').textContent = `${km.toFixed(1)} km away`;
}

// ─── Incoming call overlay ────────────────────────────────
function showIncomingCall(name) {
  document.getElementById('callerName').textContent = name + ' is calling';
  document.getElementById('callOverlay').classList.add('visible');
}
function dismissCall() {
  document.getElementById('callOverlay').classList.remove('visible');
}
function acceptCall() {
  const name = incidentData?.assignedAmbulance?.crew?.find(c => c.role === 'Paramedic')?.name || 'Paramedic';
  dismissCall();
  openWhatsAppParamedic(`Pran EMS — returning call from track. Paramedic: ${name}. Incident: ${Session.getIncidentId() || ''}`);
}

function openCrewWhatsApp() {
  openWhatsAppParamedic(`Pran EMS — Call crew / doctor from track. Incident: ${Session.getIncidentId() || ''}`);
}

// ─── Hospital Suggestions ────────────────────────────────
async function loadHospitalSuggestions(incidentId) {
  try {
    const suggestions = await apiFetch(`/incidents/${incidentId}/suggested-hospitals`);
    if (!suggestions?.length) return;

    document.getElementById('hospSection').style.display = 'block';
    const list = document.getElementById('hospList');

    list.innerHTML = suggestions.map((h, idx) => {
      const rec  = idx === 0 ? `<span class="hbadge hbadge-rec">Recommended</span>` : '';
      const spec = h.specialtyMatch ? `<span class="hbadge hbadge-spec">${h.capabilities?.[0] || 'Specialty'}</span>` : '';
      const beds = h.availableIcuBeds >= 4
        ? `<span class="hbadge hbadge-beds">Beds OK</span>`
        : `<span class="hbadge hbadge-low">Limited Beds</span>`;
      const isSel = h._id === selectedHospitalId;
      const lat   = h.location?.coordinates?.[1] || 0;
      const lng   = h.location?.coordinates?.[0] || 0;

      return `<div class="hosp-card ${isSel ? 'selected' : ''}" id="hcard-${h._id}"
                   onclick="selectHospital('${h._id}',${lat},${lng},'${h.name.replace(/'/g,"\\'")}',${h.etaMin})">
        <div class="hosp-card-top">
          <div>
            <div class="hosp-card-name">${h.name}</div>
            <div class="hosp-card-type">${h.type || 'Hospital'}</div>
          </div>
          <div class="hosp-card-eta">${h.etaMin}<small>min</small></div>
        </div>
        <div class="hosp-card-badges">${rec}${spec}${beds}
          <span style="color:var(--text-muted);font-size:9px">${h.distKm} km · ${h.availableBeds} beds</span>
        </div>
        <button class="hosp-select-btn"
                onclick="event.stopPropagation();selectHospital('${h._id}',${lat},${lng},'${h.name.replace(/'/g,"\\'")}',${h.etaMin})">
          ${isSel ? '✓ Selected' : 'Select Hospital →'}
        </button>
      </div>`;
    }).join('');
  } catch (e) {
    console.warn('Hospital suggestions failed:', e.message);
  }
}

async function selectHospital(id, lat, lng, name, etaMin) {
  if (selectedHospitalId === id) return;
  selectedHospitalId = id;
  rerouteHospLL = { lat, lng };

  document.querySelectorAll('.hosp-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`hcard-${id}`);
  if (card) card.classList.add('selected');

  try {
    const incidentId = activeIncidentId();
    const updated = await apiFetch(`/incidents/${encodeURIComponent(incidentId)}/hospital`, {
      method: 'PATCH',
      body: JSON.stringify({ hospitalId: id })
    });

    incidentData = updated;
    document.getElementById('hospInfoPill').classList.add('visible');
    document.getElementById('hospPillName').textContent = name;
    document.getElementById('hospPillEta').textContent  = `~${etaMin} min to hospital`;
    renderIncident(updated);
    showToast(`${name} selected`, 'success', 2500);
    dismissCall();

  } catch (e) {
    showToast('Failed to select hospital', 'error');
  }
}

// ─── Render Incident ─────────────────────────────────────
function renderIncident(incident) {
  const prevStatus = lastRenderedStatus;
  lastRenderedStatus = incident.status;
  incidentData = incident;
  if (incident?._id && incident.shareToken) {
    Session.setIncident(String(incident._id), incident.shareToken);
  }

  const eta = incident.estimatedArrival;
  document.getElementById('etaValue').textContent = eta != null ? eta : '--';

  const amb = incident.assignedAmbulance;
  const paramedicCard = document.getElementById('paramedicCard');
  if (paramedicCard) paramedicCard.style.display = amb ? 'block' : 'none';
  if (amb) {
    const lead = amb.crew?.find(c => c.role === 'Paramedic') || amb.crew?.[0];
    document.getElementById('paramedicName').textContent = lead?.name || 'Crew Member';
    document.getElementById('paramedicUnit').textContent = amb.unitId;
    document.getElementById('paramedicType').textContent =
      amb.type === 'ICU' ? 'Mobile ICU Transport'
      : amb.type === 'ALS' ? 'Advanced Life Support'
      : `${amb.type} Ambulance`;
    const initial = (lead?.name || 'P')[0].toUpperCase();
    document.getElementById('paramedicAvatar').textContent = initial;
  }

  if (ambulanceMarker) {
    ambulanceMarker.setVisible(incident.status !== 'requested' && !!incident.assignedAmbulance);
  }

  const phase = {
    requested:    { icon: '⏳', title: 'Awaiting dispatch',    sub: 'Dispatch will confirm your request — live tracking starts once an ambulance is assigned', green: false },
    dispatched:   { icon: '🚑', title: 'Ambulance En Route',   sub: 'Help is on the way to you', green: false },
    on_scene:     { icon: '🏥', title: 'Ambulance On Scene',   sub: 'Select a hospital for transport', green: true },
    transporting: { icon: '🏥', title: 'En Route to Hospital', sub: 'Transport in progress', green: true },
    completed:    { icon: '✅', title: 'Delivered',             sub: 'Patient delivered safely', green: true },
    cancelled:    { icon: '❌', title: 'Cancelled',             sub: 'Incident was cancelled', green: false }
  }[incident.status] || { icon: '🚑', title: incident.status, sub: '', green: false };

  document.getElementById('phaseIcon').textContent  = phase.icon;
  document.getElementById('phaseIcon').className     = `phase-icon${phase.green ? ' green' : ''}`;
  document.getElementById('phaseTitle').textContent  = phase.title;
  document.getElementById('phaseSub').textContent    = phase.sub;

  const intakeEl = document.getElementById('intakeReportLine');
  if (intakeEl) {
    const bits = [incident.reportName, incident.chiefComplaint].filter(Boolean);
    if (bits.length) {
      intakeEl.textContent = bits.join(' · ');
      intakeEl.style.display = 'block';
    } else {
      intakeEl.textContent = '';
      intakeEl.style.display = 'none';
    }
  }

  if (incident.status === 'on_scene' && prevStatus !== 'on_scene') {
    document.getElementById('etaValue').textContent = '0';
    document.getElementById('kmPillText').textContent = 'Ambulance on scene';
    const name = incident.assignedAmbulance?.crew?.find(c => c.role === 'Paramedic')?.name || 'Paramedic';
    showIncomingCall(name);
    showToast('Ambulance has arrived!', 'success', 3000);
  }

  if (amb?.location?.coordinates && ambulanceMarker) {
    const [lng, lat] = amb.location.coordinates;
    ambulanceMarker.setPosition({ lat, lng });
  }

  const hosp = incident.assignedHospital;
  if (hosp?.location?.coordinates && map) {
    const [hlng, hlat] = hosp.location.coordinates;
    if (hospitalMarker) hospitalMarker.setPosition({ lat: hlat, lng: hlng });
    else {
      hospitalMarker = new google.maps.Marker({
        map,
        position: { lat: hlat, lng: hlng },
        icon: PranMaps.pillMarkerIcon('HOSPITAL', '#C8102E', '#ffffff'),
        title: 'Hospital'
      });
    }
    rerouteHospLL = { lat: hlat, lng: hlng };
  }

  if (hosp && !selectedHospitalId) {
    selectedHospitalId = hosp._id;
    document.getElementById('hospInfoPill').classList.add('visible');
    document.getElementById('hospPillName').textContent = hosp.name;
    document.getElementById('hospPillEta').textContent  = 'En route to hospital';
  }

  const hospitalId = incident.assignedHospital?._id || incident.assignedHospital || null;
  if (prevStatus !== incident.status || String(hospitalId) !== String(lastMapHospitalId)) {
    lastMapHospitalId = hospitalId;
    scheduleUpdateMapRoutes();
  }

  if (incident.status === 'transporting' && prevStatus !== 'transporting' && rerouteHospLL && map) {
    clearInterval(rerouteTimer);
    rerouteTimer = setInterval(async () => {
      if (!map || !directionsRendererHosp || incidentData?.status !== 'transporting') return;
      const pos = ambulanceMarker?.getPosition();
      if (!pos || !rerouteHospLL) return;
      try {
        const { result } = await PranMaps.computeDrivingRoute(
          { lat: pos.lat(), lng: pos.lng() },
          { lat: rerouteHospLL.lat, lng: rerouteHospLL.lng }
        );
        directionsRendererHosp.setMap(map);
        directionsRendererHosp.setDirections(result);
      } catch (_) { /* keep last route */ }
    }, 30000);
  }

  renderTimeline(incident);
  fillPatientFormFromIncident(incident);

  if (incident.status === 'completed') {
    showToast('Incident complete! Viewing summary...', 'success', 3000);
    setTimeout(() => { window.location.href = `summary.html?id=${incident._id}`; }, 3000);
  }
}

function renderTimeline(incident) {
  const steps = [
    { key: 'requested',    label: 'Request sent',      sub: 'Waiting for dispatch' },
    { key: 'dispatched',   label: 'Dispatched',        sub: 'Ambulance en route' },
    { key: 'on_scene',     label: 'On Scene',           sub: 'Paramedics arrived' },
    { key: 'transporting', label: 'En Route to Hospital', sub: 'Transport started' },
    { key: 'completed',    label: 'Delivered',          sub: 'Patient delivered' }
  ];
  const curIdx = steps.findIndex(s => s.key === incident.status);
  const tlMap  = {};
  (incident.timeline || []).forEach(t => { tlMap[t.status] = t; });

  document.getElementById('timelineList').innerHTML = steps.map((s, i) => {
    const isActive = i === curIdx;
    const isDone   = i < curIdx;
    const tl       = tlMap[s.key];
    const time     = tl ? new Date(tl.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="tl-item ${isActive ? 'active' : isDone ? 'done' : ''}">
        <div class="tl-dot ${isActive ? 'active' : isDone ? 'done' : ''}"></div>
        <div class="tl-body">
          <div class="tl-title">${s.label}</div>
          <div class="tl-sub">${tl?.description || s.sub}</div>
          ${time ? `<div class="tl-time">${time}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function fillPatientFormFromIncident(incident) {
  const p = incident.patient || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v != null && v !== '' ? String(v) : '';
  };
  set('patientName', p.name);
  set('patientAge', p.age != null ? p.age : '');
  set('patientAllergies', p.allergies);
  set('patientMedications', p.medications);
  set('patientDetailsHospital', incident.patientDetailsForHospital);

  const sev = incident.aiSeverityScore;
  const pill = document.getElementById('aiSeverityPill');
  if (pill) {
    pill.innerHTML = (sev >= 1 && sev <= 10 ? String(sev) : '—') + '<span>/10 urgency</span>';
  }
  const sumEl = document.getElementById('aiReportSummary');
  if (sumEl) {
    sumEl.textContent = incident.aiReportSummary
      || 'No AI report yet — enter hospital details and tap Generate AI report.';
  }
  const repEl = document.getElementById('aiHospitalReport');
  if (repEl) {
    repEl.textContent = incident.aiHospitalReport && incident.aiHospitalReport.trim()
      ? incident.aiHospitalReport
      : '—';
  }
  const meta = document.getElementById('aiReportMeta');
  if (meta) {
    meta.textContent = incident.aiReportGeneratedAt
      ? `Last generated: ${new Date(incident.aiReportGeneratedAt).toLocaleString('en-IN')}`
      : '';
  }
}

async function savePatientRecord() {
  const incidentId = activeIncidentId();
  if (!incidentId) {
    showToast('No incident', 'error');
    return;
  }
  const name = document.getElementById('patientName')?.value?.trim() || '';
  const ageVal = document.getElementById('patientAge')?.value;
  let age;
  if (ageVal !== '' && ageVal != null) {
    const n = parseInt(ageVal, 10);
    if (!Number.isNaN(n)) age = n;
  }
  const body = {
    name,
    age,
    allergies: document.getElementById('patientAllergies')?.value?.trim() || '',
    medications: document.getElementById('patientMedications')?.value?.trim() || '',
    patientDetailsForHospital: document.getElementById('patientDetailsHospital')?.value?.trim() || ''
  };
  try {
    const updated = await apiFetch(`/incidents/${incidentId}/patient-record`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    incidentData = updated;
    fillPatientFormFromIncident(updated);
    showToast('Patient details saved', 'success');
  } catch (e) {
    showToast(e.message || 'Save failed', 'error');
  }
}

async function generateHospitalAiReport() {
  const incidentId = activeIncidentId();
  if (!incidentId) {
    showToast('No incident', 'error');
    return;
  }
  const btn = document.getElementById('generateAiReportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const data = await apiFetch(`/incidents/${encodeURIComponent(incidentId)}/hospital-ai-report`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    const inc = data.incident || data;
    if (inc._id) {
      incidentData = inc;
      renderIncident(inc);
    }
    if (data.usedFallback && data.message) {
      showToast(data.message, '', 4500);
    } else {
      showToast('AI hospital report ready', 'success');
    }
  } catch (e) {
    showToast(e.message || 'Report failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate AI report'; }
  }
}

// ─── Socket ──────────────────────────────────────────────
function connectSocket(incidentId) {
  socket = io(CONFIG.SOCKET_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    socket.emit('join_incident', incidentId);
    document.getElementById('liveIndicator').style.display = '';
  });

  socket.on('incident_updated', incident => {
    renderIncident(incident);
  });

  socket.on('ambulance_moved', ({ lat, lng }) => {
    ambulanceMarker?.setPosition({ lat, lng });
    const pickup = incidentData?.pickupLocation?.coordinates;
    if (!pickup) return;
    if (incidentData.status === 'transporting' && incidentData.assignedHospital?.location?.coordinates) {
      const [hLng, hLat] = incidentData.assignedHospital.location.coordinates;
      updateKmPill(haversine(lat, lng, hLat, hLng));
    } else if (incidentData.status === 'dispatched') {
      updateKmPill(haversine(lat, lng, pickup[1], pickup[0]));
    }
  });

  socket.on('eta_updated', ({ eta }) => {
    document.getElementById('etaValue').textContent = eta;
  });

  socket.on('disconnect', () => {
    document.getElementById('liveIndicator').style.display = 'none';
  });
}

function openSymptomCheckerFromTrack() {
  showToast('Symptom checker available on home page', '', 2500);
  setTimeout(() => { window.location.href = 'index.html'; }, 1000);
}

function showToast(msg, type = '', duration = 3000) {
  const toast = document.getElementById('toast');
  const el    = document.createElement('div');
  el.className = `toast-item${type ? ' ' + type : ''}`;
  el.textContent = msg;
  toast.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── Init ────────────────────────────────────────────────
async function init() {
  const params     = new URLSearchParams(location.search);
  const incidentId = params.get('id') || Session.getIncidentId();

  if (!incidentId) {
    showToast('No active incident — request an ambulance first.', 'error', 5000);
    return;
  }

  try {
    const incident = await apiFetch(`/incidents/${incidentId}`);
    Session.setIncident(incident._id, incident.shareToken);

    await initMap(incident);
    renderIncident(incident);
    connectSocket(incidentId);

    await loadHospitalSuggestions(incidentId);

  } catch (err) {
    const msg = String(err.message || '');
    if (msg.includes('Incident not found') || msg.includes('Not in the database')) {
      Session.clear();
    }
    showToast('Failed to load: ' + err.message, 'error', 5000);
  }

  document.getElementById('shareLinkBtn').addEventListener('click', () => {
    const url = `${location.origin}/share.html?token=${Session.getShareToken()}`;
    navigator.clipboard?.writeText(url).then(() => showToast('Share link copied!', 'success'));
  });

  document.getElementById('callAmbBtn').addEventListener('click', openCrewWhatsApp);
  document.getElementById('callBtn')?.addEventListener('click', () => {
    const name = incidentData?.assignedAmbulance?.crew?.find(c => c.role === 'Paramedic')?.name || 'Paramedic';
    openWhatsAppParamedic(`Pran EMS — call paramedic (${name}). Incident: ${Session.getIncidentId() || ''}`);
  });
  document.getElementById('savePatientBtn')?.addEventListener('click', () => savePatientRecord());
  document.getElementById('generateAiReportBtn')?.addEventListener('click', () => generateHospitalAiReport());
}

document.addEventListener('DOMContentLoaded', init);
