/* Dashboard Casa · app: montaggio, interazioni, avvio */
(function (C) {
  'use strict';

  const VISTA_KEY = 'casa-vista';
  C.vistaPreferita = () => { try { return localStorage.getItem(VISTA_KEY) || 'auto'; } catch (e) { return 'auto'; } };
  C.decidiVista = () => {
    const q = new URLSearchParams(location.search).get('vista');
    const pref = q || C.vistaPreferita();
    if (pref === 'tablet' || pref === 'telefono') return pref;
    const lato = Math.min(window.screen.width || 0, window.screen.height || 0);
    return lato >= 700 ? 'tablet' : 'telefono';
  };
  C.orologioVero = () => ({ now: () => new Date() });
  C.orologioSimulato = (giorno, minuti) => {
    const o = { g: giorno, m: minuti, t0: Date.now() };
    return {
      now() { const base = C.zDate(o.g.y, o.g.m, o.g.d, Math.floor(o.m / 60), o.m % 60).getTime(); return new Date(base + (Date.now() - o.t0)); },
      imposta(g, m) { o.g = g; o.m = m; o.t0 = Date.now(); }
    };
  };

  /* =====================================================================
     Monta l'app in un elemento: vista 'tablet' oppure 'telefono'
     ===================================================================== */
  C.monta = (root, opz) => {
    const { vista, orologio } = opz;
    const A = opz.archivio, E = opz.esterni || { on: () => () => {} };
    const tablet = vista === 'tablet';
    const ui = { tab: 'spesa', addOpen: false, sheet: false, sez: '', fresh: null, freshNome: '', wakeUntil: 0, dashboardFino: 0, err: {}, ok: {}, geo: {}, vistaPref: C.vistaPreferita(), pagato: null, divisione: 'meta', confermaSaldo: false, cancella: null, fotoVia: null, fotoCarico: '', anteprima: !!opz.anteprima };
    root.classList.add('casa', tablet ? 'v-tablet' : 'v-telefono');
    if (opz.pieno) root.classList.add('full');
    const SFONDO = '<div class="bg" aria-hidden="true"><div class="bg-colori"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div><div class="bg-foto a"></div><div class="bg-foto b"></div><div class="bg-velo"></div></div>';
    // il campo per scegliere le foto sta fuori dalla parte che si ridisegna: se il telefono aggiorna la pagina
    // mentre la galleria è aperta, la scelta arriva lo stesso
    root.innerHTML = tablet ? `<div class="stage">${SFONDO}<div class="grid" data-mode="mattina"></div></div>`
      : '<div class="phone"><div class="p-body"></div><input id="p-foto" class="sr" type="file" accept="image/*" multiple data-foto tabindex="-1" aria-hidden="true"></div>';
    const stage = root.querySelector('.stage'), grid = root.querySelector('.grid'), phone = root.querySelector('.phone'), body = root.querySelector('.p-body'), bg = root.querySelector('.bg');
    const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    let lastMin = -1, lastSveglio = false, lastDash = false, toastT = null, wakeLock = null;

    const inputAttivo = cont => { const a = document.activeElement; return a && cont && cont.contains(a) && a.matches('input, textarea, select') ? a : null; };
    const personaVoce = () => { const p = A.me && A.me.persona; return p === 'M' || p === 'G' ? p : (tablet ? 'T' : 'M'); };
    const via = () => (tablet ? 'tablet' : 'telefono');
    const vmOra = () => C.vm(A, E, orologio, { sveglio: ui.wakeUntil > Date.now(), dashboard: ui.dashboardFino > Date.now() });

    function fit() {
      if (!tablet || opz.scala === false) return;
      const W = root.clientWidth, H = root.clientHeight; if (!W || !H) return;
      const s = Math.min(W / 1080, H / 810), x = (W - 1080 * s) / 2, y = (H - 810 * s) / 2;
      stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    }

    function renderSheet(cont, v, forza) {
      let sh = cont.querySelector(':scope > .sheet');
      if (!ui.sheet) { if (sh) sh.remove(); return; }
      if (sh && !forza && inputAttivo(sh)) return;
      const focusId = sh && inputAttivo(sh) ? document.activeElement.id : '';
      const scroll = sh ? sh.querySelector('.panel').scrollTop : 0;
      const html = `<div class="sheet" data-act="sfondo">${C.impostazioni(v, ui, A.cfg || opz.conf || null)}</div>`;
      if (sh) sh.outerHTML = html; else cont.insertAdjacentHTML('beforeend', html);
      sh = cont.querySelector(':scope > .sheet');
      const panel = sh.querySelector('.panel');
      if (ui.sez) { const t = panel.querySelector('#sez-' + ui.sez); panel.scrollTop = t ? t.offsetTop - 12 : 0; ui.sez = ''; }
      else panel.scrollTop = scroll;
      if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }
    }

    /* tablet: si ridisegnano solo i riquadri cambiati, così il cielo animato non riparte ogni minuto */
    let firme = [];
    const firma = h => h.replace(/animation-delay:-?[\d.]+s/g, '');
    function disegnaTablet(v) {
      const pezzi = C.tabletPezzi(v, ui), nuove = pezzi.map(firma);
      if (grid.dataset.mode !== v.mode || grid.children.length !== pezzi.length) {
        grid.dataset.mode = v.mode; grid.innerHTML = pezzi.join(''); firme = nuove; return;
      }
      pezzi.forEach((h, i) => {
        if (nuove[i] === firme[i]) return;
        const t = document.createElement('template'); t.innerHTML = h.trim();
        const el = t.content.firstElementChild;
        if (el && grid.children[i]) grid.children[i].replaceWith(el);
      });
      firme = nuove;
    }

    /* sfondo dello stile smart home: le vostre foto (una ogni 10 minuti) oppure i colori del momento */
    let fotoOra = '', fotoLato = 'a';
    function aggiornaSfondo(v) {
      if (!bg) return;
      root.dataset.stile = v.stile;
      bg.dataset.momento = v.momento; bg.dataset.stagione = v.stagione;
      bg.dataset.spento = v.mode === 'notte' ? '1' : '';
      const lista = v.stile === 'smart' && v.sfondo !== 'colori' ? (v.foto || []).filter(f => f && f.url) : [];
      if (!lista.length) { bg.dataset.foto = ''; fotoOra = ''; return; }
      const url = lista[Math.floor(Date.now() / 600e3) % lista.length].url;
      if (url === fotoOra) return;
      fotoOra = url;
      const img = new Image();
      img.onload = () => {
        if (fotoOra !== url) return;
        const nuovo = fotoLato === 'a' ? 'b' : 'a';
        const el = bg.querySelector('.bg-foto.' + nuovo), vecchio = bg.querySelector('.bg-foto.' + fotoLato);
        el.style.backgroundImage = `url("${url.replace(/["\\]/g, encodeURIComponent)}")`;
        el.classList.add('on'); vecchio.classList.remove('on'); fotoLato = nuovo; bg.dataset.foto = '1';
      };
      img.onerror = () => { if (fotoOra === url) fotoOra = ''; };
      img.src = url;
    }

    function render(forza) {
      if (A.stato !== 'pronto') {
        const sig = [A.stato, A.errore || '', (A.me && A.me.id) || ''].join('|');
        if (!forza && sig === ui.gateSig) return;
        ui.gateSig = sig;
        root.dataset.look = darkMq && darkMq.matches ? 'sera' : 'giorno';
        delete root.dataset.stile;
        const html = C.schermataStato(A, ui);
        if (tablet) { grid.dataset.mode = 'gate'; grid.innerHTML = html; firme = []; } else body.innerHTML = html;
        return;
      }
      ui.gateSig = '';
      const v = vmOra();
      lastMin = v.min; lastSveglio = v.sveglio; lastDash = ui.dashboardFino > Date.now();
      if (ui.freshNome) {
        const f = v.aperte.find(i => String(i.nome).toLowerCase() === ui.freshNome);
        if (f) { ui.fresh = f.id; ui.freshNome = ''; setTimeout(() => { if (ui.fresh === f.id) ui.fresh = null; }, 2600); }
      }
      if (tablet) {
        root.dataset.look = v.look;
        aggiornaSfondo(v);
        const a = inputAttivo(grid);
        if (a && !forza) grid.querySelectorAll('[data-clock]').forEach(el => { el.textContent = C.hm(v.min); });
        else {
          const focusId = a ? a.id : '';
          disegnaTablet(v);
          const f = (ui.addOpen && grid.querySelector('#t-voce')) || (focusId && document.getElementById(focusId));
          if (f && document.activeElement !== f) f.focus({ preventScroll: true });
        }
        renderSheet(stage, v, forza);
      } else {
        root.dataset.look = darkMq && darkMq.matches ? 'sera' : 'giorno';
        const a = inputAttivo(body);
        if (!a || forza) {
          const focusId = a ? a.id : '';
          const main = body.querySelector('.p-main'), sc = main ? main.scrollTop : 0, tabPrima = body.dataset.tab;
          body.innerHTML = C.telefono(v, ui);
          body.dataset.tab = ui.tab;
          const m2 = body.querySelector('.p-main'); if (m2 && tabPrima === ui.tab) m2.scrollTop = sc;
          if (focusId) { const f = document.getElementById(focusId); if (f) f.focus({ preventScroll: true }); }
        }
        renderSheet(phone, v, forza);
      }
    }

    function toast(msg) {
      const cont = tablet ? stage : phone;
      let el = cont.querySelector(':scope > .toast');
      if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); cont.appendChild(el); }
      el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), 1800);
    }
    function copia(t) {
      const ok = () => toast('Copiato');
      try { navigator.clipboard.writeText(t).then(ok, () => toast('Tenete premuto sul testo per copiarlo')); } catch (e) { toast('Tenete premuto sul testo per copiarlo'); }
    }
    async function trova(dove, btn) {
      const inp = root.querySelector(`[data-geo="${dove}"]`), q = inp ? inp.value.trim() : '';
      if (!q) { ui.geo[dove] = 'Scrivete prima l’indirizzo.'; render(true); return; }
      btn.disabled = true; btn.textContent = 'Cerco…';
      const r = E.geocodifica ? await E.geocodifica(q) : null;
      if (!r) ui.geo[dove] = 'Non trovo questo indirizzo: controllate la chiave TomTom o scrivetelo in modo più completo.';
      else {
        const cur = C.clone(((A.data.config && A.data.config.dati) || {})[dove] || {});
        const e = await A.salvaDati(dove, { ...cur, indirizzo: q, lat: r.lat, lon: r.lon });
        ui.geo[dove] = e || `Trovato: ${r.trovato || q}`;
      }
      render(true);
    }
    function rimpicciolisci(file, lato = 2048, qualita = 0.82) {
      return new Promise((ok, no) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
          const k = Math.min(1, lato / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(b => (b ? ok(b) : no(new Error('foto'))), 'image/jpeg', qualita);
        };
        img.onerror = () => { URL.revokeObjectURL(url); no(new Error('foto')); };
        img.src = url;
      });
    }
    async function caricaFoto(files) {
      const lista = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || ''));
      if (!lista.length) { toast('Scegliete delle foto'); return; }
      if (!A.caricaFoto) { toast('Qui non si possono caricare foto'); return; }
      let fatte = 0, errore = '';
      ui.ok.foto = '';
      for (const f of lista.slice(0, 20)) {
        ui.fotoCarico = lista.length > 1 ? `Carico ${fatte + 1} di ${Math.min(20, lista.length)}…` : 'Carico…'; render(true);
        try { const e = await A.caricaFoto(await rimpicciolisci(f)); if (e) { errore = e; break; } fatte++; }
        catch (e) { errore = 'Questa foto non si riesce a leggere: provate con un’altra.'; break; }
      }
      ui.fotoCarico = '';
      if (fatte) ui.ok.foto = fatte === 1 ? 'Foto aggiunta: tra poco è sul tablet.' : `${fatte} foto aggiunte: tra poco sono sul tablet.`;
      if (errore) toast(errore);
      render(true);
    }
    function scegli(el) { el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === el))); }

    /* ---------- clic ---------- */
    root.addEventListener('click', async ev => {
      const el = ev.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
      const act = el.dataset.act, id = el.dataset.id;
      if (tablet && !wakeLock && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
      switch (act) {
        case 'voce': await A.segnaVoce(id); break;
        case 'aggiungi': ui.addOpen = !ui.addOpen; render(true); break;
        case 'fatto': el.disabled = true; { const e = await A.faccendaFatta(id, el.dataset.chi || personaVoce()); if (e) toast(e); el.disabled = false; } break;
        case 'annulla': await A.annullaFatta(id); break;
        case 'letto': await A.leggiNota(id); break;
        case 'impostazioni': ui.sheet = true; ui.sez = el.dataset.sez || ''; render(true); break;
        case 'chiudi': ui.sheet = false; ui.geo = {}; render(true); break;
        case 'sfondo': if (ev.target === el) { ui.sheet = false; render(true); } break;
        case 'vai': ui.sez = el.dataset.sez; render(true); break;
        case 'sveglia': ui.wakeUntil = Date.now() + 30000; render(true); break;
        case 'dashboard': ui.dashboardFino = Date.now() + 15 * 60e3; render(true); break;
        case 'prima': ui.dashboardFino = 0; render(true); break;
        case 'foto-via': ui.fotoVia = id; render(true); break;
        case 'foto-via-ok': ui.fotoVia = null; { const e = A.togliFoto ? await A.togliFoto(id) : 'Non disponibile'; toast(e || 'Foto tolta'); } render(true); break;
        case 'scheda': ui.tab = el.dataset.k; ui.err = {}; ui.ok = {}; ui.confermaSaldo = false; ui.cancella = null; render(true); break;
        case 'pagato': ui.pagato = el.dataset.w; scegli(el); break;
        case 'divisione': ui.divisione = el.dataset.k; scegli(el); break;
        case 'salda': ui.confermaSaldo = true; ui.ok.saldo = ''; render(true); break;
        case 'salda-no': ui.confermaSaldo = false; render(true); break;
        case 'salda-ok': {
          const s = vmOra().saldo;
          if (Math.abs(s) >= 0.005) {
            const e = await A.aggiungiSpesa({ descrizione: 'Saldo', importo: Math.round(Math.abs(s) * 100) / 100, pagato_da: s > 0 ? 'G' : 'M', quota_m: 50, categoria: 'Saldo', tipo: 'saldo', via: via() });
            ui.ok.saldo = e ? '' : 'Saldo registrato: siete in pari.'; if (e) toast(e);
          }
          ui.confermaSaldo = false; render(true); break;
        }
        case 'spesa-via': ui.cancella = id; render(true); break;
        case 'spesa-via-ok': ui.cancella = null; { const e = await A.togliSpesa(id); if (e) toast(e); } break;
        case 'trova': await trova(el.dataset.dove, el); break;
        case 'togli-faccenda': { const e = await A.togliFaccenda(id); toast(e || 'Faccenda tolta'); } break;
        case 'togli-ricorrenza': { const e = await A.togliRicorrenza(id); toast(e || 'Ricorrenza tolta'); } break;
        case 'copia': copia(el.dataset.testo || ''); break;
        case 'nuovo-token': { const e = await A.salvaCollegamento('siri_token', C.token(32)); toast(e || 'Codice pronto'); render(true); } break;
        case 'esci': await A.esci(); break;
        case 'scollega': C.dimenticaCollegamento(); location.reload(); break;
        case 'ripristina': if (A.ripristina) { A.ripristina(); toast('Esempio ripristinato'); } break;
        case 'esci-esempio': try { sessionStorage.removeItem('casa-esempio'); } catch (e) { } location.href = location.pathname; break;
        case 'esempio': if (opz.suEsempio) opz.suEsempio(); break;
        case 'riprova': if (A.avvia) A.avvia(); break;
        default: break;
      }
    });

    /* ---------- moduli ---------- */
    root.addEventListener('submit', async ev => {
      const f = ev.target.closest('form[data-form]'); if (!f || !root.contains(f)) return;
      ev.preventDefault();
      const k = f.dataset.form, fd = new FormData(f), btn = f.querySelector('button[type=submit]');
      const setErr = (key, msg) => { ui.err[key] = msg; const box = root.querySelector(`[data-err="${key}"]`); if (box) box.textContent = msg; return false; };
      const busy = b => { if (btn) btn.disabled = b; };
      ui.ok = {};
      if (k === 'voce') {
        const testo = String(fd.get('voce') || '').trim();
        if (!testo) { setErr('voce', 'Scrivete cosa aggiungere.'); f.voce.focus(); return; }
        const voci = testo.split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
        busy(true); let e = '';
        for (const n of voci) { e = await A.aggiungiVoce(C.cap(n), personaVoce(), via()); if (e) break; }
        busy(false);
        if (e) { setErr('voce', e); return; }
        ui.err.voce = ''; ui.freshNome = C.cap(voci[voci.length - 1]).replace(/\s+/g, ' ').toLowerCase();
        f.reset(); if (tablet) ui.addOpen = false;
        render(true);
      } else if (k === 'nota') {
        const t = String(fd.get('nota') || '').trim();
        if (!t) { setErr('nota', 'Scrivete il bigliettino prima di inviarlo.'); return; }
        busy(true); const e = await A.aggiungiNota(t.slice(0, 280), personaVoce(), via()); busy(false);
        if (e) { setErr('nota', e); return; }
        ui.err.nota = ''; ui.ok.nota = 'Inviato: è sullo schermo di casa.'; f.reset(); render(true);
      } else if (k === 'spesa') {
        const desc = String(fd.get('descrizione') || '').trim();
        const imp = parseFloat(String(fd.get('importo') || '').replace(/[^\d.,]/g, '').replace(',', '.'));
        if (!desc) { setErr('spesa', 'Scrivete a cosa si riferisce la spesa.'); return; }
        if (!(imp > 0) || imp >= 100000) { setErr('spesa', 'Scrivete un importo valido, per esempio 42.50.'); return; }
        const me = A.me && (A.me.persona === 'M' || A.me.persona === 'G') ? A.me.persona : 'M';
        const pag = ui.pagato || me, v = vmOra();
        const q = ui.divisione === 'quota' ? v.quotaM : ui.divisione === 'tutta' ? (pag === 'M' ? 100 : 0) : 50;
        busy(true);
        const e = await A.aggiungiSpesa({ descrizione: desc.slice(0, 80), importo: Math.round(imp * 100) / 100, pagato_da: pag, quota_m: q, categoria: String(fd.get('categoria') || 'Casa'), tipo: 'spesa', via: via() });
        busy(false);
        if (e) { setErr('spesa', e); return; }
        ui.err.spesa = ''; ui.ok.spesa = `Aggiunta: ${desc}, ${C.nf(imp, 2)} CHF.`; f.reset(); render(true);
      } else if (k === 'faccenda') {
        const nome = String(fd.get('nome') || '').trim();
        if (!nome) { setErr('faccenda', 'Scrivete il nome della faccenda.'); return; }
        busy(true);
        const e = await A.salvaFaccenda({ nome: nome.slice(0, 60), punti: Number(fd.get('punti')) || 2, volte_settimana: Number(fd.get('volte')) || 1, persona_base: fd.get('base') === 'G' ? 'G' : 'M' });
        busy(false);
        if (e) { setErr('faccenda', e); return; }
        ui.err.faccenda = ''; toast('Faccenda aggiunta'); render(true);
      } else if (k === 'ricorrenza') {
        const titolo = String(fd.get('titolo') || '').trim(), data = String(fd.get('data') || '');
        if (!titolo) { setErr('ricorrenza', 'Scrivete il titolo.'); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { setErr('ricorrenza', 'Scegliete la data.'); return; }
        busy(true); const e = await A.salvaRicorrenza({ titolo: titolo.slice(0, 60), data, annuale: !!fd.get('annuale') }); busy(false);
        if (e) { setErr('ricorrenza', e); return; }
        ui.err.ricorrenza = ''; toast('Aggiunta'); render(true);
      } else if (k === 'collega') {
        const url = String(fd.get('url') || '').trim(), key = String(fd.get('key') || '').trim();
        if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(url)) { setErr('collega', 'L’URL deve iniziare con https:// (per esempio https://abcd.supabase.co).'); return; }
        if (key.length < 20) { setErr('collega', 'La chiave sembra incompleta: copiatela tutta.'); return; }
        C.salvaCollegamento(url, key); location.reload();
      } else if (k === 'accedi') {
        const email = String(fd.get('email') || '').trim(), pw = String(fd.get('password') || '');
        if (!email || !pw) { setErr('accedi', 'Servono email e password.'); return; }
        busy(true); const e = await A.accedi(email, pw); busy(false);
        if (e) setErr('accedi', e);
      }
    });

    /* ---------- impostazioni che si salvano da sole ---------- */
    root.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.dati) {
        let val = t.type === 'checkbox' ? t.checked : t.value;
        if (t.dataset.num) val = val === '' ? null : Number(val);
        if (t.dataset.lista) val = String(val).split(',').map(s => s.trim()).filter(Boolean);
        if (t.type === 'time' && !val) return;
        const e = await A.salvaDati(t.dataset.dati, val);
        toast(e || 'Salvato');
      } else if (t.dataset.coll) {
        const e = await A.salvaCollegamento(t.dataset.coll, t.value.trim());
        toast(e || 'Salvato');
      } else if (t.matches('input[data-foto]')) {
        const files = Array.from(t.files || []);
        t.value = '';
        await caricaFoto(files);
      } else if (t.dataset.dev === 'vista') {
        if (opz.anteprima) { toast('Nell’anteprima non serve'); return; }
        try { localStorage.setItem(VISTA_KEY, t.value); } catch (e) { }
        location.reload();
      }
    });
    root.addEventListener('input', ev => {
      const f = ev.target.closest('form'); if (!f) return;
      f.querySelectorAll('.p-err').forEach(x => { x.textContent = ''; });
    });
    root.addEventListener('focusout', () => { setTimeout(() => { if (!inputAttivo(root)) render(); }, 60); });
    root.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && ui.sheet) { ui.sheet = false; render(true); }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('.night')) { ev.preventDefault(); ui.wakeUntil = Date.now() + 30000; render(true); }
    });

    /* ---------- tempo che passa, dati che arrivano ---------- */
    A.on(() => render());
    E.on(() => render());
    if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', () => render());
    const timer = setInterval(() => {
      if (A.stato !== 'pronto') return;
      const m = C.zParts(orologio.now()).min, sv = ui.wakeUntil > Date.now(), dash = ui.dashboardFino > Date.now();
      if (m !== lastMin || sv !== lastSveglio || dash !== lastDash) render();
    }, 1000);
    window.addEventListener('resize', fit);
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(root);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { render(); if (tablet && navigator.wakeLock && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {}); }
    });
    fit();
    return { render, fit, ui, stop: () => clearInterval(timer) };
  };

  /* =====================================================================
     Avvio della pagina index.html
     ===================================================================== */
  C.avvia = () => {
    const root = document.getElementById('app');
    const vista = C.decidiVista();
    const q = new URLSearchParams(location.search);
    const conf = C.leggiCollegamento();
    let esempio = q.has('esempio');
    try { if (!conf && sessionStorage.getItem('casa-esempio') === '1') esempio = true; } catch (e) { }
    if (esempio) {
      const oggi = C.zParts(new Date()), weekend = [0, 6].includes(C.weekday(oggi.o));
      const orologio = C.orologioSimulato(weekend ? C.ymd(2026, 12, 5) : C.ymd(2026, 12, 2), oggi.min);
      const A = C.creaArchivioEsempio({ orologio, persona: vista === 'telefono' ? 'M' : 'T' });
      const E = C.creaEsterniEsempio(orologio);
      C.monta(root, { vista, archivio: A, esterni: E, orologio, pieno: true }).render(true);
      return;
    }
    if (!conf) {
      const A = { tipo: 'nessuno', stato: 'collega', data: { config: { dati: {}, collegamenti: {} } }, on: () => () => {}, avvia() { } };
      C.monta(root, { vista, archivio: A, orologio: C.orologioVero(), pieno: true, suEsempio: () => { try { sessionStorage.setItem('casa-esempio', '1'); } catch (e) { } location.reload(); } }).render(true);
      return;
    }
    const orologio = C.orologioVero();
    const A = C.creaArchivioSupabase(conf), E = C.creaEsterniLive(A, orologio);
    C.monta(root, { vista, archivio: A, esterni: E, orologio, pieno: true, conf }).render(true);
    if (A.avvia) A.avvia();
  };
})(window.Casa = window.Casa || {});
