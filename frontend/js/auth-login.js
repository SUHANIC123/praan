(function () {
  function showTab(name) {
    document.querySelectorAll('.auth-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.getElementById('panelLogin').classList.toggle('active', name === 'login');
    document.getElementById('panelRegister').classList.toggle('active', name === 'register');
  }

  document.getElementById('tabLogin').addEventListener('click', () => showTab('login'));
  document.getElementById('tabRegister').addEventListener('click', () => showTab('register'));

  if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
    window.location.replace('dashboard.html');
  }

  document.getElementById('formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password })
      });
      Auth.setSession(data.token, data.user);
      showToast('Signed in', 'success');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 400);
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    }
  });

  document.getElementById('formRegister').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, phone, email: email || undefined, password })
      });
      Auth.setSession(data.token, data.user);
      showToast('Account created', 'success');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 400);
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    }
  });
})();
