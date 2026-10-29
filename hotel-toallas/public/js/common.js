async function api(url, options = {}) {
  const opts = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };

  if (options.body && typeof options.body === 'object') {
    opts.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, opts);

  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // ignore
  }

  if (res.status === 401 && !url.includes('/api/login')) {
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }

  return data;
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  window.location.href = '/login';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const _msgTimers = {};

function showMessage(elementId, message, type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;

  clearTimeout(_msgTimers[elementId]);
  el.className = `alert ${type}`;
  el.textContent = message;

  _msgTimers[elementId] = setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'alertOut') el.classList.add('hidden');
    }, { once: true });
  }, 6000);
}

// Anima las filas solo en la primera carga (evita parpadeo en actualizaciones en tiempo real)
function animateRows(tbody) {
  if (!tbody || tbody.dataset.seen) return;
  tbody.dataset.seen = '1';
  tbody.classList.add('stagger');
  setTimeout(() => tbody.classList.remove('stagger'), 900);
}

// Cambia un texto y resalta el valor si cambió
function setTextAnimated(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = String(value ?? '');
  const changed = el.textContent !== '' && el.textContent !== next;
  el.textContent = next;
  if (changed) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

// Acciones de botones (sustituye a onclick en línea, bloqueado por la política CSP)
const actions = { logout };

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = actions[btn.dataset.action];
  if (typeof fn === 'function') {
    fn(btn.dataset.id !== undefined ? Number(btn.dataset.id) : undefined, btn);
  }
});

function startSocket(callback) {
  if (!window.io) return;

  const socket = io();

  socket.on('stay-updated', () => {
    if (typeof callback === 'function') callback();
  });

  socket.on('stays-updated', () => {
    if (typeof callback === 'function') callback();
  });
}

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}
