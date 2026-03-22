document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  updateNavAuthUI();

  const id = Session.getIncidentId();
  const tr = document.getElementById('nav-track-dash');
  if (tr && id) tr.href = `track.html?id=${id}`;

  document.getElementById('btnLogout').addEventListener('click', () => Auth.logout());

  try {
    const me = await apiFetchAuth('/auth/me');
    document.getElementById('dashGreeting').textContent = `Hi, ${me.name || 'there'}`;
    document.getElementById('statPhone').textContent = me.phone || '—';

    const rides = await apiFetchAuth('/users/me/history');
    document.getElementById('statRides').textContent = rides.length;

    let total = 0;
    let currency = 'INR';
    rides.forEach(r => {
      if (r.status === 'completed' && r.billing && typeof r.billing.total === 'number') {
        total += r.billing.total;
        if (r.billing.currency) currency = r.billing.currency;
      }
    });
    const sym = currency === 'INR' ? '₹' : (currency + ' ');
    document.getElementById('statSpend').textContent = `${sym}${total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  } catch (e) {
    showToast(e.message || 'Session expired', 'error');
    Auth.clear();
    window.location.href = 'login.html';
  }
});
