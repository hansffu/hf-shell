import { Gtk } from "ags/gtk4"
import AstalNiri from "gi://AstalNiri"
import GLib from "gi://GLib"
import { createBinding, createComputed, For } from "gnim"

const niri = AstalNiri.get_default()
const appIconCache = new Map<string, string | null>()
let desktopEntryIndex: Map<string, string> | null = null

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

function desktopId(appId: string) {
  return appId.endsWith(".desktop") ? appId : `${appId}.desktop`
}

function getDesktopIconFromDataDirs(appId: string) {
  try {
    const keyFile = GLib.KeyFile.new()
    const [loaded] = keyFile.load_from_data_dirs(
      `applications/${desktopId(appId)}`,
      GLib.KeyFileFlags.NONE,
    )

    if (!loaded) return null

    return keyFile.get_string(
      GLib.KEY_FILE_DESKTOP_GROUP,
      GLib.KEY_FILE_DESKTOP_KEY_ICON,
    )
  } catch (error) {
    void error
    return null
  }
}

function listDesktopFiles(directory: string) {
  try {
    const dir = GLib.Dir.open(directory, 0)
    const files: string[] = []
    let file = dir.read_name()

    while (file !== null) {
      const path = GLib.build_filenamev([directory, file])

      if (file.endsWith(".desktop")) {
        files.push(path)
      } else {
        files.push(...listDesktopFiles(path))
      }

      file = dir.read_name()
    }

    dir.close()
    return files
  } catch (error) {
    void error
    return []
  }
}

function buildDesktopEntryIndex() {
  const index = new Map<string, string>()
  const dataDirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]

  for (const dataDir of dataDirs) {
    const applicationsDir = GLib.build_filenamev([dataDir, "applications"])

    for (const file of listDesktopFiles(applicationsDir)) {
      try {
        const keyFile = GLib.KeyFile.new()

        keyFile.load_from_file(file, GLib.KeyFileFlags.NONE)

        const icon = keyFile.get_string(
          GLib.KEY_FILE_DESKTOP_GROUP,
          GLib.KEY_FILE_DESKTOP_KEY_ICON,
        )
        const desktopFileId = file.slice(applicationsDir.length + 1)
        const desktopAppId = desktopFileId.replace(/\.desktop$/, "")

        index.set(desktopAppId, icon)
        index.set(desktopAppId.toLowerCase(), icon)

        try {
          const startupWmClass = keyFile.get_string(
            GLib.KEY_FILE_DESKTOP_GROUP,
            GLib.KEY_FILE_DESKTOP_KEY_STARTUP_WM_CLASS,
          )

          if (startupWmClass) {
            index.set(startupWmClass, icon)
            index.set(startupWmClass.toLowerCase(), icon)
          }
        } catch (error) {
          void error
        }
      } catch (error) {
        void error
      }
    }
  }

  return index
}

function appIconName(appId: string | null) {
  if (!appId) return "application-x-executable"

  if (!appIconCache.has(appId)) {
    const icon = getDesktopIconFromDataDirs(appId) || getDesktopIconFromDataDirs(appId.toLowerCase())

    if (!icon) desktopEntryIndex ??= buildDesktopEntryIndex()

    appIconCache.set(
      appId,
      icon ||
        desktopEntryIndex?.get(appId) ||
        desktopEntryIndex?.get(appId.toLowerCase()) ||
        desktopEntryIndex?.get(desktopId(appId)) ||
        null,
    )
  }

  return appIconCache.get(appId) || appId
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
