import { Gtk } from "ags/gtk4"
import { For } from "gnim"
import type { Accessor } from "gnim"
import { markRead } from "../service/Notifications"
import type { NotificationAction, NotificationSnapshot } from "../service/Notifications"

export function notificationActions(notification: NotificationSnapshot): NotificationAction[] {
  return ((notification.actions ?? []) as NotificationAction[]).filter(
    (action) => action.id !== "default",
  )
}

export function NotificationActionButton({
  action,
  notificationId,
}: {
  action: NotificationAction
  notificationId: number
}) {
  return (
    <button
      class="notification-action"
      onClicked={() => {
        markRead(notificationId)
        action.invoke()
      }}
    >
      <label xalign={0} label={action.label || action.id} />
    </button>
  )
}

export function NotificationActions({
  actions,
  notificationId,
}: {
  actions: Accessor<NotificationAction[]>
  notificationId: number
}) {
  return (
    <box
      class="notification-actions"
      orientation={Gtk.Orientation.VERTICAL}
      visible={actions().length > 0}
    >
      <For each={actions}>
        {(action: NotificationAction) => (
          <NotificationActionButton action={action} notificationId={notificationId} />
        )}
      </For>
    </box>
  )
}
