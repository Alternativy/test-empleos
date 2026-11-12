import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const PROVIDER_TIMEOUT_MS = 18_000;
const requestsByIp = new Map<string, number[]>();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function allowedByRateLimit(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return false;
  recent.push(now);
  requestsByIp.set(ip, recent);
  return true;
}

function readDefaultKey(jsonEnv: string | undefined, legacyEnv: string | undefined): string | null {
  if (jsonEnv) {
    try {
      const keys = JSON.parse(jsonEnv);
      if (typeof keys?.default === "string" && keys.default) return keys.default;
    } catch {
      console.error("[sugerir-respuestas-chat] No se pudo interpretar una variable de claves Supabase.");
    }
  }
  return legacyEnv || null;
}

async function getAuthenticatedUser(req: Request, url: string, publishableKey: string) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return typeof user?.id === "string" ? user.id as string : null;
}

async function restGet<T>(url: string, secretKey: string, table: string, query: Record<string, string>): Promise<T[]> {
  const params = new URLSearchParams(query);
  const response = await fetch(`${url}/rest/v1/${table}?${params.toString()}`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`[sugerir-respuestas-chat] Error consultando ${table}: HTTP ${response.status}`);
    throw new Error("database_error");
  }
  return Array.isArray(payload) ? payload as T[] : [];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type ModelResult = { ok: true; suggestions: string[] } | { ok: false; reason: string };

const instructions = [
  "Sos un asistente de selección y comunicación laboral para empresas de Argentina.",
  "Tu tarea es redactar exactamente tres posibles respuestas breves para que una empresa le responda por chat a una persona postulante.",
  "Escribí en español rioplatense natural, cordial, profesional y humano. Usá el nombre del postulante de forma natural, sin repetirlo innecesariamente.",
  "Las tres opciones deben ser distintas entre sí y listas para revisar, editar y enviar desde un chat.",
  "Usá exclusivamente los datos de empresa y publicación proporcionados. No inventes salarios, beneficios, condiciones, fechas, entrevistas, requisitos, decisiones de selección ni próximos pasos que no estén informados.",
  "No presupongas género, edad, experiencia ni disponibilidad de la persona postulante.",
  "Si falta información, mantené la respuesta general y no completes los datos con suposiciones.",
  "Devolvé únicamente un JSON válido con esta estructura: {\"suggestions\":[\"respuesta 1\",\"respuesta 2\",\"respuesta 3\"]}. Sin Markdown ni texto adicional.",
].join(" ");

function parseSuggestions(raw: string): string[] {
  const cleaned = raw.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const list = Array.isArray(parsed) ? parsed : parsed?.suggestions;
    if (Array.isArray(list)) {
      const items = list.filter((item): item is string => typeof item === "string")
        .map((item) => item.trim()).filter(Boolean);
      if (items.length === 3 && new Set(items.map((item) => item.toLowerCase())).size === 3) return items;
    }
  } catch {
    // Se devuelve error controlado si el modelo no respetó el formato.
  }
  return [];
}

async function callGemini(model: string, apiKey: string, prompt: string): Promise<ModelResult> {
  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.7, responseMimeType: "application/json" },
        }),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[sugerir-respuestas-chat] Gemini ${model}: HTTP ${response.status}`);
      return { ok: false, reason: "provider_error" };
    }
    const parts = payload?.candidates?.[0]?.content?.parts;
    const raw = Array.isArray(parts)
      ? parts.map((part: { text?: unknown }) => typeof part?.text === "string" ? part.text : "").join("\n")
      : "";
    const suggestions = parseSuggestions(raw);
    return suggestions.length === 3 ? { ok: true, suggestions } : { ok: false, reason: "invalid_output" };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    console.error(`[sugerir-respuestas-chat] Gemini ${model}: ${reason}`);
    return { ok: false, reason };
  }
}

async function callGroq(model: string, apiKey: string, prompt: string): Promise<ModelResult> {
  try {
    const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 700,
        temperature: 0.7,
        response_format: { type: "json_object" },
        reasoning_effort: model === "openai/gpt-oss-120b" ? "low" : "none",
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[sugerir-respuestas-chat] Groq ${model}: HTTP ${response.status}`);
      return { ok: false, reason: "provider_error" };
    }
    const content = payload?.choices?.[0]?.message?.content;
    const raw = typeof content === "string" ? content : "";
    const suggestions = parseSuggestions(raw);
    return suggestions.length === 3 ? { ok: true, suggestions } : { ok: false, reason: "invalid_output" };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    console.error(`[sugerir-respuestas-chat] Groq ${model}: ${reason}`);
    return { ok: false, reason };
  }
}

type ProfileRow = { id: string; rol: string; nombre: string | null; datos: Record<string, unknown> | null };
type ChatRow = { id: string; postulacion_id: string; candidato_id: string; empresa_id: string };
type ApplicationRow = { id: string; candidato_id: string; oferta_id: string };
type JobRow = { id: string; empresa_id: string; puesto: string; jornada: string[] | null; turno: string[] | null };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!allowedByRateLimit(req)) {
    return json({ error: "Alcanzaste el límite temporal. Probá nuevamente en un minuto." }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo de la solicitud no es válido." }, 400);
  }
  const chatId = (body as { chatId?: unknown } | null)?.chatId;
  if (typeof chatId !== "string" || !chatId.trim() || chatId.length > 160) {
    return json({ error: "No se identificó la conversación." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = readDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY"));
  const secretKey = readDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("[sugerir-respuestas-chat] Faltan variables de configuración de Supabase.");
    return json({ error: "El servicio de IA no está configurado." }, 503);
  }

  let userId: string | null;
  try {
    userId = await getAuthenticatedUser(req, supabaseUrl, publishableKey);
  } catch {
    return json({ error: "No se pudo validar tu sesión. Volvé a iniciar sesión." }, 503);
  }
  if (!userId) return json({ error: "Tenés que iniciar sesión para usar esta función." }, 401);

  try {
    const [companyRows, chatRows] = await Promise.all([
      restGet<ProfileRow>(supabaseUrl, secretKey, "perfiles", {
        id: `eq.${userId}`, rol: "eq.e", select: "id,rol,nombre,datos", limit: "1",
      }),
      restGet<ChatRow>(supabaseUrl, secretKey, "chats", {
        id: `eq.${chatId}`, empresa_id: `eq.${userId}`,
        select: "id,postulacion_id,candidato_id,empresa_id", limit: "1",
      }),
    ]);
    const company = companyRows[0];
    const chat = chatRows[0];
    if (!company) return json({ error: "Esta función está disponible únicamente para cuentas de empresa." }, 403);
    if (!chat) return json({ error: "No tenés acceso a esta conversación." }, 403);

    const [applicationRows, candidateRows] = await Promise.all([
      restGet<ApplicationRow>(supabaseUrl, secretKey, "postulaciones", {
        id: `eq.${chat.postulacion_id}`, candidato_id: `eq.${chat.candidato_id}`,
        select: "id,candidato_id,oferta_id", limit: "1",
      }),
      restGet<ProfileRow>(supabaseUrl, secretKey, "perfiles", {
        id: `eq.${chat.candidato_id}`, rol: "eq.c", select: "id,rol,nombre,datos", limit: "1",
      }),
    ]);
    const application = applicationRows[0];
    const candidate = candidateRows[0];
    if (!application || !candidate) return json({ error: "No encontramos los datos de esta postulación." }, 404);

    const jobRows = await restGet<JobRow>(supabaseUrl, secretKey, "busquedas", {
      id: `eq.${application.oferta_id}`, empresa_id: `eq.${userId}`,
      select: "id,empresa_id,puesto,jornada,turno", limit: "1",
    });
    const job = jobRows[0];
    if (!job) return json({ error: "No encontramos la publicación asociada a este chat." }, 404);

    const companyData = company.datos || {};
    const fields = (companyData.campos || {}) as Record<string, unknown>;
    const chips = (companyData.chips || {}) as Record<string, unknown>;
    const asText = (value: unknown) => Array.isArray(value)
      ? value.filter((item) => typeof item === "string").join(", ")
      : typeof value === "string" ? value.trim() : "";
    const horario = [
      asText(chips.ehora),
      asText(job.jornada),
      asText(job.turno),
    ].filter(Boolean).join(" · ");

    const businessData = {
      responsable: asText(fields["re-resp"]),
      puesto_a_cubrir: job.puesto || asText(fields["re-puesto"]),
      rubro: asText(fields["re-rubro"]),
      ubicacion: asText(fields["re-ubi"]),
      sector: asText(chips.esector),
      experiencia_requerida: asText(chips.eexp),
      horario: horario || "No especificado",
    };
    const prompt = [
      "Teniendo en cuenta los siguientes datos de la empresa y publicación laboral:",
      JSON.stringify(businessData, null, 2),
      `Nombre del postulante: ${candidate.nombre || "Postulante"}.`,
      "Hacé un módulo de exactamente 3 posibles respuestas para que la empresa pueda responderle por chat al postulante.",
      "Las respuestas deben ser concretas, diferentes entre sí y adecuadas al puesto publicado.",
    ].join("\n\n");

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const groqKey = Deno.env.get("GROQ_API_KEY");
    const chain: Array<{ model: string; run: () => Promise<ModelResult> }> = [];
    if (geminiKey) {
      chain.push(
        { model: "gemini-3.5-flash-lite", run: () => callGemini("gemini-3.5-flash-lite", geminiKey, prompt) },
        { model: "gemini-3.8-flash", run: () => callGemini("gemini-3.8-flash", geminiKey, prompt) },
      );
    }
    if (groqKey) {
      chain.push(
        { model: "openai/gpt-oss-120b", run: () => callGroq("openai/gpt-oss-120b", groqKey, prompt) },
        { model: "qwen/qwen3.8-27b", run: () => callGroq("qwen/qwen3.8-27b", groqKey, prompt) },
      );
    }
    if (!chain.length) return json({ error: "No hay proveedores de IA configurados." }, 503);

    for (const candidateModel of chain) {
      const result = await candidateModel.run();
      if (result.ok) {
        return json({ suggestions: result.suggestions, model: candidateModel.model });
      }
      console.warn(`[sugerir-respuestas-chat] ${candidateModel.model} no disponible: ${result.reason}`);
    }
    return json({ error: "No pudimos generar las respuestas. Probá nuevamente más tarde." }, 502);
  } catch (error) {
    console.error("[sugerir-respuestas-chat] Error interno:", error);
    return json({ error: "No pudimos preparar las respuestas para este chat." }, 500);
  }
});
