let staysCache = [];
let currentStay = null;

document.addEventListener('DOMContentLoaded', () => {
  loadStays();

  startSocket(() => {
    loadStays();
    if (currentStay && currentStay.id) {
      selectStay(currentStay.id);
    }
  });

  document.getElementById('newStayForm').addEventListener('submit', createStay);
  document.getElementById('searchInput').addEventListener('input', debounce(loadStays, 300));
  document.getElementById('showAll').addEventListener('change', loadStays);
  document.getElementById('saveStayBtn').addEventListener('click', saveCurrentStay);
  document.getElementById('checkoutBtn').addEventListener('click', checkoutCurrentStay);
});

async function loadStays() {
  try {
    const q = document.getElementById('searchInput').value.trim();
    const showAll = document.getElementById('showAll').checked;
    const status = showAll ? 'todos' : 'activo';

    const data = await api(`/api/stays?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    staysCache = data;
    renderStays();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

function renderStays() {
  const tbody = document.getElementById('staysBody');
  tbody.innerHTML = '';

  if (!staysCache.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">No hay huéspedes registrados</td>
      </tr>
    `;
    return;
  }

  for (const stay of staysCache) {
    const remaining = stay.towel_limit - stay.current_towels;
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHtml(stay.room_number)}</td>
      <td>${escapeHtml(stay.guest_name)}</td>
      <td>${escapeHtml(stay.guest_barcode || '')}</td>
      <td>${escapeHtml(stay.cards_count)}</td>
      <td>${escapeHtml(stay.towel_limit)}</td>
      <td>${escapeHtml(stay.current_towels)}</td>
      <td>${escapeHtml(remaining)}</td>
      <td>
        ${
          stay.status === 'activo'
            ? '<span class="badge ok">Activo</span>'
            : '<span class="badge error">Salido</span>'
        }
      </td>
      <td>
        <button class="small" data-action="selectStay" data-id="${escapeHtml(stay.id)}">Ver</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  animateRows(tbody);
}

async function createStay(e) {
  e.preventDefault();

  const payload = {
    guest_name: document.getElementById('guest_name').value,
    room_number: document.getElementById('room_number').value,
    guest_barcode: document.getElementById('guest_barcode').value.trim(),
    cards_count: Number(document.getElementById('cards_count').value),
    towel_limit: Number(document.getElementById('towel_limit').value),
    initial_towels: Number(document.getElementById('initial_towels').value),
    comment: document.getElementById('comment').value
  };

  try {
    const stay = await api('/api/stays', {
      method: 'POST',
      body: payload
    });

    showMessage('recepcionMsg', `Huésped registrado. Código de tarjeta: ${stay.guest_barcode}`, 'success');
    loadStays();
    e.target.reset();

    document.getElementById('cards_count').value = 1;
    document.getElementById('towel_limit').value = 5;
    document.getElementById('initial_towels').value = 0;
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

async function selectStay(id) {
  try {
    const stay = await api(`/api/stays/${id}`);
    currentStay = stay;
    renderDetail();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

function renderDetail() {
  if (!currentStay) return;

  document.getElementById('stayDetail').classList.remove('hidden');

  document.getElementById('detailName').textContent = currentStay.guest_name;
  document.getElementById('detailRoom').textContent = currentStay.room_number;
  document.getElementById('detailBarcode').textContent = currentStay.guest_barcode;
  document.getElementById('detailEntry').textContent = currentStay.entry_date_cdmx;
  document.getElementById('detailExit').textContent = currentStay.exit_date_cdmx || 'Pendiente';
  document.getElementById('detailStatus').textContent = currentStay.status;
  setTextAnimated('detailCurrent', currentStay.current_towels);
  setTextAnimated('detailRemaining', currentStay.towel_limit - currentStay.current_towels);

  document.getElementById('detailLimit').value = currentStay.towel_limit;
  document.getElementById('detailCards').value = currentStay.cards_count;
  document.getElementById('detailComment').value = currentStay.comment || '';

  const checkoutBtn = document.getElementById('checkoutBtn');

  if (currentStay.status !== 'activo') {
    checkoutBtn.disabled = true;
  } else if (currentStay.current_towels !== 0) {
    checkoutBtn.disabled = true;
  } else {
    checkoutBtn.disabled = false;
  }
}

async function saveCurrentStay() {
  if (!currentStay) return;

  const payload = {
    towel_limit: Number(document.getElementById('detailLimit').value),
    cards_count: Number(document.getElementById('detailCards').value),
    comment: document.getElementById('detailComment').value
  };

  try {
    await api(`/api/stays/${currentStay.id}`, {
      method: 'PATCH',
      body: payload
    });

    showMessage('recepcionMsg', 'Datos actualizados correctamente', 'success');
    await selectStay(currentStay.id);
    await loadStays();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

async function checkoutCurrentStay() {
  if (!currentStay) return;

  if (currentStay.current_towels !== 0) {
    showMessage('recepcionMsg', 'No se puede hacer check-out si el huésped tiene toallas pendientes', 'error');
    return;
  }

  if (!confirm('¿Confirmas la salida del huésped?')) return;

  try {
    await api(`/api/stays/${currentStay.id}/checkout`, {
      method: 'POST'
    });

    showMessage('recepcionMsg', 'Check-out realizado correctamente', 'success');
    await loadStays();
    await selectStay(currentStay.id);
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

actions.selectStay = selectStay;
actions.reload = loadStays;
