-- =====================================================================
-- CineConecta - Evidencias de optimización en Oracle
-- Requiere el volumen de oracle/05_volumen.sql (200.000 suscripciones y pagos).
-- Cada consulta se compara con el índice invisible (el optimizador no lo usa)
-- y visible. ALTER INDEX ... INVISIBLE no borra el índice, solo lo oculta.
-- Ejecutar como dueño del esquema con F5 en SQL Developer o con SQL*Plus.
-- Los resultados obtenidos están en docs/optimizacion.md.
-- =====================================================================
SET SERVEROUTPUT ON
SET LINESIZE 200
SET PAGESIZE 200
SET FEEDBACK OFF

-- Ejecuta una consulta p_veces y muestra el tiempo promedio por ejecución
CREATE OR REPLACE PROCEDURE sp_medir(p_nombre VARCHAR2, p_sql VARCHAR2, p_veces PLS_INTEGER DEFAULT 200) AS
  v_ini TIMESTAMP;
  v_dur INTERVAL DAY TO SECOND;
  v_n   NUMBER;
BEGIN
  EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (' || p_sql || ')' INTO v_n;   -- calienta la caché
  v_ini := SYSTIMESTAMP;
  FOR i IN 1 .. p_veces LOOP
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (' || p_sql || ')' INTO v_n;
  END LOOP;
  v_dur := SYSTIMESTAMP - v_ini;
  DBMS_OUTPUT.PUT_LINE(RPAD(p_nombre, 48) || ' filas: ' || LPAD(v_n, 3) || '   promedio: ' ||
    TO_CHAR((EXTRACT(MINUTE FROM v_dur) * 60 + EXTRACT(SECOND FROM v_dur)) * 1000 / p_veces, 'FM9990.000') || ' ms');
END;
/

-- ---------------------------------------------------------------------
-- 1. Suscripción vigente de una cuenta. Se consulta al reproducir, al crear
--    o activar perfiles y al comprar. Índice ix_subs_account_period.
-- ---------------------------------------------------------------------
PROMPT
PROMPT ===== Q1 suscripción vigente: SIN índice =====
ALTER INDEX ix_subs_account_period INVISIBLE;
EXPLAIN PLAN SET STATEMENT_ID = 'Q1_SIN' FOR
SELECT * FROM vw_active_subscription WHERE accountId = 5010000;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q1_SIN', 'BASIC +ROWS +COST +PREDICATE'));
EXEC sp_medir('Q1 suscripción vigente, sin índice', 'SELECT * FROM vw_active_subscription WHERE accountId = 5010000');

PROMPT
PROMPT ===== Q1 suscripción vigente: CON índice =====
ALTER INDEX ix_subs_account_period VISIBLE;
EXPLAIN PLAN SET STATEMENT_ID = 'Q1_CON' FOR
SELECT * FROM vw_active_subscription WHERE accountId = 5010000;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q1_CON', 'BASIC +ROWS +COST +PREDICATE'));
EXEC sp_medir('Q1 suscripción vigente, con índice', 'SELECT * FROM vw_active_subscription WHERE accountId = 5010000');

-- ---------------------------------------------------------------------
-- 2. Historial de suscripciones y pagos de una cuenta (página Mi cuenta).
-- ---------------------------------------------------------------------
PROMPT
PROMPT ===== Q2 historial de la cuenta =====
ALTER INDEX ix_subs_account_period INVISIBLE;
EXEC sp_medir('Q2 historial de cuenta, sin índice', 'SELECT * FROM vw_account_subscriptions WHERE accountId = 5010000');
ALTER INDEX ix_subs_account_period VISIBLE;
EXEC sp_medir('Q2 historial de cuenta, con índice', 'SELECT * FROM vw_account_subscriptions WHERE accountId = 5010000');

-- ---------------------------------------------------------------------
-- 3. Informe de ingresos por plan de los últimos 7 días (misma consulta de la app).
--    Cuenta subscriptionId y no paymentId para que el índice cubra la consulta.
--    a) sin índice, b) con un índice simple sobre paidAt,
--    c) con el índice definitivo ix_payments_paidat (paidAt, subscriptionId, amount).
-- ---------------------------------------------------------------------
PROMPT
PROMPT ===== Q3a informe de ingresos: SIN índice =====
ALTER INDEX ix_payments_paidat INVISIBLE;
EXPLAIN PLAN SET STATEMENT_ID = 'Q3_SIN' FOR
SELECT pl.planId, pl.name, NVL(SUM(v.amount), 0) total, COUNT(v.subscriptionId) suscripciones
  FROM PLANS pl
  LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId
   AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL '7' DAY AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP)
 GROUP BY pl.planId, pl.name;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q3_SIN', 'BASIC +ROWS +COST'));
EXEC sp_medir('Q3a ingresos 7 días, sin índice', 'SELECT pl.planId, NVL(SUM(v.amount), 0) total, COUNT(v.subscriptionId) n FROM PLANS pl LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL ''7'' DAY AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP) GROUP BY pl.planId', 50);

PROMPT
PROMPT ===== Q3b informe de ingresos: índice simple sobre paidAt =====
CREATE INDEX ix_payments_paidat_simple ON PAYMENTS (paidAt);
EXPLAIN PLAN SET STATEMENT_ID = 'Q3_SIMPLE' FOR
SELECT pl.planId, pl.name, NVL(SUM(v.amount), 0) total, COUNT(v.subscriptionId) suscripciones
  FROM PLANS pl
  LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId
   AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL '7' DAY AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP)
 GROUP BY pl.planId, pl.name;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q3_SIMPLE', 'BASIC +ROWS +COST'));
DROP INDEX ix_payments_paidat_simple;

PROMPT
PROMPT ===== Q3c informe de ingresos: índice ix_payments_paidat =====
ALTER INDEX ix_payments_paidat VISIBLE;
EXPLAIN PLAN SET STATEMENT_ID = 'Q3_CON' FOR
SELECT pl.planId, pl.name, NVL(SUM(v.amount), 0) total, COUNT(v.subscriptionId) suscripciones
  FROM PLANS pl
  LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId
   AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL '7' DAY AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP)
 GROUP BY pl.planId, pl.name;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q3_CON', 'BASIC +ROWS +COST'));
EXEC sp_medir('Q3c ingresos 7 días, con ix_payments_paidat', 'SELECT pl.planId, NVL(SUM(v.amount), 0) total, COUNT(v.subscriptionId) n FROM PLANS pl LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL ''7'' DAY AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP) GROUP BY pl.planId', 50);

-- Rango de un año: casi todos los pagos. El índice ya no conviene y el
-- optimizador vuelve a leer las tablas completas.
PROMPT
PROMPT ===== Q3d informe de ingresos de un año =====
EXPLAIN PLAN SET STATEMENT_ID = 'Q3_ANIO' FOR
SELECT pl.planId, pl.name, NVL(SUM(v.amount), 0) total
  FROM PLANS pl
  LEFT JOIN vw_payments_by_plan v ON v.planId = pl.planId
   AND v.paidAt >= SYS_EXTRACT_UTC(SYSTIMESTAMP) - INTERVAL '365' DAY(3) AND v.paidAt < SYS_EXTRACT_UTC(SYSTIMESTAMP)
 GROUP BY pl.planId, pl.name;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'Q3_ANIO', 'BASIC +ROWS +COST'));

DROP PROCEDURE sp_medir;
