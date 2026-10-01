/* Dashboard Casa · viste: modello dei dati per lo schermo, riquadri del tablet, schermate del telefono */
(function (C) {
  'use strict';
  const { esc, hm, nf, I } = C;

  /* =====================================================================
     Modello: tutto quello che serve per disegnare, calcolato una volta
     ===================================================================== */
  C.vm = (A, E, orologio, opz = {}) => {
    const now = orologio.now(), z = C.zParts(now), o = z.o, min = z.min;
    const D = A.data, cfg = (D.config && D.config.dati) || {}, coll = (D.config && D.config.collegamenti) || {};
    const nomi = { M: (cfg.nomi && cfg.nomi.M) || 'Matteo', G: (cfg.nomi && cfg.nomi.G) || 'Gaia', T: 'tablet' };
    const casa = cfg.casa || {}, lavoro = cfg.lavoro || {}, schermo = cfg.schermo || {}, spesaCfg = cfg.spesa || {};
    const lat = Number(casa.lat) || 46.0037, lon = Number(casa.lon) || 8.9511;
    const sun = C.sun(o, lat, lon);
    const v = { A, E, now, z, o, min, cfg, coll, nomi, sun, esempio: A.tipo === 'esempio', me: A.me || {} };

    /* calendario (FamilyWall + festivi ticinesi) */
    const ev = (D.eventi || []).map(e => {
      const a = C.zParts(new Date(e.inizio)), b = C.zParts(new Date(e.fine));
      return { uid: e.uid, titolo: e.titolo, luogo: e.luogo, chi: e.chi || '', allDay: !!e.tutto_il_giorno, k: a.key, kEnd: b.key, s: a.min, e: b.key === a.key ? b.min : 1440, start: hm(a.min), end: hm(b.min) };
    });
    v.eventsOn = d => {
      const k = C.key(d), f = C.festivo(d);
      const list = ev.filter(e => (e.allDay ? (e.k <= k && (k < e.kEnd || e.k === e.kEnd)) : e.k === k)).sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.s - b.s));
      return f ? [{ uid: 'festa-' + k, titolo: `${f}, festivo in Ticino`, chi: '', allDay: true, festa: true }, ...list] : list;
    };
    const occupato = (d, p) => v.eventsOn(d).some(e => !e.allDay && (e.chi === p || e.chi === 'MG') && Math.min(e.e, 1320) - Math.max(e.s, 1140) >= 45);
    v.serateLibere = (da, n) => { const out = []; for (let i = 0; i < n; i++) { const d = C.addDays(da, i); if (!occupato(d, 'M') && !occupato(d, 'G')) out.push(d); } return out; };

    /* automazioni su GitHub: com'è andata l'ultima volta (le Action lo scrivono in collegamenti.automazioni) */
    v.auto = statoAutomazioni(v, D, E, coll, now);

    /* momento della giornata e colori */
    const nf_ = C.toMin(schermo.notte_dalle || '23:00'), nt = C.toMin(schermo.notte_alle || '06:15');
    const notte = nf_ > nt ? (min >= nf_ || min < nt) : (min >= nf_ && min < nt);
    let mode = notte ? 'notte' : (C.feriale(o) && min < 570 ? 'mattina' : (min >= 1050 ? 'sera' : 'giorno'));
    v.sveglio = false;
    if (mode === 'notte' && opz.sveglio) { mode = C.feriale(o) && min < 720 ? 'mattina' : 'sera'; v.sveglio = true; }
    v.mode = mode;
    const tema = schermo.tema || 'auto';
    v.look = mode === 'notte' ? 'notte' : tema === 'chiaro' ? 'giorno' : tema === 'scuro' ? 'sera' : (min >= sun.dawn && min < sun.dusk ? 'giorno' : 'sera');
    v.notteAlle = schermo.notte_alle || '06:15';

    /* meteo */
    v.wxDay = d => (E.meteo && E.meteo.giorni && E.meteo.giorni[C.key(d)]) || null;
    v.meteoOk = !!v.wxDay(o);
    v.rainFrom = (d, from) => { const w = v.wxDay(d); if (!w) return -1; for (let h = Math.max(0, Math.floor(from / 60)); h <= 22; h++) if (w.p[h] >= 50) return h; return -1; };
    v.brina = d => { const w = v.wxDay(d); return !!w && Math.min(...w.t.slice(5, 9)) <= 1; };

    /* tragitto */
    const arrivo = C.toMin(lavoro.arrivo || '08:30'), margine = Number(lavoro.margine ?? 5);
    v.lavoro = { nome: lavoro.nome || 'lavoro', arrivo: lavoro.arrivo || '08:30', chi: lavoro.chi || '', margine };
    v.lavoroOk = v.esempio || !!(coll.tomtom_key && casa.lat && lavoro.lat);
    v.chiLavora = lavoro.chi === 'MG' ? '' : lavoro.chi ? nomi[lavoro.chi] + ' · ' : '';
    const tr = E.traffico;
    v.trafficoErr = E.trafficoErr || '';
    if (tr && !tr.errore && tr.min) {
      const brina = v.brina(o) ? 5 : 0;
      v.tragitto = { min: tr.min, ritardo: tr.ritardo || 0, lb: arrivo - tr.min - margine - brina, brina, eta: min + tr.min, alle: tr.alle };
    }
    if (E.domani && !E.domani.errore && E.domani.min) {
      const dd = C.parseKey(E.domani.giorno), brina = v.brina(dd) ? 5 : 0;
      const lb = E.domani.partenza ? C.zParts(new Date(E.domani.partenza)).min - margine - brina : arrivo - E.domani.min - margine - brina;
      v.domani = { giorno: dd, lb, min: E.domani.min, brina };
    }

    /* spesa */
    const chiave = x => String(x.creato_il || '');
    v.aperte = (D.spesa || []).filter(i => !i.preso_il).sort((a, b) => chiave(b).localeCompare(chiave(a)));
    v.prese = (D.spesa || []).filter(i => i.preso_il && (now - new Date(i.preso_il)) < 12 * 3600e3).sort((a, b) => String(b.preso_il).localeCompare(String(a.preso_il)));
    v.carne = v.aperte.reduce((a, i) => a + (Number(i.carne_kg) || 0), 0);
    v.persone = Number(spesaCfg.persone || 2);
    v.itDay = Number(spesaCfg.giorno_italia ?? 6);
    v.itOggi = C.weekday(o) === v.itDay;
    v.itDomani = C.weekday(C.addDays(o, 1)) === v.itDay;

    /* bigliettini */
    v.nota = (D.note || []).find(n => !n.letto_il) || null;

    /* faccende */
    const isoK = C.isoWeek(o), n = C.settimanaCasa(o, cfg.trasloco), rot = (cfg.faccende && cfg.faccende.rotazione) || 'alterna';
    const fatteSett = (D.fatte || []).filter(f => f.settimana === isoK);
    v.settimanaN = n;
    v.faccende = (D.faccende || []).filter(f => f.attiva !== false).map(f => {
      const log = fatteSett.filter(x => x.faccenda_id === f.id);
      return { ...f, assegnata: C.assegnata(f, n, isoK, rot), fatte: log.length, completa: log.length >= (f.volte_settimana || 1), log };
    });
    v.punti = { M: 0, G: 0 };
    fatteSett.forEach(x => { if (v.punti[x.chi] != null) v.punti[x.chi] += Number(x.punti) || 0; });
    v.totali = { M: 0, G: 0 };
    v.faccende.forEach(f => { v.totali[f.assegnata] += (f.punti || 0) * (f.volte_settimana || 1); });
    const aperteF = v.faccende.filter(f => !f.completa);
    const liberi = ['M', 'G'].filter(p => !occupato(o, p));
    let stasera = null;
    if (liberi.length === 1) stasera = aperteF.find(f => f.assegnata === liberi[0]);
    else if (liberi.length === 2) { const chi = v.punti.M <= v.punti.G ? 'M' : 'G'; stasera = aperteF.find(f => f.assegnata === chi); }
    v.stasera = stasera || aperteF[0] || null;
    v.faccendeAperte = aperteF;

    /* spese di casa */
    v.spese = (D.spese || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || chiave(b).localeCompare(chiave(a)));
    v.saldo = D.riepilogo ? Number(D.riepilogo.g_deve_a_m) : Math.round(C.saldoDa(D.spese || []) * 100) / 100;
    const meseK = z.key.slice(0, 7);
    v.totMese = D.riepilogo ? Number(D.riepilogo.totale_mese) : (D.spese || []).filter(s => s.tipo !== 'saldo' && String(s.data).slice(0, 7) === meseK).reduce((a, s) => a + Number(s.importo), 0);
    v.quotaM = Number((cfg.conti && cfg.conti.quota_m) ?? 50);

    /* ricorrenze e countdown */
    const cd = [];
    if (cfg.trasloco) {
      const t = C.parseKey(cfg.trasloco), dd = C.dayDiff(t, o);
      if (dd >= 0) cd.push({ n: dd + 1, u: '°', l: 'giorno nella casa nuova', ord: -1 });
      else cd.push({ n: -dd, u: 'gg', l: 'Trasloco', ord: -dd });
    }
    (D.ricorrenze || []).forEach(r => {
      let t = C.parseKey(r.data);
      if (r.annuale) { t = C.ymd(o.y, t.m, t.d); if (C.dayDiff(o, t) < 0) t = C.ymd(o.y + 1, t.m, t.d); }
      const dd = C.dayDiff(o, t);
      if (dd >= 0) cd.push({ n: dd, u: dd === 0 ? '' : 'gg', l: dd === 0 ? `${r.titolo}: oggi` : r.titolo, ord: dd, id: r.id, data: t });
    });
    v.countdown = cd.sort((a, b) => a.ord - b.ord);

    /* brief */
    const tipo = min >= 1050 || min < 300 ? 'sera' : 'mattina';
    const giornoBrief = tipo === 'sera' && min < 300 ? C.key(C.addDays(o, -1)) : z.key;
    const b = (D.brief || []).find(x => x.tipo === tipo && C.zParts(new Date(x.creato_il)).key === giornoBrief);
    const titoli = { mattina: C.weekday(o) === 6 ? 'Buon sabato' : C.weekday(o) === 0 ? 'Buona domenica' : C.festivo(o) ? 'Buona festa' : 'Il brief di stamattina', sera: 'Per domani' };
    v.brief = b ? { titolo: titoli[tipo], alle: hm(C.zParts(new Date(b.creato_il)).min), testo: b.testo, chips: b.chips || [], auto: false } : briefAuto(v, tipo, titoli[tipo]);

    /* mercati */
    v.mercati = E.mercati || null;
    return v;
  };

  /* stato delle tre automazioni su GitHub, con una frase che dice cosa fare */
  const quandoTesto = (d, oggi) => {
    const z = C.zParts(d), diff = C.dayDiff(z.o, oggi);
    return diff === 0 ? `alle ${hm(z.min)}` : diff === 1 ? `ieri alle ${hm(z.min)}` : `${C.shortDate(z.o)} alle ${hm(z.min)}`;
  };
  function statoAutomazioni(v, D, E, coll, now) {
    const auto = coll.automazioni || {}, oggi = v.o, ore = d => (now - d) / 3600e3;
    const data = x => { const d = x ? new Date(x) : null; return d && !isNaN(d) ? d : null; };
    const riga = (stato, testo) => ({ stato, ok: stato === 'ok', testo });
    if (v.esempio) return { calendario: riga('ok', 'Letto alle 10:30: 9 eventi nelle prossime tre settimane.'), brief: riga('ok', 'Ultimo stamattina alle 06:11, scritto da Claude.'), mercati: riga('ok', 'Aggiornati alle 09:23.'), avviso: '' };

    const sc = auto.calendario, qc = data(sc && sc.quando);
    let cal;
    if (!coll.ical_url) cal = riga('nolink', 'Manca il link iCal di FamilyWall (sezione Calendario).');
    else if (!qc) cal = riga('mai', 'Non è ancora arrivato. Lo copia ogni 15 minuti l’automazione «Calendario FamilyWall»: su GitHub aprite il repository › Actions › Calendario FamilyWall › Run workflow. Se in Actions non c’è, manca la cartella .github.');
    else if (sc.ok === false) cal = riga('errore', `Ultimo tentativo ${quandoTesto(qc, oggi)}: ${sc.errore || 'errore sconosciuto'}.`);
    else if (ore(qc) > 2) cal = riga('fermo', `Fermo dall’ultima lettura (${quandoTesto(qc, oggi)}): controllate GitHub › Actions › Calendario FamilyWall.`);
    else cal = riga('ok', `Letto ${quandoTesto(qc, oggi)}: ${sc.eventi === 1 ? '1 evento' : `${sc.eventi || 0} eventi`} nelle prossime tre settimane.`);

    const ub = (D.brief || [])[0], qb = data(ub && ub.creato_il), nota = auto.brief && auto.brief.nota;
    let br;
    if (!qb) br = riga('mai', 'Non ancora scritto: parte verso le 06:10 e le 17:55. Per provarlo subito: GitHub › Actions › Brief di casa › Run workflow.');
    else if (ore(qb) > 26) br = riga('fermo', `Ultimo ${quandoTesto(qb, oggi)}: controllate GitHub › Actions › Brief di casa.`);
    else if (ub.modello === 'regole' && nota && !/senza chiave/.test(nota)) br = riga('errore', `Ultimo ${quandoTesto(qb, oggi)}, scritto a regole perché ${nota}.`);
    else br = riga('ok', `Ultimo ${quandoTesto(qb, oggi)}, ${ub.modello === 'regole' ? 'scritto a regole (senza Claude)' : 'scritto da Claude'}.`);

    const qm = data(E.mercati && E.mercati.aggiornato);
    let mk;
    if (!qm) mk = riga('mai', 'Non ancora aggiornati: girano ogni ora nei giorni feriali (a mano: GitHub › Actions › Mercati › Run workflow).');
    else if (ore(qm) > 80) mk = riga('fermo', `Ultimo aggiornamento ${quandoTesto(qm, oggi)}: controllate GitHub › Actions › Mercati.`);
    else mk = riga('ok', `Aggiornati ${quandoTesto(qm, oggi)}.`);

    const avviso = cal.stato === 'mai' ? 'calendario non ancora arrivato' : cal.stato === 'errore' ? 'il calendario non si legge' : cal.stato === 'fermo' ? 'calendario fermo'
      : (br.stato === 'errore' || br.stato === 'fermo' || mk.stato === 'fermo') ? 'automazioni da controllare' : '';
    return { calendario: cal, brief: br, mercati: mk, avviso };
  }

  /* brief automatico quando manca quello scritto da Claude */
  function briefAuto(v, tipo, titolo) {
    const { o, min, nomi } = v, chips = [], frasi = [];
    if (tipo === 'mattina') {
      if (v.meteoOk) {
        const r = v.rainFrom(o, min);
        frasi.push(r >= 0 ? `Asciutto fino alle ${r}, poi pioggia: portate l’ombrello.` : 'Niente pioggia in vista oggi.');
        if (r >= 0) chips.push({ t: 'warn', i: 'umbrella', x: 'Ombrello' });
      }
      if (v.mode === 'mattina' && v.tragitto) {
        frasi.push(`Per arrivare alle ${v.lavoro.arrivo} uscite entro le ${hm(v.tragitto.lb)}${v.tragitto.ritardo >= 3 ? `, c’è traffico (+${v.tragitto.ritardo} min)` : ''}.`);
        chips.push({ t: 'ok', i: 'car', x: `Esci entro ${hm(v.tragitto.lb)}` });
      }
      const oggi = v.eventsOn(o).filter(e => !e.allDay && e.s >= min);
      if (oggi.length) frasi.push(`Oggi: ${oggi.slice(0, 2).map(e => `${e.titolo.charAt(0).toLowerCase() + e.titolo.slice(1)} alle ${e.start}`).join(' e ')}.`);
      if (v.stasera) frasi.push(`${C.cap(v.stasera.nome)} tocca a ${nomi[v.stasera.assegnata]}.`);
      { const n = v.eventsOn(o).filter(e => !e.allDay).length; chips.push({ t: '', i: 'cal', x: n === 1 ? '1 impegno oggi' : `${n} impegni oggi` }); }
      if (v.itOggi && v.aperte.length) frasi.push(`Per la spesa in Italia ci sono ${v.aperte.length} cose in lista.`);
    } else {
      const t = C.addDays(o, 1), w = v.wxDay(t);
      if (w) frasi.push(`Domani ${Math.min(...w.t.slice(6, 22))}°–${Math.max(...w.t.slice(6, 22))}°, ${C.wText(w.c[12])}.`);
      if (v.domani && C.key(v.domani.giorno) === C.key(t)) { frasi.push(`Uscite entro le ${hm(v.domani.lb)}${v.domani.brina ? ' (c’è brina: 5 minuti in più)' : ''}.`); chips.push({ t: 'ok', i: 'car', x: `Domani entro ${hm(v.domani.lb)}` }); }
      if (v.domani && v.domani.brina) chips.unshift({ t: 'warn', i: 'frost', x: 'Brina: +5 min' });
      const nx = v.eventsOn(t).find(e => !e.allDay);
      frasi.push(nx ? `Domani: ${nx.titolo.charAt(0).toLowerCase() + nx.titolo.slice(1)} alle ${nx.start}.` : 'Domani sera siete liberi.');
    }
    return { titolo, alle: '', testo: frasi.join(' ') || 'Buona giornata!', chips, auto: true };
  }

  /* =====================================================================
     Pezzi comuni
     ===================================================================== */
  C.colore = w => (w === 'M' ? 'var(--m)' : w === 'G' ? 'var(--g)' : 'var(--ink-3)');
  C.anelli = (v, w) => (w ? `<span class="who" aria-label="${w === 'MG' ? 'Entrambi' : esc(v.nomi[w] || '')}">${w.split('').map(x => `<span class="ring" style="--c:${C.colore(x)}">${esc((v.nomi[x] || '?')[0])}</span>`).join('')}</span>` : '');
  const chip = c => `<span class="chip ${c.t || ''}">${I(c.i || 'spark')}${esc(c.x)}</span>`;
  const greeting = m => (m >= 300 && m < 720 ? 'Buongiorno' : m >= 720 && m < 1080 ? 'Buon pomeriggio' : m >= 1080 && m < 1380 ? 'Buonasera' : 'Buonanotte');
  const wi = (c, night) => I(C.wIconName(c, night), 'i wi');
  const franchigia = v => {
    const lim = v.persone, over = v.carne > lim;
    return `<div class="franchigia" aria-label="Franchigia doganale">
      <div class="fr-h"><b>Franchigia ${v.persone === 2 ? 'in due' : 'a testa'}</b><span>150 CHF a testa${v.persone === 2 ? ', 300 in due' : ''}</span></div>
      <div class="fr-row"><span>Carne</span><div class="meter${over ? ' over' : ''}"><span style="width:${Math.min(100, v.carne / lim * 100).toFixed(0)}%"></span></div><span>${nf(v.carne, 1)} di ${lim} kg</span></div>
      <div class="fr-note">${v.mercati && v.mercati.eur_chf ? `1 € = ${nf(v.mercati.eur_chf, 3)} CHF · ` : ''}il valore conta senza l’IVA italiana, se è sullo scontrino</div>
    </div>`;
  };

  /* =====================================================================
     Tablet: riquadri
     ===================================================================== */
  function sunArc(v) {
    const { rise, set } = v.sun, cx = 200, cy = 58, rx = 172, ry = 40;
    const f = (v.min - rise) / (set - rise), up = f >= 0 && f <= 1;
    const pt = t => [cx - rx * Math.cos(Math.PI * t), cy - ry * Math.sin(Math.PI * t)];
    const arc = (a, b) => { let d = ''; for (let i = 0; i <= 48; i++) { const [x, y] = pt(a + (b - a) * i / 48); d += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); } return d; };
    const done = up ? arc(0, f) : f > 1 ? arc(0, 1) : '';
    const [sx, sy] = up ? pt(f) : [0, 0];
    const mid = f < 0 ? `il sole sorge tra ${C.dur(rise - v.min)}` : f > 1 ? `buio da ${C.dur(v.min - set)}` : `luce ancora per ${C.dur(set - v.min)}`;
    return `<svg class="sunarc" viewBox="0 0 400 86" role="img" aria-label="Alba alle ${hm(rise)}, tramonto alle ${hm(set)}">
      <path d="${arc(0, 1)}" fill="none" stroke="var(--rule)" stroke-width="2" stroke-linecap="round"/>
      ${done ? `<path d="${done}" fill="none" stroke="var(--coppo)" stroke-width="2" stroke-linecap="round"/>` : ''}
      <path d="M212,58 L234,51 L250,40 L261,30 L270,27 L280,30 L292,42 L308,52 L328,58 Z" fill="var(--rule)"/>
      <line x1="6" y1="58" x2="394" y2="58" stroke="var(--ink-3)" stroke-width="1"/>
      <path d="M44,64 H118 M168,68 H246 M292,64 H356" stroke="var(--rule)" stroke-width="1.5" stroke-linecap="round"/>
      ${up ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" fill="var(--coppo)" stroke="var(--paper)" stroke-width="3"/>` : ''}
      <text x="6" y="83" font-size="13" fill="var(--ink-2)">alba ${hm(rise)}</text>
      <text x="200" y="83" font-size="13" fill="var(--ink-2)" text-anchor="middle">${mid}</text>
      <text x="394" y="83" font-size="13" fill="var(--ink-2)" text-anchor="end">tramonto ${hm(set)}</text>
    </svg>`;
  }

  const T = {};
  T.hero = v => {
    const compact = v.mode !== 'mattina', fest = C.festivo(v.o);
    return `<section class="tile bare hero${compact ? ' compact' : ''}" style="grid-area:hero" aria-label="Ora e data">
      <div class="greet">${greeting(v.min)}, ${esc(v.nomi.M)} e ${esc(v.nomi.G)}</div>
      <div class="clock" data-clock>${hm(v.min)}</div>
      <div class="date">${C.longDate(v.o)}${fest ? ` · <span class="fest">${esc(fest)}</span>` : ''}</div>
      ${sunArc(v)}
    </section>`;
  };
  T.brief = v => {
    // più il brief è lungo, più piccolo il carattere; nei riquadri stretti le etichette lasciano il posto al testo.
    // Le righe massime sono una rete di sicurezza: il testo non esce mai dal riquadro.
    const b = v.brief, compatto = v.mode !== 'mattina', L = String(b.testo || '').length;
    let misura = '', righe, chips = (b.chips || []).slice(0, 3);
    if (compatto) {
      if (L <= 110) { righe = 4; chips = chips.slice(0, 2); }
      else if (L <= 190) { misura = ' lungo'; righe = 6; chips = []; }
      else { misura = ' lungo lunghissimo'; righe = 7; chips = []; }
    } else if (L <= 120) righe = 4;
    else if (L <= 170) { misura = ' lungo'; righe = 5; }
    else if (L <= 230) { misura = ' lungo lunghissimo'; righe = 5; }
    else { misura = ' lungo lunghissimo estremo'; righe = 6; }
    return `<section class="tile brief${compatto ? ' compact' : ''}${misura}" style="grid-area:brief">
      <div class="eyebrow"><span>${esc(b.titolo)}</span><span class="meta">${I('spark')}${b.auto ? 'riassunto automatico' : 'scritto alle ' + b.alle}</span></div>
      <p class="text" style="--righe:${righe}">${esc(b.testo)}</p>
      ${chips.length ? `<div class="chips">${chips.map(chip).join('')}</div>` : ''}
    </section>`;
  };
  T.commute = v => {
    const solo = v.lavoro.chi && v.lavoro.chi !== 'MG' ? v.nomi[v.lavoro.chi] : '';
    const head = `<div class="eyebrow"><span>${solo ? `${esc(solo)} verso ${esc(v.lavoro.nome)}` : `Partenza per ${esc(v.lavoro.nome)}`}</span><span class="meta">arrivo alle ${esc(v.lavoro.arrivo)}</span></div>`;
    if (!v.lavoroOk) return `<section class="tile commute" style="grid-area:commute">${head}<p class="hint">Per vedere il traffico verso l’ufficio servono l’indirizzo di casa e la chiave TomTom.</p><button type="button" class="btn" data-act="impostazioni" data-sez="lavoro">${I('gear')}Apri le impostazioni</button></section>`;
    const t = v.tragitto;
    if (!t) return `<section class="tile commute" style="grid-area:commute">${head}<p class="hint">${v.trafficoErr ? 'Traffico: ' + esc(v.trafficoErr) + '.' : 'Calcolo il traffico…'}</p></section>`;
    const left = t.lb - v.min;
    let cls = 'ok', label = `Uscite entro le ${hm(t.lb)}`, rt = `tra ${Math.round(left)} min`;
    if (left <= 10 && left > 0) { cls = 'soon'; rt = `tra ${Math.ceil(left)} min`; }
    else if (left <= 0 && left > -3) { cls = 'now'; label = 'Uscite adesso'; rt = `entro le ${hm(t.lb)}`; }
    else if (left <= -3) { cls = 'now'; label = 'Siete in ritardo'; rt = `di ${Math.round(-left)} min`; }
    return `<section class="tile commute" style="grid-area:commute">${head}
      <div class="big">${t.min}<small>min in auto</small></div>
      <div class="sub">${I('car')}<span>${t.ritardo >= 2 ? `+${t.ritardo} min di traffico` : 'traffico scorrevole'}</span></div>
      <div class="state ${cls}" role="status"><span class="dot"></span><span>${label}</span><span class="rt">${rt}</span></div>
      <div class="sub">Se uscite ora arrivate alle ${hm(t.eta)}${t.brina ? ' · brina: +5 min' : ''}</div>
    </section>`;
  };
  function rainChart(v, W) {
    const series = [];
    for (let i = 0; i < 12; i++) {
      const h = Math.floor(v.min / 60) + i, d = h > 23 ? C.addDays(v.o, 1) : v.o, hh = h % 24, w = v.wxDay(d);
      if (!w) break;
      series.push({ h: hh, p: w.p[hh] ?? 0, t: w.t[hh] });
    }
    if (!series.length) return '';
    const slot = W / 12, bw = Math.min(14, slot * 0.56), base = 50, top = 18;
    const peak = series.reduce((a, s) => (s.p > a.p ? s : a), series[0]);
    const bars = series.map((s, i) => {
      const x = i * slot + (slot - bw) / 2, hgt = Math.max(2, (s.p / 100) * (base - top)), y = base - hgt, r = Math.min(4, hgt / 2);
      const path = `M${x.toFixed(1)},${base} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + bw - r).toFixed(1)} Q${(x + bw).toFixed(1)},${y.toFixed(1)} ${(x + bw).toFixed(1)},${(y + r).toFixed(1)} V${base} Z`;
      const lab = i % 3 === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${base + 16}" font-size="12.5" text-anchor="middle" fill="var(--ink-2)">${C.p2(s.h)}</text>` : '';
      return `<g class="rbar" data-tip="${C.p2(s.h)}:00 · pioggia ${s.p}% · ${s.t}°" data-x="${(x + bw / 2).toFixed(1)}" data-y="${y.toFixed(1)}"><rect x="${(i * slot).toFixed(1)}" y="${top - 4}" width="${slot.toFixed(1)}" height="${base - top + 22}" fill="transparent"/><path d="${path}" fill="${s.p >= 50 ? 'var(--rain-hi)' : 'var(--rain)'}"/></g>${lab}`;
    }).join('');
    const pi = series.indexOf(peak), px = pi * slot + slot / 2;
    const peakLab = peak.p >= 30 ? `<text x="${Math.min(W - 4, Math.max(4, px)).toFixed(1)}" y="${(base - (peak.p / 100) * (base - top) - 5).toFixed(1)}" font-size="12.5" font-weight="600" text-anchor="${px > W - 30 ? 'end' : 'middle'}" fill="var(--ink)">${peak.p}%</text>` : '';
    return `<div class="rain" data-chart><svg viewBox="0 0 ${W} 70" role="img" aria-label="Probabilità di pioggia nelle prossime ore; massimo ${peak.p}% alle ${C.p2(peak.h)}">
      <text x="0" y="10" font-size="12.5" fill="var(--ink-2)">Pioggia, prossime ${series.length} ore</text>
      <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--rule)" stroke-width="1"/>${bars}${peakLab}</svg></div>`;
  }
  const consigli = (v, max) => {
    const out = [], r = v.rainFrom(v.o, v.min), w = v.wxDay(v.o);
    out.push(r >= 0 ? { cls: 'warn', icon: 'umbrella', text: r <= Math.floor(v.min / 60) ? 'Ombrello: sì, piove' : `Ombrello: sì, dalle ${r}` } : { cls: 'ok', icon: 'umbrella', text: 'Ombrello: non serve' });
    if (w) {
      const secco = Math.max(...w.p.slice(10, 16)) < 20 && Math.max(...w.t.slice(10, 16)) >= 7;
      out.push(secco ? { cls: 'ok', icon: 'shirt', text: 'Bucato fuori: sì' } : { cls: '', icon: 'shirt', text: 'Bucato: meglio dentro' });
    }
    if (v.min >= 720 && v.brina(C.addDays(v.o, 1))) out.push({ cls: 'warn', icon: 'frost', text: 'Domattina brina' });
    return out.slice(0, max);
  };
  T.weather = v => {
    const head = `<div class="eyebrow"><span>Meteo a casa</span><span class="meta">MeteoSvizzera</span></div>`;
    if (!v.meteoOk) return `<section class="tile weather" style="grid-area:weather">${head}<p class="hint">${esc(v.E.meteoErr || 'Carico il meteo…')}</p></section>`;
    const d = v.wxDay(v.o), h = Math.min(23, Math.floor(v.min / 60)), night = v.min < v.sun.rise || v.min > v.sun.set;
    const mn = Math.min(...d.t.slice(6, 23)), mx = Math.max(...d.t.slice(6, 23));
    return `<section class="tile weather" style="grid-area:weather">${head}
      <div class="wx-top">${wi(d.c[h], night)}<div class="temp">${d.t[h]}°</div><div><div class="wx-desc">${C.wText(d.c[h])}</div><div class="wx-range">${mn}° / ${mx}°</div></div></div>
      <div class="advice">${consigli(v, v.mode === 'mattina' ? 1 : 2).map(a => `<div class="adv ${a.cls}">${I(a.icon)}<span>${a.text}</span></div>`).join('')}</div>
      ${rainChart(v, v.mode === 'giorno' ? 204 : 290)}
    </section>`;
  };
  const evRow = (v, e, dim) => {
    const past = dim && !e.allDay && e.e <= v.min;
    return `<div class="ev${past ? ' past' : ''}${e.festa ? ' holiday' : ''}"><time>${e.allDay ? 'tutto' : e.start}</time><span class="t">${esc(e.titolo)}</span>${C.anelli(v, e.chi)}</div>`;
  };
  T.cal = v => {
    const t = C.addDays(v.o, 1), today = v.eventsOn(v.o), tom = v.eventsOn(t);
    let head = 'Oggi', list = today;
    if (v.mode === 'sera') { head = 'Stasera'; list = today.filter(e => !e.allDay && e.e > v.min); }
    const libere = v.serateLibere(v.mode === 'sera' || v.min > 1140 ? t : v.o, 7).map(d => C.WDS[C.weekday(d)]).slice(0, 4);
    const tomMax = v.mode === 'mattina' ? 1 : 2;
    const dopo = v.mode === 'sera' ? `<div class="dayhead">Nei prossimi giorni</div><div class="evlist">${[2, 3, 4, 5, 6].flatMap(i => v.eventsOn(C.addDays(v.o, i)).map(e => ({ e, d: C.addDays(v.o, i) }))).slice(0, 2).map(({ e, d }) => `<div class="ev${e.festa ? ' holiday' : ''}"><time>${C.WDS[C.weekday(d)]}</time><span class="t">${esc(e.titolo)}</span>${C.anelli(v, e.chi)}</div>`).join('')}</div>` : '';
    return `<section class="tile cal" style="grid-area:cal">
      <div class="eyebrow"><span>${head}</span><span class="meta">FamilyWall</span></div>
      <div class="evlist">${list.length ? list.slice(0, 4).map(e => evRow(v, e, true)).join('') : `<div class="empty">${{ nolink: 'Calendario da collegare', mai: 'Calendario in arrivo', errore: 'Calendario da controllare' }[v.auto.calendario.stato] || (v.mode === 'sera' ? 'Serata libera' : 'Niente in programma')}</div>`}</div>
      <div class="dayhead">Domani, ${C.WD[C.weekday(t)]}</div>
      <div class="evlist">${tom.length ? tom.slice(0, tomMax).map(e => evRow(v, e, false)).join('') : '<div class="empty">Niente in programma</div>'}</div>
      ${dopo}
      <div class="free">${I('heart')}<span>Serate libere insieme: <b>${libere.join(', ') || 'nessuna'}</b></span></div>
    </section>`;
  };
  const shopItems = (v, ui, list, max) => list.slice(0, max).map(i => `<button type="button" class="item${i.preso_il ? ' done' : ''}${ui.fresh === i.id ? ' fresh' : ''}" data-act="voce" data-id="${esc(i.id)}" aria-pressed="${i.preso_il ? 'true' : 'false'}">
      <span class="box">${i.preso_il ? I('check') : ''}</span><span class="name">${esc(i.nome)}</span><span class="src"><span class="dotc" style="--c:${C.colore(i.chi)}"></span><span class="via">${esc(i.via || '')}</span></span></button>`).join('');
  const addRow = (ui, id) => (ui.addOpen ? `<form class="addrow" data-form="voce"><label class="sr" for="${id}">Nuova voce della spesa</label><input id="${id}" name="voce" placeholder="Cosa manca?" autocomplete="off" enterkeyhint="done" maxlength="120"><button class="btn primary" type="submit">${I('plus')}Aggiungi</button></form>` : '');
  T.shop = (v, ui) => {
    const open = v.aperte, all = [...open, ...v.prese];
    const addBtn = `<button type="button" class="iconbtn" data-act="aggiungi" aria-label="${ui.addOpen ? 'Chiudi' : 'Aggiungi alla spesa'}">${I(ui.addOpen ? 'x' : 'plus')}</button>`;
    const giornoIt = v.itDay >= 0 ? C.WD[v.itDay] : '';
    const head = `<div class="eyebrow"><span>Spesa · ${open.length} ${open.length === 1 ? 'cosa' : 'cose'}</span><span class="meta">${v.itOggi ? 'oggi in Italia' : giornoIt ? 'Italia ' + giornoIt : ''} ${addBtn}</span></div>`;
    if (v.mode === 'mattina') {
      const pills = open.slice(0, 5).map(i => `<button type="button" class="pill${ui.fresh === i.id ? ' fresh' : ''}" data-act="voce" data-id="${esc(i.id)}"><span class="dotc" style="--c:${C.colore(i.chi)}"></span>${esc(i.nome)}</button>`).join('');
      return `<section class="tile shop" style="grid-area:shop">${head}${ui.addOpen ? addRow(ui, 't-voce') : `<div class="pills">${pills}${open.length > 5 ? `<span class="more">e altre ${open.length - 5}</span>` : ''}${!open.length ? '<span class="empty">Tutto preso</span>' : ''}</div>`}</section>`;
    }
    if (v.mode === 'giorno') {
      return `<section class="tile shop" style="grid-area:shop">${head}${addRow(ui, 't-voce')}
        <div class="list cols">${shopItems(v, ui, all, 12)}</div>
        ${!open.length ? '<p class="hint">Lista vuota: aggiungete dal telefono, con Siri o col +.</p>' : ''}
        ${v.itOggi || v.itDomani ? franchigia(v) : (giornoIt ? `<div class="hint" style="margin-top:auto">Prossima spesa in Italia: ${giornoIt}. Qui comparirà la franchigia.</div>` : '')}
      </section>`;
    }
    return `<section class="tile shop" style="grid-area:shop">${head}${addRow(ui, 't-voce')}
      <div class="list">${shopItems(v, ui, ui.addOpen ? open.slice(0, 3) : open, 4)}</div>
      ${open.length > 4 ? `<div class="more">e altre ${open.length - 4}</div>` : ''}${!open.length ? '<p class="hint">Tutto preso.</p>' : ''}
    </section>`;
  };
  const scoreRows = v => {
    const max = Math.max(v.totali.M, v.totali.G, 1);
    return ['M', 'G'].map(w => `<div class="srow"><span>${esc(v.nomi[w])}</span><div class="track"><div class="fill" style="--c:${C.colore(w)};width:${Math.min(100, v.punti[w] / max * 100).toFixed(1)}%"></div></div><span class="v">${v.punti[w]} pt</span></div>`).join('');
  };
  T.chores = v => {
    const next = v.stasera;
    const sett = v.settimanaN ? `settimana ${v.settimanaN} · cambio lunedì` : 'cambio lunedì';
    const nowBox = next ? `<div class="chore-now">${C.anelli(v, next.assegnata)}<div class="what">${esc(next.nome)}<span>${v.mode === 'giorno' ? 'prossima' : 'stasera'} · ${esc(v.nomi[next.assegnata])} · ${next.punti} pt</span></div><button type="button" class="btn sm primary" data-act="fatto" data-id="${esc(next.id)}" data-chi="${next.assegnata}">${I('check')}Fatto</button></div>` : '<div class="chore-now"><div class="what">Settimana chiusa<span>tutte le faccende sono fatte</span></div></div>';
    const altre = v.faccendeAperte.filter(x => x !== next).length;
    if (v.mode === 'mattina') return `<section class="tile chores" style="grid-area:chores"><div class="eyebrow"><span>Faccende</span><span class="meta">${sett}</span></div>${nowBox}<div class="score">${scoreRows(v)}</div></section>`;
    if (v.mode === 'giorno') return `<section class="tile chores" style="grid-area:chores"><div class="eyebrow"><span>Faccende</span><span class="meta">${altre ? `altre ${altre} entro domenica` : 'il resto è fatto'}</span></div>${nowBox}<div class="score">${scoreRows(v)}</div></section>`;
    const rows = v.faccende.filter(x => x !== next).sort((a, b) => a.completa - b.completa).slice(0, 2).map(x => `<div class="chore${x.completa ? ' done' : ''}">${C.anelli(v, x.assegnata)}<span class="n">${esc(x.nome)}${x.volte_settimana > 1 ? ` <span class="pts">${x.fatte}/${x.volte_settimana}</span>` : ''}</span><span class="pts">${x.punti} pt</span>${x.completa ? `<span class="pts">${I('check')}</span>` : `<button type="button" class="btn sm" data-act="fatto" data-id="${esc(x.id)}" data-chi="${x.assegnata}" aria-label="Segna ${esc(x.nome)} come fatta">Fatto</button>`}</div>`).join('');
    return `<section class="tile chores" style="grid-area:chores"><div class="eyebrow"><span>Faccende</span><span class="meta">${sett}</span></div>${nowBox}<div class="chores">${rows}</div><div class="score">${scoreRows(v)}</div></section>`;
  };
  T.notes = v => {
    const n = v.nota, head = `<div class="eyebrow"><span>Bigliettini</span><span class="meta">${I('heart')}dal telefono</span></div>`;
    if (!n) return `<section class="tile notes" style="grid-area:notes">${head}<p class="hint">Nessun bigliettino nuovo. Scrivetelo dal telefono o dite «Ehi Siri, bigliettino per casa».</p></section>`;
    const quando = C.zParts(new Date(n.creato_il)), oggi = quando.key === v.z.key;
    const lunga = String(n.testo || '').length > 70, righe = v.mode === 'mattina' ? 3 : 4;
    return `<section class="tile notes" style="grid-area:notes">${head}<p class="note${lunga ? ' lunga' : ''}" style="--righe:${righe}" title="${esc(n.testo)}">«${esc(n.testo)}»</p>
      <div class="note-by">${C.anelli(v, n.chi === 'T' ? '' : n.chi)}<span>${esc(n.chi === 'T' ? 'Dal tablet' : v.nomi[n.chi])}, ${oggi ? '' : 'ieri '}${hm(quando.min)}</span><button type="button" class="btn sm" data-act="letto" data-id="${esc(n.id)}">Letto</button></div></section>`;
  };
  const saldoFrase = v => {
    const s = v.saldo;
    if (Math.abs(s) < 0.005) return { chi: '', txt: 'Siete in pari' };
    return s > 0 ? { chi: 'G', txt: `${esc(v.nomi.G)} deve <b>${nf(s, 2)}</b> a ${esc(v.nomi.M)}` } : { chi: 'M', txt: `${esc(v.nomi.M)} deve <b>${nf(-s, 2)}</b> a ${esc(v.nomi.G)}` };
  };
  T.exp = v => {
    const sf = saldoFrase(v), last = v.spese.filter(s => s.tipo !== 'saldo').slice(0, v.mode === 'giorno' ? 1 : 2);
    return `<section class="tile exp" style="grid-area:exp">
      <div class="eyebrow"><span>Spese di casa</span><span class="meta">${C.MON[v.o.m - 1]}</span></div>
      <div class="money">${nf(v.totMese, 2)}<small>CHF nel mese</small></div>
      <div class="bal">${C.anelli(v, sf.chi)}<span>${sf.txt}</span></div>
      <div class="last">${last.map(x => `<div><span class="dotc" style="--c:${C.colore(x.pagato_da)}"></span><span>${esc(x.descrizione)}</span><span class="a">${nf(x.importo, 2)}</span></div>`).join('') || '<div>Nessuna spesa registrata</div>'}</div>
    </section>`;
  };
  T.count = v => `<section class="tile count" style="grid-area:count">
      <div class="eyebrow"><span>Ricorrenze e countdown</span><span class="meta">${I('heart')}</span></div>
      <div class="counts">${v.countdown.slice(0, 3).map(x => `<div class="cnt"><div class="n">${x.n}<small>${x.u}</small></div><div class="l">${esc(x.l)}</div></div>`).join('') || '<p class="hint">Aggiungete anniversari e viaggi nelle impostazioni.</p>'}</div>
    </section>`;
  T.tomorrow = v => {
    const t = C.addDays(v.o, 1), w = v.wxDay(t), lavora = C.feriale(t) && v.lavoro.chi;
    const first = v.eventsOn(t).find(e => !e.allDay);
    return `<section class="tile tomorrow" style="grid-area:tomorrow">
      <div class="eyebrow"><span>Domattina</span><span class="meta">${C.shortDate(t)}</span></div>
      ${w ? `<div class="tm-top">${wi(w.c[12], false)}<div><div class="r">${Math.min(...w.t.slice(5, 9))}° → ${Math.max(...w.t.slice(8, 20))}°</div><div class="d">${C.wText(w.c[12])}, alba alle ${hm(C.sun(t, Number(v.cfg.casa && v.cfg.casa.lat) || 46.0037, Number(v.cfg.casa && v.cfg.casa.lon) || 8.9511).rise)}</div></div></div>` : '<p class="hint">Meteo di domani non ancora disponibile.</p>'}
      ${lavora ? (v.domani && C.key(v.domani.giorno) === C.key(t) ? `<div class="state ok"><span class="dot"></span><span>Uscite entro le ${hm(v.domani.lb)}</span></div>` : `<div class="state ok"><span class="dot"></span><span>${v.lavoroOk ? 'Calcolo l’orario di uscita…' : 'Orario di uscita: da collegare'}</span></div>`) : `<div class="state ok"><span class="dot"></span><span>${C.festivo(t) ? esc(C.festivo(t)) + ': niente lavoro' : 'Domani non si lavora'}</span></div>`}
      <div class="sub">${lavora && v.domani && v.domani.brina ? `${I('frost')}<span>Brina: contati 5 minuti in più</span>` : first ? `${I('cal')}<span>${esc(first.titolo)} alle ${first.start}</span>` : 'Nessun impegno in calendario'}</div>
    </section>`;
  };
  const variazione = x => (x != null && isFinite(x) ? ` <span class="${x >= 0 ? 'up' : 'down'}">${x >= 0 ? '+' : '−'}${nf(Math.abs(x), 1)}%</span>` : '');
  T.strip = v => {
    const m = v.mercati, items = [];
    if (m && m.eur_chf) {
      // come lo leggete voi: 1 franco in euro (predefinito) oppure 1 euro in franchi (Impostazioni › Spesa e conti)
      if (((v.cfg.mercati || {}).cambio || 'chf') === 'eur') items.push(`<span class="it">1 € = <b>${nf(m.eur_chf, 3)}</b> CHF${variazione(m.eur_chf_var)}</span>`);
      else items.push(`<span class="it">1 CHF = <b>${nf(1 / m.eur_chf, 3)}</b> €${variazione(m.eur_chf_var != null ? (1 / (1 + m.eur_chf_var / 100) - 1) * 100 : null)}</span>`);
    }
    if (m && m.interroll && m.interroll.prezzo) items.push(`<span class="it">Interroll <b>${nf(m.interroll.prezzo, 0)}</b> CHF${variazione(m.interroll.var)}</span>`);
    if (!v.esempio && !items.length) items.push(`<span class="it">Cambio e Interroll: in arrivo</span>`);
    if (v.mode === 'mattina') { const sf = saldoFrase(v); items.push(`<span class="it">${I('wallet')}${sf.txt}</span>`); }
    const casaN = v.countdown.find(x => x.u === '°');
    if (v.mode !== 'sera' && casaN) items.push(`<span class="it">Casa nuova: <b>giorno ${casaN.n}</b></span>`);
    const prossima = v.countdown.find(x => x.u !== '°');
    if (v.mode === 'giorno' && prossima) items.push(`<span class="it">${esc(prossima.l)}${prossima.n ? ` tra <b>${prossima.n}</b> giorni` : ''}</span>`);
    const stato = v.esempio ? '<span class="demo-tag">dati di esempio</span>' : (v.A.stato === 'pronto' ? '' : '<span class="demo-tag">offline</span>');
    return `<footer class="strip">${items.join('<span class="sep"></span>')}<span class="end">${stato}<button type="button" class="iconbtn" data-act="impostazioni" aria-label="Impostazioni">${I('gear')}</button></span></footer>`;
  };
  T.night = v => {
    const t = v.min >= 720 ? C.addDays(v.o, 1) : v.o, w = v.wxDay(t), bits = [];
    if (w) bits.push(`${wi(w.c[12], false)}<span>${v.min >= 720 ? 'Domani' : 'Oggi'} ${Math.min(...w.t.slice(5, 9))}° → ${Math.max(...w.t.slice(8, 20))}°</span>`);
    if (C.feriale(t) && v.lavoro.chi && v.domani && C.key(v.domani.giorno) === C.key(t)) bits.push(`<span>uscite entro le ${hm(v.domani.lb)}${v.domani.brina ? ' (brina)' : ''}</span>`);
    const first = v.eventsOn(t).find(e => !e.allDay);
    if (first) bits.push(`<span>${first.start} ${esc(first.titolo)}</span>`);
    return `<div class="night" data-act="sveglia" role="button" tabindex="0" aria-label="Tocca per accendere la dashboard">
      <div class="clock" data-clock>${hm(v.min)}</div>
      <div class="line">${bits.join('<span class="sep"></span>')}</div>
      <div class="foot">Schermo a riposo fino alle ${esc(v.notteAlle)} · toccatelo per accenderlo</div>
    </div>`;
  };
  const LAYOUT = {
    mattina: ['hero', 'brief', 'commute', 'weather', 'cal', 'shop', 'chores', 'notes', 'strip'],
    giorno: ['hero', 'brief', 'notes', 'shop', 'cal', 'weather', 'chores', 'exp', 'strip'],
    sera: ['hero', 'brief', 'notes', 'cal', 'chores', 'shop', 'tomorrow', 'exp', 'count', 'strip']
  };
  C.tablet = (v, ui) => (v.mode === 'notte' ? T.night(v) : LAYOUT[v.mode].map(k => T[k](v, ui)).join(''));

  /* =====================================================================
     Telefono: quattro schede
     ===================================================================== */
  const P = {};
  const err = (ui, k) => `<div class="p-err" data-err="${k}" role="alert">${esc((ui.err && ui.err[k]) || '')}</div>`;
  const ok = (ui, k) => (ui.ok && ui.ok[k] ? `<div class="p-ok">${esc(ui.ok[k])}</div>` : '');
  const io = v => (v.me && (v.me.persona === 'M' || v.me.persona === 'G') ? v.me.persona : null);
  P.spesa = (v, ui) => {
    return `<form class="p-card" data-form="voce" novalidate>
        <label for="p-voce">Aggiungi alla spesa</label>
        <div class="p-row"><input id="p-voce" name="voce" placeholder="latte, pane…" autocomplete="off" enterkeyhint="send" maxlength="120"><button class="btn primary" type="submit" aria-label="Aggiungi">${I('plus')}</button></div>
        ${err(ui, 'voce')}
        <p class="p-hint">Potete scriverne più d’una separate da virgola. La carne con il peso («pollo 800 g») entra nel conto della franchigia.</p>
      </form>
      ${(v.itOggi || v.itDomani) ? `<div class="p-card">${franchigia(v)}</div>` : ''}
      <div class="p-card"><div class="p-label">Da prendere · ${v.aperte.length}</div>
        <div class="list">${v.aperte.length ? shopItems(v, ui, v.aperte, 200) : '<p class="p-hint">Tutto preso.</p>'}</div></div>
      ${v.prese.length ? `<div class="p-card"><div class="p-label">Presi da poco (toccate per rimettere)</div><div class="list">${shopItems(v, ui, v.prese, 30)}</div></div>` : ''}`;
  };
  P.conti = (v, ui) => {
    const sf = saldoFrase(v), me = io(v) || 'M', sel = ui.pagato || me, div = ui.divisione || 'meta';
    const conferma = ui.confermaSaldo;
    return `<div class="p-card saldo">
        <div class="p-label">Saldo tra voi</div>
        <div class="p-big">${C.anelli(v, sf.chi)}<span>${sf.txt}</span></div>
        <div class="p-hint">Nel mese: ${nf(v.totMese, 2)} CHF di spese comuni.</div>
        ${Math.abs(v.saldo) >= 0.005 ? (conferma ? `<div class="p-row"><button type="button" class="btn primary" data-act="salda-ok">${I('check')}Confermo: saldati ${nf(Math.abs(v.saldo), 2)}</button><button type="button" class="btn" data-act="salda-no">Annulla</button></div>` : `<button type="button" class="btn" data-act="salda">Segna come saldato</button>`) : ''}
        ${ok(ui, 'saldo')}
      </div>
      <form class="p-card" data-form="spesa" novalidate>
        <label for="p-desc">Nuova spesa di casa</label>
        <input id="p-desc" name="descrizione" placeholder="Coop, affitto, bolletta…" maxlength="80" autocomplete="off">
        <div class="p-row"><input id="p-imp" name="importo" inputmode="decimal" placeholder="Importo in CHF" autocomplete="off"><select name="categoria" aria-label="Categoria">${['Spesa', 'Casa', 'Affitto', 'Bollette', 'Svago', 'Altro'].map(x => `<option>${x}</option>`).join('')}</select></div>
        <div class="p-seg" role="group" aria-label="Chi ha pagato">${['M', 'G'].map(w => `<button type="button" data-act="pagato" data-w="${w}" aria-pressed="${sel === w}">Ha pagato ${esc(v.nomi[w])}</button>`).join('')}</div>
        <div class="p-seg" role="group" aria-label="Come si divide">${[['meta', 'A metà'], ['quota', `${v.quotaM}% ${esc(v.nomi.M)}`], ['tutta', 'Solo di chi paga']].filter((x, i) => i !== 1 || v.quotaM !== 50).map(([k, l]) => `<button type="button" data-act="divisione" data-k="${k}" aria-pressed="${div === k}">${l}</button>`).join('')}</div>
        ${err(ui, 'spesa')}
        <button class="btn primary" type="submit">${I('plus')}Aggiungi spesa</button>
        ${ok(ui, 'spesa')}
      </form>
      <div class="p-card"><div class="p-label">Ultime spese</div>
        <ul class="p-list">${v.spese.slice(0, 25).map(s => `<li><span class="dotc" style="--c:${C.colore(s.pagato_da)}"></span><span class="grow">${esc(s.tipo === 'saldo' ? 'Saldo' : s.descrizione)}<small>${C.shortDate(C.parseKey(s.data))}${s.tipo === 'saldo' ? '' : ` · ${esc(s.categoria || '')}${Number(s.quota_m) !== 50 ? ` · ${nf(s.quota_m, 0)}% ${esc(v.nomi.M)}` : ''}`}</small></span><span class="amt">${nf(s.importo, 2)}</span>${ui.cancella === s.id ? `<button type="button" class="btn sm danger" data-act="spesa-via-ok" data-id="${esc(s.id)}">Elimina</button>` : `<button type="button" class="iconbtn sm" data-act="spesa-via" data-id="${esc(s.id)}" aria-label="Elimina ${esc(s.descrizione)}">${I('trash')}</button>`}</li>`).join('') || '<li>Ancora nessuna spesa.</li>'}</ul>
      </div>`;
  };
  P.faccende = (v, ui) => {
    const me = io(v);
    return `<div class="p-card">
        <div class="p-label">${v.settimanaN ? `Settimana ${v.settimanaN} nella casa nuova` : 'Questa settimana'} · cambio lunedì</div>
        <div class="score">${scoreRows(v)}</div>
      </div>
      <div class="p-card"><ul class="p-list">${v.faccende.map(f => {
        const mia = me && f.log.find(x => x.chi === me);
        return `<li>${C.anelli(v, f.assegnata)}<span class="grow${f.completa ? ' done' : ''}">${esc(f.nome)}<small>${f.punti} ${f.punti === 1 ? 'punto' : 'punti'}${f.volte_settimana > 1 ? ` · ${f.fatte} di ${f.volte_settimana}` : ''}${f.completa ? ' · fatta' : ''}</small></span>
          ${mia ? `<button type="button" class="iconbtn sm" data-act="annulla" data-id="${esc(mia.id)}" aria-label="Annulla">${I('undo')}</button>` : ''}
          ${f.completa ? '' : `<button type="button" class="btn sm primary" data-act="fatto" data-id="${esc(f.id)}" data-chi="${me || f.assegnata}">Fatto</button>`}</li>`;
      }).join('') || '<li>Nessuna faccenda: aggiungetele nelle impostazioni.</li>'}</ul></div>`;
  };
  /* cosa dire quando il calendario è vuoto: vuoto davvero, o non ancora arrivato da FamilyWall? */
  const calVuoto = (v, n) => {
    const s = v.auto.calendario.stato;
    if (s === 'nolink') return `<p class="p-hint">FamilyWall non è ancora collegato.</p><button type="button" class="linkbtn" data-act="impostazioni" data-sez="calendario">Collegalo nelle impostazioni</button>`;
    if (s === 'mai' || s === 'errore' || s === 'fermo') return `<p class="p-hint">${s === 'mai' ? 'Il calendario di FamilyWall non è ancora arrivato.' : s === 'errore' ? 'Il calendario di FamilyWall non si riesce a leggere.' : 'Il calendario di FamilyWall non si aggiorna da un po’.'}</p><button type="button" class="linkbtn" data-act="impostazioni" data-sez="automazioni">Vedi cosa succede</button>`;
    return n ? '' : '<p class="p-hint">Niente in calendario nei prossimi sette giorni.</p>';
  };
  P.casa = (v, ui) => {
    const b = v.brief, other = io(v) === 'G' ? 'M' : 'G';
    const giorni = [0, 1, 2, 3, 4, 5, 6].map(i => ({ d: C.addDays(v.o, i), ev: v.eventsOn(C.addDays(v.o, i)) })).filter(x => x.ev.length);
    return `<div class="p-card brief"><div class="p-label">${esc(b.titolo)}${b.auto ? '' : ` · ${b.alle}`}</div><p class="p-brief">${esc(b.testo)}</p></div>
      <form class="p-card" data-form="nota" novalidate>
        <label for="p-nota">Bigliettino sullo schermo</label>
        <textarea id="p-nota" name="nota" rows="2" maxlength="280" placeholder="Scrivi qualcosa a ${esc(v.nomi[other])}…"></textarea>
        ${err(ui, 'nota')}
        <button class="btn primary" type="submit">Invia allo schermo</button>
        ${ok(ui, 'nota')}
      </form>
      <div class="p-card"><div class="p-label">Prossimi giorni</div>
        ${giorni.length ? giorni.map(g => `<div class="p-day"><div class="dayhead">${C.shortDate(g.d)}</div>${g.ev.map(e => `<div class="ev${e.festa ? ' holiday' : ''}"><time>${e.allDay ? 'tutto' : e.start}</time><span class="t">${esc(e.titolo)}</span>${C.anelli(v, e.chi)}</div>`).join('')}</div>`).join('') : ''}
        ${calVuoto(v, giorni.length)}
      </div>
      ${v.countdown.length ? `<div class="p-card"><div class="p-label">Countdown</div><ul class="p-list">${v.countdown.slice(0, 6).map(x => `<li><span class="grow">${esc(x.l)}</span><span class="amt">${x.n}${x.u === '°' ? '°' : x.u ? ' gg' : ''}</span></li>`).join('')}</ul></div>` : ''}
      <div class="p-card siri">${I('mic')}<div><b>Con Siri</b><br>«Ehi Siri, spesa di casa» e poi dite cosa manca. Il comando rapido si prepara in Impostazioni › Siri e telefono.</div></div>`;
  };
  const TABS = [['spesa', 'Spesa', 'cart'], ['conti', 'Conti', 'wallet'], ['faccende', 'Faccende', 'broom'], ['casa', 'Casa', 'home']];
  C.telefono = (v, ui) => {
    const tab = ui.tab || 'spesa', io_ = io(v);
    const titoli = { spesa: 'Spesa', conti: 'Conti di casa', faccende: 'Faccende', casa: 'Casa' };
    return `<header class="p-head"><div><div class="p-app">${titoli[tab]}</div><div class="p-sub">${io_ ? 'Ciao ' + esc(v.nomi[io_]) : v.esempio ? 'Dati di esempio' : 'Tablet'} · ${C.shortDate(v.o)}</div></div>
        <button type="button" class="iconbtn" data-act="impostazioni" aria-label="Impostazioni">${I('gear')}</button></header>
      <main class="p-main">${P[tab](v, ui)}</main>
      <nav class="p-tabs" aria-label="Sezioni">${TABS.map(([k, l, ic]) => `<button type="button" data-act="scheda" data-k="${k}" aria-current="${tab === k ? 'page' : 'false'}">${I(ic)}<span>${l}</span>${k === 'spesa' && v.aperte.length ? `<em>${v.aperte.length}</em>` : ''}</button>`).join('')}</nav>`;
  };

  /* =====================================================================
     Impostazioni (le domande le fa l'app, non il codice)
     ===================================================================== */
  const campo = (id, label, input, nota) => `<div class="field"><label for="${id}">${label}</label>${input}${nota ? `<small>${nota}</small>` : ''}</div>`;
  const val = (v, p) => { const x = C.deepGet(v.cfg, p); return x == null ? '' : x; };
  const txt = (v, id, p, ph = '', tipo = 'text') => `<input id="${id}" type="${tipo}" data-dati="${p}" value="${esc(val(v, p))}" placeholder="${esc(ph)}" autocomplete="off">`;
  const sel = (v, id, p, opts, num) => `<select id="${id}" data-dati="${p}"${num ? ' data-num="1"' : ''}>${opts.map(([k, l]) => `<option value="${esc(k)}"${String(val(v, p)) === String(k) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  C.impostazioni = (v, ui, conf) => {
    const c = v.coll, s = ui.sez || '';
    const giorni = [[6, 'sabato'], [0, 'domenica'], [5, 'venerdì'], [-1, 'nessun giorno fisso']];
    const mancano = [];
    if (!v.esempio) {
      if (!v.cfg.casa || !v.cfg.casa.indirizzo) mancano.push(['casa', 'indirizzo di casa']);
      if (!c.tomtom_key) mancano.push(['traffico', 'chiave TomTom per il traffico']);
      if (!c.ical_url) mancano.push(['calendario', 'link del calendario FamilyWall']);
      if (!c.siri_token) mancano.push(['siri', 'codice per Siri']);
      if (v.auto.avviso) mancano.push(['automazioni', v.auto.avviso]);
    }
    const siriUrl = conf && conf.url ? `${conf.url}/rest/v1/rpc/casa_siri` : 'https://<progetto>.supabase.co/rest/v1/rpc/casa_siri';
    const chiave = conf && conf.key ? conf.key : '<chiave pubblica>';
    const legacy = /^eyJ/.test(chiave);
    const copia = (t, lab) => `<div class="copyrow"><code>${esc(t)}</code><button type="button" class="iconbtn sm" data-act="copia" data-testo="${esc(t)}" aria-label="Copia ${esc(lab)}">${I('copy')}</button></div>`;
    const faccende = (v.A.data.faccende || []).filter(f => f.attiva !== false);
    return `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="set-h">
      <div class="panel-head"><h2 id="set-h">Impostazioni</h2><button type="button" class="iconbtn" data-act="chiudi" aria-label="Chiudi">${I('x')}</button></div>
      <p class="intro">Qui la dashboard vi chiede quello che deve sapere. Le modifiche si salvano da sole e arrivano su tutti i vostri dispositivi.</p>
      ${mancano.length ? `<div class="todo"><b>Da completare</b>${mancano.map(([k, l]) => `<button type="button" class="linkbtn" data-act="vai" data-sez="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
      ${ui.okSet ? `<div class="p-ok">${esc(ui.okSet)}</div>` : ''}

      <h3 id="sez-voi">Voi due</h3>
      ${campo('s-nm', 'Nome (blu)', txt(v, 's-nm', 'nomi.M', 'Matteo'))}
      ${campo('s-ng', 'Nome (ocra)', txt(v, 's-ng', 'nomi.G', 'Gaia'))}

      <h3 id="sez-casa">Casa</h3>
      ${campo('s-ci', 'Indirizzo di casa', `<span class="two"><input id="s-ci" data-geo="casa" value="${esc(val(v, 'casa.indirizzo'))}" placeholder="Via…, 6900 Lugano" autocomplete="street-address"><button type="button" class="btn sm" data-act="trova" data-dove="casa">Trova</button></span>`, ui.geo && ui.geo.casa ? esc(ui.geo.casa) : (v.cfg.casa && v.cfg.casa.indirizzo ? `Posizione: ${nf(v.cfg.casa.lat, 4)}, ${nf(v.cfg.casa.lon, 4)}` : 'Serve per meteo e traffico.'))}
      ${campo('s-tr', 'Giorno del trasloco', txt(v, 's-tr', 'trasloco', '', 'date'))}

      <h3 id="sez-lavoro">Lavoro</h3>
      ${campo('s-ln', 'Posto di lavoro', txt(v, 's-ln', 'lavoro.nome', 'Interroll'))}
      ${campo('s-li', 'Indirizzo', `<span class="two"><input id="s-li" data-geo="lavoro" value="${esc(val(v, 'lavoro.indirizzo'))}" placeholder="Via Gorelle 3, 6592 Sant’Antonino"><button type="button" class="btn sm" data-act="trova" data-dove="lavoro">Trova</button></span>`, ui.geo && ui.geo.lavoro ? esc(ui.geo.lavoro) : (v.cfg.lavoro && v.cfg.lavoro.lat ? `Posizione: ${nf(v.cfg.lavoro.lat, 4)}, ${nf(v.cfg.lavoro.lon, 4)}` : 'Premete Trova dopo aver messo la chiave TomTom.'))}
      ${campo('s-la', 'Arrivo in ufficio', txt(v, 's-la', 'lavoro.arrivo', '08:30', 'time'))}
      ${campo('s-lm', 'Margine di sicurezza', sel(v, 's-lm', 'lavoro.margine', [[0, '0 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']], true))}
      ${campo('s-lc', 'Chi va al lavoro in auto', sel(v, 's-lc', 'lavoro.chi', [['MG', 'entrambi'], ['M', v.nomi.M], ['G', v.nomi.G], ['', 'nessuno']]))}

      <h3 id="sez-schermo">Schermo</h3>
      ${campo('s-nd', 'A riposo dalle', txt(v, 's-nd', 'schermo.notte_dalle', '23:00', 'time'))}
      ${campo('s-na', 'Si riaccende alle', txt(v, 's-na', 'schermo.notte_alle', '06:15', 'time'))}
      ${campo('s-te', 'Colori', sel(v, 's-te', 'schermo.tema', [['auto', 'chiari di giorno, scuri col buio'], ['chiaro', 'sempre chiari'], ['scuro', 'sempre scuri']]))}

      <h3 id="sez-spesa">Spesa e conti</h3>
      ${campo('s-gi', 'Spesa in Italia', sel(v, 's-gi', 'spesa.giorno_italia', giorni, true))}
      ${campo('s-pe', 'Persone per la franchigia', sel(v, 's-pe', 'spesa.persone', [[1, '1'], [2, '2']], true))}
      ${campo('s-cb', 'Cambio sullo schermo', sel(v, 's-cb', 'mercati.cambio', [['chf', '1 franco in euro'], ['eur', '1 euro in franchi']]), 'Nella riga in basso del tablet, accanto a Interroll.')}
      ${campo('s-qm', `Quota predefinita di ${esc(v.nomi.M)} (%)`, `<input id="s-qm" type="number" min="0" max="100" step="5" data-dati="conti.quota_m" data-num="1" value="${esc(val(v, 'conti.quota_m') === '' ? 50 : val(v, 'conti.quota_m'))}">`, '50 = metà a testa. Usata anche da Siri.')}

      <h3 id="sez-faccende">Faccende</h3>
      ${campo('s-ro', 'Rotazione', sel(v, 's-ro', 'faccende.rotazione', [['alterna', 'si scambiano ogni lunedì'], ['fissa', 'sempre alla stessa persona']]))}
      <ul class="p-list edit">${faccende.map(f => `<li><span class="grow">${esc(f.nome)}<small>${f.punti} ${f.punti === 1 ? 'punto' : 'punti'} · ${f.volte_settimana}× a settimana · parte da ${esc(v.nomi[f.persona_base])}</small></span><button type="button" class="iconbtn sm" data-act="togli-faccenda" data-id="${esc(f.id)}" aria-label="Togli ${esc(f.nome)}">${I('trash')}</button></li>`).join('')}</ul>
      <form class="addgrid" data-form="faccenda" novalidate>
        <input name="nome" placeholder="Nuova faccenda" maxlength="60" aria-label="Nome della faccenda">
        <select name="punti" aria-label="Punti">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === 2 ? ' selected' : ''}>${n} pt</option>`).join('')}</select>
        <select name="volte" aria-label="Volte a settimana">${[1, 2, 3, 7].map(n => `<option value="${n}">${n}× sett.</option>`).join('')}</select>
        <select name="base" aria-label="Parte da">${['M', 'G'].map(w => `<option value="${w}">${esc(v.nomi[w])}</option>`).join('')}</select>
        <button class="btn sm primary" type="submit">Aggiungi</button>
      </form>
      ${err(ui, 'faccenda')}

      <h3 id="sez-ricorrenze">Ricorrenze e countdown</h3>
      <ul class="p-list edit">${(v.A.data.ricorrenze || []).map(r => `<li><span class="grow">${esc(r.titolo)}<small>${C.shortDate(C.parseKey(r.data))} ${C.parseKey(r.data).y}${r.annuale ? ' · ogni anno' : ''}</small></span><button type="button" class="iconbtn sm" data-act="togli-ricorrenza" data-id="${esc(r.id)}" aria-label="Togli ${esc(r.titolo)}">${I('trash')}</button></li>`).join('')}</ul>
      <form class="addgrid" data-form="ricorrenza" novalidate>
        <input name="titolo" placeholder="Anniversario, viaggio…" maxlength="60" aria-label="Titolo">
        <input name="data" type="date" aria-label="Data">
        <label class="chk"><input type="checkbox" name="annuale"> ogni anno</label>
        <button class="btn sm primary" type="submit">Aggiungi</button>
      </form>
      ${err(ui, 'ricorrenza')}

      <h3 id="sez-calendario">Calendario FamilyWall</h3>
      <p class="intro">In FamilyWall: Calendario › ingranaggio › il calendario del vostro cerchio › Genera URL iCal. Copiate il link qui. La GitHub Action lo legge ogni 15 minuti.</p>
      ${campo('s-ical', 'Link iCal', `<input id="s-ical" type="url" data-coll="ical_url" value="${esc(c.ical_url || '')}" placeholder="https://…" autocomplete="off">`)}
      ${c.ical_url ? `<p class="auto-riga ${v.auto.calendario.ok ? 'ok' : 'warn'}"><span class="dot"></span><span>${esc(v.auto.calendario.testo)}</span></p>` : ''}
      ${campo('s-am', `Parole che indicano ${esc(v.nomi.M)}`, `<input id="s-am" data-dati="alias.M" data-lista="1" value="${esc((C.deepGet(v.cfg, 'alias.M') || []).join(', '))}" placeholder="${esc(v.nomi.M)}">`, 'Separate da virgola; se un evento le contiene nel titolo, nella descrizione o tra gli invitati, è suo.')}
      ${campo('s-ag', `Parole che indicano ${esc(v.nomi.G)}`, `<input id="s-ag" data-dati="alias.G" data-lista="1" value="${esc((C.deepGet(v.cfg, 'alias.G') || []).join(', '))}" placeholder="${esc(v.nomi.G)}">`)}

      <h3 id="sez-traffico">Traffico</h3>
      <p class="intro">Create una chiave gratuita su developer.tomtom.com (20'000 richieste al mese, senza carta di credito) e incollatela qui.</p>
      ${campo('s-tt', 'Chiave TomTom', `<input id="s-tt" data-coll="tomtom_key" value="${esc(c.tomtom_key || '')}" placeholder="chiave API" autocomplete="off" spellcheck="false">`)}

      <h3 id="sez-siri">Siri e telefono</h3>
      ${c.siri_token ? `<p class="intro">Create un comando rapido per ciascuno di voi (app Comandi, +): «Dettatura testo» → «Ottieni contenuti dell’URL» con questi valori → «Mostra risultato». Il nome del comando è la frase per Siri, per esempio «Spesa di casa».</p>
        <div class="kv"><span>URL</span>${copia(siriUrl, 'URL')}</div>
        <div class="kv"><span>Metodo</span><code>POST</code></div>
        <div class="kv"><span>Intestazione apikey</span>${copia(chiave, 'chiave')}</div>
        ${legacy ? `<div class="kv"><span>Intestazione Authorization</span>${copia('Bearer ' + chiave, 'Authorization')}</div>` : ''}
        <div class="kv"><span>Corpo JSON</span><span>quattro campi di testo</span></div>
        <div class="kv"><code>p_token</code>${copia(c.siri_token, 'codice')}</div>
        <div class="kv"><code>p_chi</code><span><code>M</code> per ${esc(v.nomi.M)}, <code>G</code> per ${esc(v.nomi.G)}</span></div>
        <div class="kv"><code>p_tipo</code><span><code>spesa</code>, <code>nota</code> (bigliettino) o <code>conto</code> («42.50 Coop»)</span></div>
        <div class="kv"><code>p_testo</code><span>la variabile «Testo dettato»</span></div>
        <button type="button" class="btn sm" data-act="nuovo-token">Genera un codice nuovo</button> <small class="p-hint">Quello vecchio smette di funzionare.</small>`
        : `<p class="intro">Con un codice segreto i vostri iPhone aggiungono spesa, bigliettini e spese anche a voce, da ovunque.</p><button type="button" class="btn primary" data-act="nuovo-token">Genera il codice per Siri</button>`}

      <h3 id="sez-automazioni">Automazioni su GitHub</h3>
      <p class="intro">Calendario, brief e mercati arrivano da tre automazioni del repository Dashboard_Casa (scheda Actions). Qui vedete com’è andata l’ultima volta.</p>
      <ul class="auto">${[['Calendario', v.auto.calendario], ['Brief', v.auto.brief], ['Cambio e Interroll', v.auto.mercati]].map(([n, r]) => `<li class="auto-riga ${r.ok ? 'ok' : 'warn'}"><span class="dot"></span><span><b>${n}</b> · ${esc(r.testo)}</span></li>`).join('')}</ul>

      <h3 id="sez-dispositivo">Questo dispositivo</h3>
      ${campo('s-vi', 'Vista', `<select id="s-vi" data-dev="vista">${[['auto', 'automatica'], ['tablet', 'tablet'], ['telefono', 'telefono']].map(([k, l]) => `<option value="${k}"${(ui.vistaPref || 'auto') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      <p class="intro">${v.esempio ? 'State guardando i dati di esempio.' : `Account: ${esc((v.me && v.me.email) || '')} (${esc(v.me && v.me.persona === 'T' ? 'tablet' : v.nomi[v.me && v.me.persona] || '')}).`}</p>
      <div class="p-row">${v.esempio ? `<button type="button" class="btn" data-act="ripristina">Ripristina l’esempio</button>${ui.anteprima ? '' : `<button type="button" class="btn" data-act="esci-esempio">${I('out')}Esci dall’esempio</button>`}` : `<button type="button" class="btn" data-act="esci">${I('out')}Esci dall’account</button>`}${conf && conf.fonte === 'app' ? `<button type="button" class="btn" data-act="scollega">Cambia database</button>` : ''}</div>
    </div>`;
  };

  /* =====================================================================
     Primo avvio, accesso, errori
     ===================================================================== */
  C.schermataStato = (A, ui) => {
    if (A.stato === 'collega') return `<div class="gate"><div class="gate-card">
        <div class="gate-logo">${I('home')}</div>
        <h1>Dashboard Casa</h1>
        <p>Collegate il database Supabase della casa. Li trovate in Supabase › Project Settings › API Keys.</p>
        <form data-form="collega" novalidate>
          <label for="g-url">URL del progetto</label><input id="g-url" name="url" type="url" placeholder="https://xxxx.supabase.co" autocomplete="off" spellcheck="false">
          <label for="g-key">Chiave pubblica (publishable o anon)</label><input id="g-key" name="key" placeholder="sb_publishable_…" autocomplete="off" spellcheck="false">
          ${err(ui, 'collega')}
          <button class="btn primary" type="submit">Collega</button>
        </form>
        <button type="button" class="linkbtn" data-act="esempio">Prima provo con i dati di esempio</button>
      </div></div>`;
    if (A.stato === 'accesso') return `<div class="gate"><div class="gate-card">
        <div class="gate-logo">${I('home')}</div>
        <h1>Entra in casa</h1>
        <p>Usate l’account creato in Supabase: il vostro sul telefono, quello del tablet sull’iPad.</p>
        <form data-form="accedi" novalidate>
          <label for="g-mail">Email</label><input id="g-mail" name="email" type="email" autocomplete="username" autocapitalize="off">
          <label for="g-pw">Password</label><input id="g-pw" name="password" type="password" autocomplete="current-password">
          ${err(ui, 'accedi')}
          <button class="btn primary" type="submit">Entra</button>
        </form>
      </div></div>`;
    if (A.stato === 'estraneo') {
      const id = (A.me && A.me.id) || '';
      return `<div class="gate"><div class="gate-card">
        <h1>Quasi fatto</h1>
        <p>L’account ${esc((A.me && A.me.email) || '')} esiste ma non fa ancora parte della casa. In Supabase › SQL Editor lanciate questa riga, con M per Matteo, G per Gaia o T per il tablet:</p>
        <pre class="sql">insert into public.casa_membri (user_id, persona)\nvalues ('${esc(id)}', 'M');</pre>
        <div class="p-row"><button type="button" class="btn primary" data-act="riprova">Fatto, riprova</button><button type="button" class="btn" data-act="esci">Esci</button></div>
      </div></div>`;
    }
    if (A.stato === 'errore') return `<div class="gate"><div class="gate-card">
        <h1>Qualcosa non va</h1><p>${esc(A.errore || 'Errore sconosciuto.')}</p>
        <div class="p-row"><button type="button" class="btn primary" data-act="riprova">Riprova</button>${A.cfg && A.cfg.fonte === 'app' ? '<button type="button" class="btn" data-act="scollega">Cambia database</button>' : ''}</div>
      </div></div>`;
    return `<div class="gate"><div class="gate-card"><div class="gate-logo spin">${I('home')}</div><p>Apro la casa…</p></div></div>`;
  };
})(window.Casa = window.Casa || {});
