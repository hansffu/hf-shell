import { Gdk, Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import type { Accessor } from "gnim"
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

const PANEL_HEIGHT_RATIO = 0.7
const PANEL_CHROME_HEIGHT = 112
const SECTION_MIN_HEIGHT = 96
const SECTION_GAP_HEIGHT = 28
const EMPTY_SECTION_HEIGHT = 220

function setupNotificationScroller(scroller: Gtk.ScrolledWindow) {
  scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroller.set_propagate_natural_height(true)
}

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
  maxHeight,
  records,
  title,
}: {
  maxHeight: Accessor<number>
  records: ReturnType<typeof unreadByUrgency>
  title: string
}) {
  const minHeight = createComputed(() => Math.min(SECTION_MIN_HEIGHT, maxHeight()))

  return (
    <PanelSection
      title={title}
      class="notification-center-section"
      visible={createComputed(() => records().length > 0)}
    >
      <scrolledwindow
        class="notification-section-scroll"
        minContentHeight={minHeight}
        maxContentHeight={maxHeight}
        $={(scroller: Gtk.ScrolledWindow) => {
          setupNotificationScroller(scroller)
        }}
      >
        <box class="notification-list" orientation={Gtk.Orientation.VERTICAL}>
          <For each={records}>
            {(record) => <NotificationCenterCard record={record} />}
          </For>
        </box>
      </scrolledwindow>
    </PanelSection>
  )
}

export default function NotificationCenter({
  gdkmonitor,
  onClose,
}: {
  gdkmonitor: Gdk.Monitor
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
  const maxPanelHeight = Math.floor(gdkmonitor.get_geometry().height * PANEL_HEIGHT_RATIO)
  const sectionCounts = createComputed(() => [
    criticalRecords().length,
    normalRecords().length,
    lowRecords().length,
    historyRecords().length,
  ])
  const visibleSectionCount = createComputed(() => sectionCounts().filter((count) => count > 0).length)
  const availableSectionHeight = createComputed(() => {
    const count = Math.max(1, visibleSectionCount())
    const reservedHeight = PANEL_CHROME_HEIGHT + Math.max(0, count - 1) * SECTION_GAP_HEIGHT

    return Math.max(SECTION_MIN_HEIGHT, maxPanelHeight - reservedHeight)
  })
  const sectionMaxHeight = (sectionRecords: ReturnType<typeof unreadByUrgency>) =>
    createComputed(() => {
      const recordCount = sectionRecords().length
      if (recordCount === 0) return SECTION_MIN_HEIGHT

      const visibleCount = Math.max(1, visibleSectionCount())
      const availableHeight = availableSectionHeight()
      const guaranteedHeight = SECTION_MIN_HEIGHT * visibleCount
      const extraHeight = Math.max(0, availableHeight - guaranteedHeight)
      const totalRecords = Math.max(1, sectionCounts().reduce((sum, count) => sum + count, 0))

      return SECTION_MIN_HEIGHT + Math.floor(extraHeight * (recordCount / totalRecords))
    })

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
          <box class="notification-list" orientation={Gtk.Orientation.VERTICAL} heightRequest={EMPTY_SECTION_HEIGHT}>
            <box class="notification-empty" orientation={Gtk.Orientation.VERTICAL}>
              <image iconName="preferences-system-notifications-symbolic" pixelSize={42} useFallback />
              <label label="No notifications" />
            </box>
          </box>
        </PanelSection>
        <NotificationSection
          title="Critical"
          records={criticalRecords}
          maxHeight={sectionMaxHeight(criticalRecords)}
        />
        <NotificationSection
          title="Normal"
          records={normalRecords}
          maxHeight={sectionMaxHeight(normalRecords)}
        />
        <NotificationSection
          title="Low"
          records={lowRecords}
          maxHeight={sectionMaxHeight(lowRecords)}
        />
        <NotificationSection
          title="History"
          records={historyRecords}
          maxHeight={sectionMaxHeight(historyRecords)}
        />
      </box>
    </Panel>
  )
}
