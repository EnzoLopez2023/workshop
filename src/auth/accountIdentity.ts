export interface MicrosoftAccountIdentity {
  name?: string;
  username?: string;
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
