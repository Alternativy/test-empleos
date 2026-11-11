import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `No se encontró la función ${name}`);
  const next = html.indexOf("\n        }", start);
  assert.notEqual(next, -1, `No se pudo delimitar ${name}`);
  return html.slice(start, next + "\n        }".length);
}

test("el frontend ya no contiene un modo de acceso demo", () => {
  assert.doesNotMatch(html, /ME\.demo|DEMO_VISIBLE|DEMO_HABILITADO|entrarDemo|data-action=["']demo/);
  assert.doesNotMatch(html, /Café Mercado|Tomás Ferreyra|Farmacia Sur|Supermercado Norte/);
});

test("freshState comienza sin ofertas, postulaciones, chats ni notificaciones ficticias", () => {
  const freshState = extractFunction("freshState");
  assert.match(freshState, /ofertas:\s*\[\]/);
  assert.match(freshState, /posts:\s*\[\]/);
  assert.match(freshState, /chats:\s*\{\}/);
  assert.match(freshState, /notifs:\s*\[\]/);
  assert.match(freshState, /busquedas:\s*\[\]/);
  assert.match(freshState, /pend:\s*\[\]/);
  assert.doesNotMatch(freshState, /Café Mercado|Tomás Ferreyra|Ayudante de cocina/);
});

test("el feed del candidato se carga exclusivamente desde las búsquedas de Supabase", () => {
  const start = html.indexOf("async function hidratar()");
  const end = html.indexOf("\n        /* ---------- Autenticación", start);
  assert.notEqual(start, -1);
  const hydrate = html.slice(start, end);
  assert.match(hydrate, /S\.c\.ofertas\s*=\s*ofertasReales/);
  assert.match(hydrate, /S\.c\.posts\s*=\s*dbPosts/);
  assert.match(hydrate, /S\.e\.busquedas\s*=\s*dbBus/);
  assert.doesNotMatch(hydrate, /freshState|datos demo|ofertasVisiblesParaUsuario/);
});

test("apply valida que la oferta provenga de Supabase antes de ejecutar la postulación", () => {
  const start = html.indexOf("async function apply(oid)");
  const end = html.indexOf("\n        }", start);
  assert.notEqual(start, -1);
  const apply = html.slice(start, end);
  const guard = apply.indexOf("if (o.real !== true)");
  const postular = apply.indexOf("DB.postular(post, oid)");
  const updateCupo = apply.indexOf("S.c.cupo = restante");
  assert.notEqual(guard, -1);
  assert.ok(guard < postular);
  assert.ok(postular < updateCupo);
  assert.doesNotMatch(apply, /ME\.demo|puedeAplicarOferta|setTimeout|later\(/);
});

test("el cierre de sesión siempre invalida la sesión de Supabase", () => {
  assert.match(html, /sb\.auth\.signOut\(\)/);
  assert.doesNotMatch(html, /salvo en demo|eraDemo/);
});

test("el acceso y la identidad ya no contemplan sesiones sin usuario", () => {
  assert.match(html, /if \(!ME\.id && a && !PUBLICAS\.includes\(a\)\)/);
  assert.doesNotMatch(html, /DEMO_VISIBLE|DEMO_HABILITADO|ME\.demo/);
});

test("el campo Sobre vos ofrece mejora con IA tanto en el registro como en edición", () => {
  assert.match(html, /Mejorar con IA/);
  assert.match(html, /sobreIA\("ed-sobre"(?:,[^)]+)?\)/);
  assert.match(html, /writeHere\("rc-sobre"\)/);
  assert.match(html, /sb\.functions\.invoke\("mejorar-sobre"/);
  assert.match(html, /usar-sobre-ia/);
  assert.match(html, /4\.000 caracteres/);
  assert.match(html, /Tu texto se envía al servicio de IA/);
  assert.match(html, /originalSigueIgual/);
  assert.match(html, /button\.textContent = "Mantener original"/);
  assert.match(html, /data-action = "mantener-original"/);
  assert.match(html, /Versión aplicada\. La sugerencia de IA se cerró\./);
  assert.match(html, /Se mantuvo tu texto original\./);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Límite: 5 mejoras por día y 50 por mes/);
  assert.match(html, /data\.dailyRemaining/);
  assert.match(html, /data\.monthlyRemaining/);
  assert.match(html, /leerDetalleErrorIA\(err\)/);
  assert.match(html, /detail\?\.dailyRemaining/);
  assert.match(html, /if \(toggle\) toggle\.hidden = true/);
  assert.match(html, /ai: \{ sobreAplicado: regDraftAIUsed \}/);
  assert.match(html, /sobreAplicado: true/);
  assert.match(html, /button\.dataset\.quotaExhausted = String\(d === 0 \|\| m === 0\)/);
  assert.match(html, /button\.disabled = button\.dataset\.action === "mejorar-sobre"/);
  assert.match(html, /toggle\.disabled = toggle\.dataset\.quotaExhausted === "true"/);
});

test("la integración no expone la clave de OpenAI en el frontend", () => {
  assert.doesNotMatch(html, /OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}/);
});
