// Demostración: dos solicitudes simultáneas de contratación para la misma cuenta.
// Cada una usa su propia conexión (como dos pestañas del navegador). La primera bloquea la
// fila de ACCOUNTS con SELECT ... FOR UPDATE y espera 3 s; la segunda queda bloqueada hasta
// que la primera confirma, y entonces encuentra la suscripción vigente y es rechazada.
// Uso: node demos/concurrencia_suscripcion.js [accountId]
const { oracledb, connect, newAccount, log, msg } = require('./_comun');

(async () => {
  const admin = await connect();
  const accountId = Number(process.argv[2]) || await newAccount(admin, 'concurrencia');
  log(`Cuenta ${accountId}. Se lanzan dos contrataciones al mismo tiempo (plan 2 y plan 3).`);

  const buy = async (label, planId) => {
    const c = await connect();
    try {
      log(`${label}: inicia`);
      const r = await c.execute('BEGIN sp_purchase_subscription(:a, :p, \'Y\', :ref, :id, \'N\', 3); END;',
        { a: accountId, p: planId, ref: `DEMO-${label}-${Date.now()}`, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
      log(`${label}: CONFIRMADA, suscripción ${r.outBinds.id}`);
    } catch (e) {
      log(`${label}: RECHAZADA → ${msg(e)}`);
    } finally { await c.close(); }
  };
  await Promise.all([buy('Solicitud A', 2), buy('Solicitud B', 3)]);

  const rows = (await admin.execute(
    `SELECT subscriptionId "id", planName "plan", TO_CHAR(startsAt, 'YYYY-MM-DD HH24:MI:SS') "inicio",
            TO_CHAR(endsAt, 'YYYY-MM-DD HH24:MI:SS') "fin", paymentId "pago"
       FROM vw_account_subscriptions WHERE accountId = :a ORDER BY startsAt`, { a: accountId })).rows;
  log('Suscripciones de la cuenta después de las dos solicitudes:'); console.table(rows);
  const overlap = (await admin.execute(
    `SELECT COUNT(*) "n" FROM vw_account_subscriptions a JOIN vw_account_subscriptions b ON a.accountId = b.accountId AND a.subscriptionId < b.subscriptionId
      WHERE a.accountId = :a AND a.startsAt < b.endsAt AND b.startsAt < a.endsAt`, { a: accountId })).rows[0].n;
  log(`Períodos superpuestos: ${overlap}`);
  await admin.close();
})().catch(e => { console.error(e); process.exit(1); });
