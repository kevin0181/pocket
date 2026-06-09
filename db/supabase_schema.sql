create extension if not exists pg_trgm;

create table if not exists public.cards (
  collectory_id text primary key,
  name text not null,
  number text,
  rarity text,
  region text default 'kr',
  set_id text,
  set_name text,
  set_code text,
  image_url text,
  collectory_url text not null,
  current_price integer,
  price_status text,
  search_text text not null,
  raw jsonb default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cards_search_text_idx on public.cards using gin (search_text gin_trgm_ops);
create index if not exists cards_name_idx on public.cards (name);
create index if not exists cards_number_idx on public.cards (number);
create index if not exists cards_set_code_idx on public.cards (set_code);
create index if not exists cards_last_seen_at_idx on public.cards (last_seen_at desc);

create table if not exists public.price_snapshots (
  id bigint generated always as identity primary key,
  card_id text not null references public.cards(collectory_id) on delete cascade,
  source text not null default 'collectory',
  price integer,
  captured_at timestamptz not null default now(),
  raw jsonb default '{}'::jsonb
);

create index if not exists price_snapshots_card_id_idx on public.price_snapshots (card_id);
create index if not exists price_snapshots_captured_at_idx on public.price_snapshots (captured_at desc);
