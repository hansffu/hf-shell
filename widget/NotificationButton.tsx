import app from "ags/gtk4/app"
import { Gtk } from "ags/gtk4"
import { createComputed } from "gnim"
import { markAllRead, unreadCount } from "../service/Notifications"

function toggleCenter() {
  const center = app.get_window("notification-center")

  if (!center?.visible) markAllRead()
  app.toggle_window("notification-center")
}

export default function NotificationButton() {
  const badge = createComputed(() => String(unreadCount()))

  return (
    <button class="notification-toggle" tooltipText="Notifications" onClicked={toggleCenter}>
      <box orientation={Gtk.Orientation.VERTICAL}>
        <image iconName="preferences-system-notifications-symbolic" pixelSize={18} useFallback />
        <label class="notification-badge" label={badge} visible={createComputed(() => unreadCount() > 0)} />
      </box>
    </button>
  )
}
