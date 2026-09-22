/**
 * IPC handler registration — the ONLY place where renderer traffic reaches Node.
 * Every handler validates its payload with a type guard (payload is typed as
 * `unknown`; nothing is trusted) and returns plain serializable response objects.
 * Errors are sanitized: no stacks, and no filesystem paths beyond ones the user
 * explicitly chose in a save dialog.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import os from 'node:os';
import {
  IPC_CHANNELS,
  isAllowedExternalUrl,
  isExportFileRequest,
  isOpenExternalRequest,
  isPrintPdfRequest,
  isSavePdfRequest,
} from './channels';
import type {
  DeviceInfoResponse,
  ExportFileResponse,
  OpenExternalResponse,
  PrintPdfResponse,
  SavePdfResponse,
  UpdaterCheckResponse,
} from './channels';
import { FileService } from '../services/file-service';
import { checkForUpdate } from '../services/update-service';

/**
 * Main window accessor — the window can be destroyed and recreated (macOS
 * activate, renderer crash), so handlers resolve it lazily instead of holding
 * a stale reference.
 */
export type MainWindowProvider = () => BrowserWindow | null;

let registered = false;

/**
 * Registers all main-process IPC handlers. Idempotent: guarded against double
 * registration (Electron throws when a channel is handled twice).
 */
export function registerIpcHandlers(getMainWindow: MainWindowProvider): void {
  if (registered) return;
  registered = true;

  /** Parent for native dialogs so they appear modal to the app window. */
  const dialogParent = (): BrowserWindow | undefined => {
    const win = getMainWindow();
    return win !== null && !win.isDestroyed() ? win : undefined;
  };

  // ── renderer → main (invoke) ──────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.APP_GET_DEVICE_INFO, (): DeviceInfoResponse => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    platform: process.platform,
    hostname: os.hostname(),
    osRelease: os.release(),
  }));

  ipcMain.handle(IPC_CHANNELS.PDF_SAVE, async (_event, payload: unknown): Promise<SavePdfResponse> => {
    if (!isSavePdfRequest(payload)) return { ok: false, error: 'Invalid pdf:save payload.' };
    return FileService.savePdf(payload.data, payload.fileName, dialogParent());
  });

  ipcMain.handle(IPC_CHANNELS.PDF_PRINT, async (_event, payload: unknown): Promise<PrintPdfResponse> => {
    if (!isPrintPdfRequest(payload)) return { ok: false, error: 'Invalid pdf:print payload.' };
    return FileService.printPdf(payload.data, dialogParent());
  });

  ipcMain.handle(IPC_CHANNELS.FILE_EXPORT, async (_event, payload: unknown): Promise<ExportFileResponse> => {
    if (!isExportFileRequest(payload)) return { ok: false, error: 'Invalid file:export payload.' };
    return FileService.exportFile(payload.data, payload.fileName, payload.contentType, dialogParent());
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, payload: unknown): Promise<OpenExternalResponse> => {
    if (!isOpenExternalRequest(payload)) return { ok: false, error: 'Invalid app:open-external payload.' };
    // Authoritative allow-list enforcement (the preload-side check is UX only).
    if (!isAllowedExternalUrl(payload.url)) {
      return { ok: false, error: 'URL is outside the https allow-list.' };
    }
    try {
      await shell.openExternal(payload.url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'openExternal failed.' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async (): Promise<UpdaterCheckResponse> => checkForUpdate());

  // ── preload bootstrap (sync one-shot; see preload.ts readAppVersion) ──────
  // Separate channel because `app` is not importable in the sandboxed preload
  // and `appVersion` must be a plain property on the bridge.
  ipcMain.on(IPC_CHANNELS.APP_GET_VERSION, (event) => {
    event.returnValue = app.getVersion();
  });

  // menu:new-invoice / menu:export-pdf (main → renderer menu events, sent from
  // main.ts) and network:change (pushed from services/network-service.ts) have
  // no handler here — they are one-directional pushes only.
}
