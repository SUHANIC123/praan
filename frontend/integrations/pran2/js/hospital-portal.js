// ─── State (Pran main API + /api/portal) ───────────────────────────────────
  const API = (window.PORTAL_API_ORIGIN || 'http://localhost:3001') + '/api';
  const SOCKET_URL = window.PORTAL_SOCKET_ORIGIN || window.PORTAL_API_ORIGIN || 'http://localhost:3001';
  let socket;
  let currentHospitalId = null;
  let activeEmergencyId = null; // incident id for bed modal

  /** Map Pran Incident → card shape expected by buildEmergencyCard */
  function incidentToEmergency(inc) {
    const amb = inc.assignedAmbulance;
    return {
      _id: inc._id,
      severity: inc.severity || 'Medium',
      caseType: inc.caseType || 'Emergency',
      reportName: inc.reportName || '',
      chiefComplaint: inc.chiefComplaint || '',
      patient: inc.patient || {},
      patientLocation: inc.pickupLocation,
      dispatchedAt: inc.dispatchedAt,
      etaMinutes: typeof inc.estimatedArrival === 'number' ? inc.estimatedArrival : null,
      assignedAmbulanceId: amb
        ? { vehicleNumber: amb.unitId || amb.licensePlate, _id: amb._id }
        : null
    };
  }

  // Bed type mapping: bedId prefix → DB field
  const BED_TYPE_MAP = { 'ICU': 'icu', 'GEN': 'general', 'ER': 'emergency', 'NEO': 'neonatal' };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  async function initDashboard() {
    try {
      const hospitals = await fetch(`${API}/hospitals`).then(r => r.json());
      if (!hospitals.length) { console.warn('No hospitals in DB'); return; }
      const params = new URLSearchParams(location.search);
      const qId = params.get('hospitalId');
      currentHospitalId = qId || hospitals[0]._id;

      socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
      hospitals.forEach(h => socket.emit('join_hospital', String(h._id)));

      socket.on('incident_updated', doc => {
        const hid = doc.assignedHospital && (doc.assignedHospital._id || doc.assignedHospital);
        if (String(hid) !== String(currentHospitalId)) return;
        const dq = document.getElementById('dynamic-queue');
        if (dq) dq.innerHTML = '';
        loadIncidentsForHospital();
      });

      socket.on('hospital_updated', h => {
        if (String(h._id) === String(currentHospitalId)) refreshBedFromHospitalDoc(h);
      });

      await loadIncidentsForHospital();

      const hospital = await fetch(`${API}/hospitals/${currentHospitalId}`).then(r => r.json());
      refreshBedFromHospitalDoc(hospital);

    } catch (err) {
      console.error('Dashboard init error:', err);
    }
  }

  async function loadIncidentsForHospital() {
    const res = await fetch(`${API}/portal/incidents?hospitalId=${currentHospitalId}&active=1`);
    if (!res.ok) return;
    const incidents = await res.json();
    const queue = document.getElementById('dynamic-queue');
    const empty = document.getElementById('empty-queue');
    if (!queue) return;
    queue.innerHTML = '';
    const filtered = incidents.filter(i =>
      ['dispatched', 'on_scene', 'transporting'].indexOf(i.status) >= 0
    );
    if (!filtered.length) {
      if (empty) empty.style.display = 'block';
      updateQueueBadge(0, true);
      return;
    }
    if (empty) empty.style.display = 'none';
    filtered.forEach(inc => prependEmergencyCard(incidentToEmergency(inc)));
    updateQueueBadge(filtered.length, true);
  }

  function refreshBedFromHospitalDoc(h) {
    const beds = h.beds || {
      icu: h.availableIcuBeds ?? 0,
      emergency: Math.max(0, Math.floor((h.availableBeds || 0) / 3)),
      general: Math.max(0, (h.availableBeds || 0) - Math.floor((h.availableBeds || 0) / 3)),
      neonatal: 0
    };
    refreshBedCountsFromDB(beds);
  }

  function updateQueueBadge(deltaOrCount, absolute) {
    const badge = document.getElementById('queue-badge');
    if (!badge) return;
    if (absolute) {
      badge.textContent = `${deltaOrCount} Pending`;
      return;
    }
    const cur = parseInt(badge.textContent, 10) || 0;
    badge.textContent = `${Math.max(0, cur + deltaOrCount)} Pending`;
  }

  // ─── Emergency card rendering ─────────────────────────────────────────────
  function priorityFromSeverity(severity) {
    if (severity === 'High')   return { num: 1, color: 'border-primary', badge: 'bg-error-container text-on-error-container', dot: 'bg-primary', pulse: 'pulse-ring', ambColor: 'text-primary' };
    if (severity === 'Medium') return { num: 2, color: 'border-[#f4b400]', badge: 'bg-[#fff3cd] text-[#b45309]', dot: 'bg-[#f4b400]', pulse: 'pulse-ring', ambColor: 'text-[#b45309]' };
    return                            { num: 3, color: 'border-tertiary',  badge: 'bg-tertiary-fixed text-tertiary',              dot: 'bg-tertiary', pulse: '',           ambColor: 'text-tertiary' };
  }

  function etaLabel(emergency) {
    const m = emergency.etaMinutes != null ? emergency.etaMinutes : emergency.distanceToHospital;
    if (m != null && m > 0) return `ETA ~${Math.ceil(m)} min`;
    return 'ETA —';
  }

  function buildEmergencyCard(emergency) {
    const p = priorityFromSeverity(emergency.severity);
    const ambId = emergency.assignedAmbulanceId?.vehicleNumber || emergency.assignedAmbulanceId?._id?.toString().slice(-4).toUpperCase() || '—';
    const caseType = emergency.caseType || 'Unknown';
    const age = emergency.patient?.age || '—';
    const gender = emergency.patient?.gender || '—';
    const vitals = emergency.patient?.vitals?.spo2
      ? (emergency.patient.vitals.spo2 < 92 ? 'Unstable' : emergency.patient.vitals.spo2 < 96 ? 'Guarded' : 'Stable')
      : (emergency.severity === 'High' ? 'Unstable' : emergency.severity === 'Medium' ? 'Guarded' : 'Stable');
    const vitalsColor = vitals === 'Unstable' ? 'text-error' : vitals === 'Guarded' ? '' : 'text-tertiary';
    const dispatchTime = emergency.dispatchedAt
      ? new Date(emergency.dispatchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const intakeLine = [emergency.reportName, emergency.chiefComplaint].filter(Boolean).join(' · ');

    return `
    <div id="ecard-${emergency._id}" class="bg-surface-container-lowest rounded-lg p-5 shadow-sm border-l-[5px] ${p.color} relative overflow-hidden">
      <div class="flex justify-between items-start mb-4">
        <div>
          <span class="inline-flex items-center gap-2 px-3 py-1 ${p.badge} rounded-full text-xs font-bold uppercase tracking-widest mb-2">
            <span class="w-2 h-2 rounded-full ${p.dot} ${p.pulse}"></span>
            Priority ${p.num} • Incoming
          </span>
          <h2 class="text-3xl font-black font-headline tracking-tighter text-on-background leading-none">${etaLabel(emergency)}</h2>
          ${intakeLine ? `<p class="text-sm text-secondary mt-1 font-medium">${escHtml(intakeLine)}</p>` : ''}
        </div>
        <div class="text-right">
          <p class="text-secondary font-medium text-sm">Ambulance ID</p>
          <p class="font-headline font-extrabold text-lg ${p.ambColor}">${ambId}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div class="bg-surface-container-low p-3 rounded-lg">
          <p class="text-xs text-on-surface-variant font-medium mb-1">Condition</p>
          <p class="font-bold text-base">${caseType}</p>
        </div>
        <div class="bg-surface-container-low p-3 rounded-lg">
          <p class="text-xs text-on-surface-variant font-medium mb-1">Patient</p>
          <p class="font-bold text-base">${age}, ${gender}</p>
        </div>
        <div class="bg-surface-container-low p-3 rounded-lg">
          <p class="text-xs text-on-surface-variant font-medium mb-1">Vitals</p>
          <p class="font-bold text-base ${vitalsColor}">${vitals}</p>
        </div>
        <div class="bg-surface-container-low p-3 rounded-lg">
          <p class="text-xs text-on-surface-variant font-medium mb-1">Dispatch Time</p>
          <p class="font-bold text-base">${dispatchTime}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <button class="bg-primary text-on-primary px-6 py-3 rounded-full font-bold hover:scale-95 transition-all flex-1"
          onclick="openBedModal('${emergency._id}', '${caseType}')">Accept Patient</button>
        <button class="bg-surface-container-highest text-on-secondary-container px-6 py-3 rounded-full font-bold hover:bg-surface-dim transition-all"
          onclick="redirectEmergency('${emergency._id}')">Redirect</button>
      </div>
    </div>`;
  }

  function prependEmergencyCard(emergency) {
    if (document.getElementById(`ecard-${emergency._id}`)) return; // already shown
    const queue = document.getElementById('dynamic-queue');
    if (!queue) return;
    const empty = document.getElementById('empty-queue');
    if (empty) empty.style.display = 'none';
    queue.insertAdjacentHTML('afterbegin', buildEmergencyCard(emergency));
  }

  function removeEmergencyCard(emergencyId) {
    const card = document.getElementById(`ecard-${emergencyId}`);
    if (card) {
      card.style.transition = 'opacity 0.4s, transform 0.4s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      setTimeout(() => card.remove(), 420);
    }
  }

  // ─── Bed modal ────────────────────────────────────────────────────────────
  function openBedModal(emergencyId, caseLabel) {
    activeEmergencyId = emergencyId;
    document.getElementById('modalCaseId').textContent = `#${emergencyId.slice(-6).toUpperCase()}`;
    // Reset radio
    document.querySelectorAll('[name="bed-selection"]').forEach(r => r.checked = false);
    document.getElementById('bedModal').classList.remove('hidden');
  }

  function closeBedModal() {
    document.getElementById('bedModal').classList.add('hidden');
    activeEmergencyId = null;
  }

  async function confirmBedAssignment() {
    const selected = document.querySelector('[name="bed-selection"]:checked');
    if (!selected) { showToast('Please select a bed first', true); return; }
    if (!activeEmergencyId) return;

    const [bedType, bedId] = selected.value.split('|');
    const btn = document.getElementById('assignConfirmBtn');
    btn.disabled = true;
    btn.textContent = 'Confirming…';

    try {
      const res = await fetch(`${API}/portal/incidents/${activeEmergencyId}/accept-bed`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedType, bedId })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Server error');

      removeEmergencyCard(activeEmergencyId);
      updateQueueBadge(-1);
      if (data.hospital) refreshBedFromHospitalDoc(data.hospital);

      // Mark the assigned bed card as occupied in the UI
      markBedOccupied(bedId);

      closeBedModal();
      showToast(`Bed ${bedId} assigned successfully`);
    } catch (err) {
      showToast('Assignment failed: ' + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Assign and Confirm';
    }
  }

  async function redirectEmergency(emergencyId) {
    if (!confirm('Redirect this patient to another facility?')) return;
    try {
      const r = await fetch(`${API}/incidents/${emergencyId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', note: 'Redirected by hospital dashboard' })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed');
      if (currentHospitalId) {
        await fetch(`${API}/portal/hospital/log-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incidentId: emergencyId,
            hospitalId: currentHospitalId,
            eventType: 'redirect_patient',
            message: 'Patient redirected to another facility'
          })
        }).catch(() => {});
      }
      removeEmergencyCard(emergencyId);
      updateQueueBadge(-1);
      showToast('Patient redirected');
    } catch (err) {
      showToast('Redirect failed', true);
    }
  }

  // ─── Bed management sync ─────────────────────────────────────────────────
  // DB beds object: { general: N, icu: N, emergency: N, neonatal: N }
  // These are the AVAILABLE counts stored in the hospital document.
  function refreshBedCountsFromDB(beds) {
    if (!beds) return;

    const icuAvail = Number(beds.icu || 0);
    const erAvail = Number(beds.emergency || 0);
    const genAvail = Number(beds.general || 0);
    const neoAvail = Number(beds.neonatal || 0);

    // Dynamically calculate total capacity assuming roughly 60-70% occupancy
    const icuTotal = Math.max(8, Math.round(icuAvail * 1.8));
    const erTotal = Math.max(4, Math.round(erAvail * 1.5));
    const genTotal = Math.max(12, Math.round(genAvail * 1.9));
    const neoTotal = Math.max(2, Math.round(neoAvail * 1.4));

    const clusterData = [
      { el: 'cluster-icu', available: icuAvail, total: icuTotal },
      { el: 'cluster-er',  available: erAvail,  total: erTotal },
      { el: 'cluster-gen', available: genAvail, total: genTotal },
    ];

    clusterData.forEach(({ el, available, total }) => {
      const card = document.getElementById(el);
      if (!card) return;
      const occupied = Math.max(0, total - available);
      const pct = Math.round((occupied / total) * 100) || 0;
      const bar = card.querySelector('.bed-bar');
      const label = card.querySelector('.bed-label');
      const pctLabel = card.querySelector('.bed-pct');
      if (bar) bar.style.width = pct + '%';
      if (label) label.textContent = `${occupied} / ${total} Beds Occupied`;
      if (pctLabel) pctLabel.textContent = pct + '%';
    });

    // Update donut chart totals
    const totalAvail = icuAvail + erAvail + genAvail + neoAvail;
    const totalBeds = icuTotal + erTotal + genTotal + neoTotal;
    const totalOcc = Math.max(0, totalBeds - totalAvail);
    
    // Assign roughly 5% to "preparing" for dashboard realism
    const prep = Math.floor(totalAvail * 0.05);
    const finalAvail = totalAvail - prep;

    updateDonut(finalAvail, totalOcc, prep, totalBeds);
  }

  function updateDonut(avail, occ, prep, total) {
    const C = 502.65; // circumference 2π×80
    const availLen = (avail / total) * C;
    const prepLen  = (prep  / total) * C;
    const occLen   = (occ   / total) * C;

    const greenCircle  = document.getElementById('donut-avail');
    const yellowCircle = document.getElementById('donut-prep');
    const redCircle    = document.getElementById('donut-occ');
    const centerText   = document.getElementById('donut-total');
    const statAvail    = document.getElementById('stat-avail');
    const statOcc      = document.getElementById('stat-occ');
    const statPrep     = document.getElementById('stat-prep');

    if (greenCircle)  greenCircle.setAttribute('stroke-dasharray',  `${availLen} ${C - availLen}`);
    if (yellowCircle) { yellowCircle.setAttribute('stroke-dasharray', `${prepLen} ${C - prepLen}`); yellowCircle.setAttribute('stroke-dashoffset', `-${availLen}`); }
    if (redCircle)    { redCircle.setAttribute('stroke-dasharray',   `${occLen} ${C - occLen}`);    redCircle.setAttribute('stroke-dashoffset',   `-${availLen + prepLen}`); }
    if (centerText)   centerText.textContent = total;
    if (statAvail)    statAvail.textContent = avail;
    if (statOcc)      statOcc.textContent   = occ;
    if (statPrep)     statPrep.textContent  = prep;
  }

  function markBedOccupied(bedId) {
    // Find the bed card in the individual bed grid and visually mark it occupied
    const allBedCards = document.querySelectorAll('[data-bed-id]');
    allBedCards.forEach(card => {
      if (card.dataset.bedId === bedId) {
        card.classList.remove('border-tertiary/30', 'hover:border-tertiary', 'cursor-pointer', 'bg-surface-container-lowest');
        card.classList.add('opacity-70', 'bg-surface-container-low');
        const statusEl = card.querySelector('.bed-status');
        if (statusEl) { statusEl.textContent = 'Occupied'; statusEl.classList.add('text-primary'); statusEl.classList.remove('text-secondary'); }
        const dot = card.querySelector('.bed-dot');
        if (dot) { dot.classList.remove('bg-tertiary'); dot.classList.add('bg-primary'); }
      }
    });
  }

  // ─── Toast ────────────────────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  // ─── Navigation ──────────────────────────────────────────────────────────
  function refreshClusters(btn) {
    const icon = btn.querySelector('.material-symbols-outlined');
    icon.style.transition = 'transform 0.6s ease';
    icon.style.transform = 'rotate(360deg)';
    setTimeout(() => { icon.style.transition = ''; icon.style.transform = ''; }, 650);
    const ts = btn.closest('.flex').querySelector('span:first-child');
    if (ts) ts.textContent = 'Last update: just now';
    // Re-fetch bed counts
    if (currentHospitalId) {
      fetch(`${API}/hospitals/${currentHospitalId}`)
        .then(r => r.json())
        .then(h => refreshBedFromHospitalDoc(h))
        .catch(() => {});
    }
  }

  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    const navMap = { dashboard: 'nav-dashboard', beds: 'nav-beds', handover: 'nav-handover' };
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('text-primary', 'border-b-2', 'border-primary', 'pb-1', 'font-semibold');
      link.classList.add('text-secondary', 'font-medium');
    });
    const active = document.getElementById(navMap[pageId]);
    if (active) {
      active.classList.remove('text-secondary', 'font-medium');
      active.classList.add('text-primary', 'border-b-2', 'border-primary', 'pb-1', 'font-semibold');
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', initDashboard);

