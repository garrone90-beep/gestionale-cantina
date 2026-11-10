# Gestionale di cantina — Cantine Garrone

Sito: https://gestionale-cantine-garrone.netlify.app (Netlify, pubblicazione automatica a ogni commit su `main`).

## Com'è fatto

| File | Cosa contiene |
|---|---|
| `prototipo/index.html` | Il programma, identico al prototipo provato in Claude (artifact «Gestionale di cantina»). Si cambia sempre qui. |
| `cloud.js` | Accesso con email e password, caricamento e salvataggio su Supabase, lettura dei documenti con la funzione `leggi`. |
| `tools/build_site.py` | Costruisce `index.html` (il sito) dal prototipo. |
| `index.html` | Generato: non modificarlo a mano. |
| `netlify.toml` | Sito statico, nessuna compilazione. |

## Aggiornare il sito

```
cp <nuovo prototipo>.html prototipo/index.html
python3 tools/build_site.py
git commit -am "…" && git push
```
Netlify pubblica da solo in circa un minuto.

## Dati (Supabase, progetto `gestionale-cantina`)

- `record` (tipo, id, data jsonb): vini, operazioni (`evento`), analisi, lavori. Una riga per elemento.
- `impostazioni` (chiave, valore jsonb): tutto il resto dello stato (azienda, locali, recipienti, layout, cataloghi, limiti, verifiche, ultimoBackup…), una riga per chiave.
- `profili`: utenti abilitati (`attivo`) e ruolo (`admin` può cancellare righe; `dipendente` no).
- Le modifiche si salvano da sole dopo ~1 secondo; ogni 45 secondi (e quando si torna sulla pagina) arrivano quelle degli altri utenti.
- Se una modifica cancellerebbe più del 30 % delle registrazioni (es. «Ripristina un backup») il sito chiede conferma.
- Sul sito la «cantina di esempio» è disattivata: sostituirebbe i dati veri.

## Nuovi utenti

L'utente si registra (o lo crei da Supabase → Authentication → Add user); compare in `profili` con `attivo = false`: per abilitarlo metti `attivo = true` (e `ruolo = 'admin'` se serve).
