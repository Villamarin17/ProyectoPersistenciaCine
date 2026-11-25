// =====================================================================
// CineConecta - Modelo documental MongoDB: colecciones, validaciones e índices
// Equipo Comadritas: Estefany Villamarin, Valeria Valencia
// Ejecutar con:  mongosh "<cadena de conexión>" mongo/01_modelo.js
// Requiere MongoDB 6.0+ (probado en MongoDB 8.0, conjunto de réplicas).
// =====================================================================
// --- inicio del bloque: las llaves permiten pegar varios scripts seguidos en la misma consola sin conflictos de nombres
{

db = db.getSiblingDB("cineconecta");

// Borra el modelo si ya existe (solo para entornos de prueba)
["contents", "viewingSessions", "playbackProgress", "watchlist", "admins", "counters"]
  .forEach(c => db.getCollection(c).drop());

// ---------------------------------------------------------------------
// Tipos reutilizables
// ---------------------------------------------------------------------
const INT_ID = { bsonType: ["int", "long"], minimum: 1 };          // ids que vienen de la BD relacional
const STR_LIST = { bsonType: "array", items: { bsonType: "string", minLength: 1 }, uniqueItems: true };
const PERSON = {
  bsonType: "object", required: ["name"],
  properties: { name: { bsonType: "string", minLength: 1 } }
};
const DURATION = { bsonType: ["int", "long"], minimum: 1, description: "segundos" };

// ---------------------------------------------------------------------
// 1. contents: catálogo polimórfico (película, serie, documental)
// ---------------------------------------------------------------------
const commonProps = {
  _id:               { bsonType: "string", pattern: "^(MOV|SER|DOC)-[0-9]{6}$" },
  type:              { enum: ["movie", "series", "documentary"] },
  title:             { bsonType: "string", minLength: 1, maxLength: 200 },
  synopsis:          { bsonType: "string", minLength: 1 },
  releaseYear:       { bsonType: "int", minimum: 1888, maximum: 2100 },
  genres:            { ...STR_LIST, minItems: 1 },
  productionCountries: { ...STR_LIST, minItems: 1, items: { bsonType: "string", pattern: "^[A-Z]{2}$" } },
  audioLanguages:    { ...STR_LIST, minItems: 1, items: { bsonType: "string", pattern: "^[a-z]{2,3}$" } },
  subtitleLanguages: { ...STR_LIST, items: { bsonType: "string", pattern: "^[a-z]{2,3}$" } },
  ageRating:         { bsonType: "int", minimum: 0, maximum: 18 },
  coverUrl:          { bsonType: "string", pattern: "^https?://" },
  status:            { enum: ["draft", "published", "retired"] },
  schemaVersion:     { bsonType: "int", minimum: 1 },
  createdAt:         { bsonType: "date" },
  updatedAt:         { bsonType: "date" },
  publishedAt:       { bsonType: ["date", "null"] },
  retiredAt:         { bsonType: ["date", "null"] },
  createdBy:         { bsonType: "objectId" },
  updatedBy:         { bsonType: "objectId" }
};
const commonRequired = ["_id", "type", "title", "synopsis", "releaseYear", "genres", "productionCountries",
  "audioLanguages", "subtitleLanguages", "ageRating", "coverUrl", "status", "schemaVersion", "createdAt", "updatedAt"];

const movieSchema = {
  properties: {
    _id: { pattern: "^MOV-" }, type: { enum: ["movie"] },
    durationSec: DURATION,
    directors: { bsonType: "array", minItems: 1, items: PERSON },
    cast: {
      bsonType: "array", items: {
        bsonType: "object", required: ["name"],
        properties: { name: { bsonType: "string", minLength: 1 }, character: { bsonType: ["string", "null"] } }
      }
    }
  },
  required: ["durationSec", "directors", "cast"]
};

const documentarySchema = {
  properties: {
    _id: { pattern: "^DOC-" }, type: { enum: ["documentary"] },
    durationSec: DURATION,
    directors: { bsonType: "array", minItems: 1, items: PERSON },
    topics: { ...STR_LIST, minItems: 1 },
    interviewees: {
      bsonType: "array", items: {
        bsonType: "object", required: ["name"],
        properties: { name: { bsonType: "string", minLength: 1 }, description: { bsonType: "string" } }
      }
    },
    sources: {
      bsonType: "array", items: {
        bsonType: "object", required: ["name", "kind"],
        properties: {
          name: { bsonType: "string", minLength: 1 },
          kind: { enum: ["institution", "archive", "publication", "organization", "other"] },
          role: { bsonType: "string" }, url: { bsonType: "string" }
        }
      }
    }
  },
  required: ["durationSec", "directors", "topics"]
};

const seriesSchema = {
  properties: {
    _id: { pattern: "^SER-" }, type: { enum: ["series"] },
    seasons: {
      bsonType: "array", minItems: 1,
      items: {
        bsonType: "object", required: ["number", "description", "episodes"],
        properties: {
          number: { bsonType: "int", minimum: 1 },
          description: { bsonType: "string", minLength: 1 },
          episodes: {
            bsonType: "array", minItems: 1,
            items: {
              bsonType: "object", required: ["episodeId", "number", "title", "synopsis", "durationSec"],
              properties: {
                episodeId: { bsonType: "string", pattern: "^EP-[0-9]{6}$" },
                number: { bsonType: "int", minimum: 1 },
                title: { bsonType: "string", minLength: 1 },
                synopsis: { bsonType: "string", minLength: 1 },
                durationSec: DURATION
              }
            }
          }
        }
      }
    },
    episodeCount: { bsonType: "int", minimum: 1 }
  },
  required: ["seasons"]
};

// Unicidad dentro del documento (los índices únicos no la garantizan dentro de un mismo arreglo)
const allEpisodeIds = { $reduce: { input: { $ifNull: ["$seasons", []] }, initialValue: [],
  in: { $concatArrays: ["$$value", { $ifNull: ["$$this.episodes.episodeId", []] }] } } };
const uniqueInArray = arr => ({ $eq: [{ $size: arr }, { $size: { $setUnion: [arr, []] } }] });

const seriesUniqueness = {
  $expr: {
    $or: [
      { $ne: ["$type", "series"] },
      { $and: [
        uniqueInArray({ $ifNull: ["$seasons.number", []] }),               // temporadas no repetidas en la serie
        { $allElementsTrue: [{ $map: { input: { $ifNull: ["$seasons", []] }, as: "s",
            in: uniqueInArray({ $ifNull: ["$$s.episodes.number", []] }) } }] }, // episodios no repetidos en la temporada
        uniqueInArray(allEpisodeIds)                                       // episodeId no repetido en la serie
      ] }
    ]
  }
};

// Coherencia del estado de publicación
const statusRules = {
  $or: [
    { status: "draft" },
    { status: "published", publishedAt: { $type: "date" } },
    { status: "retired", retiredAt: { $type: "date" } }
  ]
};

db.createCollection("contents", {
  validator: {
    $and: [
      { $jsonSchema: {
          bsonType: "object",
          required: commonRequired,
          properties: commonProps,
          oneOf: [movieSchema, seriesSchema, documentarySchema]
          // additionalProperties no se restringe: el catálogo puede crecer con nuevas características
      } },
      seriesUniqueness,
      statusRules
    ]
  },
  validationLevel: "strict",
  validationAction: "error"
});

db.contents.createIndex({ "seasons.episodes.episodeId": 1 },
  { name: "ux_contents_episodeId", unique: true, partialFilterExpression: { type: "series" } });
db.contents.createIndex({ status: 1, type: 1, releaseYear: -1, title: 1 }, { name: "ix_contents_browse" });
db.contents.createIndex({ status: 1, genres: 1, releaseYear: -1 }, { name: "ix_contents_genre" });
db.contents.createIndex({ status: 1, audioLanguages: 1 }, { name: "ix_contents_audio" });
db.contents.createIndex({ title: "text" },
  { name: "tx_contents_title", default_language: "spanish", language_override: "idiomaTexto" });

// ---------------------------------------------------------------------
// 2. viewingSessions: historial inmutable de sesiones de visualización
// ---------------------------------------------------------------------
db.createCollection("viewingSessions", {
  validator: {
    $and: [
      { $jsonSchema: {
        bsonType: "object",
        required: ["accountId", "profileId", "subscriptionId", "planId", "contentId", "contentType", "itemId",
                   "itemDurationSec", "startedAt", "lastHeartbeatAt", "lastPositionSec", "watchedSec",
                   "status", "completed"],
        properties: {
          accountId: INT_ID, profileId: INT_ID, subscriptionId: INT_ID, planId: INT_ID,
          contentId: { bsonType: "string", pattern: "^(MOV|SER|DOC)-[0-9]{6}$" },
          contentType: { enum: ["movie", "series", "documentary"] },
          episodeId: { bsonType: ["string", "null"], pattern: "^EP-[0-9]{6}$" },
          itemId: { bsonType: "string", pattern: "^(MOV|DOC|EP)-[0-9]{6}$" },
          itemDurationSec: DURATION,
          startedAt: { bsonType: "date" },
          endedAt: { bsonType: ["date", "null"] },
          lastHeartbeatAt: { bsonType: "date" },
          lastPositionSec: { bsonType: ["int", "long", "double"], minimum: 0 },
          watchedSec: { bsonType: ["int", "long", "double"], minimum: 0 },
          seekedSec: { bsonType: ["int", "long", "double"], minimum: 0 },
          status: { enum: ["active", "finished", "interrupted"] },
          endReason: { enum: ["user_finished", "user_stopped", "timeout", null] },
          completed: { bsonType: "bool" }
        }
      } },
      // en series se reproduce por episodio; películas y documentales no tienen episodio
      { $or: [
        { contentType: "series", episodeId: { $type: "string" } },
        { contentType: { $in: ["movie", "documentary"] }, episodeId: { $in: [null] } }
      ] },
      { $or: [ { status: "active" }, { endedAt: { $type: "date" } } ] }
    ]
  },
  validationLevel: "strict", validationAction: "error"
});
// Informe de consumo: cubre la agregación completa (filtro por fecha, agrupación y sumas)
// sin leer los documentos. Ver mongo/05_optimizacion.js
db.viewingSessions.createIndex({ startedAt: 1, planId: 1, contentType: 1, profileId: 1, watchedSec: 1 },
  { name: "ix_sessions_report" });
db.viewingSessions.createIndex({ status: 1, lastHeartbeatAt: 1 },
  { name: "ix_sessions_open", partialFilterExpression: { status: "active" } });

// ---------------------------------------------------------------------
// 3. playbackProgress: estado actual por perfil y elemento reproducible
// ---------------------------------------------------------------------
db.createCollection("playbackProgress", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["accountId", "profileId", "contentId", "contentType", "itemId", "positionSec", "durationSec",
               "completed", "lastWatchedAt", "lastSessionId"],
    properties: {
      accountId: INT_ID, profileId: INT_ID,
      contentId: { bsonType: "string", pattern: "^(MOV|SER|DOC)-[0-9]{6}$" },
      contentType: { enum: ["movie", "series", "documentary"] },
      episodeId: { bsonType: ["string", "null"] },
      itemId: { bsonType: "string", pattern: "^(MOV|DOC|EP)-[0-9]{6}$" },
      positionSec: { bsonType: ["int", "long", "double"], minimum: 0 },
      durationSec: DURATION,
      completed: { bsonType: "bool" },
      lastWatchedAt: { bsonType: "date" },
      lastSessionId: { bsonType: "objectId" }
    }
  } },
  validationLevel: "strict", validationAction: "error"
});
db.playbackProgress.createIndex({ profileId: 1, itemId: 1 }, { name: "ux_progress_profile_item", unique: true });
db.playbackProgress.createIndex({ profileId: 1, completed: 1, lastWatchedAt: -1 }, { name: "ix_progress_continue" });

// ---------------------------------------------------------------------
// 4. watchlist ("Mi lista"): un documento por perfil y contenido
// ---------------------------------------------------------------------
db.createCollection("watchlist", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["accountId", "profileId", "contentId", "addedAt"],
    properties: {
      accountId: INT_ID, profileId: INT_ID,
      contentId: { bsonType: "string", pattern: "^(MOV|SER|DOC)-[0-9]{6}$" },
      addedAt: { bsonType: "date" }
    }
  } },
  validationLevel: "strict", validationAction: "error"
});
db.watchlist.createIndex({ profileId: 1, contentId: 1 }, { name: "ux_watchlist_profile_content", unique: true });
db.watchlist.createIndex({ profileId: 1, addedAt: -1 }, { name: "ix_watchlist_profile_recent" });

// ---------------------------------------------------------------------
// 5. admins: usuarios administrativos (independientes de las cuentas)
// ---------------------------------------------------------------------
db.createCollection("admins", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["username", "fullName", "email", "passwordHash", "roles", "isActive", "createdAt"],
    properties: {
      username: { bsonType: "string", pattern: "^[a-z0-9._-]{3,40}$" },
      fullName: { bsonType: "string", minLength: 1 },
      email: { bsonType: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
      passwordHash: { bsonType: "string", pattern: "^\\$(2[aby]|argon2id)\\$" },  // nunca texto plano
      roles: { bsonType: "array", minItems: 1, uniqueItems: true,
               items: { enum: ["catalog_manager", "report_viewer"] } },
      isActive: { bsonType: "bool" },
      createdAt: { bsonType: "date" },
      lastLoginAt: { bsonType: ["date", "null"] }
    }
  } },
  validationLevel: "strict", validationAction: "error"
});
db.admins.createIndex({ username: 1 }, { name: "ux_admins_username", unique: true });
db.admins.createIndex({ email: 1 }, { name: "ux_admins_email", unique: true, collation: { locale: "es", strength: 2 } });

// ---------------------------------------------------------------------
// 6. counters: secuencias para identificadores estables y no reutilizables
// ---------------------------------------------------------------------
db.createCollection("counters", {
  validator: { $jsonSchema: {
    bsonType: "object", required: ["_id", "seq"],
    properties: { _id: { enum: ["MOV", "SER", "DOC", "EP"] }, seq: { bsonType: ["int", "long"], minimum: 0 } }
  } }
});
db.counters.insertMany([
  { _id: "MOV", seq: NumberLong("0") }, { _id: "SER", seq: NumberLong("0") },
  { _id: "DOC", seq: NumberLong("0") }, { _id: "EP", seq: NumberLong("0") }
]);

print("Modelo CineConecta creado: " + db.getCollectionNames().sort().join(", "));
}
