import { Gtk } from "ags/gtk4"
import PanelRevealer from "./PanelRevealer"

type PanelProps = {
  children: Gtk.Widget | Gtk.Widget[]
  class?: string
  headerEnd?: Gtk.Widget
  title: string
}

type PanelSectionProps = {
  children: Gtk.Widget | Gtk.Widget[]
  class?: string
  title: string
}

export default function Panel({
  children,
  class: className = "",
  headerEnd,
  title,
}: PanelProps) {
  const classes = ["shell-panel", "panel", className].filter(Boolean).join(" ")

  return (
    <PanelRevealer>
      <box class={classes} orientation={Gtk.Orientation.VERTICAL}>
        <box class="panel-header" orientation={Gtk.Orientation.HORIZONTAL}>
          <label class="panel-title" xalign={0} label={title} hexpand />
          {headerEnd}
        </box>
        <box class="panel-content" orientation={Gtk.Orientation.VERTICAL}>
          {children}
        </box>
      </box>
    </PanelRevealer>
  )
}

export function PanelSection({
  children,
  class: className = "",
  title,
}: PanelSectionProps) {
  const classes = ["panel-section", className].filter(Boolean).join(" ")

  return (
    <box class={classes} orientation={Gtk.Orientation.VERTICAL}>
      <label class="panel-section-title" xalign={0} label={title} />
      <box class="panel-section-content" orientation={Gtk.Orientation.VERTICAL}>
        {children}
      </box>
    </box>
  )
}
