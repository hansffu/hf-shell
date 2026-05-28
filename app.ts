import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
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

function logInfo(message: string) {
  const runtime = globalThis as typeof globalThis & {
    print?: (message: string) => void
  }

  runtime.print?.(message)
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
    css: style,
    instanceName: "hf-shell",
    main() {
      syncShellWindows()
      watchMonitorChanges()
    },
  })

  handleRejection(started)
} catch (error) {
  logStartupError(error)
}
