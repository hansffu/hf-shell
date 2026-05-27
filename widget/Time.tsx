import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import GLib from "gi://GLib"
import { createState } from "gnim"
import { PanelPopover } from "./LazyPopoverContent"
import PanelRevealer from "./PanelRevealer"

function currentTime() {
  const now = GLib.DateTime.new_now_local()

  return now.format("%H\n%M") ?? ""
}

export default function Time() {
  const time = createPoll("", 1000, currentTime)
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
