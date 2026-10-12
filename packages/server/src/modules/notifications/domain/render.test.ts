import { describe, expect, it } from 'vitest';

import { escapeHtml, renderTemplate } from './render';

describe('template rendering', () => {
  it('renders ICU variables, plurals and numbers per locale', () => {
    expect(
      renderTemplate(
        'Hi {firstName}, {count, plural, one {# booking} other {# bookings}}',
        { firstName: 'Ana', count: 2 },
        'en',
        'text',
      ),
    ).toBe('Hi Ana, 2 bookings');
    expect(renderTemplate('{n, number}', { n: 1234.5 }, 'de', 'text')).toBe('1.234,5');
  });

  it('escapes values in HTML mode only', () => {
    const name = '<script>alert(1)</script>';
    expect(renderTemplate('<p>Hi {name}</p>', { name }, 'en', 'html')).toBe(
      '<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
    expect(renderTemplate('Hi {name}', { name }, 'en', 'text')).toBe(`Hi ${name}`);
    expect(escapeHtml(`a&b"'`)).toBe('a&amp;b&quot;&#39;');
  });

  it('fails on missing variables instead of sending a broken message', () => {
    expect(() => renderTemplate('Hi {firstName}', {}, 'en', 'text')).toThrow();
  });
});
