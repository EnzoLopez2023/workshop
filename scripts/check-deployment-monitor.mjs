import { execFileSync } from 'node:child_process';

const ALERT_NAME = 'alert-workshop-offhost-backup-stale';
const WEBAPP = 'app-workshop-prod-lwxhu7jxlrbtu';

export function validateMonitor({ alert, webapp = WEBAPP }) {
  if (webapp !== WEBAPP) throw new Error(`monitor check is scoped only to ${WEBAPP}`);
  if (alert) throw new Error('Workshop recovery alert must remain absent under the alert-free production policy');
  return true;
}

export function runAzure(args) {
  return JSON.parse(execFileSync('az', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

export function inspectMonitor({ resourceGroup, webapp }, azure = runAzure) {
  if (webapp !== WEBAPP) throw new Error(`monitor check is scoped only to ${WEBAPP}`);
  const alerts = azure([
    'resource', 'list',
    '--resource-group', resourceGroup,
    '--resource-type', 'Microsoft.Insights/scheduledQueryRules',
    '--query', `[?name=='${ALERT_NAME}']`,
    '--output', 'json',
  ]);
  if (!Array.isArray(alerts)) throw new Error('Azure monitoring inventory is not an array');
  return { alert: alerts[0] ?? null, webapp };
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
    const inventory = inspectMonitor({ resourceGroup: args['resource-group'], webapp: args.webapp });
    // Emit evidence only after a real inventory read. Failed Azure queries
    // leave no report, so diagnostics cannot mistake them for a clean policy.
    console.log(JSON.stringify({
      phase: args.phase,
      webapp: args.webapp,
      policy: 'local-only-no-paid-monitoring',
      retiredAlertPresent: inventory.alert !== null,
    }));
    validateMonitor(inventory);
  } catch (error) {
    console.error(`monitor check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
