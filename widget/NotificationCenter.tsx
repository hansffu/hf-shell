import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import {
  clearAllRecords,
  clearRecord,
  dismissNotification,
  notifd,
  notificationCenterUnreadIds,
  notificationUrgency,
  records,
  unreadCount,
} from "../service/Notifications"
import type { NotificationRecord, NotificationUrgency } from "../service/Notifications"
import NotificationCard from "./NotificationCard"
import Panel, { PanelSection } from "./Panel"

function isDisplayUnread(record: NotificationRecord) {
  return !record.read || notificationCenterUnreadIds().has(record.id)
}

function NotificationCenterCard({ record }: { record: NotificationRecord }) {
  return (
    <NotificationCard
      class={isDisplayUnread(record) ? "center unread" : "center"}
      notification={record.notification}
      onDismiss={(id) => {
        dismissNotification(id)
        clearRecord(id)
      }}
      showProgress={false}
    />
  )
}

function unreadByUrgency(urgency: NotificationUrgency) {
  return createComputed(() =>
    records().filter((record) =>
      isDisplayUnread(record) && notificationUrgency(record.notification) === urgency,
    ),
  )
}

function NotificationSection({
  records,
  title,
}: {
  records: ReturnType<typeof unreadByUrgency>
  title: string
}) {
  return (
    <PanelSection
      title={title}
      class="notification-center-section"
      visible={createComputed(() => records().length > 0)}
    >
      <box class="notification-list" orientation={Gtk.Orientation.VERTICAL}>
        <For each={records}>
          {(record) => <NotificationCenterCard record={record} />}
        </For>
      </box>
    </PanelSection>
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
  const criticalRecords = unreadByUrgency("critical")
  const normalRecords = unreadByUrgency("normal")
  const lowRecords = unreadByUrgency("low")
  const historyRecords = createComputed(() => records().filter((record) => !isDisplayUnread(record)))
  const hasNotifications = createComputed(() => records().length > 0)

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
          <button tooltipText="Clear history" onClicked={clearAllRecords}>
            <image iconName="user-trash-symbolic" pixelSize={16} useFallback />
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
        <PanelSection
          title="Notifications"
          class="notification-center-section"
          visible={createComputed(() => !hasNotifications())}
        >
          <box class="notification-list" orientation={Gtk.Orientation.VERTICAL}>
            <box class="notification-empty" orientation={Gtk.Orientation.VERTICAL}>
              <image iconName="preferences-system-notifications-symbolic" pixelSize={42} useFallback />
              <label label="No notifications" />
            </box>
          </box>
        </PanelSection>
        <NotificationSection title="Critical" records={criticalRecords} />
        <NotificationSection title="Normal" records={normalRecords} />
        <NotificationSection title="Low" records={lowRecords} />
        <PanelSection
          title="History"
          class="notification-center-section"
          visible={createComputed(() => historyRecords().length > 0)}
        >
          <box class="notification-list" orientation={Gtk.Orientation.VERTICAL}>
            <For each={historyRecords}>
              {(record) => <NotificationCenterCard record={record} />}
            </For>
          </box>
        </PanelSection>
      </box>
    </Panel>
  )
}
