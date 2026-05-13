import { Gdk, Gtk } from "ags/gtk4"
import AstalNiri from "gi://AstalNiri"
import { createBinding, createComputed, For } from "gnim"
import type { Accessor } from "gnim"

const niri = AstalNiri.get_default()

function workspaceClass(
  workspace: AstalNiri.Workspace,
  focusedWorkspace: AstalNiri.Workspace | null,
  windows: unknown[] | null,
) {
  const classes = ["workspace"]
  const isFocused = focusedWorkspace?.id === workspace.id || workspace.is_focused

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
  workspace: AstalNiri.Workspace
  focusedWorkspace: Accessor<AstalNiri.Workspace | null>
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
  const output = gdkmonitor.connector
  const workspaces = createBinding(niri, "workspaces").as(
    (workspaces: AstalNiri.Workspace[] | null) =>
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
