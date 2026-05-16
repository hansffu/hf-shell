import GLib from "gi://GLib"

const appIconCache = new Map<string, string | null>()
let desktopEntryIndex: Map<string, string> | null = null

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
        index.set(desktopId(desktopAppId), icon)

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

export function appIconName(
  appId: string | null | undefined,
  fallback = "application-x-executable",
) {
  if (!appId) return fallback

  if (!appIconCache.has(appId)) {
    const icon =
      getDesktopIconFromDataDirs(appId) || getDesktopIconFromDataDirs(appId.toLowerCase())

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

  return appIconCache.get(appId) || appId || fallback
}
