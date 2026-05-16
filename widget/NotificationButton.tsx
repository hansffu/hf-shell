import { Gtk } from "ags/gtk4"
import { createComputed } from "gnim"
import { closeNotificationCenter, openNotificationCenter, unreadCount } from "../service/Notifications"
import NotificationCenter from "./NotificationCenter"
import { setupPanelPopover } from "./PanelRevealer"

export default function NotificationButton() {
  const badge = createComputed(() => String(unreadCount()))
  let popover: Gtk.Popover | null = null

  return (
    <menubutton class="notification-toggle" tooltipText="Notifications" direction={Gtk.ArrowType.RIGHT}>
      <box orientation={Gtk.Orientation.VERTICAL}>
        <image iconName="preferences-system-notifications-symbolic" pixelSize={18} useFallback />
        <label class="notification-badge" label={badge} visible={createComputed(() => unreadCount() > 0)} />
      </box>
      <popover
        $={(widget: Gtk.Popover) => {
          popover = widget
          setupPanelPopover(widget)
          widget.connect("show", openNotificationCenter)
          widget.connect("closed", closeNotificationCenter)
        }}
      >
        <NotificationCenter onClose={() => popover?.popdown()} />
      </popover>
    </menubutton>
  )
}
