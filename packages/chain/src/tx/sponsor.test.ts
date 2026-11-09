import { describe, expect, it } from 'vitest';
import { createSponsorAuthorization, sponsorAuthorizationMessage } from './sponsor.js';

describe('sponsor authorization', () => {
  it('builds the exact message the relayer verifies', async () => {
    const msg = await sponsorAuthorizationMessage('0xabc', new Uint8Array([1, 2, 3]), 1700000000, 'n-1');
    expect(msg).toBe(
      'MemWal sponsor authorization\nsender: 0xabc\ntransaction-kind-sha256: 039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81\ntimestamp: 1700000000\nnonce: n-1',
    );
  });

  it('signs that message and returns the auth fields', async () => {
    let signed = '';
    const auth = await createSponsorAuthorization('0xabc', new Uint8Array([1, 2, 3]), async (m) => {
      signed = new TextDecoder().decode(m);
      return { signature: 'sig' };
    }, () => 1700000000_500);
    expect(auth.authSignature).toBe('sig');
    expect(auth.authTimestamp).toBe(1700000000);
    expect(signed).toContain(`nonce: ${auth.authNonce}`);
  });
});
