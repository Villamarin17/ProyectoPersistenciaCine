-- =====================================================================
-- CineConecta - Demostraciones para la sustentación desde SQL Developer
-- Equivalen a los scripts app/demos/*.js. Ejecutar como dueño del esquema.
-- Cada bloque se ejecuta con F5 (ejecutar script) y SET SERVEROUTPUT ON.
-- =====================================================================
SET SERVEROUTPUT ON

-- ---------------------------------------------------------------------
-- A. Fallo antes de completar pago y suscripción
--    El procedimiento inserta la suscripción y falla antes del pago.
-- ---------------------------------------------------------------------
DECLARE
  v_account INTEGER; v_sub INTEGER;
BEGIN
  sp_register_account('Demo fallo', 'demo.fallo.' || TO_CHAR(SYSTIMESTAMP, 'HH24MISSFF3') || '@cineconecta.test',
                      '$2a$10$9MxnLVD6ke0Ydl4xgDT8C.K5DnoZfqrPrq1mSRDT.qMu0PSoZMARG', v_account);
  DBMS_OUTPUT.PUT_LINE('Cuenta de prueba: ' || v_account);
  BEGIN
    sp_purchase_subscription(v_account, 1, 'Y', 'DEMO-FALLO-' || v_account, v_sub, p_simulate_failure => 'Y');
  EXCEPTION WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('Error recibido: ' || SQLERRM);
  END;
END;
/
-- Comprobación: la última cuenta de prueba no tiene suscripciones ni pagos
SELECT a.accountId, a.fullName,
       (SELECT COUNT(*) FROM SUBSCRIPTIONS s WHERE s.accountId = a.accountId) AS suscripciones,
       (SELECT COUNT(*) FROM PAYMENTS p JOIN SUBSCRIPTIONS s ON s.subscriptionId = p.subscriptionId
         WHERE s.accountId = a.accountId) AS pagos
  FROM ACCOUNTS a
 WHERE a.accountId = (SELECT MAX(accountId) FROM ACCOUNTS WHERE fullName = 'Demo fallo');

-- ---------------------------------------------------------------------
-- B. Dos contrataciones simultáneas para la misma cuenta
--    1. Cree la cuenta con este bloque y anote su id.
-- ---------------------------------------------------------------------
DECLARE v_account INTEGER;
BEGIN
  sp_register_account('Demo concurrencia', 'demo.conc.' || TO_CHAR(SYSTIMESTAMP, 'HH24MISSFF3') || '@cineconecta.test',
                      '$2a$10$9MxnLVD6ke0Ydl4xgDT8C.K5DnoZfqrPrq1mSRDT.qMu0PSoZMARG', v_account);
  DBMS_OUTPUT.PUT_LINE('Cuenta de prueba: ' || v_account);
END;
/
--    2. Abra DOS hojas de trabajo de SQL Developer con conexiones separadas
--       (clic derecho en la conexión > Abrir hoja de trabajo no compartida, Ctrl+Shift+N).
--    3. En la hoja 1 ejecute este bloque (espera 20 s con la cuenta bloqueada):
--
--       DECLARE v INTEGER;
--       BEGIN
--         sp_purchase_subscription(&cuenta, 2, 'Y', 'DEMO-A-' || &cuenta, v, p_delay_seconds => 20);
--         DBMS_OUTPUT.PUT_LINE('Hoja 1: suscripción ' || v);
--       END;
--       /
--
--    4. Antes de que terminen los 20 s, en la hoja 2 ejecute:
--
--       DECLARE v INTEGER;
--       BEGIN
--         sp_purchase_subscription(&cuenta, 3, 'Y', 'DEMO-B-' || &cuenta, v);
--         DBMS_OUTPUT.PUT_LINE('Hoja 2: suscripción ' || v);
--       END;
--       /
--
--       La hoja 2 queda esperando el bloqueo. Cuando la hoja 1 confirma, la hoja 2
--       recibe ORA-20022 (la cuenta ya tiene una suscripción vigente).
--    5. Comprobación: una sola suscripción, con su pago, y ningún período superpuesto.
SELECT * FROM vw_account_subscriptions
 WHERE accountId = (SELECT MAX(accountId) FROM ACCOUNTS WHERE fullName = 'Demo concurrencia');

SELECT COUNT(*) AS periodos_superpuestos
  FROM SUBSCRIPTIONS a JOIN SUBSCRIPTIONS b
    ON a.accountId = b.accountId AND a.subscriptionId < b.subscriptionId
 WHERE a.startsAt < b.endsAt AND b.startsAt < a.endsAt;

-- ---------------------------------------------------------------------
-- C. Verificaciones generales de integridad para mostrar en la sustentación
-- ---------------------------------------------------------------------
-- Suscripciones sin pago (debe ser 0)
SELECT COUNT(*) AS suscripciones_sin_pago
  FROM SUBSCRIPTIONS s WHERE NOT EXISTS (SELECT 1 FROM PAYMENTS p WHERE p.subscriptionId = s.subscriptionId);
-- Cuentas con más perfiles activos que los del plan vigente (debe ser 0)
SELECT a.accountId, a.maxProfiles, COUNT(*) AS activos
  FROM vw_active_subscription a JOIN PROFILES p ON p.accountId = a.accountId AND p.isActive = 'Y'
 GROUP BY a.accountId, a.maxProfiles
HAVING COUNT(*) > a.maxProfiles;
