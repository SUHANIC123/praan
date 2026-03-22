/* ============================================================
   SUMMARY PAGE — Incident Complete, Billing, Actions
   ============================================================ */

function fmt(amount) {
  return '$' + Number(amount).toFixed(2);
}

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${s} sec`;
}

function renderPending(incident) {
  if (incident.status === 'cancelled') {
    document.getElementById('summary-content').innerHTML = `
      <div class="pending-overlay">
        <div class="pending-icon">❌</div>
        <h2>Request cancelled</h2>
        <p>This request was cancelled. You can start a new request from the home page.</p>
        <a href="index.html" class="btn btn-primary" style="margin-top:20px;display:inline-flex">Go to Home</a>
      </div>
    `;
    return;
  }
  const isAwaitingDispatch = incident.status === 'requested';
  const body = isAwaitingDispatch
    ? '<p>Your request is waiting for dispatch to assign an ambulance. Open track to follow updates in real time.</p>'
    : '<p>Your ambulance is currently active. The summary will appear once the incident is complete.</p>';
  document.getElementById('summary-content').innerHTML = `
    <div class="pending-overlay">
      <div class="pending-icon">${isAwaitingDispatch ? '⏳' : '🚑'}</div>
      <h2>${isAwaitingDispatch ? 'Awaiting dispatch' : 'Incident In Progress'}</h2>
      ${body}
      <p style="margin-top:8px;font-size:13px;color:var(--text-muted)">Status: <b>${incident.status?.replace('_',' ').toUpperCase()}</b></p>
      <a href="track.html?id=${incident._id}" class="btn btn-primary" style="margin-top:20px;display:inline-flex">
        Track Live →
      </a>
    </div>
  `;
}

function renderSummary(incident) {
  const amb = incident.assignedAmbulance;
  const hosp = incident.assignedHospital;
  const b = incident.billing || {};
  const crewNames = amb?.crew?.map(c => c.name).join(' • ') || '—';
  const responseStr = incident.responseTimeSeconds ? fmtTime(incident.responseTimeSeconds) : '6 min 42 sec';
  const durationStr = incident.totalDurationMinutes ? `${incident.totalDurationMinutes} min total` : '22 min total';

  document.getElementById('summary-content').innerHTML = `
    <!-- Completion hero -->
    <div class="completion-hero">
      <div class="check-circle">✅</div>
      <h1>Incident Complete</h1>
      <p>Patient successfully transported to ${hosp?.name || 'Hospital'}</p>
    </div>

    <!-- Stats card -->
    <div class="stats-card">
      <div class="stats-top">
        <div class="stat-item">
          <div class="stat-label">Response Time</div>
          <div class="stat-value">${responseStr}</div>
        </div>
        <div class="stat-item" style="text-align:right">
          <div class="stat-label">Total Duration</div>
          <div class="stat-value dark">${durationStr}</div>
        </div>
      </div>
      <div class="stats-bottom">
        <div class="detail-item">
          <div class="detail-label">Vehicle &amp; Crew</div>
          <div class="detail-icon-row">
            <div class="detail-icon">🚑</div>
            <div>
              <div class="detail-main">${amb?.unitId || '—'} • ${crewNames}</div>
              <div class="detail-sub">${amb?.type === 'ALS' ? 'Critical Care Transport' : (amb?.type || '') + ' Transport'}</div>
            </div>
          </div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Destination</div>
          <div class="detail-icon-row">
            <div class="detail-icon">🏥</div>
            <div>
              <div class="detail-main">${hosp?.name || '—'}</div>
              <div class="detail-sub">${hosp?.type || '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Billing card -->
    <div class="billing-card">
      <div class="billing-header">
        <span class="bill-icon">🧾</span>
        Cost Breakdown
      </div>

      <div class="billing-row">
        <span class="row-label">Base fare</span>
        <span class="row-amount">${fmt(b.baseFare || 150)}</span>
      </div>
      <div class="billing-row">
        <span class="row-label">Distance (${b.distanceKm || 4.2} km)</span>
        <span class="row-amount">${fmt(b.distanceFare || 32)}</span>
      </div>
      <div class="billing-row">
        <span class="row-label">Emergency Surcharge</span>
        <span class="row-amount">${fmt(b.emergencySurcharge || 45)}</span>
      </div>
      ${b.paramedicFee > 0 ? `
      <div class="billing-row">
        <span class="row-label" style="color:var(--text-secondary)">Paramedic fee (${incident.ambulanceType || 'ALS'})</span>
        <span class="row-amount">${fmt(b.paramedicFee)}</span>
      </div>` : ''}

      <div class="billing-row subtotal">
        <span class="row-label font-semibold">Subtotal</span>
        <span class="row-amount">${fmt(b.subtotal || 347)}</span>
      </div>
      <div class="billing-row tax">
        <span class="row-label">GST (${((b.taxRate || 0.05) * 100).toFixed(0)}%)</span>
        <span class="row-amount">${fmt(b.tax || 17.35)}</span>
      </div>

      <div class="billing-total">
        <span class="total-label">Total</span>
        <span class="total-amount">${fmt(b.total || 364.35)}</span>
      </div>
      <div class="billing-note">Estimated — final bill will be issued by the hospital</div>
    </div>

    <!-- Action cards -->
    <div class="action-grid">
      <button class="act-card" onclick="startInsuranceClaim()">
        <div class="act-icon">🛡</div>
        <div class="act-label">Start Insurance Claim</div>
      </button>
      <button class="act-card" onclick="downloadReport('${incident._id}')">
        <div class="act-icon">📄</div>
        <div class="act-label">Download Report</div>
      </button>
      <button class="act-card yellow" onclick="rateCrew()">
        <div class="act-icon">⭐</div>
        <div class="act-label">Rate the Crew</div>
      </button>
      <a class="act-card teal" href="tel:${hosp?.phone || '011-26188500'}">
        <div class="act-icon">📞</div>
        <div class="act-label">Call Hospital</div>
      </a>
    </div>
  `;
}

function startInsuranceClaim() {
  showToast('Insurance claim portal opening...', '', 2000);
}

function downloadReport(id) {
  showToast('Generating PDF report...', '', 2500);
  setTimeout(() => {
    // In a full impl, call backend to generate PDF
    const content = `PRAN Emergency Report\nIncident ID: ${id}\nGenerated: ${new Date().toLocaleString()}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pran-report-${id}.txt`; a.click();
    URL.revokeObjectURL(url);
  }, 1000);
}

function rateCrew() {
  const stars = ['⭐','⭐⭐','⭐⭐⭐','⭐⭐⭐⭐','⭐⭐⭐⭐⭐'];
  const rating = stars[Math.floor(Math.random() * 5)];
  showToast(`Thank you for rating! ${rating}`, 'success', 3000);
}

async function init() {
  const params = new URLSearchParams(location.search);
  let incidentId = params.get('id') || Session.getIncidentId();

  if (!incidentId) {
    document.getElementById('summary-content').innerHTML = `
      <div class="pending-overlay">
        <div class="pending-icon">🏠</div>
        <h2>No Active Incident</h2>
        <p>Request an ambulance to see your incident summary here.</p>
        <a href="index.html" class="btn btn-primary" style="margin-top:20px;display:inline-flex">Go to Home</a>
      </div>
    `;
    return;
  }

  // Update nav links
  document.getElementById('btn-track').href = `track.html?id=${incidentId}`;

  try {
    const incident = await apiFetch(`/incidents/${incidentId}`);
    Session.setIncident(incident._id, incident.shareToken);

    document.getElementById('btn-share').href = `share.html?token=${incident.shareToken}`;

    if (incident.status === 'completed') {
      renderSummary(incident);
    } else {
      renderPending(incident);
    }
  } catch (err) {
    document.getElementById('summary-content').innerHTML = `
      <div class="pending-overlay">
        <div class="pending-icon">⚠️</div>
        <h2>Error Loading Incident</h2>
        <p>${err.message}</p>
        <a href="index.html" class="btn btn-primary" style="margin-top:20px;display:inline-flex">Go to Home</a>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
