import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { createRoot } from "gnim"
import style from "./style.scss"
import Bar from "./widget/Bar"
import NotificationPopups from "./widget/NotificationPopups"

type PromiseLikeResult = {
  catch?: (onRejected: (error: unknown) => void) => unknown
}

type MonitorIdentity = Gdk.Monitor & {
  connector?: string | null
  connect?: (signal: "invalidate", callback: () => void) => number
  get_connector?: () => string | null
  get_geometry?: () => {
    x: number
    y: number
    width: number
    height: number
  }
}

type MonitorList = {
  connect(signal: "items-changed", callback: () => void): number
}

type MonitorDisplay = {
  get_monitors?: () => MonitorList | null
}

type TrackedWindow = {
  window: Gtk.Window
  dispose: () => void
  primary?: boolean
}

const barWindows = new Map<string, TrackedWindow>()
let monitorList: MonitorList | null = null
let syncTimerId = 0
let primaryBarKey: string | null = null
let notificationPopupsWindow: TrackedWindow | null = null
let notificationPopupsMonitorKey: string | null = null

const MONITOR_SYNC_DELAY_MS = 500
const MONITOR_SYNC_MAX_RETRIES = 8
const RUNTIME_THEME_RELOAD_DELAY_MS = 100
const THEME_COLOR_NAMES = [
  "bg",
  "surface",
  "on_surface",
  "border",
  "fg",
  "muted",
  "primary",
  "secondary",
  "danger",
  "warning",
  "on_accent",
] as const

const DEFAULT_THEME_COLORS: Record<ThemeColorName, string> = {
  bg: "#1c1e24",
  surface: "#1c1f24",
  on_surface: "#bbc2cf",
  border: "#3f444a",
  fg: "#bbc2cf",
  muted: "#7f8490",
  primary: "#51afef",
  secondary: "#c678dd",
  danger: "#ff6c6b",
  warning: "#e5c07b",
  on_accent: "#1c1f24",
}

type ThemeColorName = (typeof THEME_COLOR_NAMES)[number]

type ThemeColors = Partial<Record<ThemeColorName, string>>

type CssProviderWithLoaders = Gtk.CssProvider & {
  load_from_string(css: string): void
}

type ThemeMonitorFile = {
  get_path(): string | null
}

let runtimeThemeProvider: Gtk.CssProvider | null = null
let runtimeThemeMonitor: Gio.FileMonitor | null = null
let runtimeThemeReloadTimerId = 0

function logInfo(message: string) {
  const runtime = globalThis as typeof globalThis & {
    print?: (message: string) => void
  }

  runtime.print?.(message)
}

function configureIconTheme() {
  const settings = Gtk.Settings.get_default()

  if (settings) settings.gtk_icon_theme_name = GLib.getenv("HF_SHELL_ICON_THEME") || "Papirus-Dark"
}

function runtimeThemeConfigPath() {
  const configuredPath = GLib.getenv("HF_SHELL_THEME_CONFIG")

  if (configuredPath) return configuredPath

  return GLib.build_filenamev([GLib.get_user_config_dir(), "hf-shell", "config.toml"])
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function shellStyleCss() {
  return style.replace(/^(?:@define-color hf_shell_[^;]+;\n)+\n?/, "")
}

function stripTomlComment(line: string) {
  let quoted = false
  let quote = ""

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quoted) {
      if (char === quote && line[index - 1] !== "\\") quoted = false
      continue
    }

    if (char === '"' || char === "'") {
      quoted = true
      quote = char
      continue
    }

    if (char === "#") return line.slice(0, index)
  }

  return line
}

function parseTomlString(value: string) {
  const trimmed = value.trim()
  const quoted = trimmed.match(/^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)')$/)

  if (quoted) return quoted[1] ?? quoted[2] ?? ""

  return trimmed
}

function isThemeColorName(name: string): name is ThemeColorName {
  return THEME_COLOR_NAMES.includes(name as ThemeColorName)
}

function normalizeColor(value: string) {
  const color = value.startsWith("#") ? value : "#" + value

  if (!/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(color)) {
    throw Error("Expected a 6 or 8 digit hex color, got " + value)
  }

  return color
}

function parseThemeToml(contents: string) {
  const colors: ThemeColors = {}
  let section = ""

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()

    if (!line) continue

    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }

    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (!pair || (section && section !== "colors")) continue

    const name = pair[1]
    if (!isThemeColorName(name)) continue

    colors[name] = normalizeColor(parseTomlString(pair[2]))
  }

  return colors
}

function readRuntimeThemeColors(path: string) {
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return {}

  const file = Gio.File.new_for_path(path)
  const [, contents] = file.load_contents(null)

  return parseThemeToml(new TextDecoder().decode(contents as Uint8Array))
}

function themeColorCss(colors: Record<ThemeColorName, string>) {
  return THEME_COLOR_NAMES.map(
    (name) => "@define-color hf_shell_" + name + " " + colors[name] + ";",
  ).join("\n")
}

function composeRuntimeCss(path: string) {
  const colors = { ...DEFAULT_THEME_COLORS, ...readRuntimeThemeColors(path) }

  return [themeColorCss(colors), shellStyleCss()].join("\n")
}

function resetRuntimeThemeProvider() {
  if (!runtimeThemeProvider) return

  ;(runtimeThemeProvider as CssProviderWithLoaders).load_from_string("")
}

function loadRuntimeThemeConfig(path: string) {
  if (!runtimeThemeProvider) return

  const provider = runtimeThemeProvider as CssProviderWithLoaders

  try {
    provider.load_from_string(composeRuntimeCss(path))
    logInfo("Loaded runtime theme config from " + path)
  } catch (error) {
    resetRuntimeThemeProvider()
    logInfo("Failed to load runtime theme config from " + path + ": " + errorMessage(error))
  }
}

function scheduleRuntimeThemeConfigReload(path: string) {
  if (runtimeThemeReloadTimerId) GLib.source_remove(runtimeThemeReloadTimerId)

  runtimeThemeReloadTimerId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    RUNTIME_THEME_RELOAD_DELAY_MS,
    () => {
      runtimeThemeReloadTimerId = 0
      loadRuntimeThemeConfig(path)
      return GLib.SOURCE_REMOVE
    },
  )
}

function watchRuntimeThemeConfig(path: string) {
  runtimeThemeMonitor?.cancel()
  runtimeThemeMonitor = null

  const file = Gio.File.new_for_path(path)
  const monitorTarget = file.get_parent()

  if (!monitorTarget) return

  try {
    runtimeThemeMonitor = monitorTarget.monitor_directory(Gio.FileMonitorFlags.NONE, null)

    runtimeThemeMonitor.connect(
      "changed",
      (
        _monitor: Gio.FileMonitor,
        changedFile: ThemeMonitorFile | null,
        otherFile: ThemeMonitorFile | null,
      ) => {
        const changedPath = changedFile?.get_path()
        const otherPath = otherFile?.get_path()

        if (changedPath !== path && otherPath !== path) return

        scheduleRuntimeThemeConfigReload(path)
      },
    )
  } catch (error) {
    logInfo("Failed to watch runtime theme config at " + path + ": " + errorMessage(error))
  }
}

function configureRuntimeThemeConfig() {
  const display = Gdk.Display.get_default()

  if (!display) return

  runtimeThemeProvider = new Gtk.CssProvider()
  Gtk.StyleContext.add_provider_for_display(
    display,
    runtimeThemeProvider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1,
  )

  const path = runtimeThemeConfigPath()

  loadRuntimeThemeConfig(path)
  watchRuntimeThemeConfig(path)
}

function monitorConnector(gdkmonitor: Gdk.Monitor) {
  const monitor = gdkmonitor as MonitorIdentity

  return monitor.connector || monitor.get_connector?.() || null
}

function monitorKey(gdkmonitor: Gdk.Monitor, index: number): string | null {
  const connector = monitorConnector(gdkmonitor)

  if (connector) return connector

  const geometry = (gdkmonitor as MonitorIdentity).get_geometry?.()
  if (!geometry) return `monitor-${index}`
  if (geometry.width <= 0 || geometry.height <= 0) return null

  return [
    "monitor",
    index,
    geometry.x,
    geometry.y,
    `${geometry.width}x${geometry.height}`,
  ].join("-")
}

function windowName(prefix: string, key: string) {
  return `${prefix}-${key.replace(/[^A-Za-z0-9_.-]/g, "_")}`
}

function createTrackedWindow(createWindow: () => Gtk.Window): TrackedWindow {
  let window: Gtk.Window | null = null
  let disposeScope: (() => void) | null = null
  let disposed = false
  const dispose = () => {
    if (disposed) return

    disposed = true
    disposeScope?.()
  }

  createRoot((disposeRoot) => {
    disposeScope = disposeRoot
    window = createWindow()
    window.connect("destroy", dispose)
  })

  if (!window) throw Error("window was not created")

  return { window, dispose }
}

function closeWindow(record: TrackedWindow | null) {
  if (!record) return

  record.window.close()
  record.dispose()
}

function createBarWindow(gdkmonitor: Gdk.Monitor, key: string, primary: boolean) {
  const window = createTrackedWindow(() =>
    Bar(gdkmonitor, windowName("bar", key), { primary }) as Gtk.Window
  )
  const monitor = gdkmonitor as MonitorIdentity

  monitor.connect?.("invalidate", () => {
    if (!barWindows.has(key)) return

    logInfo(`Removing bar from display ${key}`)
    closeWindow(window)
    barWindows.delete(key)
    scheduleShellWindowsSync()
  })

  return { ...window, primary }
}

function syncShellWindows({
  allowAdd = true,
  retriesRemaining = MONITOR_SYNC_MAX_RETRIES,
} = {}) {
  const monitors = app.get_monitors()
  const activeBarKeys = new Set<string>()
  let hasPendingMonitor = false
  let nextPrimaryBarKey: string | null = null

  monitors.forEach((gdkmonitor, index) => {
    const key = monitorKey(gdkmonitor, index)

    if (!key) {
      hasPendingMonitor = true
      return
    }

    activeBarKeys.add(key)
    nextPrimaryBarKey ??= key

    const existing = barWindows.get(key)
    if (allowAdd && existing && existing.primary !== (key === nextPrimaryBarKey)) {
      logInfo(`Recreating bar on display ${key}`)
      closeWindow(existing)
      barWindows.delete(key)
    }

    if (allowAdd && !barWindows.has(key)) {
      logInfo(`Adding bar on display ${key}`)
      barWindows.set(key, createBarWindow(gdkmonitor, key, key === nextPrimaryBarKey))
    }
  })

  for (const [key, window] of barWindows) {
    if (activeBarKeys.has(key)) continue

    logInfo(`Removing bar from display ${key}`)
    closeWindow(window)
    barWindows.delete(key)
  }

  primaryBarKey = nextPrimaryBarKey

  const popupMonitor = monitors[0] ?? null
  const popupMonitorKey = popupMonitor ? monitorKey(popupMonitor, 0) : null
  if (popupMonitor && !popupMonitorKey) hasPendingMonitor = true

  if (
    allowAdd &&
    (!popupMonitor || popupMonitorKey) &&
    popupMonitorKey !== notificationPopupsMonitorKey
  ) {
    closeWindow(notificationPopupsWindow)
    notificationPopupsWindow = popupMonitor
      ? createTrackedWindow(() => NotificationPopups(popupMonitor) as Gtk.Window)
      : null
    notificationPopupsMonitorKey = popupMonitorKey
  }

  if (hasPendingMonitor && retriesRemaining > 0) {
    scheduleShellWindowsSync(retriesRemaining - 1)
  }
}

function scheduleShellWindowsSync(retriesRemaining = MONITOR_SYNC_MAX_RETRIES) {
  if (syncTimerId) GLib.source_remove(syncTimerId)

  syncTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MONITOR_SYNC_DELAY_MS, () => {
    syncTimerId = 0
    syncShellWindows({ retriesRemaining })
    return GLib.SOURCE_REMOVE
  })
}

function watchMonitorChanges() {
  const display = (Gdk as unknown as { Display?: { get_default?: () => MonitorDisplay | null } })
    .Display
    ?.get_default?.()
  monitorList = display?.get_monitors?.() ?? null

  monitorList?.connect("items-changed", () => {
    syncShellWindows({ allowAdd: false })
    scheduleShellWindowsSync()
  })
}

function logStartupError(error: unknown) {
  const runtime = globalThis as typeof globalThis & {
    logError?: (error: unknown, message?: string) => void
    print?: (message: string) => void
  }

  if (runtime.logError) {
    runtime.logError(error, "hf-shell startup failed")
  } else {
    runtime.print?.(`hf-shell startup failed: ${String(error)}`)
  }
}

function handleRejection(result: unknown) {
  const promise = result as PromiseLikeResult | null | undefined

  if (typeof promise?.catch === "function") void promise.catch(logStartupError)
}

const runtimeApp = app as typeof app & {
  runAsync?: (...args: unknown[]) => unknown
}
const runAsync = runtimeApp.runAsync?.bind(app)

if (runAsync) {
  // AGS start does not attach a rejection handler to the main loop promise.
  runtimeApp.runAsync = (...args: unknown[]) => {
    const result = runAsync(...args)

    handleRejection(result)
    return result
  }
}

try {
  const started: unknown = app.start({
    instanceName: "hf-shell",
    main() {
      configureIconTheme()
      configureRuntimeThemeConfig()
      syncShellWindows()
      watchMonitorChanges()
    },
  })

  handleRejection(started)
} catch (error) {
  logStartupError(error)
}
