// =====================================================================
// CineConecta - Datos de prueba de MongoDB
// Ejecutar después de mongo/01_modelo.js y de oracle/03_datos_prueba.sql.
// accountId, profileId, subscriptionId y planId coinciden con Oracle.
// Las fechas son relativas al momento de la carga (igual que en Oracle).
// Administradores: admin.catalogo / Admin2026!   analista / Admin2026!
// =====================================================================
{
db = db.getSiblingDB("cineconecta");
const DAY = 24 * 3600 * 1000;
const NOW = Date.now();
const daysAgo = d => new Date(NOW - d * DAY);

// Generador pseudoaleatorio con semilla: la carga siempre produce los mismos datos
let seed = 20261124;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = arr => arr[Math.floor(rnd() * arr.length)];

function nextId(prefix) {
  const c = db.counters.findOneAndUpdate({ _id: prefix }, { $inc: { seq: NumberLong("1") } }, { returnDocument: "after" });
  return prefix + "-" + String(c.seq).padStart(6, "0");
}

// ---------------- administradores ----------------
const ADMIN_HASH = "$2a$10$bgRaRsrtfnisoyoJMuNHoeAdBckGVmc4diGV4J9vN53Q8wqbQYq36"; // Admin2026!
const adminId = ObjectId();
db.admins.insertMany([
  { _id: adminId, username: "admin.catalogo", fullName: "Administración de catálogo", email: "catalogo@cineconecta.test",
    passwordHash: ADMIN_HASH, roles: ["catalog_manager", "report_viewer"], isActive: true, createdAt: new Date(), lastLoginAt: null },
  { username: "analista", fullName: "Analista de informes", email: "informes@cineconecta.test",
    passwordHash: ADMIN_HASH, roles: ["report_viewer"], isActive: true, createdAt: new Date(), lastLoginAt: null }
]);

// ---------------- catálogo ----------------
const cover = id => "https://picsum.photos/seed/" + id + "/300/450";
const base = (id, o) => Object.assign({
  _id: id, schemaVersion: 1, status: "published", coverUrl: cover(id),
  createdAt: daysAgo(120), updatedAt: daysAgo(120), publishedAt: daysAgo(120), retiredAt: null,
  createdBy: adminId, updatedBy: adminId
}, o);
const movie = (o) => { const id = nextId("MOV"); db.contents.insertOne(base(id, Object.assign({ type: "movie" }, o))); return id; };
const docu  = (o) => { const id = nextId("DOC"); db.contents.insertOne(base(id, Object.assign({ type: "documentary" }, o))); return id; };
const series = (o, seasons) => {
  const id = nextId("SER");
  const ss = seasons.map((s, i) => ({ number: i + 1, description: s.d,
    episodes: s.e.map((e, j) => ({ episodeId: nextId("EP"), number: j + 1, title: e[0], synopsis: e[1], durationSec: e[2] * 60 })) }));
  db.contents.insertOne(base(id, Object.assign({ type: "series", seasons: ss,
    episodeCount: ss.reduce((n, s) => n + s.episodes.length, 0) }, o)));
  return id;
};

movie({ title: "La ciudad de los espejos", synopsis: "Una arquitecta descubre que su ciudad cambia de forma cada noche.",
  releaseYear: 2023, genres: ["drama", "misterio"], productionCountries: ["CO", "MX"], audioLanguages: ["es", "en"],
  subtitleLanguages: ["es", "en", "pt"], ageRating: 16, durationSec: 114 * 60,
  directors: [{ name: "Laura Restrepo Díaz" }],
  cast: [{ name: "Ana Torres", character: "Elena Ruiz" }, { name: "Mateo Gil", character: "Tomás" }, { name: "Rosa Pardo", character: null }] });
const RETIRED = movie({ title: "Verano en Barichara", synopsis: "Una familia pasa sus vacaciones en un pueblo de Santander.",
  releaseYear: 2019, genres: ["comedia", "familiar"], productionCountries: ["CO"], audioLanguages: ["es"],
  subtitleLanguages: ["en"], ageRating: 0, durationSec: 90 * 60, directors: [{ name: "Camilo Rojas" }],
  cast: [{ name: "Lucía Peña", character: "Abuela Carmen" }] });
movie({ title: "El último tren a Honda", synopsis: "Dos hermanos recorren el río Magdalena para cumplir una promesa.",
  releaseYear: 2021, genres: ["aventura", "drama"], productionCountries: ["CO"], audioLanguages: ["es", "en"],
  subtitleLanguages: ["es", "en"], ageRating: 12, durationSec: 101 * 60, directors: [{ name: "Sergio Cabrera" }],
  cast: [{ name: "Julián Ríos", character: "Pablo" }, { name: "Marcela Soto", character: "Inés" }] });
movie({ title: "Noche de neón", synopsis: "Un taxista queda atrapado en una persecución durante una noche en Los Ángeles.",
  releaseYear: 2024, genres: ["thriller", "acción"], productionCountries: ["US"], audioLanguages: ["en", "es"],
  subtitleLanguages: ["es", "en"], ageRating: 18, durationSec: 118 * 60, directors: [{ name: "Kate Morrison" }],
  cast: [{ name: "Daniel Price", character: "Joe" }, { name: "Mia Chen", character: "Detective Park" }] });
movie({ title: "Pequeños inventores", synopsis: "Un grupo de niños construye un robot para salvar la feria del barrio.",
  releaseYear: 2022, genres: ["animación", "familiar"], productionCountries: ["ES", "AR"], audioLanguages: ["es", "en"],
  subtitleLanguages: ["es"], ageRating: 0, durationSec: 84 * 60, directors: [{ name: "Marta Vidal" }],
  cast: [{ name: "Pablo Ruiz", character: "Leo (voz)" }] });
movie({ title: "Rumbo al Pacífico", synopsis: "Una bióloga y un pescador se conocen durante la temporada de ballenas.",
  releaseYear: 2020, genres: ["drama", "romance"], productionCountries: ["CO", "EC"], audioLanguages: ["es"],
  subtitleLanguages: ["en"], ageRating: 12, durationSec: 97 * 60, directors: [{ name: "Andrea Quintero" }],
  cast: [{ name: "Valentina Rey", character: "Sara" }, { name: "Jhon Mosquera", character: "Ramiro" }] });
const DRAFT = movie({ title: "Proyecto Órbita", synopsis: "Una misión latinoamericana intenta llegar a la Luna.",
  releaseYear: 2025, genres: ["ciencia ficción"], productionCountries: ["US", "MX"], audioLanguages: ["en", "es"],
  subtitleLanguages: ["es"], ageRating: 12, durationSec: 126 * 60, directors: [{ name: "Diego Luna" }], cast: [],
  status: "draft", publishedAt: null });

series({ title: "Código Andino", synopsis: "Un equipo de hackers éticos protege la red eléctrica del país.",
  releaseYear: 2024, genres: ["thriller", "tecnología"], productionCountries: ["CO", "PE"], audioLanguages: ["es"],
  subtitleLanguages: ["es", "en"], ageRating: 12 }, [
  { d: "El apagón", e: [["Sin luz", "Bogotá queda a oscuras.", 45], ["El rastro", "Aparece la primera pista.", 44], ["Contraataque", "El equipo responde.", 47]] },
  { d: "La red profunda", e: [["Regreso", "Una nueva amenaza.", 47], ["Puerta trasera", "Alguien filtró el código.", 46]] }]);
series({ title: "La casa de los abuelos", synopsis: "Tres generaciones conviven en una casa de Popayán.",
  releaseYear: 2021, genres: ["comedia", "familiar"], productionCountries: ["CO"], audioLanguages: ["es"],
  subtitleLanguages: ["en"], ageRating: 0 }, [
  { d: "La llegada", e: [["La mudanza", "Los nietos llegan a Popayán.", 25], ["El huerto", "La abuela enseña a sembrar.", 24], ["Semana Santa", "Las procesiones.", 26]] },
  { d: "El cumpleaños", e: [["Noventa velas", "El abuelo cumple noventa.", 25], ["La orquesta", "Llega la música.", 25], ["Sorpresas", "Un invitado inesperado.", 27]] },
  { d: "Despedidas", e: [["El viaje", "Uno de los nietos se va.", 26], ["Cartas", "Llegan noticias.", 24], ["La casa", "Toca decidir qué hacer con la casa.", 30]] }]);
series({ title: "Frontera Norte", synopsis: "Una fiscal investiga una red de contrabando entre dos países.",
  releaseYear: 2023, genres: ["crimen", "drama"], productionCountries: ["MX", "US"], audioLanguages: ["es", "en"],
  subtitleLanguages: ["es", "en"], ageRating: 18 }, [
  { d: "El cargamento", e: [["Aduana", "Un camión desaparece.", 52], ["Testigos", "Nadie quiere hablar.", 50], ["La fiscal", "Valeria toma el caso.", 55]] },
  { d: "Del otro lado", e: [["Cruce", "La investigación pasa a Texas.", 53], ["Infiltrada", "Una agente entra a la red.", 51], ["Juicio", "El caso llega a los tribunales.", 58]] }]);

docu({ title: "Páramos: fábricas de agua", synopsis: "Recorrido por los páramos colombianos y su papel en el ciclo del agua.",
  releaseYear: 2022, genres: ["naturaleza", "ciencia"], productionCountries: ["CO"], audioLanguages: ["es"],
  subtitleLanguages: ["en", "fr"], ageRating: 0, durationSec: 66 * 60, directors: [{ name: "Andrés Mejía" }],
  topics: ["ecosistemas", "agua", "cambio climático"],
  interviewees: [{ name: "Paula Méndez", description: "Bióloga, Universidad Nacional" }],
  sources: [{ name: "Instituto Humboldt", kind: "institution", role: "asesoría científica" }] });
docu({ title: "Café de origen", synopsis: "Familias caficultoras del Cauca y del sur de Brasil cuentan su oficio.",
  releaseYear: 2021, genres: ["gastronomía", "cultura"], productionCountries: ["CO", "BR"], audioLanguages: ["es", "pt"],
  subtitleLanguages: ["es", "en"], ageRating: 0, durationSec: 58 * 60, directors: [{ name: "Natalia Ospina" }],
  topics: ["café", "agricultura"], interviewees: [{ name: "Don Aurelio Muñoz", description: "Caficultor de Inzá" }],
  sources: [{ name: "Federación Nacional de Cafeteros", kind: "organization", role: "archivo" }] });
docu({ title: "Voces del conflicto", synopsis: "Testimonios de víctimas y excombatientes sobre la reconciliación.",
  releaseYear: 2019, genres: ["historia", "sociedad"], productionCountries: ["CO"], audioLanguages: ["es"],
  subtitleLanguages: ["en"], ageRating: 16, durationSec: 92 * 60, directors: [{ name: "Carlos Rentería" }],
  topics: ["conflicto armado", "memoria", "paz"],
  interviewees: [{ name: "María Elena Ruiz", description: "Lideresa social" }, { name: "Jorge Suárez" }],
  sources: [{ name: "Centro Nacional de Memoria Histórica", kind: "institution", role: "archivo" }] });
docu({ title: "Inteligencia artificial: la nueva frontera", synopsis: "Cómo los modelos de lenguaje cambian el trabajo y la educación.",
  releaseYear: 2025, genres: ["tecnología", "ciencia"], productionCountries: ["US", "ES"], audioLanguages: ["en", "es"],
  subtitleLanguages: ["es"], ageRating: 12, durationSec: 75 * 60, directors: [{ name: "Elena Sanz" }],
  topics: ["inteligencia artificial", "educación"], interviewees: [{ name: "Dr. Tomás Herrera", description: "Investigador" }],
  sources: [] });

// ---------------- actividad de visualización ----------------
// Elementos reproducibles: películas, documentales y episodios
const items = [];
db.contents.find({ status: { $in: ["published", "retired"] } }).forEach(c => {
  if (c.type === "series") {
    c.seasons.forEach(s => s.episodes.forEach(e => items.push({ contentId: c._id, contentType: "series",
      episodeId: e.episodeId, itemId: e.episodeId, dur: e.durationSec, age: c.ageRating })));
  } else {
    items.push({ contentId: c._id, contentType: c.type, episodeId: null, itemId: c._id, dur: c.durationSec, age: c.ageRating });
  }
});

// Perfiles de Oracle con las suscripciones bajo las que vieron contenido
// [accountId, profileId, maxAgeRating, [[subscriptionId, planId, inicioHaceDías, finHaceDías], ...]]
const P = [
  [1, 101, 18, [[10, 1, 70, 40], [11, 2, 10, 0.2]]],
  [1, 102, 7,  [[10, 1, 70, 40], [11, 2, 10, 0.2]]],
  [1, 103, 16, [[10, 1, 70, 40]]],                       // perfil hoy inactivo: su historial se conserva
  [2, 201, 18, [[20, 3, 45, 15]]],
  [2, 202, 12, [[20, 3, 45, 15]]],
  [3, 301, 16, [[30, 1, 5, 0.2]]],
  [5, 501, 18, [[50, 2, 80, 50], [51, 3, 40, 10], [52, 3, 3, 0.2]]],
  [5, 502, 12, [[50, 2, 80, 50], [51, 3, 40, 10], [52, 3, 3, 0.2]]],
  [5, 503, 7,  [[51, 3, 40, 10], [52, 3, 3, 0.2]]],
  [5, 504, 18, [[52, 3, 3, 0.2]]]
];

const sessions = [];
P.forEach(([accountId, profileId, maxAge, subs]) => {
  const allowed = items.filter(i => i.age <= maxAge);
  subs.forEach(([subscriptionId, planId, from, to]) => {
    for (let k = 0; k < 5; k++) {
      const it = (profileId === 101 && subscriptionId === 10 && k === 0)
        ? items.find(i => i.itemId === RETIRED)           // Ana vio la película que luego se retiró
        : pick(allowed);
      const startedAt = daysAgo(to + (from - to) * rnd());
      const seeked = rnd() < 0.3 ? Math.round(it.dur * 0.1) : 0;
      const finished = rnd() < 0.55;
      const lastPos = finished ? it.dur : Math.round(it.dur * (0.1 + 0.7 * rnd()));
      const watched = Math.max(0, lastPos - seeked);
      const endedAt = new Date(startedAt.getTime() + watched * 1000);
      sessions.push({ accountId, profileId, subscriptionId, planId,
        contentId: it.contentId, contentType: it.contentType, episodeId: it.episodeId, itemId: it.itemId,
        itemDurationSec: it.dur, startedAt, endedAt, lastHeartbeatAt: endedAt,
        lastPositionSec: lastPos, watchedSec: watched, seekedSec: seeked,
        status: "finished", endReason: finished ? "user_finished" : "user_stopped",
        completed: finished || lastPos >= 0.9 * it.dur });
    }
  });
});
db.viewingSessions.insertMany(sessions);

// Progreso actual: la última sesión de cada perfil y elemento
db.viewingSessions.aggregate([
  { $sort: { startedAt: 1 } },
  { $group: { _id: { profileId: "$profileId", itemId: "$itemId" }, s: { $last: "$$ROOT" } } }
]).forEach(({ s }) => db.playbackProgress.insertOne({
  accountId: s.accountId, profileId: s.profileId, contentId: s.contentId, contentType: s.contentType,
  episodeId: s.episodeId, itemId: s.itemId, positionSec: s.lastPositionSec, durationSec: s.itemDurationSec,
  completed: s.completed, lastWatchedAt: s.endedAt, lastSessionId: s._id }));

// Mi lista
const firstOf = type => db.contents.findOne({ type, status: "published", ageRating: 0 })._id;
db.watchlist.insertMany([
  { accountId: 1, profileId: 101, contentId: RETIRED, addedAt: daysAgo(60) },        // retirado: se muestra como no disponible
  { accountId: 1, profileId: 101, contentId: "SER-000001", addedAt: daysAgo(5) },
  { accountId: 1, profileId: 102, contentId: firstOf("documentary"), addedAt: daysAgo(4) },
  { accountId: 5, profileId: 503, contentId: firstOf("series"), addedAt: daysAgo(2) }
]);

// Se retira la película después de que tuvo actividad
db.contents.updateOne({ _id: RETIRED }, { $set: { status: "retired", retiredAt: daysAgo(20), updatedAt: daysAgo(20) } });

["contents", "viewingSessions", "playbackProgress", "watchlist", "admins", "counters"]
  .forEach(c => print(c.padEnd(18) + db.getCollection(c).countDocuments()));
print("Borrador sin publicar: " + DRAFT + "   Retirado: " + RETIRED);
}
