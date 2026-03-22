function formatMoney(billing) {
  if (!billing || typeof billing.total !== 'number') return '—';
  const c = billing.currency || 'INR';
  const sym = c === 'INR' ? '₹' : `${c} `;
  return `${sym}${billing.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function statusClass(s) {
  if (s === 'completed') return 'completed';
  if (s === 'cancelled') return 'cancelled';
  return 'dispatched';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  updateNavAuthUI();
  document.getElementById('btnLogout').addEventListener('click', () => Auth.logout());

  try {
    const rides = await apiFetchAuth('/users/me/history');
    const tbody = document.getElementById('histBody');
    const table = document.getElementById('histTable');
    const empty = document.getElementById('histEmpty');

    if (!rides.length) {
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    tbody.innerHTML = rides.map(r => {
      const d = r.createdAt ? new Date(r.createdAt) : null;
      const dateStr = d
        ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      const amb = r.assignedAmbulance;
      const ambStr = amb ? `${amb.unitId || ''} (${amb.type || ''})`.trim() : '—';
      const hosp = r.assignedHospital;
      const hospStr = hosp ? (hosp.name + (hosp.city ? ` · ${hosp.city}` : '')) : '—';
      const caseStr = [r.caseType || '—', r.ambulanceType ? r.ambulanceType + ' unit' : ''].filter(Boolean).join(' · ');
      return `
        <tr>
          <td class="mono">${dateStr}</td>
          <td>${escapeHtml(caseStr)}</td>
          <td><span class="status-pill ${statusClass(r.status)}">${escapeHtml(r.status || '')}</span></td>
          <td>${escapeHtml(ambStr)}</td>
          <td>${escapeHtml(hospStr)}</td>
          <td class="mono">${formatMoney(r.billing)}</td>
          <td><a class="link-sum" href="summary.html?id=${r._id}">Summary</a></td>
        </tr>`;
    }).join('');
  } catch (e) {
    showToast(e.message || 'Could not load history', 'error');
    Auth.clear();
    window.location.href = 'login.html';
  }
});

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
