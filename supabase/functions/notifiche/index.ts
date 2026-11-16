// Gestionale di cantina — notifiche sul telefono (Web Push).
// 1) Gli utenti iscrivono/disiscrivono il loro telefono (azioni «iscrivi», «disiscrivi», «prova»).
// 2) Il database chiama questa funzione quando un lavoro viene salvato (con un segreto condiviso):
//    qui si decide chi avvisare. Le notifiche contengono solo il titolo del lavoro, niente dosi.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { invia } from "./webpush.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const txt = (s: unknown, n = 300) => String(s ?? "").slice(0, n);
const APERTI = ["dafare", "incorso"];
const CAMPI = ["data", "ora", "mov", "vasche", "prodotti", "arr", "imb", "istruzioni", "titolo", "tipo"];

function titolo(l: any) {
  if (l.titolo) return txt(l.titolo, 80);
  const p = l.arr?.partite;
  if (Array.isArray(p) && p.length) return "Arrivo vino · " + p.map((x: any) => (x.desc || "vino") + (x.L ? " " + Math.round(x.L / 10) / 10 + " hL" : "")).join(" + ");
  return txt(l.tipo || "Lavoro", 60) + (l.num ? " · " + l.num : "");
}
function quando(l: any) {
  const m = String(l.data ?? "").match(/^(\d{4})-(\d\d)-(\d\d)$/);
  return m ? `${m[3]}/${m[2]}${l.ora ? " ore " + l.ora : ""}` : "senza data";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ message: "Usa POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const adm = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await adm.from("config_privata").select("chiave,valore").in("chiave", ["vapid_pub", "vapid_priv", "vapid_sub", "segreto_notifiche"]);
  const C: Record<string, string> = {}; (cfg ?? []).forEach((r: any) => C[r.chiave] = r.valore);
  const V = { pub: C.vapid_pub, priv: C.vapid_priv, sub: C.vapid_sub || "https://gestionale-cantine-garrone.netlify.app" };
  let body: any; try { body = await req.json(); } catch (_) { return out({ message: "Richiesta non valida" }, 400); }

  /* invio a una lista di utenti; gli abbonamenti scaduti si cancellano */
  async function manda(ids: string[], msg: any) {
    if (!ids.length || !V.pub || !V.priv) return 0;
    const { data: subs } = await adm.from("push_iscrizioni").select("endpoint,p256dh,auth,user_id").in("user_id", ids);
    let n = 0;
    await Promise.all((subs ?? []).map(async (s: any) => {
      try {
        const r = await invia(s, msg, V);
        if (r.status === 404 || r.status === 410) await adm.from("push_iscrizioni").delete().eq("endpoint", s.endpoint);
        else if (r.ok) { n++; await adm.from("push_iscrizioni").update({ usato: new Date().toISOString() }).eq("endpoint", s.endpoint); }
        else console.log("push", r.status, await r.text().catch(() => ""));
      } catch (e) { console.log("push errore", String(e)); }
    }));
    return n;
  }

  /* ---------- chiamata dal database: un lavoro è stato salvato ---------- */
  const seg = req.headers.get("x-segreto");
  if (seg !== null) {
    if (!C.segreto_notifiche || seg !== C.segreto_notifiche) return out({ message: "no" }, 403);
    const n = body.new ?? {}, o = body.old ?? null, attore = String(body.attore ?? "");
    const { data: pr } = await adm.from("profili").select("id,nome,ruolo,attivo").eq("attivo", true);
    const P = (pr ?? []) as any[];
    const togli = (ids: string[]) => [...new Set(ids)].filter((i) => i && i !== attore);
    const admin = () => togli(P.filter((p) => p.ruolo === "admin").map((p) => p.id));
    const assegnato = (l: any) => togli(P.filter((p) => l.assegnato && norm(p.nome) === norm(l.assegnato)).map((p) => p.id));
    const opUrl = (id: string) => P.find((p) => p.id === id)?.ruolo === "operatore" ? "/#operatore" : "/#lavori";
    const inviati: string[] = [];
    const a = async (ids: string[], title: string, corpo: string) => {
      for (const id of ids) { await manda([id], { title, body: corpo, url: opUrl(id), tag: "lav-" + n.id }); inviati.push(title); }
    };
    if (APERTI.includes(n.stato) && n.assegnato && (!o || !APERTI.includes(o.stato) || norm(o.assegnato) !== norm(n.assegnato))) {
      await a(assegnato(n), (n.priorita === "alta" ? "Urgente · " : "") + "Nuovo lavoro per te", `${titolo(n)} · ${quando(n)}`);
    } else if (o && APERTI.includes(o.stato) && APERTI.includes(n.stato) && n.assegnato && norm(o.assegnato) === norm(n.assegnato) &&
      CAMPI.some((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null))) {
      await a(assegnato(n), "Lavoro modificato", `${titolo(n)} · ${quando(n)}`);
    }
    if (o && APERTI.includes(o.stato) && ["eseguito", "noneseguito"].includes(n.stato)) {
      const chi = txt(n.esec?.da || "L'operatore", 40);
      await a(admin(), n.stato === "eseguito" ? `${chi} ha segnato fatto` : `${chi}: non fatto`,
        n.stato === "eseguito" ? `${titolo(n)} — da convalidare` : `${titolo(n)} — ${txt(n.esec?.note, 120)}`);
    }
    if (n.segnalazione && (!o || !o.segnalazione)) {
      const s = n.segnalazione;
      await a(admin(), `${s.urgente ? "Urgente · " : ""}Segnalazione da ${txt(s.da, 40)}`, txt(s.testo, 160) + (s.giaFatto ? " (già fatto)" : ""));
    }
    return out({ ok: true, inviati });
  }

  /* ---------- chiamata da un utente collegato ---------- */
  const us = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await us.auth.getUser();
  if (!u?.user) return out({ code: "not_granted", message: "Accesso non valido" }, 401);
  const { data: prof } = await adm.from("profili").select("attivo").eq("id", u.user.id).maybeSingle();
  if (!prof?.attivo) return out({ code: "not_granted", message: "Utente non abilitato" }, 403);
  const az = String(body.azione ?? "");
  if (az === "iscrivi") {
    const s = body.sub ?? {};
    const endpoint = String(s.endpoint ?? ""), p256dh = String(s.keys?.p256dh ?? ""), auth = String(s.keys?.auth ?? "");
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth || endpoint.length > 1000) return out({ message: "Iscrizione non valida" }, 400);
    const { error } = await adm.from("push_iscrizioni").upsert({ endpoint, user_id: u.user.id, p256dh, auth, ua: txt(body.ua, 200) }, { onConflict: "endpoint" });
    if (error) return out({ message: error.message }, 500);
    return out({ ok: true });
  }
  if (az === "disiscrivi") {
    await adm.from("push_iscrizioni").delete().eq("endpoint", String(body.endpoint ?? "")).eq("user_id", u.user.id);
    return out({ ok: true });
  }
  if (az === "prova") {
    const n = await manda([u.user.id], { title: "Notifiche attive", body: "Da ora ricevi qui gli avvisi dei lavori.", url: "/", tag: "prova" });
    return out({ ok: true, inviati: n });
  }
  return out({ message: "Azione sconosciuta" }, 400);
});
