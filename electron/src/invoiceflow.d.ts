/**
 * Global renderer typings for the InvoiceFlow desktop bridge.
 *
 * The Next.js app is runtime-agnostic: it must work in a plain browser AND inside
 * the Electron shell. Detection: `window.invoiceflow !== undefined` → desktop
 * runtime (see electron/README.md ▸ Runtime detection).
 *
 * In this sandbox the file is reference documentation (the web app does not
 * import from electron/). In the monorepo it ships as `@invoiceflow/desktop`'s
 * public typing surface and is added to the renderer's tsconfig `types`/`files`.
 */
import type {
  DeviceInfoResponse,
  ExportFileResponse,
  NetworkStatePayload,
  OpenExternalResponse,
  PrintPdfResponse,
  SavePdfResponse,
} from './ipc/channels';

/** Typed, allow-listed surface exposed by preload.ts — the ONLY bridge into Node. */
export interface InvoiceFlowBridge {
  readonly isDesktop: true;
  readonly platform: string;
  readonly appVersion: string;
  /** Shell/app/OS details (versions, hostname, release). */
  getDeviceInfo(): Promise<DeviceInfoResponse>;
  /** Saves a renderer-generated PDF (jsPDF blob) behind a native save dialog. */
  savePdf(data: ArrayBuffer, fileName: string): Promise<SavePdfResponse>;
  /** Prints a renderer-generated PDF via the OS (see file-service.ts trade-off note). */
  printPdf(data: ArrayBuffer): Promise<PrintPdfResponse>;
  /** Generic export (CSV/JSON/…); pass text via `new TextEncoder().encode(text).buffer`. */
  exportFile(data: ArrayBuffer, fileName: string, contentType?: string): Promise<ExportFileResponse>;
  /** Opens an https URL on the allow-list in the OS browser — never an Electron window. */
  openExternal(url: string): Promise<OpenExternalResponse>;
  /** Connectivity pushes from the main process; returns an unsubscribe function. */
  onNetworkChange(callback: (state: NetworkStatePayload) => void): () => void;
}

declare global {
  interface Window {
    /** Present only when running inside the InvoiceFlow desktop shell. */
    readonly invoiceflow: InvoiceFlowBridge | undefined;
  }
}

export {};
