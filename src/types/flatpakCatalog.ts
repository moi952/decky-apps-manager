// A Flatpak search result — not necessarily installed yet. Mirrors the
// backend's flatpak.search()/apps_service.search_flatpak_catalog() shape.
export interface FlatpakCatalogEntry {
  app_id: string;
  name: string;
  description: string;
  version: string;
  branch: string;
  remotes: string[];
  remote: string;
  installed: boolean;
}
