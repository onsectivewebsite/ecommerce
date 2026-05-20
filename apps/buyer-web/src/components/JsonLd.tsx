/**
 * Phase 28: emits a single <script type="application/ld+json"> tag with
 * the provided object serialized as JSON. This is the canonical Next.js
 * pattern for schema.org structured data (Google's own examples use the
 * same shape).
 *
 * Safety: the `data` argument is built server-side from our own DB rows
 * and trimmed strings — never directly from arbitrary user input echoed
 * back. We additionally HTML-escape the entire JSON output to defeat
 * any `</script>` / U+2028 / U+2029 sequence that might slip into a
 * title or description field, which makes `dangerouslySetInnerHTML`
 * safe here even if a stored field someday contains such characters.
 */
function safeJson(input: unknown): string {
  return JSON.stringify(input)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/ /g, '\\u2028')
    .replace(/ /g, '\\u2029');
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJson(data) }}
    />
  );
}
