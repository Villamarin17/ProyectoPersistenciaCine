# Evidencias de optimización

## Datos de prueba

| Base | Script | Volumen |
|---|---|---|
| Oracle | `oracle/05_volumen.sql` | 20.000 cuentas, 20.000 perfiles, 200.000 suscripciones y 200.000 pagos |
| MongoDB | `mongo/04_volumen.js` | 200.000 sesiones de visualización (una por suscripción de volumen) |

Cada cuenta de volumen tiene 10 suscripciones consecutivas de 30 días sin superposición. Los inicios se reparten en los 30 días del mes, de modo que los pagos y las sesiones quedan distribuidos en el tiempo (unos 670 por día). Las sesiones usan los mismos `accountId`, `profileId`, `subscriptionId` y `planId` de Oracle y caen dentro del período de su suscripción. Los ids de volumen empiezan en 5.000.000 y se borran con `oracle/05b_borrar_volumen.sql` y `db.viewingSessions.deleteMany({ accountId: { $gt: 5000000 } })`.

## Método

En Oracle cada índice se vuelve invisible con `ALTER INDEX ... INVISIBLE` y luego visible. El plan se obtiene con `EXPLAIN PLAN` y `DBMS_XPLAN.DISPLAY`, y el tiempo es el promedio de 50 a 200 ejecuciones medido con `SYSTIMESTAMP` dentro de PL/SQL. Las estadísticas se recogen con `DBMS_STATS.GATHER_SCHEMA_STATS` al final de la carga.

En MongoDB la versión sin índice se fuerza con `hint({ $natural: 1 })`, que obliga a recorrer la colección, y la versión con índice deja elegir al planificador. El índice simple se crea temporalmente y se borra al terminar. El plan y los contadores salen de `explain("executionStats")` y el tiempo es el promedio de 20 ejecuciones desde mongosh.

Así la comparación se hace siempre sobre los mismos datos. Las salidas completas están en `docs/evidencias/oracle_06_salida.txt` y `docs/evidencias/mongo_05_salida.txt`. Las mediciones se tomaron con Oracle AI Database 26ai Free y MongoDB 8.0 en un mismo equipo; en ESTUD y Atlas los tiempos cambian, pero los planes y los contadores de lecturas deben ser los mismos.

## Oracle

### Q1. Suscripción vigente de una cuenta

Consulta: `SELECT * FROM vw_active_subscription WHERE accountId = :id`. La usan la autorización de reproducción, la creación y activación de perfiles y la compra (control de superposición).

| | Plan | Costo | Tiempo promedio |
|---|---|---|---|
| Sin índice | TABLE ACCESS FULL SUBSCRIPTIONS | 344 | 2,199 ms |
| Con `ix_subs_account_period (accountId, endsAt, startsAt)` | INDEX RANGE SCAN IX_SUBS_ACCOUNT_PERIOD | 5 | 0,011 ms |

Las tres columnas del índice aparecen en el predicado de acceso: `accountId` por igualdad y `endsAt > ahora` por rango. Se pone `endsAt` antes que `startsAt` porque la condición `endsAt > ahora` es la que descarta las suscripciones vencidas, que son la mayoría del historial de una cuenta.

### Q2. Historial de suscripciones y pagos de una cuenta

Consulta: `SELECT * FROM vw_account_subscriptions WHERE accountId = :id` (página Mi cuenta). Usa el mismo índice.

| | Tiempo promedio |
|---|---|
| Sin índice | 2,332 ms |
| Con `ix_subs_account_period` | 0,011 ms |

### Q3. Informe de ingresos por plan (últimos 7 días, unos 4.800 pagos)

Es la consulta del informe de la aplicación sobre `PLANS LEFT JOIN vw_payments_by_plan`.

| | Acceso a PAYMENTS | Costo | Tiempo promedio |
|---|---|---|---|
| Sin índice | TABLE ACCESS FULL | 734 | 15,2 ms |
| Índice simple `(paidAt)` | TABLE ACCESS FULL (el optimizador no lo usa) | 734 | igual |
| `ix_payments_paidat (paidAt, subscriptionId, amount)` | INDEX RANGE SCAN, sin leer la tabla | 372 | 8,3 ms |

El índice simple sobre `paidAt` no se usa: los pagos se insertan en orden de cuenta y no de fecha, así que leer 4.800 filas por rowid cuesta más que recorrer la tabla. El índice definitivo agrega `subscriptionId` y `amount`, que son las otras columnas de PAYMENTS que necesita el informe; con eso la consulta se resuelve solo con el índice. Para lograrlo, el informe cuenta `subscriptionId` y no `paymentId` (el resultado es el mismo porque cada suscripción tiene un solo pago).

Con un rango de un año (todos los pagos) el optimizador recorre el índice completo con INDEX FAST FULL SCAN, que sigue siendo más barato que leer la tabla porque el índice es más pequeño.

## MongoDB

### Q1. Informe de consumo por plan y tipo de contenido

Es la agregación de la aplicación: `$match` por `startedAt`, `$group` por `planId` y `contentType` con suma de `watchedSec`, conjunto de `profileId` y conteo de sesiones.

| Últimos 7 días (11.371 sesiones) | Plan | Claves examinadas | Documentos examinados | Promedio 7 días | Promedio un año |
|---|---|---|---|---|---|
| Sin índice | COLLSCAN | 0 | 200.087 | 85,3 ms | 183,2 ms |
| Índice simple `{ startedAt, planId, contentType }` | IXSCAN + FETCH | 11.371 | 11.371 | 34,0 ms | 591,0 ms |
| `ix_sessions_report { startedAt, planId, contentType, profileId, watchedSec }` | IXSCAN + PROJECTION_COVERED | 11.371 | 0 | 9,1 ms | 138,2 ms |

El índice simple, que era el del modelo de la primera entrega, mejora el rango corto pero empeora el informe de un año: trae los 200.000 documentos uno por uno siguiendo el índice y resulta tres veces más lento que el recorrido completo. Al agregar `profileId` y `watchedSec` el índice contiene todos los campos que usa la agregación (consulta cubierta) y no se lee ningún documento, lo que mejora los dos rangos. El costo es poco: el índice ocupa unos 6 MB para 200.000 sesiones.

### Q2. Cierre de sesiones interrumpidas

La aplicación busca cada minuto `{ status: "active", lastHeartbeatAt: { $lt: hace 2 minutos } }`.

| | Plan | Documentos examinados | Tiempo promedio |
|---|---|---|---|
| Sin índice | COLLSCAN | 200.087 | 85,6 ms |
| `ix_sessions_open` parcial (`status = "active"`) | IXSCAN + FETCH | 0 | 1,6 ms |

El índice es parcial: solo guarda las sesiones activas, que son pocas en cualquier momento. Ocupa 32 KB frente a unos 6 MB de un índice completo, y las sesiones terminadas salen de él cuando cambian de estado.

### Índice retirado

El modelo de la primera entrega tenía `ix_sessions_profile { profileId, startedAt }` para consultar el historial de un perfil. La aplicación final no tiene esa consulta (Continuar viendo se resuelve con `playbackProgress`), así que se retiró. Con 200.000 sesiones ocupaba 5,8 MB y se actualizaba en cada inserción sin aportar a ninguna lectura.
