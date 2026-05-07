\set ON_ERROR_STOP on

begin;

create temp table import_c_dev_projects (
  display_name text not null,
  slug text not null,
  source_workspace_path text not null,
  repo_remote text
) on commit drop;

insert into import_c_dev_projects (display_name, slug, source_workspace_path, repo_remote)
values
  ('.skills', 'skills', 'C:\Dev\.skills', null),
  ('_tmp_ecc', 'tmp-ecc', 'C:\Dev\_tmp_ecc', 'https://github.com/affaan-m/everything-claude-code.git'),
  ('Allvibes', 'allvibes', 'C:\Dev\Allvibes', null),
  ('ASF', 'asf', 'C:\Dev\ASF', null),
  ('audit', 'audit', 'C:\Dev\audit', null),
  ('BHM', 'bhm', 'C:\Dev\BHM', 'https://github.com/stevenshelley58-afk/bhm-website'),
  ('BHM Pulse', 'bhm-pulse', 'C:\Dev\BHM Pulse', 'https://github.com/stevenshelley58-afk/bhm-pulse.git'),
  ('bhm-preview.EMdWGQ', 'bhm-preview-emdwgq', 'C:\Dev\bhm-preview.EMdWGQ', null),
  ('bhm-preview.Ym5Tap', 'bhm-preview-ym5tap', 'C:\Dev\bhm-preview.Ym5Tap', null),
  ('bhm-pulse-release-main-jIiuGD', 'bhm-pulse-release-main-jiiugd', 'C:\Dev\bhm-pulse-release-main-jIiuGD', 'https://github.com/stevenshelley58-afk/bhm-pulse.git'),
  ('BIS', 'bis', 'C:\Dev\BIS', null),
  ('Blockwise', 'blockwise', 'C:\Dev\Blockwise', null),
  ('catalog-auditor', 'catalog-auditor', 'C:\Dev\catalog-auditor', null),
  ('CC Mirror', 'cc-mirror', 'C:\Dev\CC Mirror', null),
  ('Dashboard', 'dashboard', 'C:\Dev\Dashboard', 'https://github.com/stevenshelley58-afk/Dashboard.git'),
  ('Devo', 'devo', 'C:\Dev\Devo', null),
  ('Dream Crusher 9000', 'dream-crusher-9000', 'C:\Dev\Dream Crusher 9000', null),
  ('ecc-reference', 'ecc-reference', 'C:\Dev\ecc-reference', 'https://github.com/affaan-m/everything-claude-code.git'),
  ('Em Box', 'em-box', 'C:\Dev\Em Box', null),
  ('everything-claude-code', 'everything-claude-code', 'C:\Dev\everything-claude-code', 'https://github.com/affaan-m/everything-claude-code.git'),
  ('Frank', 'frank', 'C:\Dev\Frank', 'https://github.com/stevenshelley58-afk/frank.git'),
  ('Frank-stage3-task-execution-foundation', 'frank-stage3-task-execution-foundation', 'C:\Dev\Frank-stage3-task-execution-foundation', null),
  ('hunter', 'hunter', 'C:\Dev\hunter', null),
  ('HyperFrames', 'hyperframes', 'C:\Dev\HyperFrames', null),
  ('Jenny', 'jenny', 'C:\Dev\Jenny', 'https://github.com/stevenshelley58-afk/Jenny'),
  ('Labcast Audit', 'labcast-audit', 'C:\Dev\Labcast Audit', 'https://github.com/stevenshelley58-afk/labcast-audit.git'),
  ('lcaudit', 'lcaudit', 'C:\Dev\lcaudit', 'https://github.com/stevenshelley58-afk/lcaudit.git'),
  ('lcbuilder', 'lcbuilder', 'C:\Dev\lcbuilder', 'https://github.com/stevenshelley58-afk/lcbuilder.git'),
  ('Liss', 'liss', 'C:\Dev\Liss', 'https://github.com/stevenshelley58-afk/liss.git'),
  ('marketingskills', 'marketingskills', 'C:\Dev\marketingskills', 'https://github.com/coreyhaines31/marketingskills.git'),
  ('Master', 'master', 'C:\Dev\Master', 'https://github.com/stevenshelley58-afk/master.git'),
  ('Mirror', 'mirror', 'C:\Dev\Mirror', null),
  ('Planner', 'planner', 'C:\Dev\Planner', null),
  ('Render Vault Gemini', 'render-vault-gemini', 'C:\Dev\Render Vault Gemini', 'https://github.com/stevenshelley58-afk/redner-vault'),
  ('Review', 'review', 'C:\Dev\Review', null),
  ('See It', 'see-it', 'C:\Dev\See It', null),
  ('See It - Copy', 'see-it-copy', 'C:\Dev\See It - Copy', null),
  ('See-It', 'see-it-2', 'C:\Dev\See-It', null),
  ('See-It Old', 'see-it-old', 'C:\Dev\See-It Old', 'https://github.com/stevenshelley58-afk/See-It.git'),
  ('snappa', 'snappa', 'C:\Dev\snappa', null),
  ('Stack Calculator', 'stack-calculator', 'C:\Dev\Stack Calculator', null),
  ('Storeworks', 'storeworks', 'C:\Dev\Storeworks', null),
  ('Storeworks Catalog', 'storeworks-catalog', 'C:\Dev\Storeworks Catalog', null),
  ('temp', 'temp', 'C:\Dev\temp', null),
  ('Theme', 'theme', 'C:\Dev\Theme', null),
  ('wetblob', 'wetblob', 'C:\Dev\wetblob', 'https://github.com/stevenshelley58-afk/wetblob.git');

\if :dry_run
select
  count(*) as planned_project_count,
  count(repo_remote) as planned_repo_remote_count
from import_c_dev_projects;

select
  slug,
  display_name,
  '/opt/frank-projects/' || slug as workspace_path,
  repo_remote
from import_c_dev_projects
order by slug;

rollback;
\else
with upserted as (
  insert into projects (
    slug,
    display_name,
    workspace_path,
    repo_remote,
    backup_policy,
    metadata
  )
  select
    slug,
    display_name,
    '/opt/frank-projects/' || slug,
    repo_remote,
    'local_vps',
    jsonb_strip_nulls(
      jsonb_build_object(
        'source', 'c-dev-inventory',
        'sourceHost', 'windows-dev',
        'sourceWorkspacePath', source_workspace_path,
        'repoRemote', repo_remote
      )
    )
  from import_c_dev_projects
  on conflict (slug) do update set
    display_name = excluded.display_name,
    repo_remote = excluded.repo_remote,
    metadata = projects.metadata || excluded.metadata,
    updated_at = now()
  where projects.display_name is distinct from excluded.display_name
    or projects.repo_remote is distinct from excluded.repo_remote
    or projects.metadata is distinct from projects.metadata || excluded.metadata
  returning slug
),
audit_insert as (
  insert into audit_log (
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    outcome,
    metadata
  )
  select
    'system',
    'dev/c-dev-projects.seed.sql',
    'project.import',
    'project',
    'c-dev-inventory',
    'success',
    jsonb_build_object(
      'source', 'c-dev-inventory',
      'changedProjectCount', count(*),
      'slugs', jsonb_agg(slug order by slug)
    )
  from upserted
  having count(*) > 0
  returning id
)
select
  (select count(*) from import_c_dev_projects) as manifest_project_count,
  (select count(*) from upserted) as changed_project_count,
  (select count(*) from audit_insert) as audit_events_written;

commit;
\endif
