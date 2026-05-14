import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import {
  clearAllRecords,
  clearRecord,
  dismissAllNotifications,
  dismissNotification,
  markAllRead,
  notifd,
  records,
  unreadCount,
} from "../service/Notifications"
import type { NotificationRecord } from "../service/Notifications"
import NotificationCard from "./NotificationCard"
import Panel from "./Panel"

function NotificationCenterCard({ record }: { record: NotificationRecord }) {
  return (
    <NotificationCard
      class={record.read ? "center" : "center unread"}
      notification={record.notification}
      onDismiss={(id) => {
        dismissNotification(id)
        clearRecord(id)
      }}
      showProgress={false}
    />
  )
}

export default function NotificationCenter({
  onClose,
}: {
  onClose: () => void
}) {
  const dnd = createBinding(notifd, "dont_disturb")
  const titleText = createComputed(() =>
    unreadCount() === 0 ? "Notifications" : `Notifications (${unreadCount()})`,
  )

  return (
    <Panel
      title={titleText}
      class="notification-center-panel"
      headerEnd={
        <box class="notification-center-header-actions" orientation={Gtk.Orientation.HORIZONTAL}>
          <button
            class={createComputed(() => (dnd() ? "dnd active" : "dnd"))}
            tooltipText="Do Not Disturb"
            onClicked={() => {
              notifd.dont_disturb = !notifd.dont_disturb
            }}
          >
            <image iconName="notifications-disabled-symbolic" pixelSize={18} useFallback />
          </button>
          <button tooltipText="Close" onClicked={onClose}>
            <image iconName="window-close-symbolic" pixelSize={16} useFallback />
          </button>
        </box>
      }
    >
      <box
        class="notification-center-body"
        orientation={Gtk.Orientation.VERTICAL}
      >
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
      </box>
    </Panel>
  )
}
