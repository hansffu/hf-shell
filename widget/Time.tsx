import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"

export default function Time() {
  const time = createPoll("", 1000, "date +%H%n%M")

  return (
    <menubutton $type="start" hexpand halign={Gtk.Align.CENTER}>
      <label label={time} />
      <popover>
        <Gtk.Calendar />
      </popover>
    </menubutton>
  )
}
