/* Gestionale di cantina — collegamento a Supabase (versione sito).
   Il programma è lo stesso del prototipo: qui si aggiungono accesso, caricamento e salvataggio online,
   e la lettura dei documenti con la funzione «leggi» al posto dell'intelligenza artificiale di Claude. */
(function(){
  'use strict';
  const SB_URL = 'https://jbgaeyptespbtdspmsti.supabase.co';
  const SB_KEY = 'sb_publishable_DOvRsmTE0FO8OMx3JrSmpQ_abA8IZ93';
  const LS = 'gcg-gestionale-v2';
  const REC = {vini:'vino', eventi:'evento', analisi:'analisi', lavori:'lavoro'};
  const NON_SALVARE = new Set(['esempio']);
  const sb = window.supabase.createClient(SB_URL, SB_KEY, {auth:{persistSession:true, autoRefreshToken:true}});
  let snap = {rec:{}, imp:{}}, utente = null, ruolo = '', lastPull = null, timer = null, inCorso = false, ancora = false, statoTxt = '', statoCls = '';
  /* S è dichiarata con let nel programma: è globale ma non sta su window */
  const getS = ()=>{ try{ return typeof S!=='undefined'?S:null; }catch(e){ return null; } };
  const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- schermate prima del programma ---------- */
  function schermo(html){ let d=document.getElementById('cl-scr'); if(!d){ d=document.createElement('div'); d.id='cl-scr'; document.body.appendChild(d); }
    d.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#F4F2EE;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:16px';
    d.innerHTML=`<div style="background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.12);padding:28px;width:100%;max-width:380px;color:#222">${html}</div>`; return d; }
  const togliSchermo = ()=>{ const d=document.getElementById('cl-scr'); if(d) d.remove(); };
  const inp = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:1rem;margin:4px 0 12px';
  const btn = 'width:100%;padding:11px;border:0;border-radius:8px;background:#8A1C3C;color:#fff;font-weight:700;font-size:1rem;cursor:pointer';
  function login(msg){
    const d=schermo(`<h2 style="margin:0 0 4px;font-size:1.3rem">Gestionale di cantina</h2><p style="margin:0 0 18px;color:#666;font-size:.9rem">Accedi con la tua email aziendale.</p>
      <form id="cl-f"><label style="font-size:.85rem;font-weight:600">Email<input id="cl-e" type="email" autocomplete="username" required style="${inp}"></label>
      <label style="font-size:.85rem;font-weight:600">Password<input id="cl-p" type="password" autocomplete="current-password" required style="${inp}"></label>
      <div id="cl-m" style="color:#B3261E;font-size:.88rem;min-height:1.2em;margin-bottom:8px">${esc(msg||'')}</div>
      <button style="${btn}">Entra</button></form>
      <p style="margin:14px 0 0;font-size:.85rem;text-align:center"><a href="#" id="cl-r" style="color:#8A1C3C">Password dimenticata?</a></p>`);
    const m=d.querySelector('#cl-m');
    d.querySelector('#cl-f').onsubmit=async e=>{ e.preventDefault(); m.style.color='#666'; m.textContent='Accesso in corso…';
      const {data,error}=await sb.auth.signInWithPassword({email:d.querySelector('#cl-e').value.trim(),password:d.querySelector('#cl-p').value});
      if(error){ m.style.color='#B3261E'; m.textContent=/invalid/i.test(error.message)?'Email o password non corretti.':'Accesso non riuscito: '+error.message; return; }
      avvia(data.user); };
    d.querySelector('#cl-r').onclick=async e=>{ e.preventDefault(); const em=d.querySelector('#cl-e').value.trim(); if(!em){ m.style.color='#B3261E'; m.textContent='Scrivi prima la tua email.'; return; }
      const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});
      m.style.color=error?'#B3261E':'#2E7D32'; m.textContent=error?'Invio non riuscito: '+error.message:'Ti ho mandato un\'email con il link per scegliere una nuova password.'; };
  }
  function nuovaPassword(){
    const d=schermo(`<h2 style="margin:0 0 12px;font-size:1.2rem">Scegli una nuova password</h2><form id="np-f"><input id="np-p" type="password" minlength="8" required placeholder="almeno 8 caratteri" autocomplete="new-password" style="${inp}"><div id="np-m" style="color:#B3261E;font-size:.88rem;min-height:1.2em;margin-bottom:8px"></div><button style="${btn}">Salva password</button></form>`);
    d.querySelector('#np-f').onsubmit=async e=>{ e.preventDefault(); const {error}=await sb.auth.updateUser({password:d.querySelector('#np-p').value});
      if(error){ d.querySelector('#np-m').textContent='Non riuscito: '+error.message; return; } const {data}=await sb.auth.getUser(); avvia(data.user); };
  }
  function errore(t,riprova){ const d=schermo(`<h2 style="margin:0 0 10px;font-size:1.2rem">Gestionale di cantina</h2><p style="margin:0 0 16px">${t}</p>${riprova?`<button id="cl-rp" style="${btn}">Riprova</button>`:''}<p style="margin:12px 0 0;text-align:center"><a href="#" id="cl-out" style="color:#8A1C3C;font-size:.85rem">Esci</a></p>`);
    const r=d.querySelector('#cl-rp'); if(r) r.onclick=()=>location.reload(); d.querySelector('#cl-out').onclick=async e=>{ e.preventDefault(); await sb.auth.signOut(); location.reload(); }; }

  /* ---------- caricamento ---------- */
  async function tutte(tab,cols){ const out=[]; for(let da=0;;da+=1000){ const {data,error}=await sb.from(tab).select(cols).range(da,da+999); if(error) throw error; out.push(...data); if(data.length<1000) return out; } }
  async function avvia(user){
    utente=user; schermo('<p style="margin:0">Carico i dati della cantina…</p>');
    try{
      const {data:prof,error:pe}=await sb.from('profili').select('ruolo,attivo,nome').eq('id',user.id).maybeSingle(); if(pe) throw pe;
      if(!prof||!prof.attivo) return errore(`L'utente <b>${esc(user.email)}</b> non è ancora abilitato. Chiedi all'amministratore di attivarlo.`,true);
      ruolo=prof.ruolo;
      const [rec,imp]=await Promise.all([tutte('record','tipo,id,data,aggiornato'),tutte('impostazioni','chiave,valore,aggiornato')]);
      const S0={}; imp.forEach(r=>{ S0[r.chiave]=r.valore; }); Object.keys(REC).forEach(k=>{ S0[k]=[]; });
      const per={}; Object.entries(REC).forEach(([k,t])=>per[t]=k);
      rec.forEach(r=>{ const k=per[r.tipo]; if(k&&r.data) S0[k].push(r.data); });
      S0.eventi.sort((a,b)=>(a.data||'')<(b.data||'')?-1:(a.data||'')>(b.data||'')?1:(a.ord||0)-(b.ord||0));
      lastPull=[...rec,...imp].map(r=>r.aggiornato).sort().pop()||null;
      if(rec.length||imp.length){ try{ localStorage.setItem(LS,JSON.stringify(S0)); }catch(e){} } else { try{ localStorage.removeItem(LS); }catch(e){} }
      fotografa(rec.length||imp.length?JSON.parse(JSON.stringify(S0)):{});
    }catch(e){ console.error(e); return errore('Non riesco a leggere i dati online'+(navigator.onLine?'':' (sei senza connessione)')+'. Riprova tra poco.',true); }
    togliSchermo(); eseguiProgramma();
  }
  function fotografa(S){ snap={rec:{},imp:{}}; Object.entries(REC).forEach(([k,t])=>(S[k]||[]).forEach(o=>{ if(o&&o.id!=null) snap.rec[t+'|'+o.id]=JSON.stringify(o); }));
    Object.keys(S).forEach(k=>{ if(REC[k]||NON_SALVARE.has(k)) return; const s=JSON.stringify(S[k]); if(s!==undefined) snap.imp[k]=s; }); }
  function eseguiProgramma(){
    ['app-main','app-ui2'].forEach(id=>{ const t=document.getElementById(id); if(!t) return; const s=document.createElement('script'); s.textContent=t.textContent; t.replaceWith(s); });
    const orig=window.save; window.save=function(){ orig(); programma(); };
    barra(); setInterval(()=>{ if(!document.hidden) pull(); },45000); window.addEventListener('focus',()=>pull());
    window.addEventListener('beforeunload',e=>{ if(timer||inCorso){ e.preventDefault(); e.returnValue=''; } });
    // le correzioni automatiche fatte all'apertura vanno salvate
    setTimeout(()=>programma(),1500);
  }

  /* ---------- salvataggio ---------- */
  function programma(){ clearTimeout(timer); stato('Modifiche da salvare…',''); timer=setTimeout(()=>{ timer=null; push(); },700); }
  function differenze(){ const S=getS(); const up=[],del=[],upI=[],delI=[]; const visti=new Set();
    Object.entries(REC).forEach(([k,t])=>(S[k]||[]).forEach(o=>{ if(!o||o.id==null) return; const key=t+'|'+o.id; visti.add(key); const s=JSON.stringify(o); if(snap.rec[key]!==s) up.push({key,s,row:{tipo:t,id:String(o.id),data:o}}); }));
    Object.keys(snap.rec).forEach(key=>{ if(!visti.has(key)) del.push(key); });
    const ki=new Set(); Object.keys(S).forEach(k=>{ if(REC[k]||NON_SALVARE.has(k)) return; const s=JSON.stringify(S[k]); if(s===undefined) return; ki.add(k); if(snap.imp[k]!==s) upI.push({k,s,row:{chiave:k,valore:S[k]}}); });
    Object.keys(snap.imp).forEach(k=>{ if(!ki.has(k)) delI.push(k); });
    return {up,del,upI,delI}; }
  async function push(){
    const S=getS(); if(!S) return; if(S.esempio){ stato('Cantina di esempio: non viene salvata online','warn'); return; }
    if(inCorso){ ancora=true; return; } inCorso=true;
    try{
      const d=differenze(); const tot=Object.keys(snap.rec).length;
      if(d.del.length>10&&d.del.length>tot*0.3){
        if(!confirm(`Questa modifica cancella ${d.del.length} registrazioni su ${tot} dal database online (per esempio dopo «Ripristina un backup»).\n\nConfermi? Con «Annulla» la pagina si ricarica con i dati online e la modifica si perde.`)){ inCorso=false; location.reload(); return; } }
      if(!d.up.length&&!d.del.length&&!d.upI.length&&!d.delI.length){ stato('Salvato online','ok'); return; }
      stato('Salvataggio…','');
      for(let i=0;i<d.up.length;i+=200){ const p=d.up.slice(i,i+200); const {error}=await sb.from('record').upsert(p.map(x=>x.row),{onConflict:'tipo,id'}); if(error) throw error; p.forEach(x=>snap.rec[x.key]=x.s); }
      if(d.upI.length){ const {error}=await sb.from('impostazioni').upsert(d.upI.map(x=>x.row),{onConflict:'chiave'}); if(error) throw error; d.upI.forEach(x=>snap.imp[x.k]=x.s); }
      const perT={}; d.del.forEach(key=>{ const i=key.indexOf('|'); (perT[key.slice(0,i)]=perT[key.slice(0,i)]||[]).push(key.slice(i+1)); });
      let negate=0;
      for(const [t,ids] of Object.entries(perT)) for(let i=0;i<ids.length;i+=200){ const p=ids.slice(i,i+200); const {data,error}=await sb.from('record').delete().eq('tipo',t).in('id',p).select('id'); if(error) throw error; negate+=p.length-(data||[]).length; p.forEach(id=>delete snap.rec[t+'|'+id]); }
      if(d.delI.length){ const {data,error}=await sb.from('impostazioni').delete().in('chiave',d.delI).select('chiave'); if(error) throw error; negate+=d.delI.length-(data||[]).length; d.delI.forEach(k=>delete snap.imp[k]); }
      stato(negate?'Salvato online · alcune cancellazioni richiedono un amministratore':'Salvato online',negate?'warn':'ok');
    }catch(e){ console.error(e); stato('Non salvato: riprovo tra poco'+(navigator.onLine?'':' (senza connessione)'),'err'); setTimeout(()=>programma(),10000); }
    finally{ inCorso=false; if(ancora){ ancora=false; programma(); } }
  }

  /* ---------- modifiche fatte da altri ---------- */
  async function pull(){
    if(!getS()||timer||inCorso||!lastPull||getS().esempio) return;
    try{
      const [r1,r2]=await Promise.all([sb.from('record').select('tipo,id,data,aggiornato,aggiornato_da').gt('aggiornato',lastPull),sb.from('impostazioni').select('chiave,valore,aggiornato,aggiornato_da').gt('aggiornato',lastPull)]);
      if(r1.error||r2.error) return; if(timer||inCorso) return;
      const S=getS(); let n=0; const per={}; Object.entries(REC).forEach(([k,t])=>per[t]=k);
      r1.data.forEach(r=>{ const k=per[r.tipo]; if(!k||!r.data) return; const key=r.tipo+'|'+r.id; const arr=S[k]=S[k]||[]; const i=arr.findIndex(o=>o&&String(o.id)===String(r.id));
        const cur=i>=0?JSON.stringify(arr[i]):undefined; if(cur!==snap.rec[key]) return; const s=JSON.stringify(r.data); if(s===cur) return; if(i>=0) arr[i]=r.data; else arr.push(r.data); snap.rec[key]=s; n++; });
      r2.data.forEach(r=>{ if(NON_SALVARE.has(r.chiave)) return; const cur=JSON.stringify(S[r.chiave]); if(cur!==snap.imp[r.chiave]) return; const s=JSON.stringify(r.valore); if(s===cur) return; S[r.chiave]=r.valore; snap.imp[r.chiave]=s; n++; });
      const all=[...r1.data,...r2.data].map(r=>r.aggiornato).sort(); if(all.length) lastPull=all.pop();
      if(n){ if(S.eventi) S.eventi.sort((a,b)=>(a.data||'')<(b.data||'')?-1:(a.data||'')>(b.data||'')?1:(a.ord||0)-(b.ord||0)); try{ localStorage.setItem(LS,JSON.stringify(S)); }catch(e){}
        if(!document.querySelector('.ov')){ try{ window.route(); }catch(e){} } stato('Aggiornato con le modifiche di altri utenti','ok'); }
    }catch(e){}
  }

  /* ---------- indicatore nel menu ---------- */
  function barra(){ const n=document.querySelector('.note-proto'); if(!n||document.getElementById('cl-bar')) return; const d=document.createElement('div'); d.id='cl-bar';
    d.style.cssText='font-size:.74rem;line-height:1.35;padding:8px 12px;color:var(--side-muted,#999)';
    n.parentNode.insertBefore(d,n.nextSibling); disegna(); }
  function stato(t,c){ statoTxt=t; statoCls=c; disegna(); }
  function disegna(){ const d=document.getElementById('cl-bar'); if(!d) return; const col={ok:'#5BB974',warn:'#E0A030',err:'#E5484D'}[statoCls]||'#999';
    d.innerHTML=`<div><span style="color:${col}">●</span> ${esc(statoTxt||'Collegato')}</div><div>${esc(utente&&utente.email||'')}${ruolo==='admin'?' · amministratore':''} · <a href="#" id="cl-esci" style="color:inherit;text-decoration:underline">Esci</a></div>`;
    d.querySelector('#cl-esci').onclick=async e=>{ e.preventDefault(); if(timer||inCorso){ alert('Attendi il salvataggio delle ultime modifiche.'); return; } await sb.auth.signOut(); try{ localStorage.removeItem(LS); }catch(x){} location.reload(); }; }

  /* ---------- lettura documenti con la funzione «leggi» ---------- */
  const b64=blob=>new Promise((ok,ko)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(',')[1]); r.onerror=ko; r.readAsDataURL(blob); });
  async function chiama(prompt,opt,json){ opt=opt||{};
    const imgs=await Promise.all((opt.images||[]).map(async x=>x instanceof Blob?{media_type:x.type||'image/jpeg',data:await b64(x)}:x));
    const {data:{session}}=await sb.auth.getSession(); if(!session){ const e=new Error('Sessione scaduta: rientra'); e.code='not_granted'; throw e; }
    let r; try{ r=await fetch(SB_URL+'/functions/v1/leggi',{method:'POST',signal:opt.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token,apikey:SB_KEY},body:JSON.stringify({prompt,images:imgs,json})}); }
    catch(e){ if(e&&e.name==='AbortError'){ const x=new Error('Interrotto'); x.code='cancelled'; throw x; } throw e; }
    const j=await r.json().catch(()=>({})); if(!r.ok){ const e=new Error(j.message||('Errore '+r.status)); e.code=j.code||'api_error'; throw e; }
    return json?j.json:j.text; }
  const sample={ limits:async()=>({images:true}), json:(p,o)=>chiama(p,o,true), text:(p,o)=>chiama(p,o,false), complete:(p,o)=>chiama(p,o,false) };
  window.claude={ use:async nome=>nome==='sample'?sample:null };

  /* ---------- avvio ---------- */
  sb.auth.onAuthStateChange(ev=>{ if(ev==='PASSWORD_RECOVERY') nuovaPassword(); });
  // si parte a pagina letta: il programma è più sotto nella pagina, in <script type="text/plain">
  const via=async()=>{ if(/type=recovery/.test(location.hash)) return; const {data:{session}}=await sb.auth.getSession(); if(session) avvia(session.user); else login(); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',via); else via();
})();
