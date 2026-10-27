# Match Empleos

Plataforma que conecta candidatos (personas que buscan trabajo) con empresas que publican búsquedas. Idioma de la interfaz: **español rioplatense** (voseo: "Creá", "Contanos", "Escribí").

Este documento está pensado para dos lectores: personas del equipo y agentes de IA que trabajen en el proyecto. Si sos un agente, leé primero la sección [Reglas para agentes](#reglas-para-agentes-de-ia).

---

## 1. Resumen rápido

| Qué | Dónde / cómo |
|---|---|
| Frontend | Un único archivo: `index.html` (HTML + CSS + JS). Sin build, sin npm, sin framework. |
| Backend | Supabase (Postgres + Auth + API REST). Proyecto de staging: `gtnxlkqumppeintdpycn`. |
| Cliente de Supabase | `vendor/supabase.js` (versión **2.45.4**, copiada tal cual desde npm). |
| Migraciones SQL | `supabase/migrations/` (001 histórica, 002 vigente). |
| Entornos | `staging` (por defecto) y `prod` (solo si el host es el de producción). |
| Repos | `Alternativy/MatchEmpleos` (repo oficial) y `Alternativy/test-empleos` (pruebas). |
| Rama principal actual | `main` |

---

## 2. Cómo correr el proyecto en local

1. Clonar el repo y cambiar a la rama de trabajo:
   ```bash
   git checkout feature/supabase-crud
   ```
2. Abrir la carpeta en VS Code y usar **Live Server** (botón "Go Live"), o servir la carpeta con cualquier servidor estático. **No abrir `index.html` con doble clic**: Supabase Auth necesita un origen `http://`.
3. Verificar en la consola del navegador la línea `[db] entorno: staging`. Si aparece `prod`, el host no es el esperado.

Para que el login y los enlaces de correo funcionen en local, el host (por ejemplo `http://127.0.0.1:5500`) tiene que estar en **Authentication > URL Configuration > Redirect URLs** del proyecto de Supabase.

---

## 3. Estructura del repo

```
index.html                       App completa (routing, UI, estado, auth y acceso a datos)
vendor/supabase.js               Cliente de Supabase 2.45.4 (código de terceros, no editar)
img/                             Logos, avatares e ilustraciones
supabase/migrations/
  001_crud_inicial.sql           Esquema inicial con IDs de texto y RLS abierta (histórica, superada)
  002_auth_por_usuario.sql       Esquema vigente: perfiles ligados a auth.users, trigger y RLS por usuario
README.md                        Este documento
```

**Importante:** `db.js` ya no existe. Su código está dentro de `index.html`, en el primer `<script>`.

### Estructura interna de `index.html`

1. **Estilos** (`<style>`): variables CSS en `:root` (`--navy`, `--green`, `--gray`, etc.), con paleta azul prusiano, verde primaveral y alabastro. Clases como `.btn`, `.field`, `.hint`, `.chip`.
2. **Script de datos** (primer `<script>`): configuración de entornos, cliente de Supabase (`sb`), identidad (`ME`) y el objeto `DB` con todas las escrituras y lecturas.
3. **Script principal** (segundo `<script>`, dentro de una IIFE): estado global `S`, datos de ejemplo (`freshState`), plantillas de pantallas, routing (`route`), autenticación, handlers de eventos y arranque.

---

## 4. Routing

La app usa rutas por hash (`#/...`). No hay servidor de rutas.

| Ruta | Pantalla |
|---|---|
| `#/` | Landing pública |
| `#/login`, `#/recuperar`, `#/nueva-clave` | Autenticación |
| `#/registro`, `#/registro/c/1..5`, `#/registro/e/1..5`, `#/registro/terminos/{c\|e}` | Registro de candidato y de empresa |
| `#/confirmar` | "Revisá tu correo" |
| `#/c/...` | Área del candidato (feed, postulaciones, chat, perfil, configuración) |
| `#/e/...` | Área de la empresa (panel, búsquedas, candidatos, chat) |
| `#/privacidad`, `#/terminos`, `#/ayuda` | Páginas legales |

**Guardia de rutas:** `route()` deja pasar sin sesión solo a las rutas de `PUBLICAS`. Un candidato que entra a `#/e/...` (o al revés) es redirigido a su área.

---

## 5. Estado de la aplicación

- `S` es el estado de la UI en memoria: `S.c` (candidato) y `S.e` (empresa). Se construye con `freshState()`.
- `freshState()` **contiene datos de ejemplo** para el modo demo.
- En una sesión real, `hidratar()` lee de Supabase las postulaciones, búsquedas, respuestas, mensajes, cupo y tasa del usuario. Para un candidato real, `S.c.posts` se reemplaza por sus postulaciones reales y no se agregan las postulaciones demo; los chats base tampoco se cargan. Para una empresa real, `S.e.busquedas` se construye solo con sus búsquedas de Supabase y `S.e.notifs` se inicializa vacío.
- Las ofertas reales publicadas por empresas se incorporan al feed del candidato y llevan `real:true`. Al pulsar "Me interesa" sobre una oferta real, se crea una postulación en `postulaciones`; no se ejecutan las simulaciones de "vista" ni de respuesta automática.
- `ME` guarda la identidad: `ME.id` (uuid de Auth), `ME.rol` (`'c'` o `'e'`), `ME.nombre` y `ME.demo`.

---

## 6. Modo demo

- Los botones "Entrar como candidato" / "Entrar como empresa" de la pantalla de login activan `ME.demo = true`.
- En demo **no se escribe nada en la base**: `persistir()` devuelve `null` antes de ejecutar cualquier consulta.
- Se controla con la constante `DEMO_HABILITADO` (en `index.html`). Ponerla en `false` oculta los botones y desactiva `entrarDemo`.
- Por ahora está en `true`, porque el equipo lo usa para pruebas.

---

## 7. Autenticación

### Flujo de registro (candidato)

1. **`#/registro`**: el usuario elige "Busco trabajo" o "Busco gente para mi empresa". Antes escribe correo y contraseña. Los botones quedan deshabilitados hasta que son válidos.
2. **Paso 1** (`#/registro/c/1`): nombre, apellido, correo y contraseña. El correo y la contraseña tienen que coincidir con los de la pantalla anterior (`verificarCoincidencia`).
3. **Pasos 2 a 5**: edad, ubicación, experiencia, rubros, tipo de empleo, modalidad, horario y perfil. Los datos quedan en memoria (`regDraft` y `S.reg.chips`).
4. **Términos** (`#/registro/terminos/c`): el botón "Crear mi cuenta" llama a `crearCuenta()`.
5. **`crearCuenta()`** llama a `sb.auth.signUp` con:
   ```js
   { email, password, options: { data: { rol, nombre, display_name, full_name, datos: perfilDatos() } } }
   ```
   `perfilDatos()` junta los campos `rc-*`, `re-*` y `rx-*` (sin correo, contraseña ni CV) y los chips de `S.reg`.
6. Si la confirmación por correo está activa, `data.session` es `null` y la app muestra `#/confirmar`. Si no, entra directo.
7. El trigger `on_auth_user_created` (en la 002) crea la fila en `perfiles` con `rol`, `nombre` y `datos`.
8. Al confirmar el correo, el enlace vuelve a la URL base. El listener de `onAuthStateChange` detecta `SIGNED_IN` y lleva al panel correspondiente.

### Login

- `iniciarSesionForm()` valida formato de correo y largo de contraseña (mínimo 8) antes de llamar a `signInWithPassword`.
- Si el correo no está confirmado, se muestra un mensaje con el botón "Reenviar correo" (`sb.auth.resend`).
- Si las credenciales no coinciden, se muestra un mensaje genérico con el enlace "¿Olvidaste tu contraseña?". El motivo real se registra en la consola (`[auth] login falló`).

### Recuperación de contraseña

- `recuperarForm()` llama a `resetPasswordForEmail` con `redirectTo` = origen + ruta actual (sin hash).
- Al volver desde el correo, Supabase emite `PASSWORD_RECOVERY` y la app lleva a `#/nueva-clave`.

### Cerrar sesión

- El botón de salir llama a `sb.auth.signOut()` (salvo en demo) y limpia `ME` y `S`.

### Reglas de validación en formularios

| Campo | Regla |
|---|---|
| Correo | Formato `algo@algo.dominio` (regex `EMAIL_RE`). |
| Contraseña | Mínimo 8 caracteres. |
| Nombre, apellido, responsable | Solo letras de alfabetos latinos y espacios (`\p{Script=Latin}`). Sin números ni símbolos. |
| Edad | Solo dígitos, máximo 2. |
| Correo y contraseña del paso 1 | Deben coincidir con los de "Busco trabajo". |

Los campos conservan lo escrito al volver atrás: `regField()` y los inputs de `registro()` leen `regDraft`.

---

## 8. Base de datos

### Proyecto

- **Staging:** `gtnxlkqumppeintdpycn` (región us-east-1). Es el proyecto que usan las pruebas y el que está configurado en `ENTORNOS.staging`.
- **Producción:** todavía **no existe**. `ENTORNOS.prod` tiene valores `PENDIENTE`.

### Tablas (esquema 002)

| Tabla | Contenido | Clave / relaciones |
|---|---|---|
| `perfiles` | Una fila por cuenta. `rol` (`c`/`e`), `nombre`, `cupo`, `tasa`, `demora`, `plazo`, `datos` (jsonb con el onboarding). | `id` = `auth.users.id` (uuid), con `on delete cascade`. |
| `postulaciones` | Postulaciones de un candidato a una oferta. `datos` guarda el objeto de la postulación y el chat. | `candidato_id` → `perfiles`. Único por (candidato, oferta). |
| `busquedas` | Búsquedas publicadas por una empresa. | `empresa_id` → `perfiles`. |
| `candidatos_estado` | Respuesta de una empresa a un candidato: `si`, `mas`, `no`. | `empresa_id` → `perfiles`. `id` es texto. |
| `mensajes` | Mensajes de todos los chats. | Se usan claves históricas `c:<oferta>` / `e:<candidato>` para el modo anterior y `chat:<postulacion>` para conversaciones reales compartidas entre candidato y empresa. |

### Trigger

`on_auth_user_created` (sobre `auth.users`) ejecuta `handle_new_user()`, que inserta en `perfiles` usando `raw_user_meta_data`: `rol`, `nombre` y `datos`. Si `rol` no es `c` o `e`, el `check` de la tabla rechaza el registro.

### RLS (Row Level Security)

Todas las tablas tienen RLS activo. Las políticas son por dueño:

- `perfiles`: leer y editar solo la propia fila. Del lado del cliente solo se pueden actualizar `nombre`, `cupo` y `tasa` (ver pendientes).
- `postulaciones`: el candidato gestiona las suyas.
- `busquedas` y `candidatos_estado`: la empresa gestiona las suyas.
- `mensajes`: se permite si el chat pertenece al usuario. La política vigente admite las claves históricas `c:<oferta>` / `e:<candidato>` y la clave compartida `chat:<postulacion>` cuando la postulación corresponde al candidato autenticado o a una oferta de la empresa autenticada.
- La tabla `mensajes` está habilitada en la publicación `supabase_realtime` en staging para recibir inserts en tiempo real.

### Migraciones

- Se aplican en orden numérico.
- **002 es destructiva**: borra y recrea las tablas porque cambia los ids de `text` a `uuid`. Solo se aplica en staging, o sobre una base vacía.
- La política de `mensajes` y la habilitación de `mensajes` en `supabase_realtime` se ajustaron en staging durante la implementación del chat real. **Ese cambio debe quedar versionado en una migración `003_...sql` antes de recrear el proyecto o desplegar a otro entorno.**
- No cambiar tablas a mano en el editor de Supabase. Todo cambio futuro va en un archivo nuevo de `supabase/migrations/`.

### Configuración del proyecto (Dashboard)

- **Authentication > URL Configuration**: Site URL y Redirect URLs. Tienen que incluir los dominios de producción, `www`, y los hosts de pruebas (`127.0.0.1:5500`, `localhost:5500`). Si una URL falta, el enlace del correo falla.
- **Authentication > Sign In / Providers > Email**: "Confirm email" decide si hay que confirmar antes de entrar.
- **Authentication > Email Templates**: la plantilla por defecto está en inglés. Pendiente personalizarla.
- **SMTP**: el envío por defecto de Supabase tiene límites bajos. Producción necesita un SMTP propio.

---

## 9. Pendientes y limitaciones conocidas

Estos puntos **bloquean producción**. Están documentados para que nadie los pase por alto.

1. **El rol se toma de la metadata del registro.** Cualquiera con la anon key puede llamar a `signUp` con `rol: 'e'`. Solución propuesta: que el trigger asigne siempre `'c'` y que el rol de empresa se asigne desde el servidor (verificación manual o función protegida).
2. **Datos de ejemplo solo en demo / compatibilidad.** `freshState()` sigue conteniendo datos ficticios, pero las sesiones reales ya no los mezclan en los principales listados: el candidato real no recibe las postulaciones demo ni el chat de Farmacia Sur; sus notificaciones base filtran Farmacia Sur y Supermercado Norte. La empresa real no recibe las búsquedas demo ni las notificaciones demo.
3. **Chat real implementado en cliente + Supabase.** Las conversaciones reales usan `chat:<postulacion>`, los mensajes se guardan en `mensajes` y existe una suscripción Realtime a inserts. Las respuestas automáticas quedan restringidas a `ME.demo`. Sin embargo, `hidratar()` todavía carga explícitamente los mensajes históricos con las claves antiguas `c:<oferta>` / `e:<candidato>`; el historial de una conversación real con `chat:<postulacion>` debe terminar de incorporarse al cargar la sesión. Además, la escritura de mensajes sigue estando autorizada por RLS para el cliente, por lo que la identidad del remitente debe reforzarse en servidor antes de producción.
4. **`cupo` y `tasa` los modifica el cliente.** Debería cambiarse con una función del servidor (RPC).
5. **El modelo de empresa es de demo.** Los candidatos que ve una empresa no vienen de las postulaciones reales en la base. Requiere rediseñar cómo una oferta se relaciona con una empresa.
6. **El CV no se guarda.** Subirlo a Storage requiere sesión, así que debe hacerse en el primer inicio de sesión.
7. **Los datos del onboarding no son editables** después del registro. Se guardan en `perfiles.datos`, pero no hay pantalla para modificarlos.
8. **Las ofertas demo están en el código** (`offerById`, `freshState`), pero las ofertas publicadas por empresas reales se leen de `busquedas` y se incorporan al feed del candidato.
9. **Los ids de postulaciones reales** se generan en el navegador con `'p'+crypto.randomUUID()`; el modo demo conserva su lógica de prueba. Los ids de mensajes los genera la base.
10. **Las transiciones automáticas de estado ya no se aplican a ofertas reales.** La ruta real de postulación crea `Enviada` y espera una acción real de la empresa. Los `setTimeout` de `apply()` y las respuestas automáticas siguen existiendo únicamente para las ofertas/demo antiguas. Si se recarga una sesión real, no debe suponerse que esos temporizadores continúan.
11. **Sin pruebas automatizadas.** Todo se prueba a mano. Ver checklist en la sección 10.
12. **Rate limiting, CAPTCHA y contraseñas filtradas** no están configurados. Conviene activarlos en Auth antes de producción.
13. **Historial de chat real:** el canal Realtime actualiza mensajes nuevos, pero la hidratación del historial todavía debe unificar completamente `chat:<postulacion>` con las claves históricas `c:<oferta>` / `e:<candidato>`.
14. **Versionado de RLS de chat:** la política de `mensajes` que admite `chat:<postulacion>` fue aplicada en staging pero todavía debe guardarse como migración en `supabase/migrations/`.
15. **Notificaciones reales:** las notificaciones de candidato no se persisten en una tabla; las que aparecen en sesión real son estado de UI. El filtrado actual elimina de las notificaciones base las referencias a Farmacia Sur y Supermercado Norte.
13. **Empresa:** el nombre de la empresa acepta números y símbolos, a propósito.
14. **Mensajes de error reveladores:** "Ya existe una cuenta con ese correo" permite averiguar qué correos están registrados. Debería ser un mensaje genérico.

---

## 10. Checklist de prueba manual

Antes de mergear a `main`:

- [ ] Modo demo: entrar como candidato y como empresa, postular y publicar. No aparecen filas nuevas en Supabase.
- [ ] Candidato real: sus postulaciones muestran solo filas de `postulaciones` propias; no aparecen las postulaciones demo.
- [ ] Candidato real: `Mensajes` no muestra el chat demo de Farmacia Sur.
- [ ] Candidato real: `Notificaciones` conserva las otras notificaciones base y elimina Farmacia Sur y Supermercado Norte.
- [ ] Candidato real: "Me interesa" sobre una oferta real crea una fila en `postulaciones` y no dispara notificaciones ni respuestas automáticas.
- [ ] Empresa real: `Tus búsquedas` muestra las filas de `busquedas` propias y no "Ayudante de cocina" / "Cajero fin de semana" salvo que el usuario realmente las haya publicado.
- [ ] Empresa real: no aparecen las notificaciones demo.
- [ ] Empresa real: al responder una postulación, la conversación usa `chat:<postulacion>` y no genera una respuesta automática.
- [ ] Dos sesiones reales: un mensaje enviado por una parte aparece en la otra mediante Realtime.


- [ ] Login con "Hola" en correo: no avanza, muestra el aviso debajo del campo.
- [ ] "Busco trabajo" con datos inválidos: botones deshabilitados, aviso visible.
- [ ] Registro completo de candidato con un correo real. Llega el correo, se confirma, entra al feed.
- [ ] En la base, `perfiles` tiene la fila con `rol`, `nombre` y `datos` (edad, rubros, horario).
- [ ] Volver atrás en el registro conserva los datos escritos.
- [ ] Nombre con números o símbolos: se borran y aparece el aviso. Nombre con ñ, ç, acentos: se acepta.
- [ ] Edad con letras: no se escriben.
- [ ] Paso 1 con correo o contraseña distintos a los de "Busco trabajo": no avanza, el aviso explica por qué.
- [ ] Login con correo sin confirmar: aparece "Reenviar correo".
- [ ] Recuperación de contraseña: llega el enlace y permite elegir una nueva.
- [ ] Cerrar sesión: vuelve al login.
- [ ] Dos cuentas distintas no ven los datos de la otra.
- [ ] Consola sin errores de Supabase ni del navegador (los avisos de Tracking Prevention deben haber desaparecido al servir `vendor/supabase.js`).

---

## 11. Reglas para agentes de IA

Si sos un agente que trabaja en este repo, seguí estas reglas:

1. **Nunca pongas una `service_role` key en el código ni en el repo.** La anon key sí es pública y ya está en `index.html`.
2. **No edites `vendor/supabase.js`.** Si hace falta otra versión, se reemplaza el archivo completo y se actualiza la versión en esta documentación.
3. **No apliques migraciones destructivas** (como la 002) sobre una base con datos que alguien quiera conservar. Preguntá primero.
4. **Toda escritura a la base pasa por `persistir()`**, así los errores llegan a la UI con el evento `db-error`. No llames a `sb.from(...)` directo desde la UI.
5. **No llames a `sb.*` dentro de un callback de `onAuthStateChange` sin `setTimeout`.** Ya está resuelto en el código: no lo reviertas.
6. **Respetá la validación de campos** descrita en la sección 7. Si agregás un campo, definí sus reglas.
7. **Los textos de la interfaz van en español rioplatense**, con voseo.
8. **Cualquier cambio de esquema va en una migración nueva** (`003_...sql`), nunca editando una existente ya aplicada.
9. **Después de cambiar `index.html`, validá la sintaxis** de cada `<script>` (por ejemplo con `node --check` sobre el contenido extraído).
10. **No cambies `DEMO_HABILITADO` a `false` sin confirmación del equipo.**
11. **No reutilices las claves `c:<oferta>` / `e:<candidato>` para un chat real nuevo.** Las conversaciones reales deben usar `chat:<postulacion>` y conservar el mismo identificador en ambos lados.
12. **No reintroduzcas respuestas automáticas en cuentas reales.** Los temporizadores de `sendChat()` y de `enviarResp()` están deliberadamente protegidos por `ME.demo`.
13. **Al modificar `hidratar()`, preservá la separación demo/real.** Un candidato real no debe recibir las postulaciones o chats de `freshState()`, y una empresa real no debe recibir búsquedas o notificaciones demo.
14. **Antes de cambiar la lógica de autenticación**, revisá la sección 7 completa: los pasos de registro, confirmación y login están conectados entre sí.
15. **Si tenés dudas sobre producto** (qué datos mostrar, cómo se relacionan empresas y ofertas), preguntá. Hay decisiones pendientes que no las tomó el código.

---

## 12. Contacto y decisiones abiertas

Decisiones que todavía no están tomadas:

- ¿Se confirma el correo antes de entrar o se permite entrar y completar el perfil después?
- ¿Cómo se asigna el rol de empresa (verificación manual o automática)?
- ¿Se borran los datos de ejemplo o se reemplazan por datos reales antes de producción?
- ¿Cómo se relacionan las ofertas con las empresas?
- ¿Se crea un proyecto de Supabase separado para producción?

Responsable del proyecto: [completar]
