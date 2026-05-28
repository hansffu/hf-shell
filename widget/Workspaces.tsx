import { Gdk, Gtk } from "ags/gtk4"
import { createBinding, createComputed, For } from "gnim"
import type { Accessor } from "gnim"
import AstalNiri from "gi://AstalNiri"
import { niri } from "../service/Panels"

type NiriWorkspace = AstalNiri.Workspace

type MonitorIdentity = Gdk.Monitor & {
  connector?: string | null
  get_connector?: () => string | null
}

function monitorConnector(gdkmonitor: Gdk.Monitor) {
  const monitor = gdkmonitor as MonitorIdentity

  return monitor.connector || monitor.get_connector?.() || null
}

function workspaceClass(
  workspace: NiriWorkspace,
  focusedWorkspace: NiriWorkspace | null,
  windows: unknown[] | null,
) {
  const classes = ["workspace"]
  const isFocused = workspace.is_active || focusedWorkspace?.id === workspace.id || workspace.is_focused

  if (isFocused) classes.push("focused")
  if (workspace.is_active) classes.push("active")
  if (workspace.is_urgent) classes.push("urgent")
  if (!isFocused && !workspace.is_active && (windows?.length ?? 0) === 0) classes.push("empty")

  return classes.join(" ")
}

function WorkspaceButton({
  workspace,
  focusedWorkspace,
}: {
  workspace: NiriWorkspace
  focusedWorkspace: Accessor<NiriWorkspace | null>
}) {
  const windows = createBinding(workspace, "windows")
  const className = createComputed(() =>
    workspaceClass(
      workspace,
      focusedWorkspace(),
      windows(),
    ),
  )

  return <button class={className} onClicked={() => workspace.focus()} />
}

export default function Workspaces({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  if (!niri) return <box $type="center" class="Workspaces" orientation={Gtk.Orientation.VERTICAL} />

  const output = monitorConnector(gdkmonitor)
  const workspaces = createBinding(niri, "workspaces").as(
    (workspaces: NiriWorkspace[] | null) =>
      (workspaces ?? [])
        .filter((workspace) => !output || workspace.output === output)
        .sort((a, b) => a.idx - b.idx),
  )
  const focusedWorkspace = createBinding(niri, "focused_workspace")

  return (
    <box $type="center" class="Workspaces" orientation={Gtk.Orientation.VERTICAL}>
      <For each={workspaces}>
        {(workspace) => (
          <WorkspaceButton workspace={workspace} focusedWorkspace={focusedWorkspace} />
        )}
      </For>
    </box>
  )
}
