/** Explorer and public source links. Every claim in the UI links to one of these. */
export const explorer = {
  object: (id: string) => `https://suiscan.xyz/mainnet/object/${id}`,
  account: (address: string) => `https://suiscan.xyz/mainnet/account/${address}`,
  tx: (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`,
  blob: (blobId: string) => `https://walruscan.com/mainnet/blob/${encodeURIComponent(blobId)}`,
} as const;

/** Walrus's own public framing this week (PRD 0.3). Paraphrased, never invented, always linked. */
export const walrusSources = {
  profile: 'https://x.com/WalrusProtocol',
  blog: 'https://www.walrus.xyz/blog',
  memoryDocs: 'https://docs.wal.app',
  memoryApp: 'https://memory.walrus.xyz',
} as const;

export const installSteps = [
  'Download the Ferry ZIP from the GitHub release and unzip it.',
  'Open chrome://extensions and turn on Developer mode.',
  'Choose Load unpacked and pick the unzipped folder.',
  'Come back to this tab and reload it.',
] as const;
