import { Navigation, QuickAccessTab } from "@decky/ui";

declare const SteamClient: any;

// Native toaster.toast({icon}) turned out unreliable: every Decky toast is
// actually pushed through Steam's OWN notification system
// (NotificationStore.ProcessNotification, eType 31, decky:true) and only
// LOOKS like decky-loader's own popup (the one that renders {toast.icon} as
// real JSX) when a render-interception patch correctly catches it — on some
// Steam builds it doesn't, and Steam's native renderer takes over instead,
// which has no idea what to do with a React icon and shows a broken-image
// placeholder. Confirmed live on this project's own Steam Deck/PC: the icon
// came back as a broken-image glyph even though the toast itself displayed
// correctly otherwise. Steamcord hit the exact same platform inconsistency
// and works around it by making the notification pass for a Steam chat
// message from a synthetic "friend" instead — that message type reliably
// renders a real Steam avatar image, native notification system or not.
// This is the same technique, stripped down to ONE fixed persona (every
// notification is from "Apps Manager", not a different sender each time,
// so none of Steamcord's per-sender hashing/multi-persona bookkeeping is
// needed).

const APP_NAME = "Apps Manager";
const STEAMID_BASE = BigInt("76561197960265728");

// A small shopping-bag glyph on a solid backdrop, self-contained (no
// external CDN dependency to go stale or be blocked) — this is what shows
// as the notification's avatar.
const ICON_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="#1a9fff"/>
      <path d="M11 13V11a5 5 0 0 1 10 0v2h3.2l1.1 13.5a1.5 1.5 0 0 1-1.5 1.5H8.2a1.5 1.5 0 0 1-1.5-1.5L7.8 13H11zm2 0h6v-2a3 3 0 0 0-6 0v2z" fill="#fff"/>
    </svg>`,
  );

// A reserved, namespaced fake accountid — far from any real Steam account
// range, and derived from a constant (not user data), so it's always the
// same persona across notifications and sessions.
let h = 5381;
for (const c of APP_NAME) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
const ACCOUNT_ID = 0xde000000 + (h & 0xfffff);
const SID64 = (STEAMID_BASE + BigInt(ACCOUNT_ID)).toString();

function getFakePersona() {
  const fs = (window as any).friendStore;
  if (!fs?.GetFriendState) return null;
  return (
    fs.GetFriendState({
      GetAccountID: () => ACCOUNT_ID,
      ConvertTo64BitString: () => SID64,
      BIsValid: () => true,
    })?.m_persona ?? null
  );
}

function assertPersonaIdentity() {
  try {
    const p = getFakePersona();
    if (!p) return;
    if (p.m_strPlayerName !== APP_NAME) p.m_strPlayerName = APP_NAME;
  } catch {}
}

let personaPrimed = false;
let personaGuard: ReturnType<typeof setInterval> | null = null;

function primePersona() {
  try {
    const p = getFakePersona();
    if (!p) return;
    try {
      p.m_strPlayerName = APP_NAME;
    } catch {}
    for (const k of ["avatar_url_small", "avatar_url_medium", "avatar_url_full"]) {
      try {
        Object.defineProperty(p, k, { get: () => ICON_DATA_URL, configurable: true });
      } catch {}
    }
    personaPrimed = true;
    if (!personaGuard) {
      // Steam asynchronously refreshes an unknown accountid's persona and
      // wipes the name shortly after it's first seen — this reasserts it
      // periodically so the notification's sender line doesn't flicker
      // back to a raw SteamID.
      personaGuard = setInterval(assertPersonaIdentity, 2000);
    }
    for (const ms of [300, 800, 1500]) setTimeout(assertPersonaIdentity, ms);
  } catch {}
}

// The very first notification of a Steam session can be posted before the
// toast window has mounted and subscribed to it — it lands in the tray but
// never visibly renders. Verified via BAnyContextRenderingToasts(), which
// flips true ~170ms after a notification actually renders and stays true
// for its whole display. If nothing rendered within the wait window,
// resend once.
const FIRST_TOAST_WAIT_MS = 900;
let firstToastChecked = false;

function verifyFirstToastRendered(resend: () => void) {
  if (firstToastChecked) return;
  firstToastChecked = true;
  const ns = (window as any).NotificationStore;
  if (typeof ns?.BAnyContextRenderingToasts !== "function") return;
  const start = Date.now();
  const iv = setInterval(() => {
    let rendered = false;
    try {
      rendered = !!ns.BAnyContextRenderingToasts();
    } catch {}
    if (rendered) {
      clearInterval(iv);
      return;
    }
    if (Date.now() - start >= FIRST_TOAST_WAIT_MS) {
      clearInterval(iv);
      try {
        resend();
      } catch {}
    }
  }, 60);
}

const openQuickAccessMenu = () => Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);

export interface PluginToastData {
  title: string;
  body: string;
  onClick?: () => void;
}

export const pluginToast = (data: PluginToastData) => {
  try {
    primePersona();
    // title is often just the app's own name already (t("section_label"))
    // — don't repeat it in the message body when it is.
    const message = data.title && data.title !== APP_NAME ? `${data.title}: ${data.body}` : data.body;
    const onClick = data.onClick ?? openQuickAccessMenu;
    const send = () =>
      SteamClient.ClientNotifications?.DisplayClientNotification?.(
        1,
        JSON.stringify({ title: "", body: message, state: "active", steamid: SID64 }),
        () => {
          try {
            onClick();
          } catch {}
        },
      );
    send();
    if (!personaPrimed) verifyFirstToastRendered(send);
  } catch (e) {
    console.error("[apps-manager] notification failed", e);
  }
};
