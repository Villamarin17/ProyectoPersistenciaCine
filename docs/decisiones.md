# Decisiones de persistencia, integración e índices

## Qué guarda cada base

| Oracle (relacional) | MongoDB (documental) |
|---|---|
| ACCOUNTS, PROFILES, PLANS, SUBSCRIPTIONS, PAYMENTS | contents, viewingSessions, playbackProgress, watchlist, admins, counters |

Oracle guarda los datos de negocio que necesitan integridad referencial y transacciones con bloqueo: cuentas, perfiles, planes, suscripciones y pagos. Una suscripción sin pago, dos períodos superpuestos o más perfiles activos que los del plan son errores que deben ser imposibles, y Oracle los impide con llaves, restricciones y procedimientos que bloquean la cuenta antes de validar.

MongoDB guarda el catálogo y la actividad de visualización. Una película, una serie y un documental tienen atributos distintos, y una serie trae temporadas y episodios anidados; en un documento se leen completos en una sola consulta, sin tablas por tipo. Las sesiones de visualización son muchas, se escriben a cada latido y se consultan por rango de fechas para el informe; el esquema flexible y los índices compuestos y parciales de MongoDB se ajustan a ese uso. Los administradores del catálogo también están en MongoDB porque solo trabajan con el catálogo y los informes.

El modelo documental es el de la primera entrega (`mongo/01_modelo.js`), con los cambios de índices explicados en `docs/optimizacion.md`.

## Integración

No hay llaves foráneas entre las dos bases. La aplicación es la que las integra:

1. Los documentos de MongoDB guardan los identificadores de Oracle (`accountId`, `profileId`, `subscriptionId`, `planId`) como referencias numéricas. La sesión de visualización copia `subscriptionId` y `planId` del momento en que empezó, así el informe de consumo por plan no depende de que la suscripción siga vigente.
2. Para reproducir, la aplicación consulta primero Oracle (vista `vw_profile_access`: el perfil es de la cuenta, está activo y hay suscripción vigente) y después MongoDB (el contenido está publicado, la clasificación está permitida para el perfil y el episodio pertenece a la serie). Si una de las dos comprobaciones falla, no se crea la sesión.
3. La lectura de Oracle no forma parte de la transacción de MongoDB. Si la suscripción vence durante una reproducción, la sesión termina normalmente; la siguiente reproducción ya se rechaza. La aplicación vuelve a consultar `vw_profile_access` en cada página de un perfil, así que no se puede seguir navegando con una suscripción vencida.
4. La creación de la sesión y la actualización del progreso se hacen en una transacción de MongoDB, para que Continuar viendo nunca apunte a una sesión que no existe.
5. El informe de consumo se calcula en MongoDB y toma los nombres de los planes de Oracle. Si Oracle no responde, el informe se muestra con el número del plan y un aviso.
6. Cada base se conecta por separado. Si MongoDB no está disponible, se puede iniciar sesión, comprar y administrar perfiles; si Oracle no está disponible, el administrador puede trabajar con el catálogo. En ambos casos la aplicación responde con un mensaje y no registra cambios parciales.

## Reglas de negocio en Oracle

La aplicación se conecta con un usuario que solo puede leer ACCOUNTS, PROFILES, PLANS y las vistas, y ejecutar los procedimientos (`oracle/04_usuario_app.sql`). No tiene INSERT, UPDATE ni DELETE sobre ninguna tabla, así que toda escritura pasa por un procedimiento:

| Procedimiento | Qué garantiza |
|---|---|
| `sp_register_account` | Correo único sin distinguir mayúsculas (índice `ux_accounts_email_ci`) |
| `sp_purchase_subscription` | Bloquea la cuenta con `SELECT ... FOR UPDATE`, rechaza si hay una suscripción vigente o si los perfiles activos superan el nuevo plan, e inserta suscripción y pago en la misma transacción. Ante cualquier error hace ROLLBACK |
| `sp_create_profile` | Bloquea la cuenta, exige suscripción vigente, respeta el máximo de perfiles del plan y el nombre único por cuenta |
| `sp_set_profile_active` | Las mismas reglas al activar un perfil inactivo |

El bloqueo de la fila de la cuenta serializa las operaciones de una misma cuenta: si llegan dos compras al mismo tiempo, la segunda espera a que la primera confirme y entonces encuentra la suscripción vigente y es rechazada. Cuentas distintas no se bloquean entre sí.

Las fechas se guardan en UTC (`SYS_EXTRACT_UTC(SYSTIMESTAMP)` en Oracle y `Date` en MongoDB) y se muestran en hora de Colombia.

## Índices

### Oracle

| Índice | Columnas | Consulta que atiende |
|---|---|---|
| `ux_accounts_email_ci` | `LOWER(email)` | Inicio de sesión y correo único |
| `ux_profiles_name_ci` | `accountId, LOWER(name)` | Nombre de perfil único por cuenta |
| `ix_subs_account_period` | `accountId, endsAt, startsAt` | Suscripción vigente, control de superposición e historial de la cuenta |
| `ix_subs_plan` | `planId` | Llave foránea hacia PLANS |
| `ix_profiles_account_active` | `accountId, isActive` | Conteo de perfiles activos contra el máximo del plan |
| `ix_payments_paidat` | `paidAt, subscriptionId, amount` | Informe de ingresos por rango de fechas, resuelto solo con el índice |

### MongoDB

| Colección | Índice | Consulta que atiende |
|---|---|---|
| contents | `ix_contents_browse { status, type, releaseYear, title }` | Catálogo publicado por tipo |
| contents | `ix_contents_genre { status, genres, releaseYear }` | Filtro por género |
| contents | `ix_contents_audio { status, audioLanguages }` | Filtro por idioma de audio |
| contents | `tx_contents_title` (texto sobre `title`, en español) | Búsqueda por título |
| contents | `ux_contents_episodeId` único y parcial (solo series) | Episodio por identificador, sin repetidos |
| viewingSessions | `ix_sessions_report { startedAt, planId, contentType, profileId, watchedSec }` | Informe de consumo, consulta cubierta |
| viewingSessions | `ix_sessions_open { status, lastHeartbeatAt }` parcial | Cierre de sesiones sin latido |
| playbackProgress | `ux_progress_profile_item` único | Un progreso por perfil y elemento |
| playbackProgress | `ix_progress_continue { profileId, completed, lastWatchedAt }` | Continuar viendo |
| watchlist | `ux_watchlist_profile_content` único, `ix_watchlist_profile_recent` | Mi lista sin repetidos y en orden |
| admins | `username` y `email` únicos | Inicio de sesión de administradores |

Las mediciones que justifican `ix_subs_account_period`, `ix_payments_paidat`, `ix_sessions_report` e `ix_sessions_open` están en `docs/optimizacion.md`.
