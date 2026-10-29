document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const msg = document.getElementById('loginMsg');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const card = document.getElementById('loginCard');
  const btn = e.target.querySelector('button[type="submit"]');

  msg.className = 'hidden';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Error al iniciar sesión');
    }

    if (data.role === 'admin') {
      window.location.href = '/admin';
    } else if (data.role === 'recepcion') {
      window.location.href = '/recepcion';
    } else if (data.role === 'toallero') {
      window.location.href = '/toallero';
    } else {
      window.location.href = '/login';
    }
  } catch (err) {
    msg.className = 'alert error';
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Entrar';
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }
});
