import React from "react";

import { sanitizeHtml } from "../utils/sanitizeHtml";

interface SafeHtmlProps {
  html: string;
  style?: React.CSSProperties;
}

// dangerouslySetInnerHTML is only ever safe here because `html` has
// already been through sanitizeHtml's allowlist — never pass raw,
// unsanitized markup to this component.
export const SafeHtml: React.FC<SafeHtmlProps> = ({ html, style }) => (
  <div style={style} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
);
