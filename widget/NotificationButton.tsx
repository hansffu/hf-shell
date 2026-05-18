import { Gdk, Gtk } from "ags/gtk4"
import { createComputed, With } from "gnim"
import {
  closeNotificationCenter,
  notificationCenterOpen,
  openNotificationCenter,
  unreadCount,
} from "../service/Notifications"
import NotificationCenter from "./NotificationCenter"
import { setupPanelPopover } from "./PanelRevealer"

export default function NotificationButton({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const badge = createComputed(() => String(unreadCount()))
  let popover: Gtk.Popover | null = null

  return (
    <menubutton
      class="notification-toggle"
      tooltipText="Notifications"
      direction={Gtk.ArrowType.RIGHT}
      onNotifyActive={(button: Gtk.MenuButton) => {
        if (button.active) {
          openNotificationCenter()
        } else {
          closeNotificationCenter()
        }
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <image iconName="preferences-system-notifications-symbolic" pixelSize={18} useFallback />
        <label class="notification-badge" label={badge} visible={createComputed(() => unreadCount() > 0)} />
      </box>
      <popover
        $={(widget: Gtk.Popover) => {
          popover = widget
          setupPanelPopover(widget)
          widget.connect("closed", closeNotificationCenter)
        }}
      >
        <box widthRequest={384} heightRequest={1}>
          <With value={notificationCenterOpen}>
            {(open) => (open
              ? <NotificationCenter gdkmonitor={gdkmonitor} onClose={() => popover?.popdown()} />
              : null)}
          </With>
        </box>
      </popover>
    </menubutton>
  )
}
