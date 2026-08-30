// An AppImageHub catalog entry — not installed yet. Mirrors the
// backend's appimage_catalog.search()/apps_service.search_appimage_
// catalog() shape.
export interface AppImageCatalogEntry {
  name: string;
  // Frequently a real HTML fragment (paragraphs, bullet lists, links),
  // not plain text — see utils/sanitizeHtml.ts before rendering this.
  description: string;
  categories: string[];
  license: string;
  icon_url: string | null;
  screenshots: string[];
  download_url: string;
  // "owner/repo" when the feed links a GitHub repo — the feed's own
  // download_url is nearly always just that repo's /releases *page*,
  // not a real asset, so install() resolves the actual asset from
  // GitHub's API using this instead when it's present.
  repo: string | null;
  // Best-effort — AppImageHub's feed has no real "installed" concept
  // (unlike Flatpak's own remote-info check), this is a name match
  // against Gearlever's own installed list.
  installed: boolean;
}
