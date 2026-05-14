import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import PanelRevealer, { setupPanelPopover } from "./PanelRevealer"

export default function Time() {
  const time = createPoll("", 1000, "date +%H%n%M")

  return (
    <menubutton
      $type="start"
      hexpand
      halign={Gtk.Align.CENTER}
      direction={Gtk.ArrowType.RIGHT}
    >
      <label label={time} />
      <popover
        $={(popover: Gtk.Popover) => {
          setupPanelPopover(popover)
        }}
      >
        <PanelRevealer>
          <box class="shell-panel calendar-panel">
            <Gtk.Calendar />
          </box>
        </PanelRevealer>
      </popover>
    </menubutton>
  )
}
