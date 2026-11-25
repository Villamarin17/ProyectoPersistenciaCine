-- Quita los datos de volumen (ids desde 5.000.000) y deja solo los datos de prueba
DELETE FROM PAYMENTS WHERE paymentId > 5000000;
DELETE FROM SUBSCRIPTIONS WHERE subscriptionId > 5000000;
DELETE FROM PROFILES WHERE profileId > 5000000;
DELETE FROM ACCOUNTS WHERE accountId > 5000000;
COMMIT;
