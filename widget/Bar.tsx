import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import Time from "./Time"
import WorkspaceApps from "./WorkspaceApps"
import Workspaces from "./Workspaces"

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT } = Astal.WindowAnchor

  return (
    <window
      visible
      name="bar"
      class="Bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | BOTTOM | LEFT}
      application={app}
    >
      <centerbox cssName="centerbox" orientation={Gtk.Orientation.VERTICAL}>
        <box $type="start" orientation={Gtk.Orientation.VERTICAL}>
          <Time />
          <WorkspaceApps />
        </box>
        <box $type="center" vexpand />
        <box $type="end" orientation={Gtk.Orientation.VERTICAL}>
          <Workspaces gdkmonitor={gdkmonitor} />
        </box>
      </centerbox>
    </window>
  )
}
