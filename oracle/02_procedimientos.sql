-- =====================================================================
-- CineConecta - Procedimientos almacenados
-- Cada procedimiento es una transacción: confirma al final y revierte
-- todo ante cualquier error. Las operaciones de una misma cuenta se
-- serializan bloqueando su fila de ACCOUNTS (SELECT ... FOR UPDATE).
--
-- Errores de negocio (RAISE_APPLICATION_ERROR):
--   -20010 correo ya registrado            -20030 sin suscripción vigente para crear perfil
--   -20020 pago rechazado                  -20031 se alcanzó el máximo de perfiles del plan
--   -20021 cuenta inexistente              -20032 nombre de perfil repetido en la cuenta
--   -20022 ya existe suscripción vigente   -20033 el perfil no pertenece a la cuenta
--   -20023 plan inexistente                -20034 edad máxima fuera de rango
--   -20024 perfiles activos > plan nuevo   -20029 fallo simulado (demostración)
-- =====================================================================

-- Espera activa usada solo en las demostraciones de concurrencia.
-- No usa DBMS_LOCK/DBMS_SESSION para no depender de permisos adicionales.
CREATE OR REPLACE PROCEDURE sp_demo_wait (p_seconds IN NUMBER) AS
  v_end TIMESTAMP := SYSTIMESTAMP + NUMTODSINTERVAL(NVL(p_seconds, 0), 'SECOND');
BEGIN
  WHILE SYSTIMESTAMP < v_end LOOP
    NULL;
  END LOOP;
END;
/

CREATE OR REPLACE PROCEDURE sp_register_account (
  p_fullName      IN  VARCHAR2,
  p_email         IN  VARCHAR2,
  p_passwordHash  IN  VARCHAR2,
  o_accountId     OUT INTEGER
) AS
BEGIN
  o_accountId := seq_accounts.NEXTVAL;
  INSERT INTO ACCOUNTS (accountId, fullName, email, passwordHash, createdAt)
  VALUES (o_accountId, TRIM(p_fullName), LOWER(TRIM(p_email)), p_passwordHash, SYS_EXTRACT_UTC(SYSTIMESTAMP));
  COMMIT;
EXCEPTION
  WHEN DUP_VAL_ON_INDEX THEN
    ROLLBACK;
    RAISE_APPLICATION_ERROR(-20010, 'Ya existe una cuenta con ese correo.');
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
/

-- Contratación: pago aprobado + suscripción de 30 días en una sola transacción.
CREATE OR REPLACE PROCEDURE sp_purchase_subscription (
  p_accountId         IN  INTEGER,
  p_planId            IN  INTEGER,
  p_approved          IN  CHAR,
  p_reference         IN  VARCHAR2,
  o_subscriptionId    OUT INTEGER,
  p_simulate_failure  IN  CHAR   DEFAULT 'N',
  p_delay_seconds     IN  NUMBER DEFAULT 0
) AS
  v_account      INTEGER;
  v_now          TIMESTAMP := SYS_EXTRACT_UTC(SYSTIMESTAMP);
  v_price        PLANS.price%TYPE;
  v_maxProfiles  PLANS.maxProfiles%TYPE;
  v_current      INTEGER;
  v_active       INTEGER;
BEGIN
  -- Un pago rechazado no registra nada
  IF NVL(p_approved, 'N') <> 'Y' THEN
    RAISE_APPLICATION_ERROR(-20020, 'Pago rechazado: no se registró la suscripción.');
  END IF;

  -- Bloquea la cuenta: una segunda contratación simultánea espera aquí
  BEGIN
    SELECT accountId INTO v_account FROM ACCOUNTS WHERE accountId = p_accountId FOR UPDATE;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20021, 'La cuenta no existe.');
  END;

  sp_demo_wait(p_delay_seconds);
  v_now := SYS_EXTRACT_UTC(SYSTIMESTAMP);

  -- Sin períodos superpuestos: la nueva empieza ahora, así que no puede
  -- existir otra suscripción que termine después de este instante
  SELECT COUNT(*) INTO v_current FROM SUBSCRIPTIONS
   WHERE accountId = p_accountId AND endsAt > v_now;
  IF v_current > 0 THEN
    RAISE_APPLICATION_ERROR(-20022, 'La cuenta ya tiene una suscripción vigente.');
  END IF;

  BEGIN
    SELECT price, maxProfiles INTO v_price, v_maxProfiles FROM PLANS WHERE planId = p_planId;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20023, 'El plan no existe.');
  END;

  SELECT COUNT(*) INTO v_active FROM PROFILES WHERE accountId = p_accountId AND isActive = 'Y';
  IF v_active > v_maxProfiles THEN
    RAISE_APPLICATION_ERROR(-20024, 'El plan admite ' || v_maxProfiles || ' perfiles activos y la cuenta tiene '
      || v_active || '. Desactive ' || (v_active - v_maxProfiles) || ' antes de contratarlo.');
  END IF;

  o_subscriptionId := seq_subscriptions.NEXTVAL;
  INSERT INTO SUBSCRIPTIONS (subscriptionId, accountId, planId, startsAt, endsAt)
  VALUES (o_subscriptionId, p_accountId, p_planId, v_now, v_now + INTERVAL '30' DAY);

  IF p_simulate_failure = 'Y' THEN
    RAISE_APPLICATION_ERROR(-20029, 'Fallo simulado después de insertar la suscripción y antes del pago.');
  END IF;

  INSERT INTO PAYMENTS (paymentId, subscriptionId, paidAt, amount, reference)
  VALUES (seq_payments.NEXTVAL, o_subscriptionId, v_now, v_price, p_reference);

  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;   -- ni suscripción ni pago quedan registrados
    RAISE;
END;
/

CREATE OR REPLACE PROCEDURE sp_create_profile (
  p_accountId      IN  INTEGER,
  p_name           IN  VARCHAR2,
  p_maxAgeRating   IN  INTEGER,
  o_profileId      OUT INTEGER,
  p_delay_seconds  IN  NUMBER DEFAULT 0
) AS
  v_account      INTEGER;
  v_maxProfiles  INTEGER;
  v_active       INTEGER;
BEGIN
  IF p_maxAgeRating IS NULL OR p_maxAgeRating NOT BETWEEN 0 AND 18 THEN
    RAISE_APPLICATION_ERROR(-20034, 'La edad máxima debe estar entre 0 y 18.');
  END IF;
  BEGIN
    SELECT accountId INTO v_account FROM ACCOUNTS WHERE accountId = p_accountId FOR UPDATE;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20021, 'La cuenta no existe.');
  END;

  sp_demo_wait(p_delay_seconds);

  BEGIN
    SELECT maxProfiles INTO v_maxProfiles FROM vw_active_subscription WHERE accountId = p_accountId;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20030, 'Para crear perfiles se requiere una suscripción vigente.');
  END;

  SELECT COUNT(*) INTO v_active FROM PROFILES WHERE accountId = p_accountId AND isActive = 'Y';
  IF v_active >= v_maxProfiles THEN
    RAISE_APPLICATION_ERROR(-20031, 'El plan vigente permite ' || v_maxProfiles || ' perfiles activos.');
  END IF;

  o_profileId := seq_profiles.NEXTVAL;
  INSERT INTO PROFILES (profileId, accountId, name, maxAgeRating, isActive)
  VALUES (o_profileId, p_accountId, TRIM(p_name), p_maxAgeRating, 'Y');
  COMMIT;
EXCEPTION
  WHEN DUP_VAL_ON_INDEX THEN
    ROLLBACK;
    RAISE_APPLICATION_ERROR(-20032, 'Ya existe un perfil con ese nombre en la cuenta.');
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
/

-- Activa o desactiva un perfil. Desactivar conserva su actividad histórica.
CREATE OR REPLACE PROCEDURE sp_set_profile_active (
  p_accountId  IN INTEGER,
  p_profileId  IN INTEGER,
  p_active     IN CHAR
) AS
  v_account      INTEGER;
  v_owner        INTEGER;
  v_maxProfiles  INTEGER;
  v_active       INTEGER;
BEGIN
  BEGIN
    SELECT accountId INTO v_account FROM ACCOUNTS WHERE accountId = p_accountId FOR UPDATE;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20021, 'La cuenta no existe.');
  END;
  BEGIN
    SELECT accountId INTO v_owner FROM PROFILES WHERE profileId = p_profileId AND accountId = p_accountId;
  EXCEPTION WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20033, 'El perfil no pertenece a la cuenta.');
  END;

  IF p_active = 'Y' THEN
    BEGIN
      SELECT maxProfiles INTO v_maxProfiles FROM vw_active_subscription WHERE accountId = p_accountId;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20030, 'Para activar perfiles se requiere una suscripción vigente.');
    END;
    SELECT COUNT(*) INTO v_active FROM PROFILES
     WHERE accountId = p_accountId AND isActive = 'Y' AND profileId <> p_profileId;
    IF v_active >= v_maxProfiles THEN
      RAISE_APPLICATION_ERROR(-20031, 'El plan vigente permite ' || v_maxProfiles || ' perfiles activos.');
    END IF;
  END IF;

  UPDATE PROFILES SET isActive = CASE WHEN p_active = 'Y' THEN 'Y' ELSE 'N' END
   WHERE profileId = p_profileId;
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
/
