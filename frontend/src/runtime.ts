// ---------------------------------------------------------------------------
// Type definitions (unchanged from Electron version)
// ---------------------------------------------------------------------------

export interface DesktopRuntimeInfo {
  runtime: "chromium" | "tauri";
  platform: string;
  version: string;
  debugPerf?: boolean;
}

export interface DesktopFocusContext {
  kind: "terminal" | "ide" | "panel" | "form";
  sessionType?: string;
}

export interface DesktopLaunchContext {
  windowId: number;
  role: "main" | "project" | "session";
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workPath: string | null;
}

export interface DesktopWindowSummary {
  windowId: number;
  role: "main" | "project" | "session";
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  workPath: string | null;
  title: string;
  hidden: boolean;
  focused: boolean;
  badgeCount: number;
  ownedSessionIds: string[];
}

export interface DesktopPreferences {
  closeBehavior: "tray" | "quit";
  launchAtLogin: boolean;
  trayHintShown?: boolean;
}

export interface RecentProject {
  projectId: string;
  name: string;
  workPath: string;
  lastOpenedAt: string;
}

export interface UpdateManifest {
  version: string;
  minimumSupportedVersion: string;
  platform: string;
  arch: string;
  assetName: string;
  downloadUrl: string;
  publishedAt: string;
}

export interface DesktopPresencePayload {
  projectId?: string | null;
  projectName?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  workPath?: string | null;
  ownedSessionIds?: string[];
}

// ---------------------------------------------------------------------------
// Electron DesktopApi type (kept for dual-runtime support)
// ---------------------------------------------------------------------------

type ElectronDesktopApi = {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  getLaunchContext: () => Promise<DesktopLaunchContext | null>;
  openProjectWindow: (project: {
    projectId: string;
    projectName?: string | null;
    workPath?: string | null;
  }) => Promise<DesktopWindowSummary | null>;
  openSessionWindow: (session: {
    sessionId: string;
    sessionName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    workPath?: string | null;
  }) => Promise<DesktopWindowSummary | null>;
  listOpenWindows: () => Promise<DesktopWindowSummary[]>;
  focusWindow: (windowId: number) => Promise<boolean>;
  syncPresence: (payload: DesktopPresencePayload) => void;
  openFolderDialog: () => Promise<string | null>;
  openExternal: (url: string) => Promise<boolean>;
  showNotification: (title: string, body: string) => Promise<boolean>;
  setFocusContext: (context: DesktopFocusContext) => void;
  getWindowState: () => Promise<unknown>;
  saveWindowState: (state: unknown) => Promise<unknown>;
  getDesktopPreferences: () => Promise<DesktopPreferences>;
  updateDesktopPreferences: (payload: Partial<DesktopPreferences>) => Promise<DesktopPreferences>;
  getRecentProjects: () => Promise<RecentProject[]>;
  recordRecentProject: (payload: RecentProject | Omit<RecentProject, "lastOpenedAt">) => Promise<RecentProject[]>;
  removeRecentProject: (projectId: string) => Promise<RecentProject[]>;
  revealInFileExplorer: (filePath: string) => Promise<boolean>;
  setBadgeCount: (badgeCount: number) => Promise<number>;
  getCurrentVersion: () => Promise<string>;
  getLatestManifest: () => Promise<UpdateManifest | null>;
  onCommand: (listener: (payload: { type: string; projectId?: string }) => void) => () => void;
  onWindowRegistryUpdated: (listener: (payload: DesktopWindowSummary[]) => void) => () => void;
};

declare global {
  interface Window {
    remoteCodeDesktop?: ElectronDesktopApi;
    __TAURI_INTERNALS__?: unknown;
  }
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

type RuntimeBackend = "tauri" | "electron" | "browser";

function detectRuntime(): RuntimeBackend {
  if (typeof window === "undefined") return "browser";
  if (window.__TAURI_INTERNALS__) return "tauri";
  if (window.remoteCodeDesktop) return "electron";
  return "browser";
}

let _cachedRuntime: RuntimeBackend | null = null;

function RUNTIME(): RuntimeBackend {
  if (_cachedRuntime === null || _cachedRuntime === "browser") {
    _cachedRuntime = detectRuntime();
  }
  return _cachedRuntime;
}

function getElectronApi(): ElectronDesktopApi | null {
  return RUNTIME() === "electron" ? window.remoteCodeDesktop ?? null : null;
}

// ---------------------------------------------------------------------------
// Tauri dynamic imports (lazy-loaded to avoid errors when not in Tauri)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null = null;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!_tauriInvoke) {
    const mod = await import("@tauri-apps/api/core");
    _tauriInvoke = mod.invoke;
  }
  return _tauriInvoke(cmd, args) as Promise<T>;
}

async function tauriListen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const mod = await import("@tauri-apps/api/event");
  return mod.listen(event, (e: { payload: unknown }) => handler(e.payload));
}

// ---------------------------------------------------------------------------
// Keyboard utility functions (unchanged)
// ---------------------------------------------------------------------------

function normalizeKey(rawKey: string): string {
  const key = rawKey.toLowerCase();
  if (key === "left") return "arrowleft";
  if (key === "right") return "arrowright";
  if (key === "esc") return "escape";
  return key;
}

function hasCtrlOrMeta(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

function isLocalNetworkHost(hostname: string): boolean {
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("192.168.")
    || hostname.startsWith("10.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

function isGlobalBrowserShortcut(event: KeyboardEvent, context: DesktopFocusContext): boolean {
  const key = normalizeKey(event.key);
  if (key === "browserback" || key === "browserforward") return true;
  if (event.altKey && (key === "arrowleft" || key === "arrowright")) return true;
  if (!hasCtrlOrMeta(event)) return false;
  if (key === "s" && context.kind === "ide") return false;
  if (["r", "p", "o", "t", "n", "w", "s"].includes(key)) return true;
  return ["0", "=", "+", "-", "_"].includes(key);
}

function isTerminalProtectedShortcut(event: KeyboardEvent): boolean {
  const key = normalizeKey(event.key);
  if (event.altKey && ["arrowleft", "arrowright", "b", "d", "f", "v"].includes(key)) return true;
  if (key === "home" || key === "end") return true;
  if (event.shiftKey && key === "enter") return true;
  if (!hasCtrlOrMeta(event)) return false;
  if (key === "c" && event.shiftKey) return false;
  return ["a","b","c","d","e","f","g","k","r","u","v","w","x","z","arrowleft","arrowright","backspace","delete"].includes(key);
}

// ---------------------------------------------------------------------------
// Exported API — dual-runtime (Tauri / Electron / Browser)
// ---------------------------------------------------------------------------

export function isDesktopChromium(): boolean {
  return RUNTIME() !== "browser";
}

export function canUseLocalDesktopFeatures(): boolean {
  if (isDesktopChromium()) return true;
  if (typeof window === "undefined") return false;
  return isLocalNetworkHost(window.location.hostname);
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopRuntimeInfo>("get_runtime_info");
  return getElectronApi()?.getRuntimeInfo() ?? null;
}

export async function getLaunchContext(): Promise<DesktopLaunchContext | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopLaunchContext | null>("get_launch_context");
  return getElectronApi()?.getLaunchContext() ?? null;
}

export async function openProjectWindow(projectId: string, projectName?: string | null, workPath?: string | null): Promise<DesktopWindowSummary | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopWindowSummary | null>("open_project_window", { args: { projectId, projectName, workPath } });
  const api = getElectronApi();
  if (!api) return null;
  return api.openProjectWindow({ projectId, projectName, workPath });
}

export async function openSessionWindow(
  sessionId: string,
  sessionName?: string | null,
  projectId?: string | null,
  projectName?: string | null,
  workPath?: string | null,
): Promise<DesktopWindowSummary | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopWindowSummary | null>("open_session_window", { args: { sessionId, sessionName, projectId, projectName, workPath } });
  const api = getElectronApi();
  if (!api) return null;
  return api.openSessionWindow({ sessionId, sessionName, projectId, projectName, workPath });
}

export async function listOpenWindows(): Promise<DesktopWindowSummary[]> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopWindowSummary[]>("list_open_windows");
  return getElectronApi()?.listOpenWindows() ?? [];
}

export async function focusDesktopWindow(windowId: number): Promise<boolean> {
  if (RUNTIME() === "tauri") return tauriInvoke<boolean>("focus_window", { windowId });
  return getElectronApi()?.focusWindow(windowId) ?? false;
}

export function syncDesktopPresence(payload: DesktopPresencePayload): void {
  if (RUNTIME() === "tauri") { tauriInvoke("sync_presence", { payload }); return; }
  getElectronApi()?.syncPresence(payload);
}

export async function openFolderDialog(): Promise<string | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<string | null>("open_folder_dialog");
  return getElectronApi()?.openFolderDialog() ?? null;
}

export async function openExternal(url: string): Promise<void> {
  if (RUNTIME() === "tauri") { await tauriInvoke("open_external", { url }); return; }
  const api = getElectronApi();
  if (api) { await api.openExternal(url); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function showDesktopNotification(title: string, body: string): Promise<boolean> {
  if (RUNTIME() === "tauri") return tauriInvoke<boolean>("show_notification", { args: { title, body } });
  return getElectronApi()?.showNotification(title, body) ?? false;
}

export function setDesktopFocusContext(context: DesktopFocusContext): void {
  if (RUNTIME() === "tauri") { tauriInvoke("set_focus_context", { context }); return; }
  getElectronApi()?.setFocusContext(context);
}

export async function getDesktopPreferences(): Promise<DesktopPreferences | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopPreferences>("get_desktop_preferences");
  return getElectronApi()?.getDesktopPreferences() ?? null;
}

export async function updateDesktopPreferences(payload: Partial<DesktopPreferences>): Promise<DesktopPreferences | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<DesktopPreferences>("update_desktop_preferences", { payload });
  return getElectronApi()?.updateDesktopPreferences(payload) ?? null;
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  if (RUNTIME() === "tauri") return tauriInvoke<RecentProject[]>("get_recent_projects");
  return getElectronApi()?.getRecentProjects() ?? [];
}

export async function recordRecentProject(projectId: string, name: string, workPath: string): Promise<RecentProject[]> {
  if (RUNTIME() === "tauri") return tauriInvoke<RecentProject[]>("record_recent_project", { payload: { projectId, name, workPath } });
  const api = getElectronApi();
  if (!api) return [];
  return api.recordRecentProject({ projectId, name, workPath });
}

export async function removeRecentProject(projectId: string): Promise<RecentProject[]> {
  if (RUNTIME() === "tauri") return tauriInvoke<RecentProject[]>("remove_recent_project", { projectId });
  return getElectronApi()?.removeRecentProject(projectId) ?? [];
}

export async function setDesktopBadgeCount(badgeCount: number): Promise<number> {
  if (RUNTIME() === "tauri") return tauriInvoke<number>("set_badge_count", { badgeCount });
  return getElectronApi()?.setBadgeCount(badgeCount) ?? 0;
}

export async function getCurrentDesktopVersion(): Promise<string | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<string>("get_current_version");
  return getElectronApi()?.getCurrentVersion() ?? null;
}

export async function getLatestUpdateManifest(): Promise<UpdateManifest | null> {
  if (RUNTIME() === "tauri") return tauriInvoke<UpdateManifest | null>("get_latest_manifest");
  return getElectronApi()?.getLatestManifest() ?? null;
}

export function subscribeDesktopCommand(listener: (payload: { type: string; projectId?: string }) => void): () => void {
  if (RUNTIME() === "tauri") {
    let unlisten: (() => void) | null = null;
    tauriListen("app:command", (p) => listener(p as { type: string; projectId?: string }))
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }
  return getElectronApi()?.onCommand(listener) ?? (() => {});
}

export function subscribeDesktopWindowRegistry(listener: (payload: DesktopWindowSummary[]) => void): () => void {
  if (RUNTIME() === "tauri") {
    let unlisten: (() => void) | null = null;
    tauriListen("window:registry-updated", (p) => listener(p as DesktopWindowSummary[]))
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }
  return getElectronApi()?.onWindowRegistryUpdated(listener) ?? (() => {});
}

export function installDesktopExternalLinkHandler(): () => void {
  if (!isDesktopChromium()) return () => {};

  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.href;
    if (!href.startsWith("http://") && !href.startsWith("https://")) return;
    if (href.startsWith(window.location.origin)) return;
    event.preventDefault();
    void openExternal(href);
  };

  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

export function installDesktopShortcutGuard(getContext: () => DesktopFocusContext): () => void {
  if (!isDesktopChromium()) return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    const context = getContext();
    const editableTarget = isEditableTarget(event.target);

    if (isGlobalBrowserShortcut(event, context)) {
      event.preventDefault();
      return;
    }

    if (editableTarget) return;

    if (context.kind === "terminal" && isTerminalProtectedShortcut(event)) {
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
