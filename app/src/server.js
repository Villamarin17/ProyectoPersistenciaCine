// CineConecta - servidor web
process.env.TZ = 'UTC';                      // fechas de Oracle y MongoDB en UTC; se muestran en hora de Colombia
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const oracle = require('./db/oracle');
const mongo = require('./db/mongo');
const playback = require('./lib/playback');
const format = require('./lib/format');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

if (!process.env.SESSION_SECRET) { console.error('Falta SESSION_SECRET en .env'); process.exit(1); }
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 }
}));

// Variables disponibles en todas las vistas
app.use((req, res, next) => {
  res.locals.f = format;
  res.locals.sess = req.session;
  res.locals.flash = req.session.flash || null;
  res.locals.profile = null;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/client'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('rechazo', { title: 'No encontrado', motivo: 'La página no existe.', enlace: { href: '/', texto: 'Ir al inicio' } }));

// Manejo de errores: una base no disponible se informa sin exponer detalles internos
const ORACLE_DOWN = /NJS-5\d\d|NJS-040|NJS-003|ORA-125\d\d|ORA-03113|ORA-03114|ORA-12170|DPI-1080/;
app.use((err, req, res, next) => {
  let db = err.unavailable || null;
  if (!db && ORACLE_DOWN.test(err.message || '')) db = 'Oracle';
  if (!db && mongo.isUnavailable(err)) db = 'MongoDB';
  const wantsJson = req.path.startsWith('/api/');
  if (db) {
    console.warn(`[${new Date().toISOString()}] ${db} no disponible:`, err.cause ? err.cause.message : err.message);
    if (wantsJson) return res.status(503).json({ error: `${db} no está disponible. Intente de nuevo.` });
    return res.status(503).render('rechazo', { title: 'Servicio no disponible',
      motivo: `${db} no está disponible en este momento. No se registró ningún cambio; intente de nuevo en unos minutos.`,
      enlace: { href: req.originalUrl.startsWith('/admin') ? '/admin' : '/', texto: 'Volver' } });
  }
  console.error(err);
  if (wantsJson) return res.status(500).json({ error: 'Error interno.' });
  res.status(500).render('rechazo', { title: 'Error', motivo: 'Ocurrió un error inesperado.', enlace: { href: '/', texto: 'Volver' } });
});

async function main() {
  // Cada base se conecta por separado: si una falla, la otra sigue atendiendo sus funciones
  await oracle.init().then(() => console.log('Oracle: pool creado'), e => console.warn('Oracle no disponible al iniciar:', e.message));
  await mongo.init().then(() => console.log('MongoDB: conectado'), e => console.warn('MongoDB no disponible al iniciar:', e.message));

  // Cierra sesiones de reproducción sin latidos (cada minuto)
  setInterval(() => playback.closeInterrupted()
    .then(n => n && console.log(`Sesiones interrumpidas cerradas: ${n}`))
    .catch(e => console.warn('No se pudieron revisar sesiones abiertas:', e.message)), 60 * 1000);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`CineConecta en http://localhost:${port}`));
}

process.on('SIGINT', async () => { await Promise.allSettled([oracle.close(), mongo.close()]); process.exit(0); });
main();
