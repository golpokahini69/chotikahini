/**
 * Renders a schema.org JSON-LD block.
 *
 * `dangerouslySetInnerHTML` is used deliberately: this is structured data,
 * not user HTML. The payload is built with `JSON.stringify` and the `<`
 * character is escaped so a string inside the data cannot close the script
 * tag early (the classic `</script>` injection vector).
 */
export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;

  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
