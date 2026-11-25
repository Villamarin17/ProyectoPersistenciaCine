// Conexión a MongoDB. Las transacciones requieren Atlas o un conjunto de réplicas.
const { MongoClient } = require('mongodb');

let client;
let database;

async function init() {
  client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,   // si MongoDB no responde, la petición falla rápido
    appName: 'cineconecta'
  });
  await client.connect();
  database = client.db(process.env.MONGODB_DB || 'cineconecta');
}

function db() {
  if (!database) throw Object.assign(new Error('MongoDB no está disponible.'), { unavailable: 'MongoDB' });
  return database;
}

function getClient() {
  return client;
}

function isUnavailable(err) {
  return err && /MongoServerSelectionError|MongoNetworkError|MongoTopologyClosedError|MongoNotConnectedError/.test(err.name);
}

async function close() {
  if (client) await client.close();
}

module.exports = { init, db, getClient, isUnavailable, close };
