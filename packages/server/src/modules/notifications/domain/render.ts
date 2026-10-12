import { IntlMessageFormat } from 'intl-messageformat';

export type TemplateValues = Record<string, string | number>;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * Renders an ICU MessageFormat template (data model 12). In HTML templates every value is
 * HTML-escaped first, so user-controlled values (names, business names) cannot inject markup.
 * Missing variables are an error rather than an empty string.
 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
  locale: string,
  mode: 'text' | 'html',
): string {
  const safe =
    mode === 'html'
      ? Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? escapeHtml(v) : v]),
        )
      : values;
  const result = new IntlMessageFormat(template, locale, undefined, { ignoreTag: true }).format(
    safe,
  );
  if (typeof result !== 'string') throw new Error('Template rendered to a non-string value');
  return result;
}
