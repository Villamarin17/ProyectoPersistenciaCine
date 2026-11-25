// =====================================================================
// CineConecta - Volumen de sesiones de visualización para las mediciones
// Ejecutar después de mongo/02_datos_prueba.js y de oracle/05_volumen.sql.
// Genera una sesión por cada suscripción de volumen de Oracle:
// 20.000 cuentas x 10 suscripciones = 200.000 sesiones (unos 70 MB en Atlas).
// accountId, profileId, subscriptionId, planId y fechas siguen la misma regla
// que oracle/05_volumen.sql, así que cada sesión cae dentro de su suscripción.
// Para quitar el volumen: db.viewingSessions.deleteMany({ accountId: { $gt: 5000000 } })
// =====================================================================
{
db = db.getSiblingDB("cineconecta");
const CUENTAS = 20000;          // bajar este valor si el clúster tiene poco espacio
const SUSCRIPCIONES = 10;
const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
const NOW = Date.now();

let seed = 5000000;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

// Elementos reproducibles publicados (los perfiles de volumen son de 18 años)
const items = [];
db.contents.find({ status: "published" }).forEach(c => {
  if (c.type === "series") {
    c.seasons.forEach(s => s.episodes.forEach(e => items.push({ contentId: c._id, contentType: "series",
      episodeId: e.episodeId, itemId: e.episodeId, dur: e.durationSec })));
  } else {
    items.push({ contentId: c._id, contentType: c.type, episodeId: null, itemId: c._id, dur: c.durationSec });
  }
});

db.viewingSessions.deleteMany({ accountId: { $gt: 5000000 } });
let batch = [], total = 0;
const t0 = Date.now();
for (let i = 1; i <= CUENTAS; i++) {
  for (let k = 1; k <= SUSCRIPCIONES; k++) {
    // misma fórmula de oracle/05_volumen.sql
    const subStart = NOW - (30 * k - (i % 30)) * DAY - ((i % 24) + 1) * HOUR;
    const subEnd = Math.min(subStart + 30 * DAY, NOW - HOUR);
    const it = items[Math.floor(rnd() * items.length)];
    const startedAt = new Date(subStart + (subEnd - subStart - 3 * HOUR) * rnd());
    const finished = rnd() < 0.55;
    const lastPos = finished ? it.dur : Math.round(it.dur * (0.1 + 0.7 * rnd()));
    const endedAt = new Date(startedAt.getTime() + lastPos * 1000);
    batch.push({
      accountId: 5000000 + i, profileId: 5000000 + i,
      subscriptionId: 5000000 + (i - 1) * 10 + k, planId: ((i + k) % 3) + 1,
      contentId: it.contentId, contentType: it.contentType, episodeId: it.episodeId, itemId: it.itemId,
      itemDurationSec: it.dur, startedAt, endedAt, lastHeartbeatAt: endedAt,
      lastPositionSec: lastPos, watchedSec: lastPos, seekedSec: 0,
      status: "finished", endReason: finished ? "user_finished" : "user_stopped", completed: finished
    });
    if (batch.length === 5000) { db.viewingSessions.insertMany(batch, { ordered: false }); total += batch.length; batch = []; }
  }
}
if (batch.length) { db.viewingSessions.insertMany(batch, { ordered: false }); total += batch.length; }
print(`Sesiones de volumen insertadas: ${total} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
print(`Total en viewingSessions: ${db.viewingSessions.countDocuments()}`);
}
