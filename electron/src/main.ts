/**
 * InvoiceFlow desktop — Electron main process entry (CANON §2: apps/desktop).
 *
 * Responsibilities:
 *   - app lifecycle: single instance, window creation/recreation, quit handling
 *   - security hardening (CANON §16): contextIsolation + sandbox + strict
 *     navigation allow-list + denied window.open + CSP injection + no permissions
 *   - IPC registration (ipc/handlers.ts) and native application menu
 *   - native services: file save/print/export, connectivity monitoring, updates
 *
 * The renderer is the SAME Next.js web app as the browser build (loaded from a
 * URL or an embedded static export — see loadRendererInto). All business logic
 * (domain, Dexie, sync, jsPDF) lives in the renderer; the main process only
 * provides OS integration.
 */
import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS, isAllowedExternalUrl } from './ipc/channels';
import { registerIpcHandlers } from './ipc/handlers';
import { startNetworkMonitoring, stopNetworkMonitoring } from './services/network-service';
import { buildAppMenu } from './services/menu-service';

// ── Application Identity for Windows Taskbar ─────────────────────────────────
app.setAppUserModelId('com.abwcurious.invoiceflow');

// ── Hardware Acceleration Control ────────────────────────────────────────────
// Proven root cause fix: prevents Chromium GPU process crashes on Windows/VMs
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ── Renderer location modes (see loadRendererInto) ───────────────────────────
const DEV_SERVER_URL = process.env.ELECTRON_START_URL ?? '';
const EMBEDDED_RENDERER_INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

/**
 * Content-Security-Policy (CANON §16). connect-src https: covers the cloud sync
 * endpoints; frame-src blob: covers the in-app PDF preview (object URL in iframe);
 * img-src data:/blob: covers logo/signature dataURLs. Hash-based SPA routing never
 * triggers document navigation, so 'self' stays sufficient for script-src.
 */
const CSP_BASE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; " +
  "connect-src 'self' https:; frame-src 'self' blob:";

/**
 * Dev-only relaxation: the Next.js dev server compiles with eval-based source
 * maps / HMR, which require 'unsafe-eval'. Production keeps the strict policy.
 */
const CSP_DEV = CSP_BASE.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");

/** Same-origin allow-list for navigation (derived from env; dev default localhost:3000). */
const ALLOWED_ORIGINS = computeAllowedOrigins();

let mainWindow: BrowserWindow | null = null;

// ── Environment / security helpers ───────────────────────────────────────────

function isDevMode(): boolean {
  return !app.isPackaged;
}

function computeAllowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const candidate of [DEV_SERVER_URL, process.env.APP_ORIGIN]) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      console.warn(`[main] ignoring malformed origin in environment: ${candidate}`);
    }
  }
  if (origins.size === 0) origins.add('http://localhost:3000'); // un-packaged dev default
  return [...origins];
}

function cspHeader(): string {
  return DEV_SERVER_URL ? CSP_DEV : CSP_BASE;
}

/** True when the URL is same-origin with the allow-list or the embedded bundle. */
function isAllowedNavigationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return isInsideEmbeddedBundle(url);
    return ALLOWED_ORIGINS.includes(url.origin);
  } catch {
    return false;
  }
}

/** file:// is allowed only inside the embedded renderer bundle — never the whole disk. */
function isInsideEmbeddedBundle(url: URL): boolean {
  if (DEV_SERVER_URL) return false; // dev/remote mode: no file:// navigation at all
  const bundleRoot = path.resolve(app.getAppPath(), 'renderer');
  try {
    return fileURLToPath(url).startsWith(bundleRoot + path.sep);
  } catch {
    return false;
  }
}

function shouldInjectCsp(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return true; // protects the embedded bundle
    return ALLOWED_ORIGINS.includes(url.origin);
  } catch {
    return false;
  }
}

// ── Session security ─────────────────────────────────────────────────────────

function configureSessionSecurity(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldInjectCsp(details.url)) {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader()],
      },
    });
  });
}

function installGlobalWebContentsGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigationUrl(url)) {
        event.preventDefault();
        console.warn(`[security] blocked navigation to ${url}`);
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      } else {
        console.warn(`[security] blocked window.open to ${url}`);
      }
      return { action: 'deny' };
    });

    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

// ── Window management ────────────────────────────────────────────────────────

async function loadRendererInto(win: BrowserWindow): Promise<void> {
  const targetUrl = DEV_SERVER_URL || 'http://localhost:3000';

  // 1. Embedded mode — static export in electron/renderer/index.html
  if (!DEV_SERVER_URL && existsSync(EMBEDDED_RENDERER_INDEX)) {
    await win.loadFile(EMBEDDED_RENDERER_INDEX);
    return;
  }

  // 2. Dev / HTTP mode — with retry backoff for dev server startup
  const maxAttempts = 15;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await win.loadURL(targetUrl);
      return;
    } catch (error) {
      if (attempt < maxAttempts) {
        console.warn(`[main] Dev server at ${targetUrl} not ready yet (attempt ${attempt}/${maxAttempts}). Retrying in 1s...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        throw error;
      }
    }
  }
}

async function createMainWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    skipTaskbar: false,
    title: 'InvoiceFlow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // CANON §16 — renderer isolated from Node
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.moveTop();
    win.setSkipTaskbar(false);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    showError('Renderer process stopped', new Error(`Reason: ${details.reason}`));
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });

  try {
    await loadRendererInto(win);
    if (!win.isVisible()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.moveTop();
      win.setSkipTaskbar(false);
    }
  } catch (error) {
    showError('Could not load the InvoiceFlow renderer', error);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

function bootstrap(): void {
  registerIpcHandlers(() => mainWindow);
  configureSessionSecurity();
  installGlobalWebContentsGuards();

  Menu.setApplicationMenu(
    buildAppMenu({
      isDev: isDevMode(),
      onNewInvoice: () => {
        mainWindow?.webContents.send(IPC_CHANNELS.MENU_NEW_INVOICE, { at: new Date().toISOString() });
      },
      onPrint: () => {
        mainWindow?.webContents.print();
      },
      onExportPdf: () => {
        mainWindow?.webContents.send(IPC_CHANNELS.MENU_EXPORT_PDF, { at: new Date().toISOString() });
      },
    }),
  );

  void createMainWindow();

  startNetworkMonitoring({ getWindow: () => mainWindow, probeHost: probeHost() });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setSkipTaskbar(false);
    }
  });
}

/** DNS probe target: the hostname of the first http(s) allow-listed origin, if any. */
function probeHost(): string | undefined {
  for (const origin of ALLOWED_ORIGINS) {
    try {
      const url = new URL(origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname;
    } catch {
      // unreachable: origins were validated at startup
    }
  }
  return undefined;
}

// ── Fatal error handling ─────────────────────────────────────────────────────

function showError(title: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(`InvoiceFlow — ${title}`, message);
  console.error(`[main] ${title}:`, error);
}

// ── App lifecycle ────────────────────────────────────────────────────────────

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    mainWindow.setSkipTaskbar(false);
  });

  app.whenReady()
    .then(() => {
      try {
        bootstrap();
      } catch (error) {
        showError('Failed to start', error);
        app.quit();
      }
    })
    .catch((error) => showError('Failed to start', error));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    stopNetworkMonitoring();
  });
}

// Last-resort handlers — surface native error dialogs instead of dying silently.
process.on('uncaughtException', (error) => showError('Unexpected error', error));
process.on('unhandledRejection', (reason) => showError('Unexpected promise rejection', reason));
