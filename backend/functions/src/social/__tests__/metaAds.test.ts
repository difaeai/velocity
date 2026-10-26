/**
 * How long a pasted ads token lives, from Meta's debug_token answer. Only a
 * token Meta says never expires may be marked permanent — the one the Facebook
 * sign-in can never replace.
 */
import { describe, expect, it } from 'vitest';

import { tokenExpiryMs } from '../meta';

describe('tokenExpiryMs', () => {
  it('reads a System User token set to Never as never', () => {
    expect(tokenExpiryMs({ expires_at: 0 })).toBeNull();
    expect(tokenExpiryMs({})).toBeNull();
  });

  it('turns Meta seconds into milliseconds', () => {
    expect(tokenExpiryMs({ expires_at: 1_800_000_000 })).toBe(1_800_000_000_000);
  });
});
