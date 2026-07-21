create extension if not exists vector with schema extensions;

create table public.knowledge_chunks (
    id uuid primary key default gen_random_uuid(),
    scope text not null,
    vertical_id text not null,
    business_id uuid references public.businesses(id) on delete cascade,
    source_key text not null,
    title text not null,
    content text not null,
    category text not null,
    metadata jsonb not null default '{}'::jsonb,
    embedding_model text not null default 'text-embedding-3-small',
    embedding extensions.vector(1536) not null,
    content_hash text not null,
    chunk_index integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint knowledge_chunks_scope_value_check
        check (scope in ('vertical', 'business')),
    constraint knowledge_chunks_scope_business_check
    check (
      (scope = 'vertical' and business_id is null)
      or
      (scope = 'business' and business_id is not null)
    )
);

create unique index knowledge_chunks_source_unique
on public.knowledge_chunks
  (scope, vertical_id, business_id, source_key, chunk_index)
nulls not distinct;

create index knowledge_chunks_business_id_idx
on public.knowledge_chunks (business_id);

create index knowledge_chunks_vertical_id_idx
on public.knowledge_chunks (vertical_id);

alter table public.knowledge_chunks enable row level security;

create or replace function public.match_knowledge_chunks(
    p_query_embedding extensions.vector(1536),
    p_business_id uuid,
    p_vertical_id text,
    p_match_count integer default 5,
    p_similarity_threshold double precision default 0.45
)
returns table (
  id uuid,
  scope text,
  vertical_id text,
  business_id uuid,
  source_key text,
  title text,
  content text,
  category text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$

select
    kc.id,
    kc.scope,
    kc.vertical_id,
    kc.business_id,
    kc.source_key,
    kc.title,
    kc.content,
    kc.category,
    kc.metadata,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision as similarity

  from public.knowledge_chunks as kc   
  where kc.vertical_id = p_vertical_id
      and (
      kc.scope = 'vertical'
      or
      (kc.scope = 'business' and kc.business_id = p_business_id)
    )
    and (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_similarity_threshold

    order by kc.embedding OPERATOR(extensions.<=>) p_query_embedding
      limit greatest(1, least(p_match_count, 20));
    $$;

    revoke execute on function public.match_knowledge_chunks(
  extensions.vector,
  uuid,
  text,
  integer,
  double precision
) from public, anon, authenticated;

grant execute on function public.match_knowledge_chunks(
  extensions.vector,
  uuid,
  text,
  integer,
  double precision
) to service_role;