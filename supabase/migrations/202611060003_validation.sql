begin;
-- Match ECMAScript String.trim so server mandatory-field checks agree with the
-- browser for tabs, line terminators, NBSP and the Unicode Space_Separator set.
create function app_private.trim_text(p text) returns text language sql immutable strict set search_path='' as $$
select pg_catalog.btrim(p,(select string_agg(chr(n),'') from unnest(array[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) n))
$$;
create function app_private.normalized(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare o jsonb; begin
  if jsonb_typeof(p)='object' then
    select coalesce(jsonb_object_agg(key,case when key in ('sample_id','indicator_id','text_question_id','code') and jsonb_typeof(value)='string' then to_jsonb(app_private.trim_text(normalize(value#>>'{}',NFC))) else app_private.normalized(value) end),'{}') into o from jsonb_each(p);
  elsif jsonb_typeof(p)='array' then select coalesce(jsonb_agg(app_private.normalized(value) order by n),'[]') into o from jsonb_array_elements(p) with ordinality a(value,n);
  elsif jsonb_typeof(p)='string' then o:=to_jsonb(normalize(p#>>'{}',NFC)); else o:=p; end if;
  return o;
end $$;
create function app_private.validate_config(c jsonb,p_full boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare x jsonb; y jsonb; lo numeric; hi numeric; st numeric; prev numeric; n numeric; k text; t text; good boolean:=true; begin
  if not extensions.jsonb_matches_schema((select schema::json from app_private.validators where name=case when p_full then 'config' else 'draft' end),c) then return false; end if;
  foreach k in array array['samples','indicators','text_questions'] loop
    t:=case k when 'samples' then 'sample_id' when 'indicators' then 'indicator_id' else 'text_question_id' end;
    if exists(select 1 from jsonb_array_elements(c->k) a group by a->>t having count(*)>1) then return false; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(c->'samples') a where p_full or a->>'code'<>'' group by a->>'code' having count(*)>1) then return false; end if;
  if p_full then
    if app_private.trim_text(c#>>'{experiment,title}')='' then return false; end if;
    for x in select value from jsonb_array_elements(c->'samples') loop
      if app_private.trim_text(x->>'code')='' or app_private.trim_text(x->>'admin_name')='' or ((c#>>'{experiment,display_sample_names}')::boolean and app_private.trim_text(x->>'display_name')='') then return false; end if;
    end loop;
  end if;
  foreach k in array array['opens_at','closes_at'] loop
    t:=c#>>array['experiment',k];
    if t is not null then
      if t !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
      perform t::timestamptz;
    end if;
  end loop;
  if p_full and (c#>>'{experiment,opens_at}')::timestamptz >= (c#>>'{experiment,closes_at}')::timestamptz then return false; end if;
  for x in select value from jsonb_array_elements(c->'indicators') loop
    if p_full and (app_private.trim_text(x->>'category')='' or app_private.trim_text(x->>'label')='') then return false; end if;
    lo:=(x->>'min')::numeric; hi:=(x->>'max')::numeric; st:=(x->>'step')::numeric;
    if coalesce(lo<>trunc(lo,2),false) or coalesce(hi<>trunc(hi,2),false) or coalesce(st<>trunc(st,2),false) then return false; end if;
    if p_full and not (lo<hi and st>0 and mod((hi-lo)*100,st*100)=0) then return false; end if;
    prev:=lo;
    for y in select value from jsonb_array_elements(x->'anchors') loop
      if jsonb_typeof(y->'from')<>'number' or jsonb_typeof(y->'to')<>'number' then return false; end if;
      n:=(y->>'from')::numeric;
      if n<>trunc(n,2) or (y->>'to')::numeric<>trunc((y->>'to')::numeric,2) then return false; end if;
      if p_full then
        if app_private.trim_text(y->>'label')='' or n<>prev or n>=(y->>'to')::numeric or mod((n-lo)*100,st*100)<>0 or mod(((y->>'to')::numeric-lo)*100,st*100)<>0 then return false; end if;
      end if;
      prev:=(y->>'to')::numeric;
    end loop;
    if p_full and x->>'kind'='anchored' and prev<>hi then return false; end if;
  end loop;
  if p_full and exists(select 1 from jsonb_array_elements(c->'text_questions') a where app_private.trim_text(a->>'label')='') then return false; end if;
  return good;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation or division_by_zero then return false;
end $$;
create function app_private.validate_answers(c jsonb,a jsonb,p_complete boolean) returns void language plpgsql set search_path='' as $$
#variable_conflict use_column
declare x jsonb; def jsonb; v numeric; lo numeric; st numeric; k text; begin
  if exists(select 1 from jsonb_array_elements(a->'numeric') a group by a->>'indicator_id' having count(*)>1) or exists(select 1 from jsonb_array_elements(a->'text') a group by a->>'text_question_id' having count(*)>1) then perform app_private.deny('VALIDATION_FAILED'); end if;
  if p_complete then
    perform app_private.assert(jsonb_array_length(a->'numeric')=jsonb_array_length(c->'indicators') and jsonb_array_length(a->'text')=jsonb_array_length(c->'text_questions'));
  end if;
  for x in select value from jsonb_array_elements(a->'numeric') loop
    select value into def from jsonb_array_elements(c->'indicators') where value->>'indicator_id'=x->>'indicator_id';
    perform app_private.assert(def is not null);
    v:=(x->>'value')::numeric; lo:=(def->>'min')::numeric; st:=(def->>'step')::numeric;
    if v is not null then
      perform app_private.assert(v=trunc(v,2) and v>=lo and v<=(def->>'max')::numeric and mod((v-lo)*100,st*100)=0 and x->>'missing_reason' is null);
    elsif x->>'missing_reason' is not null then
      perform app_private.assert((def->>'allow_not_evaluable')::boolean and app_private.trim_text(x->>'missing_reason')<>'');
    elsif p_complete and (def->>'required')::boolean then perform app_private.deny('VALIDATION_FAILED'); end if;
  end loop;
  for x in select value from jsonb_array_elements(a->'text') loop
    select value into def from jsonb_array_elements(c->'text_questions') where value->>'text_question_id'=x->>'text_question_id';
    perform app_private.assert(def is not null and char_length(x->>'value')<=(def->>'max_length')::integer);
    if p_complete and (def->>'required')::boolean then perform app_private.assert(app_private.trim_text(x->>'value')<>''); end if;
  end loop;
end $$;
commit;
