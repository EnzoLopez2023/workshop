import { execFileSync } from 'node:child_process';

const ALERT_NAME = 'alert-workshop-offhost-backup-stale';
const ACTION_GROUP = 'ag-recovery-alerts';
const WORKSPACE = 'log-recovery-prod';
const WEBAPP = 'app-workshop-prod-lwxhu7jxlrbtu';

export function validateMonitor({ alert, actionGroup, webapp = WEBAPP }) {
  const query = (alert.criteria?.allOf ?? [])
    .map(criterion => criterion.query ?? '')
    .join('\n')
    .toLowerCase();
  const scopes = alert.scopes ?? [];
  if (webapp !== WEBAPP) throw new Error(`monitor check is scoped only to ${WEBAPP}`);
  if (alert.enabled !== true || Number(alert.severity) !== 1) throw new Error('Workshop recovery alert must be enabled at severity 1');
  if (!JSON.stringify(scopes).toLowerCase().includes(WORKSPACE)) throw new Error('Workshop recovery alert is not scoped to log-recovery-prod');
  if (
    !query.includes('workshop/v1/monitoring/daily/')
    || !query.includes('workshop/v1/monitoring/monthly/')
    || !query.includes('_health[.]json')
  ) {
    throw new Error('Workshop recovery alert must contain daily/monthly _HEALTH queries');
  }
  const actionGroups = JSON.stringify(alert.actions?.actionGroups ?? alert.actionGroups ?? []).toLowerCase();
  if (!actionGroups.includes(ACTION_GROUP)) throw new Error('Workshop recovery alert is not wired to ag-recovery-alerts');
  if (actionGroup.enabled !== true || !String(actionGroup.id ?? '').toLowerCase().endsWith(`/actiongroups/${ACTION_GROUP}`)) {
    throw new Error('ag-recovery-alerts is missing or disabled');
  }
  return true;
}

export function runAzure(args) {
  return JSON.parse(execFileSync('az', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) values[args[index]?.replace(/^--/, '')] = args[index + 1];
  if (!['predeploy', 'postdeploy', 'rollback', 'initial-predeploy', 'initial-postdeploy'].includes(values.phase)) {
    throw new Error('a supported --phase is required');
  }
  if (!values['resource-group'] || !values.webapp) throw new Error('--resource-group and --webapp are required');
  return values;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const alert = runAzure(['monitor', 'scheduled-query', 'show', '--resource-group', args['resource-group'], '--name', ALERT_NAME, '--output', 'json']);
    const actionGroup = runAzure(['monitor', 'action-group', 'show', '--resource-group', args['resource-group'], '--name', ACTION_GROUP, '--output', 'json']);
    validateMonitor({ alert, actionGroup, webapp: args.webapp });
    console.log(`monitor checks passed for ${args.phase}`);
  } catch (error) {
    console.error(`monitor check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
