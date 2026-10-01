"""Dashboard Casa · funzioni comuni alle GitHub Action (Supabase, fuso orario, meteo, traffico)."""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import traceback
from datetime import date, datetime, timedelta
from typing import Callable, NoReturn
from zoneinfo import ZoneInfo

import requests

ZURIGO = ZoneInfo("Europe/Zurich")
TIMEOUT = 30


def ora_locale() -> datetime:
    return datetime.now(ZURIGO)


def log(*parti) -> None:
    print("·", *parti, flush=True)


def _annotazione(testo: str) -> str:
    return str(testo).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def avviso(testo: str) -> None:
    """Avviso giallo nel riepilogo della GitHub Action (l'automazione resta verde)."""
    print(f"::warning title=Dashboard Casa::{_annotazione(testo)}", flush=True)


def errore(testo: str) -> NoReturn:
    """Errore rosso nel riepilogo della GitHub Action, con una frase che dice cosa fare."""
    print(f"::error title=Dashboard Casa::{_annotazione(testo)}", flush=True)
    sys.exit(f"ERRORE: {testo}")


def esegui(principale: Callable[[], None]) -> None:
    """Lancia lo script: un problema imprevisto diventa un errore leggibile invece di un traceback muto."""
    try:
        principale()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        errore(str(e))


def _ruolo_jwt(chiave: str) -> str:
    try:
        corpo = chiave.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(corpo + "=" * (-len(corpo) % 4))).get("role", "")
    except Exception:  # noqa: BLE001
        return ""


# ---------------------------------------------------------------------------
# Supabase (chiave segreta: solo nelle GitHub Action, mai nell'app)
# ---------------------------------------------------------------------------
class Supabase:
    def __init__(self, url: str | None = None, chiave: str | None = None):
        url = (url or os.environ.get("SUPABASE_URL", "")).strip().strip("\"'")
        chiave = (chiave or os.environ.get("SUPABASE_SECRET_KEY", "")).strip().strip("\"'")
        if not url or not chiave:
            errore("Mancano i secret SUPABASE_URL e SUPABASE_SECRET_KEY: GitHub › Settings › Secrets and variables › Actions › New repository secret.")
        url = re.sub(r"/+$", "", url)
        url = re.sub(r"/(rest|auth)/v1.*$", "", url)  # se è stato incollato l'indirizzo dell'API e non quello del progetto
        pannello = re.search(r"supabase\.com/dashboard/project/([a-z0-9]{20})", url)
        if pannello:  # incollato l'indirizzo del pannello di Supabase: basta il codice del progetto
            url = pannello.group(1)
        if re.fullmatch(r"[a-z0-9]{20}", url):  # incollato solo il codice del progetto
            url = f"https://{url}.supabase.co"
        if not url.startswith("https://"):
            errore(f"SUPABASE_URL non sembra giusto («{url[:40]}»): deve essere l'indirizzo del progetto, tipo https://abcd1234.supabase.co")
        if chiave.startswith("sb_publishable_"):
            errore("In SUPABASE_SECRET_KEY c'è la chiave publishable: qui serve quella secret (sb_secret_…), da Supabase › Project Settings › API Keys.")
        if chiave.startswith("eyJ") and _ruolo_jwt(chiave) == "anon":
            errore("In SUPABASE_SECRET_KEY c'è la vecchia chiave anon: qui serve la service_role (oppure una sb_secret_…).")
        self.url, self.chiave = url, chiave

    @property
    def _headers(self) -> dict:
        h = {"apikey": self.chiave, "Content-Type": "application/json"}
        # Le vecchie chiavi (service_role) sono JWT e vanno anche in Authorization; le nuove sb_secret_ no.
        if self.chiave.startswith("eyJ"):
            h["Authorization"] = f"Bearer {self.chiave}"
        return h

    @staticmethod
    def _problema(cosa: str, r) -> RuntimeError:
        if r.status_code == 401:
            return RuntimeError(f"{cosa}: Supabase rifiuta la chiave (401). Controllate il secret SUPABASE_SECRET_KEY (deve essere la chiave secret di questo progetto).")
        if r.status_code == 404:
            return RuntimeError(f"{cosa}: non trovato (404). SUPABASE_URL è il progetto giusto? Avete lanciato supabase/schema.sql? {r.text[:200]}")
        return RuntimeError(f"{cosa} ({r.status_code}): {r.text[:300]}")

    def leggi(self, tabella: str, **filtri) -> list:
        r = requests.get(f"{self.url}/rest/v1/{tabella}", headers=self._headers, params=filtri, timeout=TIMEOUT)
        if r.status_code >= 400:
            raise self._problema(f"Lettura di {tabella} non riuscita", r)
        return r.json()

    def inserisci(self, tabella: str, righe) -> None:
        h = {**self._headers, "Prefer": "return=minimal"}
        r = requests.post(f"{self.url}/rest/v1/{tabella}", headers=h, data=json.dumps(righe), timeout=TIMEOUT)
        if r.status_code >= 400:
            raise self._problema(f"Scrittura su {tabella} non riuscita", r)

    def rpc(self, funzione: str, **parametri):
        r = requests.post(f"{self.url}/rest/v1/rpc/{funzione}", headers=self._headers, data=json.dumps(parametri), timeout=TIMEOUT)
        if r.status_code >= 400:
            raise self._problema(f"Funzione {funzione} non riuscita", r)
        return r.json() if r.text else None

    def config(self) -> tuple[dict, dict]:
        righe = self.leggi("casa_config", id="eq.1", select="dati,collegamenti")
        if not righe:
            errore("Nel database manca la configurazione: avete lanciato supabase/schema.sql in questo progetto Supabase?")
        return righe[0].get("dati") or {}, righe[0].get("collegamenti") or {}

    def segna_stato(self, nome: str, valore: dict) -> bool:
        """Scrive com'è andata un'automazione in casa_config.collegamenti.automazioni: l'app lo mostra nelle impostazioni.

        Scrive solo se nessuno ha toccato le impostazioni nel frattempo (controllo su aggiornato_il),
        così non cancella mai una modifica fatta dall'app nello stesso istante. Non blocca mai l'automazione.
        """
        try:
            for _ in range(3):
                righe = self.leggi("casa_config", id="eq.1", select="collegamenti,aggiornato_il")
                if not righe:
                    return False
                coll = dict(righe[0].get("collegamenti") or {})
                auto = dict(coll.get("automazioni") or {})
                auto[nome] = valore
                coll["automazioni"] = auto
                r = requests.patch(f"{self.url}/rest/v1/casa_config", headers={**self._headers, "Prefer": "return=representation"},
                                   params={"id": "eq.1", "aggiornato_il": f"eq.{righe[0]['aggiornato_il']}", "select": "id"},
                                   data=json.dumps({"collegamenti": coll}), timeout=TIMEOUT)
                if r.status_code >= 400:
                    raise self._problema("Stato non salvato", r)
                if r.json():
                    return True
            log("stato non salvato: le impostazioni cambiavano proprio adesso, ci riprovo al prossimo giro")
        except Exception as e:  # noqa: BLE001
            log("stato non salvato:", e)
        return False


# ---------------------------------------------------------------------------
# Meteo: Open-Meteo con il modello di MeteoSvizzera (ICON-CH)
# ---------------------------------------------------------------------------
def meteo(lat: float, lon: float, giorni: int = 3) -> dict:
    """Ritorna {"YYYY-MM-DD": {"t": [24], "p": [24], "c": [24]}} in ora locale."""
    base = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m,precipitation_probability,weather_code"
        f"&timezone=Europe%2FZurich&forecast_days={giorni}"
    )
    for url in (base + "&models=meteoswiss_icon_seamless", base):
        try:
            j = requests.get(url, timeout=TIMEOUT).json()
            ore = j.get("hourly") or {}
            if any(v is not None for v in ore.get("temperature_2m", [])):
                break
        except Exception as e:  # noqa: BLE001
            log("meteo non raggiungibile:", e)
            ore = {}
    out: dict = {}
    for i, t in enumerate(ore.get("time", [])):
        g = out.setdefault(t[:10], {"t": [None] * 24, "p": [None] * 24, "c": [None] * 24})
        h = int(t[11:13])
        g["t"][h] = ore["temperature_2m"][i]
        g["p"][h] = (ore.get("precipitation_probability") or [None] * len(ore["time"]))[i]
        g["c"][h] = (ore.get("weather_code") or [None] * len(ore["time"]))[i]
    for g in out.values():
        for k in ("t", "p", "c"):
            prec = next((x for x in g[k] if x is not None), 0)
            for h in range(24):
                if g[k][h] is None:
                    g[k][h] = prec
                prec = g[k][h]
    return out


CODICI = {0: "sereno", 1: "quasi sereno", 2: "poco nuvoloso", 3: "nuvoloso", 45: "nebbia", 48: "nebbia gelata",
          51: "pioviggine", 53: "pioviggine", 55: "pioviggine fitta", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte",
          66: "pioggia gelata", 67: "pioggia gelata", 71: "neve debole", 73: "neve", 75: "neve forte", 77: "nevischio",
          80: "rovesci", 81: "rovesci", 82: "rovesci forti", 85: "rovesci di neve", 86: "rovesci di neve",
          95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine"}


def riassunto_meteo(g: dict | None) -> dict | None:
    if not g:
        return None
    ore_pioggia = [h for h in range(6, 23) if (g["p"][h] or 0) >= 50]
    return {
        "min": round(min(g["t"][6:23])), "max": round(max(g["t"][6:23])),
        "alba_min": round(min(g["t"][5:9])),
        "cielo_mattina": CODICI.get(g["c"][8], "variabile"), "cielo_pomeriggio": CODICI.get(g["c"][15], "variabile"),
        "pioggia_dalle": ore_pioggia[0] if ore_pioggia else None,
        "pioggia_max_percento": max(g["p"][6:23]),
        "brina_all_alba": min(g["t"][5:9]) <= 1,
    }


# ---------------------------------------------------------------------------
# Traffico: TomTom (partenza consigliata per arrivare in ufficio)
# ---------------------------------------------------------------------------
def partenza_consigliata(chiave: str, casa: dict, lavoro: dict, giorno: date) -> dict | None:
    if not chiave or not casa.get("lat") or not lavoro.get("lat"):
        return None
    h, m = (int(x) for x in str(lavoro.get("arrivo", "08:30")).split(":"))
    arrivo = datetime(giorno.year, giorno.month, giorno.day, h, m, tzinfo=ZURIGO)
    url = (f"https://api.tomtom.com/routing/1/calculateRoute/{casa['lat']},{casa['lon']}:{lavoro['lat']},{lavoro['lon']}/json"
           f"?key={chiave}&traffic=true&travelMode=car&routeType=fastest&arriveAt={requests.utils.quote(arrivo.isoformat(timespec='seconds'))}")
    try:
        s = requests.get(url, timeout=TIMEOUT).json()["routes"][0]["summary"]
    except Exception as e:  # noqa: BLE001
        log("traffico non raggiungibile:", e)
        return None
    partenza = datetime.fromisoformat(s["departureTime"]).astimezone(ZURIGO)
    return {"minuti": round(s["travelTimeInSeconds"] / 60), "partenza": partenza}


# ---------------------------------------------------------------------------
# Festivi ufficiali in Ticino
# ---------------------------------------------------------------------------
def _pasqua(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    mese = (h + l_ - 7 * m + 114) // 31
    giorno = (h + l_ - 7 * m + 114) % 31 + 1
    return date(y, mese, giorno)


def festivo(d: date) -> str | None:
    fissi = {(1, 1): "Capodanno", (1, 6): "Epifania", (3, 19): "San Giuseppe", (5, 1): "Festa del lavoro",
             (6, 29): "Santi Pietro e Paolo", (8, 1): "Festa nazionale", (8, 15): "Assunzione", (11, 1): "Ognissanti",
             (12, 8): "Immacolata", (12, 25): "Natale", (12, 26): "Santo Stefano"}
    if (d.month, d.day) in fissi:
        return fissi[(d.month, d.day)]
    p = _pasqua(d.year)
    mobili = {p + timedelta(days=1): "Lunedì dell'Angelo", p + timedelta(days=39): "Ascensione",
              p + timedelta(days=50): "Lunedì di Pentecoste", p + timedelta(days=60): "Corpus Domini"}
    return mobili.get(d)


def feriale(d: date) -> bool:
    return d.weekday() < 5 and not festivo(d)


GIORNI = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def data_lunga(d: date) -> str:
    return f"{GIORNI[d.weekday()]} {d.day} {MESI[d.month - 1]}"
