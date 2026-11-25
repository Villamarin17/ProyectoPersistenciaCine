-- =====================================================================
-- CineConecta - Volumen para las mediciones de eficiencia
-- 20.000 cuentas, 20.000 perfiles, 200.000 suscripciones y 200.000 pagos
-- (10 suscripciones consecutivas de 30 días por cuenta, sin superposición).
-- Los inicios se reparten en los 30 días del mes para que los pagos queden
-- distribuidos en el tiempo; la suscripción más reciente de casi todas las cuentas está vigente.
-- Ids desde 5.000.000 para no cruzarse con las secuencias de la aplicación.
-- mongo/04_volumen.js genera las sesiones de MongoDB para estas mismas cuentas.
-- Para quitar el volumen: oracle/05b_borrar_volumen.sql
-- =====================================================================
DECLARE
  v_now  TIMESTAMP := SYS_EXTRACT_UTC(SYSTIMESTAMP);
  v_hash VARCHAR2(100) := '$2a$10$9MxnLVD6ke0Ydl4xgDT8C.K5DnoZfqrPrq1mSRDT.qMu0PSoZMARG';
BEGIN
  INSERT INTO ACCOUNTS (accountId, fullName, email, passwordHash, createdAt)
  SELECT 5000000 + LEVEL, 'Cliente volumen ' || LEVEL, 'vol' || LEVEL || '@cineconecta.test', v_hash, v_now - INTERVAL '320' DAY(3)
    FROM dual CONNECT BY LEVEL <= 20000;

  INSERT INTO PROFILES (profileId, accountId, name, maxAgeRating, isActive)
  SELECT 5000000 + LEVEL, 5000000 + LEVEL, 'Principal', 18, 'Y'
    FROM dual CONNECT BY LEVEL <= 20000;

  -- Cuenta i, suscripción k (k = 1 es la más reciente)
  INSERT INTO SUBSCRIPTIONS (subscriptionId, accountId, planId, startsAt, endsAt)
  SELECT 5000000 + (a.i - 1) * 10 + k.k, 5000000 + a.i, MOD(a.i + k.k, 3) + 1,
         v_now - NUMTODSINTERVAL(30 * k.k - MOD(a.i, 30), 'DAY') - NUMTODSINTERVAL(MOD(a.i, 24) + 1, 'HOUR'),
         v_now - NUMTODSINTERVAL(30 * k.k - MOD(a.i, 30), 'DAY') - NUMTODSINTERVAL(MOD(a.i, 24) + 1, 'HOUR') + INTERVAL '30' DAY
    FROM (SELECT LEVEL i FROM dual CONNECT BY LEVEL <= 20000) a
   CROSS JOIN (SELECT LEVEL k FROM dual CONNECT BY LEVEL <= 10) k;

  INSERT INTO PAYMENTS (paymentId, subscriptionId, paidAt, amount, reference)
  SELECT s.subscriptionId, s.subscriptionId, s.startsAt, p.price, 'PAY-VOL-' || s.subscriptionId
    FROM SUBSCRIPTIONS s JOIN PLANS p ON p.planId = s.planId
   WHERE s.subscriptionId > 5000000;
  COMMIT;
END;
/
BEGIN
  DBMS_STATS.GATHER_SCHEMA_STATS(USER);
END;
/
SELECT (SELECT COUNT(*) FROM ACCOUNTS) cuentas, (SELECT COUNT(*) FROM SUBSCRIPTIONS) suscripciones,
       (SELECT COUNT(*) FROM PAYMENTS) pagos FROM dual;
