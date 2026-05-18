import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import { createState } from "gnim"
import { PanelPopover } from "./LazyPopoverContent"
import PanelRevealer from "./PanelRevealer"

export default function Time() {
  const time = createPoll("", 1000, "date +%H%n%M")
  const [open, setOpen] = createState(false)

  return (
    <menubutton
      $type="start"
      hexpand
      halign={Gtk.Align.CENTER}
      direction={Gtk.ArrowType.RIGHT}
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
    >
      <label label={time} />
      <PanelPopover open={open} setOpen={setOpen}>
        {() => (
          <PanelRevealer>
            <box class="shell-panel calendar-panel">
              <Gtk.Calendar />
            </box>
          </PanelRevealer>
        )}
      </PanelPopover>
    </menubutton>
  )
}
