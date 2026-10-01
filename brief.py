"""Dashboard Casa · scrive il brief del mattino (06:15) e della sera (18:00) con Claude.

Raccoglie meteo, orario di uscita, calendario, faccende, spesa e conti; chiede a Claude tre
frasi per lo schermo di casa e le salva nel database. Senza chiave Anthropic (o se Claude non
risponde) scrive comunque un brief semplice a regole.

Uso:  python scripts/brief.py                 (decide da solo mattina o sera in base all'ora)
      python scripts/brief.py --tipo mattina --forza --prova
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, datetime, timedelta

import requests

from comune import (Supabase, avviso, data_lunga, esegui, feriale, festivo, log, meteo, ora_locale,
                    partenza_consigliata, riassunto_meteo)

MODELLO = os.environ.get("CLAUDE_MODEL") or "claude-sonnet-5-5"
ICONE = {"umbrella", "car", "frost", "cal", "cart", "check", "spark", "wallet", "broom", "heart"}

SISTEMA = """Sei l'assistente di casa di {M} e {G}, che vivono insieme a Lugano.
Scrivi il brief {quando} che comparirà sullo schermo in cucina.
Regole:
- Al massimo 3 frasi brevi, al massimo 220 caratteri in tutto (lo schermo è piccolo), in italiano naturale e caldo.
- Niente saluti generici, niente emoji, niente elenchi, niente punti esclamativi a raffica.
- Prima le cose pratiche (meteo che cambia i piani, orario di uscita, impegni), poi al massimo una cosa di casa (faccende, spesa, conti, ricorrenze).
- Usa solo i dati che ricevi: non inventare eventi, orari o numeri. Se un dato manca, non parlarne.
- Orari nel formato 07:54. Chiama le persone per nome.
Rispondi solo con un oggetto JSON, senza altro testo:
{{"testo": "...", "chips": [{{"t": "warn" | "ok" | "", "i": "umbrella|car|frost|cal|cart|check|spark|wallet|broom|heart", "x": "etichetta di massimo 22 caratteri"}}]}}
con al massimo 3 chips: "warn" per un avviso (ombrello, brina), "ok" per un orario utile, "" per il resto."""


def hm(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def raccogli(db: Supabase, tipo: str, adesso: datetime) -> dict:
    dati, coll = db.config()
    nomi = dati.get("nomi") or {"M": "Matteo", "G": "Gaia"}
    casa, lavoro = dati.get("casa") or {}, dati.get("lavoro") or {}
    oggi = adesso.date()
    giorno = oggi if tipo == "mattina" else oggi + timedelta(days=1)
    lat, lon = casa.get("lat") or 46.0037, casa.get("lon") or 8.9511
    mt = meteo(lat, lon)
    g_meteo = riassunto_meteo(mt.get(giorno.isoformat()))

    # uscita per il lavoro
    uscita = None
    chi_lavora = lavoro.get("chi") or ""
    if chi_lavora and feriale(giorno):
        p = partenza_consigliata(coll.get("tomtom_key", ""), casa, lavoro, giorno)
        if p:
            margine = int(lavoro.get("margine") or 5) + (5 if g_meteo and g_meteo["brina_all_alba"] else 0)
            uscita = {"uscire_entro": hm(p["partenza"] - timedelta(minutes=margine)), "minuti_in_auto": p["minuti"],
                      "arrivo": lavoro.get("arrivo", "08:30"), "brina_5_minuti_in_piu": bool(g_meteo and g_meteo["brina_all_alba"]),
                      "chi": [nomi[x] for x in chi_lavora if x in nomi]}

    # calendario (oggi e domani; per la sera domani e dopodomani)
    dal = datetime.combine(giorno, datetime.min.time(), tzinfo=adesso.tzinfo)
    righe = db.leggi("casa_eventi", select="titolo,inizio,fine,tutto_il_giorno,chi",
                     inizio=f"lt.{(dal + timedelta(days=2)).isoformat()}", fine=f"gt.{dal.isoformat()}", order="inizio")
    def evento(r):
        ini = datetime.fromisoformat(r["inizio"]).astimezone(adesso.tzinfo)
        chi = r.get("chi") or ""
        return {"giorno": "oggi" if ini.date() == oggi else "domani" if ini.date() == oggi + timedelta(days=1) else data_lunga(ini.date()),
                "ora": None if r["tutto_il_giorno"] else hm(ini), "titolo": r["titolo"],
                "di": " e ".join(nomi.get(x, x) for x in chi) if chi else "entrambi o non indicato"}
    eventi = [evento(r) for r in righe][:8]

    # faccende della settimana
    sett = f"{adesso.isocalendar()[0]}-W{adesso.isocalendar()[1]:02d}"
    faccende = db.leggi("casa_faccende", select="id,nome,punti,volte_settimana,persona_base", attiva="eq.true", order="ordine")
    fatte = db.leggi("casa_faccende_fatte", select="faccenda_id,chi,punti", settimana=f"eq.{sett}")
    trasloco = dati.get("trasloco")
    n = None
    if trasloco:
        t = date.fromisoformat(trasloco)
        n = ((oggi - timedelta(days=oggi.weekday())) - (t - timedelta(days=t.weekday()))).days // 7 + 1
        n = n if n >= 1 else None
    rot = (dati.get("faccende") or {}).get("rotazione", "alterna")
    def assegnata(f):
        if rot == "fissa":
            return f["persona_base"]
        pari = (n % 2 == 0) if n else (adesso.isocalendar()[1] % 2 == 0)
        return ("G" if f["persona_base"] == "M" else "M") if pari else f["persona_base"]
    da_fare = []
    for f in faccende:
        k = sum(1 for x in fatte if x["faccenda_id"] == f["id"])
        if k < f["volte_settimana"]:
            da_fare.append({"faccenda": f["nome"], "tocca_a": nomi.get(assegnata(f), "")})
    punti = {nomi.get(p, p): sum(x.get("punti") or 0 for x in fatte if x["chi"] == p) for p in ("M", "G")}

    # spesa, conti, ricorrenze
    spesa = db.leggi("casa_spesa", select="nome,carne_kg", preso_il="is.null")
    riepilogo = (db.leggi("casa_spese_riepilogo", select="g_deve_a_m,totale_mese") or [{}])[0]
    saldo = float(riepilogo.get("g_deve_a_m") or 0)
    ricorrenze = []
    for r in db.leggi("casa_ricorrenze", select="titolo,data,annuale"):
        d = date.fromisoformat(r["data"])
        if r.get("annuale"):
            d = d.replace(year=oggi.year)
            if d < oggi:
                d = d.replace(year=oggi.year + 1)
        if 0 <= (d - oggi).days <= 14:
            ricorrenze.append({"titolo": r["titolo"], "tra_giorni": (d - oggi).days})
    giorno_it = (dati.get("spesa") or {}).get("giorno_italia", 6)

    return {
        "tipo": "mattino" if tipo == "mattina" else "sera (brief per domani)",
        "adesso": f"{data_lunga(oggi)}, ore {hm(adesso)}",
        "giorno_di_cui_parlare": data_lunga(giorno),
        "festivo_ticino": festivo(giorno),
        "meteo": g_meteo,
        "uscita_per_il_lavoro": uscita,
        "eventi": eventi,
        "faccende_da_fare_questa_settimana": da_fare[:5],
        "punti_faccende_settimana": punti,
        "spesa": {"voci_in_lista": len(spesa), "carne_kg": round(sum(float(x.get("carne_kg") or 0) for x in spesa), 2),
                  "spesa_in_italia": ("quel giorno" if giorno_it is not None and int(giorno_it) >= 0 and giorno.weekday() == (int(giorno_it) - 1) % 7 else None)},
        "conti": {"saldo": (f"{nomi['G']} deve {saldo:.2f} CHF a {nomi['M']}" if saldo > 0.004 else
                            f"{nomi['M']} deve {-saldo:.2f} CHF a {nomi['G']}" if saldo < -0.004 else "in pari")},
        "ricorrenze_vicine": ricorrenze,
        "casa_nuova_settimana": n,
        "_nomi": nomi,
    }


def _perche_claude_no(r) -> str:
    testo = r.text[:400]
    if r.status_code == 401:
        return "la chiave di Claude non è valida (401): controllate il secret ANTHROPIC_API_KEY"
    if r.status_code == 404 and "model" in testo:
        return f"il modello {MODELLO} non esiste (404): controllate la variabile CLAUDE_MODEL"
    if "credit balance" in testo:
        return "il credito Anthropic è finito: ricaricatelo su console.anthropic.com"
    if r.status_code in (429, 529) or r.status_code >= 500:
        return f"Claude era occupato ({r.status_code}): riprova al prossimo brief"
    return f"Claude ha risposto {r.status_code}: {testo[:160]}"


def brief_con_claude(ctx: dict, tipo: str) -> tuple[dict | None, str | None]:
    """Ritorna (brief, nota): la nota spiega perché si è usato il brief a regole."""
    chiave = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not chiave:
        log("Nessuna ANTHROPIC_API_KEY: uso il brief a regole.")
        return None, "senza chiave di Claude: brief a regole"
    nomi = ctx.pop("_nomi")
    sistema = SISTEMA.format(M=nomi["M"], G=nomi["G"], quando="del mattino" if tipo == "mattina" else "della sera, pensato per domani")
    try:
        r = requests.post("https://api.anthropic.com/v1/messages", timeout=60, headers={
            "x-api-key": chiave, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": MODELLO, "max_tokens": 600, "system": sistema,
                  "messages": [{"role": "user", "content": json.dumps(ctx, ensure_ascii=False, default=str)}]})
        ctx["_nomi"] = nomi
        if r.status_code >= 400:
            nota = _perche_claude_no(r)
            log(f"Claude ha risposto {r.status_code}: {r.text[:300]}")
            return None, nota
        testo = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()
        testo = re.sub(r"^```(?:json)?|```$", "", testo, flags=re.M).strip()
        out = json.loads(testo[testo.find("{"): testo.rfind("}") + 1])
        chips = [{"t": c.get("t") if c.get("t") in ("warn", "ok") else "", "i": c.get("i") if c.get("i") in ICONE else "spark",
                  "x": str(c.get("x", ""))[:24]} for c in (out.get("chips") or [])[:3] if c.get("x")]
        frase = str(out.get("testo", "")).strip()
        if not frase:
            return None, "Claude ha risposto senza testo"
        return {"testo": frase[:420], "chips": chips, "modello": MODELLO}, None
    except Exception as e:  # noqa: BLE001
        ctx.setdefault("_nomi", nomi)
        log("Claude non disponibile:", e)
        return None, f"Claude non disponibile ({e.__class__.__name__})"


def brief_a_regole(ctx: dict, tipo: str) -> dict:
    frasi, chips = [], []
    m, u = ctx.get("meteo"), ctx.get("uscita_per_il_lavoro")
    quando = "Oggi" if tipo == "mattina" else "Domani"
    if m:
        if m["pioggia_dalle"] is not None:
            frasi.append(f"{quando} pioggia dalle {m['pioggia_dalle']}: serve l'ombrello.")
            chips.append({"t": "warn", "i": "umbrella", "x": "Ombrello"})
        else:
            frasi.append(f"{quando} {m['cielo_pomeriggio']}, tra {m['min']}° e {m['max']}°.")
        if m["brina_all_alba"] and u:
            chips.append({"t": "warn", "i": "frost", "x": "Brina: +5 min"})
    if u:
        frasi.append(f"Per arrivare alle {u['arrivo']} uscite entro le {u['uscire_entro']}.")
        chips.append({"t": "ok", "i": "car", "x": f"Esci entro {u['uscire_entro']}"})
    ev = [e for e in ctx.get("eventi", []) if e["ora"] and e["giorno"] == ("oggi" if tipo == "mattina" else "domani")]
    if ev:
        frasi.append(f"In agenda: {ev[0]['titolo'].lower()} alle {ev[0]['ora']}.")
    elif ctx.get("faccende_da_fare_questa_settimana"):
        f = ctx["faccende_da_fare_questa_settimana"][0]
        frasi.append(f"{f['faccenda']} tocca a {f['tocca_a']}.")
    return {"testo": " ".join(frasi[:3]) or "Buona giornata.", "chips": chips[:3], "modello": "regole"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tipo", choices=["mattina", "sera"])
    ap.add_argument("--forza", action="store_true", help="scrive anche fuori orario o se il brief esiste già")
    ap.add_argument("--prova", action="store_true", help="non scrive nel database")
    args = ap.parse_args()

    adesso = ora_locale()
    minuti = adesso.hour * 60 + adesso.minute
    tipo = args.tipo or ("mattina" if 330 <= minuti < 540 else "sera" if 1050 <= minuti < 1260 else None)
    if not tipo:
        log(f"Sono le {hm(adesso)} a Lugano: non è l'ora di un brief. Esco.")
        return
    db = Supabase()
    if not args.forza:
        inizio_giorno = adesso.replace(hour=0, minute=0, second=0, microsecond=0)
        gia = db.leggi("casa_brief", select="id", tipo=f"eq.{tipo}", creato_il=f"gte.{inizio_giorno.isoformat()}")
        if gia:
            log(f"Il brief di {tipo} di oggi c'è già. Esco.")
            return
    ctx = raccogli(db, tipo, adesso)
    brief, nota = brief_con_claude(ctx, tipo)
    if not brief:
        brief = brief_a_regole(ctx, tipo)
        if nota and os.environ.get("ANTHROPIC_API_KEY", "").strip():
            avviso(f"Brief: {nota}")
    log(f"[{brief['modello']}] {brief['testo']}")
    log("chips:", json.dumps(brief["chips"], ensure_ascii=False))
    if not args.prova:
        db.inserisci("casa_brief", {"tipo": tipo, "testo": brief["testo"], "chips": brief["chips"], "modello": brief["modello"]})
        log("brief salvato")
        db.segna_stato("brief", {"quando": ora_locale().isoformat(timespec="seconds"), "ok": True, "tipo": tipo,
                                 "modello": brief["modello"], "nota": nota})


if __name__ == "__main__":
    esegui(main)
