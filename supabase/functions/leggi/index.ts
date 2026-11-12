// Lettura documenti (referti, giacenze Maxidata, planimetrie) con Claude per il gestionale di cantina.
// Solo utenti con profilo attivo (non operatori). La chiave Anthropic resta nei segreti del progetto.
// La risposta arriva a pezzi (streaming): se supera il tempo massimo della funzione si interrompe con un messaggio chiaro.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const LIMITE_MS = 135000; // la funzione viene chiusa a 150 s: ci fermiamo prima e lo diciamo

function estraiJson(t: string) {
  const s = t.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(s); } catch (_) { /* continua */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { /* */ } }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ code: "method", message: "Usa POST" }, 405);
  const t0 = Date.now();
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return out({ code: "not_granted", message: "Accesso non valido" }, 401);
  const { data: prof } = await sb.from("profili").select("attivo,ruolo").eq("id", u.user.id).maybeSingle();
  if (!prof?.attivo || prof.ruolo === "operatore") return out({ code: "not_granted", message: "Utente non autorizzato" }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return out({ code: "no_key", message: "Chiave API Anthropic non impostata nei segreti del progetto" }, 500);
  let body: any;
  try { body = await req.json(); } catch (_) { return out({ code: "bad_request", message: "Richiesta non valida" }, 400); }
  const prompt = String(body?.prompt ?? "");
  if (!prompt) return out({ code: "bad_request", message: "Manca il testo" }, 400);
  const imgs: { media_type: string; data: string }[] = Array.isArray(body?.images) ? body.images.slice(0, 8) : [];
  const content: any[] = imgs.map((i) => ({ type: "image", source: { type: "base64", media_type: i.media_type || "image/jpeg", data: i.data } }));
  content.push({ type: "text", text: prompt + (body?.json ? "\n\nRispondi esclusivamente con JSON valido, senza testo prima o dopo." : "") });
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
  console.log(JSON.stringify({ evento: "inizio", model, immagini: imgs.length, kb: Math.round(imgs.reduce((s, i) => s + (i.data?.length || 0), 0) * 0.75 / 1024), testo: prompt.length }));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LIMITE_MS - (Date.now() - t0));
  let text = "", stop = "", outTok = 0, primo = 0;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 16000, stream: true, messages: [{ role: "user", content }] }),
    });
    if (!r.ok || !r.body) {
      const t = await r.text();
      console.log(JSON.stringify({ evento: "errore_api", status: r.status, ms: Date.now() - t0, dettaglio: t.slice(0, 300) }));
      const code = r.status === 429 ? "rate_limited" : r.status === 401 ? "no_key" : r.status === 529 ? "overloaded" : "api_error";
      const msg = r.status === 401 ? "Chiave API Anthropic non valida" : r.status === 429 ? "Limite di utilizzo raggiunto: riprova tra poco" : r.status === 529 ? "Il servizio è sovraccarico: riprova tra qualche minuto" : `Errore API Anthropic (${r.status})`;
      return out({ code, message: msg, detail: t.slice(0, 500) }, 502);
    }
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev: any; try { ev = JSON.parse(line.slice(5)); } catch (_) { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { if (!primo) primo = Date.now() - t0; text += ev.delta.text; }
        else if (ev.type === "message_delta") { stop = ev.delta?.stop_reason || stop; outTok = ev.usage?.output_tokens || outTok; }
        else if (ev.type === "error") { console.log(JSON.stringify({ evento: "errore_stream", errore: ev.error })); return out({ code: ev.error?.type === "overloaded_error" ? "overloaded" : "api_error", message: ev.error?.type === "overloaded_error" ? "Il servizio è sovraccarico: riprova tra qualche minuto" : "Errore durante la lettura: " + (ev.error?.message || "") }, 502); }
      }
    }
  } catch (e) {
    const scaduto = ctl.signal.aborted;
    console.log(JSON.stringify({ evento: scaduto ? "tempo_scaduto" : "errore_rete", ms: Date.now() - t0, primo_ms: primo, caratteri: text.length, errore: String(e) }));
    if (scaduto) return out({ code: "timeout", message: primo ? "La lettura è troppo lunga per finire in tempo (oltre 2 minuti): prova con meno pagine o con un documento più corto." : "Il servizio non ha risposto in tempo: riprova tra qualche minuto." }, 504);
    return out({ code: "api_error", message: "Collegamento con il servizio non riuscito: riprova." }, 502);
  } finally { clearTimeout(timer); }
  console.log(JSON.stringify({ evento: "fine", ms: Date.now() - t0, primo_ms: primo, token_uscita: outTok, stop }));
  if (stop === "max_tokens") return out({ code: "too_long", message: "Il documento è troppo lungo per essere letto in una volta: dividilo in parti." }, 502);
  if (body?.json) {
    const v = estraiJson(text);
    if (v === null) return out({ code: "invalid_json", message: "Risposta non leggibile", text: text.slice(0, 2000) }, 502);
    return out({ json: v });
  }
  return out({ text });
});
