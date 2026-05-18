import { Gtk } from "ags/gtk4"
import { With } from "gnim"
import type { Accessor, Setter } from "gnim"
import { setupPanelPopover } from "./PanelRevealer"

export default function LazyPopoverContent({
  children,
  open,
  widthRequest = 384,
}: {
  children: () => Gtk.Widget
  open: Accessor<boolean>
  widthRequest?: number
}) {
  return (
    <box widthRequest={widthRequest} heightRequest={1}>
      <With value={open}>
        {(visible) => (visible ? children() : null)}
      </With>
    </box>
  )
}

export function PanelPopover({
  children,
  open,
  setOpen,
  widthRequest = 384,
}: {
  children: (close: () => void) => Gtk.Widget
  open: Accessor<boolean>
  setOpen: Setter<boolean>
  widthRequest?: number
}) {
  let popover: Gtk.Popover | null = null
  const close = () => popover?.popdown()

  return (
    <popover
      $={(widget: Gtk.Popover) => {
        popover = widget
        setupPanelPopover(widget)
        widget.connect("closed", () => setOpen(false))
      }}
    >
      <LazyPopoverContent open={open} widthRequest={widthRequest}>
        {() => children(close)}
      </LazyPopoverContent>
    </popover>
  )
}
