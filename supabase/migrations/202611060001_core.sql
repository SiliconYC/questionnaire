begin;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_jsonschema with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
alter default privileges in schema app_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

create table app_private.site_settings (
  singleton boolean primary key default true check(singleton),
  ready boolean not null default false,
  notice_version text not null default '', notice jsonb not null default '{}',
  retention_days integer not null default 180 check(retention_days between 1 and 180),
  max_collection_days integer not null default 365 check(max_collection_days between 1 and 365),
  max_participants integer not null default 100 check(max_participants between 1 and 100)
);
insert into app_private.site_settings(singleton) values(true);
create table app_private.validators(name text primary key, schema jsonb not null);
create table app_private.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '', participant_code text unique not null default ('P-'||replace(gen_random_uuid()::text,'-','')),
  state text not null default 'pending_consent' check(state in ('pending_consent','active','disabled')),
  edit_version integer not null default 1, consent_version text, consented_at timestamptz,
  created_at timestamptz not null default now()
);
create table app_private.user_roles(user_id uuid primary key references app_private.profiles(user_id) on delete cascade, role text not null default 'participant' check(role in ('admin','participant')));
create table app_private.experiments (
  experiment_id uuid primary key default gen_random_uuid(), status text not null default 'draft' check(status in ('draft','published','closed','archived')),
  draft_config jsonb not null, config_version_id uuid, edit_version integer not null default 1, data_revision integer not null default 0,
  created_at timestamptz not null default now(), published_at timestamptz, closed_at timestamptz
);
create table app_private.experiment_versions (
  config_version_id uuid primary key default gen_random_uuid(), experiment_id uuid not null references app_private.experiments on delete restrict,
  version_no integer not null, config jsonb not null, config_hash text not null, published_by uuid not null references app_private.profiles,
  privacy_notice_version text not null, privacy_notice jsonb not null, retention_policy jsonb not null,
  created_at timestamptz not null default now(), unique(experiment_id,version_no), unique(experiment_id,config_version_id)
);
alter table app_private.experiments add constraint frozen_version_fk foreign key(experiment_id,config_version_id) references app_private.experiment_versions(experiment_id,config_version_id) deferrable initially deferred;
create table app_private.assignments (
  assignment_id uuid primary key default gen_random_uuid(), experiment_id uuid not null references app_private.experiments on delete restrict,
  user_id uuid not null references app_private.profiles on delete restrict,
  config_version_id uuid not null, state text not null default 'active' check(state in ('active','revoked')),
  edit_version integer not null default 1, created_at timestamptz not null default now(), revoked_at timestamptz,
  privacy_notice_version text not null, consented_at timestamptz,
  unique(experiment_id,user_id), foreign key(experiment_id,config_version_id) references app_private.experiment_versions(experiment_id,config_version_id)
);
create index assignments_user on app_private.assignments(user_id,created_at,assignment_id);
create table app_private.responses (
  response_id uuid primary key default gen_random_uuid(), assignment_id uuid not null references app_private.assignments on delete restrict,
  sample_id text not null, state text not null default 'draft' check(state in ('draft','submitted','returned')),
  draft_answers jsonb not null default '{"numeric":[],"text":[]}', edit_version integer not null default 1,
  latest_revision_id uuid, return_reason text, saved_at timestamptz not null default now(), unique(assignment_id,sample_id)
);
create table app_private.response_revisions (
  revision_id uuid primary key default gen_random_uuid(), response_id uuid not null references app_private.responses on delete restrict,
  revision_no integer not null, response_edit_version integer not null, answers jsonb not null, config_version_id uuid not null references app_private.experiment_versions,
  submitted_by uuid not null references app_private.profiles, submitted_at timestamptz not null default now(), idempotency_key uuid not null,
  unique(response_id,revision_no), unique(response_id,revision_id)
);
alter table app_private.responses add foreign key(response_id,latest_revision_id) references app_private.response_revisions(response_id,revision_id) deferrable initially deferred;
create table app_private.audit_events(event_id uuid primary key default gen_random_uuid(), actor_id uuid references app_private.profiles, action text not null, object_id uuid, reason text, metadata jsonb not null default '{}', request_id uuid not null, created_at timestamptz not null default now());
create table app_private.idempotency_requests(actor_id uuid not null references app_private.profiles, operation text not null, idempotency_key uuid not null, input_hash text not null, result jsonb not null, experiment_id uuid references app_private.experiments on delete restrict, created_at timestamptz not null default now(), primary key(actor_id,operation,idempotency_key));
create table app_private.analysis_snapshots(snapshot_id uuid primary key default gen_random_uuid(), experiment_id uuid not null references app_private.experiments, config_version_id uuid not null references app_private.experiment_versions, data_revision integer not null, input_hash text not null, frozen jsonb not null, created_at timestamptz not null default now());
create table app_private.deletion_requests(request_id uuid primary key default gen_random_uuid(), user_id uuid not null references app_private.profiles, reason text not null, status text not null default 'pending' check(status in ('pending','completed')), created_at timestamptz not null default now(), completed_at timestamptz);
create table app_private.cleanup_batches(batch_id uuid primary key default gen_random_uuid(), scope text not null, removed_count integer not null, created_at timestamptz not null default now());

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='app_private' loop
    execute format('alter table app_private.%I enable row level security', t.tablename);
    execute format('revoke all on app_private.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;

create function app_private.bootstrap_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into app_private.profiles(user_id) values(new.id);
  insert into app_private.user_roles(user_id) values(new.id);
  return new;
end $$;
create trigger questionnaire_auth_bootstrap after insert on auth.users for each row execute function app_private.bootstrap_user();
insert into app_private.profiles(user_id) select id from auth.users on conflict do nothing;
insert into app_private.user_roles(user_id) select user_id from app_private.profiles on conflict do nothing;

create function app_private.deny(p_code text, p_version integer default null) returns void language plpgsql set search_path='' as $$
begin raise exception using errcode='P0001', message=jsonb_strip_nulls(jsonb_build_object('code',p_code,'latest_version',p_version))::text; end $$;
create function app_private.assert(p_ok boolean, p_code text default 'VALIDATION_FAILED') returns void language plpgsql set search_path='' as $$
begin if p_ok is distinct from true then perform app_private.deny(p_code); end if; end $$;
create function app_private.version(p_expected integer,p_actual integer) returns void language plpgsql set search_path='' as $$
begin if p_expected is distinct from p_actual then perform app_private.deny('VERSION_CONFLICT',p_actual); end if; end $$;

-- Keys in the approved schemas are ASCII; scores are bounded exact decimals, so
-- this restricted canonicalizer does not claim to canonicalize arbitrary JSON numbers.
create function app_private.canonical(p jsonb) returns text language plpgsql immutable strict set search_path='' as $$
declare out_text text; begin
  case jsonb_typeof(p)
  when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||app_private.canonical(value),',' order by key collate "C"),'')||'}' into out_text from jsonb_each(p);
  when 'array' then select '['||coalesce(string_agg(app_private.canonical(value),',' order by ord),'')||']' into out_text from jsonb_array_elements(p) with ordinality a(value,ord);
  when 'number' then out_text := (p#>>'{}')::numeric::text; if position('.' in out_text)>0 then out_text:=rtrim(rtrim(out_text,'0'),'.'); end if; if out_text='-0' then out_text:='0'; end if;
  else out_text:=p::text; end case;
  return out_text;
end $$;
create function app_private.hash(p jsonb) returns text language sql immutable strict set search_path='' as $$select encode(extensions.digest(convert_to(app_private.canonical(p),'UTF8'),'sha256'),'hex')$$;
create function app_private.actor(p_allow_pending boolean default false,p_allow_disabled boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); s text; begin
  if a is null then perform app_private.deny('UNAUTHENTICATED'); end if;
  select state into s from app_private.profiles where user_id=a;
  perform app_private.assert(s is not null,'FORBIDDEN');
  perform app_private.assert(p_allow_disabled or s<>'disabled','FORBIDDEN');
  perform app_private.assert(p_allow_pending or s<>'pending_consent','CONSENT_REQUIRED');
  return a;
end $$;
create function app_private.is_admin(p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from app_private.user_roles r join app_private.profiles p using(user_id) where r.user_id=p_actor and r.role='admin' and p.state='active')$$;
create function app_private.profile_dto(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('user_id',p.user_id,'display_name',p.display_name,'participant_code',p.participant_code,'state',p.state,'edit_version',p.edit_version,'consent_version',p.consent_version,'consented_at',p.consented_at,'role',r.role) from app_private.profiles p join app_private.user_roles r using(user_id) where p.user_id=p_user$$;
create function app_private.response_summary(r app_private.responses) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('response_id',r.response_id,'assignment_id',r.assignment_id,'sample_id',r.sample_id,'state',r.state,'edit_version',r.edit_version,'saved_at',r.saved_at,'latest_revision_id',r.latest_revision_id,'latest_revision_no',rr.revision_no,'latest_submitted_at',rr.submitted_at,'return_reason',r.return_reason) from (select 1) s left join app_private.response_revisions rr on rr.revision_id=r.latest_revision_id
$$;
create function app_private.end_at(e app_private.experiments,v app_private.experiment_versions) returns timestamptz language sql stable set search_path='' as $$select least((v.config#>>'{experiment,closes_at}')::timestamptz,e.closed_at,e.published_at+make_interval(days=>(v.retention_policy->>'max_collection_days')::integer))$$;
create function app_private.require_open(e app_private.experiments,v app_private.experiment_versions) returns void language plpgsql set search_path='' as $$
begin perform app_private.assert(e.status='published' and (v.config#>>'{experiment,opens_at}' is null or (v.config#>>'{experiment,opens_at}')::timestamptz<=statement_timestamp()) and statement_timestamp()<app_private.end_at(e,v),'EXPERIMENT_NOT_OPEN'); end $$;
create function app_private.projection(c jsonb) returns jsonb language sql immutable set search_path='' as $$select jsonb_set(c,'{samples}',(select jsonb_agg(case when (c#>>'{experiment,display_sample_names}')::boolean then s-'admin_name' else s-'admin_name'-'display_name' end order by n) from jsonb_array_elements(c->'samples') with ordinality a(s,n)))$$;
create function app_private.page(p_items jsonb,p_limit integer) returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('items',coalesce((select jsonb_agg(value order by n) from jsonb_array_elements(p_items) with ordinality a(value,n) where n<=p_limit),'[]'::jsonb),'next_cursor',case when jsonb_array_length(p_items)>p_limit then encode(convert_to((p_items->(p_limit-1)->>'created_at')||'|'||(p_items->(p_limit-1)->>'id'),'UTF8'),'base64') else null end)$$;
commit;
