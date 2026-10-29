const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const http = require('http');
const { Server } = require('socket.io');

// Configuración por variables de entorno (ver docs/DESPLIEGUE.md)
//   DATA_DIR       carpeta donde se guarda la base de datos y los respaldos (en la nube: un disco persistente)
//   NODE_ENV       "production" activa cookies seguras, HSTS y usuarios iniciales seguros
//   TRUST_PROXY    número de proxys delante del servidor (por defecto 1 en producción)
//   SESSION_SECRET clave de las sesiones (obligatoria en la nube)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const trustProxy = process.env.TRUST_PROXY !== undefined ? process.env.TRUST_PROXY : (IS_PROD ? '1' : '');
if (trustProxy !== '') app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
const server = http.createServer(app);
const io = new Server(server, {
  allowRequest: (req, cb) => cb(null, sameOrigin(req))
});

const db = new Database(path.join(DATA_DIR, 'toallas.db'));
db.pragma('journal_mode = WAL');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = loadSessionSecret();

// Secreto de sesión: variable de entorno o archivo local generado aleatoriamente
function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session_secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (e) { /* no existe aún */ }
  const secret = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch (e) { /* solo en memoria */ }
  return secret;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

// Bases creadas con versiones anteriores tenían guest_barcode UNIQUE para siempre, lo que impedía
// reutilizar un código tras el check-out. SQLite no permite quitar esa restricción: se reconstruye la tabla.
function migrateStaysTable() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stays'").get();
  if (!row || !/guest_barcode\s+TEXT\s+UNIQUE/i.test(row.sql)) return;

  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE stays RENAME TO stays_old;
        DROP INDEX IF EXISTS idx_active_room;
      `);
      db.exec(SCHEMA_SQL);
      db.exec(`
        INSERT INTO stays (
          id, guest_barcode, guest_name, room_number, cards_count, status,
          entry_date_utc, entry_date_cdmx, exit_date_utc, exit_date_cdmx,
          towel_limit, initial_towels, current_towels, comment, created_by, updated_by
        )
        SELECT
          id, COALESCE(guest_barcode, CAST(id AS TEXT)), guest_name, room_number, cards_count, status,
          entry_date_utc, entry_date_cdmx, exit_date_utc, exit_date_cdmx,
          towel_limit, initial_towels, current_towels, comment, created_by, updated_by
        FROM stays_old;
        DROP TABLE stays_old;
      `);
    })();
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

// =====================================================
// CREAR TABLAS
// =====================================================
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'recepcion', 'toallero')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at_utc TEXT NOT NULL,
    created_at_cdmx TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_barcode TEXT NOT NULL,
    guest_name TEXT NOT NULL,
    room_number TEXT NOT NULL,
    cards_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'salido')),
    entry_date_utc TEXT NOT NULL,
    entry_date_cdmx TEXT NOT NULL,
    exit_date_utc TEXT,
    exit_date_cdmx TEXT,
    towel_limit INTEGER NOT NULL CHECK (towel_limit >= 0),
    initial_towels INTEGER NOT NULL DEFAULT 0 CHECK (initial_towels >= 0),
    current_towels INTEGER NOT NULL DEFAULT 0 CHECK (current_towels >= 0),
    comment TEXT,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
  );

  -- Habitación y código solo deben ser únicos entre huéspedes ACTIVOS:
  -- al hacer check-out quedan libres para volver a usarse.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_room
  ON stays(room_number)
  WHERE status = 'activo';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_active_barcode
  ON stays(guest_barcode)
  WHERE status = 'activo';

  CREATE INDEX IF NOT EXISTS idx_stays_barcode ON stays(guest_barcode);

  CREATE TABLE IF NOT EXISTS towel_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stay_id INTEGER NOT NULL REFERENCES stays(id),
    card_id INTEGER,
    user_id INTEGER NOT NULL REFERENCES users(id),
    movement_type TEXT NOT NULL CHECK (movement_type IN ('entrega', 'devolucion', 'ajuste', 'inicial')),
    quantity INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT,
    created_at_utc TEXT NOT NULL,
    created_at_cdmx TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    stay_id INTEGER REFERENCES stays(id),
    old_values TEXT,
    new_values TEXT,
    created_at_utc TEXT NOT NULL,
    created_at_cdmx TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_movements_stay ON towel_movements(stay_id);
  CREATE INDEX IF NOT EXISTS idx_history_stay ON history(stay_id);
  CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at_cdmx);
`;

migrateStaysTable();
db.exec(SCHEMA_SQL);

// =====================================================
// HELPERS DE FECHA
// =====================================================
const utcNow = () => new Date().toISOString();

const cdmxNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

function insertHistory(userId, action, stayId, oldValues, newValues) {
  db.prepare(`
    INSERT INTO history (
      user_id,
      action,
      stay_id,
      old_values,
      new_values,
      created_at_utc,
      created_at_cdmx
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    action,
    stayId || null,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    utcNow(),
    cdmxNow()
  );
}

function toNonNegativeInt(value, fieldName, defaultValue = undefined) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`${fieldName} es requerido`);
  }

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} debe ser un entero mayor o igual a 0`);
  }

  if (n > 100000) {
    throw new Error(`${fieldName} es demasiado grande`);
  }

  return n;
}

function cleanText(value, fieldName, max, required = false) {
  const s = String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (required && !s) throw new Error(`${fieldName} es requerido`);
  if (s.length > max) throw new Error(`${fieldName} no puede exceder ${max} caracteres`);
  return s;
}

// No exponer detalles internos de SQLite al cliente
function safeError(err) {
  if (err && err.code && String(err.code).startsWith('SQLITE')) return 'No se pudo completar la operación';
  return err && err.message ? err.message : 'Error inesperado';
}

// =====================================================
// USUARIOS INICIALES
// =====================================================
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (
      username,
      password_hash,
      full_name,
      role,
      active,
      created_at_utc,
      created_at_cdmx
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  const nowUtc = utcNow();
  const nowCdmx = cdmxNow();

  if (IS_PROD) {
    // En la nube NO se crean usuarios con contraseñas conocidas: solo el administrador.
    let adminPass = process.env.INITIAL_ADMIN_PASSWORD;
    const generated = !adminPass;
    if (generated) adminPass = crypto.randomBytes(9).toString('base64url');
    insertUser.run('admin', bcrypt.hashSync(adminPass, 12), 'Administrador', 'admin', nowUtc, nowCdmx);
    console.log('Usuario inicial creado: admin');
    if (generated) {
      console.log(`Contraseña temporal de admin (cámbiala al entrar): ${adminPass}`);
    }
  } else {
    insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'Administrador', 'admin', nowUtc, nowCdmx);
    insertUser.run('recepcion', bcrypt.hashSync('recepcion123', 10), 'Recepción', 'recepcion', nowUtc, nowCdmx);
    insertUser.run('toallero', bcrypt.hashSync('toallero123', 10), 'Toallero', 'toallero', nowUtc, nowCdmx);

    console.log('Usuarios iniciales creados:');
    console.log('admin / admin123');
    console.log('recepcion / recepcion123');
    console.log('toallero / toallero123');
  }
}

// =====================================================
// MIDDLEWARE
// =====================================================
app.disable('x-powered-by');

// Cabeceras de seguridad
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  if (IS_PROD && req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/') || !path.extname(req.path)) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

// Comprobación de salud para la plataforma de hosting (no expone datos)
app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));
app.use(express.json({ limit: '20kb' }));

// Protección CSRF: las peticiones que modifican datos deben venir del mismo origen
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Origen no permitido' });
  next();
});

const sessionMiddleware = session({
  name: 'toallas.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === '1' : IS_PROD,
    maxAge: 8 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);

// Socket.IO solo para usuarios con sesión iniciada
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess && sess.userId) return next();
  next(new Error('No autenticado'));
});

function requireLogin(req, res, next) {
  if (req.session.userId) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  return res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session.role && roles.includes(req.session.role)) {
      return next();
    }

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Sin permiso para esta acción' });
    }

    return res.redirect('/');
  };
}

// =====================================================
// PAGINAS
// =====================================================
app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  if (req.session.role === 'admin') return res.redirect('/admin');
  if (req.session.role === 'recepcion') return res.redirect('/recepcion');
  if (req.session.role === 'toallero') return res.redirect('/toallero');

  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'login.html'));
});

app.get('/recepcion', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'recepcion.html'));
});

app.get('/toallero', requireLogin, requireRole('toallero', 'admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'toallero.html'));
});

app.get('/admin', requireLogin, requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'admin.html'));
});

// =====================================================
// API LOGIN
// =====================================================
// Límite de intentos fallidos (en memoria)
const failedLogins = new Map();
const LOCK_MS = 15 * 60 * 1000;

function lockRemaining(key) {
  const e = failedLogins.get(key);
  if (!e || !e.lockedUntil) return 0;
  if (e.lockedUntil <= Date.now()) { failedLogins.delete(key); return 0; }
  return e.lockedUntil - Date.now();
}

function registerFail(key, max) {
  const e = failedLogins.get(key) || { count: 0 };
  e.count += 1;
  e.last = Date.now();
  if (e.count >= max) { e.lockedUntil = Date.now() + LOCK_MS; e.count = 0; }
  failedLogins.set(key, e);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of failedLogins) {
    if ((e.lockedUntil || 0) < now && now - e.last > LOCK_MS) failedLogins.delete(k);
  }
}, 10 * 60 * 1000).unref();

const DUMMY_HASH = bcrypt.hashSync('contraseña-inexistente', 12);

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    if (username.length > 64 || password.length > 128) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const uname = username.trim();
    const userKey = `u|${req.ip}|${uname.toLowerCase()}`;
    const ipKey = `i|${req.ip}`;
    const wait = Math.max(lockRemaining(userKey), lockRemaining(ipKey));

    if (wait > 0) {
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(wait / 60000)} minuto(s).`
      });
    }

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE username = ?
        AND active = 1
    `).get(uname);

    // Siempre se compara un hash para no revelar si el usuario existe por tiempo de respuesta
    const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !ok) {
      registerFail(userKey, 5);
      registerFail(ipKey, 30);
      insertHistory(user ? user.id : null, 'LOGIN_FALLIDO', null, null, { username: uname.slice(0, 64) });
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    failedLogins.delete(userKey);

    // Nueva sesión al autenticar (evita fijación de sesión)
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'No se pudo iniciar sesión' });

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.fullName = user.full_name;

      insertHistory(user.id, 'LOGIN', null, null, null);

      req.session.save(() => {
        res.json({ role: user.role, fullName: user.full_name });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  if (req.session.userId) {
    insertHistory(req.session.userId, 'LOGOUT', null, null, null);
  }

  req.session.destroy(() => {
    res.clearCookie('toallas.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', requireLogin, (req, res) => {
  res.json({
    userId: req.session.userId,
    role: req.session.role,
    fullName: req.session.fullName
  });
});

// =====================================================
// TRANSACCIONES DE NEGOCIO
// =====================================================
const createStayTx = db.transaction((body, userId) => {
  const guest_name = cleanText(body.guest_name, 'El nombre del huésped', 100, true);
  const room_number = cleanText(body.room_number, 'El número de habitación', 20, true);

  const towel_limit = toNonNegativeInt(body.towel_limit, 'Límite de toallas');
  const initial_towels = toNonNegativeInt(body.initial_towels, 'Toallas iniciales', 0);
  const cards_count = toNonNegativeInt(body.cards_count, 'Cantidad de tarjetas', 1);

  if (initial_towels > towel_limit) {
    throw new Error('Las toallas iniciales no pueden exceder el límite configurado');
  }

  const activeRoom = db.prepare(`
    SELECT id
    FROM stays
    WHERE room_number = ?
      AND status = 'activo'
  `).get(room_number);

  if (activeRoom) {
    throw new Error(`La habitación ${room_number} ya tiene un huésped activo`);
  }

  const guest_barcode = String(body.guest_barcode || '').trim();

  if (!guest_barcode) {
    throw new Error('El código de tarjeta es requerido');
  }

  if (!/^\d{4,20}$/.test(guest_barcode)) {
    throw new Error('El código de tarjeta debe ser numérico y tener entre 4 y 20 dígitos');
  }

  // Un código solo puede estar en uso por un huésped activo; tras el check-out se puede reutilizar
  const existingBarcode = db.prepare(`
    SELECT id
    FROM stays
    WHERE guest_barcode = ?
      AND status = 'activo'
  `).get(guest_barcode);

  if (existingBarcode) {
    throw new Error('Ese código de tarjeta ya está en uso por un huésped activo');
  }

  const nowUtc = utcNow();
  const nowCdmx = cdmxNow();

  const info = db.prepare(`
    INSERT INTO stays (
      guest_barcode,
      guest_name,
      room_number,
      cards_count,
      status,
      entry_date_utc,
      entry_date_cdmx,
      towel_limit,
      initial_towels,
      current_towels,
      comment,
      created_by,
      updated_by
    ) VALUES (?, ?, ?, ?, 'activo', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    guest_barcode,
    guest_name,
    room_number,
    cards_count,
    nowUtc,
    nowCdmx,
    towel_limit,
    initial_towels,
    initial_towels,
    cleanText(body.comment, 'El comentario', 500),
    userId,
    userId
  );

  const stayId = info.lastInsertRowid;

  if (initial_towels > 0) {
    db.prepare(`
      INSERT INTO towel_movements (
        stay_id,
        card_id,
        user_id,
        movement_type,
        quantity,
        balance_after,
        reason,
        created_at_utc,
        created_at_cdmx
      ) VALUES (?, NULL, ?, 'inicial', ?, ?, 'Asignación inicial', ?, ?)
    `).run(
      stayId,
      userId,
      initial_towels,
      initial_towels,
      nowUtc,
      nowCdmx
    );
  }

  insertHistory(
    userId,
    'ALTA_HUESPED',
    stayId,
    null,
    {
      guest_name,
      room_number,
      guest_barcode,
      cards_count,
      towel_limit,
      initial_towels,
      current_towels: initial_towels
    },
  );

  return db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);
});

const updateStayTx = db.transaction((stayId, body, userId) => {
  const stay = db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);

  if (!stay) {
    throw new Error('Huésped no encontrado');
  }

  const oldValues = {
    guest_name: stay.guest_name,
    towel_limit: stay.towel_limit,
    cards_count: stay.cards_count,
    comment: stay.comment
  };

  const updates = [];
  const params = { id: stayId, userId };

  if (body.towel_limit !== undefined) {
    const newLimit = toNonNegativeInt(body.towel_limit, 'Límite de toallas');

    if (stay.status === 'activo' && newLimit < stay.current_towels) {
      throw new Error('El nuevo límite no puede ser menor a las toallas que ya tiene el huésped');
    }

    updates.push('towel_limit = @limit');
    params.limit = newLimit;
  }

  if (body.cards_count !== undefined) {
    const newCards = toNonNegativeInt(body.cards_count, 'Cantidad de tarjetas');
    updates.push('cards_count = @cards');
    params.cards = newCards;
  }

  if (body.comment !== undefined) {
    updates.push('comment = @comment');
    params.comment = cleanText(body.comment, 'El comentario', 500);
  }

  if (body.guest_name !== undefined) {
    const newName = cleanText(body.guest_name, 'El nombre del huésped', 100, true);
    updates.push('guest_name = @name');
    params.name = newName;
  }

  if (updates.length === 0) {
    throw new Error('No hay datos para actualizar');
  }

  updates.push('updated_by = @userId');

  db.prepare(`
    UPDATE stays
    SET ${updates.join(', ')}
    WHERE id = @id
  `).run(params);

  const updated = db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);

  insertHistory(
    userId,
    'ACTUALIZAR_HUESPED',
    stayId,
    oldValues,
    {
      guest_name: updated.guest_name,
      towel_limit: updated.towel_limit,
      cards_count: updated.cards_count,
      comment: updated.comment
    },
  );

  return updated;
});

const towelMovementTx = db.transaction((stayId, action, qty, userId, reason) => {
  if (!['entrega', 'devolucion'].includes(action)) {
    throw new Error('Acción inválida');
  }

  const quantity = Number(qty);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('La cantidad debe ser un entero mayor a 0');
  }

  const stay = db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);

  if (!stay) {
    throw new Error('Huésped no encontrado');
  }

  if (stay.status !== 'activo') {
    throw new Error('El huésped ya no está activo');
  }

  const delta = action === 'entrega' ? quantity : -quantity;
  const balance = stay.current_towels + delta;

  if (balance < 0) {
    throw new Error('La devolución dejaría la cuenta de toallas en negativo');
  }

  if (action === 'entrega' && balance > stay.towel_limit) {
    const remaining = stay.towel_limit - stay.current_towels;
    throw new Error(`Límite excedido. Solo puede recibir ${remaining} toalla(s) más.`);
  }

  const nowUtc = utcNow();
  const nowCdmx = cdmxNow();

  db.prepare(`
    INSERT INTO towel_movements (
      stay_id,
      card_id,
      user_id,
      movement_type,
      quantity,
      balance_after,
      reason,
      created_at_utc,
      created_at_cdmx
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stayId,
    userId,
    action,
    delta,
    balance,
    reason ? cleanText(reason, 'El motivo', 200) : null,
    nowUtc,
    nowCdmx
  );

  db.prepare(`
    UPDATE stays
    SET current_towels = ?,
        updated_by = ?
    WHERE id = ?
  `).run(balance, userId, stayId);

  insertHistory(
    userId,
    action === 'entrega' ? 'ENTREGA_TOALLAS' : 'DEVOLUCION_TOALLAS',
    stayId,
    {
      current_towels: stay.current_towels,
      towel_limit: stay.towel_limit
    },
    {
      current_towels: balance,
      towel_limit: stay.towel_limit
    },
  );

  return db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);
});

const checkoutTx = db.transaction((stayId, userId) => {
  const stay = db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);

  if (!stay) {
    throw new Error('Huésped no encontrado');
  }

  if (stay.status !== 'activo') {
    throw new Error('El huésped ya salió');
  }

  if (stay.current_towels !== 0) {
    throw new Error(`No se puede hacer check-out. Faltan ${stay.current_towels} toallas por devolver.`);
  }

  const nowUtc = utcNow();
  const nowCdmx = cdmxNow();

  db.prepare(`
    UPDATE stays
    SET status = 'salido',
        exit_date_utc = ?,
        exit_date_cdmx = ?,
        updated_by = ?
    WHERE id = ?
  `).run(nowUtc, nowCdmx, userId, stayId);

  insertHistory(
    userId,
    'CHECKOUT',
    stayId,
    {
      status: 'activo',
      current_towels: stay.current_towels
    },
    {
      status: 'salido',
      current_towels: stay.current_towels
    },
  );

  return db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);
});

// =====================================================
// API HUESPEDES
// =====================================================
app.get('/api/stays', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  try {
    const status = ['activo', 'salido', 'todos'].includes(req.query.status) ? req.query.status : 'activo';
    const q = req.query.q ? String(req.query.q).slice(0, 100) : '';

    const where = [];
    const params = {};

    if (status !== 'todos') {
      where.push('status = @status');
      params.status = status;
    }

    if (q) {
      where.push("(guest_name LIKE @q ESCAPE '!' OR room_number LIKE @q ESCAPE '!' OR guest_barcode LIKE @q ESCAPE '!')");
      params.q = `%${q.replace(/[!%_]/g, '!$&')}%`;
    }

    const sql = `
      SELECT *
      FROM stays
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE status
          WHEN 'activo' THEN 0
          ELSE 1
        END,
        id DESC
      LIMIT 300
    `;

    const rows = db.prepare(sql).all(params);
    res.json(rows);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.get('/api/stays/:id', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  try {
    const stayId = Number(req.params.id);

    const stay = db.prepare('SELECT * FROM stays WHERE id = ?').get(stayId);

    if (!stay) {
      return res.status(404).json({ error: 'Huésped no encontrado' });
    }

    const movements = db.prepare(`
      SELECT tm.*, u.username
      FROM towel_movements tm
      LEFT JOIN users u ON u.id = tm.user_id
      WHERE tm.stay_id = ?
      ORDER BY tm.id DESC
      LIMIT 30
    `).all(stayId);

    res.json({
      ...stay,
      movements
    });
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.post('/api/stays', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  try {
    const stay = createStayTx(req.body || {}, req.session.userId);
    io.emit('stays-updated');
    res.json(stay);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.patch('/api/stays/:id', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  try {
    const stayId = Number(req.params.id);
    const stay = updateStayTx(stayId, req.body || {}, req.session.userId);
    io.emit('stay-updated', stay);
    io.emit('stays-updated');
    res.json(stay);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.post('/api/stays/:id/towels', requireLogin, requireRole('toallero', 'recepcion', 'admin'), (req, res) => {
  try {
    const stayId = Number(req.params.id);
    const { action, qty, reason } = req.body || {};

    const stay = towelMovementTx(
      stayId,
      action,
      qty,
      req.session.userId,
      reason
    );

    io.emit('stay-updated', stay);
    io.emit('stays-updated');

    res.json(stay);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.post('/api/stays/:id/checkout', requireLogin, requireRole('recepcion', 'admin'), (req, res) => {
  try {
    const stayId = Number(req.params.id);
    const stay = checkoutTx(stayId, req.session.userId);

    io.emit('stay-updated', stay);
    io.emit('stays-updated');

    res.json(stay);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

// =====================================================
// API ESCANEO PARA TOALLERO
// =====================================================
app.get('/api/scan/:code', requireLogin, (req, res) => {
  try {
    const code = String(req.params.code || '').trim();

    if (!code) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    const stay = db.prepare(`
      SELECT *
      FROM stays
      WHERE guest_barcode = ?
      ORDER BY CASE status WHEN 'activo' THEN 0 ELSE 1 END, id DESC
      LIMIT 1
    `).get(code);

    if (!stay) {
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }

    const movements = db.prepare(`
      SELECT tm.*, u.username
      FROM towel_movements tm
      LEFT JOIN users u ON u.id = tm.user_id
      WHERE tm.stay_id = ?
      ORDER BY tm.id DESC
      LIMIT 20
    `).all(stay.id);

    res.json({
      ...stay,
      movements
    });
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

// =====================================================
// API HISTORIAL
// =====================================================
app.get('/api/history', requireLogin, requireRole('admin', 'recepcion'), (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const stayId = req.query.stay_id ? Number(req.query.stay_id) : null;

    let rows;

    if (stayId) {
      rows = db.prepare(`
        SELECT h.id, h.action, h.stay_id, h.old_values, h.new_values, h.created_at_utc, h.created_at_cdmx,
               u.username, u.full_name, s.guest_name, s.room_number
        FROM history h
        LEFT JOIN users u ON u.id = h.user_id
        LEFT JOIN stays s ON s.id = h.stay_id
        WHERE h.stay_id = ?
        ORDER BY h.id DESC
        LIMIT ?
      `).all(stayId, limit);
    } else {
      rows = db.prepare(`
        SELECT h.id, h.action, h.stay_id, h.old_values, h.new_values, h.created_at_utc, h.created_at_cdmx,
               u.username, u.full_name, s.guest_name, s.room_number
        FROM history h
        LEFT JOIN users u ON u.id = h.user_id
        LEFT JOIN stays s ON s.id = h.stay_id
        ORDER BY h.id DESC
        LIMIT ?
      `).all(limit);
    }

    res.json(rows);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

// =====================================================
// API USUARIOS
// =====================================================
app.get('/api/users', requireLogin, requireRole('admin'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, username, full_name, role, active, created_at_cdmx
      FROM users
      ORDER BY id
    `).all();

    res.json(rows);
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.post('/api/users', requireLogin, requireRole('admin'), (req, res) => {
  try {
    const { username, password, full_name, role } = req.body || {};

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (!['admin', 'recepcion', 'toallero'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username).trim())) {
      return res.status(400).json({ error: 'El usuario debe tener de 3 a 32 caracteres (letras, números, punto, guion)' });
    }

    const pw = String(password);
    if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres, con letras y números' });
    }

    cleanText(full_name, 'El nombre completo', 100, true);

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());

    if (existing) {
      return res.status(400).json({ error: 'Ese usuario ya existe' });
    }

    const nowUtc = utcNow();
    const nowCdmx = cdmxNow();

    const info = db.prepare(`
      INSERT INTO users (
        username,
        password_hash,
        full_name,
        role,
        active,
        created_at_utc,
        created_at_cdmx
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(
      String(username).trim(),
      bcrypt.hashSync(String(password), 12),
      String(full_name).trim(),
      role,
      nowUtc,
      nowCdmx
    );

    insertHistory(
      req.session.userId,
      'CREAR_USUARIO',
      null,
      null,
      {
        userId: info.lastInsertRowid,
        username: String(username).trim(),
        role
      }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

app.post('/api/users/:id/toggle', requireLogin, requireRole('admin'), (req, res) => {
  try {
    const userId = Number(req.params.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.id === req.session.userId) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }

    const newActive = user.active ? 0 : 1;

    db.prepare(`
      UPDATE users
      SET active = ?
      WHERE id = ?
    `).run(newActive, userId);

    insertHistory(
      req.session.userId,
      newActive ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO',
      null,
      { username: user.username, active: user.active },
      { username: user.username, active: newActive }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: safeError(err) });
  }
});

// =====================================================
// EXPORTAR BASE DE DATOS A EXCEL Y LIMPIAR (solo admin)
// =====================================================
// 1. Genera un archivo Excel (.xlsx) con TODO el contenido de la base: usuarios, huéspedes,
//    movimientos de toallas e historial.
// 2. Guarda una copia de seguridad de toallas.db en la carpeta "backups".
// 3. Borra los datos exportados, conservando los usuarios y TODOS los huéspedes (activos y con
//    check-out) junto con sus movimientos de toallas. Lo único que se elimina es el historial.
// 4. Devuelve el Excel para que el navegador lo descargue.
// Es POST (y no GET) porque modifica datos.
app.post('/api/export-db', requireLogin, requireRole('admin'), async (req, res) => {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (e) {
    return res.status(500).json({
      error: 'Falta el módulo "exceljs". Ejecuta install.bat (npm install) y reinicia el servidor.'
    });
  }

  try {
    // ---- 1. Leer todo (lectura consistente) ----
    const snap = db.transaction(() => ({
      users: db.prepare(`
        SELECT id, username, full_name, role, active, created_at_cdmx
        FROM users ORDER BY id
      `).all(),
      stays: db.prepare('SELECT * FROM stays ORDER BY id').all(),
      movements: db.prepare(`
        SELECT tm.*, u.username, s.guest_name, s.room_number
        FROM towel_movements tm
        LEFT JOIN users u ON u.id = tm.user_id
        LEFT JOIN stays s ON s.id = tm.stay_id
        ORDER BY tm.id
      `).all(),
      history: db.prepare(`
        SELECT h.*, u.username, s.guest_name, s.room_number
        FROM history h
        LEFT JOIN users u ON u.id = h.user_id
        LEFT JOIN stays s ON s.id = h.stay_id
        ORDER BY h.id
      `).all()
    }))();

    // ---- 2. Armar el Excel ----
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Control de Toallas';
    wb.created = new Date();

    const addSheet = (name, columns, rows) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
      ws.addRows(rows);
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      return ws;
    };

    addSheet('Usuarios', [
      ['ID', 'id', 8], ['Usuario', 'username', 18], ['Nombre', 'full_name', 28],
      ['Rol', 'role', 12], ['Activo', 'active', 8], ['Creado (CDMX)', 'created_at_cdmx', 20]
    ], snap.users.map(u => ({ ...u, active: u.active ? 'Sí' : 'No' })));

    addSheet('Huespedes', [
      ['ID', 'id', 8], ['Código', 'guest_barcode', 18], ['Huésped', 'guest_name', 28],
      ['Habitación', 'room_number', 12], ['Tarjetas', 'cards_count', 10], ['Estado', 'status', 10],
      ['Entrada (CDMX)', 'entry_date_cdmx', 20], ['Salida (CDMX)', 'exit_date_cdmx', 20],
      ['Límite toallas', 'towel_limit', 14], ['Toallas iniciales', 'initial_towels', 16],
      ['Toallas actuales', 'current_towels', 16], ['Comentario', 'comment', 30],
      ['Creado por (ID)', 'created_by', 14], ['Actualizado por (ID)', 'updated_by', 18]
    ], snap.stays);

    addSheet('Movimientos', [
      ['ID', 'id', 8], ['Fecha (CDMX)', 'created_at_cdmx', 20], ['Huésped', 'guest_name', 28],
      ['Habitación', 'room_number', 12], ['Usuario', 'username', 16], ['Tipo', 'movement_type', 12],
      ['Cantidad', 'quantity', 10], ['Saldo después', 'balance_after', 14], ['Motivo', 'reason', 30]
    ], snap.movements);

    addSheet('Historial', [
      ['ID', 'id', 8], ['Fecha (CDMX)', 'created_at_cdmx', 20], ['Usuario', 'username', 16],
      ['Acción', 'action', 22], ['Huésped', 'guest_name', 28], ['Habitación', 'room_number', 12],
      ['Valores anteriores', 'old_values', 50], ['Valores nuevos', 'new_values', 50]
    ], snap.history);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    // ---- 3. Copia de seguridad previa a la limpieza ----
    const stamp = cdmxNow().replace(/[-: ]/g, '').slice(0, 12);
    const backupDir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `toallas-antes-de-limpiar-${stamp}.db`);
    if (!fs.existsSync(backupFile)) {
      db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);
    }

    // ---- 4. Limpiar: solo se borra el historial que ya quedó dentro del Excel ----
    const maxHistoryId = snap.history.length ? snap.history[snap.history.length - 1].id : 0;
    const activeCount = snap.stays.filter(st => st.status === 'activo').length;
    const exitedCount = snap.stays.length - activeCount;

    db.transaction(() => {
      db.prepare('DELETE FROM history WHERE id <= ?').run(maxHistoryId);

      insertHistory(req.session.userId, 'EXPORTAR_BD', null, null, {
        usuarios: snap.users.length,
        huespedes_activos: activeCount,
        huespedes_checkout: exitedCount
      });
    })();

    io.emit('stays-updated');

    // ---- 5. Entregar el Excel ----
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="toallas-respaldo-${stamp}.xlsx"`,
      'Content-Length': buffer.length
    });
    res.end(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo exportar la base de datos. No se borró nada.' });
  }
});

// =====================================================
// SERVIDOR
// =====================================================
// Aviso si siguen activas las contraseñas por defecto
for (const [u, p] of Object.entries({ admin: 'admin123', recepcion: 'recepcion123', toallero: 'toallero123' })) {
  const row = db.prepare('SELECT password_hash FROM users WHERE username = ? AND active = 1').get(u);
  if (row && bcrypt.compareSync(p, row.password_hash)) {
    console.warn(`[SEGURIDAD] El usuario "${u}" sigue con la contraseña por defecto. Cámbiala o desactívalo.`);
  }
}

// Respaldo automático diario de la base (se conservan los últimos 14)
function autoBackup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `toallas-auto-${cdmxNow().slice(0, 10)}.db`);
    if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const antiguos = fs.readdirSync(dir).filter(f => /^toallas-auto-.*\.db$/.test(f)).sort();
    while (antiguos.length > 14) fs.unlinkSync(path.join(dir, antiguos.shift()));
  } catch (e) {
    console.error('Error en el respaldo automático:', e.message);
  }
}

if (IS_PROD && !process.env.SESSION_SECRET) {
  console.warn('[SEGURIDAD] Define la variable SESSION_SECRET (clave larga y aleatoria) en el servidor.');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
  autoBackup();
  setInterval(autoBackup, 6 * 60 * 60 * 1000).unref();
});
