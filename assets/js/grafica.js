/* Dashboard Casa · grafica: cielo animato, grafici, anelli, ciambella, sparkline
   Funzioni pure che restituiscono HTML/SVG. I colori arrivano dalle variabili CSS del tema. */
(function (C) {
  'use strict';
  const G = C.G = {};
  const f1 = n => (Math.round(n * 10) / 10).toString();

  /* numeri pseudo-casuali ma sempre uguali (posizioni di stelle e gocce stabili tra un disegno e l'altro) */
  G.rnd = seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  /* le animazioni lunghe non ripartono da capo a ogni aggiornamento: il ritardo negativo segue l'orologio */
  G.fase = (durata, sfasamento = 0) => `-${(((Date.now() / 1000) + sfasamento) % durata).toFixed(2)}s`;

  /* momento del giorno per i colori */
  G.momento = (min, sun) => {
    if (min < sun.dawn || min > sun.dusk) return 'notte';
    if (min < sun.rise + 50) return 'alba';
    if (min > sun.set - 50) return 'tramonto';
    return 'giorno';
  };
  G.stagione = o => (o.m === 12 || o.m <= 2 ? 'inverno' : o.m <= 5 ? 'primavera' : o.m <= 8 ? 'estate' : 'autunno');

  /* tipo di cielo dai codici meteo WMO */
  G.tipoCielo = c => {
    if (c == null) return 'velato';
    if (c <= 1) return 'sereno';
    if (c === 2) return 'velato';
    if (c === 3) return 'coperto';
    if (c === 45 || c === 48) return 'nebbia';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'pioggia';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'neve';
    if (c >= 95) return 'temporale';
    return 'coperto';
  };

  /* ---------------------------------------------------------------------
     Cielo animato: sole o luna dove sono davvero, nuvole, pioggia, neve,
     nebbia, lampi e stelle. Solo transform e opacity: leggero per l'iPad.
     --------------------------------------------------------------------- */
  const NUVOLA = '<path d="M22 44h76a17 17 0 0 0 2.5-33.8A25 25 0 0 0 55 9a19 19 0 0 0-34.6 9.6A13.2 13.2 0 0 0 22 44z"/>';
  G.cielo = ({ codice, min, sun, ridotto, pos }) => {
    const ora = G.momento(min, sun), tipo = G.tipoCielo(codice), notte = ora === 'notte';
    const scatto = (x, n) => Math.round(Math.min(1, Math.max(0, x)) * n) / n; // sole e luna a piccoli scatti: niente ridisegni a ogni minuto
    const chiuso = ['coperto', 'pioggia', 'neve', 'temporale', 'nebbia'].includes(tipo);
    const r = G.rnd(11);
    let astro = '';
    if (pos) astro = `<i class="astro ${notte ? 'luna' : 'sole'}" style="left:${pos.x}%;top:${pos.y}%"></i>`;
    else if (!notte) {
      const k = scatto((min - sun.rise) / Math.max(1, sun.set - sun.rise), 60);
      astro = `<i class="astro sole" style="left:${f1(10 + k * 74)}%;top:${f1(70 - Math.sin(Math.PI * k) * 52)}%"></i>`;
    } else {
      const lungo = (1440 - sun.dusk) + sun.dawn, t = scatto((min >= sun.dusk ? min - sun.dusk : min + 1440 - sun.dusk) / Math.max(1, lungo), 60);
      astro = `<i class="astro luna" style="left:${f1(12 + t * 70)}%;top:${f1(62 - Math.sin(Math.PI * t) * 40)}%"></i>`;
    }
    const stelle = notte && !chiuso ? Array.from({ length: ridotto ? 14 : 24 }, (_, i) =>
      `<i class="stella" style="left:${f1(r() * 100)}%;top:${f1(r() * 62)}%;animation-delay:${G.fase(5, i * 0.83)}"></i>`).join('') : '';
    const quante = { sereno: 0, velato: 2, coperto: 4, nebbia: 2, pioggia: 4, neve: 3, temporale: 4 }[tipo];
    const nuvole = Array.from({ length: quante }, (_, i) => {
      const dur = 110 + i * 37;
      return `<svg class="nuvola n${i}" viewBox="0 0 120 50" style="top:${4 + i * 11}%;animation-duration:${dur}s;animation-delay:${G.fase(dur, i * 41)}">${NUVOLA}</svg>`;
    }).join('');
    const gocce = tipo === 'pioggia' || tipo === 'temporale' ? Array.from({ length: ridotto ? 16 : 30 }, () =>
      `<i class="goccia" style="left:${f1(r() * 104 - 2)}%;animation-duration:${(0.62 + r() * 0.42).toFixed(2)}s;animation-delay:-${(r()).toFixed(2)}s"></i>`).join('') : '';
    const fiocchi = tipo === 'neve' ? Array.from({ length: ridotto ? 14 : 26 }, () =>
      `<i class="fiocco" style="left:${f1(r() * 100)}%;width:${(3 + r() * 4).toFixed(1)}px;animation-duration:${(4 + r() * 4).toFixed(1)}s;animation-delay:-${(r() * 8).toFixed(1)}s"></i>`).join('') : '';
    const nebbia = tipo === 'nebbia' ? [0, 1, 2].map(i => { const dur = 40 + i * 12; return `<i class="banco b${i}" style="animation-duration:${dur}s;animation-delay:${G.fase(2 * dur, i * 9)}"></i>`; }).join('') : '';
    const lampo = tipo === 'temporale' ? `<i class="lampo" style="animation-delay:${G.fase(9)}"></i>` : '';
    return `<div class="cielo m-${ora} t-${tipo}${chiuso ? ' chiuso' : ''}" aria-hidden="true">${stelle}${astro}${nuvole}${nebbia}${gocce}${fiocchi}${lampo}</div>`;
  };

  /* ---------------------------------------------------------------------
     Prossime ore: linea della temperatura e barre della pioggia
     serie: [{h, t, p}]
     --------------------------------------------------------------------- */
  const liscia = pts => {
    if (pts.length < 2) return '';
    let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return d;
  };
  G.ore = (serie, W = 300, H = 92) => {
    if (!serie.length) return '';
    const n = serie.length, slot = W / n, base = H - 16, pioggiaH = 20, alto = 18, basso = base - pioggiaH - 6;
    const ts = serie.map(s => Number(s.t)), tmin = Math.min(...ts), tmax = Math.max(...ts), span = Math.max(3, tmax - tmin);
    const x = i => i * slot + slot / 2, y = t => alto + (1 - (t - tmin) / span) * (basso - alto);
    const pts = serie.map((s, i) => [x(i), y(Number(s.t))]);
    const linea = liscia(pts);
    const area = `${linea} L${f1(x(n - 1))},${f1(basso + 2)} L${f1(x(0))},${f1(basso + 2)} Z`;
    const barre = serie.map((s, i) => {
      const h = Math.max(1.5, (Number(s.p) || 0) / 100 * pioggiaH), bw = Math.min(10, slot * 0.5);
      return `<rect x="${f1(x(i) - bw / 2)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="${f1(Math.min(3, bw / 2))}" class="${(s.p || 0) >= 50 ? 'p-alta' : 'p'}"/>`;
    }).join('');
    const etichette = serie.map((s, i) => (i % 3 === 0 ? `<text x="${f1(x(i))}" y="${f1(H - 2)}" class="ora">${C.p2(s.h)}</text><text x="${f1(x(i))}" y="${f1(y(Number(s.t)) - 8)}" class="gradi">${Math.round(s.t)}°</text><circle cx="${f1(x(i))}" cy="${f1(y(Number(s.t)))}" r="2.6" class="punto"/>` : '')).join('');
    const picco = serie.reduce((a, s) => ((s.p || 0) > (a.p || 0) ? s : a), serie[0]);
    const tip = (picco.p || 0) >= 30 ? `pioggia fino al ${picco.p}% alle ${C.p2(picco.h)}` : 'niente pioggia nelle prossime ore';
    return `<svg class="ore" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prossime ${n} ore: ${tip}">
      <defs><linearGradient id="g-area-${W}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--caldo);stop-opacity:.38"/><stop offset="1" style="stop-color:var(--caldo);stop-opacity:0"/></linearGradient></defs>
      <path d="${area}" fill="url(#g-area-${W})"/><path d="${linea}" class="linea"/>${barre}${etichette}</svg>`;
  };

  /* ---------------------------------------------------------------------
     Anello: frazione 0..1, con testo al centro
     --------------------------------------------------------------------- */
  G.anello = ({ frazione = 0, colore = 'var(--ok)', r = 28, spessore = 7, centro = '', sotto = '', etichetta = '', cls = '' }) => {
    const L = 2 * Math.PI * r, k = Math.max(0, Math.min(1, frazione)), s = r * 2 + spessore + 2, c = s / 2;
    return `<svg class="anello${cls ? ' ' + cls : ''}" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" role="img" aria-label="${C.esc(etichetta)}">
      <circle cx="${c}" cy="${c}" r="${r}" class="pista" stroke-width="${spessore}"/>
      <circle cx="${c}" cy="${c}" r="${r}" class="arco" style="stroke:${colore}" stroke-width="${spessore}" stroke-dasharray="${f1(L * k)} ${f1(L)}" transform="rotate(-90 ${c} ${c})"/>
      ${centro ? `<text x="${c}" y="${f1(sotto ? c + r * 0.1 : c + r * 0.22)}" class="centro" font-size="${Math.round(r * (sotto ? 0.44 : 0.62))}">${centro}</text>` : ''}${sotto ? `<text x="${c}" y="${f1(c + r * 0.5)}" class="sotto" font-size="${Math.max(8, Math.round(r * 0.27))}">${sotto}</text>` : ''}
    </svg>`;
  };

  /* ---------------------------------------------------------------------
     Ciambella: parti [{v, colore}] con totale al centro
     --------------------------------------------------------------------- */
  G.ciambella = ({ parti = [], r = 46, spessore = 13, centro = '', sotto = '' }) => {
    const tot = parti.reduce((a, p) => a + Math.max(0, p.v), 0), s = r * 2 + spessore + 4, c = s / 2, L = 2 * Math.PI * r;
    let fatto = 0;
    const archi = tot > 0 ? parti.filter(p => p.v > 0).map(p => {
      const k = p.v / tot, len = Math.max(0, L * k - 3), off = -L * fatto;
      fatto += k;
      return `<circle cx="${c}" cy="${c}" r="${r}" class="fetta" style="stroke:${p.colore}" stroke-width="${spessore}" stroke-dasharray="${f1(len)} ${f1(L)}" stroke-dashoffset="${f1(off)}" transform="rotate(-90 ${c} ${c})"/>`;
    }).join('') : '';
    return `<svg class="ciambella" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" aria-hidden="true">
      <circle cx="${c}" cy="${c}" r="${r}" class="pista" stroke-width="${spessore}"/>${archi}
      <text x="${c}" y="${f1(c + r * 0.14)}" class="centro" font-size="${Math.round(r * 0.5)}">${centro}</text><text x="${c}" y="${f1(c + r * 0.55)}" class="sotto" font-size="${Math.max(8, Math.round(r * 0.3))}">${sotto}</text></svg>`;
  };

  /* ---------------------------------------------------------------------
     Contatore a mezzaluna (franchigia della carne)
     --------------------------------------------------------------------- */
  G.mezzaluna = ({ frazione = 0, colore = 'var(--ok)', r = 54, spessore = 11, centro = '', sotto = '' }) => {
    const k = Math.max(0, Math.min(1, frazione)), w = r * 2 + spessore + 2, h = r + spessore + 22, cx = w / 2, cy = r + spessore / 2 + 1;
    const L = Math.PI * r;
    const arco = `M${f1(cx - r)},${f1(cy)} A${r},${r} 0 0 1 ${f1(cx + r)},${f1(cy)}`;
    return `<svg class="mezzaluna" viewBox="0 0 ${f1(w)} ${f1(h)}" width="${f1(w)}" height="${f1(h)}" aria-hidden="true">
      <path d="${arco}" class="pista" stroke-width="${spessore}"/>
      <path d="${arco}" class="arco" style="stroke:${colore}" stroke-width="${spessore}" stroke-dasharray="${f1(L * k)} ${f1(L)}"/>
      <text x="${f1(cx)}" y="${f1(cy - 5)}" class="centro" font-size="${Math.round(r * 0.36)}">${centro}</text><text x="${f1(cx)}" y="${f1(cy + 14)}" class="sotto" font-size="${Math.max(8, Math.round(r * 0.23))}">${sotto}</text></svg>`;
  };

  /* ---------------------------------------------------------------------
     Sparkline: andamento degli ultimi giorni
     --------------------------------------------------------------------- */
  G.sparkline = (valori, { W = 64, H = 18, colore = 'currentColor' } = {}) => {
    const v = (valori || []).map(Number).filter(x => isFinite(x));
    if (v.length < 3) return '';
    const mn = Math.min(...v), mx = Math.max(...v), span = mx - mn || 1;
    const pts = v.map((x, i) => [i / (v.length - 1) * (W - 4) + 2, H - 3 - (x - mn) / span * (H - 6)]);
    const ultimo = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts.map(p => `${f1(p[0])},${f1(p[1])}`).join(' ')}" fill="none" style="stroke:${colore}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${f1(ultimo[0])}" cy="${f1(ultimo[1])}" r="2.2" style="fill:${colore}"/></svg>`;
  };

  /* ---------------------------------------------------------------------
     Linea del tempo della giornata: una riga per persona, gli eventi
     insieme occupano tutte e due, la riga verticale è adesso.
     eventi: [{s, e, chi, titolo, allDay}]
     --------------------------------------------------------------------- */
  G.giornata = ({ eventi = [], adesso, da = 420, a = 1440, W = 320, nomi = { M: 'M', G: 'G' } }) => {
    const H = 64, sx = 22, larg = W - sx - 4, x = m => sx + (Math.max(da, Math.min(a, m)) - da) / (a - da) * larg;
    const righe = { M: 10, G: 32 }, alto = 16;
    const barre = eventi.filter(e => !e.allDay && e.e > da && e.s < a).map(e => {
      const x1 = x(e.s), x2 = Math.max(x1 + 6, x(e.e)), w = x2 - x1;
      const chi = ['M', 'G', 'MG'].includes(e.chi) ? e.chi : '', pass = e.e <= adesso ? ' passato' : '';
      if (chi === 'MG' || !chi) return `<rect x="${f1(x1)}" y="${righe.M}" width="${f1(w)}" height="${righe.G - righe.M + alto}" rx="5" class="ev-insieme${chi ? '' : ' ev-casa'}${pass}"><title>${C.esc(e.titolo)}</title></rect>`;
      return `<rect x="${f1(x1)}" y="${righe[chi]}" width="${f1(w)}" height="${alto}" rx="5" class="ev-${chi}${pass}"><title>${C.esc(e.titolo)}</title></rect>`;
    }).join('');
    const tacche = [480, 720, 960, 1200].filter(m => m > da && m < a).map(m => `<line x1="${f1(x(m))}" y1="6" x2="${f1(x(m))}" y2="${H - 12}" class="tacca"/><text x="${f1(x(m))}" y="${H - 1}" class="ora">${C.p2(m / 60)}</text>`).join('');
    const ora = adesso >= da && adesso <= a ? `<line x1="${f1(x(adesso))}" y1="3" x2="${f1(x(adesso))}" y2="${H - 10}" class="adesso"/><circle cx="${f1(x(adesso))}" cy="3" r="3.2" class="adesso-p"/>` : '';
    return `<svg class="giornata" viewBox="0 0 ${W} ${H}" role="img" aria-label="La giornata di oggi">
      <text x="0" y="${righe.M + 12}" class="chi chi-M">${C.esc((nomi.M || 'M')[0])}</text><text x="0" y="${righe.G + 12}" class="chi chi-G">${C.esc((nomi.G || 'G')[0])}</text>
      <rect x="${sx}" y="${righe.M}" width="${f1(larg)}" height="${alto}" rx="5" class="fondo"/><rect x="${sx}" y="${righe.G}" width="${f1(larg)}" height="${alto}" rx="5" class="fondo"/>
      ${tacche}${barre}${ora}</svg>`;
  };

  /* colore per categoria di spesa */
  G.COLORI_CAT = { Spesa: 'var(--c1)', Affitto: 'var(--c2)', Casa: 'var(--c3)', Bollette: 'var(--c4)', Svago: 'var(--c5)', Altro: 'var(--c6)' };
})(window.Casa = window.Casa || {});
