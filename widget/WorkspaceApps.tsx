import { Gdk, Gtk } from "ags/gtk4"
import AstalNiri from "gi://AstalNiri"
import { createBinding, createComputed, For } from "gnim"
import { appIconName } from "../service/DesktopIcons"
import { niri } from "../service/Panels"

type NiriWindow = AstalNiri.Window
type NiriWorkspace = AstalNiri.Workspace

type MonitorIdentity = Gdk.Monitor & {
  connector?: string | null
  get_connector?: () => string | null
}

function monitorConnector(gdkmonitor: Gdk.Monitor) {
  const monitor = gdkmonitor as MonitorIdentity

  return monitor.connector || monitor.get_connector?.() || null
}

function appLabel(window: NiriWindow) {
  return window.app_id || window.title || "app"
}

function windowPosition(window: NiriWindow) {
  return window.layout?.pos_in_scrolling_layout ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
}

function compareWindows(left: NiriWindow, right: NiriWindow) {
  const [leftColumn, leftRow] = windowPosition(left)
  const [rightColumn, rightRow] = windowPosition(right)

  return leftColumn - rightColumn || leftRow - rightRow || left.id - right.id
}

function AppButton({ window }: { window: NiriWindow }) {
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

export default function WorkspaceApps({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  if (!niri) return <box class="WorkspaceApps" orientation={Gtk.Orientation.VERTICAL} />

  const output = monitorConnector(gdkmonitor)
  const focusedWorkspace = createBinding(niri, "focused_workspace")
  const workspaces = createBinding(niri, "workspaces")
  const windows = createBinding(niri, "windows")
  const workspaceWindows = createComputed(() => {
    const focused = focusedWorkspace()
    const outputWorkspaces = ((workspaces() as NiriWorkspace[] | null) ?? [])
      .filter((workspace) => !output || workspace.output === output)
    const workspace = outputWorkspaces.find((workspace) => workspace.is_active)
      ?? outputWorkspaces.find((workspace) => workspace.id === focused?.id)
      ?? outputWorkspaces.find((workspace) => workspace.is_focused)
    const allWindows = windows() as NiriWindow[] | null

    if (!workspace || !allWindows) return []

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
