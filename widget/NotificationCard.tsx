import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { createBinding, createComputed } from "gnim"
import type { Accessor } from "gnim"
import { appIconName } from "../service/DesktopIcons"
import {
  dismissNotification,
  markRead,
  notificationUrgency,
} from "../service/Notifications"
import type { Notification, NotificationAction, NotificationSnapshot } from "../service/Notifications"
import { NotificationActions, notificationActions } from "./NotificationActions"

type DisplayNotification = Notification | NotificationSnapshot

function plainBody(body: string) {
  return body.replace(/<[^>]*>/g, "").trim()
}

function filePath(source: string) {
  if (source.startsWith("file://")) {
    try {
      const [path] = GLib.filename_from_uri(source)

      return path
    } catch (error) {
      void error
      return null
    }
  }

  if (GLib.path_is_absolute(source) && GLib.file_test(source, GLib.FileTest.EXISTS)) {
    return source
  }

  return null
}

function setImageSource(image: Gtk.Image, source: string) {
  const path = filePath(source)

  if (path) {
    image.set_from_file(path)
    return true
  }

  if (GLib.path_is_absolute(source) || source.startsWith("file://")) return false

  image.set_from_icon_name(source)
  return true
}

function setNotificationImage(image: Gtk.Image, notification: DisplayNotification) {
  const sources: Array<string | null | undefined> = [
    notification.image,
    notification.app_icon,
    appIconName(notification.desktop_entry, ""),
    appIconName(notification.app_name, ""),
    "dialog-information",
  ]

  for (const source of sources) {
    const trimmed = source?.trim()

    if (trimmed && setImageSource(image, trimmed)) return
  }
}

function title(notification: DisplayNotification) {
  return notification.summary || notification.app_name || "Notification"
}

function isLiveNotification(notification: DisplayNotification): notification is Notification {
  return "connect" in notification
}

function notificationString(
  notification: DisplayNotification,
  property: "app_name" | "body" | "summary",
) {
  if (isLiveNotification(notification)) return createBinding(notification, property)

  return createComputed(() => notification[property])
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
  notification: DisplayNotification
  onDismiss?: (id: number) => void
  onHover?: (hovered: boolean) => void
  progress?: Accessor<number>
  showProgress?: boolean
}) {
  const urgency = notificationUrgency(notification)
  const appName = notificationString(notification, "app_name")
  const summary = notificationString(notification, "summary")
  const body = notificationString(notification, "body")
  const cardTitle = createComputed(() => summary() || appName() || title(notification))
  const cardBody = createComputed(() => plainBody(body()))
  const cardActions = actions ?? createComputed(() => notificationActions(notification))

  return (
    <box
      class={`shell-panel notification ${urgency} ${className}`}
      orientation={Gtk.Orientation.VERTICAL}
      widthRequest={384}
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
        <image
          pixelSize={32}
          useFallback
          $={(image: Gtk.Image) => setNotificationImage(image, notification)}
        />
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
