/* ============================================================
   HOME PAGE — Emergency Response Finder + SOS + Live Map
   ============================================================ */

let map, userLat = CONFIG.DEFAULT_LAT, userLng = CONFIG.DEFAULT_LNG;
let ambulanceMarkers = {};
let userMarker = null;

// Ambulance type color mapping (for Leaflet markers)
const TYPE_COLORS = { BLS: '#3B82F6', ALS: '#F97316', ICU: '#C8102E', NEONATAL: '#A855F7' };

function createColorMarker(color, size = 14) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function createUserMarker() {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#1D4ED8;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

async function initMap() {
  map = L.map('home-map', {
    zoomControl: false,
    attributionControl: false
  }).setView([userLat, userLng], 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  userMarker = L.marker([userLat, userLng], { icon: createUserMarker(), zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup('<b>Your location</b>');

  await loadAmbulances();
}

async function loadAmbulances() {
  try {
    const ambulances = await apiFetch('/ambulances?status=available');
    ambulances.forEach(amb => {
      if (!amb.location || !amb.location.coordinates) return;
      const [lng, lat] = amb.location.coordinates;
      const color = TYPE_COLORS[amb.type] || '#6B7280';
      const marker = L.marker([lat, lng], { icon: createColorMarker(color) })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:Inter,sans-serif;font-size:13px;min-width:160px">
            <div style="font-weight:700;margin-bottom:4px">${amb.unitId}</div>
            <div style="color:#6B7280;font-size:12px;margin-bottom:2px">Type: <b>${amb.type}</b></div>
            <div style="color:#6B7280;font-size:12px">Crew: ${amb.crew.map(c=>c.name).join(', ')}</div>
          </div>
        `);
      ambulanceMarkers[amb._id] = { marker, data: amb };
    });
  } catch (e) {
    console.warn('Could not load ambulances:', e.message);
  }
}

function updateUserPosition(lat, lng, label) {
  userLat = lat;
  userLng = lng;
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
    map.setView([lat, lng], 14);
  }
  if (label) document.getElementById('currentLocation').textContent = label;
}

/* ---- Dispatch: Find Best Ambulance ---- */
async function handleFind() {
  const ambulanceType = document.getElementById('ambulanceType').value;
  const severity = document.getElementById('severity').value;
  const caseType = document.getElementById('caseType').value.trim();

  const btn = document.getElementById('findBtn');
  const btnText = document.getElementById('find-btn-text');
  const spinner = document.getElementById('find-btn-spinner');

  btn.disabled = true;
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';

  try {
    // caseType select value format: "Case Label|Specialty" or plain text
  const caseVal   = document.getElementById('caseType').value;
  const caseLabel = caseVal.includes('|') ? caseVal.split('|')[0] : caseVal;

  const u = typeof Auth !== 'undefined' ? Auth.getUser() : null;
  const ageEl = document.getElementById('patientAge');
  const body = {
      patientName: (u && u.name) ? u.name : 'Guest',
      patientPhone: (u && u.phone) ? u.phone : '+91 0000000000',
      pickupAddress: document.getElementById('currentLocation').textContent,
      pickupLat: userLat,
      pickupLng: userLng,
      ambulanceType: ambulanceType || undefined,
      severity,
      caseType: caseVal || undefined,
      reportName: (document.getElementById('reportName') && document.getElementById('reportName').value.trim()) || undefined,
      chiefComplaint: (document.getElementById('chiefComplaint') && document.getElementById('chiefComplaint').value.trim()) || undefined,
      intakeNotes: (document.getElementById('intakeNotes') && document.getElementById('intakeNotes').value.trim()) || undefined,
      patientAge: ageEl && ageEl.value !== '' ? ageEl.value : undefined,
      patientGender: (document.getElementById('patientGender') && document.getElementById('patientGender').value) || undefined
    };
  if (u && u._id) body.userId = u._id;

    const incident = await apiFetch('/incidents', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    Session.setIncident(incident._id, incident.shareToken);
    showToast('Ambulance assigned. Opening live track…', 'success', 2500);
    setTimeout(() => { window.location.href = 'track.html'; }, 1800);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btnText.style.display = '';
    spinner.style.display = 'none';
  }
}

/* ---- SOS: immediate ICU dispatch ---- */
async function handleSOS() {
  const btn = document.getElementById('sosBtn');
  btn.style.opacity = '0.7';
  btn.disabled = true;

  try {
    const u = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    const body = {
      patientName: (u && u.name) ? u.name : 'Guest',
      patientPhone: (u && u.phone) ? u.phone : '+91 0000000000',
      pickupAddress: document.getElementById('currentLocation').textContent,
      pickupLat: userLat,
      pickupLng: userLng,
      ambulanceType: 'ICU',
      severity: 'Critical',
      caseType: 'SOS Emergency|General',
      reportName: 'SOS',
      chiefComplaint: 'Critical SOS — immediate response requested',
      intakeNotes: 'SOS button activated from home.'
    };
    if (u && u._id) body.userId = u._id;

    const incident = await apiFetch('/incidents', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    Session.setIncident(incident._id, incident.shareToken);
    showToast('ICU unit assigned. Opening live track…', 'success', 2500);
    setTimeout(() => { window.location.href = 'track.html'; }, 1800);
  } catch (err) {
    showToast(err.message || 'SOS failed. Call 108 immediately.', 'error', 5000);
    btn.style.opacity = '1';
    btn.disabled = false;
  }
}

/* ---- Location modal ---- */
function openLocationModal() {
  document.getElementById('locationModal').classList.add('open');
  document.getElementById('locationInput').focus();
}
function closeLocationModal() {
  document.getElementById('locationModal').classList.remove('open');
}

async function useCurrentGPS() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      updateUserPosition(latitude, longitude, `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      closeLocationModal();
      showToast('Location updated to GPS', 'success', 2000);
    },
    () => showToast('Could not get GPS location', 'error')
  );
}

/* ---- Nav: update links with stored incident ---- */
function updateNavLinks() {
  const id = Session.getIncidentId();
  const token = Session.getShareToken();
  if (id) {
    const trackEl = document.getElementById('nav-track');
    const shareEl = document.getElementById('nav-share');
    const summaryEl = document.getElementById('nav-summary');
    if (trackEl) trackEl.href = `track.html?id=${id}`;
    if (shareEl) shareEl.href = `share.html?token=${token}`;
    if (summaryEl) summaryEl.href = `summary.html?id=${id}`;
  }
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', async () => {
  updateNavLinks();

  // Try to get user's GPS on load
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      updateUserPosition(pos.coords.latitude, pos.coords.longitude, null);
    }, () => {});
  }

  await initMap();

  document.getElementById('findBtn').addEventListener('click', handleFind);
  document.getElementById('sosBtn').addEventListener('click', handleSOS);
  document.getElementById('changeLocationBtn').addEventListener('click', openLocationModal);
  document.getElementById('closeLocationModal').addEventListener('click', closeLocationModal);
  document.getElementById('useCurrentLocationBtn').addEventListener('click', useCurrentGPS);

  document.getElementById('locationModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeLocationModal();
  });

  // Simple location input — update on Enter
  document.getElementById('locationInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) {
        document.getElementById('currentLocation').textContent = val;
        closeLocationModal();
        showToast('Location updated', 'success', 2000);
      }
    }
  });
});
