(async function () {
  // 已登录直接跳转
  if (api.token) {
    try {
      const r = await api.get('/api/auth/me');
      if (r && r.user) { location.href = '/app.html'; return; }
    } catch (e) { api.clear(); }
  }

  const form = document.getElementById('loginForm');
  const errBox = document.getElementById('err');
  const btn = document.getElementById('loginBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    const name = document.getElementById('name').value.trim();
    const password = document.getElementById('password').value;
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const r = await api.post('/api/auth/login', { name, password });
      api.setToken(r.token);
      api.setUser(r.user);
      location.href = '/app.html';
    } catch (err) {
      errBox.textContent = err.message;
      errBox.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '登 录';
    }
  });
})();
