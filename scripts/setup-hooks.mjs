#!/usr/bin/env node
// Point git at the repo's tracked hooks dir so the build-number bump runs on
// every commit. Invoked by the `prepare` npm script, so a fresh `npm install`
// wires it up automatically. No-ops outside a git checkout (e.g. CI / Docker,
// where .git is absent), so it never breaks an install or image build.
import { execSync } from 'child_process';

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
  console.log('[setup-hooks] core.hooksPath → .githooks');
} catch {
  // Not a git working tree — nothing to wire up.
}
