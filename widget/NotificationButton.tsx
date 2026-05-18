import { Gdk, Gtk } from "ags/gtk4"
import { createComputed } from "gnim"
import {
  closeNotificationCenter,
  notificationCenterOpen,
  openNotificationCenter,
  unreadCount,
  setNotificationCenterOpen,
} from "../service/Notifications"
import NotificationCenter from "./NotificationCenter"
import { PanelPopover } from "./LazyPopoverContent"

export default function NotificationButton({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const badge = createComputed(() => String(unreadCount()))

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
      <PanelPopover
        open={notificationCenterOpen}
        setOpen={(open) => {
          if (typeof open === "function") {
            setNotificationCenterOpen(open)
            return
          }

          if (open) openNotificationCenter()
          else closeNotificationCenter()
        }}
      >
        {(close) => <NotificationCenter gdkmonitor={gdkmonitor} onClose={close} />}
      </PanelPopover>
    </menubutton>
  )
}
