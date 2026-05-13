import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import {
  clearAllRecords,
  clearRecord,
  dismissAllNotifications,
  dismissNotification,
  markAllRead,
  markRead,
  notifd,
  records,
  unreadCount,
} from "../service/Notifications"
import type { NotificationAction, NotificationRecord } from "../service/Notifications"

function plainBody(body: string) {
  return body.replace(/<[^>]*>/g, "").trim()
}

function iconName(record: NotificationRecord) {
  const notification = record.notification
  return notification.app_icon || notification.desktop_entry || "dialog-information"
}

function title(record: NotificationRecord) {
  const notification = record.notification
  return notification.summary || notification.app_name || "Notification"
}

function timestamp(receivedAt: number) {
  return new Date(receivedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function actions(record: NotificationRecord) {
  return (record.notification.actions ?? []).filter((action) => action.id !== "default")
}

function ActionButton({
  action,
  record,
}: {
  action: NotificationAction
  record: NotificationRecord
}) {
  return (
    <button
      class="notification-action"
      onClicked={() => {
        markRead(record.id)
        action.invoke()
      }}
    >
      <label label={action.label || action.id} />
    </button>
  )
}

function NotificationCenterCard({ record }: { record: NotificationRecord }) {
  const notification = record.notification
  const appName = createBinding(notification, "app_name")
  const summary = createBinding(notification, "summary")
  const body = createBinding(notification, "body")
  const appIcon = createBinding(notification, "app_icon")
  const desktopEntry = createBinding(notification, "desktop_entry")
  const cardIcon = createComputed(() => appIcon() || desktopEntry() || iconName(record))
  const cardTitle = createComputed(() => summary() || title(record))
  const cardBody = createComputed(() => plainBody(body()))
  const cardClass = record.read
    ? "notification-center-card"
    : "notification-center-card unread"

  return (
    <box class={cardClass} orientation={Gtk.Orientation.VERTICAL}>
      <box orientation={Gtk.Orientation.HORIZONTAL}>
        <image iconName={cardIcon} pixelSize={32} useFallback />
        <box class="notification-center-content" orientation={Gtk.Orientation.VERTICAL} hexpand>
          <box orientation={Gtk.Orientation.HORIZONTAL}>
            <label class="notification-app" xalign={0} label={appName} hexpand />
            <label class="notification-time" label={timestamp(record.receivedAt)} />
            <button
              class="notification-close"
              tooltipText="Dismiss"
              onClicked={() => dismissNotification(record.id)}
            >
              <label label="x" />
            </button>
          </box>
          <label class="notification-title" xalign={0} label={cardTitle} />
          <label
            class="notification-body"
            xalign={0}
            wrap
            lines={5}
            label={cardBody}
            visible={createComputed(() => cardBody().length > 0)}
          />
        </box>
      </box>
      <box
        class="notification-actions"
        orientation={Gtk.Orientation.HORIZONTAL}
        visible={actions(record).length > 0}
      >
        <For each={createComputed(() => actions(record))}>
          {(action) => <ActionButton action={action} record={record} />}
        </For>
      </box>
      <box class="notification-card-footer" orientation={Gtk.Orientation.HORIZONTAL}>
        <button class="notification-secondary" onClicked={() => markRead(record.id)}>
          <label label={record.read ? "Read" : "Mark read"} />
        </button>
        <button class="notification-secondary" onClicked={() => clearRecord(record.id)}>
          <label label="Remove" />
        </button>
      </box>
    </box>
  )
}

export default function NotificationCenter(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, RIGHT } = Astal.WindowAnchor
  const dnd = createBinding(notifd, "dont_disturb")
  const titleText = createComputed(() =>
    unreadCount() === 0 ? "Notifications" : `Notifications (${unreadCount()})`,
  )

  return (
    <window
      visible={false}
      name="notification-center"
      class="NotificationCenter"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | BOTTOM | RIGHT}
      application={app}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <box class="notification-center-header" orientation={Gtk.Orientation.HORIZONTAL}>
          <label class="notification-center-title" xalign={0} hexpand label={titleText} />
          <button
            class={createComputed(() => (dnd() ? "dnd active" : "dnd"))}
            tooltipText="Do Not Disturb"
            onClicked={() => {
              notifd.dont_disturb = !notifd.dont_disturb
            }}
          >
            <image iconName="notifications-disabled-symbolic" pixelSize={18} useFallback />
          </button>
          <button tooltipText="Close" onClicked={() => app.toggle_window("notification-center")}>
            <label label="x" />
          </button>
        </box>
        <box class="notification-center-toolbar" orientation={Gtk.Orientation.HORIZONTAL}>
          <button onClicked={markAllRead}>
            <label label="Mark all read" />
          </button>
          <button onClicked={dismissAllNotifications}>
            <label label="Dismiss all" />
          </button>
          <button onClicked={clearAllRecords}>
            <label label="Clear history" />
          </button>
        </box>
        <scrolledwindow vexpand>
          <box class="notification-list" orientation={Gtk.Orientation.VERTICAL}>
            <box
              class="notification-empty"
              orientation={Gtk.Orientation.VERTICAL}
              visible={createComputed(() => records().length === 0)}
            >
              <image iconName="preferences-system-notifications-symbolic" pixelSize={42} useFallback />
              <label label="No notifications" />
            </box>
            <For each={records}>
              {(record) => <NotificationCenterCard record={record} />}
            </For>
          </box>
        </scrolledwindow>
      </box>
    </window>
  )
}
