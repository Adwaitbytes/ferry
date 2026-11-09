/**
 * Walrus Memory relayer sponsored gas (POST /sponsor, /sponsor/execute). The relayer pays gas for
 * exactly one allowlisted MemWal call; the sender proves intent with a personal-message signature.
 * The message format mirrors `@mysten-incubation/memwal` 0.1.13 `sponsorAuthorizationMessage`
 * and the relayer's `routes/sponsor.rs`, so it must not change without both.
 */
export interface SponsorAuthorization {
  authNonce: string;
  authSignature: string;
  authTimestamp: number;
}

export type PersonalMessageSigner = (message: Uint8Array) => Promise<{ signature: string }>;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sponsorAuthorizationMessage(sender: string, kindBytes: Uint8Array, timestamp: number, nonce: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(kindBytes).buffer));
  return [
    'MemWal sponsor authorization',
    `sender: ${sender}`,
    `transaction-kind-sha256: ${toHex(digest)}`,
    `timestamp: ${timestamp}`,
    `nonce: ${nonce}`,
  ].join('\n');
}

export async function createSponsorAuthorization(
  sender: string,
  kindBytes: Uint8Array,
  signPersonalMessage: PersonalMessageSigner,
  now: () => number = Date.now,
): Promise<SponsorAuthorization> {
  const authTimestamp = Math.floor(now() / 1000);
  const authNonce = crypto.randomUUID();
  const message = await sponsorAuthorizationMessage(sender, kindBytes, authTimestamp, authNonce);
  const { signature } = await signPersonalMessage(new TextEncoder().encode(message));
  return { authNonce, authSignature: signature, authTimestamp };
}
