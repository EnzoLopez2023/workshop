import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  getDeletionScopeCopy,
  getWebAccountSummary,
} from '../src/auth/accountIdentity.ts';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('web account summaries label Microsoft accounts without exposing raw identifiers', () => {
  assert.deepEqual(
    getWebAccountSummary({ name: '  Ada Lovelace  ', username: 'ada@example.com' }),
    {
      displayName: 'Ada Lovelace',
      secondaryLabel: 'ada@example.com',
      providerLabel: 'Microsoft',
    },
  );
  assert.deepEqual(
    getWebAccountSummary({ name: ' ', username: 'maker@example.com' }),
    {
      displayName: 'maker@example.com',
      secondaryLabel: null,
      providerLabel: 'Microsoft',
    },
  );
  assert.deepEqual(
    getWebAccountSummary(null),
    {
      displayName: 'Signed-in Workshop account',
      secondaryLabel: null,
      providerLabel: 'Not available',
    },
  );
});

test('deletion scope copy covers known-provider and safe fallback states', () => {
  assert.equal(
    getDeletionScopeCopy('Microsoft'),
    'Deleting this account affects only the Microsoft workspace shown above. A separate Apple workspace and its data are not deleted.',
  );
  assert.equal(
    getDeletionScopeCopy('Not available'),
    'Deleting this account affects only the currently authenticated provider workspace. A workspace created with another provider and its data are not deleted.',
  );
});

test('sign-in and account surfaces disclose the provider-scoped workspace boundary', async () => {
  const [landing, settings] = await Promise.all([
    readSource('src/auth/LandingPage.tsx'),
    readSource('src/pages/Settings.tsx'),
  ]);

  assert.match(landing, /Use the same sign-in provider each time to return to the same workspace\./);
  assert.match(landing, /Choosing Sign in with Apple in the iOS app creates a separate workspace\./);
  assert.match(landing, /Apple and Microsoft accounts are not linked or merged\./);
  assert.match(landing, /role="note"[\s\S]*aria-label="How sign-in affects your workspace"/);

  assert.match(settings, /<dt>Current provider<\/dt>/);
  assert.match(settings, /Sign in with the same provider again to return to this workspace\./);
  assert.match(settings, /Choosing another provider creates a separate workspace/);
  assert.match(settings, /Apple and[\s\S]*Microsoft accounts are not linked or merged\./);
  assert.doesNotMatch(settings, /localAccountId|homeAccountId|idTokenClaims|\boid\b|\bsub\b/);
});

test('account deletion keeps the authenticated-workspace lifecycle intact', async () => {
  const [settings, api] = await Promise.all([
    readSource('src/pages/Settings.tsx'),
    readSource('src/services/api.ts'),
  ]);

  assert.match(api, /request<\{ success: true \}>\('\/account', \{ method: 'DELETE' \}\)/);
  assert.match(settings, /if \(deleting \|\| demo\) return/);
  assert.ok(settings.indexOf('await deleteAccount()') < settings.indexOf('await instance.logoutRedirect'));
  assert.match(settings, /instance\.setActiveAccount\(null\)/);
  assert.match(settings, /await instance\.clearCache\(account \? \{ account \} : undefined\)/);
  assert.match(settings, /window\.location\.replace\('\/'\)/);
  assert.match(settings, /\{!demo && \(\s*<div className="settings-danger-zone">/);
  assert.match(settings, /getDeletionScopeCopy\(accountSummary\.providerLabel\)/);
});
