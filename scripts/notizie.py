"""Dashboard Casa · notizie del mattino (RSI e ANSA) e curiosità del giorno (Wikipedia).

Prende solo titoli, sommari e link dai feed pubblici: il brief ne sceglie una per zona e
rimanda all'articolo originale. Se una fonte non risponde la prima pagina esce senza quella
zona: il brief non si blocca mai per colpa delle notizie.
"""
from __future__ import annotations

import html
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

from comune import log

FONTI = [
    {"zona": "Ticino", "fonte": "RSI", "url": "https://www.rsi.ch/info/ticino-grigioni-e-insubria/?f=rss"},
    {"zona": "Italia", "fonte": "ANSA", "url": "https://www.ansa.it/sito/ansait_rss.xml"},
    {"zona": "Mondo", "fonte": "RSI", "url": "https://www.rsi.ch/info/mondo/?f=rss"},
]
ZONE = [f["zona"] for f in FONTI]
UA = {"User-Agent": "Mozilla/5.0 (compatible; DashboardCasa/4.0; brief di casa per uso personale)"}


def taglia(testo, massimo: int) -> str:
    """Testo pulito su una riga, tagliato a fine parola se è troppo lungo."""
    t = re.sub(r"\s+", " ", str(testo or "")).strip()
    if len(t) > massimo:
        pezzo = t[: massimo - 1]
        if t[massimo - 1] != " " and " " in pezzo:  # a metà parola: si torna all'ultima intera
            pezzo = pezzo.rsplit(" ", 1)[0]
        t = pezzo.rstrip(",;:.–- ") + "…"
    return t


def pulisci(testo: str | None, massimo: int = 400) -> str:
    """Toglie l'HTML dei feed (immagini, paragrafi) e le entità."""
    t = re.sub(r"<[^>]+>", " ", testo or "")
    return taglia(html.unescape(html.unescape(t)), massimo)


def _nome(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _data(testo: str | None) -> datetime | None:
    if not testo:
        return None
    testo = testo.strip()
    try:
        d = parsedate_to_datetime(testo)
    except (TypeError, ValueError, IndexError):
        try:
            d = datetime.fromisoformat(testo.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def leggi_feed(xml: bytes | str, adesso: datetime, ore: int = 36, quante: int = 6) -> list[dict]:
    """Voci di un feed RSS 2.0, RSS 1.0 o Atom: le più recenti, uscite nelle ultime `ore`."""
    voci = []
    for it in ET.fromstring(xml).iter():
        if _nome(it.tag) not in ("item", "entry"):
            continue
        figli: dict[str, list] = {}
        for c in it:
            figli.setdefault(_nome(c.tag), []).append(c)

        def testo(*nomi):
            for n in nomi:
                for c in figli.get(n, []):
                    if c.text and c.text.strip():
                        return c.text
            return None

        link = (testo("link") or next((c.get("href") for c in figli.get("link", []) if c.get("href") and c.get("rel", "alternate") == "alternate"), "") or "").strip()
        link = re.sub(r"^http://", "https://", link)
        titolo = pulisci(testo("title"), 160)
        if not titolo or not re.match(r"^https://[^\s\"'<>]+$", link):
            continue
        quando = _data(testo("pubDate", "published", "updated", "date"))
        if quando and adesso - quando > timedelta(hours=ore):
            continue
        voci.append({"titolo": titolo, "sommario": pulisci(testo("description", "summary", "encoded"), 320), "link": link, "quando": quando})
    voci.sort(key=lambda v: v["quando"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return voci[:quante]


def notizie(adesso: datetime) -> dict[str, list[dict]]:
    """{"Ticino": [...], "Italia": [...], "Mondo": [...]}; ogni voce ha un id breve (T1, I2, M3…) per Claude."""
    out: dict[str, list[dict]] = {}
    for f in FONTI:
        try:
            r = requests.get(f["url"], headers=UA, timeout=20)
            r.raise_for_status()
            voci = leggi_feed(r.content, adesso)
        except Exception as e:  # noqa: BLE001
            log(f"notizie {f['zona']} ({f['fonte']}) non disponibili:", e)
            voci = []
        out[f["zona"]] = [{**v, "id": f"{f['zona'][0]}{i + 1}", "zona": f["zona"], "fonte": f["fonte"]} for i, v in enumerate(voci)]
        log(f"notizie {f['zona']}: {len(voci)}")
    return out


def curiosita(giorno: date) -> dict:
    """Fatti accaduti in questo giorno (prima Wikipedia in italiano, se ha il feed, poi in inglese)
    e le feste del giorno, dove ci sono i santi del calendario cristiano."""
    out: dict = {"fatti": [], "lingua": None, "feste": []}
    for lingua in ("it", "en"):
        try:
            r = requests.get(f"https://{lingua}.wikipedia.org/api/rest_v1/feed/onthisday/all/{giorno.month:02d}/{giorno.day:02d}", headers=UA, timeout=25)
            if r.status_code != 200:
                log(f"Wikipedia {lingua}: {r.status_code}")
                continue
            j = r.json()
        except Exception as e:  # noqa: BLE001
            log(f"Wikipedia {lingua} non disponibile:", e)
            continue
        fatti = [{"anno": x["year"], "testo": pulisci(x.get("text"), 240)} for x in (j.get("selected") or j.get("events") or [])
                 if isinstance(x.get("year"), int) and x.get("text")]
        if fatti and not out["fatti"]:
            out["fatti"], out["lingua"] = fatti[:12], lingua
        feste = [pulisci(h.get("text"), 200) for h in (j.get("holidays") or []) if h.get("text")]
        if feste and not out["feste"]:
            out["feste"] = feste[:20]
        if out["fatti"] and out["feste"]:
            break
    log(f"curiosità: {len(out['fatti'])} fatti ({out['lingua']}), {len(out['feste'])} feste")
    return out


def per_claude(cand: dict[str, list[dict]]) -> dict:
    """Le notizie come le vede Claude: id, titolo e sommario (i link restano qui)."""
    return {zona: [{"id": v["id"], "titolo": v["titolo"], "sommario": v["sommario"]} for v in voci] for zona, voci in cand.items() if voci}


SANTO = re.compile(r"^(San|Santa|Santo|Sant['’]|Santi|Sante|Beato|Beata|Beati)\b")
PICCOLE = {"di", "da", "de", "del", "della", "dei", "degli", "e", "il", "la", "lo", "le", "the", "of", "and", "saint", "san", "santa", "santo", "santi"}


def _parole(testo: str, minimo: int) -> list[str]:
    """Parole senza accenti e con la grafia avvicinata tra italiano e inglese (Chromatius ~ Cromazio, Stephen ~ Stefano)."""
    t = unicodedata.normalize("NFKD", str(testo or "")).encode("ascii", "ignore").decode().lower()
    parole = [w for w in re.findall(r"[a-z]+", t) if len(w) >= minimo and w not in PICCOLE]
    for a, b in (("ph", "f"), ("th", "t"), ("ch", "c"), ("k", "c"), ("y", "i"), ("x", "s")):
        parole = [w.replace(a, b) for w in parole]
    return parole


def _somiglia(a: str, b: str, lettere: int, minimo: int) -> bool:
    """Almeno una parola in comune tra le due frasi (stesse prime lettere: Napoleone ~ Napoleon, Bibiana ~ Bibiana)."""
    radici = {w[:lettere] for w in _parole(b, minimo)}
    return any(w[:lettere] in radici for w in _parole(a, minimo))


def pagina(out: dict | None, cand: dict[str, list[dict]], cur: dict) -> dict:
    """La prima pagina da salvare: quello che ha scelto Claude, controllato, più le zone che ha saltato.
    I link vengono sempre dai feed, mai dal testo di Claude."""
    p: dict = {"titolo": None, "notizie": [], "curiosita": {"santo": None, "accadde": None}, "idea": None}
    per_id = {v["id"]: v for voci in cand.values() for v in voci}
    scelte: dict[str, dict] = {}
    if isinstance(out, dict):
        p["titolo"] = taglia(out.get("titolo"), 70) or None
        notizie_claude = out.get("notizie") if isinstance(out.get("notizie"), list) else []
        for n in notizie_claude:
            if not isinstance(n, dict):
                continue
            v = per_id.get(str(n.get("id", "")).strip().upper())
            if not v or v["zona"] in scelte:
                continue
            riassunto = taglia(n.get("riassunto"), 170) if v["sommario"] else ""
            scelte[v["zona"]] = {"zona": v["zona"], "fonte": v["fonte"], "link": v["link"],
                                 "titolo": taglia(n.get("titolo"), 110) or v["titolo"],
                                 "riassunto": riassunto or taglia(v["sommario"], 150) or None}
        c = out.get("curiosita") if isinstance(out.get("curiosita"), dict) else {}
        # il santo deve comparire tra le feste del giorno; il fatto deve essere uno di quelli dati (stesso anno, una parola in comune)
        santo = taglia(c.get("santo"), 40)
        nome = SANTO.sub("", santo).strip()
        if santo and nome and SANTO.match(santo) and _somiglia(nome, " ".join(cur.get("feste", [])), 3, 3):
            p["curiosita"]["santo"] = santo
        accadde = taglia(c.get("accadde"), 170)
        anno = re.search(r"\d{1,4}", accadde)
        fatti = [f for f in cur.get("fatti", []) if anno and abs(int(f["anno"])) == int(anno.group())]
        if accadde and any(_somiglia(accadde.replace(anno.group(), " "), f["testo"], 4, 5) for f in fatti):
            p["curiosita"]["accadde"] = accadde
        p["idea"] = taglia(out.get("idea"), 110) or None
    for zona in ZONE:  # zone saltate (o brief senza Claude): la notizia più recente di quel feed
        if zona not in scelte and cand.get(zona):
            v = cand[zona][0]
            scelte[zona] = {"zona": zona, "fonte": v["fonte"], "link": v["link"], "titolo": v["titolo"], "riassunto": taglia(v["sommario"], 150) or None}
    p["notizie"] = [scelte[z] for z in ZONE if z in scelte]
    if not p["curiosita"]["accadde"] and cur.get("lingua") == "it" and cur.get("fatti"):
        f = cur["fatti"][0]
        p["curiosita"]["accadde"] = taglia(f"Nel {f['anno']}, {f['testo'][:1].lower()}{f['testo'][1:]}", 170)
    return p
