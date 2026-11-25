// Reproducción simulada: autorización con ambas bases y registro de la actividad en MongoDB.
const { ObjectId } = require('mongodb');
const mongo = require('../db/mongo');
const { loadProfileAccess } = require('./auth');

const MAX_SPEED = 60;            // la simulación permite ver a 1x, 10x o 60x
const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;

class PlaybackError extends Error {}

// 1) Oracle: el perfil pertenece a la cuenta, está activo y hay suscripción vigente.
// 2) MongoDB: el contenido está publicado, su clasificación está permitida y, si es serie, el episodio existe.
async function authorize(accountId, profileId, contentId, episodeId) {
  const p = await loadProfileAccess(accountId, profileId);
  if (!p) throw new PlaybackError('El perfil no pertenece a la cuenta.');
  if (p.isActive !== 'Y') throw new PlaybackError('El perfil está inactivo.');
  if (!p.subscriptionId) throw new PlaybackError('La cuenta no tiene una suscripción vigente.');

  const c = await mongo.db().collection('contents').findOne({ _id: contentId });
  if (!c || c.status !== 'published') throw new PlaybackError('El contenido no está disponible.');
  if (c.ageRating > p.maxAgeRating) {
    throw new PlaybackError(`Clasificación no permitida: el contenido es para mayores de ${c.ageRating} y el perfil admite hasta ${p.maxAgeRating}.`);
  }
  let item;
  if (c.type === 'series') {
    if (!episodeId) throw new PlaybackError('Las series se reproducen por episodio.');
    for (const s of c.seasons) for (const e of s.episodes) if (e.episodeId === episodeId) item = { ...e, seasonNumber: s.number };
    if (!item) throw new PlaybackError('El episodio no pertenece a la serie.');
    item = { itemId: item.episodeId, episodeId: item.episodeId, durationSec: item.durationSec,
             label: `${c.title} · T${item.seasonNumber} E${item.number}: ${item.title}` };
  } else {
    item = { itemId: c._id, episodeId: null, durationSec: c.durationSec, label: c.title };
  }
  return { profile: p, content: c, item };
}

// Crea la sesión y actualiza el progreso en una transacción de MongoDB.
// La lectura previa en Oracle no forma parte de esta transacción: Oracle solo se leyó.
async function start(accountId, profileId, contentId, episodeId) {
  const { profile, content, item } = await authorize(accountId, profileId, contentId, episodeId);
  const db = mongo.db();
  const prev = await db.collection('playbackProgress').findOne({ profileId, itemId: item.itemId });
  const startPos = prev && !prev.completed ? prev.positionSec : 0;
  const now = new Date();
  const session = {
    accountId, profileId, subscriptionId: profile.subscriptionId, planId: profile.planId,
    contentId: content._id, contentType: content.type, episodeId: item.episodeId, itemId: item.itemId,
    itemDurationSec: item.durationSec, startedAt: now, endedAt: null, lastHeartbeatAt: now,
    lastPositionSec: startPos, watchedSec: 0, seekedSec: 0, status: 'active', endReason: null, completed: false
  };
  const tx = mongo.getClient().startSession();
  try {
    await tx.withTransaction(async () => {
      const r = await db.collection('viewingSessions').insertOne(session, { session: tx });
      session._id = r.insertedId;
      await db.collection('playbackProgress').updateOne(
        { profileId, itemId: item.itemId },
        { $set: { lastWatchedAt: now, lastSessionId: r.insertedId, completed: false, positionSec: startPos, durationSec: item.durationSec },
          $setOnInsert: { accountId, contentId: content._id, contentType: content.type, episodeId: item.episodeId } },
        { upsert: true, session: tx });
    });
  } finally {
    await tx.endSession();
  }
  return { sessionId: session._id, label: item.label };
}

async function getOwnSession(sessionId, accountId, profileId) {
  if (!ObjectId.isValid(sessionId)) return null;
  return mongo.db().collection('viewingSessions').findOne({ _id: new ObjectId(sessionId), accountId, profileId });
}

// Latido de la simulación: suma solo el tiempo reproducido; los saltos van a seekedSec
async function heartbeat(s, { watched, seeked, position }) {
  const elapsed = (Date.now() - new Date(s.lastHeartbeatAt).getTime()) / 1000;
  const w = Math.max(0, Math.min(Number(watched) || 0, elapsed * MAX_SPEED + 5));
  const sk = Math.max(0, Number(seeked) || 0);
  const pos = Math.max(0, Math.min(Number(position) || 0, s.itemDurationSec));
  const now = new Date();
  const db = mongo.db();
  await db.collection('viewingSessions').updateOne({ _id: s._id, status: 'active' },
    { $inc: { watchedSec: Math.round(w), seekedSec: Math.round(sk) }, $set: { lastPositionSec: pos, lastHeartbeatAt: now } });
  await db.collection('playbackProgress').updateOne({ profileId: s.profileId, itemId: s.itemId },
    { $set: { positionSec: pos, lastWatchedAt: now, lastSessionId: s._id } });
  return pos;
}

// Fin de la sesión: completada si el usuario la finaliza o si llegó al 90 % de la duración
async function finish(s, data, userFinished) {
  const pos = await heartbeat(s, data);
  const completed = Boolean(userFinished) || pos >= 0.9 * s.itemDurationSec;
  const db = mongo.db();
  await db.collection('viewingSessions').updateOne({ _id: s._id, status: 'active' },
    { $set: { status: 'finished', endedAt: new Date(), endReason: userFinished ? 'user_finished' : 'user_stopped', completed } });
  await db.collection('playbackProgress').updateOne({ profileId: s.profileId, itemId: s.itemId, lastSessionId: s._id },
    { $set: { completed } });
  return completed;
}

// Proceso periódico: cierra sesiones sin latidos (navegador cerrado, red caída)
async function closeInterrupted() {
  const limit = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const db = mongo.db();
  const r = await db.collection('viewingSessions').updateMany(
    { status: 'active', lastHeartbeatAt: { $lt: limit } },
    [{ $set: { status: 'interrupted', endReason: 'timeout', endedAt: '$lastHeartbeatAt',
               completed: { $gte: ['$lastPositionSec', { $multiply: [0.9, '$itemDurationSec'] }] } } }]);
  return r.modifiedCount;
}

module.exports = { authorize, start, getOwnSession, heartbeat, finish, closeInterrupted, PlaybackError, MAX_SPEED };
