"""Dashboard Casa · copia il calendario di FamilyWall nel database (ogni 15 minuti).

Legge il link iCal salvato nell'app (Impostazioni › Calendario FamilyWall), espande gli eventi
ricorrenti delle prossime tre settimane, capisce di chi è ogni evento dalle parole scelte
nell'app e sostituisce gli eventi nel database. Fa anche un po' di pulizia (spesa presa da
più di 7 giorni, bigliettini vecchi).

Uso:  python scripts/calendario.py            (scrive nel database)
      python scripts/calendario.py --prova    (mostra soltanto cosa scriverebbe)
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta

import icalendar
import recurring_ical_events
import requests

from comune import ZURIGO, Supabase, log, ora_locale

GIORNI_AVANTI = 21


def _testo(v) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return " ".join(_testo(x) for x in v)
    try:
        return str(v.to_ical().decode("utf-8", "ignore")) if hasattr(v, "to_ical") and not isinstance(v, str) else str(v)
    except Exception:  # noqa: BLE001
        return str(v)


def _nomi_partecipanti(ev) -> str:
    parti = []
    for chiave in ("ATTENDEE", "ORGANIZER"):
        valori = ev.get(chiave)
        if valori is None:
            continue
        for v in valori if isinstance(valori, list) else [valori]:
            parti.append(str(v))
            cn = getattr(v, "params", {}).get("CN") if hasattr(v, "params") else None
            if cn:
                parti.append(str(cn))
    return " ".join(parti)


def chi_e(ev, alias: dict) -> str | None:
    testo = " ".join([
        _testo(ev.get("SUMMARY")), _testo(ev.get("DESCRIPTION")), _testo(ev.get("CATEGORIES")), _nomi_partecipanti(ev),
    ]).lower()
    m = any(a.lower() in testo for a in alias.get("M", []) if a)
    g = any(a.lower() in testo for a in alias.get("G", []) if a)
    return "MG" if m and g else "M" if m else "G" if g else None


def _in_zurigo(x) -> tuple[datetime, bool]:
    """Ritorna (datetime con fuso di Zurigo, tutto_il_giorno)."""
    if isinstance(x, datetime):
        return (x.replace(tzinfo=ZURIGO) if x.tzinfo is None else x.astimezone(ZURIGO)), False
    if isinstance(x, date):
        return datetime.combine(x, time(0), tzinfo=ZURIGO), True
    raise ValueError(f"data non riconosciuta: {x!r}")


def eventi_da_ical(ics: bytes, alias: dict, dal: datetime, al: datetime) -> list[dict]:
    cal = icalendar.Calendar.from_ical(ics)
    out, visti = [], set()
    for ev in recurring_ical_events.of(cal).between(dal, al):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        inizio, tutto = _in_zurigo(ev["DTSTART"].dt)
        if ev.get("DTEND") is not None:
            fine, _ = _in_zurigo(ev["DTEND"].dt)
        elif ev.get("DURATION") is not None:
            fine = inizio + ev["DURATION"].dt
        else:
            fine = inizio + (timedelta(days=1) if tutto else timedelta(hours=1))
        uid = str(ev.get("UID") or f"{_testo(ev.get('SUMMARY'))}-{inizio.isoformat()}")
        chiave = (uid, inizio.isoformat())
        if chiave in visti:
            continue
        visti.add(chiave)
        out.append({
            "uid": uid[:200],
            "inizio": inizio.isoformat(),
            "fine": fine.isoformat(),
            "tutto_il_giorno": tutto,
            "titolo": (_testo(ev.get("SUMMARY")).strip() or "(senza titolo)")[:200],
            "luogo": (_testo(ev.get("LOCATION")).strip() or None),
            "chi": chi_e(ev, alias),
        })
    out.sort(key=lambda e: e["inizio"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prova", action="store_true", help="non scrive nel database")
    args = ap.parse_args()

    db = Supabase()
    dati, coll = db.config()
    url = (coll.get("ical_url") or "").strip()
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    if not url:
        log("Nessun link iCal: lo si aggiunge dall'app in Impostazioni › Calendario FamilyWall. Salto.")
    else:
        r = requests.get(url, timeout=30, headers={"User-Agent": "DashboardCasa/1.0"})
        r.raise_for_status()
        adesso = ora_locale()
        dal = (adesso - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        al = dal + timedelta(days=GIORNI_AVANTI + 1)
        alias = dati.get("alias") or {}
        alias = {"M": alias.get("M") or [dati.get("nomi", {}).get("M", "Matteo")], "G": alias.get("G") or [dati.get("nomi", {}).get("G", "Gaia")]}
        eventi = eventi_da_ical(r.content, alias, dal, al)
        log(f"{len(eventi)} eventi tra {dal:%d.%m} e {al:%d.%m}")
        for e in eventi[:8]:
            log(f"  {e['inizio'][:16]} {e['titolo']} [{e['chi'] or '-'}]")
        if not args.prova:
            n = db.rpc("casa_sostituisci_eventi", p_dal=dal.isoformat(), p_al=al.isoformat(), p_eventi=eventi)
            log(f"scritti {n} eventi")
    if not args.prova:
        db.rpc("casa_pulizia")
        log("pulizia fatta")


if __name__ == "__main__":
    main()
