import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MAX_INPUT_CHARS = 4000;
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

  for (const [key, timestamps] of requestsByIp) {
    const active = timestamps.filter((time) => now - time < WINDOW_MS);
    if (active.length) requestsByIp.set(key, active);
    else requestsByIp.delete(key);
  }

  const recent = requestsByIp.get(ip) || [];
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
      console.error("[mejorar-sobre] No se pudo interpretar una variable de claves Supabase.");
    }
  }
  return legacyEnv || null;
}

async function getAuthenticatedUser(req: Request, url: string, publishableKey: string) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: authorization,
    },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return typeof user?.id === "string" ? user.id as string : null;
}

async function callRpc<T>(url: string, secretKey: string, functionName: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`[mejorar-sobre] RPC ${functionName}: HTTP ${response.status}`);
    throw new Error("quota_service_error");
  }
  return payload as T;
}

type QuotaReservation = {
  allowed: boolean;
  reason?: "cooldown" | "daily_limit" | "monthly_limit" | "unauthenticated";
  usage_id?: string;
  retry_after_seconds?: number;
  daily_remaining?: number;
  monthly_remaining?: number;
};

type ModelResult =
  | { ok: true; text: string }
  | { ok: false; status: number; reason: string };

const instructions = [
  "Sos un asistente especializado en mejorar textos de presentación personal para perfiles laborales en Argentina.",
  "Reescribí el texto en español rioplatense natural, claro, profesional y auténtico, manteniendo la primera persona.",
  "Corregí ortografía, gramática, claridad y organización. Destacá habilidades, estudios, intereses y experiencia únicamente cuando estén presentes en el original.",
  "No inventes empleos, estudios, certificaciones, habilidades, logros, fechas, herramientas ni datos personales.",
  "No agregues frases genéricas, exageraciones ni afirmaciones que la persona no haya expresado.",
  "Conservá el sentido y la voz de quien escribe. La extensión debe ser proporcional al texto original y adecuada para un campo Sobre vos de un perfil laboral.",
  "Devolvé únicamente la versión mejorada, sin introducciones, explicaciones, comillas ni formato Markdown.",
].join(" ");

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(model: string, apiKey: string, original: string): Promise<ModelResult> {
  try {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: original }] }],
          generationConfig: { maxOutputTokens: 450, temperature: 0.6 },
        }),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[mejorar-sobre] Gemini ${model}: HTTP ${response.status} ${payload?.error?.status || ""}`);
      return { ok: false, status: response.status, reason: payload?.error?.status || "provider_error" };
    }

    const parts = payload?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((part: { text?: unknown }) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim()
      : "";
    if (!text) return { ok: false, status: 502, reason: "empty_response" };
    return { ok: true, text };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    console.error(`[mejorar-sobre] Gemini ${model}: ${reason}`);
    return { ok: false, status: 0, reason };
  }
}

async function callGroq(model: string, apiKey: string, original: string): Promise<ModelResult> {
  try {
    const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: original },
        ],
        max_completion_tokens: 450,
        temperature: 0.6,
        reasoning_effort: model === "openai/gpt-oss-120b" ? "low" : "none",
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[mejorar-sobre] Groq ${model}: HTTP ${response.status} ${payload?.error?.code || ""}`);
      return { ok: false, status: response.status, reason: payload?.error?.code || "provider_error" };
    }

    const content = payload?.choices?.[0]?.message?.content;
    const text = typeof content === "string"
      ? content.trim()
      : Array.isArray(content)
        ? content.map((part: { text?: unknown }) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim()
        : "";

    if (!text) return { ok: false, status: 502, reason: "empty_response" };
    return { ok: true, text };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    console.error(`[mejorar-sobre] Groq ${model}: ${reason}`);
    return { ok: false, status: 0, reason };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!allowedByRateLimit(req)) {
    return json({ error: "Alcanzaste el límite temporal. Probá nuevamente en un minuto.", code: "ip_rate_limit" }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo de la solicitud no es válido." }, 400);
  }

  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Escribí un texto para mejorar." }, 400);
  }
  const original = text.trim();
  if (original.length > MAX_INPUT_CHARS) {
    return json({ error: "El texto supera el máximo de 4.000 caracteres." }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = readDefaultKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY"));
  const secretKey = readDefaultKey(Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("[mejorar-sobre] Faltan variables de configuración de Supabase para autenticación/cuotas.");
    return json({ error: "El servicio de cuotas no está configurado." }, 503);
  }

  let userId: string | null;
  try {
    userId = await getAuthenticatedUser(req, supabaseUrl, publishableKey);
  } catch {
    return json({ error: "No se pudo validar tu sesión. Volvé a iniciar sesión.", code: "auth_unavailable" }, 503);
  }
  const anonymousId = (body as { anonymousId?: unknown } | null)?.anonymousId;
  const isAnonymous = !userId;
  let anonymousKeyHash: string | null = null;
  let reservation: QuotaReservation | null = null;

  if (isAnonymous) {
    if (typeof anonymousId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonymousId)) {
      return json({ error: "No se pudo validar el acceso gratuito. Actualizá la página e intentá nuevamente.", code: "anonymous_id_required" }, 400);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(anonymousId));
    anonymousKeyHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    try {
      reservation = await callRpc<QuotaReservation>(
        supabaseUrl, secretKey, "reserve_anonymous_ai_usage", { p_key_hash: anonymousKeyHash },
      );
    } catch {
      return json({ error: "No se pudo comprobar el uso gratuito. Probá nuevamente.", code: "anonymous_quota_unavailable" }, 503);
    }
    if (!reservation.allowed) {
      return json({ error: "La mejora gratuita para visitantes ya fue utilizada en este navegador. Registrate para seguir usando la herramienta.", code: "anonymous_already_used" }, 429);
    }
  } else {
    try {
      reservation = await callRpc<QuotaReservation>(
        supabaseUrl, secretKey, "reserve_ai_usage", { p_user_id: userId },
      );
    } catch {
      return json({ error: "No se pudo comprobar tu límite de uso. Probá nuevamente.", code: "quota_unavailable" }, 503);
    }
  }

  if (!isAnonymous && reservation && !reservation.allowed) {
    const messages: Record<string, string> = {
      cooldown: "Esperá unos segundos antes de volver a intentarlo.",
      daily_limit: "Alcanzaste el límite de 5 mejoras por día. Podés volver a intentarlo mañana.",
      monthly_limit: "Alcanzaste el límite de 50 mejoras mensuales.",
      unauthenticated: "Tenés que iniciar sesión para usar esta función.",
    };
    return json({
      error: messages[reservation.reason || ""] || "Alcanzaste tu límite de uso.",
      code: reservation.reason || "quota_exceeded",
      retryAfterSeconds: reservation.retry_after_seconds,
      dailyRemaining: reservation.daily_remaining,
      monthlyRemaining: reservation.monthly_remaining,
    }, reservation.reason === "unauthenticated" ? 401 : 429);
  }

  const usageId = reservation?.usage_id || null;
  const finishUsage = async (success: boolean) => {
    if (isAnonymous && anonymousKeyHash) {
      await callRpc(supabaseUrl, secretKey, "complete_anonymous_ai_usage", {
        p_key_hash: anonymousKeyHash, p_success: success,
      }).catch(() => console.error("[mejorar-sobre] No se pudo cerrar la reserva anónima."));
    } else if (usageId && userId) {
      await callRpc(supabaseUrl, secretKey, "complete_ai_usage", {
        p_user_id: userId, p_usage_id: usageId, p_success: success,
      }).catch(() => console.error("[mejorar-sobre] No se pudo cerrar la reserva de cuota."));
    }
  };
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");

  const chain: Array<{ provider: string; model: string; run: () => Promise<ModelResult> }> = [];

  if (geminiKey) {
    chain.push(
      { provider: "gemini", model: "gemini-3.5-flash-lite", run: () => callGemini("gemini-3.5-flash-lite", geminiKey, original) },
      { provider: "gemini", model: "gemini-3.8-flash", run: () => callGemini("gemini-3.8-flash", geminiKey, original) },
    );
  } else {
    console.error("[mejorar-sobre] GEMINI_API_KEY no está configurada; se omiten los modelos Gemini.");
  }

  if (groqKey) {
    chain.push(
      { provider: "groq", model: "openai/gpt-oss-120b", run: () => callGroq("openai/gpt-oss-120b", groqKey, original) },
      { provider: "groq", model: "qwen/qwen3.8-27b", run: () => callGroq("qwen/qwen3.8-27b", groqKey, original) },
    );
  } else {
    console.error("[mejorar-sobre] GROQ_API_KEY no está configurada; se omiten los modelos Groq.");
  }

  if (chain.length === 0) {
    await finishUsage(false);
    return json({ error: "El servicio de IA no está configurado. Faltan las claves de los proveedores." }, 503);
  }

  for (const candidate of chain) {
    console.log(`[mejorar-sobre] Consultando ${candidate.provider}/${candidate.model}.`);
    const result = await candidate.run();
    if (result.ok) {
      await finishUsage(true);
      console.log(`[mejorar-sobre] Respuesta exitosa con ${candidate.model}.`);
      return json({
        improvedText: result.text,
        model: candidate.model,
        ...(isAnonymous ? { anonymousRemaining: 0 } : {
          dailyRemaining: reservation?.daily_remaining,
          monthlyRemaining: reservation?.monthly_remaining,
        }),
      });
    }
    console.warn(`[mejorar-sobre] ${candidate.model} no disponible (${result.reason}); se continúa con el siguiente modelo.`);
  }

  await finishUsage(false);
  return json({ error: "Los servicios de IA no pudieron procesar el texto. Probá nuevamente más tarde." }, 502);
});
