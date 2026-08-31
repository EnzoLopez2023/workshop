import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  getDeletionScopeCopy,
  getMicrosoftAccountType,
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

test('Microsoft account summaries distinguish personal and organizational identities', () => {
  assert.equal(
    getMicrosoftAccountType({ tenantId: '9188040D-6C67-4C5B-B112-36A304B66DAD' }),
    'Personal Microsoft account',
  );
  assert.equal(
    getMicrosoftAccountType({ tenantId: '52188f12-db6b-46c6-88ff-08c802f0ed3b' }),
    'Work or school account',
  );
  assert.equal(getMicrosoftAccountType(null), 'Microsoft account');
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

test('sign-in and account surfaces disclose the exact identity workspace boundary', async () => {
  const [landing, settings, authGuard, msalConfig, main, appShell, api, apiToken, tabloomToken] = await Promise.all([
    readSource('src/auth/LandingPage.tsx'),
    readSource('src/pages/Settings.tsx'),
    readSource('src/auth/AuthGuard.tsx'),
    readSource('src/auth/msalConfig.ts'),
    readSource('src/main.tsx'),
    readSource('src/components/AppShell.tsx'),
    readSource('src/services/api.ts'),
    readSource('src/auth/getToken.ts'),
    readSource('src/auth/getTabloomToken.ts'),
  ]);

  assert.match(landing, /Use the same Microsoft account each time to return to your workspace\./);
  assert.match(landing, /Another Microsoft identity opens a separate workspace/);
  assert.match(landing, /even if it shows[\s\S]*the same email address/);
  assert.match(landing, /Apple and Microsoft accounts are not linked\./);
  assert.match(landing, /role="note"[\s\S]*aria-label="How sign-in affects your workspace"/);

  assert.match(settings, /<dt>Current provider<\/dt>/);
  assert.match(settings, /<dt>Account type<\/dt>/);
  assert.match(settings, /Sign in with this same Microsoft account to return to this workspace\./);
  assert.match(settings, /Another Microsoft identity opens a separate workspace/);
  assert.match(settings, /Switch account/);
  assert.doesNotMatch(settings, /localAccountId|homeAccountId|idTokenClaims|\boid\b|\bsub\b/);

  assert.match(msalConfig, /prompt: 'select_account'/);
  assert.match(main, /EventType\.LOGIN_SUCCESS/);
  assert.match(main, /EventType\.ACQUIRE_TOKEN_SUCCESS/);
  assert.match(main, /setActiveAccount\(result\.account\)/);
  assert.match(authGuard, /accounts\.length === 1/);
  assert.match(authGuard, /Choose your Workshop account/);
  assert.match(authGuard, /Use another Microsoft account/);
  assert.doesNotMatch(authGuard, /accounts\[0\][\s\S]*accounts\.length > 0/);
  assert.match(appShell, /instance\.getActiveAccount\(\)/);

  for (const source of [appShell, api, apiToken, tabloomToken]) {
    assert.doesNotMatch(source, /getAllAccounts\(\)\[0\]|accounts\[0\]/);
  }
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
