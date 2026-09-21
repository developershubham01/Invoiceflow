/**
 * InvoiceFlow desktop — preload bridge (CANON §16: typed contextBridge only).
 *
 * Runs inside a SANDBOXED renderer. The only privileged surface handed to the
 * Next.js app is the typed `window.invoiceflow` object below. Every method:
 *   1. validates and clones its arguments (structuredClone) before anything
 *      crosses the IPC boundary, then
 *   2. invokes one allow-listed channel handled in src/ipc/handlers.ts, where
 *      payloads are re-validated with type guards (renderer checks are UX only).
 *
 * Self-containment: sandboxed preload scripts must compile to a dependency-free
 * single-file artifact, so channel strings and the external-host allow-list are
 * mirrored here and kept in sync with src/ipc/channels.ts (authoritative). The
 * `import type` statements below are erased at compile time and are safe.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  DeviceInfoResponse,
  ExportFileResponse,
  NetworkStatePayload,
  OpenExternalResponse,
  PrintPdfResponse,
  SavePdfResponse,
} from './ipc/channels';

/** Mirror of IPC_CHANNELS (src/ipc/channels.ts) — see self-containment note. */
const CHANNELS = {
  APP_GET_DEVICE_INFO: 'app:get-device-info',
  APP_GET_VERSION: 'app:get-version',
  PDF_SAVE: 'pdf:save',
  PDF_PRINT: 'pdf:print',
  FILE_EXPORT: 'file:export',
  OPEN_EXTERNAL: 'app:open-external',
  NETWORK_CHANGE: 'network:change',
} as const;

/** Mirror of EXTERNAL_HOST_ALLOWLIST (src/ipc/channels.ts) — main re-validates. */
const EXTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'supabase.com',
  '*.supabase.co',
  'invoiceflow.app',
];

/** Same https + allow-list rule as channels.ts; duplicated for the preload sandbox. */
function isAllowedExternalUrl(value: string): boolean {
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

// ── Argument guards (fail fast, before anything crosses the bridge) ──────────

function assertArrayBuffer(value: unknown, api: string): void {
  if (!(value instanceof ArrayBuffer)) {
    throw new TypeError(`${api}: data must be an ArrayBuffer (text → new TextEncoder().encode(s).buffer).`);
  }
}

function assertFileName(value: unknown, api: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw new TypeError(`${api}: fileName must be a string of 1–255 characters.`);
  }
}

function isNetworkStatePayload(value: unknown): value is NetworkStatePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).online === 'boolean'
  );
}

/**
 * The `app` module is not importable inside a sandboxed preload, so the app
 * version is fetched once, synchronously, over a dedicated bootstrap channel
 * (answered in ipc/handlers.ts) and exposed as a plain property.
 */
function readAppVersion(): string {
  try {
    const value: unknown = ipcRenderer.sendSync(CHANNELS.APP_GET_VERSION);
    return typeof value === 'string' && value.length > 0 ? value : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const bridge = {
  /** Runtime detection flag for the renderer (`window.invoiceflow !== undefined`). */
  isDesktop: true as const,
  platform: process.platform,
  appVersion: readAppVersion(),

  getDeviceInfo(): Promise<DeviceInfoResponse> {
    return ipcRenderer.invoke(CHANNELS.APP_GET_DEVICE_INFO);
  },

  savePdf(data: ArrayBuffer, fileName: string): Promise<SavePdfResponse> {
    assertArrayBuffer(data, 'savePdf');
    assertFileName(fileName, 'savePdf');
    return ipcRenderer.invoke(CHANNELS.PDF_SAVE, structuredClone({ data, fileName }));
  },

  printPdf(data: ArrayBuffer): Promise<PrintPdfResponse> {
    assertArrayBuffer(data, 'printPdf');
    return ipcRenderer.invoke(CHANNELS.PDF_PRINT, structuredClone({ data }));
  },

  exportFile(data: ArrayBuffer, fileName: string, contentType?: string): Promise<ExportFileResponse> {
    assertArrayBuffer(data, 'exportFile');
    assertFileName(fileName, 'exportFile');
    if (contentType !== undefined && typeof contentType !== 'string') {
      throw new TypeError('exportFile: contentType must be a string.');
    }
    return ipcRenderer.invoke(CHANNELS.FILE_EXPORT, structuredClone({ data, fileName, contentType }));
  },

  openExternal(url: string): Promise<OpenExternalResponse> {
    if (typeof url !== 'string') throw new TypeError('openExternal: url must be a string.');
    if (!isAllowedExternalUrl(url)) {
      throw new RangeError('openExternal: only https URLs on the allow-list are permitted.');
    }
    return ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL, structuredClone({ url }));
  },

  onNetworkChange(callback: (state: NetworkStatePayload) => void): () => void {
    if (typeof callback !== 'function') {
      throw new TypeError('onNetworkChange: callback must be a function.');
    }
    const listener = (_event: IpcRendererEvent, state: unknown): void => {
      // Drop malformed pushes instead of forwarding them into application code.
      if (isNetworkStatePayload(state)) callback(state);
    };
    ipcRenderer.on(CHANNELS.NETWORK_CHANGE, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.NETWORK_CHANGE, listener);
    };
  },
};

contextBridge.exposeInMainWorld('invoiceflow', bridge);
