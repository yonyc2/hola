document.addEventListener('DOMContentLoaded', () => {
  loadUsers();
  loadHistory();

  document.getElementById('userForm').addEventListener('submit', createUser);
  document.getElementById('loadHistoryBtn').addEventListener('click', loadHistory);
  document.getElementById('historyLimit').addEventListener('change', loadHistory);
  document.getElementById('historyAction').addEventListener('change', renderHistory);
  document.getElementById('historySearch').addEventListener('input', debounce(renderHistory, 150));
  document.getElementById('exportDbBtn').addEventListener('click', exportDatabase);
});

async function loadUsers() {
  try {
    const users = await api('/api/users');
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = '';

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6">No hay usuarios</td></tr>';
      return;
    }

    for (const user of users) {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(user.id)}</td>
        <td>${escapeHtml(user.username)}</td>
        <td>${escapeHtml(user.full_name)}</td>
        <td>${escapeHtml(user.role)}</td>
        <td>
          ${
            user.active
              ? '<span class="badge ok">Activo</span>'
              : '<span class="badge error">Inactivo</span>'
          }
        </td>
        <td>
          <button class="small" data-action="toggleUser" data-id="${escapeHtml(user.id)}">
            ${user.active ? 'Desactivar' : 'Activar'}
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    }

    animateRows(tbody);
  } catch (err) {
    showMessage('adminMsg', err.message, 'error');
  }
}

async function createUser(e) {
  e.preventDefault();

  const payload = {
    username: document.getElementById('username').value,
    full_name: document.getElementById('full_name').value,
    password: document.getElementById('password').value,
    role: document.getElementById('role').value
  };

  try {
    await api('/api/users', {
      method: 'POST',
      body: payload
    });

    showMessage('adminMsg', 'Usuario creado correctamente', 'success');
    e.target.reset();
    loadUsers();
  } catch (err) {
    showMessage('adminMsg', err.message, 'error');
  }
}

async function toggleUser(id) {
  try {
    await api(`/api/users/${id}/toggle`, {
      method: 'POST'
    });

    loadUsers();
  } catch (err) {
    showMessage('adminMsg', err.message, 'error');
  }
}

const ACTIONS = {
  LOGIN:               { label: 'Inicio de sesión',   cls: 'info' },
  LOGOUT:              { label: 'Cierre de sesión',   cls: 'neutral' },
  LOGIN_FALLIDO:       { label: 'Login fallido',      cls: 'error' },
  ALTA_HUESPED:        { label: 'Alta de huésped',    cls: 'ok' },
  ACTUALIZAR_HUESPED:  { label: 'Huésped actualizado', cls: 'warn' },
  CHECKOUT:            { label: 'Check-out',          cls: 'purple' },
  ENTREGA_TOALLAS:     { label: 'Entrega de toallas', cls: 'blue' },
  DEVOLUCION_TOALLAS:  { label: 'Devolución de toallas', cls: 'teal' },
  EXPORTAR_BD:         { label: 'Exportación de BD',  cls: 'neutral' }
};

const FIELD_LABELS = {
  guest_name: 'Huésped', room_number: 'Habitación', guest_barcode: 'Código',
  cards_count: 'Tarjetas', towel_limit: 'Límite', initial_towels: 'Toallas iniciales',
  current_towels: 'Toallas', comment: 'Comentario', status: 'Estado', quantity: 'Cantidad',
  username: 'Usuario', usuarios: 'Usuarios', huespedes_activos: 'Huéspedes activos', huespedes_checkout: 'Huéspedes con check-out'
};

let historyRows = [];

function actionInfo(action) {
  return ACTIONS[action] || { label: String(action || '').replace(/_/g, ' ').toLowerCase(), cls: 'neutral' };
}

async function loadHistory() {
  try {
    const limit = Number(document.getElementById('historyLimit').value) || 200;
    historyRows = await api(`/api/history?limit=${limit}`);

    // Rellena el filtro de acciones con las que existen
    const select = document.getElementById('historyAction');
    const current = select.value;
    const present = [...new Set(historyRows.map(r => r.action))].sort();
    select.innerHTML = '<option value="">Todas las acciones</option>' +
      present.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(actionInfo(a).label)}</option>`).join('');
    select.value = present.includes(current) ? current : '';

    renderHistory();
  } catch (err) {
    showMessage('adminMsg', err.message, 'error');
  }
}

function renderHistory() {
  const tbody = document.getElementById('historyBody');
  const q = document.getElementById('historySearch').value.trim().toLowerCase();
  const action = document.getElementById('historyAction').value;

  const rows = historyRows.filter(row => {
    if (action && row.action !== action) return false;
    if (!q) return true;
    const hay = [historyUser(row), row.full_name, row.guest_name, row.room_number,
      actionInfo(row.action).label, row.action, row.old_values, row.new_values, row.created_at_cdmx]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });

  document.getElementById('historyCount').textContent =
    rows.length === historyRows.length
      ? `${rows.length} registro${rows.length === 1 ? '' : 's'}`
      : `${rows.length} de ${historyRows.length} registros`;

  tbody.innerHTML = '';

  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No hay registros que coincidan</td></tr>';
    return;
  }

  for (const row of rows) {
    const info = actionInfo(row.action);
    const [date = '', time = ''] = String(row.created_at_cdmx || '').split(' ');
    const user = historyUser(row);
    const initial = (user.trim()[0] || '?').toUpperCase();
    const guest = row.guest_name
      ? `<div class="h-guest">${escapeHtml(row.guest_name)}</div>` +
        (row.room_number ? `<span class="room-pill">Hab. ${escapeHtml(row.room_number)}</span>` : '')
      : '<span class="muted">—</span>';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="h-date"><strong>${escapeHtml(time)}</strong><span>${escapeHtml(date)}</span></td>
      <td>${user
        ? `<div class="h-user"><span class="avatar">${escapeHtml(initial)}</span><span>${escapeHtml(user)}</span></div>`
        : '<span class="muted">Sistema</span>'}</td>
      <td><span class="tag ${info.cls}">${escapeHtml(info.label)}</span></td>
      <td>${guest}</td>
      <td>${formatChanges(row.old_values, row.new_values)}</td>
    `;
    tbody.appendChild(tr);
  }

  animateRows(tbody);
}

// Usuario que realizó la acción. En un login fallido no hay sesión: se muestra el usuario que se intentó usar.
function historyUser(row) {
  if (row.username) return row.username;

  if (row.action === 'LOGIN_FALLIDO') {
    try {
      const attempted = JSON.parse(row.new_values || '{}').username;
      if (attempted) return `${attempted} (no autenticado)`;
    } catch (e) {
      // ignore
    }
  }

  return '';
}

async function exportDatabase() {
  const ok = window.confirm(
    'Se descargará la base de datos en Excel y después se BORRARÁ el historial.\n\n' +
    'Se conservan los usuarios y todos los huéspedes (activos y con check-out) con sus movimientos.\n\n¿Deseas continuar?'
  );
  if (!ok) return;

  const btn = document.getElementById('exportDbBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/export-db', { method: 'POST' });

    if (res.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }

    const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = match ? match[1] : 'toallas-respaldo.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showMessage('adminMsg', 'Excel descargado. Se limpió el historial; usuarios y huéspedes se conservan.', 'success');
    loadHistory();
  } catch (err) {
    showMessage('adminMsg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function parseJson(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function showValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// Muestra los cambios como "Campo: antes → después"; si no hay valor anterior, solo el nuevo.
function formatChanges(oldRaw, newRaw) {
  const oldV = parseJson(oldRaw);
  const newV = parseJson(newRaw);

  if (!oldV && !newV) return oldRaw || newRaw ? escapeHtml(oldRaw || newRaw) : '<span class="muted">—</span>';

  const keys = [...new Set([...Object.keys(oldV || {}), ...Object.keys(newV || {})])];
  const chips = [];

  for (const k of keys) {
    const o = oldV ? oldV[k] : undefined;
    const n = newV ? newV[k] : undefined;
    if (oldV && newV && JSON.stringify(o) === JSON.stringify(n)) continue; // sin cambios
    const label = escapeHtml(FIELD_LABELS[k] || k);

    if (oldV && newV && o !== undefined && n !== undefined) {
      chips.push(`<span class="chg"><b>${label}</b> <s>${escapeHtml(showValue(o))}</s> &rarr; <em>${escapeHtml(showValue(n))}</em></span>`);
    } else {
      chips.push(`<span class="chg"><b>${label}</b> ${escapeHtml(showValue(n !== undefined ? n : o))}</span>`);
    }
  }

  return chips.length ? `<div class="chg-list">${chips.join('')}</div>` : '<span class="muted">Sin cambios</span>';
}

actions.toggleUser = toggleUser;
