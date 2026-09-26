/**
 * Typed IPC contract — single source of truth for every channel InvoiceFlow uses
 * (CANON §2: apps/desktop scaffold; §16: typed contextBridge API only).
 *
 * Data flow: renderer → window.invoiceflow (preload.ts) → ipcMain.handle
 * (ipc/handlers.ts) → services/*. Main→renderer pushes (menu events, network
 * state) travel the same names via webContents.send.
 *
 * NOTE for preload.ts: sandboxed preload scripts must compile to a dependency-free
 * single-file artifact, so preload mirrors the channel STRING values locally and
 * imports only TYPES from this module (type-only imports are erased at emit time).
 *
 * Documented deviations from the base channel set (CANON rule: state & justify):
 *  - APP_GET_VERSION ('app:get-version'): one-shot SYNC bootstrap so the sandboxed
 *    preload can expose `appVersion` as a plain property (the `app` module is not
 *    importable inside a sandboxed preload).
 *  - MENU_EXPORT_PDF ('menu:export-pdf'): main→renderer event required by the
 *    File ▸ Export PDF menu item (the renderer owns the export flow).
 *  - OPEN_EXTERNAL ('app:open-external'): openExternal() must cross into main,
 *    where shell.openExternal lives and the https allow-list is enforced
 *    authoritatively (renderer-side checks are UX only, never the boundary).
 */

export const IPC_CHANNELS = {
  APP_GET_DEVICE_INFO: 'app:get-device-info',
  APP_GET_VERSION: 'app:get-version',
  PDF_SAVE: 'pdf:save',
  PDF_PRINT: 'pdf:print',
  FILE_EXPORT: 'file:export',
  MENU_NEW_INVOICE: 'menu:new-invoice',
  MENU_EXPORT_PDF: 'menu:export-pdf',
  NETWORK_CHANGE: 'network:change',
  UPDATER_CHECK: 'updater:check',
  OPEN_EXTERNAL: 'app:open-external',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ── Payload types ────────────────────────────────────────────────────────────
// renderer → main requests and their main → renderer responses.

export interface SavePdfRequest {
  data: ArrayBuffer;
  fileName: string;
}
export interface SavePdfResponse {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface PrintPdfRequest {
  data: ArrayBuffer;
}
export interface PrintPdfResponse {
  ok: boolean;
  error?: string;
}

export interface ExportFileRequest {
  data: ArrayBuffer;
  fileName: string;
  contentType?: string;
}
export interface ExportFileResponse {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface DeviceInfoResponse {
  appVersion: string;
  electronVersion: string;
  platform: string;
  hostname: string;
  osRelease: string;
}

export interface UpdaterCheckResponse {
  updateAvailable: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  error?: string;
}

export interface OpenExternalRequest {
  url: string;
}
export interface OpenExternalResponse {
  ok: boolean;
  error?: string;
}

// ── Main → renderer pushes ───────────────────────────────────────────────────

export interface NetworkStatePayload {
  online: boolean;
}

export interface MenuEventPayload {
  at: string; // ISO timestamp the menu action was triggered
}

// ── Type guards ──────────────────────────────────────────────────────────────
// handlers.ts validates EVERY inbound payload with these guards before any work
// happens — data crossing IPC is `unknown` and never trusted (CANON §16).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSavePdfRequest(value: unknown): value is SavePdfRequest {
  return (
    isRecord(value) &&
    value.data instanceof ArrayBuffer &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    value.fileName.length <= 255
  );
}

export function isPrintPdfRequest(value: unknown): value is PrintPdfRequest {
  return isRecord(value) && value.data instanceof ArrayBuffer;
}

export function isExportFileRequest(value: unknown): value is ExportFileRequest {
  return (
    isRecord(value) &&
    value.data instanceof ArrayBuffer &&
    typeof value.fileName === 'string' &&
    value.fileName.length > 0 &&
    value.fileName.length <= 255 &&
    (value.contentType === undefined || typeof value.contentType === 'string')
  );
}

export function isOpenExternalRequest(value: unknown): value is OpenExternalRequest {
  return isRecord(value) && typeof value.url === 'string';
}

// ── External URL allow-list (CANON §16: controlled shell.openExternal, https only) ──

/**
 * Hosts the desktop shell may open in the OS browser: repo/releases (GitHub),
 * the production site, and Supabase project instances. Keep in sync with the
 * mirrored list in preload.ts (main re-validates authoritatively).
 */
export const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'supabase.com',
  '*.supabase.co',
  'invoiceflow.app',
  'accounts.google.com',
  '*.google.com',
  'policies.google.com',
  'support.google.com',
];

/** True only for https: URLs whose (optionally wildcard) host is allow-listed. */
export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return EXTERNAL_HOST_ALLOWLIST.some((pattern) =>
      pattern.startsWith('*.')
        ? host === pattern.slice(2) || host.endsWith(`.${pattern.slice(2)}`)
        : host === pattern,
    );
  } catch {
    return false;
  }
}
