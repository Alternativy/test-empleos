import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";
const MAX_INPUT_CHARS = 4000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
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
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return false;
  recent.push(now);
  requestsByIp.set(ip, recent);
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!allowedByRateLimit(req)) return json({ error: "Alcanzaste el límite temporal. Probá nuevamente en un minuto." }, 429);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("[mejorar-sobre] Falta configurar OPENAI_API_KEY.");
    return json({ error: "El servicio de IA todavía no está configurado." }, 503);
  }

  let text: unknown;
  try { text = (await req.json())?.text; }
  catch { return json({ error: "El cuerpo de la solicitud no es válido." }, 400); }

  if (typeof text !== "string" || !text.trim()) return json({ error: "Escribí un texto para mejorar." }, 400);
  const original = text.trim();
  if (original.length > MAX_INPUT_CHARS) return json({ error: "El texto supera el máximo de 4.000 caracteres." }, 413);

  const instructions = [
    "Sos un asistente especializado en mejorar textos de presentación personal para perfiles laborales en Argentina.",
    "Reescribí el texto en español rioplatense natural, claro, profesional y auténtico, manteniendo la primera persona.",
    "Corregí ortografía, gramática, claridad y organización. Destacá habilidades, estudios, intereses y experiencia únicamente cuando estén presentes en el original.",
    "No inventes empleos, estudios, certificaciones, habilidades, logros, fechas, herramientas ni datos personales.",
    "No agregues frases genéricas, exageraciones ni afirmaciones que la persona no haya expresado.",
    "Conservá el sentido y la voz de quien escribe. La extensión debe ser proporcional al texto original y adecuada para un campo Sobre vos de un perfil laboral.",
    "Devolvé únicamente la versión mejorada, sin introducciones, explicaciones, comillas ni formato Markdown.",
  ].join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, instructions, input: original, max_output_tokens: 450, store: false }),
    });
    const payload = await response.json();
    if (!response.ok) {
      console.error("[mejorar-sobre] OpenAI API error:", response.status, payload?.error?.type || "unknown");
      return json({ error: "El servicio de IA no pudo procesar el texto." }, 502);
    }
    const improvedText = (payload.output || [])
      .flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
      .filter((part: { type?: string }) => part.type === "output_text")
      .map((part: { text?: string }) => part.text || "")
      .join("\n").trim();
    if (!improvedText) {
      console.error("[mejorar-sobre] OpenAI devolvió una respuesta vacía.");
      return json({ error: "No se recibió una sugerencia válida." }, 502);
    }
    return json({ improvedText, model: MODEL });
  } catch (error) {
    console.error("[mejorar-sobre] Error de conexión:", error);
    return json({ error: "No se pudo conectar con el servicio de IA." }, 502);
  }
});
