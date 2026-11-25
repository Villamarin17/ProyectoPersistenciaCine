-- =====================================================================
-- CineConecta - Borra los objetos del esquema (solo para reinstalar)
-- Ejecutar como el usuario dueño del esquema.
-- =====================================================================
BEGIN
  FOR o IN (SELECT object_name, object_type FROM user_objects
             WHERE object_type IN ('VIEW', 'PROCEDURE', 'SEQUENCE')
               AND (object_name LIKE 'VW\_%' ESCAPE '\' OR object_name LIKE 'SP\_%' ESCAPE '\'
                    OR object_name LIKE 'SEQ\_%' ESCAPE '\')) LOOP
    EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' ' || o.object_name;
  END LOOP;
  FOR t IN (SELECT table_name FROM user_tables
             WHERE table_name IN ('PAYMENTS', 'SUBSCRIPTIONS', 'PROFILES', 'PLANS', 'ACCOUNTS')
             ORDER BY DECODE(table_name, 'PAYMENTS', 1, 'SUBSCRIPTIONS', 2, 'PROFILES', 3, 'PLANS', 4, 5)) LOOP
    EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
  END LOOP;
END;
/
