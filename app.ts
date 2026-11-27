import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import { readFile } from "ags/file"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { createEffect, createRoot } from "gnim"
import style from "./style.scss"
import {
  primaryOutputKey,
  primaryOutputSetting,
  setOutputs,
  setPrimaryOutputKey,
} from "./service/Outputs"
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
}

const barWindows = new Map<string, TrackedWindow>()
let monitorList: MonitorList | null = null
let syncTimerId = 0
let primaryOutputs: string[] = []
let notificationPopupsWindow: TrackedWindow | null = null
let notificationPopupsMonitorKey: string | null = null

const MONITOR_SYNC_DELAY_MS = 500
const MONITOR_SYNC_MAX_RETRIES = 8
const RUNTIME_THEME_RELOAD_DELAY_MS = 100
const DEFAULT_BACKGROUND_OPACITY = 1
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

type TomlEntry = {
  section: string
  key: string
  value: string
}

function parseTomlEntries(contents: string) {
  const entries: TomlEntry[] = []
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
    if (pair) entries.push({ section, key: pair[1], value: pair[2] })
  }

  return entries
}

function parseTomlStringArray(value: string) {
  const trimmed = value.trim()

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw Error("Expected an array of strings, got " + value)
  }

  return [...trimmed.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  )
}

function parseThemeToml(contents: string) {
  const colors: ThemeColors = {}
  let backgroundOpacity = DEFAULT_BACKGROUND_OPACITY

  for (const { section, key, value } of parseTomlEntries(contents)) {
    if (section === "appearance" && key === "background_opacity") {
      const opacity = Number(value)

      if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) {
        backgroundOpacity = opacity
      } else {
        logInfo("Ignoring appearance.background_opacity. Expected a number between 0 and 1.")
      }

      continue
    }

    if (section && section !== "colors") continue
    if (!isThemeColorName(key)) continue

    colors[key] = normalizeColor(parseTomlString(value))
  }

  return { colors, backgroundOpacity }
}

function parseOutputsToml(contents: string) {
  for (const { section, key, value } of parseTomlEntries(contents)) {
    if (section === "outputs" && key === "primary") return parseTomlStringArray(value)
  }

  return []
}

function readConfigFile(path: string) {
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return ""

  return readFile(path)
}

function composeRuntimeCss(path: string) {
  const theme = parseThemeToml(readConfigFile(path))
  const colors = { ...DEFAULT_THEME_COLORS, ...theme.colors }

  const definitions = THEME_COLOR_NAMES.map(
    (name) => "@define-color hf_shell_" + name + " " + colors[name] + ";",
  )
  definitions.push(`@define-color hf_shell_panel_bg alpha(@hf_shell_bg, ${theme.backgroundOpacity});`)

  // Raised surfaces sit on top of the panel background. Use a light tint in
  // translucent panels to avoid stacking nearly opaque fills.
  const raisedOpacity = theme.backgroundOpacity === DEFAULT_BACKGROUND_OPACITY
    ? DEFAULT_BACKGROUND_OPACITY
    : theme.backgroundOpacity * 0.25
  definitions.push(
    `@define-color hf_shell_panel_raised_bg alpha(shade(@hf_shell_surface, 1.2), ${raisedOpacity});`,
    `@define-color hf_shell_graph_bg alpha(#1c1e26, ${raisedOpacity});`,
    `@define-color hf_shell_panel_section_shadow alpha(black, ${theme.backgroundOpacity ** 2});`,
  )

  return [...definitions, shellStyleCss()].join("\n")
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

function loadOutputConfig(path: string) {
  let nextPrimaryOutputs: string[] = []

  try {
    nextPrimaryOutputs = parseOutputsToml(readConfigFile(path))
  } catch (error) {
    logInfo("Failed to load output config from " + path + ": " + errorMessage(error))
  }

  const changed = nextPrimaryOutputs.join("\n") !== primaryOutputs.join("\n")

  primaryOutputs = nextPrimaryOutputs
  if (changed) logInfo("Primary output priority: " + (primaryOutputs.join(", ") || "(default)"))

  return changed
}

function scheduleRuntimeThemeConfigReload(path: string) {
  if (runtimeThemeReloadTimerId) GLib.source_remove(runtimeThemeReloadTimerId)

  runtimeThemeReloadTimerId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    RUNTIME_THEME_RELOAD_DELAY_MS,
    () => {
      runtimeThemeReloadTimerId = 0
      loadRuntimeThemeConfig(path)
      if (loadOutputConfig(path)) syncShellWindows()
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
  loadOutputConfig(path)
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

type KeyedMonitor = {
  gdkmonitor: Gdk.Monitor
  key: string | null
}

// The output picked in the settings panel wins; otherwise the first connected output from
// `[outputs] primary` in config.toml. Both match by connector name.
function choosePreferredMonitor(monitors: KeyedMonitor[]) {
  const setting = primaryOutputSetting()
  const priority = setting ? [setting, ...primaryOutputs] : primaryOutputs

  for (const output of priority) {
    const match = monitors.find(
      ({ gdkmonitor, key }) => key && monitorConnector(gdkmonitor) === output,
    )

    if (match) return match as KeyedMonitor & { key: string }
  }

  return null
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

function monitorLabel(gdkmonitor: Gdk.Monitor, key: string) {
  const connector = monitorConnector(gdkmonitor)
  const model = (gdkmonitor as Gdk.Monitor & { get_model?: () => string | null }).get_model?.()

  if (connector && model) return `${model} (${connector})`

  return connector || model || key
}

function createBarWindow(gdkmonitor: Gdk.Monitor, key: string) {
  const window = createTrackedWindow(() =>
    Bar(gdkmonitor, windowName("bar", key), {
      primary: primaryOutputKey.as((primaryKey) => primaryKey === key),
    }) as Gtk.Window
  )
  const monitor = gdkmonitor as MonitorIdentity

  monitor.connect?.("invalidate", () => {
    if (!barWindows.has(key)) return

    logInfo(`Removing bar from display ${key}`)
    closeWindow(window)
    barWindows.delete(key)
    scheduleShellWindowsSync()
  })

  return window
}

function syncShellWindows({
  allowAdd = true,
  retriesRemaining = MONITOR_SYNC_MAX_RETRIES,
} = {}) {
  const monitors = app.get_monitors()
  const keyedMonitors = monitors.map((gdkmonitor, index) => ({
    gdkmonitor,
    key: monitorKey(gdkmonitor, index),
  }))
  const preferredMonitor = choosePreferredMonitor(keyedMonitors)
  const activeBarKeys = new Set<string>()
  let hasPendingMonitor = false
  const nextPrimaryBarKey =
    preferredMonitor?.key ?? keyedMonitors.find(({ key }) => key)?.key ?? null

  keyedMonitors.forEach(({ gdkmonitor, key }) => {
    if (!key) {
      hasPendingMonitor = true
      return
    }

    activeBarKeys.add(key)

    if (allowAdd && !barWindows.has(key)) {
      logInfo(`Adding bar on display ${key}`)
      barWindows.set(key, createBarWindow(gdkmonitor, key))
    }
  })

  for (const [key, window] of barWindows) {
    if (activeBarKeys.has(key)) continue

    logInfo(`Removing bar from display ${key}`)
    closeWindow(window)
    barWindows.delete(key)
  }

  setPrimaryOutputKey(nextPrimaryBarKey)
  setOutputs(
    keyedMonitors.flatMap(({ gdkmonitor, key }) =>
      key ? [{ key, connector: monitorConnector(gdkmonitor), label: monitorLabel(gdkmonitor, key) }] : [],
    ),
  )

  const popupMonitor = preferredMonitor?.gdkmonitor ?? monitors[0] ?? null
  const popupMonitorKey = preferredMonitor?.key ?? (popupMonitor ? keyedMonitors[0].key : null)
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

function watchPrimaryOutputSetting() {
  let initialized = false

  createRoot(() => {
    createEffect(() => {
      primaryOutputSetting()

      if (!initialized) {
        initialized = true
        return
      }

      // Sync outside the effect so window creation is not tracked by it.
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        syncShellWindows()
        return GLib.SOURCE_REMOVE
      })
    })
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
      watchPrimaryOutputSetting()
    },
  })

  handleRejection(started)
} catch (error) {
  logStartupError(error)
}
