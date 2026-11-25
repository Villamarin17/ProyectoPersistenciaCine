// Demostración: dos solicitudes simultáneas de creación de perfil en una cuenta con plan
// Básico (máximo 1 perfil activo). Ambas bloquean la cuenta; solo la primera puede crear.
// Uso: node demos/concurrencia_perfiles.js
const { oracledb, connect, newAccount, log, msg } = require('./_comun');

(async () => {
  const admin = await connect();
  const accountId = await newAccount(admin, 'perfiles');
  await admin.execute('BEGIN sp_purchase_subscription(:a, 1, \'Y\', :ref, :id); END;',
    { a: accountId, ref: 'DEMO-PERF-' + Date.now(), id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
  log(`Cuenta ${accountId} con plan Básico (1 perfil). Se crean dos perfiles al mismo tiempo.`);

  const create = async name => {
    const c = await connect();
    try {
      const r = await c.execute('BEGIN sp_create_profile(:a, :n, 18, :id, 3); END;',
        { a: accountId, n: name, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
      log(`${name}: CREADO (perfil ${r.outBinds.id})`);
    } catch (e) { log(`${name}: RECHAZADO → ${msg(e)}`); } finally { await c.close(); }
  };
  await Promise.all([create('Perfil A'), create('Perfil B')]);
  const n = (await admin.execute(`SELECT COUNT(*) "n" FROM PROFILES WHERE accountId = :a AND isActive = 'Y'`, { a: accountId })).rows[0].n;
  log(`Perfiles activos en la cuenta: ${n} (máximo del plan: 1)`);
  await admin.close();
})().catch(e => { console.error(e); process.exit(1); });
