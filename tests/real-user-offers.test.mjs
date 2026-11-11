import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `No se encontró la función ${name}`);
  const next = html.indexOf("\n        }", start);
  assert.notEqual(next, -1, `No se pudo delimitar ${name}`);
  return html.slice(start, next + "\n        }".length);
}

test("el frontend ya no contiene un modo de acceso demo", () => {
  assert.doesNotMatch(html, /ME\\.demo|DEMO_VISIBLE|DEMO_HABILITADO|entrarDemo|data-action=["']demo/);
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
  assert.match(hydrate, /S\\.c\\.ofertas\\s*=\\s*ofertasReales/);
  assert.match(hydrate, /S\\.c\\.posts\\s*=\\s*dbPosts/);
  assert.match(hydrate, /S\\.e\\.busquedas\\s*=\\s*dbBus/);
  assert.doesNotMatch(hydrate, /freshState|datos demo|ofertasVisiblesParaUsuario/);
});

test("apply rechaza ofertas que no provienen de Supabase antes de guardar", () => {
  const start = html.indexOf("async function apply(oid)");
  const end = html.indexOf("\n        }", start);
  assert.notEqual(start, -1);
  const apply = html.slice(start, end);
  const guard = apply.indexOf("if (!o || o.real !== true)");
  assert.notEqual(guard, -1);
  assert.ok(guard < apply.indexOf("S.c.cupo--"));
  assert.ok(guard < apply.indexOf("DB.postular"));
  assert.doesNotMatch(apply, /ME\\.demo|puedeAplicarOferta/);
});

test("el cierre de sesión siempre invalida la sesión de Supabase", () => {
  assert.match(html, /sb\\.auth\\.signOut\\(\\)/);
  assert.doesNotMatch(html, /salvo en demo|eraDemo/);
});

test("el acceso y la identidad ya no contemplan sesiones sin usuario", () => {
  assert.match(html, /if \(!ME\.id && a && !PUBLICAS\.includes\(a\)\)/);
  assert.doesNotMatch(html, /DEMO_VISIBLE|DEMO_HABILITADO|ME\.demo/);
});
