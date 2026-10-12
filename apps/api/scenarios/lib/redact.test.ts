import { describe, expect, it } from 'vitest';

import { REDACTED, redactHeaders, redactValue } from './redact';

describe('scenario report redaction', () => {
  it('redacts sensitive keys at any depth and keeps the rest', () => {
    expect(
      redactValue({
        email: 'owner@example.com',
        password: 'hunter22',
        nested: [{ resetToken: 'abc', otpCode: '123456', name: 'x' }],
      }),
    ).toEqual({
      email: 'owner@example.com',
      password: REDACTED,
      nested: [{ resetToken: REDACTED, otpCode: REDACTED, name: 'x' }],
    });
  });

  it('keeps error codes in responses and redacts verification codes only when asked', () => {
    expect(redactValue({ code: 'not_found', statusCode: 404 })).toEqual({
      code: 'not_found',
      statusCode: 404,
    });
    expect(redactValue({ code: '123456' }, ['code'])).toEqual({ code: REDACTED });
  });

  it('redacts credential headers case-insensitively', () => {
    expect(redactHeaders({ Cookie: 'att_u=1', 'X-CSRF-Token': 't', accept: 'json' })).toEqual({
      Cookie: REDACTED,
      'X-CSRF-Token': REDACTED,
      accept: 'json',
    });
  });
});
