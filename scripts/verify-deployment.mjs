const DEFAULTS = {
  attempts: 120,
  confirmations: 3,
  intervalMs: 5_000,
  readinessGraceAttempts: 0,
  requestTimeoutMs: 8_000,
};

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--allow-legacy-build-id') {
      values.allowLegacyBuildId = true;
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
    readinessGraceAttempts: Number(
      values.readinessGraceAttempts ?? DEFAULTS.readinessGraceAttempts,
    ),
    requestTimeoutMs: Number(values.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs),
  };
  if (parsed.profile !== 'sqlite-one-worker') throw new Error('only the sqlite-one-worker profile is supported');
  if (!Number.isInteger(parsed.attempts) || parsed.attempts < 1) throw new Error('--attempts must be a positive integer');
  if (!Number.isInteger(parsed.confirmations) || parsed.confirmations < 3) throw new Error('--confirmations must be at least 3');
  if (!Number.isFinite(parsed.intervalMs) || parsed.intervalMs < 0) throw new Error('--interval-ms must be non-negative');
  if (!Number.isInteger(parsed.readinessGraceAttempts) || parsed.readinessGraceAttempts < 0) {
    throw new Error('--readiness-grace-attempts must be a non-negative integer');
  }
  if (!Number.isFinite(parsed.requestTimeoutMs) || parsed.requestTimeoutMs < 1) throw new Error('--request-timeout-ms must be positive');
  return parsed;
}

function identity(body) {
  return body?.instanceId ?? body?.instance ?? body?.runtimeId;
}

async function requestJson(url, timeoutMs, fetchImpl, { allowUnavailable = false } = {}) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const path = new URL(url).pathname;
  if (!response.ok && !(allowUnavailable && response.status === 503)) {
    throw new Error(`HTTP ${response.status} from ${path}`);
  }
  if (!String(response.headers.get('cache-control') ?? '').toLowerCase().includes('no-store')) {
    throw new Error(`${path} response is missing Cache-Control: no-store`);
  }
  return { body: await response.json(), status: response.status };
}

export async function verifyDeployment(options, {
  fetchImpl = fetch,
  logger = console,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  const expected = { ...DEFAULTS, ...options };
  const maximumAttempts = expected.attempts + expected.readinessGraceAttempts;
  let consecutive = 0;
  let candidateInstance = null;
  let lastError = 'no successful probe';
  let readinessGraceArmed = false;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    attemptsUsed = attempt;
    const nonce = `${expected.runToken ?? 'deploy'}-${attempt}-${Date.now()}`;
    let readinessTransition = false;
    try {
      const separator = expected.baseUrl.includes('?') ? '&' : '?';
      const { body: live } = await requestJson(
        `${expected.baseUrl}${expected.livePath}${separator}nonce=${encodeURIComponent(nonce)}`,
        expected.requestTimeoutMs,
        fetchImpl,
      );
      const { body: ready, status: readyStatus } = await requestJson(
        `${expected.baseUrl}${expected.readyPath}${separator}nonce=${encodeURIComponent(nonce)}`,
        expected.requestTimeoutMs,
        fetchImpl,
        { allowUnavailable: true },
      );
      const liveInstance = identity(live);
      const readyInstance = identity(ready);
      const databaseReady = expected.allowLegacyBuildId
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
        && databaseReady
        && ready.exporter === 'healthy';
      readinessTransition = readyStatus === 503
        && live.status === 'ok'
        && ready.status === 'unavailable'
        && expectedIdentity
        && ready.db === '/home/data/workshop.db'
        && databaseReady
        && ['starting', 'checking'].includes(ready.exporter);
      if (!valid) {
        if (readinessTransition) {
          throw new Error(`${expected.readyPath} is waiting for exporter=${ready.exporter}`);
        }
        throw new Error('identity, process, SQLite, or exporter readiness mismatch');
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
    if (
      attempt === expected.attempts
      && readinessTransition
      && expected.readinessGraceAttempts > 0
    ) {
      readinessGraceArmed = true;
      logger.info(
        `candidate identity and SQLite are ready; allowing up to `
        + `${expected.readinessGraceAttempts} additional exporter-readiness attempts`,
      );
    }
    if (attempt >= expected.attempts && !readinessGraceArmed) break;
    if (attempt > expected.attempts && !readinessTransition && consecutive === 0) break;
    if (attempt < maximumAttempts) await sleep(expected.intervalMs);
  }
  const graceSummary = readinessGraceArmed
    ? ` plus ${attemptsUsed - expected.attempts} exporter-readiness attempts`
    : '';
  throw new Error(
    `deployment verification failed after ${Math.min(attemptsUsed, expected.attempts)} attempts`
    + `${graceSummary}: ${lastError}`,
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
