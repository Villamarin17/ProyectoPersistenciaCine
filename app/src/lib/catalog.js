// Consultas de MongoDB del catálogo, "Mi lista" y "Continuar viendo".
const mongo = require('../db/mongo');

const PAGE_SIZE = 8;

// Búsqueda paginada: solo contenidos publicados y permitidos para el perfil
async function search({ q, type, genre, lang, year, page }, maxAgeRating) {
  const filter = { status: 'published', ageRating: { $lte: maxAgeRating } };
  if (['movie', 'series', 'documentary'].includes(type)) filter.type = type;
  if (genre) filter.genres = genre;
  if (lang) filter.audioLanguages = lang;
  if (/^\d{4}$/.test(year || '')) filter.releaseYear = Number(year);
  let sort = { title: 1, _id: 1 };
  let projection = { title: 1, type: 1, releaseYear: 1, genres: 1, ageRating: 1, coverUrl: 1, audioLanguages: 1 };
  if (q && q.trim()) {
    filter.$text = { $search: q.trim() };          // índice de texto sobre title
    projection.score = { $meta: 'textScore' };
    sort = { score: { $meta: 'textScore' }, title: 1 };
  }
  const p = Math.max(1, parseInt(page, 10) || 1);
  const coll = mongo.db().collection('contents');
  const [items, total] = await Promise.all([
    coll.find(filter, { projection }).sort(sort).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    coll.countDocuments(filter)
  ]);
  return { items, total, page: p, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

// Valores para los filtros del buscador
async function filterOptions() {
  const c = mongo.db().collection('contents');
  const [genres, langs, years] = await Promise.all([
    c.distinct('genres', { status: 'published' }),
    c.distinct('audioLanguages', { status: 'published' }),
    c.distinct('releaseYear', { status: 'published' })
  ]);
  return { genres: genres.sort(), langs: langs.sort(), years: years.sort((a, b) => b - a) };
}

async function getPublished(contentId, maxAgeRating) {
  return mongo.db().collection('contents').findOne({ _id: contentId, status: 'published', ageRating: { $lte: maxAgeRating } });
}

// "Continuar viendo": progreso no completado, ordenado por actividad reciente,
// sin contenidos retirados ni no permitidos; una entrada por título
async function continueWatching(profileId, maxAgeRating) {
  return mongo.db().collection('playbackProgress').aggregate([
    { $match: { profileId, completed: false } },
    { $sort: { lastWatchedAt: -1 } },
    { $limit: 50 },
    { $lookup: { from: 'contents', localField: 'contentId', foreignField: '_id', as: 'c',
                 pipeline: [{ $project: { title: 1, type: 1, coverUrl: 1, status: 1, ageRating: 1, seasons: 1 } }] } },
    { $unwind: '$c' },
    { $match: { 'c.status': 'published', 'c.ageRating': { $lte: maxAgeRating } } },
    { $group: { _id: '$contentId', title: { $first: '$c.title' }, type: { $first: '$c.type' }, coverUrl: { $first: '$c.coverUrl' },
                seasons: { $first: '$c.seasons' }, itemId: { $first: '$itemId' }, episodeId: { $first: '$episodeId' },
                positionSec: { $first: '$positionSec' }, durationSec: { $first: '$durationSec' },
                lastWatchedAt: { $first: '$lastWatchedAt' } } },
    { $sort: { lastWatchedAt: -1 } },
    { $limit: 12 }
  ]).toArray().then(rows => rows.map(r => {
    if (r.episodeId) {
      for (const s of r.seasons || []) for (const e of s.episodes) if (e.episodeId === r.episodeId) r.episodeLabel = `T${s.number} E${e.number}: ${e.title}`;
    }
    delete r.seasons;
    return r;
  }));
}

// "Mi lista": distingue los contenidos retirados del catálogo
async function watchlist(profileId) {
  return mongo.db().collection('watchlist').aggregate([
    { $match: { profileId } },
    { $sort: { addedAt: -1 } },
    { $lookup: { from: 'contents', localField: 'contentId', foreignField: '_id', as: 'c',
                 pipeline: [{ $project: { title: 1, type: 1, status: 1, coverUrl: 1, ageRating: 1 } }] } },
    { $unwind: '$c' },
    { $project: { contentId: 1, addedAt: 1, title: '$c.title', type: '$c.type', coverUrl: '$c.coverUrl',
                  status: '$c.status', ageRating: '$c.ageRating' } }
  ]).toArray();
}

module.exports = { search, filterOptions, getPublished, continueWatching, watchlist, PAGE_SIZE };
