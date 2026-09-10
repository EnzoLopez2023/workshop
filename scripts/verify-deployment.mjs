const DEFAULTS = {
  attempts: 120,
  confirmations: 3,
  intervalMs: 5_000,
  requestTimeoutMs: 8_000,
  maxDurationMs: 600_000,
};

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--allow-legacy-build-id') {
      values.allowLegacyBuildId = true;
      continue;
    }
    if (key === '--allow-health-readiness') {
      values.allowHealthReadiness = true;
      continue;
    }
    if (!key?.startsWith('--') || args[index + 1] === undefined) {
      throw new Error(`invalid argument: ${key ?? ''}`);
    }
    values[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[index + 1];
    index += 1;
  }
  for (const key of ['baseUrl', 'livePath', 'readyPath', 'expectedSha', 'expectedBuildId', 'profile']) {
    if (!values[key]) throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required`);
  }
  const parsed = {
    ...values,
    attempts: Number(values.attempts ?? DEFAULTS.attempts),
    confirmations: Number(values.confirmations ?? DEFAULTS.confirmations),
    intervalMs: Number(values.intervalMs ?? DEFAULTS.intervalMs),
    requestTimeoutMs: Number(values.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs),
    maxDurationMs: Number(values.maxDurationMs ?? DEFAULTS.maxDurationMs),
  };
  if (parsed.profile !== 'sqlite-one-worker') throw new Error('only the sqlite-one-worker profile is supported');
  if (!Number.isInteger(parsed.attempts) || parsed.attempts < 1) throw new Error('--attempts must be a positive integer');
  if (!Number.isInteger(parsed.confirmations) || parsed.confirmations < 3) throw new Error('--confirmations must be at least 3');
  if (!Number.isFinite(parsed.intervalMs) || parsed.intervalMs < 0) throw new Error('--interval-ms must be non-negative');
  if (!Number.isFinite(parsed.requestTimeoutMs) || parsed.requestTimeoutMs < 1) throw new Error('--request-timeout-ms must be positive');
  if (!Number.isInteger(parsed.maxDurationMs) || parsed.maxDurationMs < 1) throw new Error('--max-duration-ms must be a positive integer');
  return parsed;
}

function identity(body) {
  return body?.instanceId ?? body?.instance ?? body?.runtimeId;
}

async function requestJson(url, timeoutMs, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const path = new URL(url).pathname;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${path}`);
  }
  if (!String(response.headers.get('cache-control') ?? '').toLowerCase().includes('no-store')) {
    throw new Error(`${path} response is missing Cache-Control: no-store`);
  }
  return { body: await response.json(), status: response.status };
}

export async function verifyDeployment(options, {
  fetchImpl = fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = () => performance.now(),
} = {}) {
  const expected = { ...DEFAULTS, ...options };
  const deadline = now() + expected.maxDurationMs;
  const requestBudget = () => {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1) throw new Error('verification wall-clock deadline exhausted');
    return Math.min(expected.requestTimeoutMs, remaining);
  };
  let consecutive = 0;
  let candidateInstance = null;
  let lastError = 'no successful probe';
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= expected.attempts && now() < deadline; attempt += 1) {
    attemptsMade = attempt;
    const nonce = `${expected.runToken ?? 'deploy'}-${attempt}-${Date.now()}`;
    try {
      const separator = expected.baseUrl.includes('?') ? '&' : '?';
      const { body: live } = await requestJson(
        `${expected.baseUrl}${expected.livePath}${separator}nonce=${encodeURIComponent(nonce)}`,
        requestBudget(),
        fetchImpl,
      );
      const { body: ready, status: readyStatus } = await requestJson(
        `${expected.baseUrl}${expected.readyPath}${separator}nonce=${encodeURIComponent(nonce)}`,
        requestBudget(),
        fetchImpl,
      );
      if (now() >= deadline) throw new Error('verification wall-clock deadline exhausted');
      const liveInstance = identity(live);
      const readyInstance = identity(ready);
      const databaseReady = expected.allowHealthReadiness
        ? ready.db === '/home/data/workshop.db'
        : ready.dbRoot === '/home/data/users' && ready.database?.status === 'ready';
      const expectedIdentity = live.sha === expected.expectedSha
        && ready.sha === expected.expectedSha
        && (expected.allowLegacyBuildId
          ? !live.buildId && !ready.buildId
          : live.buildId === expected.expectedBuildId && ready.buildId === expected.expectedBuildId)
        && liveInstance
        && readyInstance === liveInstance
        && liveInstance !== expected.previousInstanceId;
      const valid = readyStatus === 200
        && live.status === 'ok'
        && ready.status === 'ok'
        && expectedIdentity
        && ready.db === '/home/data/workshop.db'
        && databaseReady;
      if (!valid) {
        throw new Error('identity, process, or SQLite readiness mismatch');
      }
      if (candidateInstance && candidateInstance !== readyInstance) consecutive = 0;
      candidateInstance = readyInstance;
      consecutive += 1;
      if (consecutive >= expected.confirmations) return { instanceId: candidateInstance, confirmations: consecutive };
    } catch (error) {
      consecutive = 0;
      candidateInstance = null;
      lastError = error.message;
    }
    const remaining = deadline - now();
    if (attempt < expected.attempts && remaining > 0) {
      await sleep(Math.min(expected.intervalMs, remaining));
    }
  }
  throw new Error(
    `deployment verification failed after ${attemptsMade} attempts${now() >= deadline ? ` (wall-clock limit ${expected.maxDurationMs}ms)` : ''}: ${lastError}`,
  );
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  verifyDeployment(parseArgs(process.argv.slice(2)))
    .then(result => console.log(`verified ${result.confirmations} rounds on ${result.instanceId}`))
    .catch(error => {
      console.error(`deployment verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}

export { parseArgs };
