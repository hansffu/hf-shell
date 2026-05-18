import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { setupEscapeToClosePanels } from "../service/Panels"
import BluetoothControl from "./BluetoothControl"
import NetworkControl from "./NetworkControl"
import NotificationButton from "./NotificationButton"
import ScreenToolkit, { ScreenCaptureStopButton } from "./ScreenToolkit"
import SlackUnread from "./SlackUnread"
import SoundControl from "./SoundControl"
import SystemMonitor from "./SystemMonitor"
import SystemTray from "./SystemTray"
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
      keymode={Astal.Keymode.NONE}
      anchor={TOP | BOTTOM | LEFT}
      application={app}
      $={(window) => {
        setupEscapeToClosePanels(window)
      }}
    >
      <centerbox cssName="centerbox" orientation={Gtk.Orientation.VERTICAL}>
        <box $type="start" orientation={Gtk.Orientation.VERTICAL}>
          <Time />
          <NotificationButton gdkmonitor={gdkmonitor} />
          <SlackUnread />
          <WorkspaceApps />
          <SystemTray />
        </box>
        <box $type="center" orientation={Gtk.Orientation.VERTICAL}>
          <Workspaces gdkmonitor={gdkmonitor} />
        </box>
        <box $type="end" orientation={Gtk.Orientation.VERTICAL}>
          <ScreenToolkit gdkmonitor={gdkmonitor} />
          <ScreenCaptureStopButton />
          <SystemMonitor />
          <NetworkControl />
          <BluetoothControl />
          <SoundControl />
        </box>
      </centerbox>
    </window>
  )
}
