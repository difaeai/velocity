import { describe, expect, it } from 'vitest';

import { docId, isDocId } from '../guards';

describe('docId', () => {
  it('accepts real ids', () => {
    for (const id of ['a8Xk2PqLmN0zR4tY6wBv', 'uid123_trip456', 'velocity-abc', '923000000000']) {
      expect(docId.safeParse(id).success).toBe(true);
    }
  });

  it('refuses anything that would address a different document', () => {
    for (const id of ['abc/chat/msg1', '/abc', 'abc/', '', 'x'.repeat(129)]) {
      expect(docId.safeParse(id).success).toBe(false);
    }
  });

  it('isDocId refuses non-strings', () => {
    expect(isDocId(undefined)).toBe(false);
    expect(isDocId(42)).toBe(false);
    expect(isDocId('trip_1')).toBe(true);
  });
});
