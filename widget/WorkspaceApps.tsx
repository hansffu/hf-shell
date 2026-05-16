import { Gtk } from "ags/gtk4"
import AstalNiri from "gi://AstalNiri"
import { createBinding, createComputed, For } from "gnim"
import { appIconName } from "../service/DesktopIcons"

const niri = AstalNiri.get_default()

function appLabel(window: AstalNiri.Window) {
  return window.app_id || window.title || "app"
}

function windowPosition(window: AstalNiri.Window) {
  return window.layout?.pos_in_scrolling_layout ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
}

function compareWindows(left: AstalNiri.Window, right: AstalNiri.Window) {
  const [leftColumn, leftRow] = windowPosition(left)
  const [rightColumn, rightRow] = windowPosition(right)

  return leftColumn - rightColumn || leftRow - rightRow || left.id - right.id
}

function AppButton({ window }: { window: AstalNiri.Window }) {
  const appId = createBinding(window, "app_id")
  const title = createBinding(window, "title")
  const isFocused = createBinding(window, "is_focused")
  const iconName = createComputed(() => appIconName(appId()))
  const tooltip = createComputed(() => title() || appId() || appLabel(window))
  const className = createComputed(() => (isFocused() ? "app focused" : "app"))

  return (
    <button
      class={className}
      tooltipText={tooltip}
      onClicked={() => window.focus(window.id)}
    >
      <image iconName={iconName} pixelSize={18} useFallback />
    </button>
  )
}

export default function WorkspaceApps() {
  const focusedWorkspace = createBinding(niri, "focused_workspace")
  const windows = createBinding(niri, "windows")
  const workspaceWindows = createComputed(() => {
    const workspace = focusedWorkspace()
    const allWindows = windows()

    if (!workspace) return []

    return allWindows
      .filter((window) => window.workspace_id === workspace.id)
      .sort(compareWindows)
  })

  return (
    <box class="WorkspaceApps" orientation={Gtk.Orientation.VERTICAL}>
      <For each={workspaceWindows}>{(window) => <AppButton window={window} />}</For>
    </box>
  )
}
