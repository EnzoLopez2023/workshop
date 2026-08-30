import { execFileSync } from 'node:child_process';

const ALERT_NAME = 'alert-workshop-offhost-backup-stale';
const ACTION_GROUP = 'ag-recovery-alerts';
const WORKSPACE = 'log-recovery-prod';
const WEBAPP = 'app-workshop-prod-lwxhu7jxlrbtu';

export function validateMonitor({ alert, actionGroup, workspace, webapp = WEBAPP }) {
  if (webapp !== WEBAPP) throw new Error(`monitor check is scoped only to ${WEBAPP}`);
  if (alert) throw new Error('Workshop recovery alert must remain absent under the alert-free production policy');
  if (actionGroup.enabled !== true || !String(actionGroup.id ?? '').toLowerCase().endsWith(`/actiongroups/${ACTION_GROUP}`)) {
    throw new Error('ag-recovery-alerts is missing or disabled');
  }
  if (workspace?.name !== WORKSPACE) throw new Error('log-recovery-prod is missing');
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
    const alerts = runAzure([
      'resource', 'list',
      '--resource-group', args['resource-group'],
      '--resource-type', 'Microsoft.Insights/scheduledQueryRules',
      '--query', `[?name=='${ALERT_NAME}']`,
      '--output', 'json',
    ]);
    const alert = Array.isArray(alerts) ? alerts[0] ?? null : null;
    const actionGroup = runAzure(['monitor', 'action-group', 'show', '--resource-group', args['resource-group'], '--name', ACTION_GROUP, '--output', 'json']);
    const workspace = runAzure(['monitor', 'log-analytics', 'workspace', 'show', '--resource-group', args['resource-group'], '--workspace-name', WORKSPACE, '--output', 'json']);
    validateMonitor({ alert, actionGroup, workspace, webapp: args.webapp });
    console.log(`monitor checks passed for ${args.phase}`);
  } catch (error) {
    console.error(`monitor check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
