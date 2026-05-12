import { Gdk, Gtk } from "ags/gtk4"
import Niri from "gi://AstalNiri"
import { createBinding, createComputed, For } from "gnim"

type NiriWorkspace = {
  id: number
  idx: number
  name: string | null
  output: string | null
  is_urgent: boolean
  is_active: boolean
  is_focused: boolean
  windows: unknown[]
  focus(): boolean
}

const niri = Niri.get_default()

function workspaceClass(
  workspace: NiriWorkspace,
  focusedWorkspace: NiriWorkspace | null,
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
  workspace: NiriWorkspace
  focusedWorkspace: ReturnType<typeof createBinding>
}) {
  const windows = createBinding(workspace, "windows")
  const className = createComputed(() =>
    workspaceClass(
      workspace,
      focusedWorkspace() as NiriWorkspace | null,
      windows() as unknown[] | null,
    ),
  )

  return <button class={className} onClicked={() => workspace.focus()} />
}

export default function Workspaces({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const output = gdkmonitor.connector
  const workspaces = createBinding(niri, "workspaces").as(
    (workspaces: NiriWorkspace[] | null) =>
      (workspaces ?? [])
        .filter((workspace) => !output || workspace.output === output)
        .sort((a, b) => a.idx - b.idx),
  )
  const focusedWorkspace = createBinding(niri, "focusedWorkspace")

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
