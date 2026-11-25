# CineConecta

Aplicación web de streaming con persistencia políglota: Oracle guarda cuentas, perfiles, planes, suscripciones y pagos; MongoDB guarda el catálogo, la actividad de visualización, el progreso, Mi lista y los administradores.

Proyecto final de Sistemas Intensivos de Datos 2. Equipo Comadritas: Estefany Villamarin y Valeria Valencia.

## Contenido del repositorio

| Carpeta | Contenido |
|---|---|
| `app/` | Aplicación Node.js (Express y EJS) |
| `app/demos/` | Demostraciones de concurrencia y de fallo de transacción desde Node |
| `oracle/` | Scripts de creación, procedimientos, datos de prueba, volumen, optimización y demostraciones |
| `mongo/` | Scripts de creación del modelo, datos de prueba, volumen y optimización |
| `docs/decisiones.md` | Justificación de persistencia, integración e índices |
| `docs/optimizacion.md` | Evidencias de optimización: datos de prueba, planes de ejecución y mediciones |
| `docs/evidencias/` | Salidas completas de los scripts de optimización |

## Requisitos

- Node.js 18 o superior.
- Un esquema de Oracle (ESTUD del curso u Oracle Free). El controlador `oracledb` funciona en modo Thin, sin instalar el cliente de Oracle.
- MongoDB Atlas (cualquier clúster, incluido M0) o un MongoDB local configurado como conjunto de réplicas. Se necesita conjunto de réplicas porque la aplicación usa transacciones.
- SQL Developer y mongosh o MongoDB Compass para ejecutar los scripts.

## 1. Base de datos Oracle

Conectado con el usuario dueño del esquema, ejecutar en SQL Developer con F5 (ejecutar script) y en este orden:

| Script | Qué hace |
|---|---|
| `oracle/00_borrar.sql` | Borra los objetos del proyecto (solo si ya existían) |
| `oracle/01_esquema.sql` | Tablas, restricciones, secuencias, índices y vistas |
| `oracle/02_procedimientos.sql` | Procedimientos con las reglas de negocio |
| `oracle/03_datos_prueba.sql` | Planes, cinco cuentas de prueba con perfiles, suscripciones y pagos |
| `oracle/04_usuario_app.sql` | Opcional. Permisos para un usuario de aplicación sin acceso de escritura a las tablas |
| `oracle/05_volumen.sql` | Opcional. Volumen para las mediciones (200.000 suscripciones y pagos) |
| `oracle/06_optimizacion.sql` | Opcional. Planes de ejecución y tiempos con y sin índices |
| `oracle/07_demos_sustentacion.sql` | Demostraciones de fallo y concurrencia desde SQL Developer |

`oracle/05b_borrar_volumen.sql` quita el volumen y deja solo los datos de prueba.

Si se usa `04_usuario_app.sql`, la aplicación se conecta con ese usuario y `ORACLE_SCHEMA` indica el dueño de las tablas. En ESTUD, donde normalmente no se pueden crear usuarios, la aplicación se conecta con el usuario asignado y `ORACLE_SCHEMA` se deja vacío.

## 2. Base de datos MongoDB

Con mongosh conectado al clúster (o desde la pestaña mongosh de Compass), en este orden:

```
load("mongo/01_modelo.js")        // colecciones, validaciones e índices (base cineconecta)
load("mongo/02_datos_prueba.js")  // catálogo, administradores y actividad alineada con Oracle
load("mongo/04_volumen.js")       // opcional: 200.000 sesiones, después de oracle/05_volumen.sql
load("mongo/05_optimizacion.js")  // opcional: planes y tiempos con y sin índices
```

En Atlas, crear para la aplicación un usuario de base de datos (Database Access) con el rol `readWrite` solo sobre la base `cineconecta`, y usar ese usuario en `MONGODB_URI`. Los scripts se ejecutan con el usuario administrador del clúster.

`02_datos_prueba.js` debe ejecutarse después de `oracle/03_datos_prueba.sql`, porque usa los mismos identificadores y fechas relativas al momento de la carga. Para recargar todo se vuelven a ejecutar los scripts de Oracle 00 a 03 y los de MongoDB 01 y 02.

## 3. Configuración de la aplicación

```
cd app
cp .env.example .env
```

Completar `.env` con los datos de conexión. Este archivo no se sube al repositorio y es el único lugar donde van usuarios, contraseñas y cadenas de conexión.

| Variable | Valor |
|---|---|
| `PORT` | Puerto web, por defecto 3000 |
| `SESSION_SECRET` | Cadena larga y aleatoria para firmar la cookie de sesión |
| `ORACLE_USER`, `ORACLE_PASSWORD` | Usuario de Oracle de la aplicación |
| `ORACLE_CONNECT_STRING` | `servidor:puerto/servicio` |
| `ORACLE_SCHEMA` | Dueño de las tablas, solo si es distinto de `ORACLE_USER` |
| `MONGODB_URI` | Cadena de conexión de Atlas (`mongodb+srv://...`) o local |
| `MONGODB_DB` | `cineconecta` |

## 4. Ejecución

```
cd app
npm install
npm start
```

La aplicación queda en http://localhost:3000 y el módulo de administración en http://localhost:3000/admin.

## Usuarios de prueba

Clientes (contraseña `Cine2026!`):

| Correo | Situación |
|---|---|
| ana@cineconecta.test | Plan Estándar vigente, perfiles Ana (18), Niños (7) e Invitado (inactivo). Tiene Continuar viendo y Mi lista |
| bruno@cineconecta.test | Suscripción Premium vencida, dos perfiles activos |
| carla@cineconecta.test | Plan Básico vigente con su único perfil |
| diego@cineconecta.test | Cuenta nueva sin suscripción ni perfiles |
| elena@cineconecta.test | Plan Premium vigente con cuatro perfiles |

Administradores (contraseña `Admin2026!`):

| Usuario | Roles |
|---|---|
| admin.catalogo | Gestión del catálogo e informes |
| analista | Solo informes |

## Demostraciones

Desde `app/`, con el `.env` configurado:

```
node demos/concurrencia_suscripcion.js   # dos compras simultáneas para la misma cuenta
node demos/fallo_transaccion.js          # fallo entre la suscripción y el pago
node demos/concurrencia_perfiles.js      # dos perfiles simultáneos en un plan de un perfil
```

Las mismas pruebas se pueden hacer desde SQL Developer con `oracle/07_demos_sustentacion.sql`.

## Reglas principales

- Una compra registra la suscripción y el pago en la misma transacción; si algo falla no queda ninguno de los dos.
- Una cuenta no puede tener dos suscripciones con períodos superpuestos, aunque las compras lleguen al mismo tiempo.
- Una cuenta no puede tener más perfiles activos que los que permite su plan.
- Para reproducir se necesita suscripción vigente, perfil activo y un contenido publicado con clasificación permitida para el perfil.
- El progreso se guarda con latidos cada 5 segundos. Los saltos no cuentan como tiempo visto y el contenido se marca como terminado al finalizarlo o al llegar al 90 %.
