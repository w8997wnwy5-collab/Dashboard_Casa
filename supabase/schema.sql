-- =====================================================================
--  Dashboard Casa · schema del database (Supabase / Postgres)
--
--  Come si usa: Supabase › SQL Editor › New query › incolla TUTTO
--  questo file › Run. Si può rilanciare senza problemi: non cancella
--  dati già inseriti.
--
--  Dopo, crea i tre utenti (Matteo, Gaia, tablet) e lancia il blocco
--  "Membri della casa" che trovi in fondo, con le vostre email.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chi fa parte della casa
--    persona: M = Matteo, G = Gaia, T = tablet in cucina
-- ---------------------------------------------------------------------
create table if not exists public.casa_membri (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  persona    text not null check (persona in ('M','G','T')),
  creato_il  timestamptz not null default now()
);

create or replace function public.casa_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.casa_membri where user_id = auth.uid());
$$;

create or replace function public.casa_persona() returns text
language sql stable security definer set search_path = public as $$
  select persona from public.casa_membri where user_id = auth.uid();
$$;

revoke all on function public.casa_membro()  from public;
revoke all on function public.casa_persona() from public;
grant execute on function public.casa_membro()  to authenticated;
grant execute on function public.casa_persona() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Impostazioni condivise (una sola riga)
--    dati:          quello che si modifica dall'app (nomi, indirizzi, orari…)
--    collegamenti:  chiave TomTom, link iCal di FamilyWall, codice Siri
-- ---------------------------------------------------------------------
create table if not exists public.casa_config (
  id             smallint primary key default 1 check (id = 1),
  dati           jsonb not null default '{}'::jsonb,
  collegamenti   jsonb not null default '{}'::jsonb,
  aggiornato_il  timestamptz not null default now()
);

insert into public.casa_config (id, dati) values (1, '{
  "nomi":     {"M": "Matteo", "G": "Gaia"},
  "casa":     {"indirizzo": "", "lat": 46.0037, "lon": 8.9511},
  "lavoro":   {"nome": "Interroll", "indirizzo": "Via Gorelle 3, 6592 Sant''Antonino",
               "lat": null, "lon": null, "arrivo": "08:30", "margine": 5, "chi": "MG"},
  "schermo":  {"notte_dalle": "23:00", "notte_alle": "06:15", "tema": "auto"},
  "spesa":    {"giorno_italia": 6, "persone": 2},
  "conti":    {"quota_m": 50},
  "faccende": {"rotazione": "alterna"},
  "trasloco": "2026-12-01",
  "alias":    {"M": ["Matteo"], "G": ["Gaia"]}
}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Lista della spesa
-- ---------------------------------------------------------------------
create table if not exists public.casa_spesa (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null check (char_length(btrim(nome)) between 1 and 120),
  chi        text check (chi in ('M','G','T')),
  via        text not null default 'tablet' check (via in ('tablet','telefono','Siri','bigliettino')),
  carne_kg   numeric(5,2) check (carne_kg is null or carne_kg >= 0),
  preso_il   timestamptz,
  creato_il  timestamptz not null default now()
);
create index if not exists casa_spesa_aperta on public.casa_spesa (creato_il desc) where preso_il is null;

-- Riconosce la carne (per la franchigia) quando il nome contiene un peso: "Pollo 800 g"
create or replace function public.casa_spesa_prepara() returns trigger
language plpgsql set search_path = public as $$
declare m text[]; q numeric;
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  if new.carne_kg is null and new.nome ~* '(pollo|manzo|maiale|carne|salsicc|prosciutto|vitello|macinato|bistecc|speck|salame|tacchino|agnello|cotolett|hamburger|arrosto|coniglio|bresaola|mortadella|pancetta|wurstel|würstel|guanciale|cotechino)' then
    m := regexp_match(new.nome, '(\d+(?:[.,]\d+)?)\s*(kg|chili|g|gr|grammi)(\s|$|\))', 'i');
    if m is not null then
      q := replace(m[1], ',', '.')::numeric;
      new.carne_kg := case when lower(m[2]) in ('kg','chili') then q else round(q / 1000, 2) end;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists casa_spesa_prepara on public.casa_spesa;
create trigger casa_spesa_prepara before insert or update of nome on public.casa_spesa
  for each row execute function public.casa_spesa_prepara();

-- ---------------------------------------------------------------------
-- 4. Bigliettini che compaiono sullo schermo
-- ---------------------------------------------------------------------
create table if not exists public.casa_bigliettini (
  id         uuid primary key default gen_random_uuid(),
  chi        text not null check (chi in ('M','G','T')),
  testo      text not null check (char_length(btrim(testo)) between 1 and 280),
  via        text not null default 'telefono',
  letto_il   timestamptz,
  creato_il  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Faccende a punti (rotazione settimanale)
-- ---------------------------------------------------------------------
create table if not exists public.casa_faccende (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (char_length(btrim(nome)) between 1 and 60),
  punti            smallint not null default 2 check (punti between 1 and 10),
  volte_settimana  smallint not null default 1 check (volte_settimana between 1 and 7),
  persona_base     text not null default 'M' check (persona_base in ('M','G')),
  ordine           smallint not null default 0,
  attiva           boolean not null default true,
  creato_il        timestamptz not null default now()
);

create table if not exists public.casa_faccende_fatte (
  id           uuid primary key default gen_random_uuid(),
  faccenda_id  uuid not null references public.casa_faccende(id) on delete cascade,
  chi          text not null check (chi in ('M','G')),
  punti        smallint,
  settimana    text not null default to_char(now() at time zone 'Europe/Zurich', 'IYYY-"W"IW'),
  fatta_il     timestamptz not null default now()
);
create index if not exists casa_faccende_fatte_sett on public.casa_faccende_fatte (settimana);

create or replace function public.casa_faccenda_punti() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.punti is null then
    select punti into new.punti from public.casa_faccende where id = new.faccenda_id;
  end if;
  return new;
end $$;

drop trigger if exists casa_faccenda_punti on public.casa_faccende_fatte;
create trigger casa_faccenda_punti before insert on public.casa_faccende_fatte
  for each row execute function public.casa_faccenda_punti();

insert into public.casa_faccende (nome, punti, volte_settimana, persona_base, ordine)
select v.nome, v.punti, v.volte, v.persona, v.ordine
from (values
  ('Aspirapolvere',         2, 1, 'M', 1),
  ('Bagno',                 3, 1, 'M', 2),
  ('Cucina a fondo',        3, 1, 'G', 3),
  ('Cambio lenzuola',       2, 1, 'G', 4),
  ('Lavatrici e stendere',  2, 2, 'M', 5),
  ('Spazzatura e riciclo',  1, 2, 'G', 6)
) as v(nome, punti, volte, persona, ordine)
where not exists (select 1 from public.casa_faccende);

-- ---------------------------------------------------------------------
-- 6. Spese di casa (chi ha pagato cosa, quote, saldo tra voi)
--    quota_m = percentuale che spetta a Matteo (50 = metà a testa)
--    tipo 'saldo' = un rimborso dall'uno all'altra (pagato_da = chi dà i soldi)
-- ---------------------------------------------------------------------
create table if not exists public.casa_spese (
  id           uuid primary key default gen_random_uuid(),
  data         date not null default (now() at time zone 'Europe/Zurich')::date,
  descrizione  text not null check (char_length(btrim(descrizione)) between 1 and 80),
  importo      numeric(10,2) not null check (importo > 0 and importo < 100000),
  pagato_da    text not null check (pagato_da in ('M','G')),
  quota_m      numeric(5,2) not null default 50 check (quota_m between 0 and 100),
  categoria    text not null default 'Casa',
  tipo         text not null default 'spesa' check (tipo in ('spesa','saldo')),
  via          text not null default 'telefono',
  creato_il    timestamptz not null default now()
);
create index if not exists casa_spese_data on public.casa_spese (data desc);

create or replace view public.casa_spese_riepilogo with (security_invoker = true) as
select
  coalesce(sum(case
    when tipo = 'spesa' and pagato_da = 'M' then  importo * (100 - quota_m) / 100
    when tipo = 'spesa' and pagato_da = 'G' then -importo * quota_m / 100
    when tipo = 'saldo' and pagato_da = 'M' then  importo
    when tipo = 'saldo' and pagato_da = 'G' then -importo
  end), 0)::numeric(10,2) as g_deve_a_m,
  coalesce(sum(importo) filter (
    where tipo = 'spesa'
      and date_trunc('month', data) = date_trunc('month', (now() at time zone 'Europe/Zurich')::date)
  ), 0)::numeric(10,2) as totale_mese
from public.casa_spese;

-- ---------------------------------------------------------------------
-- 7. Ricorrenze e countdown (anniversari, viaggi, compleanni…)
-- ---------------------------------------------------------------------
create table if not exists public.casa_ricorrenze (
  id         uuid primary key default gen_random_uuid(),
  titolo     text not null check (char_length(btrim(titolo)) between 1 and 60),
  data       date not null,
  annuale    boolean not null default false,
  creato_il  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. Calendario (copiato da FamilyWall ogni 15 minuti dalla GitHub Action)
-- ---------------------------------------------------------------------
create table if not exists public.casa_eventi (
  uid              text not null,
  inizio           timestamptz not null,
  fine             timestamptz not null,
  tutto_il_giorno  boolean not null default false,
  titolo           text not null,
  luogo            text,
  chi              text check (chi in ('M','G','MG')),
  aggiornato_il    timestamptz not null default now(),
  primary key (uid, inizio)
);
create index if not exists casa_eventi_inizio on public.casa_eventi (inizio);

-- ---------------------------------------------------------------------
-- 9. Brief del mattino e della sera (scritti dalla GitHub Action)
-- ---------------------------------------------------------------------
create table if not exists public.casa_brief (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('mattina','sera')),
  testo      text not null,
  chips      jsonb not null default '[]'::jsonb,
  modello    text,
  creato_il  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 10. Regole di accesso: solo i membri della casa vedono e modificano
-- ---------------------------------------------------------------------
alter table public.casa_membri          enable row level security;
alter table public.casa_config          enable row level security;
alter table public.casa_spesa           enable row level security;
alter table public.casa_bigliettini     enable row level security;
alter table public.casa_faccende        enable row level security;
alter table public.casa_faccende_fatte  enable row level security;
alter table public.casa_spese           enable row level security;
alter table public.casa_ricorrenze      enable row level security;
alter table public.casa_eventi          enable row level security;
alter table public.casa_brief           enable row level security;

do $$
declare t text;
begin
  -- lettura per i membri su tutte le tabelle
  foreach t in array array['casa_membri','casa_config','casa_spesa','casa_bigliettini','casa_faccende',
                           'casa_faccende_fatte','casa_spese','casa_ricorrenze','casa_eventi','casa_brief'] loop
    execute format('drop policy if exists "membri leggono" on public.%I', t);
    execute format('create policy "membri leggono" on public.%I for select to authenticated using (public.casa_membro())', t);
  end loop;
  -- scrittura per i membri sulle tabelle che si modificano dall'app
  foreach t in array array['casa_spesa','casa_bigliettini','casa_faccende','casa_faccende_fatte',
                           'casa_spese','casa_ricorrenze'] loop
    execute format('drop policy if exists "membri scrivono" on public.%I', t);
    execute format('create policy "membri scrivono" on public.%I for insert to authenticated with check (public.casa_membro())', t);
    execute format('drop policy if exists "membri modificano" on public.%I', t);
    execute format('create policy "membri modificano" on public.%I for update to authenticated using (public.casa_membro()) with check (public.casa_membro())', t);
    execute format('drop policy if exists "membri cancellano" on public.%I', t);
    execute format('create policy "membri cancellano" on public.%I for delete to authenticated using (public.casa_membro())', t);
  end loop;
end $$;

drop policy if exists "membri modificano" on public.casa_config;
create policy "membri modificano" on public.casa_config for update to authenticated
  using (public.casa_membro()) with check (public.casa_membro());

create or replace function public.casa_config_toccata() returns trigger
language plpgsql as $$ begin new.aggiornato_il := now(); return new; end $$;
drop trigger if exists casa_config_toccata on public.casa_config;
create trigger casa_config_toccata before update on public.casa_config
  for each row execute function public.casa_config_toccata();

-- ---------------------------------------------------------------------
-- 11. Siri: aggiunge spesa, bigliettini o spese con un codice segreto
--     Il codice si genera dall'app (Impostazioni › Siri e telefono).
--     p_tipo: 'spesa' | 'nota' | 'conto'     p_chi: 'M' | 'G'
-- ---------------------------------------------------------------------
create or replace function public.casa_siri(p_token text, p_chi text, p_tipo text, p_testo text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token  text;
  v_chi    text;
  v_testo  text;
  v_voce   text;
  v_n      int := 0;
  v_num    text;
  v_imp    numeric;
  v_desc   text;
  v_quota  numeric;
begin
  select collegamenti->>'siri_token' into v_token from public.casa_config where id = 1;
  if v_token is null or char_length(v_token) < 20 or p_token is null or p_token <> v_token then
    raise exception 'Codice Siri non valido' using errcode = '42501';
  end if;

  v_chi   := case when upper(coalesce(p_chi, '')) in ('M','G') then upper(p_chi) else 'M' end;
  v_testo := left(btrim(coalesce(p_testo, '')), 280);
  if v_testo = '' then
    raise exception 'Non ho sentito nulla da aggiungere' using errcode = '22023';
  end if;

  if lower(coalesce(p_tipo, 'spesa')) = 'nota' then
    insert into public.casa_bigliettini (chi, testo, via) values (v_chi, v_testo, 'Siri');
    return 'Fatto: il bigliettino è sullo schermo di casa.';

  elsif lower(p_tipo) = 'conto' then
    v_num := substring(v_testo from '(\d+(?:[.,]\d{1,2})?)');
    if v_num is null then
      raise exception 'Non trovo l''importo: prova con «42.50 Coop»' using errcode = '22023';
    end if;
    v_imp  := replace(v_num, ',', '.')::numeric;
    v_desc := btrim(regexp_replace(v_testo, '\d+(?:[.,]\d{1,2})?\s*(chf|fr\.?|franchi)?', '', 'i'));
    v_desc := btrim(regexp_replace(v_desc, '^(per|di|da|alla|al|a)\s+', '', 'i'));
    if v_desc = '' then v_desc := 'Spesa di casa'; end if;
    select coalesce((dati->'conti'->>'quota_m')::numeric, 50) into v_quota from public.casa_config where id = 1;
    insert into public.casa_spese (descrizione, importo, pagato_da, quota_m, via)
      values (left(upper(left(v_desc, 1)) || substr(v_desc, 2), 80), v_imp, v_chi, coalesce(v_quota, 50), 'Siri');
    return format('Segnati %s franchi: %s.', to_char(v_imp, 'FM999990.00'), v_desc);

  else
    foreach v_voce in array regexp_split_to_array(v_testo, '\s*(?:,|;|\se\s|\sed\s)\s*') loop
      v_voce := btrim(v_voce);
      if v_voce <> '' then
        insert into public.casa_spesa (nome, chi, via)
          values (left(upper(left(v_voce, 1)) || substr(v_voce, 2), 120), v_chi, 'Siri');
        v_n := v_n + 1;
      end if;
    end loop;
    return case when v_n = 1 then 'Aggiunto alla spesa.' else format('Aggiunte %s cose alla spesa.', v_n) end;
  end if;
end $$;

revoke all on function public.casa_siri(text, text, text, text) from public;
grant execute on function public.casa_siri(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. Funzioni usate solo dalle GitHub Action (chiave segreta)
-- ---------------------------------------------------------------------
create or replace function public.casa_sostituisci_eventi(p_dal timestamptz, p_al timestamptz, p_eventi jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.casa_eventi where inizio < p_al and fine > p_dal;
  insert into public.casa_eventi (uid, inizio, fine, tutto_il_giorno, titolo, luogo, chi)
  select e->>'uid',
         (e->>'inizio')::timestamptz,
         (e->>'fine')::timestamptz,
         coalesce((e->>'tutto_il_giorno')::boolean, false),
         left(coalesce(e->>'titolo', '(senza titolo)'), 200),
         left(e->>'luogo', 200),
         nullif(e->>'chi', '')
  from jsonb_array_elements(coalesce(p_eventi, '[]'::jsonb)) as e
  on conflict (uid, inizio) do update
    set fine = excluded.fine, tutto_il_giorno = excluded.tutto_il_giorno, titolo = excluded.titolo,
        luogo = excluded.luogo, chi = excluded.chi, aggiornato_il = now();
  get diagnostics n = row_count;
  delete from public.casa_eventi where fine < now() - interval '3 days';
  return n;
end $$;

create or replace function public.casa_pulizia() returns void
language sql security definer set search_path = public as $$
  delete from public.casa_spesa       where preso_il  < now() - interval '7 days';
  delete from public.casa_bigliettini where creato_il < now() - interval '60 days';
  delete from public.casa_brief       where creato_il < now() - interval '30 days';
$$;

revoke all on function public.casa_sostituisci_eventi(timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.casa_pulizia() from public, anon, authenticated;
grant execute on function public.casa_sostituisci_eventi(timestamptz, timestamptz, jsonb) to service_role;
grant execute on function public.casa_pulizia() to service_role;

-- ---------------------------------------------------------------------
-- 13. Aggiornamenti in tempo reale (il tablet si aggiorna da solo)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['casa_spesa','casa_bigliettini','casa_faccende','casa_faccende_fatte','casa_spese',
                           'casa_ricorrenze','casa_eventi','casa_brief','casa_config'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then raise notice 'Pubblicazione supabase_realtime non trovata: salto %', t;
    end;
  end loop;
end $$;

-- =====================================================================
--  Membri della casa · da lanciare DOPO aver creato gli utenti in
--  Authentication › Users (Add user › Create new user, con "Auto Confirm").
--  Sostituisci le tre email con quelle vere, poi seleziona solo queste
--  righe e premi Run.
-- =====================================================================
-- insert into public.casa_membri (user_id, persona)
-- select u.id, v.persona
-- from auth.users u
-- join (values ('matteo@esempio.ch', 'M'),
--              ('gaia@esempio.ch',   'G'),
--              ('tablet@esempio.ch', 'T')) as v(email, persona)
--   on lower(u.email) = lower(v.email)
-- on conflict (user_id) do update set persona = excluded.persona;
