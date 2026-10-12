import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createdAtCursor, decodeCursor, encodeCreatedAtCursor, toPage } from './cursor';

describe('keyset cursors (BACKEND.md §5.5)', () => {
  it('round-trips and rejects tampered cursors with a 422', () => {
    const row = {
      createdAt: new Date('2026-10-12T10:00:00Z'),
      id: '0192f6c4-7b1e-7c3a-9d2e-5f8a1b2c3d4e',
    };
    expect(decodeCursor(encodeCreatedAtCursor(row), createdAtCursor)).toEqual(row);
    expect(decodeCursor(undefined, createdAtCursor)).toBeUndefined();
    expect(() => decodeCursor('not-a-cursor', createdAtCursor)).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
    expect(() =>
      decodeCursor(Buffer.from('{"t":1}').toString('base64url'), z.object({ t: z.string() })),
    ).toThrow();
  });

  it('pages with limit + 1 rows', () => {
    const page = toPage(
      [1, 2, 3],
      2,
      (n) => n * 10,
      (n) => `c${n}`,
    );
    expect(page).toEqual({ data: [10, 20], meta: { nextCursor: 'c2', hasMore: true } });
    expect(toPage([1], 2, (n) => n, String).meta).toEqual({ nextCursor: null, hasMore: false });
  });
});
