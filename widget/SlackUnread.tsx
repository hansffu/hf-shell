import { Gtk } from "ags/gtk4"
import AstalTray from "gi://AstalTray"
import { createBinding, createComputed } from "gnim"
import { appIconName } from "../service/DesktopIcons"
import { niri } from "../service/Panels"
import {
  hasSlackTrayItem,
  slackJsonUnreadCount,
  slackJsonUnreadWorkspaces,
  slackTrayItem,
  slackUnreadCount,
  slackWindow,
} from "../service/Slack"

const tray = AstalTray.get_default()

export default function SlackUnread() {
  if (!niri) return null

  const trayItems = createBinding(tray, "items")
  const windows = createBinding(niri, "windows")
  const isSlackOpen = createComputed(() => hasSlackTrayItem(trayItems(), windows()))
  const fallbackCount = createComputed(() => slackUnreadCount(trayItems(), windows()))
  const count = createComputed(() => {
    const fallback = fallbackCount()
    const jsonCount = slackJsonUnreadCount()

    return isSlackOpen() ? jsonCount ?? fallback : 0
  })
  const label = createComputed(() => String(count()))
  const tooltip = createComputed(() => {
    const activeWorkspaces = slackJsonUnreadWorkspaces().filter(
      (workspace) => workspace.count > 0 || workspace.highlights > 0,
    )

    if (activeWorkspaces.length === 0) {
      return count() === 1 ? "Slack: 1 unread" : `Slack: ${count()} unread`
    }

    return activeWorkspaces
      .map((workspace) => {
        const unreadText =
          workspace.count === 1 ? "1 unread" : `${workspace.count} unread`
        const highlightText =
          workspace.highlights > 0
            ? `, ${workspace.highlights === 1 ? "1 highlight" : `${workspace.highlights} highlights`}`
            : ""

        return `${workspace.name}: ${unreadText}${highlightText}`
      })
      .join("\n")
  })

  return (
    <button
      class="slack-unread"
      tooltipText={tooltip}
      visible={isSlackOpen}
      onClicked={() => {
        const window = slackWindow(windows())

        if (window) {
          window.focus(window.id)
          return
        }

        slackTrayItem(trayItems())?.activate(0, 0)
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <image iconName={appIconName("slack")} pixelSize={18} useFallback />
        <label class="slack-badge" label={label} visible={createComputed(() => count() > 0)} />
      </box>
    </button>
  )
}
