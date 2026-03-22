/* ============================================================
   SHARE PAGE — Google Maps + Directions (family view)
   ============================================================ */

let map;
let directionsRenderer;
let ambulanceMarker, originMarker, hospitalMarker;
let socket;

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

async function drawMainRoute(incident) {
  if (!map || !directionsRenderer) return;
  const pickupLL = incidentPickupLL(incident);
  const ambLL    = incidentAmbLL(incident) || pickupLL;
  const hospLL   = incidentHospLL(incident);
  if (!pickupLL) return;

  if (incident.status === 'requested') {
    directionsRenderer.setMap(null);
    return;
  }

  try {
    let origin;
    let dest;
    if (incident.status === 'transporting' && hospLL) {
      origin = PranMaps.fromLatLngArray(ambLL);
      dest   = PranMaps.fromLatLngArray(hospLL);
    } else if (hospLL && (incident.status === 'on_scene' || incident.status === 'completed')) {
      origin = PranMaps.fromLatLngArray(pickupLL);
      dest   = PranMaps.fromLatLngArray(hospLL);
    } else {
      origin = PranMaps.fromLatLngArray(ambLL);
      dest   = PranMaps.fromLatLngArray(pickupLL);
    }
    const { result, bounds } = await PranMaps.computeDrivingRoute(origin, dest);
    directionsRenderer.setMap(map);
    directionsRenderer.setDirections(result);
    map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
  } catch (e) {
    console.warn('Share directions:', e.message);
    directionsRenderer.setMap(null);
  }
}

async function initMap(incident) {
  const el = document.getElementById('share-map');
  try {
    await PranMaps.loadScript();
  } catch (e) {
    el.innerHTML = '<div style="padding:24px;text-align:center;font:13px system-ui;color:#C8102E;max-width:420px;margin:auto">'
      + e.message + '</div>';
    return;
  }

  const pickupCoords = incidentPickupLL(incident);
  const center = pickupCoords || [CONFIG.DEFAULT_LAT, CONFIG.DEFAULT_LNG];
  map = PranMaps.createMap(el, center);

  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#C8102E', strokeWeight: 5, strokeOpacity: 0.88 }
  });

  const ambStart = incidentAmbLL(incident) || pickupCoords || center;
  ambulanceMarker = new google.maps.Marker({
    map,
    position: PranMaps.fromLatLngArray(ambStart),
    icon: PranMaps.emojiMarkerIcon('🚑'),
    visible: incident.status !== 'requested',
    zIndex: google.maps.Marker.MAX_ZINDEX + 1,
    title: 'Ambulance'
  });

  if (pickupCoords) {
    originMarker = new google.maps.Marker({
      map,
      position: PranMaps.fromLatLngArray(pickupCoords),
      icon: PranMaps.pillMarkerIcon('ORIGIN', '#1D4ED8', '#ffffff'),
      title: 'Pickup'
    });
  }

  const hospCoords = incidentHospLL(incident);
  if (hospCoords) {
    hospitalMarker = new google.maps.Marker({
      map,
      position: PranMaps.fromLatLngArray(hospCoords),
      icon: PranMaps.pillMarkerIcon('HOSPITAL', '#C8102E', '#ffffff'),
      title: 'Hospital'
    });
  }

  await drawMainRoute(incident);
}

let lastShareStatus = null;
let lastShareHospId = null;

function renderIncident(incident) {
  document.getElementById('bannerText').textContent =
    `Live emergency update — shared by ${incident.patient?.name || 'Patient'}`;

  const eta = incident.estimatedArrival;
  document.getElementById('eta-value').innerHTML = eta != null ? `${eta}<span> min</span>` : `--<span> min</span>`;

  const statusMap = {
    requested: 'Awaiting dispatch', dispatched: 'Dispatched',
    on_scene: 'Stable', transporting: 'Transporting',
    completed: 'Delivered', cancelled: 'Cancelled'
  };
  const colorMap = {
    requested: '#6B7280', dispatched: '#F97316',
    on_scene: '#2A7A4B', transporting: '#1D4ED8',
    completed: '#2A7A4B', cancelled: '#C8102E'
  };
  const statusEl = document.getElementById('patient-status');
  statusEl.textContent = statusMap[incident.status] || incident.status;
  statusEl.style.color = colorMap[incident.status] || '#6B7280';

  const lastTl = incident.timeline?.[incident.timeline.length - 1];
  if (lastTl) {
    const s = Math.floor((new Date() - new Date(lastTl.timestamp)) / 1000);
    const ago = s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
    document.getElementById('status-updated').textContent = `Paramedic update ${ago}`;
  }

  const hosp = incident.assignedHospital;
  if (hosp) {
    document.getElementById('hospitalCard').style.display = 'flex';
    document.getElementById('hospital-name').textContent = hosp.name;
    document.getElementById('hospital-addr').textContent = `${hosp.address}, ${hosp.city}`;
    document.getElementById('directionsBtn').onclick = () => {
      if (hosp.location?.coordinates) {
        const [lng, lat] = hosp.location.coordinates;
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
      }
    };
  }

  const statusOrder = ['requested', 'dispatched', 'on_scene', 'transporting', 'completed'];
  const labelMap = {
    requested: { label: 'Request sent', sub: 'Waiting for dispatch to assign an ambulance' },
    dispatched: { label: 'Dispatched', sub: 'Ambulance en route' },
    on_scene:   { label: 'On Scene',   sub: 'Paramedics with patient' },
    transporting:{ label: 'Transporting to Hospital', sub: '' },
    completed:  { label: 'Arrived at Hospital', sub: 'Awaiting arrival' }
  };
  const currentIdx = statusOrder.indexOf(incident.status);
  const tlMap = {};
  (incident.timeline || []).forEach(t => { tlMap[t.status] = t; });

  document.getElementById('timeline-list').innerHTML = statusOrder.map((s, i) => {
    const isActive = i === currentIdx;
    const isDone   = i < currentIdx;
    const tl = tlMap[s];
    const lm = labelMap[s];
    const dotClass  = isActive ? 'active' : isDone ? 'done' : '';
    const itemClass = isActive ? 'active' : isDone ? 'done' : '';
    const timeStr = tl ? new Date(tl.timestamp).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}) : lm.sub;
    return `
      <div class="timeline-item ${itemClass}">
        <div class="timeline-dot ${dotClass}"></div>
        <div class="timeline-content">
          <div class="tl-title ${isActive ? 'active-text' : ''}">${lm.label}</div>
          <div class="tl-sub">${tl ? tl.description || lm.sub : lm.sub}</div>
          ${tl ? `<div class="tl-time">${timeStr}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const notes = incident.patientStatusNotes;
  if (notes?.length) {
    const latest = notes[notes.length - 1];
    document.getElementById('statusNoteCard').style.display = 'block';
    document.getElementById('note-text').textContent = `"${latest.note}"`;
    document.getElementById('note-by').textContent = `— Paramedic ${latest.by?.toUpperCase() || 'D.K.'}`;
  }

  if (ambulanceMarker) {
    ambulanceMarker.setVisible(incident.status !== 'requested' && !!incident.assignedAmbulance);
  }

  if (incident.assignedAmbulance?.location?.coordinates) {
    const [lng, lat] = incident.assignedAmbulance.location.coordinates;
    ambulanceMarker?.setPosition({ lat, lng });
  }

  if (incident.assignedHospital?.location?.coordinates && map) {
    const [hlng, hlat] = incident.assignedHospital.location.coordinates;
    hospitalMarker?.setPosition({ lat: hlat, lng: hlng });
  }

  document.getElementById('btn-summary').href = `summary.html?id=${incident._id}`;
  document.getElementById('btn-track').href = `track.html?id=${incident._id}`;

  const hid = incident.assignedHospital?._id || incident.assignedHospital || null;
  if (map && directionsRenderer
      && (incident.status !== lastShareStatus || String(hid) !== String(lastShareHospId))) {
    lastShareStatus = incident.status;
    lastShareHospId = hid;
    drawMainRoute(incident).catch(() => {});
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    document.getElementById('bannerText').textContent = 'Invalid share link.';
    showToast('Invalid or missing share token', 'error');
    return;
  }

  try {
    const incident = await apiFetch(`/incidents/share/${token}`);
    lastShareStatus = incident.status;
    lastShareHospId = incident.assignedHospital?._id || incident.assignedHospital || null;

    await initMap(incident);
    renderIncident(incident);

    socket = io(CONFIG.SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('join_share', token));
    socket.on('incident_updated', renderIncident);
    socket.on('ambulance_moved', ({ lat, lng }) => ambulanceMarker?.setPosition({ lat, lng }));
    socket.on('eta_updated', ({ eta }) => {
      document.getElementById('eta-value').innerHTML = `${eta}<span> min</span>`;
    });

  } catch (err) {
    showToast('Failed to load: ' + err.message, 'error');
    document.getElementById('bannerText').textContent = 'Error loading emergency data.';
  }

  document.getElementById('copyLinkBtn').addEventListener('click', () => {
    navigator.clipboard?.writeText(location.href).then(() => showToast('Share link copied!', 'success'));
  });

  document.getElementById('callHospBtn').addEventListener('click', () => {
    showToast('Connecting to ambulance driver...', '', 2000);
  });
}

document.addEventListener('DOMContentLoaded', init);
