// Demostración: fallo después de insertar la suscripción y antes de registrar el pago.
// El procedimiento revierte la transacción completa: no queda ni la suscripción ni el pago.
// Uso: node demos/fallo_transaccion.js [accountId]
const { oracledb, connect, newAccount, log, msg } = require('./_comun');

(async () => {
  const c = await connect();
  const accountId = Number(process.argv[2]) || await newAccount(c, 'fallo');
  const count = async () => (await c.execute(
    `SELECT COUNT(subscriptionId) "suscripciones", COUNT(paymentId) "pagos"
       FROM vw_account_subscriptions WHERE accountId = :a`, { a: accountId })).rows[0];
  log(`Cuenta ${accountId}. Antes:`, await count());
  try {
    await c.execute('BEGIN sp_purchase_subscription(:a, 1, \'Y\', :ref, :id, \'Y\'); END;',
      { a: accountId, ref: 'DEMO-FALLO-' + Date.now(), id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } });
    log('La contratación terminó sin error (no debería pasar).');
  } catch (e) {
    log('La contratación falló →', msg(e));
  }
  log('Después (sin registros parciales):', await count());
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
