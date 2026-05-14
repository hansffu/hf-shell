import { Gdk, Gtk } from "ags/gtk4"

const popovers = new Set<Gtk.Popover>()

export function registerPanelPopover(popover: Gtk.Popover) {
  popovers.add(popover)
  popover.connect("destroy", () => popovers.delete(popover))
}

export function closePanelPopovers() {
  for (const popover of popovers) popover.popdown()
}

export function closePanels() {
  closePanelPopovers()
}

export function setupEscapeToClosePanels(window: Gtk.Window) {
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
