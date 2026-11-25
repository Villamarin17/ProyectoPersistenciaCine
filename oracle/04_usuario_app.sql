-- =====================================================================
-- CineConecta - Usuario de la aplicación con privilegios mínimos
-- La aplicación no modifica tablas directamente: solo lee y ejecuta
-- los procedimientos. Así ningún error o ataque desde la aplicación
-- puede insertar una suscripción sin pago o saltarse las reglas.
--
-- Parte 1 (como usuario administrador, p. ej. SYSTEM). En la instancia
-- ESTUD del curso normalmente no hay permiso para crear usuarios: en ese
-- caso la aplicación usa el usuario asignado y se omite este script.
-- =====================================================================
-- CREATE USER CINECONECTA_APP IDENTIFIED BY "<contraseña segura>";
-- GRANT CREATE SESSION TO CINECONECTA_APP;

-- Parte 2 (como dueño del esquema, CINECONECTA)
-- ACCOUNTS: inicio de sesión (hash) y nombre del titular
GRANT SELECT ON ACCOUNTS TO CINECONECTA_APP;
GRANT SELECT ON PROFILES TO CINECONECTA_APP;
GRANT SELECT ON PLANS TO CINECONECTA_APP;
GRANT SELECT ON vw_active_subscription TO CINECONECTA_APP;
GRANT SELECT ON vw_profile_access TO CINECONECTA_APP;
GRANT SELECT ON vw_account_subscriptions TO CINECONECTA_APP;
GRANT SELECT ON vw_payments_by_plan TO CINECONECTA_APP;
GRANT EXECUTE ON sp_register_account TO CINECONECTA_APP;
GRANT EXECUTE ON sp_purchase_subscription TO CINECONECTA_APP;
GRANT EXECUTE ON sp_create_profile TO CINECONECTA_APP;
GRANT EXECUTE ON sp_set_profile_active TO CINECONECTA_APP;
-- Sin INSERT, UPDATE ni DELETE sobre ninguna tabla.
-- La aplicación ejecuta ALTER SESSION SET CURRENT_SCHEMA = CINECONECTA al conectarse
-- (variable ORACLE_SCHEMA del archivo .env).
