-- =====================================================================
-- CineConecta - Datos de prueba relacionales
-- Las fechas son relativas al momento de la carga, así las suscripciones
-- "vigentes" lo siguen siendo al presentar. Contraseña de todas las
-- cuentas: Cine2026!  (hash bcrypt, costo 10)
-- Los ids < 1000 coinciden con los datos de prueba de MongoDB.
--
--  Cuenta  Situación                                         Uso en la sustentación
--  1 Ana   Básico vencida + Estándar vigente; perfil inactivo flujo normal, historial bajo 2 planes
--  2 Bruno Premium vencida; 2 perfiles activos                rechazo por suscripción vencida;
--                                                             no puede contratar Básico sin desactivar
--  3 Carla Básico vigente con 1 perfil (el máximo)            rechazo por máximo de perfiles
--  4 Diego sin suscripción ni perfiles                        flujo completo desde cero
--  5 Elena Estándar y Premium vencidas + Premium vigente      sesiones bajo distintos planes
-- =====================================================================
DECLARE
  v_now  TIMESTAMP := SYS_EXTRACT_UTC(SYSTIMESTAMP);
  v_hash VARCHAR2(100) := '$2a$10$9MxnLVD6ke0Ydl4xgDT8C.K5DnoZfqrPrq1mSRDT.qMu0PSoZMARG';

  PROCEDURE sub (p_id INTEGER, p_account INTEGER, p_plan INTEGER, p_days_ago NUMBER) IS
    v_start TIMESTAMP := v_now - NUMTODSINTERVAL(p_days_ago, 'DAY');
    v_price NUMBER;
  BEGIN
    SELECT price INTO v_price FROM PLANS WHERE planId = p_plan;
    INSERT INTO SUBSCRIPTIONS (subscriptionId, accountId, planId, startsAt, endsAt)
    VALUES (p_id, p_account, p_plan, v_start, v_start + INTERVAL '30' DAY);
    INSERT INTO PAYMENTS (paymentId, subscriptionId, paidAt, amount, reference)
    VALUES (p_id, p_id, v_start, v_price, 'PAY-SEED-' || p_id);
  END;
BEGIN
  INSERT INTO PLANS (planId, name, price, maxProfiles) VALUES (1, 'Básico',   16900, 1);
  INSERT INTO PLANS (planId, name, price, maxProfiles) VALUES (2, 'Estándar', 26900, 3);
  INSERT INTO PLANS (planId, name, price, maxProfiles) VALUES (3, 'Premium',  38900, 5);

  INSERT INTO ACCOUNTS VALUES (1, 'Ana Gómez',    'ana@cineconecta.test',   v_hash, v_now - INTERVAL '90' DAY);
  INSERT INTO ACCOUNTS VALUES (2, 'Bruno Díaz',   'bruno@cineconecta.test', v_hash, v_now - INTERVAL '60' DAY);
  INSERT INTO ACCOUNTS VALUES (3, 'Carla Ruiz',   'carla@cineconecta.test', v_hash, v_now - INTERVAL '10' DAY);
  INSERT INTO ACCOUNTS VALUES (4, 'Diego Mora',   'diego@cineconecta.test', v_hash, v_now - INTERVAL '1' DAY);
  INSERT INTO ACCOUNTS VALUES (5, 'Elena Vargas', 'elena@cineconecta.test', v_hash, v_now - INTERVAL '100' DAY(3));

  -- Suscripciones (id, cuenta, plan, hace cuántos días empezó) y su pago
  sub(10, 1, 1, 70);   -- Ana, Básico, vencida
  sub(11, 1, 2, 10);   -- Ana, Estándar, vigente
  sub(20, 2, 3, 45);   -- Bruno, Premium, vencida
  sub(30, 3, 1, 5);    -- Carla, Básico, vigente
  sub(50, 5, 2, 80);   -- Elena, Estándar, vencida
  sub(51, 5, 3, 40);   -- Elena, Premium, vencida
  sub(52, 5, 3, 3);    -- Elena, Premium, vigente

  INSERT INTO PROFILES VALUES (101, 1, 'Ana',      18, 'Y');
  INSERT INTO PROFILES VALUES (102, 1, 'Niños',     7, 'Y');
  INSERT INTO PROFILES VALUES (103, 1, 'Invitado', 16, 'N');
  INSERT INTO PROFILES VALUES (201, 2, 'Bruno',    18, 'Y');
  INSERT INTO PROFILES VALUES (202, 2, 'Sofía',    12, 'Y');
  INSERT INTO PROFILES VALUES (301, 3, 'Carla',    16, 'Y');
  INSERT INTO PROFILES VALUES (501, 5, 'Elena',    18, 'Y');
  INSERT INTO PROFILES VALUES (502, 5, 'Mateo',    12, 'Y');
  INSERT INTO PROFILES VALUES (503, 5, 'Lucía',     7, 'Y');
  INSERT INTO PROFILES VALUES (504, 5, 'Abuela',   18, 'Y');
  COMMIT;
END;
/

-- Verificación rápida
COLUMN fullName FORMAT A15
COLUMN planName FORMAT A10
SET LINESIZE 120
SELECT a.accountId, a.fullName, s.subscriptionId, s.planName,
       CASE WHEN v.subscriptionId IS NOT NULL THEN 'VIGENTE' ELSE 'VENCIDA' END AS estado
  FROM ACCOUNTS a
  LEFT JOIN vw_account_subscriptions s ON s.accountId = a.accountId
  LEFT JOIN vw_active_subscription v ON v.subscriptionId = s.subscriptionId
 ORDER BY a.accountId, s.subscriptionId;
