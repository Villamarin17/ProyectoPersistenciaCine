// =====================================================================
// CineConecta - Evidencias de optimización en MongoDB
// Requiere mongo/04_volumen.js (200.000 sesiones).
// Cada consulta se mide sin índice (hint { $natural: 1 } obliga a recorrer la
// colección) y con el índice que elige el planificador. Se usa explain("executionStats").
// Funciona igual en Atlas M0 y en un servidor local.
// Los resultados obtenidos están en docs/optimizacion.md.
// =====================================================================
{
db = db.getSiblingDB("cineconecta");
const vs = db.viewingSessions;
const DAY = 24 * 3600 * 1000;
const now = new Date();

// Recorre el árbol del plan y devuelve las etapas en orden
function etapas(plan) {
  const out = [];
  (function walk(p) {
    if (!p) return;
    out.push(p.stage + (p.indexName ? "(" + p.indexName + ")" : ""));
    walk(p.inputStage); (p.inputStages || []).forEach(walk);
  })(plan);
  return out.join(" <- ");
}

function resumen(nombre, exp) {
  const cursor = exp.stages ? exp.stages[0].$cursor : exp;
  const es = cursor.executionStats;
  print(`${nombre}`);
  print(`  plan:              ${etapas(cursor.queryPlanner.winningPlan.queryPlan || cursor.queryPlanner.winningPlan)}`);
  print(`  filas devueltas:   ${es.nReturned}`);
  print(`  claves examinadas: ${es.totalKeysExamined}`);
  print(`  docs examinados:   ${es.totalDocsExamined}`);
  print(`  tiempo (explain):  ${es.executionTimeMillis} ms`);
}

function promedio(fn, veces = 20) {
  fn();                                  // calienta la caché
  const t = Date.now();
  for (let i = 0; i < veces; i++) fn();
  return ((Date.now() - t) / veces).toFixed(1) + " ms";
}

// ---------------------------------------------------------------------
// 1. Informe de consumo por plan y tipo de contenido (últimos 7 días).
//    Misma agregación de la aplicación. Se compara sin índice, con un índice
//    simple por fecha y con el índice cubriente ix_sessions_report.
// ---------------------------------------------------------------------
const desde = new Date(now - 7 * DAY);
const informe = [
  { $match: { startedAt: { $gte: desde, $lt: now } } },
  { $group: { _id: { planId: "$planId", contentType: "$contentType" },
              watchedSec: { $sum: "$watchedSec" }, profiles: { $addToSet: "$profileId" }, sessions: { $sum: 1 } } },
  { $project: { _id: 0, planId: "$_id.planId", contentType: "$_id.contentType",
                minutes: { $round: [{ $divide: ["$watchedSec", 60] }, 1] },
                distinctProfiles: { $size: "$profiles" }, sessions: 1 } },
  { $sort: { planId: 1, contentType: 1 } }
];
const correrInforme = (opts = {}) => vs.aggregate(informe, opts).toArray();

const anio = [{ $match: { startedAt: { $gte: new Date(now - 365 * DAY), $lt: now } } }].concat(informe.slice(1));
const correrAnio = (opts = {}) => vs.aggregate(anio, opts).toArray();
const medir = opts => "  promedio 7 días: " + promedio(() => correrInforme(opts)) +
                      "   promedio un año: " + promedio(() => correrAnio(opts), 5);
const SIN = { hint: { $natural: 1 } };
const SIMPLE = { startedAt: 1, planId: 1, contentType: 1 };

print("\n===== Q1a informe de consumo 7 días: sin índice =====");
resumen("recorrido completo de la colección", vs.explain("executionStats").aggregate(informe, SIN));
print(medir(SIN));

print("\n===== Q1b informe de consumo 7 días: índice simple { startedAt, planId, contentType } =====");
vs.createIndex(SIMPLE, { name: "tmp_report_simple" });
const SIMPLE_H = { hint: "tmp_report_simple" };
resumen("tmp_report_simple", vs.explain("executionStats").aggregate(informe, SIMPLE_H));
print(medir(SIMPLE_H));
vs.dropIndex("tmp_report_simple");

print("\n===== Q1c informe de consumo 7 días: ix_sessions_report (índice cubriente) =====");
resumen("ix_sessions_report { startedAt, planId, contentType, profileId, watchedSec }",
        vs.explain("executionStats").aggregate(informe));
print(medir({}));
print("  filas del informe: " + correrInforme().length);

// ---------------------------------------------------------------------
// 2. Cierre de sesiones interrumpidas (tarea de la app cada minuto).
//    Índice parcial ix_sessions_open: solo guarda las sesiones activas.
// ---------------------------------------------------------------------
const abiertas = { status: "active", lastHeartbeatAt: { $lt: new Date(now - 2 * 60 * 1000) } };
print("\n===== Q2 sesiones activas sin latido =====");
resumen("Sin índice (recorrido completo)", vs.find(abiertas).hint({ $natural: 1 }).explain("executionStats"));
print("  promedio 20 ejecuciones: " + promedio(() => vs.find(abiertas).hint({ $natural: 1 }).toArray()));
resumen("Con ix_sessions_open (parcial, status = active)", vs.find(abiertas).explain("executionStats"));
print("  promedio 20 ejecuciones: " + promedio(() => vs.find(abiertas).toArray()));

// ---------------------------------------------------------------------
// 3. Tamaño de los índices de viewingSessions
// ---------------------------------------------------------------------
print("\n===== Tamaño de índices de viewingSessions (KB) =====");
const tam = vs.stats({ indexDetails: false }).indexSizes;
Object.keys(tam).forEach(k => print("  " + k.padEnd(22) + Math.round(tam[k] / 1024)));
print("  documentos: " + vs.countDocuments());
}
