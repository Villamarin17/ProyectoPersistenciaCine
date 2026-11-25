// Utilidades compartidas por las demostraciones (usan las mismas credenciales del archivo .env)
process.env.TZ = 'UTC';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

async function connect() {
  const c = await oracledb.getConnection({ user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING });
  if (process.env.ORACLE_SCHEMA) await c.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${process.env.ORACLE_SCHEMA}`);
  await c.execute(`ALTER SESSION SET TIME_ZONE = 'UTC'`);
  return c;
}

// Cuenta nueva para que la demostración no dependa de los datos de prueba
async function newAccount(c, label) {
  const r = await c.execute('BEGIN sp_register_account(:n, :e, :h, :id); END;', {
    n: 'Demo ' + label, e: `demo.${label}.${Date.now()}@cineconecta.test`,
    h: '$2a$10$9MxnLVD6ke0Ydl4xgDT8C.K5DnoZfqrPrq1mSRDT.qMu0PSoZMARG',
    id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  return r.outBinds.id;
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s]`, ...a);
const msg = e => (/ORA-\d{5}: [^\n]*/.exec(e.message) || [e.message])[0];

module.exports = { oracledb, connect, newAccount, log, msg };
