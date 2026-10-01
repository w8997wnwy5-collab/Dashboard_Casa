"""Dashboard Casa · copia il calendario di FamilyWall nel database (ogni 15 minuti).

Legge il link iCal salvato nell'app (Impostazioni › Calendario FamilyWall), espande gli eventi
ricorrenti delle prossime tre settimane, capisce di chi è ogni evento dalle parole scelte
nell'app e sostituisce gli eventi nel database. Fa anche un po' di pulizia (spesa presa da
più di 7 giorni, bigliettini vecchi) e lascia nell'app com'è andata (Impostazioni › Automazioni).

Se il link di FamilyWall non funziona, l'automazione resta verde con un avviso giallo (così GitHub
non manda una mail ogni 15 minuti) e l'errore compare nell'app.

Uso:  python scripts/calendario.py            (scrive nel database)
      python scripts/calendario.py --prova    (mostra soltanto cosa scriverebbe)
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta

import icalendar
import recurring_ical_events
import requests

from comune import ZURIGO, Supabase, avviso, esegui, log, ora_locale

GIORNI_AVANTI = 21


class ProblemaCalendario(Exception):
    """Un problema del link o del file di FamilyWall: si sistema dall'app, non da GitHub."""


def normalizza_link(link: str | None) -> str:
    url = (link or "").strip().strip("<>\"'")
    for schema in ("webcals://", "webcal://"):
        if url.lower().startswith(schema):
            url = "https://" + url[len(schema):]
    return url


def scarica(url: str) -> bytes:
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "DashboardCasa/1.0", "Accept": "text/calendar, */*"})
    except requests.RequestException as e:
        raise ProblemaCalendario(f"FamilyWall non risponde ({e.__class__.__name__}): riprovo al prossimo giro") from e
    if r.status_code in (401, 403):
        raise ProblemaCalendario(f"FamilyWall rifiuta il link ({r.status_code}): generatene uno nuovo e incollatelo nell'app")
    if r.status_code in (404, 410):
        raise ProblemaCalendario(f"il link iCal non esiste più ({r.status_code}): generatene uno nuovo in FamilyWall e incollatelo nell'app")
    if r.status_code >= 400:
        raise ProblemaCalendario(f"FamilyWall ha risposto con un errore ({r.status_code}): riprovo al prossimo giro")
    if b"BEGIN:VCALENDAR" not in r.content[:4096].upper():
        raise ProblemaCalendario("il link non porta a un calendario iCal: serve quello di «Genera URL iCal», non l'indirizzo di una pagina")
    return r.content


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


def _mezzanotte(dt: datetime) -> bool:
    return dt.hour == 0 and dt.minute == 0


def _quasi_mezzanotte(dt: datetime) -> bool:
    return dt.hour == 23 and dt.minute >= 59


def _giorno_zurigo(d: date) -> datetime:
    return datetime.combine(d, time(0), tzinfo=ZURIGO)


def _giornata_intera(ev, grezzo_ini, grezzo_fine, inizio: datetime, fine: datetime) -> tuple[datetime, datetime] | None:
    """Alcuni calendari scrivono gli eventi «tutto il giorno» come orari da mezzanotte a mezzanotte
    (a volte in UTC, che a Lugano diventano le 01:00 o le 02:00). Li riconosce e li rimette a giornata intera."""
    if str(ev.get("X-MICROSOFT-CDO-ALLDAYEVENT", "")).upper() == "TRUE":
        ultimo = fine - timedelta(seconds=1) if fine > inizio else inizio
        return _giorno_zurigo(inizio.date()), _giorno_zurigo(ultimo.date() + timedelta(days=1))
    if fine - inizio < timedelta(hours=23, minutes=58):
        return None
    coppie = [(inizio, fine)]  # da mezzanotte a mezzanotte, ora di Lugano
    if (isinstance(grezzo_ini, datetime) and isinstance(grezzo_fine, datetime) and grezzo_ini.tzinfo is not None
            and grezzo_fine.tzinfo is not None and grezzo_ini.utcoffset() == timedelta(0)):
        coppie.append((grezzo_ini, grezzo_fine.astimezone(grezzo_ini.tzinfo)))  # da mezzanotte a mezzanotte in UTC
    for a, b in coppie:
        if _mezzanotte(a) and (_mezzanotte(b) or _quasi_mezzanotte(b)):
            ultimo = b.date() + timedelta(days=1) if _quasi_mezzanotte(b) else b.date()
            return _giorno_zurigo(a.date()), _giorno_zurigo(ultimo)
    return None


def _occorrenze(cal, dal: datetime, al: datetime) -> list:
    """Espande le ricorrenze. Se un evento difettoso blocca tutto, legge gli eventi uno per uno e salta solo quello."""
    try:
        return list(recurring_ical_events.of(cal, skip_bad_series=True).between(dal, al))
    except Exception as e:  # noqa: BLE001
        log(f"nel calendario c'è qualche evento difettoso ({e.__class__.__name__}): li leggo uno per uno")
    fusi = [c for c in cal.subcomponents if c.name == "VTIMEZONE"]
    gruppi: dict[str, list] = {}
    for c in cal.subcomponents:
        if c.name == "VEVENT":
            gruppi.setdefault(str(c.get("UID") or id(c)), []).append(c)
    out = []
    for uid, parti in gruppi.items():
        mini = icalendar.Calendar()
        for c in fusi + parti:
            mini.add_component(c)
        try:
            out.extend(recurring_ical_events.of(mini).between(dal, al))
        except Exception as e:  # noqa: BLE001
            log(f"evento saltato ({_testo(parti[0].get('SUMMARY'))[:40] or uid[:40]}): {e.__class__.__name__}")
    return out


def eventi_da_ical(ics: bytes, alias: dict, dal: datetime, al: datetime) -> list[dict]:
    try:
        cal = icalendar.Calendar.from_ical(ics)
    except Exception as e:  # noqa: BLE001
        raise ProblemaCalendario(f"il file di FamilyWall non si legge ({e.__class__.__name__}: {str(e)[:120]})") from e
    for c in list(cal.subcomponents):
        if c.name == "VEVENT" and c.get("DTSTART") is None:
            log(f"evento senza data saltato: {_testo(c.get('SUMMARY'))[:40] or 'senza titolo'}")
            cal.subcomponents.remove(c)
    occorrenze = _occorrenze(cal, dal, al)
    out, visti = [], set()
    for ev in occorrenze:
        try:
            if str(ev.get("STATUS", "")).upper() == "CANCELLED" or ev.get("DTSTART") is None:
                continue
            grezzo_ini = ev["DTSTART"].dt
            inizio, tutto = _in_zurigo(grezzo_ini)
            if ev.get("DTEND") is not None:
                grezzo_fine = ev["DTEND"].dt
                fine, _ = _in_zurigo(grezzo_fine)
            elif ev.get("DURATION") is not None:
                grezzo_fine = grezzo_ini + ev["DURATION"].dt
                fine = inizio + ev["DURATION"].dt
            else:
                grezzo_fine = None
                fine = inizio + (timedelta(days=1) if tutto else timedelta(hours=1))
            if fine < inizio:
                fine = inizio
            if not tutto:
                intera = _giornata_intera(ev, grezzo_ini, grezzo_fine, inizio, fine)
                if intera:
                    (inizio, fine), tutto = intera, True
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
                "luogo": (_testo(ev.get("LOCATION")).strip()[:200] or None),
                "chi": chi_e(ev, alias),
            })
        except Exception as e:  # noqa: BLE001
            log(f"evento saltato ({_testo(ev.get('SUMMARY'))[:40] or 'senza titolo'}): {e}")
    out.sort(key=lambda e: e["inizio"])
    return out


def _riga(e: dict) -> str:
    giorno = f"{e['inizio'][8:10]}.{e['inizio'][5:7]}"
    return f"{giorno} {'tutto il giorno' if e['tutto_il_giorno'] else e['inizio'][11:16]}  {e['titolo']}  [{e['chi'] or '-'}]"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prova", action="store_true", help="non scrive nel database")
    args = ap.parse_args()

    db = Supabase()
    dati, coll = db.config()
    adesso = ora_locale()
    stato: dict = {"quando": adesso.isoformat(timespec="seconds")}
    url = normalizza_link(coll.get("ical_url"))
    if not url:
        log("Nessun link iCal: lo si aggiunge dall'app in Impostazioni › Calendario FamilyWall. Salto.")
        stato.update(ok=False, errore="manca il link iCal di FamilyWall")
    elif not url.lower().startswith(("https://", "http://")):
        stato.update(ok=False, errore="il link iCal deve iniziare con https:// oppure webcal://")
        avviso(f"Calendario: {stato['errore']}")
    else:
        dal = (adesso - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        al = dal + timedelta(days=GIORNI_AVANTI + 1)
        alias = dati.get("alias") or {}
        nomi = dati.get("nomi") or {}
        alias = {"M": alias.get("M") or [nomi.get("M", "Matteo")], "G": alias.get("G") or [nomi.get("G", "Gaia")]}
        try:
            eventi = eventi_da_ical(scarica(url), alias, dal, al)
        except ProblemaCalendario as e:
            log(f"Calendario non letto: {e}")
            avviso(f"Calendario: {e}")
            stato.update(ok=False, errore=str(e))
        else:
            log(f"{len(eventi)} eventi tra {dal:%d.%m} e {al:%d.%m}:")
            for e in eventi[:15]:
                log("  " + _riga(e))
            if len(eventi) > 15:
                log(f"  … e altri {len(eventi) - 15}")
            if not eventi:
                log("Nessun evento nelle prossime tre settimane. Se ne avete appena creato uno, controllate che sia nel "
                    "calendario di cui avete copiato il link iCal (quello con il nome del cerchio).")
            if not args.prova:
                n = db.rpc("casa_sostituisci_eventi", p_dal=dal.isoformat(), p_al=al.isoformat(), p_eventi=eventi)
                log(f"scritti {n} eventi nel database")
            stato.update(ok=True, eventi=len(eventi))
    if not args.prova:
        db.rpc("casa_pulizia")
        log("pulizia fatta")
        db.segna_stato("calendario", stato)


if __name__ == "__main__":
    esegui(main)
