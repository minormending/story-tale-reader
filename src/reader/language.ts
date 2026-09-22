/**
 * Telling a screen reader what language a book is in.
 *
 * `dc:language` was parsed out of the OPF from the beginning and then never used —
 * `BookMetadata.language` had no readers at all. The effect is that a French
 * picture book is pronounced by whatever voice the interface is set to, which for
 * a child learning to match sound to print is worse than unhelpful.
 *
 * Pages render in iframes, so the tag has to reach each page document rather than
 * the app's own `<html>`.
 */

/**
 * Set the document's language, unless it already states one.
 *
 * The page's own declaration always wins. A book can be bilingual — dual-language
 * picture books are common, and EPUB allows a per-document `xml:lang` precisely
 * for this — and the OPF's `dc:language` is the language of the *publication*,
 * which for those books is one of the two at best. Overwriting a page that has
 * correctly declared itself would make the reading worse, not better.
 */
export function applyDocumentLanguage(doc: Document, language: string | undefined): void {
  if (!language) return
  const root = doc.documentElement
  if (!root) return

  // `xml:lang` counts as a declaration too: XHTML content documents often carry
  // that and not the HTML attribute, and it is what the parser exposes here.
  const declared = root.getAttribute('lang') ?? root.getAttribute('xml:lang')
  if (declared && declared.trim()) return

  root.setAttribute('lang', language)
}
