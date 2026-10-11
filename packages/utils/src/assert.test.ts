import { describe, expect, it } from 'vitest';

import { assertNever, isDefined } from './assert';

describe('assertNever', () => {
  it('throws with the offending value', () => {
    expect(() => assertNever('x' as never)).toThrow('Unexpected value: "x"');
  });
});

describe('isDefined', () => {
  it('drops null and undefined but keeps falsy values', () => {
    expect([0, '', false, null, undefined].filter(isDefined)).toEqual([0, '', false]);
  });
});
