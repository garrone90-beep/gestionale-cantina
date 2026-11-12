"""Costruisce il sito (index.html) dal prototipo.

Uso:  python3 tools/build_site.py prototipo/index.html
Il prototipo resta identico a quello provato in Claude; qui si cambia solo:
- gli script del programma partono dopo l'accesso (cloud.js li esegue);
- si carica supabase-js e cloud.js;
- la nota del menu dice che i dati sono online;
- niente «cantina di esempio»: sul sito sostituirebbe i dati veri.
"""
import sys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'prototipo' / 'index.html')
s = src.read_text(encoding='utf-8')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'build: trovato {n} volte (attese {count}): {old[:80]!r}')
    s = s.replace(old, new)

# 1. script del programma: partono dopo l'accesso
i = s.find('\n<script>\n')
if i < 0:
    sys.exit('build: script principale non trovato')
s = s[:i] + '\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>\n<script src="cloud.js"></script>\n<script type="text/plain" id="app-main">\n' + s[i + len('\n<script>\n'):]
rep('<script id="ui2-js">', '<script type="text/plain" id="app-ui2">')

# 2. nota nel menu
rep('<span class="note-proto">Dati salvati solo in questo browser</span>', '<span class="note-proto">Dati salvati online</span>')
rep('n.innerHTML=`Dati salvati solo in questo browser<br>', 'n.innerHTML=`Dati salvati online · copia di sicurezza<br>')

# 3. niente cantina di esempio sul sito
rep('<button class="btn sm" id="bv-ex">Esplora la cantina di esempio</button>', '')
rep("$('#bv-ex',app).onclick=", "if($('#bv-ex',app)) $('#bv-ex',app).onclick=")
rep('<div class="actions"><button class="btn" id="rz">Carica dati di esempio</button></div>', '<p class="hint">Sul sito la cantina di esempio non c\'è: sostituirebbe i dati veri di tutti.</p>')
rep("$('#rz',app).onclick=", "if($('#rz',app)) $('#rz',app).onclick=")

# 3b. niente referto di esempio OINOS sul sito: confermandolo, le analisi d'esempio finirebbero nei dati veri
rep('<button class="btn ghost" id="rf-demo">Prova con l\'esempio OINOS</button>', '')
rep("$('#rf-demo',b).onclick=", "if($('#rf-demo',b)) $('#rf-demo',b).onclick=")

# 4. testo «Dove sono i dati»
rep('<p>In questo prototipo tutto resta nel browser che stai usando: non viene caricato nessun dato su server o cloud. Se cancelli i dati del browser o cambi dispositivo, li perdi: per questo conviene fare spesso una copia di backup.</p>',
    '<p>I dati sono salvati online (database della cantina) e sono gli stessi da ogni computer, tablet o telefono dopo l\'accesso. Ogni modifica si salva da sola: lo stato è indicato in basso nel menu. Il backup resta utile come copia di sicurezza.</p>')

# titolo della pagina
s = re.sub(r'<title>[^<]*</title>', '<title>Cantina Pratica</title>', s, count=1)
if '<title>' not in s:
    s = s.replace('<meta charset=utf8>', '<meta charset=utf8><title>Cantina Pratica</title>', 1)

# icona e apertura a schermo intero quando il sito si aggiunge alla schermata Home (uguale per tutte le cantine)
TESTA = ('<link rel="manifest" href="/manifest.webmanifest">'
         '<link rel="icon" type="image/png" sizes="32x32" href="/icone/icona-32.png">'
         '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
         '<meta name="theme-color" content="#620123">'
         '<meta name="apple-mobile-web-app-capable" content="yes">'
         '<meta name="mobile-web-app-capable" content="yes">'
         '<meta name="apple-mobile-web-app-title" content="Cantina">'
         '<meta name="apple-mobile-web-app-status-bar-style" content="default">')
rep('<title>Cantina Pratica</title>', '<title>Cantina Pratica</title>' + TESTA)

out = ROOT / 'index.html'
out.write_text(s, encoding='utf-8')
print('scritto', out, len(s), 'caratteri')
