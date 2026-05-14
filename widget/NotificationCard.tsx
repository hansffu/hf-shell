import { Gtk } from "ags/gtk4"
import { Accessor, createBinding, createComputed } from "gnim"
import {
  dismissNotification,
  markRead,
} from "../service/Notifications"
import type { Notification, NotificationAction } from "../service/Notifications"
import { NotificationActions, notificationActions } from "./NotificationActions"

function plainBody(body: string) {
  return body.replace(/<[^>]*>/g, "").trim()
}

function iconName(notification: Notification) {
  return notification.app_icon || notification.desktop_entry || "dialog-information"
}

function title(notification: Notification) {
  return notification.summary || notification.app_name || "Notification"
}

export default function NotificationCard({
  actions,
  class: className = "",
  notification,
  onDismiss,
  onHover,
  progress,
  showProgress,
}: {
  actions?: Accessor<NotificationAction[]>
  class?: string
  notification: Notification
  onDismiss?: (id: number) => void
  onHover?: (hovered: boolean) => void
  progress?: Accessor<number>
  showProgress?: boolean
}) {
  const appName = createBinding(notification, "app_name")
  const summary = createBinding(notification, "summary")
  const body = createBinding(notification, "body")
  const appIcon = createBinding(notification, "app_icon")
  const desktopEntry = createBinding(notification, "desktop_entry")
  const cardIcon = createComputed(() => appIcon() || desktopEntry() || iconName(notification))
  const cardTitle = createComputed(() => summary() || appName() || title(notification))
  const cardBody = createComputed(() => plainBody(body()))
  const cardActions = actions ?? createComputed(() => notificationActions(notification))

  return (
    <box
      class={`shell-panel notification ${className}`}
      orientation={Gtk.Orientation.VERTICAL}
      widthRequest={320}
      $={(self: Gtk.Box) => {
        if (!onHover) return

        const motion = Gtk.EventControllerMotion.new()

        motion.connect("enter", () => onHover(true))
        motion.connect("leave", () => onHover(false))
        self.add_controller(motion)
      }}
    >
      <box class="notification-popup-top" orientation={Gtk.Orientation.HORIZONTAL}>
        <levelbar
          class="notification-progress"
          minValue={0}
          maxValue={1}
          value={progress ?? 1}
          visible={showProgress ?? false}
          hexpand
        />
        <box
          class="notification-progress-spacer"
          visible={!(showProgress ?? false)}
          hexpand
        />
        <button
          class="notification-close"
          tooltipText="Close"
          onClicked={() => {
            if (onDismiss) {
              onDismiss(notification.id)
            } else {
              markRead(notification.id)
              dismissNotification(notification.id)
            }
          }}
        >
          <label label="x" />
        </button>
      </box>
      <box orientation={Gtk.Orientation.HORIZONTAL}>
        <image iconName={cardIcon} pixelSize={32} useFallback />
        <box class="notification-content" orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label
            class="notification-title"
            xalign={0}
            hexpand
            wrap
            lines={3}
            maxWidthChars={34}
            label={cardTitle}
          />
          <label
            class="notification-body"
            xalign={0}
            wrap
            lines={3}
            maxWidthChars={34}
            label={cardBody}
            visible={createComputed(() => cardBody().length > 0)}
          />
        </box>
      </box>
      <NotificationActions actions={cardActions} notificationId={notification.id} />
    </box>
  )
}
