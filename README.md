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
supabase/functions/mejorar-sobre/index.ts  Edge Function para mejorar el campo “Sobre vos” con IA
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
3. **Script principal** (segundo `<script>`, dentro de una IIFE): estado global `S`, estado inicial vacío (`freshState`), plantillas de pantallas, routing (`route`), autenticación, handlers de eventos y arranque (`hidratar`, Realtime).

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
- `freshState()` inicializa las colecciones vacías. No precarga perfiles, ofertas, postulaciones, chats ni notificaciones ficticias.
- `hidratar()` carga desde Supabase las postulaciones, búsquedas, respuestas (`candidatos_estado`), mensajes, chats, cupo y tasa correspondientes al usuario autenticado. El frontend no combina esos resultados con datos de muestra.
- **Cupo** (`S.c.cupo`): lo entrega el servidor con `cupo_actual()` al cargar la sesión.
- **Tasa de respuesta** (`perfiles.tasa`): la calcula el servidor. Es respondidas ÷ total de postulaciones recibidas, y 100 % si no hay ninguna. El cliente la recalcula para mostrarla y no la escribe.
- Las ofertas obtenidas de Supabase llevan `real: true` como marca de procedencia. `apply()` rechaza cualquier elemento que no tenga esa marca y llama a la RPC `postular`, que descuenta el cupo y crea la postulación en la misma transacción.
- `ME` guarda la identidad de la sesión: `ME.id` (uuid de Auth), `ME.rol` (`'c'` o `'e'`), `ME.nombre`, `ME.email`, `ME.datos` y `ME.avatarUrl`.

---

## 6. Estado inicial y carga de datos

- `freshState()` contiene colecciones vacías para ofertas, postulaciones, búsquedas, candidatos, chats y notificaciones. No incorpora registros ficticios ni conversaciones precargadas.
- Después de autenticar, `hidratar()` obtiene las publicaciones, postulaciones, estados, chats y mensajes correspondientes desde Supabase.
- `apply()` solo permite postularse a ofertas marcadas como provenientes de Supabase (`real: true`) y utiliza `DB.postular()`; no simula cambios de estado ni respuestas automáticas.
- `sendChat()` guarda únicamente el mensaje que envía el usuario. La respuesta debe llegar desde la otra cuenta mediante la base de datos y Realtime.
- No borrar datos históricos de staging como parte de un cambio de frontend sin una instrucción y respaldo específicos.

## 6c. Mejora del campo “Sobre vos” con IA

- El registro de postulante (paso 5) y la edición de datos personales muestran el botón **“Mejorar con IA”** debajo del texto original.
- El botón envía el texto a la Edge Function `mejorar-sobre`. La sugerencia aparece en un segundo campo editable; no reemplaza el original automáticamente.
- **“Usar esta versión”** copia la sugerencia al campo original. La persona puede editarla antes de guardarla o crear la cuenta.
- La Edge Function `mejorar-sobre` utiliza Gemini como proveedor principal y Groq como fallback. La cadena configurada en el código es `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `openai/gpt-oss-120b` y `qwen/qwen3.8-27b`, en ese orden. La disponibilidad real depende de los modelos habilitados por cada proveedor y de las claves configuradas.
- Los secretos `GEMINI_API_KEY` y `GROQ_API_KEY` se configuran en Supabase Edge Functions > Secrets. Nunca deben guardarse en `index.html`, el repositorio ni el navegador.
- La función valida el cuerpo y limita el texto a 4.000 caracteres. Tiene un límite temporal en memoria de 8 solicitudes por IP por minuto; es una protección básica y no reemplaza un rate limiter persistente para producción.
- Los usuarios autenticados reservan cuota mediante RPC: 5 mejoras por día y 50 por mes. Los visitantes tienen una única mejora, identificada con UUID local y hash SHA-256 reservado en `private.anonymous_ai_usage`. La cuota se confirma como consumida solo cuando el proveedor devuelve una respuesta exitosa; si todos los proveedores fallan, se libera la reserva.
- El frontend oculta la herramienta fuera de staging. En registro, la mejora se aplica solo si el usuario elige la propuesta; el texto original no se reemplaza automáticamente.
- La función acepta el JWT público del proyecto (`verify_jwt: true`); puede utilizarse durante el onboarding, antes de que el usuario cree su cuenta. No escribe información en la base de datos.
- La integración se desarrolla únicamente en el proyecto Supabase **Match Empleos** (staging). No desplegar ni configurar en **Match Empleos prod** sin un cambio separado y aprobado.
- Para habilitarla en un entorno Supabase, desplegar `mejorar-sobre` y configurar el secreto `OPENAI_API_KEY` en Edge Functions > Secrets. Si se utiliza una rama de desarrollo de Supabase, el secreto debe configurarse también en esa rama.

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
3. **Pasos 2 a 5**: edad, ubicación, experiencia, rubros, tipo de empleo, modalidad, horario, perfil y **CV en PDF** (paso 5). En el `index.html` actual, los campos se mantienen en `regDraft` y los chips en `S.reg`, ambos en memoria JavaScript. El PDF seleccionado se mantiene en `regCvFile`. **No hay persistencia en localStorage ni IndexedDB en el código actual**: refrescar la página puede perder los datos y el CV aún no subido. La persistencia entre refrescos sigue pendiente.
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

- `iniciarSesionForm()` valida formato de correo y largo de contraseña (mínimo 8) antes de llamar a `sb.auth.signInWithPassword`. Mientras espera la respuesta, el botón muestra un spinner y queda deshabilitado.
- Si el correo no está confirmado, se muestra un mensaje con el botón "Reenviar correo" (`sb.auth.resend`).
- Si las credenciales no coinciden, se muestra un mensaje genérico con el enlace "¿Olvidaste tu contraseña?". El motivo real se registra en la consola (`[auth] login falló`).
- Ante un login exitoso, `setSesion()` obtiene `rol`, `nombre`, `datos` y `avatar_url` desde `perfiles`, hidrata los datos de la cuenta y redirige a `#/c/feed` o `#/e/panel` según el rol. Si la cuenta no tiene perfil o rol, se cierra la sesión y se informa el problema.
- **Verificación estática actual (12/11/2026):** se comprobó la validación, `signInWithPassword`, la carga de perfil, la guardia de rutas y la redirección por rol. El bloque `try/finally` restablece el botón, pero el código actual no tiene `catch` para excepciones inesperadas de red. No se realizó una prueba end-to-end contra Supabase con credenciales reales.

### Recuperación de contraseña

- `recuperarForm()` llama a `resetPasswordForEmail` con `redirectTo` = origen + ruta actual (sin hash).
- Al volver desde el correo, Supabase emite `PASSWORD_RECOVERY` y la app lleva a `#/nueva-clave`.

### Cerrar sesión

- Desde la landing o desde la sección "Salir" de la app, `#/c/salir` o `#/e/salir`. Llama a `sb.auth.signOut()` y limpia `ME` y `S`.

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
| Staging | `gtnxlkqumppeintdpycn` (us-east-1) | Entorno de pruebas. Conserva datos y estructuras históricas; el frontend carga únicamente registros reales de Supabase. |
| Producción | `mijmzywmrazzaqypuwhu` (us-east-2) | Dominio `matchempleos.com.ar`. Arranca limpio, sin datos de prueba. |

Los dos proyectos se configuran por separado: esquema, permisos, buckets, URLs de redirección y SMTP. Las migraciones se aplican a cada uno por separado.

Diferencias intencionales entre staging y producción (ver migración `009`):
- Staging conserva columnas y una política heredadas del esquema anterior de chats: `mensajes.de`, `mensajes.chat_key`, la restricción `mensajes_de_check`, el índice `mensajes_chat_idx` y la política "historial anterior solo lectura". Producción no los tiene. No se eliminan en esta tarea porque forman parte del esquema remoto y pueden contener registros históricos.
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

Staging además conserva `mensajes.de` y `mensajes.chat_key` de un esquema anterior de conversaciones.

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
2. **Datos históricos de staging.** El frontend ya no contiene ofertas ni perfiles ficticios y `freshState()` comienza vacío. El proyecto de staging conserva registros históricos de pruebas que no fueron borrados; revisar su origen antes de depurarlos.
3. **Esquema heredado de chats.** Staging conserva las columnas `mensajes.de` y `mensajes.chat_key` por compatibilidad con registros históricos. El frontend actual trabaja con las conversaciones reales vinculadas a `chats` y `mensajes.chat_id`.
4. **Contraseñas filtradas y CAPTCHA.** La protección contra contraseñas filtradas requiere plan Pro. Mientras tanto, la longitud mínima de contraseña se controla en el cliente (8 caracteres) y puede subirse en Auth.
5. **SMTP de Supabase.** Tiene límites bajos. Antes de escalar, usar un proveedor propio.
6. **Mensajes de error reveladores.** "Ya existe una cuenta con ese correo" permite averiguar qué correos están registrados. Es una decisión de producto; debería ser un mensaje genérico.
7. **Correo no editable desde la app.** Los datos de "Datos personales" (candidato) y "Datos empresariales" (empresa) se editan todos, salvo el correo, que es el usuario de acceso. Cambiarlo requiere el flujo de cambio de correo de Auth, que todavía no está implementado.
8. **Notificaciones.** Las notificaciones del candidato no se persisten en una tabla; son estado de UI. El frontend no precarga notificaciones ficticias.
9. **El CV se sube solo con sesión.** Si el registro requiere confirmar el correo, el archivo elegido en el paso 5 no se puede guardar; el usuario tiene que subirlo después desde "Datos personales".
10. **Pruebas automatizadas parciales.** `tests/real-user-offers.test.mjs` verifica que el estado inicial esté vacío y que las ofertas se carguen desde Supabase. Ejecutar con `node --test tests/real-user-offers.test.mjs`. El resto de los flujos sigue requiriendo el checklist manual de la sección 10.
11. **Interacciones reales.** Se eliminaron las respuestas automáticas y las transiciones simuladas de postulaciones. Los mensajes y cambios de estado deben originarse en acciones reales de los usuarios.
12. **Métodos heredados.** `DB.setCupo` y `DB.setTasa` son no-ops; la app ya no escribe esos valores desde el cliente.
13. **Columnas heredadas en staging.** `mensajes.de` y `mensajes.chat_key` siguen en staging por compatibilidad con registros históricos del esquema anterior. No se replican en producción.

---

## 10. Checklist de prueba manual

Antes de mergear a `main` o de publicar en producción, probar en **staging** con dos cuentas reales (una empresa y un candidato):

**Ausencia de datos ficticios**
- [ ] La pantalla de login no ofrece accesos de demostración.
- [ ] Sin una sesión autenticada, las rutas privadas redirigen al login.
- [ ] Una cuenta nueva comienza sin ofertas, postulaciones, chats ni notificaciones precargadas.

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
- [ ] Notificaciones y mensajes corresponden únicamente a interacciones reales de la cuenta.

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
12. **No reintroduzcas datos ficticios en `freshState()` ni accesos que permitan navegar sin una sesión autenticada.**
13. **No reutilices las claves `c:<oferta>` / `e:<candidato>` para un chat real nuevo.** Las conversaciones reales usan `chats` y `mensajes.chat_id`.
14. **No reintroduzcas respuestas automáticas simuladas.** `sendChat()` debe guardar el mensaje escrito por el usuario; las respuestas deben venir de acciones reales de la otra cuenta.
15. **Al modificar `hidratar()`, cargá los datos desde Supabase sin mezclarlos con datos de muestra.** `freshState()` debe seguir vacío.
16. **No cambies la selección de entorno** (`HOSTS_PRODUCCION`) sin confirmación: decide a qué base se conecta cada dominio.
17. **Antes de cambiar la lógica de autenticación**, revisá la sección 7 completa: los pasos de registro, confirmación y login están conectados entre sí.

---

## 12. Pendientes para la próxima publicación a producción

### Pendientes funcionales y de experiencia

- [ ] **UX/UI del login:** revisar jerarquía visual, espaciados, responsive, estados de carga, validaciones, mensajes de error y accesibilidad. El flujo funcional está implementado, pero su experiencia visual todavía requiere una pasada específica.
- [ ] **Login end-to-end:** probar en staging con cuentas reales de candidato y empresa, incluyendo contraseña incorrecta, correo sin confirmar, sesión persistente al refrescar, recuperación de contraseña, cierre de sesión y redirección según rol. La revisión de código no reemplaza esta prueba.
- [ ] **Funcionalidad de IA:** primero reintegrar el frontend con `mejorar-sobre` y los mecanismos de cuota; el `index.html` actual no invoca la función. Después probar proveedores, errores/timeout, cuotas y estado anónimo en staging.
- [ ] **UX/UI de la asistencia IA:** revisar claridad del botón, presentación de la propuesta, comparación con el original, aplicación/rechazo y mensajes de cuota o indisponibilidad.


- [ ] **Google Search Console (después del merge a producción):** verificar la propiedad de dominio `matchempleos.com.ar` con el registro TXT en el DNS, pedir indexación de `https://matchempleos.com.ar/` y enviar `sitemap.xml`. Revisar que `matchempleos.netlify.app` no aparezca indexado.
- [ ] **Imagen para compartir** de 1200×630: `og:image` apunta actualmente a `img/seniala-celular.png`; falta validar encuadre y proporción para redes.
- [ ] **Subir el `site.webmanifest` corregido** a `img/` (nombre, rutas de íconos relativas).
- [x] **`robots.txt` y `sitemap.xml`** en la raíz de `test-empleos`. Pasan a producción con el pull request.
- [x] **Landing con una sola fuente de texto** (HTML estático en `#root`).
- [ ] Ejecutar la sección 8 (Storage y Auth) y la configuración de URLs de redirección de producción.
- [ ] Páginas legales como URLs propias (`privacidad.html`, `terminos.html`, `ayuda.html`), para indexarlas.
- [ ] Verificar el dominio en Google Search Console después del merge a producción, pedir indexación de `https://matchempleos.com.ar/` y enviar `sitemap.xml`.

---

## 13. Readaptación de landing según nuevo diseño (noviembre 2026)

Referencia visual: archivo **`Match Empleos Landing (copia).pdf`** entregado por diseño. La implementación se realizó en `index.html`, dentro del HTML estático de `#root`. No se modificó el router, la autenticación, Supabase ni las pantallas internas de la aplicación.

### Cambios aplicados

- [x] Encabezado simplificado con marca a la izquierda y accesos de inicio de sesión / registro a la derecha.
- [x] Hero azul con título “Bienvenido a Match Empleos”, bajada y llamada a deslizar.
- [x] Sección “¿Quiénes somos?” con fotografía de fondo, overlay azul y composición alineada a la derecha.
- [x] Sección “Situación actual en Argentina” con tres indicadores y recurso ilustrado.
- [x] Sección “¿Cómo funciona?” reorganizada en dos tarjetas: Perfil Postulante y Perfil Empresa.
- [x] CTA final con ilustración, frase de marca y accesos diferenciados de registro para candidato y empresa.
- [x] Footer verde con redes, contacto, navegación y leyenda institucional.
- [x] Reglas responsive para desktop y mobile.
- [x] Estilos nuevos aislados bajo `.landing-v2` para evitar afectar las pantallas de la aplicación.
- [x] Se preservaron los destinos existentes del router: `#/login`, `#/registro/c/1`, `#/registro/e/1`, páginas legales y navegación por anclas.

### Discrepancias y validaciones pendientes con diseño / producto

1. **Cupo de postulaciones (bloqueante de contenido):** el PDF indica “Tenés 5 postulaciones por día”. La lógica documentada en la sección 8 renueva el cupo de 5 postulaciones los lunes a las 00:00 de Buenos Aires, es decir, semanalmente. Confirmar si el diseño debe decir “por semana” o si producto quiere modificar la regla del sistema. No se cambió la lógica.
2. **Obligación de respuesta:** el PDF afirma que la empresa “está obligada a responderte”. La aplicación calcula y muestra una tasa de respuesta, pero no se identificó una regla técnica que obligue a responder dentro de un plazo ni una consecuencia por no hacerlo. Producto debe confirmar si es una promesa/compromiso operativo o si debe reformularse el texto.
3. **Perfiles verificados:** las tarjetas hablan de perfiles “verificados”. La documentación actual registra perfiles y roles, pero también señala que la asignación del rol empresa todavía puede iniciarse desde metadata del registro. Confirmar qué significa “verificado” y qué proceso lo respalda antes de presentar esa afirmación como una verificación efectiva.
4. **Estadísticas:** se conservaron los valores del diseño: 16,5%, 43%, 45% y 0,17%, además de los textos asociados. Falta confirmar fuente, período, universo y redacción exacta de cada indicador. En particular, validar la relación “1.500 inserciones sobre 900.000 beneficiarios” y el dato de ghosting de generación Z.
5. **Red social secundaria:** el PDF muestra `@matchempleos` junto a un ícono de video, pero no identifica de forma inequívoca la plataforma ni su URL. En la landing quedó como texto no enlazado hasta recibir el enlace oficial.
6. **Fotografía de “Situación actual”:** el PDF muestra una imagen de multitud teñida de verde. Ese recurso no está entre los 19 archivos de imagen del repositorio. `foto-como.jpg` es una escena de personas trabajando frente a una computadora y no corresponde a esa referencia; no debe usarse como sustituto. Hasta recibir el export correcto, el bloque utiliza únicamente una base verde.
7. **Curvas, recortes y proporciones:** se ajustaron alturas, anchos, escalas tipográficas y transiciones curvas para acercarse a la composición del PDF. Aun así, CSS no garantiza una réplica exacta del arte exportado; requiere captura en navegador y comparación a escala desktop y mobile.
8. **Copy institucional:** se tomó el texto visible en el PDF. Confirmar si “equipo de cinco estudiantes” y la leyenda de Premios OBRAR Estudiantes 2026 siguen vigentes para la publicación pública.

### Criterio para próximas iteraciones

- Mantener la landing estática dentro de `#root` como única fuente de textos y estructura.
- No alterar pantallas autenticadas ni lógica de negocio al retocar estilos de la landing.
- Registrar aquí cualquier diferencia entre promesas de comunicación, reglas reales del producto y comportamiento implementado.
- Antes de publicar, revisar los puntos anteriores con diseño y producto y validar responsive, enlaces de registro, navegación del footer y consola del navegador.



## 14. Ajuste de fidelidad visual de landing (noviembre 2026)

Segunda iteración sobre la referencia **`Match Empleos Landing (copia).pdf`**, en la rama `design/landing-fidelidad-pdf`.

### Correcciones aplicadas
- [x] Se amplió el contenedor principal para acercarlo al ancho útil del diseño original.
- [x] Se recuperó la escala tipográfica de los titulares, las tarjetas de perfiles, las métricas y el pie de página.
- [x] Se ajustaron los colores principales a los valores muestreados del PDF: azul `#002146`, verde `#38F48C` y gris `#E8E8E8`.
- [x] Se evitó reutilizar `foto-quienes.jpg` o `foto-como.jpg` como si fueran la fotografía de multitud del bloque estadístico: no corresponden al diseño.
- [x] El bloque de estadísticas utiliza una base verde temporal, sin una fotografía de fondo incorrecta.
- [x] Se incorporaron transiciones curvas para la salida del hero, el bloque de estadísticas, “Cómo funciona” y el CTA.
- [x] Se aumentaron las alturas de las secciones y tarjetas para evitar que la landing quede visualmente comprimida frente al PDF.
- [x] Se mantuvo el responsive para tablet y mobile y se preservaron rutas, anclas y lógica de la aplicación.

### Control pendiente
- [ ] Incorporar el export exacto de la fotografía de multitud que aparece en “Situación actual” y ajustar su encuadre/tinte al PDF.
- [ ] Generar capturas del navegador a 1568 px de ancho y en mobile, y compararlas con el PDF. La actualización se validó a nivel de estructura del CSS y referencias de assets; no se ejecutó una prueba visual con navegador en esta sesión.
- [ ] Revisar la curva inferior de “Situación actual” y la continuidad visual entre la ilustración de “Cómo funciona” y el panel del CTA.

---

## 15. Auditoría previa a producción (11 de noviembre de 2026)

**Resultado: NO APTO PARA MERGE / PUBLICACIÓN.** Esta revisión fue estática y de configuración remota; no reemplaza la prueba funcional completa en navegador con cuentas reales.

### Estado del código y repositorios

- [x] test-empleos/main contiene la versión actual de la aplicación y la landing rediseñada.
- [x] Se verificó que los cuatro bloques script ejecutables de index.html compilan sintácticamente. Esto no demuestra que todos los flujos funcionen en ejecución.
- [x] La selección de entorno del frontend apunta a staging para hosts de prueba y a producción solo para matchempleos.com.ar y www.matchempleos.com.ar.
- [x] Se eliminó el modo de acceso sin autenticación y los datos ficticios del frontend. No se borraron datos históricos de staging.
- [ ] Ejecutar node --test tests/real-user-offers.test.mjs en un entorno Node y registrar el resultado. La existencia del test no equivale a una ejecución aprobada.
- [ ] Completar el checklist manual de la sección 10 con dos cuentas reales y validar los flujos de registro, recuperación, postulaciones, respuestas, chat, CV, Storage y Realtime.
- [ ] Comparar visualmente la landing en navegador desktop y mobile contra el diseño aprobado.
- [ ] Revisar el diff completo del pull request entre Alternativy/test-empleos:main y Alternativy/MatchEmpleos:main antes de aprobarlo. Los repositorios tienen historiales y contenidos distintos; no asumir que una sincronización previa equivale al estado actual.

### Animaciones de la landing: implementación no aprobada

Las animaciones de scroll **no se pudieron implementar de manera correcta**. En index.html hay reglas CSS, atributos data-reveal y un IntersectionObserver, pero la presencia de ese código no significa que el resultado visual cumpla lo pedido. No se consideran terminadas ni aprobadas para producción.

- [ ] Rehacer o corregir las entradas al viewport y comprobarlas visualmente en desktop y mobile.
- [ ] Verificar las direcciones solicitadas: llamada a deslizar desde la izquierda; texto de “Quiénes somos” desde abajo; encabezado de “Situación actual” desde la izquierda; bloques porcentuales desde la derecha; tarjetas de perfiles con una entrada sutil.
- [ ] Comprobar que las animaciones no se reinicien incorrectamente al renderizar, navegar o recuperar una sesión.
- [ ] Mantener el comportamiento accesible para prefers-reduced-motion.

### Verificación de Supabase

Se inspeccionaron los proyectos remotos identificados en la sección 8:

| Control | Staging | Producción |
|---|---|---|
| Estado del proyecto | ACTIVE_HEALTHY | ACTIVE_HEALTHY |
| Migración más reciente registrada | 011_pausar_busquedas | 011_pausar_busquedas |
| RLS en tablas públicas inspeccionadas | Activo | Activo |
| Bucket avatars | Público, 2 MB, JPG/PNG/WEBP | Público, 2 MB, JPG/PNG/WEBP |
| Bucket cvs | Privado, 5 MB, PDF | Privado, 5 MB, PDF |

La estructura observada en producción incluye las tablas y columnas principales usadas por la versión actual. Las migraciones registradas en producción siguen su historial consolidado (000, 000b, 000c, 008, 010, 011); staging conserva su historial incremental. Ambos proyectos tienen registradas las migraciones funcionales hasta la 011.

### Bloqueantes y advertencias que siguen abiertos

1. **Asignación del rol empresa — bloqueante de seguridad/producto.** El flujo de registro envía rol dentro de user_metadata y el trigger de creación de perfil utiliza esos datos. Un usuario puede solicitar el rol de empresa desde el cliente. Antes de habilitar el registro público, definir y aplicar una asignación/verificación del rol desde un mecanismo confiable del servidor y revisar las políticas RLS que dependen de ese rol.
2. **Configuración de Auth en producción — pendiente de comprobación operativa.** Confirmar Site URL y Redirect URLs exactas, confirmación de correo, plantillas en español y flujo de recuperación desde el dominio definitivo. La inspección de base de datos no acredita esta configuración del dashboard.
3. **SMTP y entregabilidad — pendiente.** La documentación de producto indica que se utiliza el SMTP compartido de Supabase, con límites bajos. Verificar el proveedor, SPF, DKIM, DMARC, remitente y entrega real antes de abrir el registro al público.
4. **Protección de contraseñas filtradas — advertencia activa.** El advisor de Supabase reporta deshabilitada la protección contra contraseñas comprometidas en ambos proyectos.
5. **Funciones SECURITY DEFINER — revisar, no revocar a ciegas.** Los advisors detectan que borrar_busqueda, cupo_actual y postular son ejecutables por authenticated. El cliente necesita invocar las RPC correspondientes, por lo que hay que verificar sus comprobaciones internas de identidad/propiedad y sus permisos; no quitar EXECUTE sin revisar el flujo.
6. **Rendimiento — mejoras recomendadas.** Los advisors señalan claves foráneas sin índices de cobertura, expresiones de Auth que se reevalúan en políticas RLS y políticas permisivas múltiples. No se detectó una falla funcional derivada de estos avisos, pero conviene corregirlos antes de escalar.
7. **Copy y promesas públicas — pendiente de producto.** Resolver las discrepancias documentadas en la sección 13: cinco postulaciones por día versus cinco por semana, obligación de respuesta, perfiles “verificados” y fuentes/periodos de las estadísticas. No publicar promesas que el comportamiento actual no respalde.
8. **SEO y recursos de publicación — pendiente.** Completar Search Console, imagen social definitiva, manifest corregido y URLs independientes para páginas legales, según la sección 12.

### Decisión de publicación

No abrir todavía el pull request de producción ni hacer merge. Primero resolver los bloqueantes de seguridad y configuración, corregir las animaciones, completar las pruebas manuales y validar el diff entre ambos repositorios. Una vez cumplidos esos puntos, volver a comparar test-empleos/main con MatchEmpleos/main y abrir el pull request para revisión; este documento debe actualizarse con los resultados de esa nueva validación.

## 14. Verificaciones y pendientes de login e IA (12/11/2026)

- Login: inspección estática de `login()`, `iniciarSesionForm()`, `setSesion()` y `route()`. Se verificó validación de correo/contraseña, llamada a Supabase Auth, consulta de `perfiles`, protección de rutas privadas y redirección por rol. Los scripts JavaScript ejecutables del HTML pasaron el chequeo de sintaxis. No se probó una sesión real porque esta revisión no contó con credenciales de prueba ni ejecución del sitio en navegador.
- Manejo de errores del login: `iniciarSesionForm()` distingue credenciales incorrectas y correo sin confirmar y restablece el botón en `finally`. En el código actual no hay `catch` para excepciones inesperadas de red; agregarlo y probarlo es pendiente.
- UX/UI del login: pendiente una revisión específica de diseño responsive, jerarquía, accesibilidad, textos y estados de error/carga.
- IA: la Edge Function implementa Gemini con fallback a Groq, reservas de cuota para usuarios registrados y visitantes, y confirma el consumo solo ante respuesta exitosa. Falta validar el comportamiento operativo con las claves/modelos desplegados en staging y completar pruebas de todos los caminos de error y cuota.
- UX/UI de IA: pendiente mejorar el flujo de propuesta, comparación, aplicación y mensajes de disponibilidad/límite.


---

## 16. Estado real del repositorio verificado (12 de noviembre de 2026)

Esta sección prevalece sobre descripciones anteriores cuando haya contradicciones. Se contrastó el contenido de `main`, especialmente `index.html`, con los archivos de funciones y SQL presentes en el repositorio. No equivale a una prueba funcional en navegador ni a una auditoría de los proyectos remotos de Supabase.

### Referencia de versión

- Repositorio de trabajo: `Alternativy/test-empleos`.
- Rama revisada: `main`.
- HEAD previo documentado: `1b735ba9963df6fc9d92eed4ed5efcb8715eb4b6` — `Cambia ilustración principal por seniala-celular`. Verificar el HEAD de `main` antes de usar esta referencia.
- Archivo principal del frontend: `index.html`. No hay proceso de build ni gestor de paquetes para la app.
- No editar `Alternativy/MatchEmpleos` ni el proyecto Supabase de producción como parte del flujo habitual de desarrollo.

### Cambios recientes confirmados en el código

- **Ilustración principal:** la landing utiliza `img/seniala-celular.png`. Se actualizaron las cuatro referencias en `index.html`: Open Graph, Twitter Card, imagen del SVG/landing y `img.lp-hero-art`. El archivo existe en `img/`. Ya no debe documentarse `ilus-hero.png` como imagen activa del hero.
- **Recuperación de contraseña:** se quitó el mensaje en pasado que afirmaba que el correo ya había sido enviado antes de pulsar “Enviar”. El formulario conserva el texto introductorio en futuro, llama a `recuperarForm()` y luego muestra un aviso genérico. No se probó la entrega real del correo.
- **Login:** el formulario está conectado a `iniciarSesionForm()`, valida los campos, llama a `sb.auth.signInWithPassword`, contempla correo sin confirmar y credenciales incorrectas, y restablece el botón en `finally`. El código actual no incluye un `catch` para errores inesperados de red. La UX/UI sigue pendiente y no hay prueba E2E con cuentas reales.
- **Animaciones de landing:** el código actual contiene `lp-reveal` e `IntersectionObserver`. Su existencia no demuestra que las animaciones cumplan la dirección, tiempos y comportamiento solicitados. La validación visual desktop/mobile sigue pendiente; consultar la auditoría de la sección 15.
- **Datos de la aplicación:** el estado inicial está vacío y la interfaz se hidrata con datos de Supabase. No se incluyen publicaciones, postulaciones, perfiles ni chats de muestra.

### Funcionalidades cuya documentación histórica no coincide con el frontend actual

Los siguientes puntos son importantes: existen commits o archivos de backend/SQL relacionados, pero **no están conectados al frontend de `main` en la versión inspeccionada**. No presentarlos como funcionalidades disponibles para usuarios.

1. **Mejorar “Sobre vos” con IA:** existe `supabase/functions/mejorar-sobre/index.ts`, con validación de texto, autenticación, reservas de cuota y proveedores Gemini/Groq. Sin embargo, el `index.html` actual no contiene el botón, no llama a `sb.functions.invoke` ni referencia `mejorar-sobre`. La integración visible del frontend debe considerarse pendiente. Tampoco se verificó en esta revisión el despliegue de la función, los secretos ni las cuotas remotas.
2. **Sugerencias de respuesta para chats:** existe `supabase/functions/sugerir-respuestas-chat/index.ts`. El frontend actual no invoca esa función. No afirmar que la asistencia IA en chats está activa.
3. **Límite anónimo de IA:** existe `supabase/sql/anonymous_sobre_ai_single_use.sql`, que define almacenamiento privado y RPC para reservar/completar un único uso anónimo. El frontend actual no envía `anonymousId` ni llama a la Edge Function; el límite no está integrado de punta a punta.
4. **Denuncias y verificación de empresas:** existe `supabase/sql/denuncias_y_verificacion_empresas.sql`, con tablas para denuncias, empresas verificadas y revisiones internas, más políticas RLS. El `index.html` actual no contiene botón “Denunciar”, formulario de motivos, consulta de estado verificado ni insignia de empresa verificada. El archivo SQL no es una migración numerada; su comentario indica que fue aplicado en el proyecto de testing, pero esa aplicación remota no se verificó en esta revisión. Confirmar el estado real en staging antes de modificar o volver a ejecutar el SQL.
5. **Persistencia del registro:** los commits históricos `f506d83` y `3d6bd5b` implementaron borrador local y persistencia de CV, pero el `index.html` actual no contiene las claves `me_registro_borrador_v1` / `me_registro_archivos_v1`, ni uso de localStorage o IndexedDB. Hoy `regDraft`, `S.reg` y `regCvFile` son estado en memoria. La persistencia tras refrescar debe reimplementarse o recuperarse y volver a verificarse antes de darla por terminada.

### Pendientes prioritarios

- [ ] Reintegrar y probar la persistencia del registro y del CV, sin guardar contraseñas en almacenamiento local.
- [ ] Reintegrar el flujo de “Mejorar con IA” en los campos previstos, incluyendo reserva/consumo de cuota solo tras respuesta exitosa, manejo de fallos y límites tanto autenticados como anónimos.
- [ ] Verificar despliegue y secretos de `mejorar-sobre` y `sugerir-respuestas-chat` en staging; no asumir que los archivos fuente están desplegados.
- [ ] Implementar en frontend el botón naranja “Denunciar”, el panel de motivos, el envío vinculado a la postulación/chat y la presentación del estado de verificación de empresa. Revisar primero el esquema y las políticas ya existentes en Supabase staging.
- [ ] Resolver el manejo de excepciones inesperadas en `iniciarSesionForm()` y `recuperarForm()`; probar credenciales incorrectas, correo sin confirmar, errores de red, sesión persistente, recuperación, cambio de contraseña, cierre de sesión y redirección por rol.
- [ ] Completar la revisión UX/UI responsive del login y de los flujos de IA.
- [ ] Probar las animaciones de scroll con navegador real, desktop y mobile, incluyendo `prefers-reduced-motion`.
- [x] El frontend parte de estado vacío, exige sesión autenticada y carga publicaciones, postulaciones y chats desde Supabase. Pendiente validar los recorridos completos con dos cuentas reales.
- [ ] Antes de producción, resolver los bloqueantes de seguridad y configuración documentados en la sección 15 y comparar el diff completo con el repositorio de producción.

### Reglas para agentes de IA que retomen el trabajo

- Leer esta sección y verificar el HEAD de `main` antes de asumir que una funcionalidad documentada en otra sección sigue implementada.
- Distinguir siempre entre: archivo fuente presente, función desplegada en Supabase, integración activa en frontend y prueba funcional completada. Son cuatro estados diferentes.
- No volver a ejecutar scripts SQL existentes a ciegas. Inspeccionar primero tablas, funciones, políticas y migraciones del proyecto staging.
- Trabajar en `Alternativy/test-empleos` y Supabase staging. Producción requiere autorización explícita.
- Después de cada cambio, informar archivos, commit, validaciones realmente ejecutadas y pruebas que siguen pendientes. No llamar “verificado” a un flujo que solo pasó una inspección estática.


## 17. Limpieza de datos ficticios (12 de noviembre de 2026)

- Se eliminó el acceso sin autenticación y toda la lógica de sesión local que permitía navegar sin una cuenta de Supabase.
- `freshState()` inicia con ofertas, postulaciones, búsquedas, candidatos, chats y notificaciones vacíos.
- `hidratar()` asigna las ofertas y publicaciones obtenidas de Supabase; no mezcla resultados con registros locales de muestra.
- `apply()` exige `real === true` y utiliza `DB.postular()`. Se quitaron los estados automáticos “Vista”/“Respondida” y los mensajes ficticios temporizados.
- `sendChat()` solo persiste el texto que escribió el usuario. Los mensajes de la otra cuenta deben llegar desde Supabase/Realtime.
- `enviarResp()` abre un chat únicamente cuando la empresa selecciona “Me interesa”; ya no crea respuestas o conversaciones ficticias.
- No se borraron usuarios, búsquedas, postulaciones, chats ni mensajes de las bases de staging o producción. Tampoco se modificaron esquemas ni políticas remotas.
- Cambios en `index.html`: `679ef35`, `561e091`, `10cb03d`, `074c77a`, `48fcf11`, `7b37f1e`, `f938402` y `f15e4c1`. También se eliminaron los recursos sin uso `img/logo-cafe-mercado.png`, `img/avatar-tomas.png` e `img/oferta-cafe.jpg` en los commits `6418f24`, `a460e82` y `45e541b`. La documentación se actualizó en `83c6c55`, `2063a81` y esta actualización.
- Verificación pendiente: ejecutar `node --test tests/real-user-offers.test.mjs` y realizar pruebas manuales con una cuenta candidata y una empresa reales. No se declara validación E2E.


## 18. Corrección del cupo semanal en el panel de postulante (12 de noviembre de 2026)

- `DB.cargar()` ejecutaba `cupo_actual()` en la rama de empresa, pero no en la rama de postulante. Como `freshState()` inicializa `S.c.cupo` en `0`, la hidratación del candidato nunca reemplazaba ese valor y el botón “Me interesa” quedaba desactivado aunque Supabase tuviera cupo disponible.
- Se trasladó la llamada RPC `cupo_actual()` a la rama de postulante y se devuelve `cupo` en el objeto de datos que consume `hidratar()`. La empresa ya no ejecuta una RPC que no necesita.
- El cupo sigue siendo calculado y validado por Supabase; `postular()` continúa siendo la autoridad final y descuenta el cupo en servidor.
- Inspección de staging: los perfiles candidatos consultados tenían `cupo = 5`; no había postulaciones de esta semana y solo una postulación histórica en el conjunto consultado. No se modificaron datos ni funciones SQL.
- Commit frontend: `0e5570715319e4ab4f42f31890f2009b968b7c20`.
- Verificación realizada: relectura del archivo desde `main` y comprobación estática de que la rama candidata llama a `cupo_actual()`, devuelve `cupo` y `hidratar()` lo asigna a `S.c.cupo`. Pendiente: probar el login y la postulación desde navegador con una cuenta candidata real.


## 19. Mensajes no leídos y denuncias desde el frontend (12 de noviembre de 2026)

- El contador de navegación ahora contempla mensajes entrantes no leídos en el ítem «Mensajes» para postulantes y empresas. Los INSERT recibidos por Realtime actualizan la conversación y el contador; al abrir el chat se marca como leído.
- Como la tabla `mensajes` no tiene una columna de lectura por usuario, el último ID leído por chat se guarda en `localStorage`, separado por usuario autenticado. Al inicializarse por primera vez, los mensajes históricos existentes se consideran leídos; los mensajes entrantes posteriores generan el contador. La lectura no se sincroniza entre dispositivos/navegadores.
- Se conectó el botón naranja «⚑ Denunciar» en las tarjetas de postulaciones del postulante y dentro de sus chats. El formulario envía motivo, detalle y mensaje a `public.denuncias`, vinculando denunciante, postulación, empresa y, cuando corresponde, chat. Se usan los motivos permitidos por el CHECK constraint actual.
- El backend de testing ya tenía `public.denuncias`, RLS activado y una política INSERT que exige que la postulación y la empresa correspondan al postulante autenticado; no se modificaron esquema, políticas ni datos. No había interfaz ni inserción desde el frontend, por eso la funcionalidad no aparecía.
- El botón en una tarjeta requiere que el frontend pueda resolver el ID de empresa desde una búsqueda activa o desde un chat asociado. Para postulaciones históricas sin búsqueda visible ni chat, la política RLS actual puede impedir resolver/registrar la denuncia desde el frontend; no se amplió el acceso a búsquedas inactivas para evitar reintroducir dependencias RLS circulares.
- Commits frontend: `0f82283e247a79f40d92fd5dc3f4631da3cdd0cf`, `026546bdd0071a323a81df5f03e367ae5f8b2c20`, `3c152f778b00a9951dfde84452d3d2f167c63c19` y `5f8534a5c57e9032596b4cda51d646a5f80bcfb6`.
- Validación realizada: inspección de columnas, claves foráneas, RLS y política INSERT de `denuncias` en Supabase testing; relectura de `index.html` desde `main` y comprobación de que están conectados el listener Realtime, el contador de navegación, el formulario y la inserción. No se ejecutó una prueba E2E ni se creó una denuncia ficticia.

## 20. Corrección del feed y del contador de mensajes no leídos (12 de noviembre de 2026)

- El feed de postulante excluye las búsquedas cuyo `oferta_id` ya figura en las postulaciones devueltas por Supabase. Se conserva la posición del feed al actualizarlo y se ajusta si la oferta visible deja de estar disponible.
- El contador «Mensajes» ahora conserva los IDs de mensajes entrantes no leídos, suma también los mensajes cuyo chat todavía no se hidrató en el estado local y no marca automáticamente como leídos los mensajes recibidos mientras el usuario estaba desconectado. Abrir el chat actualiza el marcador local y limpia su contador.
- Los marcadores siguen almacenándose en `localStorage`; no se agregó una columna de lectura ni sincronización entre dispositivos. Al no existir marcador previo, los mensajes entrantes históricos visibles pueden aparecer como no leídos la primera vez; se limpian al abrir la conversación.
- Se verificó que `mensajes` y `chats` están en la publicación `supabase_realtime`, que las políticas SELECT de `mensajes` permiten a los participantes leer sus conversaciones y que los logs recientes registran conexiones WebSocket y escrituras HTTP 201. Esto confirma la infraestructura de Realtime y la persistencia, pero no sustituye una prueba visual E2E del badge.
- La función «Mejorar sobre mí» permanece en la rama `Implementar-IA`; no está integrada en `main`. La Edge Function `mejorar-sobre` sigue activa en Supabase testing (versión 19). La UI de registro/edición y sus manejadores no forman parte del HTML de `main`; no se fusionó la rama completa para evitar sobrescribir correcciones posteriores del proyecto.
- Commits frontend de esta corrección: `7b2bb6b993409b1c8b414394b37ffaec5d902f2b` y `a8ffdbfeb514c7626a1e5ed000bfb5823e605d13`.
- Verificación realizada: relectura del archivo desde `main` y comprobaciones estáticas de filtrado de ofertas, marcadores de lectura, contador global y manejo de chats no hidratados. Pendiente: probar con dos sesiones reales que una postulación desaparezca del feed y que un mensaje recibido con la sesión cerrada genere el badge al volver a entrar.

## 21. Mejora del campo «Sobre vos» con IA (12 de noviembre de 2026)

- Se integró en el frontend la Edge Function existente `mejorar-sobre`, sin modificar ni desplegar el backend.
- Disponible en staging para postulantes y empresas, tanto durante el registro como en la edición del perfil:
  - Postulante: `rc-sobre` (registro) y `ed-sobre` (edición).
  - Empresa: `re-desc` (registro) y `ede-desc` (edición).
- El usuario debe escribir una descripción de hasta 4.000 caracteres. La IA devuelve una propuesta editable; el texto original no se reemplaza hasta pulsar «Usar esta versión». Si el texto original cambia después de generar la propuesta, no se permite aplicar una sugerencia desactualizada.
- Al aplicar una propuesta durante la edición del perfil, se actualiza el textarea y se marca el campo como mejorado en `ME.datos.ai`; el cambio queda persistido al guardar el perfil. En registro, se actualiza el borrador local del campo.
- Se envía un identificador UUID anónimo persistido en el navegador para permitir la mejora gratuita previa al registro. Para usuarios autenticados, el backend valida la sesión y aplica sus cuotas por cuenta. El frontend muestra el límite informado por el servicio; la validación y reserva de uso siguen del lado servidor.
- Límites definidos por el backend: 5 mejoras por día y 50 por mes para cuentas autenticadas; una mejora gratuita por navegador para visitantes. Se conserva el guard de entorno: la interfaz se muestra en staging, no en producción.
- Se verificó en Supabase testing que `mejorar-sobre` está ACTIVE (versión 19), con validación manual de sesión, y que existen los RPC de reserva/cierre de cuotas para usuarios y visitantes. No se cambió la Edge Function, las claves ni las tablas.
- Verificación frontend: relectura de `index.html` desde `main` y comprobaciones estáticas de los cuatro puntos de entrada, invocación de la función, envío del identificador anónimo, aplicación condicionada a que el original no haya cambiado y persistencia de las marcas por tipo de perfil. Pendiente: prueba interactiva en navegador con cuenta de postulante, cuenta de empresa y visitante anónimo.
- Commit frontend: `5c4c67c74295bc3494a1c8f88fa9e725e8a78256`.

## 22. Orden de candidatos por coincidencia con la búsqueda (12 de noviembre de 2026)

- Al abrir «Ver candidatos» desde una publicación, el listado de postulantes que ya se postularon a esa búsqueda se ordena de mayor a menor coincidencia estimada con sus requisitos.
- El puntaje compara jornada y turno seleccionados en la publicación con las preferencias del perfil, y contrasta términos relevantes del puesto y su descripción con el puesto buscado, rubros, experiencia y texto «Sobre vos» del postulante.
- El porcentaje es una heurística local y explicable, no una predicción de contratación ni una evaluación mediante IA. Si la publicación no tiene criterios suficientes, se muestra «Coincidencia no disponible».
- No se incorporan perfiles que no se hayan postulado a la búsqueda. Se conserva el alcance de privacidad vigente: la empresa ve perfiles vinculados a sus propias postulaciones.
- No se modificaron tablas, funciones, políticas RLS ni datos de Supabase. La lógica corre en el frontend sobre los datos que la empresa ya puede consultar.
- Commit frontend: `e5b5ae8bf6b8adfe77e6a35bf9fd49fac1653e4f`.
- Verificación realizada: inspección del cambio en `index.html` y comprobación estática de la función de puntaje, el orden descendente, la inclusión de datos del perfil y la etiqueta de coincidencia. Pendiente: prueba visual con postulaciones reales de perfiles con distintas preferencias y descripciones; no se ejecutó E2E.

## 23. Verificación manual de empresas: distintivo visual (12 de noviembre de 2026)

- Se inspeccionó el proyecto Supabase de testing `gtnxlkqumppeintdpycn`. Ya existe una infraestructura parcial para registrar verificaciones:
  - `public.empresas_verificadas`: relación pública entre `empresa_id` y `verified_at`, con lectura permitida a usuarios autenticados.
  - `private.empresa_verificacion_revisiones`: registro privado por empresa con `estado` (default `pendiente`), `notas_internas`, `revisado_por`, `revisado_at`, `created_at` y `updated_at`.
  - `private.sync_empresa_verificada()`: trigger function SECURITY DEFINER que agrega/actualiza la empresa en `public.empresas_verificadas` cuando el estado de revisión es `verificada`, y la quita en los demás estados.
- **Objetivo funcional:** mostrar un tilde de verificado únicamente como distintivo visual de confianza para las empresas que hayan sido verificadas manualmente por el equipo de Match Empleos.
- El distintivo no otorga ventajas ni permisos adicionales. No cambia la visibilidad, prioridad o distribución de las publicaciones, el orden del feed, el matching, las postulaciones ni ninguna otra funcionalidad de la plataforma. No debe interpretarse como una garantía sobre ofertas individuales ni como una evaluación automatizada.
- La aprobación, el rechazo y la revocación corresponden exclusivamente a miembros autorizados del equipo Match Empleos. La empresa no puede solicitar o activar el tilde mediante un campo editable de su perfil ni modificar su estado desde el navegador.
- El estado que consume el frontend debe derivarse de la fuente administrada por backend (por ejemplo, `public.empresas_verificadas` o una vista/función segura). No confiar en un booleano enviado por el cliente ni permitir escrituras directas desde el navegador sobre `empresas_verificadas` o la tabla privada de revisiones.
- La insignia se mostrará junto al nombre de la empresa en los contextos donde se identifica a la organización (perfil, publicaciones, tarjetas y chat), siempre que su verificación manual esté vigente.
- Las restricciones de aprobación y modificación deben aplicarse con RLS, privilegios SQL y/o funciones backend autenticadas. Ocultar controles en el frontend no constituye autorización. Conservar la auditoría mediante `revisado_por`, `revisado_at` y, cuando corresponda, `notas_internas`.
- **Implementación visual en frontend (12 de noviembre de 2026):** `DB.cargar()` consulta `public.empresas_verificadas` para los IDs de empresas asociadas a las búsquedas activas y a los chats del postulante. La interfaz deriva un booleano en memoria (`verificada`) a partir de esos IDs; no agrega una columna editable a `perfiles` ni confía en datos enviados por el navegador.
- El tilde verde con check se muestra junto al nombre de la empresa en la tarjeta del feed, el detalle de la publicación, la pantalla de match y la lista/cabecera del chat del postulante. Tiene texto accesible y tooltip «Empresa verificada». No se muestra a empresas sobre sí mismas ni se agrega un control para solicitar o activar la verificación.
- El distintivo es **exclusivamente estético**: no modifica permisos, acceso, visibilidad, prioridad, distribución, matching, postulaciones ni ninguna otra lógica de negocio. No implica garantía sobre una publicación o contratación.
- La consulta es de solo lectura y depende de que la política SELECT existente permita consultar `public.empresas_verificadas` a usuarios autenticados. No se modificaron tablas, funciones, triggers, políticas, permisos ni datos de Supabase.
- Commits frontend: `d93b8f696213987c579eb3a11908d82e89c55539` (consulta y badge inicial) y `a5b4b5c383d4403967a1ade00824e67df134145f` (badge en match y chats).
- Validación realizada: relectura de `index.html` desde `main` y comprobación estática de la consulta de IDs verificados, el booleano derivado y los puntos de renderizado. No se ejecutó prueba visual/E2E con una empresa verificada real.
- Pendiente: definir el mecanismo seguro para autenticar a los miembros del equipo Match Empleos; auditar políticas y privilegios efectivos; probar en staging la lectura de una empresa verificada y otra no verificada; completar aprobación/rechazo/revocación manual y verificar que una empresa no pueda auto-verificarse ni alterar su estado mediante REST.
