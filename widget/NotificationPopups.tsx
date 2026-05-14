import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createComputed, For } from "gnim"
import {
  hasPopups,
  popups,
  setPopupHover,
} from "../service/Notifications"
import type { NotificationPopup } from "../service/Notifications"
import NotificationCard from "./NotificationCard"

function PopupCard({ popup }: { popup: NotificationPopup }) {
  const progress = createComputed(() =>
    popup.timeoutMs === 0 ? 1 : popup.remainingMs() / popup.timeoutMs,
  )

  return (
    <NotificationCard
      class={`popup ${popup.urgency}`}
      notification={popup.notification}
      onHover={(hovered) => setPopupHover(popup.id, hovered)}
      progress={progress}
      showProgress={popup.timeoutMs > 0}
    />
  )
}

export default function NotificationPopups(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor

  return (
    <window
      visible={hasPopups}
      name="notification-popups"
      class="Notifications"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | RIGHT}
      application={app}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <For each={popups}>{(popup) => <PopupCard popup={popup} />}</For>
      </box>
    </window>
  )
}
