import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { registerPanelPopover } from "../service/Panels"

export function setupPanelPopover(popover: Gtk.Popover) {
  popover.set_has_arrow(false)
  popover.set_position(Gtk.PositionType.RIGHT)
  popover.set_offset(0, 0)
  registerPanelPopover(popover)
}

export default function PanelRevealer({ children }: { children: Gtk.Widget }) {
  return (
    <revealer
      transitionDuration={140}
      transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
      revealChild
      $={(revealer: Gtk.Revealer) => {
        revealer.connect("map", () => {
          revealer.set_reveal_child(false)
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            revealer.set_reveal_child(true)
            return GLib.SOURCE_REMOVE
          })
        })
      }}
    >
      {children}
    </revealer>
  )
}
