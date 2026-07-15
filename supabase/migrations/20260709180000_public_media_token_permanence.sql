-- Pérennité QR livre : audit + garde-fou DB contre régression « ready → pending_upload ».
-- Voir docs/specs/qr-media-permanence.md

create table if not exists public.public_media_token_events (
  id bigserial primary key,
  token text not null,
  media_id text null,
  kind text null,
  event text not null,
  detail jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists public_media_token_events_token_created_idx
  on public.public_media_token_events (token, created_at desc);

create index if not exists public_media_token_events_event_created_idx
  on public.public_media_token_events (event, created_at desc);

comment on table public.public_media_token_events is
  'Traçabilité des changements de tokens QR publics (/m/{token}). Diagnostic prod et alertes.';

-- Interdit de rétrograder un token déjà prêt (QR figé dans les PDF exportés).
create or replace function public.guard_public_media_token_ready()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'ready'
     and coalesce(old.ready_path, '') <> '' then
    if new.status is distinct from 'ready' then
      raise exception 'QR_TOKEN_READY_IMMUTABLE: status cannot leave ready (token=%)', old.token
        using errcode = 'P0001';
    end if;
    if new.ready_path is distinct from old.ready_path
       and coalesce(new.ready_path, '') <> '' then
      raise exception 'QR_TOKEN_READY_PATH_IMMUTABLE: ready_path cannot change (token=%)', old.token
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_public_media_tokens_guard_ready on public.public_media_tokens;
create trigger trg_public_media_tokens_guard_ready
before update on public.public_media_tokens
for each row execute function public.guard_public_media_token_ready();

-- Journal best-effort des transitions de statut (complète les logs Railway).
create or replace function public.log_public_media_token_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.public_media_token_events (token, media_id, kind, event, detail)
    values (
      new.token,
      new.media_id,
      new.kind,
      'insert',
      jsonb_build_object('status', new.status, 'raw_path', new.raw_path, 'ready_path', new.ready_path)
    );
    return new;
  end if;

  if tg_op = 'UPDATE'
     and (old.status is distinct from new.status
          or old.ready_path is distinct from new.ready_path
          or old.raw_path is distinct from new.raw_path
          or old.last_error is distinct from new.last_error) then
    insert into public.public_media_token_events (token, media_id, kind, event, detail)
    values (
      new.token,
      new.media_id,
      new.kind,
      'status_change',
      jsonb_build_object(
        'from_status', old.status,
        'to_status', new.status,
        'from_ready_path', old.ready_path,
        'to_ready_path', new.ready_path,
        'from_raw_path', old.raw_path,
        'to_raw_path', new.raw_path,
        'last_error', new.last_error
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_public_media_tokens_audit on public.public_media_tokens;
create trigger trg_public_media_tokens_audit
after insert or update on public.public_media_tokens
for each row execute function public.log_public_media_token_status_change();
