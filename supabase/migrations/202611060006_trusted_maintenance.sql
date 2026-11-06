begin;
-- These functions are intentionally outside the exposed schema and have no API
-- grants. Run them only through the owner's trusted SQL maintenance connection.
create function app_private.grant_admin(p_user uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(721931,1);
  perform app_private.assert(app_private.trim_text(p_reason)<>'' and exists(select 1 from app_private.profiles where user_id=p_user and state='active'));
  update app_private.user_roles set role='admin' where user_id=p_user;
  insert into app_private.audit_events(actor_id,action,object_id,reason,request_id) values(null,'trusted_grant_admin',p_user,p_reason,gen_random_uuid());
end $$;
create function app_private.purge_experiment(p_experiment uuid,p_backup_manifest_receipt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.experiments; v app_private.experiment_versions; n integer; batch uuid; begin
  perform pg_advisory_xact_lock(721931,1);
  perform app_private.assert(app_private.trim_text(p_backup_manifest_receipt)<>'');
  select * into e from app_private.experiments where experiment_id=p_experiment for update;
  perform app_private.assert(found,'NOT_FOUND');
  select * into v from app_private.experiment_versions where config_version_id=e.config_version_id;
  perform app_private.assert(v.config_version_id is not null and statement_timestamp()>=app_private.end_at(e,v)+make_interval(days=>(v.retention_policy->>'retention_days')::integer),'EXPERIMENT_NOT_OPEN');
  select count(*) into n from app_private.responses r join app_private.assignments a using(assignment_id) where a.experiment_id=p_experiment;
  delete from app_private.analysis_snapshots where experiment_id=p_experiment;
  delete from app_private.idempotency_requests where experiment_id=p_experiment;
  delete from app_private.audit_events where object_id=p_experiment;
  update app_private.responses set latest_revision_id=null where assignment_id in (select assignment_id from app_private.assignments where experiment_id=p_experiment);
  delete from app_private.response_revisions where response_id in (select r.response_id from app_private.responses r join app_private.assignments a using(assignment_id) where a.experiment_id=p_experiment);
  delete from app_private.responses where assignment_id in (select assignment_id from app_private.assignments where experiment_id=p_experiment);
  delete from app_private.assignments where experiment_id=p_experiment;
  update app_private.experiments set config_version_id=null where experiment_id=p_experiment;
  delete from app_private.experiment_versions where experiment_id=p_experiment;
  delete from app_private.experiments where experiment_id=p_experiment;
  insert into app_private.cleanup_batches(scope,removed_count) values('expired_experiment',n) returning batch_id into batch;
  delete from app_private.audit_events where created_at<now()-interval '180 days';
  delete from app_private.cleanup_batches where created_at<now()-interval '180 days';
  return jsonb_build_object('batch_id',batch,'removed_responses',n,'active_database_purged',true,'backup_replay_required',true);
end $$;

alter table app_private.experiment_versions alter column published_by drop not null;
alter table app_private.experiment_versions drop constraint experiment_versions_published_by_fkey;
alter table app_private.experiment_versions add foreign key(published_by) references app_private.profiles(user_id) on delete set null;

create function app_private.fulfill_deletion(p_request uuid,p_backup_manifest_receipt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; affected_experiments uuid[]; n integer; batch uuid; begin
  perform pg_advisory_xact_lock(721931,1);
  perform app_private.assert(app_private.trim_text(p_backup_manifest_receipt)<>'');
  select user_id into u from app_private.deletion_requests where request_id=p_request and status='pending' for update;
  perform app_private.assert(found,'NOT_FOUND');
  if app_private.is_admin(u) then
    perform app_private.assert((select count(*) from app_private.user_roles r join app_private.profiles p using(user_id) where r.role='admin' and p.state='active')>1,'FORBIDDEN');
  end if;
  update app_private.profiles set state='disabled' where user_id=u;
  select coalesce(array_agg(experiment_id),'{}') into affected_experiments from app_private.assignments where user_id=u;
  update app_private.experiments set data_revision=data_revision+1 where experiment_id=any(affected_experiments);
  select count(*) into n from app_private.responses r join app_private.assignments a using(assignment_id) where a.user_id=u;
  -- Snapshots and cached receipts can reconstruct old identities/answers, so
  -- invalidate all affected experiments' snapshots instead of filtering JSON.
  delete from app_private.analysis_snapshots where experiment_id=any(affected_experiments);
  delete from app_private.idempotency_requests where actor_id=u or experiment_id=any(affected_experiments);
  delete from app_private.audit_events where actor_id=u or object_id=u or object_id=any(affected_experiments);
  update app_private.responses set latest_revision_id=null where assignment_id in (select assignment_id from app_private.assignments where user_id=u);
  delete from app_private.response_revisions where submitted_by=u or response_id in (select r.response_id from app_private.responses r join app_private.assignments a using(assignment_id) where a.user_id=u);
  delete from app_private.responses where assignment_id in (select assignment_id from app_private.assignments where user_id=u);
  delete from app_private.assignments where user_id=u;
  delete from app_private.deletion_requests where user_id=u;
  delete from app_private.profiles where user_id=u;
  insert into app_private.cleanup_batches(scope,removed_count) values('verified_personal_deletion',n) returning batch_id into batch;
  delete from app_private.audit_events where created_at<now()-interval '180 days';
  delete from app_private.cleanup_batches where created_at<now()-interval '180 days';
  return jsonb_build_object('batch_id',batch,'removed_responses',n,'active_business_data_purged',true,'auth_identity_deletion_required',true,'backup_replay_required',true);
end $$;
revoke all on all functions in schema app_private from public, anon, authenticated;
commit;
