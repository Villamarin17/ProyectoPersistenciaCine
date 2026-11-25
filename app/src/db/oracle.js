// Conexión a Oracle (modo Thin de node-oracledb: no requiere Oracle Client instalado).
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

let pool;

async function init() {
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 1,
    poolMax: 10,
    connectTimeout: 5,      // segundos: si Oracle no responde, la petición falla rápido
    queueTimeout: 8000,
    // Todas las fechas se manejan en UTC. Si la aplicación usa un usuario con privilegios
    // mínimos, trabaja sobre el esquema dueño de las tablas (ORACLE_SCHEMA).
    sessionCallback: (conn, tag, cb) => {
      const schema = process.env.ORACLE_SCHEMA;
      const sql = schema && /^[A-Za-z][A-Za-z0-9_$#]*$/.test(schema)
        ? `BEGIN EXECUTE IMMEDIATE 'ALTER SESSION SET TIME_ZONE = ''UTC'''; EXECUTE IMMEDIATE 'ALTER SESSION SET CURRENT_SCHEMA = ${schema}'; END;`
        : `ALTER SESSION SET TIME_ZONE = 'UTC'`;
      conn.execute(sql).then(() => cb(), cb);
    }
  });
}

async function withConnection(fn) {
  if (!pool) throw Object.assign(new Error('Oracle no está disponible.'), { unavailable: 'Oracle' });
  let conn;
  try {
    conn = await pool.getConnection();
  } catch (e) {
    throw Object.assign(new Error('Oracle no está disponible.'), { unavailable: 'Oracle', cause: e });
  }
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

// Consulta con variables de enlace (bind variables): nunca se concatena texto del usuario
async function query(sql, binds = {}) {
  return withConnection(async conn => (await conn.execute(sql, binds)).rows);
}

async function queryOne(sql, binds = {}) {
  const rows = await query(sql, binds);
  return rows[0] || null;
}

// Llamada a procedimiento: el procedimiento confirma o revierte su propia transacción
async function callProcedure(sql, binds) {
  return withConnection(async conn => (await conn.execute(sql, binds)).outBinds);
}

// Errores de negocio de los procedimientos (ORA-20000 a ORA-20999) → mensaje legible
function businessMessage(err) {
  const m = /ORA-20\d{3}: ([^\n]*)/.exec(err && err.message || '');
  return m ? m[1] : null;
}

async function close() {
  if (pool) await pool.close(5);
}

module.exports = { init, query, queryOne, callProcedure, businessMessage, close, oracledb };
