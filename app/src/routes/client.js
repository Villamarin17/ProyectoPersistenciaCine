// Rutas de clientes: cuenta, suscripción, perfiles, catálogo, "Mi lista" y reproducción.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const oracle = require('../db/oracle');
const mongo = require('../db/mongo');
const catalog = require('../lib/catalog');
const playback = require('../lib/playback');
const { requireClient, requireProfile } = require('../lib/auth');

const router = express.Router();
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const flash = (req, type, text) => { req.session.flash = { type, text }; };

// ---------------------------------------------------------------- registro e ingreso
router.get('/', (req, res) => res.redirect(req.session.accountId ? '/inicio' : '/login'));

router.get('/registro', (req, res) => res.render('registro', { title: 'Crear cuenta', form: {} }));
router.post('/registro', h(async (req, res) => {
  const { fullName = '', email = '', password = '' } = req.body;
  const error = !fullName.trim() ? 'Escriba su nombre.'
    : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'El correo no es válido.'
    : password.length < 8 ? 'La contraseña debe tener al menos 8 caracteres.' : null;
  if (error) return res.render('registro', { title: 'Crear cuenta', error, form: { fullName, email } });
  const hash = await bcrypt.hash(password, 10);   // nunca se guarda la contraseña en texto plano
  try {
    const out = await oracle.callProcedure(
      'BEGIN sp_register_account(:n, :e, :h, :id); END;',
      { n: fullName, e: email, h: hash, id: { dir: oracle.oracledb.BIND_OUT, type: oracle.oracledb.NUMBER } });
    req.session.regenerate(() => {
      req.session.accountId = out.id; req.session.accountName = fullName.trim();
      flash(req, 'ok', 'Cuenta creada. Contrate un plan para crear perfiles.');
      res.redirect('/cuenta');
    });
  } catch (e) {
    const msg = oracle.businessMessage(e);
    if (!msg) throw e;
    res.render('registro', { title: 'Crear cuenta', error: msg, form: { fullName, email } });
  }
}));

router.get('/login', (req, res) => res.render('login', { title: 'Ingresar', email: '' }));
router.post('/login', h(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const a = await oracle.queryOne(
    `SELECT accountId "accountId", fullName "fullName", passwordHash "passwordHash"
       FROM ACCOUNTS WHERE LOWER(email) = LOWER(:email)`, { email: email.trim() });
  if (!a || !(await bcrypt.compare(password, a.passwordHash))) {
    return res.status(401).render('login', { title: 'Ingresar', email, error: 'Correo o contraseña incorrectos.' });
  }
  req.session.regenerate(() => {
    req.session.accountId = a.accountId; req.session.accountName = a.fullName;
    res.redirect('/perfiles');
  });
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------------------------------------------------------------- cuenta, planes y contratación
router.get('/cuenta', requireClient, h(async (req, res) => {
  const accountId = req.session.accountId;
  const [history, plans, active] = await Promise.all([
    oracle.query(`SELECT subscriptionId "subscriptionId", planName "planName", startsAt "startsAt", endsAt "endsAt",
                         paidAt "paidAt", amount "amount", reference "reference"
                    FROM vw_account_subscriptions WHERE accountId = :a ORDER BY startsAt DESC`, { a: accountId }),
    oracle.query(`SELECT planId "planId", name "name", price "price", maxProfiles "maxProfiles" FROM PLANS ORDER BY price`),
    oracle.queryOne(`SELECT subscriptionId "subscriptionId", planName "planName", endsAt "endsAt"
                       FROM vw_active_subscription WHERE accountId = :a`, { a: accountId })
  ]);
  const now = Date.now();
  history.forEach(s => { s.state = s.endsAt > now && s.startsAt <= now ? 'Vigente' : 'Vencida'; });
  res.render('cuenta', { title: 'Mi cuenta', history, plans, active });
}));

router.post('/cuenta/contratar', requireClient, h(async (req, res) => {
  const planId = parseInt(req.body.planId, 10);
  const approved = req.body.pago === 'aprobar' ? 'Y' : 'N';   // pago simulado
  try {
    const out = await oracle.callProcedure(
      'BEGIN sp_purchase_subscription(:a, :p, :ok, :ref, :id); END;',
      { a: req.session.accountId, p: planId, ok: approved, ref: 'PAY-' + crypto.randomUUID(),
        id: { dir: oracle.oracledb.BIND_OUT, type: oracle.oracledb.NUMBER } });
    flash(req, 'ok', `Pago aprobado. Suscripción ${out.id} activa por 30 días.`);
  } catch (e) {
    const msg = oracle.businessMessage(e);
    if (!msg) throw e;
    flash(req, 'error', msg);
  }
  res.redirect('/cuenta');
}));

// ---------------------------------------------------------------- perfiles
router.get('/perfiles', requireClient, h(async (req, res) => {
  const accountId = req.session.accountId;
  const [profiles, active] = await Promise.all([
    oracle.query(`SELECT profileId "profileId", name "name", maxAgeRating "maxAgeRating", isActive "isActive"
                    FROM PROFILES WHERE accountId = :a ORDER BY isActive DESC, profileId`, { a: accountId }),
    oracle.queryOne(`SELECT planName "planName", maxProfiles "maxProfiles", endsAt "endsAt"
                       FROM vw_active_subscription WHERE accountId = :a`, { a: accountId })
  ]);
  res.render('perfiles', { title: 'Perfiles', profiles, active });
}));

router.post('/perfiles', requireClient, h(async (req, res) => {
  try {
    await oracle.callProcedure('BEGIN sp_create_profile(:a, :n, :age, :id); END;',
      { a: req.session.accountId, n: String(req.body.name || '').slice(0, 60), age: parseInt(req.body.maxAgeRating, 10),
        id: { dir: oracle.oracledb.BIND_OUT, type: oracle.oracledb.NUMBER } });
    flash(req, 'ok', 'Perfil creado.');
  } catch (e) {
    const msg = oracle.businessMessage(e);
    if (!msg) throw e;
    flash(req, 'error', msg);
  }
  res.redirect('/perfiles');
}));

router.post('/perfiles/:id/estado', requireClient, h(async (req, res) => {
  const profileId = parseInt(req.params.id, 10);
  try {
    await oracle.callProcedure('BEGIN sp_set_profile_active(:a, :p, :s); END;',
      { a: req.session.accountId, p: profileId, s: req.body.activo === 'Y' ? 'Y' : 'N' });
    if (req.body.activo !== 'Y' && req.session.profileId === profileId) req.session.profileId = null;
    flash(req, 'ok', req.body.activo === 'Y' ? 'Perfil activado.' : 'Perfil desactivado. Su actividad histórica se conserva.');
  } catch (e) {
    const msg = oracle.businessMessage(e);
    if (!msg) throw e;
    flash(req, 'error', msg);
  }
  res.redirect('/perfiles');
}));

// Solo se pueden seleccionar perfiles activos de la cuenta autenticada
router.post('/perfiles/:id/seleccionar', requireClient, h(async (req, res) => {
  const p = await oracle.queryOne(
    `SELECT profileId "profileId", name "name", isActive "isActive" FROM PROFILES
      WHERE profileId = :p AND accountId = :a`, { p: parseInt(req.params.id, 10), a: req.session.accountId });
  if (!p || p.isActive !== 'Y') { flash(req, 'error', 'Ese perfil no está disponible.'); return res.redirect('/perfiles'); }
  req.session.profileId = p.profileId; req.session.profileName = p.name;
  res.redirect('/inicio');
}));

// ---------------------------------------------------------------- inicio, catálogo y "Mi lista"
router.get('/inicio', requireProfile, h(async (req, res) => {
  const items = await catalog.continueWatching(req.profile.profileId, req.profile.maxAgeRating);
  res.render('inicio', { title: 'Inicio', items });
}));

router.get('/catalogo', requireProfile, h(async (req, res) => {
  const [result, options] = await Promise.all([
    catalog.search(req.query, req.profile.maxAgeRating), catalog.filterOptions()]);
  res.render('catalogo', { title: 'Catálogo', result, options, q: req.query });
}));

router.get('/contenido/:id', requireProfile, h(async (req, res) => {
  const c = await catalog.getPublished(req.params.id, req.profile.maxAgeRating);
  if (!c) return res.status(404).render('rechazo', { title: 'No disponible', motivo: 'El contenido no existe, no está publicado o su clasificación no está permitida para este perfil.', enlace: { href: '/catalogo', texto: 'Volver al catálogo' } });
  const db = mongo.db();
  const [inList, progress] = await Promise.all([
    db.collection('watchlist').findOne({ profileId: req.profile.profileId, contentId: c._id }),
    db.collection('playbackProgress').find({ profileId: req.profile.profileId, contentId: c._id }).toArray()
  ]);
  const prog = Object.fromEntries(progress.map(p => [p.itemId, p]));
  res.render('contenido', { title: c.title, c, inList: Boolean(inList), prog });
}));

router.get('/mi-lista', requireProfile, h(async (req, res) => {
  res.render('mi_lista', { title: 'Mi lista', items: await catalog.watchlist(req.profile.profileId) });
}));

router.post('/mi-lista/:contentId', requireProfile, h(async (req, res) => {
  const { profileId, accountId } = req.profile;
  const contentId = req.params.contentId;
  if (req.body.accion === 'quitar') {
    await mongo.db().collection('watchlist').deleteOne({ profileId, contentId });
  } else {
    const c = await catalog.getPublished(contentId, req.profile.maxAgeRating);
    if (c) {
      // upsert idempotente: el índice único (profileId, contentId) impide duplicados
      await mongo.db().collection('watchlist').updateOne({ profileId, contentId },
        { $setOnInsert: { accountId, profileId, contentId, addedAt: new Date() } }, { upsert: true });
    }
  }
  res.redirect(req.body.volver === 'lista' ? '/mi-lista' : '/contenido/' + encodeURIComponent(contentId));
}));

// ---------------------------------------------------------------- reproducción simulada
router.post('/reproducir/:contentId', requireClient, h(async (req, res) => {
  if (!req.session.profileId) return res.redirect('/perfiles');
  try {
    const r = await playback.start(req.session.accountId, req.session.profileId, req.params.contentId, req.body.episodeId || null);
    res.redirect('/reproduccion/' + r.sessionId);
  } catch (e) {
    if (!(e instanceof playback.PlaybackError)) throw e;
    res.status(403).render('rechazo', { title: 'Reproducción rechazada', motivo: e.message, enlace: { href: '/catalogo', texto: 'Volver al catálogo' } });
  }
}));

router.get('/reproduccion/:sessionId', requireClient, h(async (req, res) => {
  const s = await playback.getOwnSession(req.params.sessionId, req.session.accountId, req.session.profileId);
  if (!s) return res.redirect('/inicio');
  const c = await mongo.db().collection('contents').findOne({ _id: s.contentId }, { projection: { title: 1, seasons: 1 } });
  let label = c.title;
  if (s.episodeId) for (const se of c.seasons) for (const e of se.episodes) if (e.episodeId === s.episodeId) label += ` · T${se.number} E${e.number}: ${e.title}`;
  res.render('reproductor', { title: 'Reproduciendo', s, label, maxSpeed: playback.MAX_SPEED });
}));

router.post('/api/reproduccion/:sessionId/:accion(progreso|detener|finalizar)', requireClient, h(async (req, res) => {
  const s = await playback.getOwnSession(req.params.sessionId, req.session.accountId, req.session.profileId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada.' });
  if (s.status !== 'active') return res.status(409).json({ error: 'La sesión ya terminó.', status: s.status });
  if (req.params.accion === 'progreso') return res.json({ position: await playback.heartbeat(s, req.body) });
  const completed = await playback.finish(s, req.body, req.params.accion === 'finalizar');
  res.json({ completed });
}));

module.exports = router;
