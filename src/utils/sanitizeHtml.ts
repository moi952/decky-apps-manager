// AppImageHub's own feed descriptions are frequently a real HTML
// fragment (paragraphs, bullet lists, links — see e.g. "AppImagePool"'s
// or "APhotoToolLibre"'s entries), not plain text. Rendering that
// straight through dangerouslySetInnerHTML would let any entry (a
// community-run, unmoderated-at-the-edges feed) inject arbitrary
// markup/scripts into this webview. Everything here is allowlist-based
// (tags AND attributes) rather than a denylist of "known-bad" ones —
// anything not explicitly recognized is dropped by default, which is
// what actually makes this safe against attributes/tags this list
// hasn't thought of.
const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "P",
  "BR",
  "UL",
  "OL",
  "LI",
  "SPAN",
  "SMALL",
  "CODE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
]);

const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ["href", "title"],
};

function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href, "https://example.com");
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function sanitizeElement(root: Element): void {
  for (const child of Array.from(root.children)) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      // Unknown/unsafe tag — drop the tag itself but keep its text (a
      // description occasionally wraps a line in a <div> or <font>;
      // there's no reason to lose the actual words over it).
      child.replaceWith(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    const allowedAttrs = ALLOWED_ATTRS[child.tagName] ?? [];
    for (const attr of Array.from(child.attributes)) {
      if (!allowedAttrs.includes(attr.name)) {
        child.removeAttribute(attr.name);
      }
    }
    if (child.tagName === "A") {
      const href = child.getAttribute("href");
      if (href && isSafeHref(href)) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      } else {
        child.removeAttribute("href");
      }
    }
    sanitizeElement(child);
  }
}

// Safe to feed straight into dangerouslySetInnerHTML afterwards.
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeElement(doc.body);
  return doc.body.innerHTML;
}

// A single-line plain-text preview — for a compact list row, not the
// full rich description a detail page can afford to render.
export function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
