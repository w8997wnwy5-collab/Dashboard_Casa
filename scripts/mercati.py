"""Dashboard Casa · cambio EUR/CHF e titolo Interroll in data/mercati.json.

Il file è pubblico (sta su GitHub Pages) e contiene solo dati di mercato: l'ultimo valore,
la variazione sul giorno prima e l'andamento delle ultime settimane per i grafici del tablet.
Se una fonte non risponde, tiene l'ultimo valore buono.
"""
from __future__ import annotations

import json
import pathlib
from datetime import date, timedelta

import requests

from comune import log, ora_locale

FILE = pathlib.Path(__file__).resolve().parent.parent / "data" / "mercati.json"
PUNTI = 30  # quanti giorni di borsa nei grafici


def _variazione(serie: list) -> float | None:
    if len(serie) < 2 or not serie[-2][1]:
        return None
    return round((serie[-1][1] / serie[-2][1] - 1) * 100, 2)


def cambio() -> dict | None:
    """{"ultimo", "var", "serie": [[data, valore], …]} dalla BCE (via frankfurter.dev)."""
    da = (date.today() - timedelta(days=50)).isoformat()
    try:
        j = requests.get(f"https://api.frankfurter.dev/v1/{da}..?base=EUR&symbols=CHF", timeout=30).json()
        serie = [[d, round(v["CHF"], 4)] for d, v in sorted((j.get("rates") or {}).items()) if "CHF" in v][-PUNTI:]
        if serie:
            return {"ultimo": serie[-1][1], "var": _variazione(serie), "serie": serie}
    except Exception as e:  # noqa: BLE001
        log("cambio non disponibile (serie):", e)
    try:
        j = requests.get("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=CHF", timeout=30).json()
        return {"ultimo": round(j["rates"]["CHF"], 4), "var": None, "serie": None}
    except Exception as e:  # noqa: BLE001
        log("cambio non disponibile:", e)
        return None


def interroll() -> dict | None:
    """Chiusure giornaliere di Interroll (INRN.SW) dalla borsa svizzera, via Yahoo Finance."""
    try:
        import yfinance as yf  # import qui: se manca la libreria il resto funziona lo stesso
        h = yf.Ticker("INRN.SW").history(period="3mo", interval="1d")
        chiusure = h["Close"].dropna()
        serie = [[i.strftime("%Y-%m-%d"), round(float(v), 1)] for i, v in chiusure.items()][-PUNTI:]
        if serie:
            return {"ultimo": serie[-1][1], "var": _variazione(serie), "serie": serie}
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
    serie = dict(vecchio.get("serie") or {})
    out = {
        "aggiornato": vecchio.get("aggiornato"),
        "eur_chf": vecchio.get("eur_chf"), "eur_chf_var": vecchio.get("eur_chf_var"),
        "interroll": vecchio.get("interroll") or {"prezzo": None, "var": None},
    }
    c = cambio()
    if c:
        out["eur_chf"], out["eur_chf_var"] = c["ultimo"], c["var"]
        if c["serie"]:
            serie["eur_chf"] = c["serie"]
    i = interroll()
    if i:
        out["interroll"] = {"prezzo": i["ultimo"], "var": i["var"]}
        serie["interroll"] = i["serie"]
    if c or i:
        out["aggiornato"] = ora_locale().isoformat(timespec="minutes")
    out["serie"] = serie
    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log(json.dumps({k: v for k, v in out.items() if k != "serie"}, ensure_ascii=False),
        "· punti nei grafici:", {k: len(v or []) for k, v in serie.items()})


if __name__ == "__main__":
    main()
