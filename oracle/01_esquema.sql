-- =====================================================================
-- CineConecta - Esquema relacional (Oracle 19c o superior)
-- Tablas y columnas del modelo suministrado, sin cambios estructurales.
-- Se agregan restricciones CHECK, secuencias, índices y vistas.
-- Todas las fechas se guardan en UTC: SYS_EXTRACT_UTC(SYSTIMESTAMP).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas del modelo suministrado
-- ---------------------------------------------------------------------
CREATE TABLE ACCOUNTS (
  accountId     INTEGER        NOT NULL,
  fullName      VARCHAR2(150)  NOT NULL,
  email         VARCHAR2(254)  NOT NULL,
  passwordHash  VARCHAR2(255)  NOT NULL,
  createdAt     TIMESTAMP      NOT NULL,
  CONSTRAINT pk_accounts PRIMARY KEY (accountId)
);
CREATE UNIQUE INDEX ux_accounts_email_ci ON ACCOUNTS (LOWER(email));

CREATE TABLE PLANS (
  planId       INTEGER        NOT NULL,
  name         VARCHAR2(60)   NOT NULL,
  price        NUMBER(12,2)   NOT NULL,
  maxProfiles  INTEGER        NOT NULL,
  CONSTRAINT pk_plans PRIMARY KEY (planId),
  CONSTRAINT uq_plans_name UNIQUE (name)
);

CREATE TABLE PROFILES (
  profileId     INTEGER       NOT NULL,
  accountId     INTEGER       NOT NULL,
  name          VARCHAR2(60)  NOT NULL,
  maxAgeRating  INTEGER       NOT NULL,
  isActive      CHAR(1)       NOT NULL,
  CONSTRAINT pk_profiles PRIMARY KEY (profileId),
  CONSTRAINT fk_profiles_account FOREIGN KEY (accountId) REFERENCES ACCOUNTS (accountId)
);
CREATE UNIQUE INDEX ux_profiles_name_ci ON PROFILES (accountId, LOWER(name));

CREATE TABLE SUBSCRIPTIONS (
  subscriptionId  INTEGER    NOT NULL,
  accountId       INTEGER    NOT NULL,
  planId          INTEGER    NOT NULL,
  startsAt        TIMESTAMP  NOT NULL,
  endsAt          TIMESTAMP  NOT NULL,
  CONSTRAINT pk_subscriptions PRIMARY KEY (subscriptionId),
  CONSTRAINT fk_subs_account FOREIGN KEY (accountId) REFERENCES ACCOUNTS (accountId),
  CONSTRAINT fk_subs_plan FOREIGN KEY (planId) REFERENCES PLANS (planId)
);

CREATE TABLE PAYMENTS (
  paymentId       INTEGER        NOT NULL,
  subscriptionId  INTEGER        NOT NULL,
  paidAt          TIMESTAMP      NOT NULL,
  amount          NUMBER(12,2)   NOT NULL,
  reference       VARCHAR2(100)  NOT NULL,
  CONSTRAINT pk_payments PRIMARY KEY (paymentId),
  CONSTRAINT uq_payments_subscription UNIQUE (subscriptionId),
  CONSTRAINT uq_payments_reference UNIQUE (reference),
  CONSTRAINT fk_payments_subscription FOREIGN KEY (subscriptionId) REFERENCES SUBSCRIPTIONS (subscriptionId)
);

-- ---------------------------------------------------------------------
-- Restricciones agregadas
-- ---------------------------------------------------------------------
ALTER TABLE ACCOUNTS ADD CONSTRAINT ck_accounts_email
  CHECK (REGEXP_LIKE(email, '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
ALTER TABLE PLANS ADD CONSTRAINT ck_plans_price CHECK (price > 0);
ALTER TABLE PLANS ADD CONSTRAINT ck_plans_maxprofiles CHECK (maxProfiles >= 1);
ALTER TABLE PROFILES ADD CONSTRAINT ck_profiles_isactive CHECK (isActive IN ('Y', 'N'));
ALTER TABLE PROFILES ADD CONSTRAINT ck_profiles_age CHECK (maxAgeRating BETWEEN 0 AND 18);
ALTER TABLE SUBSCRIPTIONS ADD CONSTRAINT ck_subs_30_days CHECK (endsAt = startsAt + INTERVAL '30' DAY);
ALTER TABLE PAYMENTS ADD CONSTRAINT ck_payments_amount CHECK (amount > 0);

-- ---------------------------------------------------------------------
-- Secuencias (los ids nunca se reutilizan; los datos de prueba usan ids < 1000)
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_accounts      START WITH 1000 NOCACHE;
CREATE SEQUENCE seq_profiles      START WITH 1000 NOCACHE;
CREATE SEQUENCE seq_subscriptions START WITH 1000 NOCACHE;
CREATE SEQUENCE seq_payments      START WITH 1000 NOCACHE;

-- ---------------------------------------------------------------------
-- Índices agregados
-- ---------------------------------------------------------------------
-- Vigencia de la suscripción por cuenta y control de superposición
CREATE INDEX ix_subs_account_period ON SUBSCRIPTIONS (accountId, endsAt, startsAt);
-- Llave foránea hacia PLANS
CREATE INDEX ix_subs_plan ON SUBSCRIPTIONS (planId);
-- Conteo de perfiles activos por cuenta
CREATE INDEX ix_profiles_account_active ON PROFILES (accountId, isActive);
-- Informe de ingresos por rango de fechas. Incluye subscriptionId y amount para
-- resolver el informe sin leer la tabla (ver oracle/06_optimizacion.sql)
CREATE INDEX ix_payments_paidat ON PAYMENTS (paidAt, subscriptionId, amount);

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
-- Suscripción vigente de cada cuenta: incluye startsAt y excluye endsAt
CREATE OR REPLACE VIEW vw_active_subscription AS
SELECT s.subscriptionId, s.accountId, s.planId, p.name AS planName, p.maxProfiles,
       s.startsAt, s.endsAt
  FROM SUBSCRIPTIONS s
  JOIN PLANS p ON p.planId = s.planId
 WHERE s.startsAt <= SYS_EXTRACT_UTC(SYSTIMESTAMP)
   AND s.endsAt   >  SYS_EXTRACT_UTC(SYSTIMESTAMP);

-- Datos de Oracle que necesita la autorización de reproducción.
-- subscriptionId es NULL si la cuenta no tiene suscripción vigente.
CREATE OR REPLACE VIEW vw_profile_access AS
SELECT pr.profileId, pr.accountId, pr.name AS profileName, pr.maxAgeRating, pr.isActive,
       a.subscriptionId, a.planId, a.planName, a.endsAt
  FROM PROFILES pr
  LEFT JOIN vw_active_subscription a ON a.accountId = pr.accountId;

-- Historial de suscripciones y pagos de una cuenta
CREATE OR REPLACE VIEW vw_account_subscriptions AS
SELECT s.subscriptionId, s.accountId, s.planId, pl.name AS planName, s.startsAt, s.endsAt,
       pa.paymentId, pa.paidAt, pa.amount, pa.reference
  FROM SUBSCRIPTIONS s
  JOIN PLANS pl ON pl.planId = s.planId
  LEFT JOIN PAYMENTS pa ON pa.subscriptionId = s.subscriptionId;

-- Base del informe de ingresos por plan
CREATE OR REPLACE VIEW vw_payments_by_plan AS
SELECT pa.paymentId, pa.paidAt, pa.amount, s.subscriptionId, s.planId, pl.name AS planName
  FROM PAYMENTS pa
  JOIN SUBSCRIPTIONS s ON s.subscriptionId = pa.subscriptionId
  JOIN PLANS pl ON pl.planId = s.planId;
