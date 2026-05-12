import { Gtk } from "ags/gtk4"
import GObject from "gi://GObject"
import Niri from "gi://AstalNiri"
import { createBinding, createComputed, For } from "gnim"

type NiriWorkspace = GObject.Object & {
  id: number
}

type NiriWindowLayout = {
  pos_in_scrolling_layout: [number, number]
}

type NiriWindow = GObject.Object & {
  id: number
  app_id: string | null
  title: string | null
  workspace_id: number
  is_focused: boolean
  layout: NiriWindowLayout | null
  focus(id: number): boolean
}

const niri = Niri.get_default()

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
  const iconName = createComputed(() => appId() || "application-x-executable")
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
  const focusedWorkspace = createBinding(niri, "focusedWorkspace")
  const windows = createBinding(niri, "windows")
  const workspaceWindows = createComputed(() => {
    const workspace = focusedWorkspace() as NiriWorkspace | null
    const allWindows = (windows() as NiriWindow[] | null) ?? []

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
