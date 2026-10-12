import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../context/request-context';
import { buildLoggerParams } from './logger.options';
import { maskEmail, maskPhone, REDACTED, sanitizeLogObject } from './sanitize';

describe('NFR-SEC log sanitization', () => {
  it('redacts secrets at any depth', () => {
    const out = sanitizeLogObject({
      password: 'hunter22',
      user: { passwordHash: 'x', apiKey: 'k', profile: { resetToken: 't', name: 'Ann' } },
      headers: { authorization: 'Bearer abc', cookie: 'att_u=1', 'x-csrf-token': 'c' },
      otp: '123456',
      code: '654321',
      list: [{ secret: 's' }],
    });
    expect(out).toEqual({
      password: REDACTED,
      user: {
        passwordHash: REDACTED,
        apiKey: REDACTED,
        profile: { resetToken: REDACTED, name: 'Ann' },
      },
      headers: { authorization: REDACTED, cookie: REDACTED, 'x-csrf-token': REDACTED },
      otp: REDACTED,
      code: REDACTED,
      list: [{ secret: REDACTED }],
    });
  });

  it('masks emails and phone numbers', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j•••@example.com');
    expect(maskEmail('not-an-email')).toBe(REDACTED);
    expect(maskPhone('+1 (415) 555-4567')).toBe('+1•••••4567');
    expect(maskPhone('12')).toBe(REDACTED);
    expect(sanitizeLogObject({ email: 'a@b.co', customer: { phone: '+923001234567' } })).toEqual({
      email: 'a•••@b.co',
      customer: { phone: '+9•••••4567' },
    });
  });

  it('drops message and transcript bodies but keeps counts', () => {
    expect(sanitizeLogObject({ transcript: 'hello', body: { a: 1 }, messages: 3 })).toEqual({
      transcript: REDACTED,
      body: REDACTED,
      messages: 3,
    });
  });

  it('survives cycles and does not mutate the input', () => {
    const input: Record<string, unknown> = { name: 'x', password: 'p' };
    input['self'] = input;
    const out = sanitizeLogObject(input);
    expect(out['self']).toEqual({ name: 'x', password: REDACTED, self: '[circular]' });
    expect(input['password']).toBe('p');
  });

  it('every log line carries the requestId and is sanitized (real pino instance)', () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        cb();
      },
    });
    const params = buildLoggerParams({ app: 'api', level: 'info', pretty: false });
    const options = Array.isArray(params.pinoHttp) ? params.pinoHttp[0] : params.pinoHttp;
    const logger = pino(options as pino.LoggerOptions, sink);

    RequestContext.run({ requestId: 'req-123456', actor: { type: 'user', id: 'u1' } }, () => {
      logger.info({ email: 'jane@example.com', token: 'abc' }, 'signed in');
    });
    expect(lines[0]).toMatchObject({
      app: 'api',
      requestId: 'req-123456',
      actor: { type: 'user', id: 'u1' },
      email: 'j•••@example.com',
      token: REDACTED,
      msg: 'signed in',
    });
  });
});
