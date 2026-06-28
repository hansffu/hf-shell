import { Astal, Gdk, Gtk } from "ags/gtk4"
import AstalNiri from "gi://AstalNiri"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

const popovers = new Set<Gtk.Popover>()
const visiblePopovers = new Set<Gtk.Popover>()
type KeymodeHost = Gtk.Root & { set_keymode?: (mode: Astal.Keymode) => void }

function runtimeNiriSockets() {
  const runtimeDir = GLib.get_user_runtime_dir()
  const waylandDisplay = GLib.getenv("WAYLAND_DISPLAY")
  const sockets: string[] = []

  try {
    const dir = GLib.Dir.open(runtimeDir, 0)
    let name = dir.read_name()

    while (name !== null) {
      if (/^niri\..+\.sock$/.test(name)) {
        sockets.push(GLib.build_filenamev([runtimeDir, name]))
      }

      name = dir.read_name()
    }

    dir.close()
  } catch (error) {
    void error
  }

  return sockets.sort((left, right) => {
    const leftMatchesDisplay = waylandDisplay ? left.includes(`niri.${waylandDisplay}.`) : false
    const rightMatchesDisplay = waylandDisplay ? right.includes(`niri.${waylandDisplay}.`) : false

    return Number(rightMatchesDisplay) - Number(leftMatchesDisplay)
  })
}

function canConnect(path: string | null) {
  if (!path) return false

  try {
    const client = new Gio.SocketClient()
    const connection = client.connect(Gio.UnixSocketAddress.new(path), null)

    connection.close(null)
    return true
  } catch (error) {
    void error
    return false
  }
}

function ensureNiriSocket() {
  const current = GLib.getenv("NIRI_SOCKET")

  if (canConnect(current)) return true

  for (const socket of runtimeNiriSockets()) {
    if (!canConnect(socket)) continue

    GLib.setenv("NIRI_SOCKET", socket, true)
    return true
  }

  return false
}

export const niri = ensureNiriSocket() ? AstalNiri.get_default() : null

let keymodeHosts = new Set<KeymodeHost>()

function popoverKeymodeHost(popover: Gtk.Popover) {
  return popover.get_root() as KeymodeHost | null
}

function refreshPanelHostKeymodes() {
  const activeHosts = new Set<KeymodeHost>()

  for (const popover of visiblePopovers) {
    const host = popoverKeymodeHost(popover)

    if (host?.set_keymode) activeHosts.add(host)
  }

  for (const host of keymodeHosts) {
    if (!activeHosts.has(host)) host.set_keymode?.(Astal.Keymode.NONE)
  }

  for (const host of activeHosts) host.set_keymode?.(Astal.Keymode.ON_DEMAND)

  keymodeHosts = activeHosts
}

function hasVisiblePanels() {
  return visiblePopovers.size > 0
}

function closePanelsForNiriChange() {
  if (hasVisiblePanels()) closePanels()
}

niri?.connect("window-opened", () => closePanelsForNiriChange())
niri?.connect("window-focus-changed", (_niri, id: number) => {
  if (id > 0) closePanelsForNiriChange()
})
niri?.connect("workspace-activated", (_niri, _id: number, focused: boolean) => {
  if (focused) closePanelsForNiriChange()
})

function syncPopoverVisibility(popover: Gtk.Popover) {
  if (popover.visible) {
    visiblePopovers.add(popover)
    refreshPanelHostKeymodes()
    return
  }

  visiblePopovers.delete(popover)
  refreshPanelHostKeymodes()
}

export function registerPanelPopover(popover: Gtk.Popover) {
  popovers.add(popover)
  popover.connect("notify::visible", () => syncPopoverVisibility(popover))
  popover.connect("closed", () => syncPopoverVisibility(popover))
  popover.connect("destroy", () => {
    popovers.delete(popover)
    visiblePopovers.delete(popover)
    refreshPanelHostKeymodes()
  })
}

export function closePanelPopovers() {
  for (const popover of popovers) popover.popdown()
}

export function closePanels() {
  closePanelPopovers()
}

export function setupEscapeToClosePanels(window: Gtk.Window) {
  const hostWindow = window as Gtk.Window & { set_keymode?: (mode: Astal.Keymode) => void }

  hostWindow.set_keymode?.(Astal.Keymode.NONE)

  const controller = Gtk.EventControllerKey.new()

  controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
  controller.connect("key-pressed", (_controller, keyval) => {
    if (keyval !== Gdk.KEY_Escape) return false

    closePanels()
    return true
  })

  window.add_controller(controller)
}

export function setupEscapeToClosePanel(widget: Gtk.Widget) {
  const controller = Gtk.EventControllerKey.new()

  controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
  controller.connect("key-pressed", (_controller, keyval) => {
    if (keyval !== Gdk.KEY_Escape) return false

    closePanels()
    return true
  })

  widget.add_controller(controller)
}
