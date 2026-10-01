/* Dashboard Casa · base: utilità, date svizzere, festivi ticinesi, sole, icone, logica */
(function (C) {
  'use strict';

  C.TZ = 'Europe/Zurich';

  /* ---------- testo e numeri ---------- */
  C.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  C.p2 = n => String(n).padStart(2, '0');
  C.hm = m => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return C.p2(Math.floor(m / 60)) + ':' + C.p2(m % 60); };
  C.toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  C.nf = (n, d = 0) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0);
  C.dur = m => (m >= 60 ? `${Math.floor(m / 60)} h ${C.p2(Math.round(m % 60))}` : `${Math.max(0, Math.round(m))} min`);
  C.cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  C.WD = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  C.WDS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  C.MON = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  C.MONS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  /* ---------- date nel fuso di Zurigo ---------- */
  const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: C.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  C.zParts = date => {
    const p = {};
    for (const x of FMT.formatToParts(date)) p[x.type] = x.value;
    const y = +p.year, m = +p.month, d = +p.day, h = +p.hour % 24, mi = +p.minute;
    return { y, m, d, h, mi, min: h * 60 + mi, o: { y, m, d }, key: `${p.year}-${p.month}-${p.day}` };
  };
  C.zDate = (y, m, d, h = 0, mi = 0) => {
    const want = Date.UTC(y, m - 1, d, h, mi);
    let t = want - 3600e3;
    for (let i = 0; i < 3; i++) {
      const z = C.zParts(new Date(t));
      const diff = want - Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi);
      if (!diff) break;
      t += diff;
    }
    return new Date(t);
  };
  C.rfc3339 = date => {
    const z = C.zParts(date);
    const off = Math.round((Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
    const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    return `${z.key}T${C.p2(z.h)}:${C.p2(z.mi)}:00${sign}${C.p2(Math.floor(a / 60))}:${C.p2(a % 60)}`;
  };
  C.ymd = (y, m, d) => ({ y, m, d });
  C.key = o => `${o.y}-${C.p2(o.m)}-${C.p2(o.d)}`;
  C.parseKey = k => { const [y, m, d] = String(k).slice(0, 10).split('-').map(Number); return { y, m, d }; };
  C.addDays = (o, n) => { const t = new Date(Date.UTC(o.y, o.m - 1, o.d + n)); return C.ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  C.weekday = o => new Date(Date.UTC(o.y, o.m - 1, o.d)).getUTCDay();
  C.dayDiff = (a, b) => Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 864e5);
  C.longDate = o => `${C.WD[C.weekday(o)]} ${o.d} ${C.MON[o.m - 1]}`;
  C.shortDate = o => `${C.WDS[C.weekday(o)]} ${o.d} ${C.MONS[o.m - 1]}`;
  C.isoWeek = o => {
    const d = new Date(Date.UTC(o.y, o.m - 1, o.d)), day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((d - y0) / 864e5 + 1) / 7);
    return `${d.getUTCFullYear()}-W${C.p2(wk)}`;
  };
  C.monday = o => C.addDays(o, -((C.weekday(o) + 6) % 7));

  /* ---------- festivi ufficiali in Ticino ---------- */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return C.ymd(y, month, day);
  }
  const festCache = {};
  C.festivi = y => {
    if (festCache[y]) return festCache[y];
    const e = easter(y), out = {};
    const add = (o, n) => { out[C.key(o)] = n; };
    [[1, 1, 'Capodanno'], [1, 6, 'Epifania'], [3, 19, 'San Giuseppe'], [5, 1, 'Festa del lavoro'], [6, 29, 'Santi Pietro e Paolo'],
      [8, 1, 'Festa nazionale'], [8, 15, 'Assunzione'], [11, 1, 'Ognissanti'], [12, 8, 'Immacolata'], [12, 25, 'Natale'], [12, 26, 'Santo Stefano']]
      .forEach(([m, d, n]) => add(C.ymd(y, m, d), n));
    add(C.addDays(e, 1), 'Lunedì dell’Angelo');
    add(C.addDays(e, 39), 'Ascensione');
    add(C.addDays(e, 50), 'Lunedì di Pentecoste');
    add(C.addDays(e, 60), 'Corpus Domini');
    return (festCache[y] = out);
  };
  C.festivo = o => C.festivi(o.y)[C.key(o)] || null;
  C.feriale = o => { const w = C.weekday(o); return w >= 1 && w <= 5 && !C.festivo(o); };

  /* ---------- sole (formula NOAA semplificata) ---------- */
  function solar(o, lat, lon, h0deg) {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
    const date = new Date(Date.UTC(o.y, o.m - 1, o.d, 11, 0));
    const toJ = d => d.valueOf() / dayMs - 0.5 + J1970, fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
    const e = rad * 23.4397, J0 = 0.0009, lw = rad * -lon, phi = rad * lat, d = toJ(date) - J2000;
    const n = Math.round(d - J0 - lw / (2 * Math.PI)), ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const w = Math.acos((Math.sin(rad * h0deg) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const Jset = J2000 + (J0 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return { rise: fromJ(Jnoon - (Jset - Jnoon)), set: fromJ(Jset) };
  }
  const sunCache = {};
  C.sun = (o, lat = 46.0037, lon = 8.9511) => {
    const k = `${C.key(o)}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (sunCache[k]) return sunCache[k];
    const s = solar(o, lat, lon, -0.833), c = solar(o, lat, lon, -6);
    return (sunCache[k] = { rise: C.zParts(s.rise).min, set: C.zParts(s.set).min, dawn: C.zParts(c.rise).min, dusk: C.zParts(c.set).min });
  };

  /* ---------- meteo: codici WMO ---------- */
  const W_TEXT = { 0: 'sereno', 1: 'quasi sereno', 2: 'poco nuvoloso', 3: 'nuvoloso', 45: 'nebbia', 48: 'nebbia gelata', 51: 'pioviggine', 53: 'pioviggine', 55: 'pioviggine fitta', 56: 'pioviggine gelata', 57: 'pioviggine gelata', 61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte', 66: 'pioggia gelata', 67: 'pioggia gelata', 71: 'neve debole', 73: 'neve', 75: 'neve forte', 77: 'nevischio', 80: 'rovesci', 81: 'rovesci', 82: 'rovesci forti', 85: 'rovesci di neve', 86: 'rovesci di neve', 95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine' };
  C.wText = c => W_TEXT[c] || 'variabile';
  C.wIconName = (c, night) => {
    if (c <= 1) return night ? 'moon' : 'sun';
    if (c === 2) return night ? 'moon' : 'part';
    if (c === 3) return 'cloud';
    if (c === 45 || c === 48) return 'fog';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'storm';
    return 'cloud';
  };

  /* ---------- icone (tratto, colore del testo) ---------- */
  const cloudUp = '<path d="M7.5 15h9.25a4.25 4.25 0 0 0 .6-8.46A5.75 5.75 0 0 0 6.3 6.3 4.35 4.35 0 0 0 7.5 15z"/>';
  C.ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    cloud: '<path d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .6-8.46A5.75 5.75 0 0 0 6.3 9.8a4.35 4.35 0 0 0 1.2 8.7z"/>',
    part: '<path d="M8.5 3.2v1.6M3.4 5.4l1.1 1.1M2.2 10.4h1.6M13.6 5.4l-1.1 1.1"/><path d="M5.2 12.7a3.8 3.8 0 1 1 6.9-3.6"/><path d="M9.6 20h8a3.6 3.6 0 0 0 .4-7.18 4.9 4.9 0 0 0-9.3-.5A3.8 3.8 0 0 0 9.6 20z"/>',
    rain: cloudUp + '<path d="M9 18l-1.2 2.6M13 18l-1.2 2.6M17 18l-1.2 2.6"/>',
    snow: cloudUp + '<path d="M9 18.6h.01M13 18.6h.01M17 18.6h.01M11 21.4h.01M15 21.4h.01" stroke-width="2.6"/>',
    fog: '<path d="M4 8.5h16M6.5 12.5h11M4 16.5h16"/>',
    storm: cloudUp + '<path d="M12.6 16.2l-2.1 3.3h3.1l-2.1 3.3"/>',
    umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.2a2.2 2.2 0 0 1-4.4 0"/><path d="M12 3v-.5"/>',
    shirt: '<path d="M8.6 4.5L4 7l1.9 3.6 2-1v9.9h8.2V9.6l2 1L20 7l-4.6-2.5a3.4 3.4 0 0 1-6.8 0z"/>',
    frost: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.6L12 6.6l2.4-2M9.6 19.4L12 17.4l2.4 2"/>',
    car: '<path d="M4.5 16.5v-3.8l1.8-4.9A2 2 0 0 1 8.2 6.5h7.6a2 2 0 0 1 1.9 1.3l1.8 4.9v3.8z"/><path d="M4.5 12.7h15M6.5 16.5v2M17.5 16.5v2"/><path d="M8 14.6h.01M16 14.6h.01" stroke-width="2.4"/>',
    cart: '<path d="M3.5 4.5h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.1l1.4-6.3H6.3"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    spark: '<path d="M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    wallet: '<path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zm0 0V6a1.5 1.5 0 0 1 1.5-1.5H16"/><path d="M16 13.5h.01" stroke-width="2.4"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    broom: '<path d="M14.5 3.5l-4.6 8.2"/><path d="M6.6 11l6.3 3.5-2.6 5.8H4.4l.4-3.6z"/><path d="M7.4 20.2l1.4-3.4M10 20.3l.9-2.2"/>',
    home: '<path d="M4 11.2L12 4.5l8 6.7"/><path d="M6 9.8v9.7h12V9.8"/><path d="M10 19.5v-5h4v5"/>',
    note: '<path d="M5 4.5h14v11l-4 4H5z"/><path d="M15 19.5v-4h4"/><path d="M8.5 9h7M8.5 12.5h4.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    out: '<path d="M14 4.5h4.5v15H14M10 16l4-4-4-4M14 12H4.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  C.I = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${C.ICONS[n] || ''}</svg>`;

  /* ---------- logica di casa ---------- */
  // Settimana nella casa nuova (1 = la settimana del trasloco); null se la data manca o è futura
  C.settimanaCasa = (o, traslocoKey) => {
    if (!traslocoKey) return null;
    const t = C.parseKey(traslocoKey);
    const n = Math.floor(C.dayDiff(C.monday(t), C.monday(o)) / 7) + 1;
    return n >= 1 ? n : null;
  };
  C.altro = p => (p === 'M' ? 'G' : 'M');
  C.assegnata = (faccenda, n, isoKey, rotazione) => {
    if (rotazione === 'fissa') return faccenda.persona_base;
    const pari = n ? n % 2 === 0 : Number(String(isoKey).slice(-2)) % 2 === 0;
    return pari ? C.altro(faccenda.persona_base) : faccenda.persona_base;
  };
  C.carneKg = nome => {
    if (!/(pollo|manzo|maiale|carne|salsicc|prosciutto|vitello|macinato|bistecc|speck|salame|tacchino|agnello|cotolett|hamburger|arrosto|coniglio|bresaola|mortadella|pancetta|wurstel|würstel|guanciale|cotechino)/i.test(nome)) return null;
    const m = String(nome).match(/(\d+(?:[.,]\d+)?)\s*(kg|chili|g|gr|grammi)(\s|$|\))/i);
    if (!m) return null;
    const q = parseFloat(m[1].replace(',', '.'));
    return /^(kg|chili)$/i.test(m[2]) ? q : Math.round(q / 10) / 100;
  };
  C.saldoDa = spese => spese.reduce((a, s) => {
    const imp = Number(s.importo) || 0, q = Number(s.quota_m ?? 50);
    if (s.tipo === 'saldo') return a + (s.pagato_da === 'M' ? imp : -imp);
    return a + (s.pagato_da === 'M' ? imp * (100 - q) / 100 : -imp * q / 100);
  }, 0);
  C.token = (len = 32) => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', out = [];
    const buf = new Uint32Array(len);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (let i = 0; i < len; i++) out.push(abc[buf[i] % abc.length]);
    return out.join('');
  };
  C.deepSet = (obj, path, val) => {
    const k = path.split('.'); let o = obj;
    while (k.length > 1) { const x = k.shift(); if (typeof o[x] !== 'object' || o[x] === null) o[x] = {}; o = o[x]; }
    o[k[0]] = val; return obj;
  };
  C.deepGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  C.clone = x => JSON.parse(JSON.stringify(x));
})(window.Casa = window.Casa || {});
