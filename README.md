# Match Empleos

Plataforma que conecta candidatos (personas que buscan trabajo) con empresas que publican búsquedas. Idioma de la interfaz: **español rioplatense** (voseo: "Creá", "Contanos", "Escribí").

Este documento está pensado para dos lectores: personas del equipo y agentes de IA que trabajen en el proyecto. Si sos un agente, leé primero la sección [Reglas para agentes](#11-reglas-para-agentes-de-ia).

---

## 1. Resumen rápido

| Qué | Dónde / cómo |
|---|---|
| Frontend | Un único archivo: `index.html` (HTML + CSS + JS). Sin build, sin npm, sin framework. |
| Backend | Supabase (Postgres + Auth + Storage + Realtime + API REST). |
| Cliente de Supabase | `vendor/supabase.js` (versión **2.45.4**, copiada tal cual desde npm). |
| Entornos | **Staging** (`gtnxlkqumppeintdpycn`) y **producción** (`mijmzywmrazzaqypuwhu`). Son proyectos separados. |
| Selección de entorno | Por host: `matchempleos.com.ar` y `www.matchempleos.com.ar` usan producción; cualquier otro host (GitHub Pages, Netlify de pruebas, localhost) usa staging. |
| Migraciones SQL | `supabase/migrations/`, de `000` a `009`. Ver [sección 8](#8-base-de-datos). |
| Repos | `Alternativy/test-empleos` (desarrollo y pruebas) y el repo `matchempleos` (producción). Ver [flujo de trabajo](#flujo-de-trabajo). |

---

## Flujo de trabajo

- **Desarrollo en `test-empleos`.** Todos los cambios se hacen y se prueban en este repo. Su despliegue (GitHub Pages y el sitio de Netlify de pruebas) usa **staging**.
- **Pull request a `matchempleos` para producción.** Cuando una funcionalidad o un cambio relevante está probado en staging, se abre un pull request desde `test-empleos` hacia el repo `matchempleos`, que es el de producción. Los cambios pequeños (textos, correcciones) pueden ir directo al repo de pruebas, pero no llegan a producción sin un pull request.
- **Migraciones SQL.** Se aplican primero en staging. Para producción, se aplican al proyecto de producción **antes** del merge, y en el mismo orden de la carpeta `supabase/migrations/`.
- **Checklist antes del pull request:** ejecutar la sección 10 completa en staging, validar la sintaxis de los `<script>` de `index.html`, y revisar que la configuración de producción (`ENTORNOS.prod`, `HOSTS_PRODUCCION`) no cambió sin querer.
- **Pendientes de publicación:** los que dependan de la configuración del dashboard o de archivos fuera del código están en la sección 12.

---

## 2. Cómo correr el proyecto en local

1. Clonar el repo.
2. Servir la carpeta con un servidor estático, por ejemplo **Live Server** de VS Code ("Go Live"). **No abrir `index.html` con doble clic**: Supabase Auth necesita un origen `http://`.
3. Verificar en la consola la línea `[db] entorno: staging`. En local siempre debe ser staging. Si aparece `prod`, el host no es el esperado.

Para que el login y los enlaces de correo funcionen en local, el host (por ejemplo `http://127.0.0.1:5500`) tiene que estar en **Authentication > URL Configuration > Redirect URLs** del proyecto de **staging**. Producción no tiene esos hosts, a propósito.

---

## 3. Estructura del repo

```
index.html                              App completa (estilos, datos, routing, UI, auth y acceso a datos)
vendor/supabase.js                      Cliente de Supabase 2.45.4 (código de terceros, no editar)
img/                                    Logos, avatares, ilustraciones y favicons
  favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png, site.webmanifest
supabase/migrations/
  000_esquema_produccion.sql            Esquema base completo, consolidado (ver sección 8)
  001_crud_inicial.sql                  Histórica, superada
  002_auth_por_usuario.sql              Histórica, destructiva (recrea tablas)
  003_chats_y_mensajes.sql              Chats por Match mutuo y mensajes con autor
  004_revocar_execute_funciones_definer.sql
  005_bucket_cvs.sql                    Bucket privado de CVs
  006_permisos_perfiles_y_tasa.sql      Permisos de perfiles; tasa calculada en servidor
  007_cupo_semanal.sql                  Cupo de 5 postulaciones por semana (RPC postular)
  008_empresa_actualiza_postulaciones.sql
  009_alinear_staging_produccion.sql    Alineación de permisos de staging con producción
  010_busquedas_jornada_turno_y_borrado.sql  Jornada y turno en búsquedas; borrado seguro (RPC borrar_busqueda)
  011_pausar_busquedas.sql              Búsquedas pausadas no reciben postulaciones (postular valida estado)
robots.txt                             Permite indexar la raíz y apunta al sitemap
sitemap.xml                            Lista la landing (única URL indexable)
README.md                               Este documento
```

### Estructura interna de `index.html`

1. **Estilos** (`<style>`): variables CSS en `:root` (`--navy`, `--green`, `--gray`, `--navy2`, `--line`, etc.), con paleta azul prusiano, verde primaveral y alabastro. Clases como `.btn`, `.field`, `.chip`, `.ccard`, `.bub`, `.fila`.
2. **Script de datos** (primer `<script>`): configuración de entornos (`ENTORNOS`, `HOSTS_PRODUCCION`), cliente de Supabase (`sb`), identidad (`ME`), helpers de Storage (`subirFoto`, `subirCV`, `verCV`) y el objeto `DB` con todas las escrituras y lecturas.
3. **Script principal** (segundo `<script>`, dentro de una IIFE): estado global `S`, datos de ejemplo (`freshState`), plantillas de pantallas, routing (`route`), autenticación, handlers de eventos y arranque (`hidratar`, Realtime).

---

## 4. Routing

La app usa rutas por hash (`#/...`). No hay servidor de rutas.

| Ruta | Pantalla |
|---|---|
| `#/` | Landing pública. Con sesión muestra la foto de perfil (lleva a la app) y "Cerrar sesión"; sin sesión, "Iniciar sesión" y "Registrarse". |
| `#/login`, `#/recuperar`, `#/nueva-clave` | Autenticación |
| `#/registro`, `#/registro/c/1..5`, `#/registro/e/1..5`, `#/registro/terminos/{c\|e}` | Registro de candidato y de empresa |
| `#/confirmar` | "Revisá tu correo" |
| `#/c/feed`, `#/c/oferta/:id`, `#/c/match/:id` | Candidato: feed de ofertas, detalle y confirmación de Match |
| `#/c/postulaciones`, `#/c/mensajes`, `#/c/chat/:id`, `#/c/notificaciones` | Candidato: seguimiento, conversaciones, notificaciones |
| `#/c/perfil`, `#/c/datos`, `#/c/config`, `#/c/salir` | Candidato: perfil (datos personales y CV), configuración y salida |
| `#/e/panel`, `#/e/publicar`, `#/e/candidatos`, `#/e/candidato/:id`, `#/e/responder/:id/:tipo` | Empresa: panel de búsquedas, publicación, candidatos y respuestas |
| `#/e/mensajes`, `#/e/chat/:id`, `#/e/notificaciones` | Empresa: conversaciones y notificaciones |
| `#/e/empresa`, `#/e/datos`, `#/e/config`, `#/e/salir` | Empresa: perfil de la empresa, datos, configuración y salida |
| `#/privacidad`, `#/terminos`, `#/ayuda` | Páginas legales |

**Guardia de rutas:** `route()` deja pasar sin sesión solo a las rutas de `PUBLICAS`. Un candidato que entra a `#/e/...` (o al revés) es redirigido a su área.

**Logo de Match Empleos:** en la landing, con sesión lleva al feed (candidato) o al panel (empresa); sin sesión, a `#/login`. En el resto de las pantallas lleva a `#/`.

---

## 5. Estado de la aplicación

- `S` es el estado de la UI en memoria: `S.c` (candidato) y `S.e` (empresa). Se construye con `freshState()`.
- `freshState()` **contiene datos de ejemplo** para el modo demo.
- En una sesión real, `hidratar()` lee de Supabase: postulaciones, búsquedas, respuestas (`candidatos_estado`), mensajes, chats, cupo y tasa del usuario. Un candidato real no recibe las postulaciones ni los chats demo; una empresa real no recibe búsquedas ni notificaciones demo.
- **Cupo** (`S.c.cupo`): lo entrega el servidor con `cupo_actual()` al cargar la sesión.
- **Tasa de respuesta** (`perfiles.tasa`): la calcula el servidor. Es respondidas ÷ total de postulaciones recibidas, y 100 % si no hay ninguna. El cliente la recalcula para mostrarla y no la escribe.
- Las ofertas reales de empresas llevan `real: true`. "Me interesa" sobre una oferta real llama a la RPC `postular`, que descuenta el cupo y crea la postulación en la misma transacción.
- `ME` guarda la identidad: `ME.id` (uuid de Auth), `ME.rol` (`'c'` o `'e'`), `ME.nombre`, `ME.email`, `ME.datos`, `ME.avatarUrl` y `ME.demo`.

---

## 6. Modo demo

- Los botones "Entrar como candidato" / "Entrar como empresa" de la pantalla de login activan `ME.demo = true`.
- En demo **no se escribe nada en la base**: `persistir()` devuelve `null` antes de ejecutar cualquier consulta, y las RPC no se llaman.
- Se controla con la constante `DEMO_HABILITADO` (en `index.html`). Ponerla en `false` oculta los botones y desactiva `entrarDemo`.
- Por ahora está en `true`, porque el equipo lo usa para pruebas.
- **Próximamente, la demo no será visible en producción.** La constante `DEMO_VISIBLE` combina `DEMO_HABILITADO` con el entorno: en `matchempleos.com.ar` (y `www`) los botones de demo se ocultan y `entrarDemo` no hace nada. En staging, Netlify y localhost sigue disponible. Este cambio ya está en el código; cuando se publique en producción, la demo deja de aparecer allí.
- Las cuentas demo conservan sus datos de ejemplo (Tomás Ferreyra, Café Mercado, Malena, Lucía, Farmacia Sur, etc.). No deben aparecer en cuentas reales.

---

## 6b. SEO y contenido estático de la landing

- `index.html` tiene metadatos en el `<head>`: `title`, `meta description`, `canonical`, Open Graph, Twitter Card y datos estructurados JSON-LD (`Organization` y `WebSite`). No hay `FAQPage`, a propósito.
- El script de `<head>` agrega `<meta name="robots" content="noindex, nofollow">` cuando el host no es `matchempleos.com.ar` ni `www.matchempleos.com.ar`. Por eso los entornos de prueba no se indexan.
- La landing tiene **una sola fuente de texto**: el HTML dentro de `<div id="root">` en `index.html` (encabezado, hero, "¿Quiénes somos?", "Situación actual en Argentina", "¿Cómo funciona?", "¡El futuro no espera, vos tampoco!" y pie). Ese HTML se guarda en `LANDING_HTML` al arrancar. `home()` lo reutiliza y solo ajusta lo que depende de la sesión (enlace del logo y menú de cuenta). `siteFooter()` toma el pie del mismo HTML.
- **Para cambiar un texto de la landing, editá solo el HTML de `#root`.** No hay copia en JavaScript. El pie que usan las demás pantallas sale del mismo bloque.
- Como el contenido existe en el HTML, se ve y se indexa aunque no cargue JavaScript.
- `titleFor()` cambia el título de la pestaña según la vista. La landing mantiene el título completo.
- Las imágenes llevan `loading="lazy"`, excepto el hero y el logo del encabezado.
- Las rutas con hash (`#/privacidad`, `#/terminos`, `#/ayuda`) no son URLs que un buscador indexe por separado. Está pendiente separarlas en páginas propias (ver sección 12).

---

## 7. Autenticación

### Flujo de registro (candidato)

1. **`#/registro`**: el usuario elige "Busco trabajo" o "Busco gente para mi empresa". Antes escribe correo y contraseña. Los botones quedan deshabilitados hasta que son válidos.
2. **Paso 1** (`#/registro/c/1`): nombre, apellido, correo y contraseña. El correo y la contraseña tienen que coincidir con los de la pantalla anterior (`verificarCoincidencia`).
3. **Pasos 2 a 5**: edad, ubicación, experiencia, rubros, tipo de empleo, modalidad, horario, perfil y **CV en PDF** (paso 5). Los datos quedan en memoria (`regDraft` y `S.reg.chips`). El CV queda en `regCvFile`.
4. **Términos** (`#/registro/terminos/c`): el botón "Crear mi cuenta" llama a `crearCuenta()`.
5. **`crearCuenta()`** llama a `sb.auth.signUp` con:
   ```js
   { email, password, options: { data: { rol, nombre, display_name, full_name, datos: perfilDatos() } } }
   ```
   `perfilDatos()` junta los campos `rc-*`, `re-*` y `rx-*` (sin correo, contraseña ni CV) y los chips de `S.reg`.
6. Si la confirmación por correo está activa, `data.session` es `null` y la app muestra `#/confirmar`. Si no, entra directo.
7. Si hay sesión y hay CV, `crearCuenta()` lo sube con `subirCV(file, user.id)`. Si no hay sesión, el archivo no sobrevive a la recarga por el enlace de confirmación: la app avisa que hay que subirlo desde "Datos personales".
8. El trigger `on_auth_user_created` ejecuta `handle_new_user()`, que crea la fila en `perfiles` con `rol`, `nombre` y `datos`.
9. Al confirmar el correo, el enlace vuelve a la URL base. El listener de `onAuthStateChange` detecta `SIGNED_IN` y lleva al panel correspondiente.

### Login

- `iniciarSesionForm()` valida formato de correo y largo de contraseña (mínimo 8) antes de llamar a `signInWithPassword`. Mientras espera la respuesta, el botón muestra un spinner y queda deshabilitado.
- Si el correo no está confirmado, se muestra un mensaje con el botón "Reenviar correo" (`sb.auth.resend`).
- Si las credenciales no coinciden, se muestra un mensaje genérico con el enlace "¿Olvidaste tu contraseña?". El motivo real se registra en la consola (`[auth] login falló`).

### Recuperación de contraseña

- `recuperarForm()` llama a `resetPasswordForEmail` con `redirectTo` = origen + ruta actual (sin hash).
- Al volver desde el correo, Supabase emite `PASSWORD_RECOVERY` y la app lleva a `#/nueva-clave`.

### Cerrar sesión

- Desde la landing o desde la sección "Salir" de la app, `#/c/salir` o `#/e/salir`. Llama a `sb.auth.signOut()` (salvo en demo) y limpia `ME` y `S`.

### Reglas de validación en formularios

| Campo | Regla |
|---|---|
| Correo | Formato `algo@algo.dominio` (regex `EMAIL_RE`). |
| Contraseña | Mínimo 8 caracteres. |
| Nombre, apellido, responsable | Solo letras de alfabetos latinos y espacios (`\p{Script=Latin}`). Sin números ni símbolos. |
| Edad | Solo dígitos, máximo 2. |
| Correo y contraseña del paso 1 | Deben coincidir con los de "Busco trabajo". |
| CV | Solo PDF, máximo 5 MB. |
| Foto de perfil | JPG, PNG o WEBP, máximo 2 MB. |

Los campos conservan lo escrito al volver atrás: `regField()` y los inputs de `registro()` leen `regDraft`.

---

## Búsquedas de la empresa

- Cada búsqueda tiene puesto, descripción, **jornada** y **turno** (columnas `busquedas.jornada` y `busquedas.turno`, arrays de texto).
- En "Búsquedas" del panel, cada tarjeta abre el detalle de la búsqueda. Desde ahí se puede ver los candidatos (`Ver candidatos`), editar la búsqueda o eliminarla.
- **Pausar una búsqueda** cambia `busquedas.estado` entre `Activa` y `Pausada`. Una búsqueda pausada no aparece en el feed de candidatos y `postular` la rechaza. Las postulaciones que ya tiene siguen visibles para la empresa.
- **Eliminar una búsqueda** llama a la RPC `borrar_busqueda`, que borra también sus postulaciones, respuestas, chats y mensajes. Es irreversible. La app pide confirmación antes.

---

## 8. Base de datos

### Proyectos

| Entorno | Proyecto | Uso |
|---|---|---|
| Staging | `gtnxlkqumppeintdpycn` (us-east-1) | Pruebas. Tiene datos de prueba y chats demo heredados. |
| Producción | `mijmzywmrazzaqypuwhu` (us-east-2) | Dominio `matchempleos.com.ar`. Arranca limpio, sin datos de prueba. |

Los dos proyectos se configuran por separado: esquema, permisos, buckets, URLs de redirección y SMTP. Las migraciones se aplican a cada uno por separado.

Diferencias intencionales entre staging y producción (ver migración `009`):
- Staging conserva columnas y una política de la versión demo de chats: `mensajes.de`, `mensajes.chat_key`, la restricción `mensajes_de_check`, el índice `mensajes_chat_idx` y la política "historial anterior solo lectura". Producción no los tiene.
- Producción tiene la función `rls_auto_enable`, creada por la opción "Enable automatic RLS" del dashboard.
- Staging tenía un bucket `subidas` sin uso que hay que borrar desde el dashboard.

### Migraciones

- Se aplican en orden numérico. `000` es la base completa de producción y ya incluye el efecto de `003` a `008`. Para un proyecto nuevo, aplicar `000` y después las que vengan después de la `009`.
- `002` es **destructiva**: recrea las tablas. No se vuelve a correr sobre una base con datos.
- `003` borra los datos de prueba de chats y candidatos en `si`/`mas`. Solo corresponde a staging. **No correrla en producción** (producción ya tiene su estado correcto).
- `004` a `009` son para staging. Su efecto ya está incluido en `000`.
- Todo cambio futuro va en un archivo nuevo, numerado a partir de `012`. Las `010` y `011` ya están aplicadas en staging y en producción. No cambiar tablas a mano en el editor de Supabase.

### Tablas

| Tabla | Contenido | Clave / relaciones |
|---|---|---|
| `perfiles` | Una fila por cuenta. `rol` (`c`/`e`), `nombre`, `avatar_url`, `datos` (jsonb con el onboarding y el CV), `cupo`, `cupo_semana_inicio`, `tasa`, `demora`, `plazo`. | `id` = `auth.users.id`, `on delete cascade`. |
| `busquedas` | Búsquedas publicadas por una empresa. `estado` (`Activa` por defecto), `total`. | `empresa_id` → `perfiles`. |
| `postulaciones` | Postulación de un candidato a una búsqueda. `estado` (`Enviada`, `Vista`, `Respondida`), `datos` (objeto de la postulación). | `candidato_id` → `perfiles`. Único por (candidato, oferta). |
| `candidatos_estado` | Respuesta de la empresa a una postulación: `si`, `mas` o `no`. `id` = `postulaciones.id`. | `empresa_id` → `perfiles`. |
| `chats` | Un chat por postulación con Match mutuo. Sin vencimiento. | `postulacion_id` único; `candidato_id` y `empresa_id` → `perfiles`. |
| `mensajes` | Mensajes de un chat. `autor_id` identifica al que escribe; `texto` y `h` (hora). Inmutables: no tienen UPDATE ni DELETE. | `chat_id` → `chats`; `autor_id` → `perfiles`. |

Staging además conserva `mensajes.de` y `mensajes.chat_key` (historial demo).

### Funciones del servidor

| Función | Quién la llama | Qué hace |
|---|---|---|
| `handle_new_user()` | Trigger `on_auth_user_created` | Crea la fila de `perfiles` desde `raw_user_meta_data`. |
| `postular(p_id, p_oferta, p_datos)` | Cliente (RPC) | Valida cupo, evita postulaciones repetidas, crea la postulación y descuenta el cupo, en una transacción. |
| `cupo_actual()` | Cliente (RPC) al cargar la sesión | Devuelve el cupo vigente. Si empezó una semana nueva, lo renueva a 5. |
| `inicio_semana_ar()` | Interna | Lunes 00:00 de Buenos Aires. |
| `abrir_chat_con_match()` | Trigger sobre `candidatos_estado` | Crea el chat cuando la empresa marca `si` sobre una postulación suya. |
| `recalcular_tasa(empresa)` | Triggers sobre `postulaciones` y `candidatos_estado` | Recalcula `perfiles.tasa`. |

Las funciones `SECURITY DEFINER` no son ejecutables por `anon` ni `public`. Solo `cupo_actual` y `postular` son invocables por usuarios logueados, y validan `auth.uid()` adentro.

### Reglas de cupo y tasa

- **Cupo**: 5 postulaciones por semana. Se renuevan los lunes a las 00:00 hora de Buenos Aires. Lo controla el servidor; el cliente no puede modificar `cupo`.
- **Tasa**: respondidas ÷ total de postulaciones recibidas. Se recalcula sola cada vez que cambia una postulación o una respuesta.

### RLS (Row Level Security)

Todas las tablas tienen RLS activo.

- `perfiles`: cada uno lee y edita su propia fila. Los candidatos leen los perfiles de empresas (`rol = 'e'`). Las empresas leen los perfiles de los postulantes a sus búsquedas.
- `busquedas`: la empresa gestiona las suyas. Los candidatos leen las activas.
- `postulaciones`: el candidato gestiona las suyas. La empresa las lee y actualiza (`estado`, `datos`, `updated_at`) solo si la búsqueda es suya.
- `candidatos_estado`: la empresa gestiona las suyas.
- `chats`: lectura solo para los dos miembros.
- `mensajes`: lectura y escritura solo para los miembros del chat. Se escribe solo como uno mismo (`autor_id = auth.uid()`). No hay UPDATE ni DELETE.

**Privilegios de tabla:** `anon` no tiene ningún permiso sobre las tablas. `authenticated` tiene solo lo que usa la app:

| Tabla | Permisos |
|---|---|
| `busquedas`, `candidatos_estado` | select, insert, update, delete |
| `chats` | select |
| `mensajes` | select, insert |
| `perfiles` | select; update solo de `nombre`, `avatar_url`, `datos` |
| `postulaciones` | select; update solo de `estado`, `datos`, `updated_at` (el alta pasa por `postular`) |

`TRUNCATE`, `REFERENCES` y `TRIGGER` están revocados. `TRUNCATE` ignora RLS.

### Storage

| Bucket | Público | Límite | Ruta | Quién lee / escribe |
|---|---|---|---|---|
| `avatars` | Sí | 2 MB; JPG, PNG, WEBP | `{user_id}/avatar` | Cada usuario, en su carpeta. La lectura pública es por URL. |
| `cvs` | No | 5 MB; solo PDF | `{candidato_id}/cv.pdf` | El candidato, en su carpeta. La empresa, solo si el candidato se postuló a una de sus búsquedas. Se abre con enlace firmado de 5 minutos. |

### Realtime

La publicación `supabase_realtime` incluye `mensajes` y `chats`. El cliente se suscribe a inserts de `mensajes` (por chat) y a inserts de `chats` (para recargar la sesión cuando empieza un chat nuevo). RLS aplica también a Realtime.

### Configuración del proyecto (Dashboard)

Esto no se puede versionar con SQL. Hay que hacerlo en cada proyecto.

- **Authentication > URL Configuration**:
  - Staging: Site URL el de pruebas; Redirect URLs con `127.0.0.1:5500`, `localhost:5500`, el dominio de pruebas y `matchempleos.com.ar`.
  - Producción: Site URL `https://matchempleos.com.ar`; Redirect URLs `https://matchempleos.com.ar` y `https://www.matchempleos.com.ar`. Nada más.
- **Authentication > Sign In / Providers > Email**: "Confirm email" decide si hay que confirmar antes de entrar.
- **Authentication > Notifications > Emails > Security**: activar "Password changed" y "Email address changed".
- **Authentication > Email Templates**: revisar los textos en español antes de salir al público.
- **Authentication > Attack Protection**: la protección contra contraseñas filtradas requiere plan Pro y todavía no está activa.
- **SMTP**: por ahora se usa el SMTP de Supabase, con límites bajos. Antes de escalar, conviene un proveedor propio (Resend, Amazon SES, Postmark) con subdominio y SPF, DKIM y DMARC.
- **Storage**: crear los buckets desde las migraciones, no desde el dashboard.

---

## 9. Pendientes y limitaciones conocidas

Estos puntos **bloquean o condicionan producción**. Están documentados para que nadie los pase por alto.

1. **El rol se toma de la metadata del registro.** Cualquiera con la anon key puede llamar a `signUp` con `rol: 'e'`. Solución propuesta: asignar el rol de empresa desde el servidor (verificación manual o función protegida).
2. **Datos de ejemplo en el código.** `freshState()`, `offerById` y las plantillas siguen teniendo datos ficticios. Las sesiones reales no los mezclan en los listados principales, pero el código sigue cargándolos para el modo demo.
3. **Historial de chats demo.** `hidratar()` todavía lee las claves históricas `c:<oferta>` y `e:<candidato>`. Solo tiene sentido en staging, donde están esos datos.
4. **Contraseñas filtradas y CAPTCHA.** La protección contra contraseñas filtradas requiere plan Pro. Mientras tanto, la longitud mínima de contraseña se controla en el cliente (8 caracteres) y puede subirse en Auth.
5. **SMTP de Supabase.** Tiene límites bajos. Antes de escalar, usar un proveedor propio.
6. **Mensajes de error reveladores.** "Ya existe una cuenta con ese correo" permite averiguar qué correos están registrados. Es una decisión de producto; debería ser un mensaje genérico.
7. **Correo no editable desde la app.** Los datos de "Datos personales" (candidato) y "Datos empresariales" (empresa) se editan todos, salvo el correo, que es el usuario de acceso. Cambiarlo requiere el flujo de cambio de correo de Auth, que todavía no está implementado.
8. **Notificaciones.** Las notificaciones del candidato no se persisten en una tabla; son estado de UI. Las notificaciones base filtran Farmacia Sur y Supermercado Norte.
9. **El CV se sube solo con sesión.** Si el registro requiere confirmar el correo, el archivo elegido en el paso 5 no se puede guardar; el usuario tiene que subirlo después desde "Datos personales".
10. **Sin pruebas automatizadas.** Todo se prueba a mano. Ver checklist en la sección 10.
11. **Respuestas automáticas.** Los temporizadores de `apply()` y `enviarResp()` solo corren para ofertas demo. Las cuentas reales no reciben respuestas automáticas.
12. **Métodos heredados.** `DB.setCupo` y `DB.setTasa` son no-ops; la app ya no escribe esos valores desde el cliente.
13. **Columnas heredadas en staging.** `mensajes.de` y `mensajes.chat_key` siguen en staging por el historial demo. No se replican en producción.

---

## 10. Checklist de prueba manual

Antes de mergear a `main` o de publicar en producción, probar en **staging** con dos cuentas reales (una empresa y un candidato):

**Modo demo**
- [ ] Entrar como candidato y como empresa, postular y publicar. No aparecen filas nuevas en Supabase.

**Registro y acceso**
- [ ] "Busco trabajo" con datos inválidos: botones deshabilitados, aviso visible.
- [ ] Registro completo de candidato con un correo real. Llega el correo, se confirma, entra al feed.
- [ ] En la base, `perfiles` tiene la fila con `rol`, `nombre` y `datos`.
- [ ] Volver atrás en el registro conserva los datos escritos.
- [ ] Nombre con números o símbolos: se rechaza. Nombre con ñ, ç, acentos: se acepta.
- [ ] Paso 1 con correo o contraseña distintos a los de "Busco trabajo": no avanza.
- [ ] Login con correo sin confirmar: aparece "Reenviar correo".
- [ ] Recuperación de contraseña: llega el enlace y permite elegir una nueva.
- [ ] Cerrar sesión desde `#/c/salir` y `#/e/salir`: vuelve al login.
- [ ] Logo de la landing: con sesión lleva a la app; sin sesión, a login.
- [ ] Dos cuentas distintas no ven los datos de la otra.

**Candidato**
- [ ] Subir CV desde "Datos personales": aparece el nombre del archivo. Un archivo que no es PDF o pesa más de 5 MB se rechaza.
- [ ] Foto de perfil: se sube y se ve en el encabezado de la landing y en la barra lateral.
- [ ] Cupo: "Me interesa" descuenta una postulación. Con cupo en 0, el botón queda deshabilitado. Una búsqueda no se puede postular dos veces.
- [ ] El estado de la postulación pasa a "Respondida" cuando la empresa responde.
- [ ] "Me interesa" de la empresa con postulación previa abre el chat. "Pidió más información" no lo abre.
- [ ] Chat: los mensajes propios aparecen a la derecha y los de la empresa a la izquierda. El avatar y el nombre de la empresa se ven en la lista y en el encabezado.
- [ ] Notificaciones y mensajes no muestran datos demo.

**Empresa**
- [ ] Publicar una búsqueda: aparece en el panel y en la lista de búsquedas.
- [ ] Con dos o más búsquedas, el selector de candidatos filtra por búsqueda y los contadores coinciden.
- [ ] Responder "Me interesa" a un candidato: se abre el chat con el candidato, y el mensaje de bienvenida aparece con autor propio.
- [ ] Responder "No avanza": el candidato ve "Respondida" y no hay chat.
- [ ] Tasa de respuesta: sube al responder y llega a 100 % cuando no quedan pendientes.
- [ ] Ver CV desde el perfil de un postulante con postulación: abre el PDF. Un postulante sin postulación a una búsqueda propia no se puede abrir.

**Tiempo real**
- [ ] Dos sesiones reales: un mensaje enviado por una parte aparece en la otra sin recargar.

**Consola**
- [ ] Sin errores de Supabase ni del navegador. Los errores de permisos (`permission denied`) indican un `grant` faltante en la migración correspondiente.

---

## 11. Reglas para agentes de IA

Si sos un agente que trabaja en este repo, seguí estas reglas:

1. **Nunca pongas una `service_role` key en el código ni en el repo.** La anon key sí es pública y ya está en `index.html`.
2. **No edites `vendor/supabase.js`.** Si hace falta otra versión, se reemplaza el archivo completo y se actualiza la versión en esta documentación.
3. **No apliques migraciones destructivas** (como la 002) ni la 003 sobre una base con datos que alguien quiera conservar. Preguntá primero.
4. **Toda escritura a la base pasa por `persistir()`**, así los errores llegan a la UI. No llames a `sb.from(...)` directo desde la UI, salvo en las funciones de `DB` o de Storage ya existentes.
5. **No llames a `sb.*` dentro de un callback de `onAuthStateChange` sin `setTimeout`.** Ya está resuelto en el código: no lo reviertas.
6. **Respetá la validación de campos** descrita en la sección 7. Si agregás un campo, definí sus reglas.
7. **Los textos de la interfaz van en español rioplatense**, con voseo.
8. **Cualquier cambio de esquema va en una migración nueva**, numerada a partir de `012`. Nunca edites una migración ya aplicada.
9. **Permisos explícitos.** Toda tabla nueva necesita `grant` explícito para `authenticated`, y RLS activo. No asumas que la plataforma los da.
10. **Nunca dejes que el cliente escriba `cupo`, `tasa` ni `rol`.** Esos valores los calcula el servidor.
11. **Después de cambiar `index.html`, validá la sintaxis** de cada `<script>` (por ejemplo con `node --check` sobre el contenido extraído).
12. **No cambies `DEMO_HABILITADO` a `false` sin confirmación del equipo.**
13. **No reutilices las claves `c:<oferta>` / `e:<candidato>` para un chat real nuevo.** Las conversaciones reales usan `chats` y `mensajes.chat_id`.
14. **No reintroduzcas respuestas automáticas en cuentas reales.** Los temporizadores de `sendChat()`, `enviarResp()` y `apply()` están protegidos por `ME.demo`.
15. **Al modificar `hidratar()`, preservá la separación demo/real.** Un candidato real no debe recibir las postulaciones o chats de `freshState()`, y una empresa real no debe recibir búsquedas o notificaciones demo.
16. **No cambies la selección de entorno** (`HOSTS_PRODUCCION`) sin confirmación: decide a qué base se conecta cada dominio.
17. **Antes de cambiar la lógica de autenticación**, revisá la sección 7 completa: los pasos de registro, confirmación y login están conectados entre sí.

---

## 12. Pendientes para la próxima publicación a producción

- [ ] **Google Search Console (después del merge a producción):** verificar la propiedad de dominio `matchempleos.com.ar` con el registro TXT en el DNS, pedir indexación de `https://matchempleos.com.ar/` y enviar `sitemap.xml`. Revisar que `matchempleos.netlify.app` no aparezca indexado.
- [ ] **Imagen para compartir** de 1200×630 para `og:image` (hoy se usa `img/ilus-hero.png`).
- [ ] **Subir el `site.webmanifest` corregido** a `img/` (nombre, rutas de íconos relativas).
- [x] **`robots.txt` y `sitemap.xml`** en la raíz de `test-empleos`. Pasan a producción con el pull request.
- [x] **Landing con una sola fuente de texto** (HTML estático en `#root`).
- [ ] Ejecutar la sección 8 (Storage y Auth) y la configuración de URLs de redirección de producción.
- [ ] Páginas legales como URLs propias (`privacidad.html`, `terminos.html`, `ayuda.html`), para indexarlas.
- [ ] Verificar el dominio en Google Search Console después del merge a producción, pedir indexación de `https://matchempleos.com.ar/` y enviar `sitemap.xml`.
