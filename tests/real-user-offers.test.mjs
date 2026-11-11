import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function loadFunction(name) {
  const match = html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n        \\}`));
  assert.ok(match, `No se encontró la función ${name} en index.html`);
  return vm.runInNewContext(`(${match[0]})`);
}

const ofertasVisiblesParaUsuario = loadFunction("ofertasVisiblesParaUsuario");
const puedeAplicarOferta = loadFunction("puedeAplicarOferta");

test("una cuenta real solo ve ofertas provenientes de Supabase", () => {
  const ofertas = [
    { id: "db-1", real: true },
    { id: "demo-1" },
    { id: "demo-2", real: false },
  ];
  assert.deepEqual(
    Array.from(ofertasVisiblesParaUsuario(ofertas, false), (o) => o.id),
    ["db-1"],
  );
});

test("el modo demo conserva sus ofertas de ejemplo", () => {
  const ofertas = [{ id: "demo-1" }, { id: "db-1", real: true }];
  assert.deepEqual(
    Array.from(ofertasVisiblesParaUsuario(ofertas, true), (o) => o.id),
    ["demo-1", "db-1"],
  );
});

test("una cuenta real recibe una lista vacía si no hay ofertas reales", () => {
  assert.equal(ofertasVisiblesParaUsuario([], false).length, 0);
});

test("una cuenta real no puede postularse a una oferta demo ni inexistente", () => {
  assert.equal(puedeAplicarOferta({ id: "demo-1" }, false), false);
  assert.equal(puedeAplicarOferta({ id: "demo-2", real: false }, false), false);
  assert.equal(puedeAplicarOferta(null, false), false);
  assert.equal(puedeAplicarOferta({ id: "db-1", real: true }, false), true);
});

test("apply bloquea ofertas no reales antes de modificar estado o guardar", () => {
  const start = html.indexOf("async function apply(oid)");
  assert.notEqual(start, -1);
  const end = html.indexOf("\n        }", start);
  const apply = html.slice(start, end);
  const guard = apply.indexOf("if (!puedeAplicarOferta(o, ME.demo))");
  assert.notEqual(guard, -1);
  assert.ok(guard < apply.indexOf("S.c.cupo--"));
  assert.ok(guard < apply.indexOf("DB.guardarPostulacion"));
  assert.match(apply, /if \(!ME\.demo\)\s*\{/);
});

test("la hidratación reemplaza el feed con ofertas reales, sin anexar datos demo", () => {
  const start = html.indexOf("async function hidratar()");
  const end = html.indexOf("\n        /* ---------- Autenticación", start);
  const hydrate = html.slice(start, end);
  assert.match(hydrate, /S\.c\.ofertas\s*=\s*ofertasVisiblesParaUsuario\(ofertasReales, ME\.demo\)/);
  assert.doesNotMatch(hydrate, /\.\.\.S\.c\.ofertas/);
});

test("el login de un candidato real limpia las ofertas demo antes de hidratar", () => {
  assert.match(html, /if \(!yaCargado\) \{\s*S = freshState\(\);\s*if \(ME\.rol === "c"\) S\.c\.ofertas = \[\];\s*\}\s*await hidratar\(\);/);
});

test("el feed informa cuando todavía no hay búsquedas reales", () => {
  assert.match(html, /Todavía no hay búsquedas publicadas/);
  assert.match(html, /const sinBusquedasReales = !ME\.demo && S\.c\.ofertas\.length === 0/);
});

test("la landing vuelve a renderizarse al recuperar una sesión con avatar", () => {
  const start = html.indexOf("async function setSesion(session)");
  const end = html.indexOf("\\n        document.addEventListener(\"db-error\"", start);
  assert.notEqual(start, -1);
  const setSesion = html.slice(start, end);
  assert.match(setSesion, /select\\("rol,nombre,datos,avatar_url"\\)/);
  assert.match(setSesion, /ME\\.avatarUrl = perfil\\?\\.avatar_url \\|\\| null/);
  assert.match(setSesion, /await hidratar\\(\\);\\s*cargandoSesion = false;\\s*render\\(true\\);/);
  assert.match(html, /const img = ME\\.demo \\?[\\s\\S]{0,180}ME\\.avatarUrl \\|\\| phSrc\\(\\)/);
});
