begin;
create function app_private.dispatch(p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  actor uuid; admin boolean; req uuid:=gen_random_uuid(); result jsonb; prior app_private.idempotency_requests;
  e app_private.experiments; v app_private.experiment_versions; a app_private.assignments; r app_private.responses; rev app_private.response_revisions;
  prof app_private.profiles; settings app_private.site_settings; snapshot app_private.analysis_snapshots;
  eid uuid; aid uuid; rid uuid; uid uuid; kid uuid; hash text; c jsonb; x jsonb; rows jsonb; coverage jsonb;
  target text; is_write boolean; new_row boolean:=false; changed boolean:=false; counter integer:=0;
  lim integer:=50; after_time timestamptz:='-infinity'; after_id uuid:='00000000-0000-0000-0000-000000000000'; cursor_parts text[];
  err jsonb;
begin
  -- The V1 dispatcher serializes business transactions deliberately. This single
  -- lock also orders account disable, closing, revocation and snapshot creation.
  perform pg_advisory_xact_lock(721931,1);
  perform app_private.assert(exists(select 1 from app_private.validators where name=p_operation),'FORBIDDEN');
  perform app_private.assert(extensions.jsonb_matches_schema((select schema::json from app_private.validators where name=p_operation),p_input));
  actor:=app_private.actor(p_operation in ('api_get_me','api_complete_onboarding','api_request_deletion'),p_operation='api_request_deletion');
  admin:=app_private.is_admin(actor);
  select * into settings from app_private.site_settings where singleton;
  is_write:=p_input ? 'idempotency_key';
  if p_operation in ('api_list_participants','api_set_profile_state','api_create_experiment','api_update_experiment_draft','api_get_experiment_admin','api_publish_experiment','api_transition_experiment','api_delete_experiment_draft','api_assign_participants','api_set_assignment_state','api_list_experiment_progress','api_return_response','api_create_analysis_snapshot','api_get_analysis_snapshot','api_record_export') then
    perform app_private.assert(admin,'FORBIDDEN');
  end if;
  lim:=coalesce((p_input->>'limit')::integer,50);
  if p_input->>'cursor' is not null then
    cursor_parts:=string_to_array(convert_from(decode(p_input->>'cursor','base64'),'UTF8'),'|');
    perform app_private.assert(array_length(cursor_parts,1)=2);
    after_time:=cursor_parts[1]::timestamptz; after_id:=cursor_parts[2]::uuid;
  elsif p_operation='api_list_response_revisions' then
    after_time:='infinity'; after_id:='ffffffff-ffff-ffff-ffff-ffffffffffff';
  end if;

  if p_operation='api_delete_experiment_draft' then
    select * into prior from app_private.idempotency_requests where actor_id=actor and operation=p_operation and idempotency_key=(p_input->>'idempotency_key')::uuid;
    if found then
      perform app_private.assert(prior.input_hash=app_private.hash(p_input),'IDEMPOTENCY_CONFLICT');
      return prior.result;
    end if;
  end if;

  eid:=(p_input->>'experiment_id')::uuid; aid:=(p_input->>'assignment_id')::uuid; rid:=(p_input->>'response_id')::uuid;
  if p_operation='api_get_response_revision' then
    select * into rev from app_private.response_revisions where revision_id=(p_input->>'revision_id')::uuid;
    perform app_private.assert(found,'FORBIDDEN'); rid:=rev.response_id;
  end if;
  if rid is not null then
    select * into r from app_private.responses where response_id=rid;
    perform app_private.assert(found,'FORBIDDEN'); aid:=r.assignment_id;
  end if;
  if aid is not null then
    select * into a from app_private.assignments where assignment_id=aid;
    perform app_private.assert(found and (admin or a.user_id=actor),'FORBIDDEN'); eid:=a.experiment_id;
    if p_operation in ('api_save_response_draft','api_submit_response','api_accept_assignment_notice') then
      perform app_private.assert(a.user_id=actor,'FORBIDDEN');
      perform app_private.assert(a.state='active','ASSIGNMENT_REVOKED');
    end if;
  end if;
  if p_input ? 'snapshot_id' then
    select * into snapshot from app_private.analysis_snapshots where snapshot_id=(p_input->>'snapshot_id')::uuid;
    perform app_private.assert(found,'NOT_FOUND'); eid:=snapshot.experiment_id;
  end if;
  if eid is not null then
    select * into e from app_private.experiments where experiment_id=eid for update;
    perform app_private.assert(found,'NOT_FOUND');
    if e.config_version_id is not null then select * into v from app_private.experiment_versions where config_version_id=e.config_version_id; end if;
  end if;
  if is_write then
    kid:=(p_input->>'idempotency_key')::uuid; hash:=app_private.hash(case when p_input ? 'config' then jsonb_set(p_input,'{config}',app_private.normalized(p_input->'config')) else p_input end);
    select * into prior from app_private.idempotency_requests where actor_id=actor and operation=p_operation and idempotency_key=kid;
    if found then
      perform app_private.assert(prior.input_hash=hash,'IDEMPOTENCY_CONFLICT');
      return prior.result;
    end if;
  end if;

  case p_operation
  when 'api_get_me' then
    result:=app_private.profile_dto(actor)||jsonb_build_object('site_notice',settings.notice,'site_notice_version',settings.notice_version,'site_ready',settings.ready);
  when 'api_complete_onboarding' then
    perform app_private.assert(settings.ready,'SERVICE_UNAVAILABLE');
    perform app_private.assert(p_input->>'consent_version'=settings.notice_version,'CONSENT_REQUIRED');
    perform app_private.assert(app_private.trim_text(p_input->>'display_name')<>'');
    update app_private.profiles set display_name=normalize(app_private.trim_text(p_input->>'display_name'),NFC),state='active',consent_version=settings.notice_version,consented_at=now(),edit_version=edit_version+1 where user_id=actor and state in ('pending_consent','active');
    result:=app_private.profile_dto(actor);
  when 'api_request_deletion' then
    insert into app_private.deletion_requests(user_id,reason) values(actor,p_input->>'reason') returning jsonb_build_object('request_id',request_id,'status',status) into result;
  when 'api_list_participants' then
    select coalesce(jsonb_agg(z.dto order by z.created_at,z.user_id),'[]') into rows from (select p.created_at,p.user_id,jsonb_build_object('id',p.user_id,'user_id',p.user_id,'participant_code',p.participant_code,'display_name',p.display_name,'state',p.state,'edit_version',p.edit_version,'role',(select role from app_private.user_roles where user_id=p.user_id),'created_at',p.created_at) dto from app_private.profiles p where (p_input->>'state' is null or p.state=p_input->>'state') and (p.created_at,p.user_id)>(after_time,after_id) order by p.created_at,p.user_id limit lim+1) z;
    result:=app_private.page(rows,lim);
  when 'api_set_profile_state' then
    uid:=(p_input->>'user_id')::uuid;
    select * into prof from app_private.profiles where user_id=uid for update;
    perform app_private.assert(found,'NOT_FOUND'); perform app_private.version((p_input->>'expected_version')::integer,prof.edit_version);
    perform app_private.assert(prof.consented_at is not null and prof.state<>'pending_consent');
    target:=p_input->>'state'; perform app_private.assert(app_private.trim_text(p_input->>'reason')<>'');
    if target='disabled' and app_private.is_admin(uid) then
      perform app_private.assert((select count(*) from app_private.user_roles ur join app_private.profiles p using(user_id) where ur.role='admin' and p.state='active')>1,'FORBIDDEN');
    end if;
    update app_private.profiles set state=target,edit_version=edit_version+1 where user_id=uid;
    if prof.state<>target then update app_private.experiments set data_revision=data_revision+1 where experiment_id in (select experiment_id from app_private.assignments where user_id=uid); end if;
    result:=app_private.profile_dto(uid);
  when 'api_create_experiment' then
    c:=app_private.normalized(p_input->'config'); perform app_private.assert(app_private.validate_config(c,false));
    insert into app_private.experiments(draft_config) values(c) returning * into e; eid:=e.experiment_id;
    result:=jsonb_build_object('experiment_id',eid,'edit_version',1,'publish_issues',case when app_private.validate_config(c,true) then '[]'::jsonb else '[{"code":"CONFIG_INCOMPLETE","path":"/","message":"配置尚未通过发布校验。"}]'::jsonb end);
  when 'api_update_experiment_draft' then
    perform app_private.assert(e.status='draft','EXPERIMENT_NOT_OPEN'); perform app_private.version((p_input->>'expected_version')::integer,e.edit_version);
    c:=app_private.normalized(p_input->'config'); perform app_private.assert(app_private.validate_config(c,false));
    update app_private.experiments set draft_config=c,edit_version=edit_version+1 where experiment_id=eid returning * into e;
    result:=jsonb_build_object('experiment_id',eid,'edit_version',e.edit_version,'publish_issues',case when app_private.validate_config(c,true) then '[]'::jsonb else '[{"code":"CONFIG_INCOMPLETE","path":"/","message":"配置尚未通过发布校验。"}]'::jsonb end);
  when 'api_publish_experiment' then
    perform app_private.assert(settings.ready and settings.notice_version<>'' and settings.notice ?& array['purpose','controller','contact','providers','region','retention','deletion','downloads'],'SERVICE_UNAVAILABLE');
    perform app_private.assert((select count(*)=8 and bool_and(jsonb_typeof(value)='string' and app_private.trim_text(value#>>'{}')<>'') from jsonb_each(settings.notice)),'SERVICE_UNAVAILABLE');
    perform app_private.assert(e.status='draft','EXPERIMENT_NOT_OPEN'); perform app_private.version((p_input->>'expected_version')::integer,e.edit_version);
    perform app_private.assert(app_private.validate_config(e.draft_config,true));
    perform app_private.assert(e.draft_config#>>'{experiment,closes_at}' is null or (e.draft_config#>>'{experiment,closes_at}')::timestamptz>now(),'EXPERIMENT_NOT_OPEN');
    insert into app_private.experiment_versions(experiment_id,version_no,config,config_hash,published_by,privacy_notice_version,privacy_notice,retention_policy) values(eid,1,e.draft_config,app_private.hash(e.draft_config),actor,settings.notice_version,settings.notice,jsonb_build_object('retention_days',settings.retention_days,'max_collection_days',settings.max_collection_days)) returning * into v;
    update app_private.experiments set status='published',config_version_id=v.config_version_id,published_at=now(),edit_version=edit_version+1 where experiment_id=eid returning * into e;
    result:=jsonb_build_object('experiment_id',eid,'config_version_id',v.config_version_id,'edit_version',e.edit_version,'status',e.status);
  when 'api_transition_experiment' then
    perform app_private.version((p_input->>'expected_version')::integer,e.edit_version); target:=p_input->>'target';
    perform app_private.assert((e.status='published' and target='closed') or (e.status='closed' and target='archived'),'EXPERIMENT_NOT_OPEN');
    perform app_private.assert(app_private.trim_text(p_input->>'reason')<>'');
    update app_private.experiments set status=target,closed_at=case when target='closed' then now() else closed_at end,edit_version=edit_version+1 where experiment_id=eid returning * into e;
    result:=jsonb_build_object('experiment_id',eid,'status',e.status,'edit_version',e.edit_version,'closed_at',e.closed_at);
  when 'api_delete_experiment_draft' then
    perform app_private.version((p_input->>'expected_version')::integer,e.edit_version);
    perform app_private.assert(e.status='draft' and e.config_version_id is null and not exists(select 1 from app_private.assignments where experiment_id=eid),'EXPERIMENT_NOT_OPEN');
    update app_private.idempotency_requests set experiment_id=null where experiment_id=eid;
    delete from app_private.experiments where experiment_id=eid;
    result:=jsonb_build_object('experiment_id',eid,'deleted',true); eid:=null;
  when 'api_get_experiment_admin' then
    result:=jsonb_build_object('experiment_id',eid,'status',e.status,'edit_version',e.edit_version,'data_revision',e.data_revision,'config_version_id',e.config_version_id,'config',coalesce(v.config,e.draft_config),'published_at',e.published_at,'closed_at',e.closed_at,'created_at',e.created_at,'privacy_notice_version',v.privacy_notice_version,'privacy_notice',v.privacy_notice,'retention_policy',v.retention_policy,'collection_ends_at',app_private.end_at(e,v));
  when 'api_list_experiments' then
    select coalesce(jsonb_agg(z.dto order by z.created_at,z.experiment_id),'[]') into rows from (
      select e.created_at,e.experiment_id,jsonb_build_object('id',e.experiment_id,'experiment_id',e.experiment_id,'created_at',e.created_at,'title',e.draft_config#>>'{experiment,title}','status',e.status,'edit_version',e.edit_version,'data_revision',e.data_revision,'config_version_id',e.config_version_id) dto
      from app_private.experiments e where (admin or exists(select 1 from app_private.assignments a where a.experiment_id=e.experiment_id and a.user_id=actor)) and (p_input->>'status' is null or e.status=p_input->>'status') and (e.created_at,e.experiment_id)>(after_time,after_id) order by e.created_at,e.experiment_id limit lim+1
    ) z; result:=app_private.page(rows,lim);
  when 'api_assign_participants' then
    perform app_private.assert(e.status='published','EXPERIMENT_NOT_OPEN');
    perform app_private.assert(not exists(select 1 from jsonb_array_elements_text(p_input->'user_ids') z left join app_private.profiles p on p.user_id=z::uuid where p.user_id is null or p.state<>'active'));
    perform app_private.assert(not exists(select 1 from app_private.assignments a where a.experiment_id=eid and a.user_id in (select value::uuid from jsonb_array_elements_text(p_input->'user_ids')) and a.state='revoked'),'ASSIGNMENT_REVOKED');
    perform app_private.assert((select count(*) from app_private.assignments where experiment_id=eid)+(select count(*) from jsonb_array_elements_text(p_input->'user_ids') z where not exists(select 1 from app_private.assignments a where a.experiment_id=eid and a.user_id=z::uuid))<=settings.max_participants);
    rows:='[]';
    for uid in select value::uuid from jsonb_array_elements_text(p_input->'user_ids') loop
      select * into a from app_private.assignments where experiment_id=eid and user_id=uid;
      new_row:=not found;
      if new_row then
        insert into app_private.assignments(experiment_id,user_id,config_version_id,privacy_notice_version) values(eid,uid,v.config_version_id,v.privacy_notice_version) returning * into a; changed:=true;
      end if;
      rows:=rows||jsonb_build_array(jsonb_build_object('assignment_id',a.assignment_id,'user_id',uid,'existing',not new_row,'edit_version',a.edit_version));
    end loop;
    if changed then update app_private.experiments set data_revision=data_revision+1 where experiment_id=eid; end if;
    result:=jsonb_build_object('items',rows);
  when 'api_set_assignment_state' then
    perform app_private.version((p_input->>'expected_version')::integer,a.edit_version); target:=p_input->>'state';
    perform app_private.assert(app_private.trim_text(p_input->>'reason')<>'');
    perform app_private.assert(e.status in ('published','closed'),'EXPERIMENT_NOT_OPEN');
    if target='active' then perform app_private.require_open(e,v); perform app_private.assert(exists(select 1 from app_private.profiles where user_id=a.user_id and state='active'),'FORBIDDEN'); end if;
    if a.state<>target then update app_private.experiments set data_revision=data_revision+1 where experiment_id=eid; end if;
    update app_private.assignments set state=target,edit_version=edit_version+1,revoked_at=case when target='revoked' then now() else null end where assignment_id=aid returning * into a;
    result:=jsonb_build_object('assignment_id',aid,'state',a.state,'edit_version',a.edit_version);
  when 'api_accept_assignment_notice' then
    perform app_private.assert((p_input->>'config_version_id')::uuid=a.config_version_id and p_input->>'privacy_notice_version'=v.privacy_notice_version,'CONSENT_REQUIRED');
    update app_private.assignments set consented_at=coalesce(consented_at,now()) where assignment_id=aid returning * into a;
    result:=jsonb_build_object('consented_at',a.consented_at);
  when 'api_get_assignment' then
    result:=jsonb_build_object('assignment_id',aid,'experiment_id',eid,'user_id',a.user_id,'created_at',a.created_at,'experiment',jsonb_build_object('experiment_id',eid,'status',e.status,'edit_version',e.edit_version,'data_revision',e.data_revision,'config_version_id',e.config_version_id,'created_at',e.created_at,'published_at',e.published_at,'closed_at',e.closed_at,'privacy_notice_version',v.privacy_notice_version,'privacy_notice',v.privacy_notice,'retention_policy',v.retention_policy,'collection_ends_at',app_private.end_at(e,v)),'state',a.state,'edit_version',a.edit_version,'config_version_id',a.config_version_id,'config',app_private.projection(v.config),'privacy_notice_version',v.privacy_notice_version,'privacy_notice',v.privacy_notice,'retention_policy',v.retention_policy,'consented_at',a.consented_at,'experiment_status',e.status,'collection_ends_at',app_private.end_at(e,v),'responses',coalesce((select jsonb_agg(app_private.response_summary(rs)) from app_private.responses rs where rs.assignment_id=aid),'[]'));
  when 'api_list_my_assignments','api_list_experiment_progress' then
    select coalesce(jsonb_agg(z.dto order by z.created_at,z.assignment_id),'[]') into rows from (
      select a.created_at,a.assignment_id,jsonb_build_object('id',a.assignment_id,'assignment_id',a.assignment_id,'experiment_id',a.experiment_id,'user_id',a.user_id,'created_at',a.created_at,'consented_at',a.consented_at,'privacy_notice_version',a.privacy_notice_version,'state',a.state,'edit_version',a.edit_version,'config_version_id',a.config_version_id,'title',e.draft_config#>>'{experiment,title}','experiment_status',e.status,'participant_code',p.participant_code,'profile_state',p.state,'sample_count',jsonb_array_length(v.config->'samples'),'submitted_count',(select count(*) from app_private.responses r where r.assignment_id=a.assignment_id and r.state='submitted'),'responses',coalesce((select jsonb_agg(app_private.response_summary(r)) from app_private.responses r where r.assignment_id=a.assignment_id),'[]')) dto
      from app_private.assignments a join app_private.experiments e using(experiment_id) join app_private.experiment_versions v on v.config_version_id=a.config_version_id join app_private.profiles p on p.user_id=a.user_id
      where ((p_operation='api_list_my_assignments' and a.user_id=actor and (p_input->>'state' is null or a.state=p_input->>'state')) or (p_operation='api_list_experiment_progress' and a.experiment_id=eid)) and (a.created_at,a.assignment_id)>(after_time,after_id) order by a.created_at,a.assignment_id limit lim+1
    ) z; result:=app_private.page(rows,lim);
  when 'api_get_response' then
    perform app_private.assert(exists(select 1 from jsonb_array_elements(v.config->'samples') z where z->>'sample_id'=p_input->>'sample_id'));
    select * into r from app_private.responses where assignment_id=aid and sample_id=p_input->>'sample_id';
    result:=case when r.response_id is null then 'null'::jsonb else jsonb_build_object('response_id',r.response_id,'assignment_id',aid,'sample_id',r.sample_id,'state',r.state,'answers',r.draft_answers,'edit_version',r.edit_version,'latest_revision_id',r.latest_revision_id,'return_reason',r.return_reason,'saved_at',r.saved_at) end;
  when 'api_save_response_draft','api_submit_response' then
    perform app_private.require_open(e,v);
    perform app_private.assert(a.consented_at is not null and a.privacy_notice_version=v.privacy_notice_version,'CONSENT_REQUIRED');
    perform app_private.assert((p_input->>'config_version_id')::uuid=a.config_version_id);
    perform app_private.assert(exists(select 1 from jsonb_array_elements(v.config->'samples') z where z->>'sample_id'=p_input->>'sample_id'));
    perform app_private.validate_answers(v.config,p_input->'answers',p_operation='api_submit_response');
    select * into r from app_private.responses where assignment_id=aid and sample_id=p_input->>'sample_id' for update;
    new_row:=not found;
    perform app_private.version((p_input->>'expected_version')::integer,case when new_row then 0 else r.edit_version end);
    if new_row then
      insert into app_private.responses(assignment_id,sample_id,draft_answers) values(aid,p_input->>'sample_id',p_input->'answers') returning * into r;
    else
      perform app_private.assert(r.state<>'submitted','RESPONSE_LOCKED');
      update app_private.responses set draft_answers=p_input->'answers',edit_version=edit_version+1,saved_at=now() where response_id=r.response_id returning * into r;
    end if;
    if p_operation='api_submit_response' then
      select coalesce(max(revision_no),0)+1 into counter from app_private.response_revisions where response_id=r.response_id;
      insert into app_private.response_revisions(response_id,revision_no,response_edit_version,answers,config_version_id,submitted_by,idempotency_key) values(r.response_id,counter,r.edit_version,p_input->'answers',a.config_version_id,actor,kid) returning * into rev;
      update app_private.responses set state='submitted',latest_revision_id=rev.revision_id,return_reason=null where response_id=r.response_id;
      result:=jsonb_build_object('response_id',r.response_id,'revision_id',rev.revision_id,'revision_no',rev.revision_no,'submitted_at',rev.submitted_at,'edit_version',r.edit_version);
    else result:=jsonb_build_object('response_id',r.response_id,'state',r.state,'edit_version',r.edit_version,'saved_at',r.saved_at); end if;
    if new_row or p_operation='api_submit_response' then update app_private.experiments set data_revision=data_revision+1 where experiment_id=eid; end if;
  when 'api_return_response' then
    perform app_private.require_open(e,v); perform app_private.assert(a.state='active','ASSIGNMENT_REVOKED');
    perform app_private.assert(exists(select 1 from app_private.profiles where user_id=a.user_id and state='active'),'FORBIDDEN');
    perform app_private.version((p_input->>'expected_version')::integer,r.edit_version); perform app_private.assert(r.state='submitted','RESPONSE_LOCKED'); perform app_private.assert(app_private.trim_text(p_input->>'reason')<>'');
    select * into rev from app_private.response_revisions where revision_id=r.latest_revision_id;
    update app_private.responses set state='returned',draft_answers=rev.answers,edit_version=edit_version+1,return_reason=p_input->>'reason',saved_at=now() where response_id=rid returning * into r;
    update app_private.experiments set data_revision=data_revision+1 where experiment_id=eid;
    result:=jsonb_build_object('response_id',rid,'state',r.state,'edit_version',r.edit_version,'returned_at',r.saved_at);
  when 'api_list_response_revisions' then
    select coalesce(jsonb_agg(z.dto order by z.submitted_at desc,z.revision_id desc),'[]') into rows from (select rr.submitted_at,rr.revision_id,jsonb_build_object('id',rr.revision_id,'created_at',rr.submitted_at,'revision_id',rr.revision_id,'revision_no',rr.revision_no,'submitted_at',rr.submitted_at) dto from app_private.response_revisions rr where rr.response_id=rid and (rr.submitted_at,rr.revision_id)<(after_time,after_id) order by rr.submitted_at desc,rr.revision_id desc limit lim+1) z;
    result:=app_private.page(rows,lim);
  when 'api_get_response_revision' then
    result:=jsonb_build_object('revision_id',rev.revision_id,'response_id',rev.response_id,'revision_no',rev.revision_no,'answers',rev.answers,'config_version_id',rev.config_version_id,'submitted_at',rev.submitted_at,'edit_version',rev.response_edit_version,'submitted_by',rev.submitted_by);
  when 'api_create_analysis_snapshot' then
    perform app_private.assert(v.config_version_id is not null,'EXPERIMENT_NOT_OPEN');
    perform app_private.assert(e.data_revision=(p_input->>'expected_data_revision')::integer,'DATA_CHANGED');
    select coalesce(jsonb_agg(jsonb_build_object('id',rr.revision_id,'created_at',rr.submitted_at,'participant_code',p.participant_code,'sample_id',r.sample_id,'response_id',r.response_id,'revision_id',rr.revision_id,'revision_no',rr.revision_no,'submitted_at',rr.submitted_at,'config_version_id',rr.config_version_id,'answers',rr.answers) order by p.participant_code,r.sample_id),'[]') into rows
    from app_private.assignments a join app_private.profiles p on p.user_id=a.user_id join app_private.responses r using(assignment_id) join app_private.response_revisions rr on rr.revision_id=r.latest_revision_id where a.experiment_id=eid and a.state='active' and p.state='active' and r.state='submitted' and rr.config_version_id=v.config_version_id;
    select coalesce(jsonb_agg(jsonb_build_object('participant_code',p.participant_code,'assignment_id',a.assignment_id,'assignment_state',a.state,'profile_state',p.state,'samples',(select jsonb_agg(jsonb_build_object('sample_id',s->>'sample_id','state',coalesce(r.state,'not_started'),'exclusion_reason',case when p.state<>'active' then 'account_disabled' when a.state='revoked' then 'assignment_revoked' when r.state is null then 'not_started' when r.state<>'submitted' then r.state else null end) order by n) from jsonb_array_elements(v.config->'samples') with ordinality z(s,n) left join app_private.responses r on r.assignment_id=a.assignment_id and r.sample_id=s->>'sample_id')) order by p.participant_code),'[]') into coverage from app_private.assignments a join app_private.profiles p on p.user_id=a.user_id where a.experiment_id=eid;
    c:=jsonb_build_object('mode','live','config',v.config,'config_hash',v.config_hash,'privacy_notice',v.privacy_notice,'retention_policy',v.retention_policy,'rows',rows,'coverage',coverage,'method_id','rm_gg_paired_t_holm_v1','alpha',0.05);
    c:=c||jsonb_build_object('excluded_revisions',coalesce((
      select jsonb_agg(jsonb_build_object('response_id',rr.response_id,'revision_id',rr.revision_id,'reason',case when rr.revision_id<>r.latest_revision_id then 'old_revision' when p.state<>'active' then 'account_disabled' when a.state='revoked' then 'assignment_revoked' when r.state<>'submitted' then r.state else 'config_mismatch' end) order by rr.revision_id)
      from app_private.response_revisions rr join app_private.responses r using(response_id) join app_private.assignments a using(assignment_id) join app_private.profiles p on p.user_id=a.user_id
      where a.experiment_id=eid and not (rr.revision_id=r.latest_revision_id and r.state='submitted' and a.state='active' and p.state='active' and rr.config_version_id=v.config_version_id)
    ),'[]'::jsonb));
    c:=c||jsonb_build_object('exclusion_counts',coalesce((select jsonb_object_agg(reason,n) from (select s->>'exclusion_reason' reason,count(*) n from jsonb_array_elements(coverage) z cross join lateral jsonb_array_elements(z->'samples') s where s->>'exclusion_reason' is not null group by s->>'exclusion_reason') q),'{}'::jsonb));
    insert into app_private.analysis_snapshots(experiment_id,config_version_id,data_revision,input_hash,frozen) values(eid,v.config_version_id,e.data_revision,app_private.hash(c),c) returning * into snapshot;
    result:=jsonb_build_object('snapshot_id',snapshot.snapshot_id,'data_revision',snapshot.data_revision,'input_hash',snapshot.input_hash,'config_version_id',snapshot.config_version_id,'created_at',snapshot.created_at);
  when 'api_get_analysis_snapshot' then
    select coalesce(jsonb_agg(value order by (value->>'created_at')::timestamptz,(value->>'id')::uuid),'[]') into rows from (select value from jsonb_array_elements(snapshot.frozen->'rows') where ((value->>'created_at')::timestamptz,(value->>'id')::uuid)>(after_time,after_id) order by (value->>'created_at')::timestamptz,(value->>'id')::uuid limit lim+1) z;
    result:=(snapshot.frozen-'rows')||jsonb_build_object('snapshot_id',snapshot.snapshot_id,'experiment_id',snapshot.experiment_id,'config_version_id',snapshot.config_version_id,'data_revision',snapshot.data_revision,'input_hash',snapshot.input_hash,'created_at',snapshot.created_at,'rows',app_private.page(rows,lim));
  when 'api_record_export' then
    result:=jsonb_build_object('audit_event_id',req,'snapshot_id',snapshot.snapshot_id,'status','initiated');
  else perform app_private.deny('FORBIDDEN'); end case;

  result:=jsonb_build_object('ok',true,'data',result,'request_id',req);
  if is_write then
    insert into app_private.audit_events(event_id,actor_id,action,object_id,reason,metadata,request_id) values(req,actor,p_operation,coalesce(eid,aid,rid),p_input->>'reason',case when p_operation='api_record_export' then jsonb_build_object('snapshot_id',snapshot.snapshot_id,'format',p_input->>'format','dataset_kind',p_input->>'dataset_kind','response_count',jsonb_array_length(snapshot.frozen->'rows'),'numeric_row_count',(select coalesce(sum(jsonb_array_length(z#>'{answers,numeric}')),0) from jsonb_array_elements(snapshot.frozen->'rows') z),'text_row_count',(select coalesce(sum(jsonb_array_length(z#>'{answers,text}')),0) from jsonb_array_elements(snapshot.frozen->'rows') z)) else '{}'::jsonb end,req);
    insert into app_private.idempotency_requests(actor_id,operation,idempotency_key,input_hash,result,experiment_id) values(actor,p_operation,kid,hash,result,eid);
  end if;
  return result;
exception
  when sqlstate 'P0001' then
    err:=sqlerrm::jsonb;
    return jsonb_build_object('ok',false,'error',err||jsonb_build_object('message','操作未完成，请检查权限、输入与最新状态。','retryable',err->>'code' in ('SERVICE_UNAVAILABLE','RATE_LIMITED')),'request_id',req);
  when invalid_text_representation or invalid_parameter_value or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','VALIDATION_FAILED','message','输入不符合要求。','retryable',false),'request_id',req);
  when others then
    -- The exception block rolls back every mutation made by this invocation.
    return jsonb_build_object('ok',false,'error',jsonb_build_object('code','SERVICE_UNAVAILABLE','message','真实服务暂时不可用。','retryable',true),'request_id',req);
end $$;
commit;




