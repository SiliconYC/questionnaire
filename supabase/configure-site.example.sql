-- Run only in the trusted SQL console after replacing every placeholder.
-- This template deliberately leaves production readiness false.
update app_private.site_settings set
  ready=false,
  notice_version='REPLACE_WITH_NOTICE_VERSION',
  notice=jsonb_build_object(
    'purpose','REPLACE_WITH_ACTUAL_PURPOSE_AND_DATA_CATEGORIES',
    'controller','REPLACE_WITH_ACTUAL_CONTROLLER',
    'contact','REPLACE_WITH_ACTUAL_CONTACT',
    'providers','REPLACE_WITH_ACTUAL_PROVIDERS',
    'region','REPLACE_WITH_ACTUAL_PROJECT_REGION',
    'retention','REPLACE_WITH_RETENTION_AND_BACKUP_ROTATION',
    'deletion','REPLACE_WITH_WITHDRAWAL_AND_DELETION_CHANNEL',
    'downloads','REPLACE_WITH_DOWNLOADED_FILE_RESPONSIBILITY'
  ),
  retention_days=180,
  max_collection_days=365,
  max_participants=100
where singleton;
