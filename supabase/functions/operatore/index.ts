// Gestionale di cantina — funzione per gli operatori (e per gli inviti degli amministratori).
// L'operatore NON legge né scrive direttamente il database: questa funzione gli dà solo i suoi lavori
// (con i dati che servono a mostrarli) e accetta da lui solo «fatto» / «non fatto» e le segnalazioni.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const txt = (s: unknown, n = 2000) => String(s ?? "").slice(0, n);
/* impostazioni che servono a mostrare i lavori (niente conti, provenienze, persone…) */
const IMP = ["azienda", "locali", "recipienti", "prodotti", "prodBase", "v", "pulizia1", "lavorazioni", "parametri", "oinosImportato",
  "fecceUnificate", "profilo", "denominazioni", "varieta", "ultimoBackup", "contiOk", "routine", "scalaFerm", "verifiche"];
const APERTI = ["dafare", "incorso"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return out({ code: "method", message: "Usa POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const us = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await us.auth.getUser();
  if (!u?.user) return out({ code: "not_granted", message: "Accesso non valido" }, 401);
  const adm = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: prof } = await adm.from("profili").select("nome,ruolo,attivo,email").eq("id", u.user.id).maybeSingle();
  if (!prof?.attivo) return out({ code: "not_granted", message: "Utente non abilitato" }, 403);
  let body: any;
  try { body = await req.json(); } catch (_) { return out({ code: "bad_request", message: "Richiesta non valida" }, 400); }
  const az = String(body?.azione ?? "");

  /* ---------- amministratore: invita un nuovo utente ---------- */
  if (az === "invita") {
    if (prof.ruolo !== "admin") return out({ code: "not_granted", message: "Solo un amministratore può invitare" }, 403);
    const email = norm(body.email), nome = txt(body.nome, 60).trim(), ruolo = String(body.ruolo ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out({ code: "bad_request", message: "Email non valida" }, 400);
    if (!nome) return out({ code: "bad_request", message: "Manca il nome" }, 400);
    if (!["operatore", "dipendente", "admin"].includes(ruolo)) return out({ code: "bad_request", message: "Ruolo non valido" }, 400);
    const redirectTo = /^https:\/\/[a-z0-9.-]+(:\d+)?\/[^\s]*$/i.test(String(body.redirectTo ?? "")) ? String(body.redirectTo) : undefined;
    let id: string | null = null, inviato = false;
    const { data: gia } = await adm.from("profili").select("id").eq("email", email).maybeSingle();
    if (gia?.id) id = gia.id;
    else {
      const { data, error } = await adm.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
      if (error) return out({ code: "invite_error", message: "Invito non riuscito: " + error.message }, 400);
      id = data.user?.id ?? null; inviato = true;
    }
    if (!id) return out({ code: "invite_error", message: "Utente non creato" }, 500);
    const { error: pe } = await adm.from("profili").upsert({ id, email, nome, ruolo, attivo: true }, { onConflict: "id" });
    if (pe) return out({ code: "db_error", message: pe.message }, 500);
    return out({ ok: true, inviato, gia: !inviato });
  }

  /* ---------- da qui solo operatori ---------- */
  if (prof.ruolo !== "operatore") return out({ code: "not_granted", message: "Funzione riservata agli operatori" }, 403);
  const nome = norm(prof.nome);
  const suo = (l: any) => l && norm(l.assegnato) === nome;

  if (az === "carica") {
    const { data: rec, error } = await adm.from("record").select("id,data").eq("tipo", "lavoro").range(0, 9999);
    if (error) return out({ code: "db_error", message: error.message }, 500);
    const da = new Date(Date.now() - 14 * 864e5).toISOString();
    const da30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const lavori = (rec ?? []).map((r: any) => r.data).filter((l: any) => l && ((suo(l) &&
      (APERTI.includes(l.stato) || (["eseguito", "noneseguito"].includes(l.stato) && String(l.esec?.dichiaratoIl ?? "") >= da))) ||
      (l.segnalazione && norm(l.segnalazione.da) === nome && String(l.segnalazione.il ?? l.creatoIl ?? "") >= da30)));
    const { data: imp } = await adm.from("impostazioni").select("chiave,valore").in("chiave", IMP);
    const ids = new Set<string>();
    lavori.forEach((l: any) => [l.rif?.vasche, l.attuale?.vasche].forEach((o: any) => Object.values(o ?? {}).forEach((x: any) => { if (x?.vino) ids.add(String(x.vino)); })));
    let vini: any[] = [];
    if (ids.size) {
      const { data: vr } = await adm.from("record").select("data").eq("tipo", "vino").in("id", [...ids]);
      vini = (vr ?? []).map((r: any) => r.data).filter(Boolean).map((v: any) => ({ id: v.id, nome: v.nome, annata: v.annata, tipo: v.tipo, categoria: v.categoria, colore: v.colore, sigla: v.sigla }));
    }
    const S: Record<string, unknown> = {};
    (imp ?? []).forEach((r: any) => { S[r.chiave] = r.valore; });
    return out({ nome: prof.nome, S, lavori, vini });
  }


  /* segnalazione: l'operatore avvisa il responsabile di qualcosa da fare (non cambia la cantina) */
  if (az === "segnala") {
    const x = body.segnalazione ?? {};
    const testo = txt(x.testo, 1000).trim();
    if (!testo) return out({ code: "bad_request", message: "Scrivi cosa c'è da fare" }, 400);
    const vasche = (Array.isArray(x.vasche) ? x.vasche : []).slice(0, 200).map((c: unknown) => txt(c, 40)).filter(Boolean);
    const { data: rec, error } = await adm.from("record").select("id,data").eq("tipo", "lavoro").range(0, 9999);
    if (error) return out({ code: "db_error", message: error.message }, 500);
    const cid = String(x.id ?? "");
    const esiste = (rec ?? []).find((r: any) => r.id === cid);
    if (esiste && esiste.data?.segnalazione && norm(esiste.data.segnalazione.da) === nome) return out({ ok: true, lavoro: esiste.data }); /* già arrivata (invio ripetuto) */
    const id = /^[a-z0-9]{6,40}$/i.test(cid) && !esiste ? cid : crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const n = (rec ?? []).reduce((m: number, r: any) => Math.max(m, Number(String(r.data?.num ?? "").replace(/\D/g, "")) || 0), 0) + 1;
    const now = new Date().toISOString(), gia = !!x.giaFatto, urg = !!x.urgente;
    const l: any = { id, num: "L" + String(n).padStart(4, "0"), titolo: testo.split("\n")[0].slice(0, 80), tipo: "Operazione generica", data: "", ora: "",
      priorita: urg ? "alta" : "normale", assegnato: "", vasche, mov: [], prodotti: [], istruzioni: testo, _v: 2,
      segnalazione: { da: prof.nome, il: now, testo, locale: txt(x.locale, 60), urgente: urg, giaFatto: gia },
      stato: gia ? "eseguito" : "segnalato", creatoIl: now, modificatoIl: now,
      storia: [{ il: now, stato: "segnalato", nota: "Segnalato da " + prof.nome }] };
    if (gia) { l.esec = { il: now, da: prof.nome, note: "Fatto da chi l'ha segnalato", comePrevisto: true, diff: "", mov: null, prodotti: null, spunte: null, dichiaratoIl: now };
      l.storia.push({ il: now, stato: "eseguito", nota: "Fatto — dichiarato da " + prof.nome }); }
    const { error: ie } = await adm.from("record").insert({ tipo: "lavoro", id, data: l });
    if (ie) return out({ code: "db_error", message: ie.message }, 500);
    return out({ ok: true, lavoro: l });
  }

  if (az === "dichiara") {
    const id = String(body.id ?? ""), stato = String(body.stato ?? "");
    if (!id || !["eseguito", "noneseguito"].includes(stato)) return out({ code: "bad_request", message: "Richiesta non valida" }, 400);
    const { data: r, error } = await adm.from("record").select("data").eq("tipo", "lavoro").eq("id", id).maybeSingle();
    if (error) return out({ code: "db_error", message: error.message }, 500);
    const l: any = r?.data;
    if (!l || !suo(l)) return out({ code: "not_found", message: "Lavoro non trovato o non assegnato a te" }, 404);
    if (!APERTI.includes(l.stato)) return out({ code: "conflict", message: "Il lavoro è già stato segnalato o modificato dal responsabile", lavoro: l }, 409);
    const e = body.esec ?? {};
    const now = new Date().toISOString();
    const arr = (a: unknown, n: number) => Array.isArray(a) ? a.slice(0, n) : null;
    if (stato === "noneseguito" && !txt(e.note).trim()) return out({ code: "bad_request", message: "Manca il motivo" }, 400);
    l.esec = {
      il: /^\d{4}-\d\d-\d\dT/.test(String(e.il ?? "")) ? String(e.il) : now,
      da: prof.nome, note: txt(e.note), diff: txt(e.diff),
      comePrevisto: stato === "eseguito" ? e.comePrevisto !== false : null,
      mov: arr(e.mov, 200)?.map((m: any) => ({ a: txt(m?.a, 40), L: typeof m?.L === "number" && isFinite(m.L) ? m.L : null })) ?? null,
      prodotti: arr(e.prodotti, 100)?.map((x: any) => txt(x, 200)) ?? null,
      spunte: arr(e.spunte, 100)?.map((x: any) => !!x) ?? null,
      imb: e.imb && typeof e.imb === "object" ? { pz: Number.isFinite(e.imb.pz) ? Math.floor(e.imb.pz) : null, L: Number.isFinite(e.imb.L) ? e.imb.L : null } : null,
      dichiaratoIl: now,
    };
    l.stato = stato; l.modificatoIl = now;
    (l.storia = Array.isArray(l.storia) ? l.storia : []).push({ il: now, stato, nota: txt(body.nota, 300) || (stato === "eseguito" ? "Fatto" : "Non fatto") + " — dichiarato da " + prof.nome });
    const { error: ue } = await adm.from("record").update({ data: l }).eq("tipo", "lavoro").eq("id", id);
    if (ue) return out({ code: "db_error", message: ue.message }, 500);
    return out({ ok: true, lavoro: l });
  }
  return out({ code: "bad_request", message: "Azione sconosciuta" }, 400);
});
