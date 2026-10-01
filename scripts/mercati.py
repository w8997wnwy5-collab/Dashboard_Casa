"""Dashboard Casa · cambio EUR/CHF e titolo Interroll in data/mercati.json.

Il file è pubblico (sta su GitHub Pages) e contiene solo dati di mercato.
Se una fonte non risponde, tiene l'ultimo valore buono.
"""
from __future__ import annotations

import json
import pathlib
from datetime import date, timedelta

import requests

from comune import log, ora_locale

FILE = pathlib.Path(__file__).resolve().parent.parent / "data" / "mercati.json"


def cambio() -> tuple[float, float | None] | None:
    da = (date.today() - timedelta(days=10)).isoformat()
    try:
        j = requests.get(f"https://api.frankfurter.dev/v1/{da}..?base=EUR&symbols=CHF", timeout=30).json()
        serie = [(d, v["CHF"]) for d, v in sorted((j.get("rates") or {}).items()) if "CHF" in v]
        if serie:
            ultimo = serie[-1][1]
            prima = serie[-2][1] if len(serie) > 1 else None
            return round(ultimo, 4), (round((ultimo / prima - 1) * 100, 2) if prima else None)
    except Exception as e:  # noqa: BLE001
        log("cambio non disponibile (serie):", e)
    try:
        j = requests.get("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CHF", timeout=30).json()
        return round(j["rates"]["CHF"], 4), None
    except Exception as e:  # noqa: BLE001
        log("cambio non disponibile:", e)
        return None


def interroll() -> tuple[float, float | None] | None:
    try:
        import yfinance as yf  # import qui: se manca la libreria il resto funziona lo stesso
        h = yf.Ticker("INRN.SW").history(period="7d", interval="1d")
        chiusure = [float(x) for x in h["Close"].dropna().tolist()]
        if chiusure:
            ultimo = chiusure[-1]
            prima = chiusure[-2] if len(chiusure) > 1 else None
            return round(ultimo, 1), (round((ultimo / prima - 1) * 100, 2) if prima else None)
    except Exception as e:  # noqa: BLE001
        log("Interroll non disponibile:", e)
    return None


def main() -> None:
    vecchio = {}
    if FILE.exists():
        try:
            vecchio = json.loads(FILE.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            vecchio = {}
    out = {
        "aggiornato": vecchio.get("aggiornato"),
        "eur_chf": vecchio.get("eur_chf"), "eur_chf_var": vecchio.get("eur_chf_var"),
        "interroll": vecchio.get("interroll") or {"prezzo": None, "var": None},
    }
    c = cambio()
    if c:
        out["eur_chf"], out["eur_chf_var"] = c
    i = interroll()
    if i:
        out["interroll"] = {"prezzo": i[0], "var": i[1]}
    if c or i:
        out["aggiornato"] = ora_locale().isoformat(timespec="minutes")
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
