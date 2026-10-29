let currentStay = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('scanInput').focus();

  document.getElementById('scanInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const code = this.value.trim();
      if (!code) return;
      scanCode(code);
      this.value = '';
    }
  });

  document.getElementById('deliverBtn').addEventListener('click', () => moveTowel('entrega'));
  document.getElementById('returnBtn').addEventListener('click', () => moveTowel('devolucion'));

  startSocket(refreshCurrent);
});

async function scanCode(code) {
  try {
    const data = await api(`/api/scan/${encodeURIComponent(code)}`);
    currentStay = data;
    renderGuest();
    const gc = document.getElementById('guestCard');
    gc.classList.remove('scanned');
    void gc.offsetWidth;
    gc.classList.add('scanned');
    showMessage('toalleroMsg', 'Tarjeta encontrada', 'success');
  } catch (err) {
    currentStay = null;
    document.getElementById('guestCard').classList.add('hidden');
    showMessage('toalleroMsg', err.message, 'error');
  }
}

function renderGuest() {
  if (!currentStay) return;

  document.getElementById('guestCard').classList.remove('hidden');

  document.getElementById('tName').textContent = currentStay.guest_name;
  document.getElementById('tRoom').textContent = currentStay.room_number;
  document.getElementById('tBarcode').textContent = currentStay.guest_barcode;
  document.getElementById('tCards').textContent = currentStay.cards_count;
  document.getElementById('tEntry').textContent = currentStay.entry_date_cdmx;
  document.getElementById('tExit').textContent = currentStay.exit_date_cdmx || 'Pendiente';
  document.getElementById('tStatus').textContent = currentStay.status;
  document.getElementById('tLimit').textContent = currentStay.towel_limit;
  setTextAnimated('tCurrent', currentStay.current_towels);
  setTextAnimated('tRemaining', currentStay.towel_limit - currentStay.current_towels);
  document.getElementById('tComment').textContent = currentStay.comment || '';

  renderMovements();
}

function renderMovements() {
  const tbody = document.getElementById('tMovs');
  tbody.innerHTML = '';

  if (!currentStay.movements || !currentStay.movements.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin movimientos</td></tr>';
    return;
  }

  for (const mov of currentStay.movements) {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHtml(mov.created_at_cdmx)}</td>
      <td>${escapeHtml(mov.username || '')}</td>
      <td>${escapeHtml(mov.movement_type)}</td>
      <td>${mov.quantity > 0 ? '+' : ''}${escapeHtml(mov.quantity)}</td>
      <td>${escapeHtml(mov.balance_after)}</td>
    `;

    tbody.appendChild(tr);
  }

  animateRows(tbody);
}

async function moveTowel(action) {
  if (!currentStay) {
    showMessage('toalleroMsg', 'Primero escanea una tarjeta', 'error');
    return;
  }

  const qty = Number(document.getElementById('qty').value);

  if (!Number.isInteger(qty) || qty <= 0) {
    showMessage('toalleroMsg', 'Cantidad inválida', 'error');
    return;
  }

  try {
    await api(`/api/stays/${currentStay.id}/towels`, {
      method: 'POST',
      body: {
        action,
        qty
      }
    });

    document.getElementById('qty').value = 1;
    await refreshCurrent();
    showMessage('toalleroMsg', 'Movimiento registrado correctamente', 'success');
  } catch (err) {
    showMessage('toalleroMsg', err.message, 'error');
  }
}

async function refreshCurrent() {
  if (currentStay && currentStay.guest_barcode) {
    await scanCode(currentStay.guest_barcode);
  }
}
