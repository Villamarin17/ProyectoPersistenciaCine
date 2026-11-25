// Rutas administrativas: usuarios de MongoDB, gestión del catálogo e informes.
const express = require('express');
const bcrypt = require('bcryptjs');
const oracle = require('../db/oracle');
const mongo = require('../db/mongo');
const { requireAdmin } = require('../lib/auth');
const f = require('../lib/format');

const router = express.Router();
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const flash = (req, type, text) => { req.session.flash = { type, text }; };

// ---------------------------------------------------------------- autenticación
router.get('/login', (req, res) => res.render('admin/login', { title: 'Administración', username: '' }));
router.post('/login', h(async (req, res) => {
  const { username = '', password = '' } = req.body;
  const a = await mongo.db().collection('admins').findOne({ username: username.trim().toLowerCase(), isActive: true });
  if (!a || !(await bcrypt.compare(password, a.passwordHash))) {
    return res.status(401).render('admin/login', { title: 'Administración', username, error: 'Usuario o contraseña incorrectos.' });
  }
  await mongo.db().collection('admins').updateOne({ _id: a._id }, { $set: { lastLoginAt: new Date() } });
  req.session.regenerate(() => {
    req.session.admin = { id: String(a._id), username: a.username, fullName: a.fullName, roles: a.roles };
    res.redirect('/admin');
  });
}));
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.get('/', requireAdmin(), (req, res) => res.render('admin/inicio', { title: 'Administración' }));

// ---------------------------------------------------------------- catálogo
const TEMPLATES = {
  movie: { durationSec: 5400, directors: [{ name: '' }], cast: [{ name: '', character: '' }] },
  documentary: { durationSec: 3600, directors: [{ name: '' }], topics: [''], interviewees: [{ name: '', description: '' }],
                 sources: [{ name: '', kind: 'institution', role: '' }] },
  series: { seasons: [{ number: 1, description: '', episodes: [{ number: 1, title: '', synopsis: '', durationSec: 2700 }] }] }
};
const COMMON = ['title', 'synopsis', 'releaseYear', 'genres', 'productionCountries', 'audioLanguages', 'subtitleLanguages', 'ageRating', 'coverUrl'];
const SPECIFIC = { movie: ['durationSec', 'directors', 'cast'], documentary: ['durationSec', 'directors', 'topics', 'interviewees', 'sources'], series: ['seasons'] };

async function nextId(prefix) {
  const c = await mongo.db().collection('counters').findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { returnDocument: 'after' });
  return prefix + '-' + String(c.seq).padStart(6, '0');
}

// Formulario → documento. Los campos específicos del tipo llegan como JSON.
async function buildDoc(type, body) {
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const doc = {
    title: String(body.title || '').trim(), synopsis: String(body.synopsis || '').trim(),
    releaseYear: parseInt(body.releaseYear, 10), genres: list(body.genres).map(g => g.toLowerCase()),
    productionCountries: list(body.productionCountries).map(c => c.toUpperCase()),
    audioLanguages: list(body.audioLanguages).map(l => l.toLowerCase()),
    subtitleLanguages: list(body.subtitleLanguages).map(l => l.toLowerCase()),
    ageRating: parseInt(body.ageRating, 10), coverUrl: String(body.coverUrl || '').trim()
  };
  let specific;
  try { specific = JSON.parse(body.specific || '{}'); } catch (e) { throw new Error('Los atributos del tipo no son un JSON válido: ' + e.message); }
  for (const k of Object.keys(specific)) if (!COMMON.includes(k) && !['_id', 'type', 'status'].includes(k)) doc[k] = specific[k];
  if (type === 'series' && Array.isArray(doc.seasons)) {
    // Los episodios nuevos reciben un id estable; los existentes lo conservan
    for (const s of doc.seasons) for (const e of s.episodes || []) if (!e.episodeId) e.episodeId = await nextId('EP');
    doc.episodeCount = doc.seasons.reduce((n, s) => n + (s.episodes || []).length, 0);
  }
  checkRequired(type, doc);
  return doc;
}

// Revisión previa con mensajes claros. El validador $jsonSchema de MongoDB sigue siendo el control final.
function checkRequired(type, d) {
  const errs = [];
  if (!d.title) errs.push('título');
  if (!d.synopsis) errs.push('sinopsis');
  if (!Number.isInteger(d.releaseYear)) errs.push('año de estreno');
  if (!d.genres.length) errs.push('al menos un género');
  if (!d.productionCountries.length) errs.push('al menos un país');
  if (!d.audioLanguages.length) errs.push('al menos un idioma de audio');
  const people = a => Array.isArray(a) && a.length && a.every(x => x && String(x.name || '').trim());
  if (type !== 'series' && !(Number.isInteger(d.durationSec) && d.durationSec > 0)) errs.push('durationSec (entero en segundos)');
  if (type !== 'series' && !people(d.directors)) errs.push('directors con al menos un nombre');
  if (type === 'movie' && !(Array.isArray(d.cast) && d.cast.every(x => x && String(x.name || '').trim()))) errs.push('cast (lista de {name, character})');
  if (type === 'documentary' && !(Array.isArray(d.topics) && d.topics.length && d.topics.every(t => String(t).trim()))) errs.push('topics con al menos un tema');
  if (type === 'series') {
    const ok = Array.isArray(d.seasons) && d.seasons.length && d.seasons.every(s => Number.isInteger(s.number) && String(s.description || '').trim()
      && Array.isArray(s.episodes) && s.episodes.length && s.episodes.every(e => Number.isInteger(e.number) && String(e.title || '').trim()
      && String(e.synopsis || '').trim() && Number.isInteger(e.durationSec) && e.durationSec > 0));
    if (!ok) errs.push('seasons: cada temporada con number y description, y episodios con number, title, synopsis y durationSec');
    else {
      const dup = a => new Set(a).size !== a.length;
      if (dup(d.seasons.map(s => s.number))) errs.push('números de temporada sin repetir');
      if (d.seasons.some(s => dup(s.episodes.map(e => e.number)))) errs.push('números de episodio sin repetir dentro de cada temporada');
    }
  }
  if (errs.length) throw new Error('Faltan o son inválidos: ' + errs.join('; ') + '.');
}

// Mensaje legible a partir del error de validación de MongoDB (código 121) o de índice único
function mongoError(e) {
  if (e.code === 11000) return 'Identificador repetido: ' + JSON.stringify(e.keyValue);
  if (e.code === 121) {
    const out = [];
    const walk = (node, path) => {
      if (!node || typeof node !== 'object') return;
      if (node.propertyName) path = path ? path + '.' + node.propertyName : node.propertyName;
      if (node.missingProperties) out.push(`${path || 'documento'}: faltan ${node.missingProperties.join(', ')}`);
      if (node.operatorName && node.reason) out.push(`${path || 'documento'}: ${node.operatorName} ${node.reason}`);
      for (const v of Object.values(node)) if (typeof v === 'object') walk(v, path);
    };
    walk(e.errInfo && e.errInfo.details, '');
    return 'El documento no cumple el validador de MongoDB. ' + ([...new Set(out)].slice(0, 6).join('; ') || '');
  }
  return null;
}

router.get('/contenidos', requireAdmin('catalog_manager'), h(async (req, res) => {
  const filter = {};
  if (['draft', 'published', 'retired'].includes(req.query.status)) filter.status = req.query.status;
  if (['movie', 'series', 'documentary'].includes(req.query.type)) filter.type = req.query.type;
  if (req.query.q) filter.title = { $regex: req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const items = await mongo.db().collection('contents')
    .find(filter, { projection: { title: 1, type: 1, status: 1, releaseYear: 1, ageRating: 1, updatedAt: 1 } })
    .sort({ _id: 1 }).toArray();
  res.render('admin/contenidos', { title: 'Catálogo', items, q: req.query });
}));

router.get('/contenidos/nuevo', requireAdmin('catalog_manager'), (req, res) => {
  const type = TEMPLATES[req.query.type] ? req.query.type : 'movie';
  res.render('admin/contenido_form', { title: 'Nuevo contenido', c: { type, status: 'draft' }, specific: JSON.stringify(TEMPLATES[type], null, 2), isNew: true });
});

router.post('/contenidos/nuevo', requireAdmin('catalog_manager'), h(async (req, res) => {
  const type = TEMPLATES[req.body.type] ? req.body.type : 'movie';
  let doc;
  try {
    doc = await buildDoc(type, req.body);
    const now = new Date();
    doc = { _id: await nextId({ movie: 'MOV', series: 'SER', documentary: 'DOC' }[type]), type, ...doc, status: 'draft',
            schemaVersion: 1, createdAt: now, updatedAt: now, publishedAt: null, retiredAt: null,
            createdBy: new (require('mongodb').ObjectId)(req.session.admin.id), updatedBy: new (require('mongodb').ObjectId)(req.session.admin.id) };
    await mongo.db().collection('contents').insertOne(doc);
    flash(req, 'ok', `Contenido ${doc._id} creado como borrador.`);
    res.redirect('/admin/contenidos');
  } catch (e) {
    const msg = mongoError(e) || (e.code === undefined && !e.unavailable && !mongo.isUnavailable(e) ? e.message : null);
    if (!msg) throw e;
    res.status(400).render('admin/contenido_form', { title: 'Nuevo contenido', c: { ...req.body, type }, specific: req.body.specific, isNew: true, error: msg });
  }
}));

router.get('/contenidos/:id', requireAdmin('catalog_manager'), h(async (req, res) => {
  const c = await mongo.db().collection('contents').findOne({ _id: req.params.id });
  if (!c) return res.redirect('/admin/contenidos');
  const specific = {};
  for (const k of Object.keys(c)) if (!COMMON.includes(k) && !['_id', 'type', 'status', 'schemaVersion', 'createdAt', 'updatedAt',
    'publishedAt', 'retiredAt', 'createdBy', 'updatedBy', 'episodeCount'].includes(k)) specific[k] = c[k];
  res.render('admin/contenido_form', { title: 'Editar ' + c._id, c: { ...c, genres: c.genres.join(', '),
    productionCountries: c.productionCountries.join(', '), audioLanguages: c.audioLanguages.join(', '),
    subtitleLanguages: c.subtitleLanguages.join(', ') }, specific: JSON.stringify(specific, null, 2), isNew: false });
}));

router.post('/contenidos/:id', requireAdmin('catalog_manager'), h(async (req, res) => {
  const coll = mongo.db().collection('contents');
  const current = await coll.findOne({ _id: req.params.id });
  if (!current) return res.redirect('/admin/contenidos');
  try {
    const doc = await buildDoc(current.type, req.body);
    // Reemplaza el documento conservando id, tipo, estado y fechas de publicación
    const unset = {};
    for (const k of SPECIFIC[current.type]) if (!(k in doc)) unset[k] = '';
    await coll.updateOne({ _id: current._id }, { $set: { ...doc, updatedAt: new Date(), updatedBy: new (require('mongodb').ObjectId)(req.session.admin.id) },
      ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    flash(req, 'ok', `Contenido ${current._id} actualizado.`);
    res.redirect('/admin/contenidos');
  } catch (e) {
    const msg = mongoError(e) || (e.code === undefined && !e.unavailable && !mongo.isUnavailable(e) ? e.message : null);
    if (!msg) throw e;
    res.status(400).render('admin/contenido_form', { title: 'Editar ' + current._id, c: { ...req.body, _id: current._id, type: current.type, status: current.status }, specific: req.body.specific, isNew: false, error: msg });
  }
}));

// Publicar o retirar. Retirar no borra el documento: conserva las referencias históricas.
router.post('/contenidos/:id/estado', requireAdmin('catalog_manager'), h(async (req, res) => {
  const now = new Date();
  const set = req.body.estado === 'published'
    ? { status: 'published', publishedAt: now, retiredAt: null }
    : { status: 'retired', retiredAt: now };
  try {
    const r = await mongo.db().collection('contents').updateOne({ _id: req.params.id },
      { $set: { ...set, updatedAt: now, updatedBy: new (require('mongodb').ObjectId)(req.session.admin.id) } });
    flash(req, 'ok', r.matchedCount ? `${req.params.id}: ${f.statusName(set.status)}.` : 'Contenido no encontrado.');
  } catch (e) {
    const msg = mongoError(e); if (!msg) throw e; flash(req, 'error', msg);
  }
  res.redirect('/admin/contenidos');
}));

// ---------------------------------------------------------------- informes
// Ingresos por plan: pagos registrados en Oracle
router.get('/informes/ingresos', requireAdmin('report_viewer'), h(async (req, res) => {
  const r = f.dateRange(req.query.desde, req.query.hasta);
  const rows = await oracle.query(
    `SELECT pl.planId "planId", pl.name "planName", NVL(SUM(v.amount), 0) "total", COUNT(v.subscriptionId) "subscriptions"
       FROM PLANS pl
       LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId AND v.paidAt >= :desde AND v.paidAt < :hasta
      GROUP BY pl.planId, pl.name
      ORDER BY pl.planId`, { desde: r.from, hasta: r.to });
  if (req.query.formato === 'csv') {
    res.type('text/csv').attachment(`ingresos_${r.desde}_${r.hasta}.csv`);
    return res.send(f.toCsv(['planId', 'plan', 'total_recaudado_cop', 'suscripciones'], rows.map(x => [x.planId, x.planName, x.total, x.subscriptions])));
  }
  res.render('admin/informe_ingresos', { title: 'Ingresos por plan', rows, r });
}));

// Consumo por plan y tipo: sesiones de MongoDB + nombres de plan de Oracle
router.get('/informes/consumo', requireAdmin('report_viewer'), h(async (req, res) => {
  const r = f.dateRange(req.query.desde, req.query.hasta);
  const rows = await mongo.db().collection('viewingSessions').aggregate([
    { $match: { startedAt: { $gte: r.from, $lt: r.to } } },
    { $group: { _id: { planId: '$planId', contentType: '$contentType' },
                watchedSec: { $sum: '$watchedSec' }, profiles: { $addToSet: '$profileId' }, sessions: { $sum: 1 } } },
    { $project: { _id: 0, planId: '$_id.planId', contentType: '$_id.contentType', minutes: { $round: [{ $divide: ['$watchedSec', 60] }, 1] },
                  distinctProfiles: { $size: '$profiles' }, sessions: 1 } },
    { $sort: { planId: 1, contentType: 1 } }
  ]).toArray();
  let planNames = {}, warning = null;
  try {
    (await oracle.query(`SELECT planId "planId", name "name" FROM PLANS`)).forEach(p => { planNames[p.planId] = p.name; });
  } catch (e) {
    if (!e.unavailable) throw e;
    warning = 'Oracle no está disponible: se muestran los ids de plan sin su nombre.';
  }
  rows.forEach(x => { x.planName = planNames[x.planId] || ('Plan ' + x.planId); });
  if (req.query.formato === 'csv') {
    res.type('text/csv').attachment(`consumo_${r.desde}_${r.hasta}.csv`);
    return res.send(f.toCsv(['planId', 'plan', 'tipo_contenido', 'minutos_visualizados', 'perfiles_distintos', 'sesiones'],
      rows.map(x => [x.planId, x.planName, x.contentType, x.minutes, x.distinctProfiles, x.sessions])));
  }
  res.render('admin/informe_consumo', { title: 'Consumo por plan y tipo', rows, r, warning });
}));

module.exports = router;
