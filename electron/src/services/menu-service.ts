/**
 * MenuService — native application menu (CANON §2: File/Edit/View/Window/Help).
 *
 * Menu actions that concern the UI are forwarded to the renderer via the
 * callbacks in AppMenuOptions (main.ts webContents.send-s them); the renderer
 * owns the response (e.g. New Invoice → navigate to #/invoices/new).
 * Role-based items reuse platform-native accelerators and labels.
 */
import { Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

export interface AppMenuOptions {
  /** Enables reload/devtools entries — dev builds ONLY, never shipped. */
  isDev: boolean;
  /** File ▸ New Invoice — renderer navigates to #/invoices/new. */
  onNewInvoice: () => void;
  /** File ▸ Print… — prints the current renderer view via its native dialog. */
  onPrint: () => void;
  /** File ▸ Export PDF… — renderer opens its export flow for the active document. */
  onExportPdf: () => void;
}

export function buildAppMenu(options: AppMenuOptions): Menu {
  const isMac = process.platform === 'darwin';

  const macAppMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'appMenu' }] : [];

  const fileSubmenu: MenuItemConstructorOptions[] = [
    { label: 'New Invoice', accelerator: 'CmdOrCtrl+N', click: () => options.onNewInvoice() },
    { type: 'separator' },
    { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => options.onPrint() },
    { label: 'Export PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: () => options.onExportPdf() },
  ];
  if (!isMac) fileSubmenu.push({ type: 'separator' }, { role: 'quit' }); // macOS: Quit lives in the app menu

  const devToolsItems: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
  ];

  const viewSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Back',
      accelerator: 'Alt+Left',
      click: (_item, focusedWindow) => {
        if (focusedWindow && 'webContents' in focusedWindow) {
          const win = focusedWindow as unknown as { webContents: { canGoBack: () => boolean; goBack: () => void } };
          if (win.webContents.canGoBack()) {
            win.webContents.goBack();
          }
        }
      },
    },
    { role: 'reload' },
    { role: 'forceReload' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    ...(options.isDev ? devToolsItems : []),
  ];

  const template: MenuItemConstructorOptions[] = [
    ...macAppMenu,
    { label: 'File', submenu: fileSubmenu },
    { role: 'editMenu' }, // undo/redo/cut/copy/paste/selectAll
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' }, // minimize/zoom/close + cycle windows
    { role: 'help', submenu: [{ role: 'about' }] },
  ];

  return Menu.buildFromTemplate(template);
}
