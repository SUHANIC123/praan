// ── Clock ──
  setInterval(() => {
    document.getElementById('live-clock').textContent =
      new Date().toLocaleTimeString('en-GB', { hour12: false });
  }, 1000);
  document.getElementById('live-clock').textContent =
    new Date().toLocaleTimeString('en-GB', { hour12: false });

  // ── Toast helper ──
  function showToast(msg) {
    const t = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    t.style.display = 'flex';
    t.classList.remove('hidden');
    setTimeout(() => { t.style.display = 'none'; t.classList.add('hidden'); }, 3000);
  }

  // ── Drawer ──
  const drawer = document.getElementById('unit-drawer');
  function openDrawer(card) {
    document.getElementById('drawer-unit').textContent   = card.dataset.unit;
    document.getElementById('drawer-driver').textContent = card.dataset.driver;
    document.getElementById('drawer-location').textContent = card.dataset.location;
    const initials = card.dataset.driver.split(' ').map(w => w[0]).join('').slice(0,2);
    document.getElementById('drawer-avatar').textContent = initials;
    const badge = document.getElementById('drawer-status-badge');
    const statusMap = { available: ['bg-emerald-100 text-emerald-700', 'Available'], enroute: ['bg-blue-100 text-blue-700', 'En Route'], offline: ['bg-slate-100 text-slate-600', 'Offline'] };
    const [cls, label] = statusMap[card.dataset.status] || ['bg-slate-100 text-slate-600', card.dataset.status];
    badge.className = 'ml-auto px-3 py-1 rounded-full text-[10px] font-bold uppercase ' + cls;
    badge.textContent = label;
    drawer.classList.add('open');
  }
  document.getElementById('drawer-close').addEventListener('click', () => drawer.classList.remove('open'));

  document.querySelectorAll('.amb-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      openDrawer(card);
    });
  });

  // ── Dispatch buttons ──
  document.querySelectorAll('.dispatch-unit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = btn.closest('.amb-card');
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;font-variation-settings:\'FILL\' 1;">check_circle</span> DISPATCHED';
      btn.disabled = true;
      btn.classList.replace('bg-emerald-500', 'bg-slate-300');
      btn.classList.remove('hover:bg-emerald-600');
      showToast(card.dataset.unit + ' dispatched successfully!');
    });
  });

  // ── Mark Available ──
  document.querySelectorAll('.mark-available-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showToast('Unit marked as available.');
      btn.textContent = 'MARKED AVAILABLE ✓';
      btn.disabled = true;
    });
  });

  // ── Add Ambulance Modal ──
  document.getElementById('add-amb-btn').addEventListener('click', () => {
    document.getElementById('add-modal').classList.add('open');
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('add-modal').classList.remove('open');
  });
  document.getElementById('add-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('add-modal'))
      document.getElementById('add-modal').classList.remove('open');
  });
  document.getElementById('add-amb-form').addEventListener('submit', e => {
    e.preventDefault();
    document.getElementById('add-modal').classList.remove('open');
    showToast('New ambulance added to fleet!');
    e.target.reset();
  });

  // ── Filter buttons ──
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => {
        b.classList.remove('active', 'bg-primary-container', 'text-white');
        b.classList.add('bg-surface-container', 'text-slate-700');
      });
      btn.classList.add('active', 'bg-primary-container', 'text-white');
      btn.classList.remove('bg-surface-container', 'text-slate-700');

      const f = btn.dataset.filter;
      document.querySelectorAll('.amb-card').forEach(card => {
        const typeMatch   = f === 'all' || card.dataset.type === f.toUpperCase();
        const statusMatch = f === 'all' || card.dataset.status === f ||
                            (f === 'ALS' && card.dataset.type === 'ALS') ||
                            (f === 'BLS' && card.dataset.type === 'BLS') ||
                            (f === 'ICU' && card.dataset.type === 'ICU');
        const show = f === 'all'
          ? true
          : ['available','enroute','offline'].includes(f)
            ? card.dataset.status === f
            : card.dataset.type === f.toUpperCase();
        card.style.display = show ? '' : 'none';
      });
    });
  });

  // ── Search ──
  document.getElementById('search-input').addEventListener('input', function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll('.amb-card').forEach(card => {
      const text = (card.dataset.unit + card.dataset.driver + card.dataset.location + card.dataset.type).toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // ── View toggle ──
  const btnGrid = document.getElementById('btn-grid');
  const btnList = document.getElementById('btn-list');

  function buildListView() {
    const tbody = document.getElementById('list-tbody');
    tbody.innerHTML = '';
    document.querySelectorAll('.amb-card').forEach(card => {
      const statusColors = { available: 'text-emerald-600', enroute: 'text-blue-600', offline: 'text-slate-400' };
      const row = document.createElement('tr');
      row.className = 'border-b border-slate-50 hover:bg-surface-container-low transition-colors cursor-pointer';
      row.innerHTML = `
        <td class="px-6 py-4 font-extrabold">${card.dataset.unit}</td>
        <td class="px-6 py-4 font-bold text-slate-500">${card.dataset.type}</td>
        <td class="px-6 py-4 font-medium">${card.dataset.driver}</td>
        <td class="px-6 py-4 text-slate-500">${card.dataset.location}</td>
        <td class="px-6 py-4 font-bold uppercase text-[11px] ${statusColors[card.dataset.status] || ''}">${card.dataset.status}</td>
        <td class="px-6 py-4">—</td>
        <td class="px-6 py-4">
          <button class="text-xs font-bold px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-highest transition-all">Details</button>
        </td>`;
      row.querySelector('button').addEventListener('click', () => openDrawer(card));
      tbody.appendChild(row);
    });
  }

  btnGrid.addEventListener('click', () => {
    document.body.classList.remove('list-mode');
    btnGrid.classList.add('bg-primary-container','text-white');
    btnGrid.classList.remove('text-slate-500','hover:bg-slate-100');
    btnList.classList.remove('bg-primary-container','text-white');
    btnList.classList.add('text-slate-500','hover:bg-slate-100');
  });
  btnList.addEventListener('click', () => {
    buildListView();
    document.body.classList.add('list-mode');
    btnList.classList.add('bg-primary-container','text-white');
    btnList.classList.remove('text-slate-500','hover:bg-slate-100');
    btnGrid.classList.remove('bg-primary-container','text-white');
    btnGrid.classList.add('text-slate-500','hover:bg-slate-100');
  });

