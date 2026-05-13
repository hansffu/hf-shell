import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import {
  dismissNotification,
  hasPopups,
  markRead,
  popups,
  setPopupHover,
} from "../service/Notifications"
import type { NotificationPopup } from "../service/Notifications"

function notificationIcon(popup: NotificationPopup) {
  const notification = popup.notification
  return notification.app_icon || notification.desktop_entry || "dialog-information"
}

function notificationTitle(popup: NotificationPopup) {
  const notification = popup.notification
  return notification.summary || notification.app_name || "Notification"
}

function plainBody(body: string) {
  return body.replace(/<[^>]*>/g, "").trim()
}

function PopupCard({ popup }: { popup: NotificationPopup }) {
  const notification = popup.notification
  const appName = createBinding(notification, "app_name")
  const summary = createBinding(notification, "summary")
  const body = createBinding(notification, "body")
  const appIcon = createBinding(notification, "app_icon")
  const desktopEntry = createBinding(notification, "desktop_entry")
  const iconName = createComputed(() => appIcon() || desktopEntry() || notificationIcon(popup))
  const title = createComputed(() => summary() || appName() || notificationTitle(popup))
  const text = createComputed(() => plainBody(body()))
  const progress = createComputed(() =>
    popup.timeoutMs === 0 ? 1 : popup.remainingMs() / popup.timeoutMs,
  )

  return (
    <box
      class={`notification popup ${popup.urgency}`}
      orientation={Gtk.Orientation.VERTICAL}
      $={(self) => {
        const motion = Gtk.EventControllerMotion.new()

        motion.connect("enter", () => setPopupHover(popup.id, true))
        motion.connect("leave", () => setPopupHover(popup.id, false))
        self.add_controller(motion)
      }}
    >
      <levelbar
        class={`notification-progress ${popup.urgency}`}
        minValue={0}
        maxValue={1}
        value={progress}
        visible={popup.timeoutMs > 0}
      />
      <box orientation={Gtk.Orientation.HORIZONTAL}>
        <image iconName={iconName} pixelSize={32} useFallback />
        <box class="notification-content" orientation={Gtk.Orientation.VERTICAL}>
          <box orientation={Gtk.Orientation.HORIZONTAL}>
            <label class="notification-title" xalign={0} hexpand label={title} />
            <button
              class="notification-close"
              tooltipText="Close"
              onClicked={() => {
                markRead(popup.id)
                dismissNotification(popup.id)
              }}
            >
              <label label="x" />
            </button>
          </box>
          <label
            class="notification-body"
            xalign={0}
            wrap
            lines={3}
            label={text}
            visible={createComputed(() => text().length > 0)}
          />
        </box>
      </box>
    </box>
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
