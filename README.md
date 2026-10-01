# Dashboard Casa

La dashboard di casa di Matteo e Gaia: gira sull’iPad in cucina e, nella versione per telefono, sugli iPhone.
Meteo che serve, partenza per Interroll con il traffico, calendario di FamilyWall, brief scritto da Claude
ogni mattina e ogni sera, lista della spesa con franchigia, faccende a punti, spese di casa con il saldo tra voi,
cambio e titolo Interroll, ricorrenze e countdown. Si aggiunge tutto anche a voce, con Siri.

- **App**: pagina statica su GitHub Pages (questo repository).
- **Dati condivisi**: Supabase (piano gratuito), protetti da regole di accesso: li vedono solo i vostri tre account.
- **Automazioni**: tre GitHub Action (calendario ogni 15 minuti, brief alle 06:10 e alle 17:55, mercati ogni ora nei giorni feriali).
- **Costo**: 0 CHF al mese, più pochi centesimi per il brief con Claude (facoltativo).

Per provarla subito con dati di esempio: `https://w8997wnwy5-collab.github.io/Dashboard_Casa/?esempio`

---

## Cosa comprare

| Cosa | A cosa serve | Prezzo indicativo |
|---|---|---|
| Supporto adesivo per tablet 10" (es. Novus MY tab W, versione da incollare) | Niente fori. Solo su superfici lisce (piastrelle, vetro, pittura liscia): sul muro ruvido non tiene | 30–60 CHF |
| Cavo Lightning da 2 m e canalina adesiva | iPad sempre in carica, cavo nascosto | 20–35 CHF |
| Presa myStrom Energy Control Switch (spina svizzera), facoltativa | Tiene la batteria tra 30% e 80% | ~32 CHF |

L’alimentatore da 20 W dell’iPad va bene.

---

## 1. Database su Supabase (10 minuti)

1. Su [supabase.com](https://supabase.com) create un progetto nuovo (per esempio `dashboard-casa`), regione europea.
2. **SQL Editor › New query**: incollate tutto `supabase/schema.sql` e premete **Run**.
3. **Authentication › Sign In / Providers**: spegnete *Allow new users to sign up*. Gli account li create voi.
4. **Authentication › Users › Add user › Create new user** (con *Auto Confirm User*): uno per Matteo, uno per Gaia e uno per il tablet (per esempio `tablet@…` con una password lunga).
5. **SQL Editor**: in fondo a `schema.sql` c’è il blocco *Membri della casa*. Toglietegli i `--`, mettete le tre email vere e premete **Run**.
6. **Project Settings › API Keys**: vi servono l’**URL del progetto**, la chiave **publishable** (`sb_publishable_…`, pubblica) e la chiave **secret** (`sb_secret_…`, segreta: solo per GitHub).
   Se il progetto mostra ancora le vecchie chiavi, vanno bene anche `anon` (pubblica) e `service_role` (segreta).

## 2. GitHub (10 minuti)

1. Nel repository **Dashboard_Casa**: *Add file › Upload files*, trascinate tutto il contenuto di questa cartella (compresa `.github`) e fate *Commit*.
   **Attenzione:** su Mac la cartella `.github` è nascosta (nel Finder la mostrate con **Cmd + Maiusc + .**) e senza di lei non parte nessuna automazione.
   Controllate nella scheda **Actions**: a sinistra devono comparire *Calendario FamilyWall*, *Brief di casa* e *Mercati*.
   Se non ci sono, createle a mano con *Add file › Create new file*: come nome scrivete `.github/workflows/calendario.yml` (le barre creano le cartelle), incollate il contenuto del file e fate *Commit*; lo stesso per `brief.yml` e `mercati.yml`.
2. Aprite `config.js` (matita per modificare) e mettete URL e chiave **publishable**. Se lo lasciate vuoto, l’app ve li chiede al primo avvio.
3. **Settings › Pages**: *Deploy from a branch*, ramo `main`, cartella `/ (root)`. Dopo un minuto la dashboard è su
   `https://w8997wnwy5-collab.github.io/Dashboard_Casa/`.
4. **Settings › Secrets and variables › Actions › New repository secret**:
   - `SUPABASE_URL`: l’URL del progetto
   - `SUPABASE_SECRET_KEY`: la chiave segreta
   - `ANTHROPIC_API_KEY`: la chiave API di Claude ([console.anthropic.com](https://console.anthropic.com)), facoltativa: senza, il brief si scrive a regole
   - nella scheda *Variables* potete mettere `CLAUDE_MODEL` (predefinito `claude-sonnet-5-5`; `claude-haiku-4-5-20251001` costa la metà)
5. **Actions**: abilitate i workflow e lanciate a mano *Mercati*, *Calendario FamilyWall* e *Brief di casa* (*Run workflow*) per vedere che funzionano.
   Nel registro del calendario trovate l’elenco degli eventi letti da FamilyWall; nell’app, *Impostazioni › Automazioni su GitHub* vi dice com’è andata l’ultima volta.

## 3. Collegamenti, dall’app (5 minuti)

Aprite la dashboard sul telefono, entrate con il vostro account e toccate l’ingranaggio. In alto l’app vi elenca cosa manca:

- **Chiave TomTom**: gratuita su [developer.tomtom.com](https://developer.tomtom.com) (20’000 richieste al mese, senza carta di credito).
- **Indirizzo di casa** e **indirizzo dell’ufficio**: scriveteli e premete *Trova*.
- **Link iCal di FamilyWall**: in FamilyWall, *Calendario › ingranaggio › il calendario del cerchio › Genera URL iCal*.
- **Parole per capire di chi è un evento**: se un evento contiene “Gaia” nel titolo, nella descrizione o tra gli invitati, compare con il suo colore.
- **Codice per Siri**: *Genera il codice*; sotto trovate già URL, chiave e campi da copiare nel comando rapido.
- Orario di arrivo in ufficio, chi va in auto, margine, orari dello schermo a riposo, giorno della spesa in Italia, quota predefinita delle spese, faccende e ricorrenze.

## 4. L’iPad in cucina (il giorno del trasloco, 30 minuti)

1. Aggiornate iPadOS (*Impostazioni › Generali › Aggiornamento software*).
2. In Safari aprite la dashboard ed entrate con l’account **tablet**.
3. *Condividi › Aggiungi alla schermata Home*, con *Apri come web app* attivo. Da qui in poi apritela dall’icona.
4. *Impostazioni › Schermo e luminosità › Blocco automatico*: **Mai**.
5. *Impostazioni › Accessibilità › Accesso guidato*: attivatelo, scegliete un codice e mettete anche lì il blocco automatico su **Mai**.
6. Aprite la dashboard, tre clic sul tasto Home, *Accesso guidato › Avvia*. Per uscire: tre clic e il codice.
7. App **Comandi › Automazione** sull’iPad (con *Esegui subito*):
   - *Ora del giorno 23:00* → *Imposta luminosità* al 5%; *Ora del giorno 06:15* → *Imposta luminosità* al 60%.
   - Con la presa myStrom (trovate il suo indirizzo IP nell’app myStrom): *Livello batteria scende sotto il 30%* → *Ottieni contenuti dell’URL* `http://IP-DELLA-PRESA/relay?state=1`; *Livello batteria sale sopra l’80%* → `http://IP-DELLA-PRESA/relay?state=0`.
   - Il primo giorno controllate che le automazioni partano anche con l’Accesso guidato attivo.
8. Montaggio: il supporto adesivo va solo su una superficie liscia e pulita (sgrassate, premete 30 secondi, aspettate 24 ore prima di appendere l’iPad). Il cavo passa nella canalina.

## 5. Gli iPhone di Matteo e Gaia

1. In Safari aprite la dashboard, entrate con il **vostro** account e fate *Condividi › Aggiungi alla schermata Home*: sul telefono si apre la versione con le schede Spesa, Conti, Faccende e Casa.
2. **Siri** (app *Comandi*, +):
   1. *Dettatura testo*
   2. *Ottieni contenuti dell’URL*: URL, metodo **POST**, intestazione `apikey` (e `Authorization: Bearer …` se usate la vecchia chiave anon), corpo **JSON** con quattro campi di testo: `p_token` (il codice), `p_chi` (`M` o `G`), `p_tipo` (`spesa`), `p_testo` (la variabile *Testo dettato*). Tutti i valori sono già pronti da copiare in *Impostazioni › Siri e telefono*.
   3. *Mostra risultato* (oppure *Pronuncia testo*)
   4. Chiamate il comando **Spesa di casa**: «Ehi Siri, spesa di casa» → «latte, pane e uova».
   Duplicatelo con `p_tipo` = `nota` (**Bigliettino per casa**) e `conto` (**Conto di casa**: «42.50 Coop» registra una spesa pagata da chi parla, divisa con la quota predefinita).

---

## Come è fatta

```
index.html            l’app: vista tablet (iPad) o telefono, scelta da sola
config.js             URL e chiave pubblica di Supabase
assets/casa.css       stile “Carta e luce” (chiaro di giorno, scuro col buio, quasi spento di notte)
assets/js/base.js     date svizzere, festivi ticinesi, sole, icone, logica di casa
assets/js/dati.js     archivio Supabase (tempo reale) e di esempio, meteo, traffico, mercati
assets/js/viste.js    riquadri del tablet, schede del telefono, impostazioni
assets/js/app.js      avvio e interazioni
data/mercati.json     cambio e Interroll (scritto dalla GitHub Action, pubblico)
supabase/schema.sql   tabelle, regole di accesso, funzione per Siri
scripts/              calendario.py, brief.py, mercati.py
.github/workflows/    le tre automazioni
```

Fonti dei dati: meteo da Open-Meteo con il modello di MeteoSvizzera (ICON-CH), traffico da TomTom,
cambio dalla BCE via Frankfurter, Interroll da Yahoo Finance, calendario dal link iCal di FamilyWall.

## Sicurezza

- Nel repository non c’è nessun segreto: la chiave publishable è pubblica per natura e i dati sono protetti dalle regole del database (solo i tre account della casa).
- La chiave segreta di Supabase e quella di Claude stanno solo nei *Secrets* di GitHub.
- Link iCal, chiave TomTom e codice Siri stanno nel database e li vedono solo i membri. Il codice Siri si rigenera in un tocco.

## Se qualcosa non va

- **«Questo account non fa ancora parte della casa»**: manca la riga in `casa_membri` (la schermata mostra quella da lanciare).
- **Calendario vuoto**: guardate *Impostazioni › Automazioni su GitHub* nell’app.
  - *Non è ancora arrivato*: l’automazione non è mai partita. In GitHub › Actions lanciate *Calendario FamilyWall*; se non c’è, manca la cartella `.github` (vedi sopra).
  - *Ultimo tentativo …: errore*: la frase dice cosa fare (di solito rigenerare il link iCal in FamilyWall e incollarlo di nuovo).
  - Letto ma l’evento non c’è: nel registro di *Calendario FamilyWall* c’è l’elenco degli eventi letti. Se manca, l’evento è in un altro calendario di FamilyWall: il link iCal porta solo il calendario da cui l’avete generato (quello con il nome del cerchio). Il telefono mostra i prossimi 7 giorni.
- **Errore rosso in Actions**: la riga *Dashboard Casa* in cima al riepilogo dice cosa sistemare (secret mancanti, chiave publishable al posto di quella secret, URL sbagliato).
- **Traffico «da collegare»**: servono chiave TomTom e indirizzi con *Trova*.
- **Brief «riassunto automatico»**: il workflow del brief non ha ancora girato oggi; la dashboard intanto ne scrive uno da sola.
- **Automazioni ferme**: GitHub spegne i workflow pianificati dopo 60 giorni senza attività nel repository. Il workflow *Mercati* fa un commit ogni ora nei giorni feriali proprio per evitarlo; se succede, riattivateli dalla scheda *Actions*.
- **Supabase in pausa**: i progetti gratuiti si fermano dopo una settimana senza attività. La dashboard lo usa di continuo; se capita, *Restore* dal pannello di Supabase.
