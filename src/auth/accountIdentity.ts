export interface MicrosoftAccountIdentity {
  name?: string;
  username?: string;
  tenantId?: string;
}

export interface WebAccountSummary {
  displayName: string;
  secondaryLabel: string | null;
  providerLabel: 'Microsoft' | 'Not available';
}

const cleanLabel = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const PERSONAL_MICROSOFT_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

export function getMicrosoftAccountType(
  account: MicrosoftAccountIdentity | null | undefined,
): 'Personal Microsoft account' | 'Work or school account' | 'Microsoft account' {
  const tenantId = cleanLabel(account?.tenantId)?.toLowerCase();
  if (!tenantId) return 'Microsoft account';
  return tenantId === PERSONAL_MICROSOFT_TENANT_ID
    ? 'Personal Microsoft account'
    : 'Work or school account';
}

export function getWebAccountSummary(
  account: MicrosoftAccountIdentity | null | undefined,
): WebAccountSummary {
  const name = cleanLabel(account?.name);
  const username = cleanLabel(account?.username);

  return {
    displayName: name ?? username ?? 'Signed-in Workshop account',
    secondaryLabel: name && username && name !== username ? username : null,
    providerLabel: account ? 'Microsoft' : 'Not available',
  };
}

export function getDeletionScopeCopy(providerLabel: WebAccountSummary['providerLabel']) {
  return providerLabel === 'Microsoft'
    ? 'Deleting this account affects only the Microsoft workspace shown above. A separate Apple workspace and its data are not deleted.'
    : 'Deleting this account affects only the currently authenticated provider workspace. A workspace created with another provider and its data are not deleted.';
}
