/* Dashboard Casa · dati: archivio Supabase, archivio di esempio, meteo/traffico/mercati */
(function (C) {
  'use strict';

  const emitter = () => {
    const fns = new Set();
    return { on: f => { fns.add(f); return () => fns.delete(f); }, emit: () => fns.forEach(f => { try { f(); } catch (e) { console.error(e); } }) };
  };
  const vuoti = () => ({ config: { dati: {}, collegamenti: {} }, spesa: [], note: [], faccende: [], fatte: [], spese: [], riepilogo: null, ricorrenze: [], eventi: [], brief: [] });

  /* =====================================================================
     Configurazione del collegamento (config.js oppure inserita nell'app)
     ===================================================================== */
  const CFG_KEY = 'casa-collegamento';
  C.leggiCollegamento = () => {
    const f = window.CASA_CONFIG || {};
    if (f.supabaseUrl && f.supabaseKey) return { url: f.supabaseUrl.replace(/\/+$/, ''), key: f.supabaseKey, fonte: 'file' };
    try { const s = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (s && s.url && s.key) return { ...s, fonte: 'app' }; } catch (e) { }
    return null;
  };
  C.salvaCollegamento = (url, key) => { try { localStorage.setItem(CFG_KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), key: key.trim() })); } catch (e) { } };
  C.dimenticaCollegamento = () => { try { localStorage.removeItem(CFG_KEY); } catch (e) { } };

  /* =====================================================================
     Archivio Supabase
     ===================================================================== */
  C.creaArchivioSupabase = cfg => {
    const ev = emitter();
    const S = { tipo: 'supabase', stato: 'caricamento', errore: '', me: null, data: vuoti(), cfg, on: ev.on };
    const set = (stato, errore = '') => { S.stato = stato; S.errore = errore; ev.emit(); };
    let sb;
    try {
      sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'casa-sessione' } });
    } catch (e) { S.stato = 'errore'; S.errore = 'Indirizzo o chiave di Supabase non validi.'; return S; }
    S.sb = sb;
    const oggiZ = () => C.zParts(new Date());
    const err = (e, cosa) => { console.error(cosa, e); return (e && e.message) ? `${cosa}: ${e.message}` : cosa; };

    const load = {
      async config() { const { data, error } = await sb.from('casa_config').select('dati,collegamenti').eq('id', 1).maybeSingle(); if (error) throw error; S.data.config = data || { dati: {}, collegamenti: {} }; },
      async spesa() {
        const da = new Date(Date.now() - 12 * 3600e3).toISOString();
        const { data, error } = await sb.from('casa_spesa').select('*').or(`preso_il.is.null,preso_il.gt."${da}"`).order('creato_il', { ascending: false }).limit(300);
        if (error) throw error; S.data.spesa = data || [];
      },
      async note() { const { data, error } = await sb.from('casa_bigliettini').select('*').order('creato_il', { ascending: false }).limit(30); if (error) throw error; S.data.note = data || []; },
      async faccende() { const { data, error } = await sb.from('casa_faccende').select('*').eq('attiva', true).order('ordine').order('creato_il'); if (error) throw error; S.data.faccende = data || []; },
      async fatte() {
        const o = oggiZ().o, w = [C.isoWeek(o), C.isoWeek(C.addDays(o, -7))];
        const { data, error } = await sb.from('casa_faccende_fatte').select('*').in('settimana', w).order('fatta_il', { ascending: false });
        if (error) throw error; S.data.fatte = data || [];
      },
      async spese() {
        const da = C.key(C.addDays(oggiZ().o, -70));
        const [a, b] = await Promise.all([
          sb.from('casa_spese').select('*').gte('data', da).order('data', { ascending: false }).order('creato_il', { ascending: false }).limit(300),
          sb.from('casa_spese_riepilogo').select('*').maybeSingle()
        ]);
        if (a.error) throw a.error; if (b.error) throw b.error;
        S.data.spese = a.data || []; S.data.riepilogo = b.data || null;
      },
      async ricorrenze() { const { data, error } = await sb.from('casa_ricorrenze').select('*').order('data'); if (error) throw error; S.data.ricorrenze = data || []; },
      async eventi() {
        const da = new Date(Date.now() - 36 * 3600e3).toISOString(), a = new Date(Date.now() + 16 * 864e5).toISOString();
        const { data, error } = await sb.from('casa_eventi').select('*').gte('fine', da).lt('inizio', a).order('inizio').limit(400);
        if (error) throw error; S.data.eventi = data || [];
      },
      async brief() { const { data, error } = await sb.from('casa_brief').select('*').order('creato_il', { ascending: false }).limit(6); if (error) throw error; S.data.brief = data || []; }
    };
    const TAB = { casa_config: 'config', casa_spesa: 'spesa', casa_bigliettini: 'note', casa_faccende: 'faccende', casa_faccende_fatte: 'fatte', casa_spese: 'spese', casa_ricorrenze: 'ricorrenze', casa_eventi: 'eventi', casa_brief: 'brief' };
    const pending = {};
    const ricarica = nome => {
      clearTimeout(pending[nome]);
      pending[nome] = setTimeout(async () => { try { await load[nome](); ev.emit(); } catch (e) { console.warn(e); } }, 250);
    };
    const tutto = async () => { await Promise.all(Object.keys(load).map(k => load[k]())); };

    let canale = null, sicurezza = null;
    const ascolta = () => {
      if (canale) return;
      canale = sb.channel('casa');
      Object.keys(TAB).forEach(t => canale.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => ricarica(TAB[t])));
      canale.subscribe();
      sicurezza = setInterval(() => { tutto().then(ev.emit).catch(e => console.warn(e)); }, 5 * 60e3);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tutto().then(ev.emit).catch(() => {}); });
    };

    async function dopoAccesso(session) {
      const { data, error } = await sb.from('casa_membri').select('persona').eq('user_id', session.user.id).maybeSingle();
      if (error) { set('errore', err(error, 'Non riesco a leggere i membri della casa (hai lanciato schema.sql?)')); return; }
      S.me = { id: session.user.id, email: session.user.email, persona: data ? data.persona : null };
      if (!data) { set('estraneo'); return; }
      try { await tutto(); } catch (e) { set('errore', err(e, 'Non riesco a caricare i dati')); return; }
      ascolta();
      set('pronto');
    }
    S.avvia = async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (!data.session) { set('accesso'); return; }
        await dopoAccesso(data.session);
      } catch (e) { set('errore', err(e, 'Supabase non risponde')); }
    };
    sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') { S.me = null; S.data = vuoti(); set('accesso'); } });

    /* ---- azioni (ritornano '' se tutto ok, altrimenti il messaggio d'errore) ---- */
    const run = async (cosa, fn, dopo) => {
      try { const { error } = await fn(); if (error) throw error; if (dopo) await Promise.all(dopo.map(k => load[k]())); ev.emit(); return ''; }
      catch (e) { return err(e, cosa); }
    };
    S.accedi = async (email, password) => {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return error.message === 'Invalid login credentials' ? 'Email o password non corrette.' : error.message;
      await dopoAccesso(data.session); return '';
    };
    S.esci = async () => { await sb.auth.signOut(); };
    S.aggiungiVoce = (nome, chi, via) => run('Non riesco ad aggiungere', () => sb.from('casa_spesa').insert({ nome, chi, via }), ['spesa']);
    S.segnaVoce = id => { const it = S.data.spesa.find(x => x.id === id); return run('Non riesco ad aggiornare', () => sb.from('casa_spesa').update({ preso_il: it && it.preso_il ? null : new Date().toISOString() }).eq('id', id), ['spesa']); };
    S.aggiungiNota = (testo, chi, via) => run('Non riesco a inviare il bigliettino', () => sb.from('casa_bigliettini').insert({ testo, chi, via }), ['note']);
    S.leggiNota = id => run('Non riesco ad aggiornare', () => sb.from('casa_bigliettini').update({ letto_il: new Date().toISOString() }).eq('id', id), ['note']);
    S.faccendaFatta = (faccenda_id, chi) => run('Non riesco a segnare la faccenda', () => sb.from('casa_faccende_fatte').insert({ faccenda_id, chi }), ['fatte']);
    S.annullaFatta = id => run('Non riesco ad annullare', () => sb.from('casa_faccende_fatte').delete().eq('id', id), ['fatte']);
    S.salvaFaccenda = f => run('Non riesco a salvare la faccenda', () => (f.id ? sb.from('casa_faccende').update({ nome: f.nome, punti: f.punti, volte_settimana: f.volte_settimana, persona_base: f.persona_base }).eq('id', f.id) : sb.from('casa_faccende').insert({ nome: f.nome, punti: f.punti, volte_settimana: f.volte_settimana, persona_base: f.persona_base, ordine: (S.data.faccende.length + 1) })), ['faccende']);
    S.togliFaccenda = id => run('Non riesco a togliere la faccenda', () => sb.from('casa_faccende').update({ attiva: false }).eq('id', id), ['faccende']);
    S.aggiungiSpesa = s => run('Non riesco a salvare la spesa', () => sb.from('casa_spese').insert(s), ['spese']);
    S.togliSpesa = id => run('Non riesco a cancellare', () => sb.from('casa_spese').delete().eq('id', id), ['spese']);
    S.salvaRicorrenza = r => run('Non riesco a salvare', () => sb.from('casa_ricorrenze').insert(r), ['ricorrenze']);
    S.togliRicorrenza = id => run('Non riesco a cancellare', () => sb.from('casa_ricorrenze').delete().eq('id', id), ['ricorrenze']);
    S.salvaDati = (path, val) => {
      const dati = C.deepSet(C.clone(S.data.config.dati || {}), path, val);
      S.data.config.dati = dati; ev.emit();
      return run('Non riesco a salvare le impostazioni', () => sb.from('casa_config').update({ dati }).eq('id', 1), ['config']);
    };
    S.salvaCollegamento = (nome, val) => {
      const coll = { ...(S.data.config.collegamenti || {}), [nome]: val };
      S.data.config.collegamenti = coll; ev.emit();
      return run('Non riesco a salvare il collegamento', () => sb.from('casa_config').update({ collegamenti: coll }).eq('id', 1), ['config']);
    };
    return S;
  };

  /* =====================================================================
     Archivio di esempio (per provare l'app senza database)
     ===================================================================== */
  const DEMO_KEY = 'casa-esempio-v2';
  const iso = (d, t) => `${d}T${t}:00+01:00`;
  const DEMO = () => ({
    config: {
      dati: {
        nomi: { M: 'Matteo', G: 'Gaia' },
        casa: { indirizzo: 'Lugano', lat: 46.004, lon: 8.978 },
        lavoro: { nome: 'Interroll', indirizzo: 'Via Gorelle 3, 6592 Sant\'Antonino', lat: 46.155, lon: 8.985, arrivo: '08:30', margine: 5, chi: 'MG' },
        schermo: { notte_dalle: '23:00', notte_alle: '06:15', tema: 'auto' },
        spesa: { giorno_italia: 6, persone: 2 },
        conti: { quota_m: 50 },
        faccende: { rotazione: 'alterna' },
        trasloco: '2026-12-01',
        alias: { M: ['Matteo'], G: ['Gaia'] }
      },
      collegamenti: { tomtom_key: 'esempio', ical_url: 'esempio', siri_token: '' }
    },
    spesa: [
      { id: 's1', nome: 'Latte intero', chi: 'G', via: 'Siri', creato_il: iso('2026-12-02', '06:58') },
      { id: 's2', nome: 'Caffè in grani', chi: 'G', via: 'bigliettino', creato_il: iso('2026-12-02', '07:05') },
      { id: 's3', nome: 'Pane', chi: 'M', via: 'tablet', creato_il: iso('2026-12-01', '21:10') },
      { id: 's4', nome: 'Uova (6)', chi: 'M', via: 'telefono', creato_il: iso('2026-12-01', '20:40') },
      { id: 's5', nome: 'Mozzarella ×2', chi: 'G', via: 'telefono', creato_il: iso('2026-12-01', '19:30') },
      { id: 's6', nome: 'Pomodorini', chi: 'G', via: 'tablet', creato_il: iso('2026-12-01', '19:20') },
      { id: 's7', nome: 'Petto di pollo 800 g', chi: 'M', via: 'Siri', carne_kg: 0.8, creato_il: iso('2026-12-01', '18:50') },
      { id: 's8', nome: 'Parmigiano', chi: 'M', via: 'telefono', creato_il: iso('2026-12-01', '18:40') },
      { id: 's9', nome: 'Detersivo piatti', chi: 'G', via: 'Siri', creato_il: iso('2026-12-01', '18:30') }
    ],
    note: [
      { id: 'n1', chi: 'G', testo: 'Caffè finito, l’ho messo in lista. Buona giornata!', via: 'telefono', creato_il: iso('2026-12-02', '07:05'), letto_il: null },
      { id: 'n0', chi: 'M', testo: 'Stasera torno verso le 18:15.', via: 'Siri', creato_il: iso('2026-12-01', '22:10'), letto_il: iso('2026-12-01', '22:30') }
    ],
    faccende: [
      { id: 'f1', nome: 'Aspirapolvere', punti: 2, volte_settimana: 1, persona_base: 'M', ordine: 1 },
      { id: 'f2', nome: 'Bagno', punti: 3, volte_settimana: 1, persona_base: 'M', ordine: 2 },
      { id: 'f3', nome: 'Cucina a fondo', punti: 3, volte_settimana: 1, persona_base: 'G', ordine: 3 },
      { id: 'f4', nome: 'Cambio lenzuola', punti: 2, volte_settimana: 1, persona_base: 'G', ordine: 4 },
      { id: 'f5', nome: 'Lavatrici e stendere', punti: 2, volte_settimana: 2, persona_base: 'M', ordine: 5 },
      { id: 'f6', nome: 'Spazzatura e riciclo', punti: 1, volte_settimana: 2, persona_base: 'G', ordine: 6 }
    ],
    fatte: [
      { id: 'd1', faccenda_id: 'f3', chi: 'G', punti: 3, settimana: '2026-W49', fatta_il: iso('2026-12-01', '20:00') },
      { id: 'd2', faccenda_id: 'f5', chi: 'M', punti: 2, settimana: '2026-W49', fatta_il: iso('2026-12-01', '19:00') },
      { id: 'd3', faccenda_id: 'f6', chi: 'G', punti: 1, settimana: '2026-W49', fatta_il: iso('2026-12-01', '21:30') }
    ],
    spese: [
      { id: 'x1', data: '2026-12-02', descrizione: 'Migros', importo: 23.4, pagato_da: 'G', quota_m: 50, categoria: 'Spesa', tipo: 'spesa', via: 'Siri', creato_il: iso('2026-12-02', '07:40') },
      { id: 'x2', data: '2026-12-01', descrizione: 'Coop', importo: 38.6, pagato_da: 'G', quota_m: 50, categoria: 'Spesa', tipo: 'spesa', via: 'telefono', creato_il: iso('2026-12-01', '18:20') },
      { id: 'x3', data: '2026-12-01', descrizione: 'Swisscom internet', importo: 49.9, pagato_da: 'M', quota_m: 50, categoria: 'Bollette', tipo: 'spesa', via: 'telefono', creato_il: iso('2026-12-01', '09:00') }
    ],
    riepilogo: null,
    ricorrenze: [
      { id: 'r1', titolo: 'Settimana bianca', data: '2026-12-19', annuale: false },
      { id: 'r2', titolo: 'Natale', data: '2026-12-25', annuale: true }
    ],
    eventi: [
      { uid: 'e1', inizio: iso('2026-12-02', '12:30'), fine: iso('2026-12-02', '13:30'), titolo: 'Pranzo con i colleghi', chi: 'M' },
      { uid: 'e2', inizio: iso('2026-12-02', '19:00'), fine: iso('2026-12-02', '20:00'), titolo: 'Pilates', chi: 'G' },
      { uid: 'e3', inizio: iso('2026-12-02', '20:30'), fine: iso('2026-12-02', '21:00'), titolo: 'Chiamata con i miei', chi: 'M' },
      { uid: 'e4', inizio: iso('2026-12-03', '18:45'), fine: iso('2026-12-03', '22:30'), titolo: 'Cena da Luca e Sara', chi: 'MG' },
      { uid: 'e5', inizio: iso('2026-12-05', '10:00'), fine: iso('2026-12-05', '12:00'), titolo: 'Spesa all’Esselunga', chi: 'MG' },
      { uid: 'e6', inizio: iso('2026-12-05', '16:00'), fine: iso('2026-12-05', '18:30'), titolo: 'Natale in Piazza', luogo: 'Lugano', chi: 'MG' },
      { uid: 'e7', inizio: iso('2026-12-06', '12:30'), fine: iso('2026-12-06', '15:00'), titolo: 'Pranzo in famiglia', chi: 'MG' },
      { uid: 'e8', inizio: iso('2026-12-07', '19:30'), fine: iso('2026-12-07', '21:00'), titolo: 'Calcetto', chi: 'M' }
    ],
    brief: [
      { id: 3, tipo: 'mattina', testo: 'Buon sabato! Cielo sereno e 10° nel pomeriggio, perfetto per Natale in Piazza alle 16. Per l’Esselunga avete 9 cose in lista e 0.8 kg di carne: siete dentro la franchigia.', chips: [{ t: 'ok', i: 'check', x: 'Franchigia ok' }], creato_il: iso('2026-12-05', '08:30'), modello: 'esempio' },
      { id: 2, tipo: 'sera', testo: 'Domani sole ma 0° all’alba: brina sul parabrezza, uscite entro le 07:49. In serata: cena da Luca e Sara alle 18:45.', chips: [{ t: 'warn', i: 'frost', x: 'Brina: +5 min' }, { t: 'ok', i: 'car', x: 'Domani entro 07:49' }], creato_il: iso('2026-12-02', '18:00'), modello: 'esempio' },
      { id: 1, tipo: 'mattina', testo: 'Asciutto fino alle 15, poi pioggia: portate l’ombrello. Sull’A2 c’è un po’ di coda, uscite entro le 07:54. Stasera Gaia ha pilates alle 19: l’aspirapolvere tocca a Matteo.', chips: [{ t: 'warn', i: 'umbrella', x: 'Ombrello' }, { t: 'ok', i: 'car', x: 'Esci entro 07:54' }, { t: '', i: 'cal', x: '3 impegni oggi' }], creato_il: iso('2026-12-02', '06:15'), modello: 'esempio' }
    ]
  });

  C.creaArchivioEsempio = (opzioni = {}) => {
    const ev = emitter();
    let data = DEMO();
    if (opzioni.ricorda !== false) {
      try { const raw = localStorage.getItem(DEMO_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.spesa && o.config) data = o; } } catch (e) { }
    }
    const S = { tipo: 'esempio', stato: 'pronto', errore: '', me: { id: 'esempio', email: 'esempio', persona: opzioni.persona || 'T' }, data, on: ev.on };
    const salva = () => { if (opzioni.ricorda === false) return; try { localStorage.setItem(DEMO_KEY, JSON.stringify(S.data)); } catch (e) { } };
    const cambia = () => { salva(); ev.emit(); return Promise.resolve(''); };
    const id = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ora = () => (opzioni.orologio ? opzioni.orologio.now() : new Date()).toISOString();
    S.avvia = () => { ev.emit(); return Promise.resolve(); };
    S.accedi = () => Promise.resolve('');
    S.esci = () => Promise.resolve();
    S.ripristina = () => { S.data = DEMO(); cambia(); };
    S.aggiungiVoce = (nome, chi, via) => { const n = String(nome).trim().replace(/\s+/g, ' '); S.data.spesa.unshift({ id: id('s'), nome: C.cap(n), chi, via, carne_kg: C.carneKg(n), creato_il: ora(), preso_il: null }); return cambia(); };
    S.segnaVoce = vid => { const it = S.data.spesa.find(x => x.id === vid); if (it) it.preso_il = it.preso_il ? null : ora(); return cambia(); };
    S.aggiungiNota = (testo, chi, via) => { S.data.note.unshift({ id: id('n'), chi, testo, via, creato_il: ora(), letto_il: null }); return cambia(); };
    S.leggiNota = nid => { const n = S.data.note.find(x => x.id === nid); if (n) n.letto_il = ora(); return cambia(); };
    S.faccendaFatta = (fid, chi) => {
      const f = S.data.faccende.find(x => x.id === fid); const oggi = C.zParts(opzioni.orologio ? opzioni.orologio.now() : new Date()).o;
      S.data.fatte.unshift({ id: id('d'), faccenda_id: fid, chi, punti: f ? f.punti : 1, settimana: C.isoWeek(oggi), fatta_il: ora() }); return cambia();
    };
    S.annullaFatta = did => { S.data.fatte = S.data.fatte.filter(x => x.id !== did); return cambia(); };
    S.salvaFaccenda = f => {
      if (f.id) Object.assign(S.data.faccende.find(x => x.id === f.id) || {}, f);
      else S.data.faccende.push({ ...f, id: id('f'), ordine: S.data.faccende.length + 1 });
      return cambia();
    };
    S.togliFaccenda = fid => { S.data.faccende = S.data.faccende.filter(x => x.id !== fid); return cambia(); };
    S.aggiungiSpesa = s => { S.data.spese.unshift({ id: id('x'), data: C.zParts(opzioni.orologio ? opzioni.orologio.now() : new Date()).key, quota_m: 50, tipo: 'spesa', categoria: 'Casa', via: 'telefono', ...s, creato_il: ora() }); return cambia(); };
    S.togliSpesa = xid => { S.data.spese = S.data.spese.filter(x => x.id !== xid); return cambia(); };
    S.salvaRicorrenza = r => { S.data.ricorrenze.push({ ...r, id: id('r') }); return cambia(); };
    S.togliRicorrenza = rid => { S.data.ricorrenze = S.data.ricorrenze.filter(x => x.id !== rid); return cambia(); };
    S.salvaDati = (path, val) => { C.deepSet(S.data.config.dati, path, val); return cambia(); };
    S.salvaCollegamento = (nome, val) => { S.data.config.collegamenti[nome] = val; return cambia(); };
    return S;
  };

  /* =====================================================================
     Dati esterni: meteo (Open-Meteo, modello MeteoSvizzera), traffico
     (TomTom), mercati (data/mercati.json scritto dalla GitHub Action)
     ===================================================================== */
  C.creaEsterniLive = (archivio, orologio) => {
    const ev = emitter();
    const E = { tipo: 'live', meteo: null, meteoErr: '', traffico: null, trafficoErr: '', domani: null, mercati: null, on: ev.on };
    const cfg = () => (archivio.data.config && archivio.data.config.dati) || {};
    const coll = () => (archivio.data.config && archivio.data.config.collegamenti) || {};
    const last = { meteo: 0, traffico: 0, domani: 0, mercati: 0 };

    async function meteo() {
      const c = cfg().casa || {}, lat = Number(c.lat) || 46.0037, lon = Number(c.lon) || 8.9511;
      const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Europe%2FZurich&forecast_days=3`;
      let j = null;
      for (const url of [base + '&models=meteoswiss_icon_seamless', base]) {
        try { const r = await fetch(url); if (r.ok) { j = await r.json(); if (j && j.hourly && j.hourly.temperature_2m && j.hourly.temperature_2m.some(v => v != null)) break; } } catch (e) { j = null; }
      }
      if (!j || !j.hourly) { E.meteoErr = 'Meteo non raggiungibile'; return; }
      const giorni = {};
      j.hourly.time.forEach((t, i) => {
        const k = t.slice(0, 10), h = Number(t.slice(11, 13));
        const g = giorni[k] || (giorni[k] = { t: Array(24).fill(null), p: Array(24).fill(null), c: Array(24).fill(null) });
        g.t[h] = j.hourly.temperature_2m[i] == null ? null : Math.round(j.hourly.temperature_2m[i]);
        g.p[h] = j.hourly.precipitation_probability ? j.hourly.precipitation_probability[i] : null;
        g.c[h] = j.hourly.weather_code ? j.hourly.weather_code[i] : null;
      });
      Object.values(giorni).forEach(g => ['t', 'p', 'c'].forEach(k => { for (let h = 0; h < 24; h++) if (g[k][h] == null) g[k][h] = g[k][h - 1] ?? g[k].find(v => v != null) ?? 0; }));
      E.meteo = { giorni, aggiornato: new Date() }; E.meteoErr = '';
    }

    async function rotta(parametri) {
      const key = coll().tomtom_key, c = cfg().casa || {}, l = cfg().lavoro || {};
      if (!key || !c.lat || !l.lat) return { errore: 'da collegare' };
      const url = `https://api.tomtom.com/routing/1/calculateRoute/${c.lat},${c.lon}:${l.lat},${l.lon}/json?key=${encodeURIComponent(key)}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&${parametri}`;
      try {
        const r = await fetch(url); if (!r.ok) return { errore: r.status === 403 ? 'chiave TomTom non valida' : 'traffico non raggiungibile' };
        const j = await r.json(), s = j.routes && j.routes[0] && j.routes[0].summary; if (!s) return { errore: 'percorso non trovato' };
        return { min: Math.round(s.travelTimeInSeconds / 60), ritardo: Math.round((s.trafficDelayInSeconds || 0) / 60), libero: s.noTrafficTravelTimeInSeconds ? Math.round(s.noTrafficTravelTimeInSeconds / 60) : null, partenza: s.departureTime, arrivo: s.arrivalTime, km: Math.round((s.lengthInMeters || 0) / 100) / 10, alle: new Date() };
      } catch (e) { return { errore: 'traffico non raggiungibile' }; }
    }
    async function traffico() { const r = await rotta('departAt=now'); if (r.errore) { E.trafficoErr = r.errore; } else { E.traffico = r; E.trafficoErr = ''; } }
    async function domani() {
      const z = C.zParts(orologio.now()), l = cfg().lavoro || {};
      let d = C.addDays(z.o, 1); for (let i = 0; i < 7 && !C.feriale(d); i++) d = C.addDays(d, 1);
      const [h, m] = String(l.arrivo || '08:30').split(':').map(Number);
      const r = await rotta('arriveAt=' + encodeURIComponent(C.rfc3339(C.zDate(d.y, d.m, d.d, h, m))));
      if (!r.errore) E.domani = { ...r, giorno: C.key(d) };
    }
    async function mercati() {
      try { const r = await fetch('data/mercati.json?' + Math.floor(Date.now() / 600e3), { cache: 'no-store' }); if (r.ok) E.mercati = await r.json(); } catch (e) { }
    }
    E.geocodifica = async (indirizzo) => {
      const key = coll().tomtom_key;
      try {
        if (key) {
          const r = await fetch(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(indirizzo)}.json?key=${encodeURIComponent(key)}&limit=1&countrySet=CH,IT&language=it-IT`);
          const j = await r.json(); const x = j.results && j.results[0];
          if (x) return { lat: +x.position.lat.toFixed(5), lon: +x.position.lon.toFixed(5), trovato: x.address && x.address.freeformAddress };
        }
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(indirizzo.split(',').pop().trim() || indirizzo)}&count=1&language=it&countryCode=CH`);
        const j = await r.json(); const x = j.results && j.results[0];
        if (x) return { lat: +x.latitude.toFixed(5), lon: +x.longitude.toFixed(5), trovato: `${x.name} (solo la località: aggiungi la chiave TomTom per l’indirizzo preciso)` };
      } catch (e) { }
      return null;
    };
    E.aggiorna = async (forza) => {
      const now = Date.now(), z = C.zParts(orologio.now()), l = cfg().lavoro || {};
      const jobs = [];
      if (forza || now - last.meteo > 15 * 60e3) { last.meteo = now; jobs.push(meteo()); }
      if (forza || now - last.mercati > 30 * 60e3) { last.mercati = now; jobs.push(mercati()); }
      const mattina = C.feriale(z.o) && l.chi && z.min >= 330 && z.min <= 585;
      if (mattina && (forza || now - last.traffico > 5 * 60e3)) { last.traffico = now; jobs.push(traffico()); }
      if ((z.min >= 960 || z.min < 330) && (forza || now - last.domani > 60 * 60e3)) { last.domani = now; jobs.push(domani()); }
      if (jobs.length) { await Promise.all(jobs); ev.emit(); }
    };
    setInterval(() => E.aggiorna(false), 60e3);
    archivio.on(() => { const k = JSON.stringify([cfg().casa, cfg().lavoro, coll().tomtom_key]); if (k !== E._k) { E._k = k; E.aggiorna(true); } });
    return E;
  };

  /* ---------- dati esterni di esempio ---------- */
  const WX = {
    '2026-12-02': { t: [5,5,4,4,4,4,4,4,5,7,8,9,10,11,11,10,9,8,8,7,7,6,6,6], p: [10,10,5,5,5,5,5,5,10,10,15,20,25,30,40,55,70,85,85,80,70,55,40,30], c: [2,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3,61,63,63,63,61,61,3,3] },
    '2026-12-03': { t: [5,4,3,2,1,1,0,0,2,4,6,8,9,9,9,8,6,5,4,3,3,2,2,1], p: [20,10,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5], c: [3,2,1,1,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0] },
    '2026-12-04': { t: [1,1,1,0,0,0,0,1,2,4,6,7,8,8,8,7,6,5,4,4,3,3,2,2], p: [5,5,5,5,5,5,5,5,5,10,10,10,10,15,15,15,10,10,10,10,10,10,10,10], c: [1,1,1,1,1,1,2,2,2,2,2,2,2,3,3,3,2,2,1,1,1,1,1,1] },
    '2026-12-05': { t: [1,1,0,0,-1,-1,-1,0,1,3,6,8,10,10,10,9,7,5,4,3,3,2,2,1], p: [5,5,5,5,5,5,5,5,5,5,0,0,0,0,0,0,0,5,5,5,5,5,5,5], c: [0,0,0,0,0,0,45,45,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0] },
    '2026-12-06': { t: [1,1,1,0,0,0,0,0,1,3,5,7,8,9,9,8,6,5,4,4,3,3,2,2], p: [5,5,5,5,5,5,5,10,10,10,15,15,20,20,20,15,10,10,10,10,10,10,10,10], c: [1,1,1,1,1,2,2,2,2,2,2,2,3,3,2,2,2,1,1,1,1,1,1,1] },
    '2026-12-07': { t: [2,2,2,1,1,1,1,1,2,4,6,7,8,8,8,7,6,5,4,4,3,3,3,2], p: [10,10,10,10,10,10,15,15,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20], c: [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3] }
  };
  C.creaEsterniEsempio = orologio => {
    const ev = emitter();
    const tr = min => {
      if (min >= 420 && min < 495) return { min: 31, ritardo: 6, libero: 25 };
      if (min >= 495 && min < 540) return { min: 28, ritardo: 3, libero: 25 };
      if (min >= 990 && min < 1110) return { min: 34, ritardo: 9, libero: 25 };
      return { min: 25, ritardo: 0, libero: 25 };
    };
    const E = {
      tipo: 'esempio', on: ev.on, meteoErr: '', trafficoErr: '',
      get meteo() { return { giorni: WX, aggiornato: orologio.now() }; },
      get traffico() { const z = C.zParts(orologio.now()); return { ...tr(z.min), alle: orologio.now() }; },
      get domani() { const z = C.zParts(orologio.now()); let d = C.addDays(z.o, 1); for (let i = 0; i < 7 && !C.feriale(d); i++) d = C.addDays(d, 1); return { min: 31, ritardo: 6, libero: 25, giorno: C.key(d) }; },
      mercati: { aggiornato: '2026-12-02T07:30:00+01:00', eur_chf: 0.936, eur_chf_var: -0.1, interroll: { prezzo: 2154, var: 0.8 } },
      geocodifica: async q => ({ lat: 46.004, lon: 8.978, trovato: q + ' (esempio)' }),
      aggiorna: async () => { ev.emit(); }
    };
    return E;
  };
})(window.Casa = window.Casa || {});
