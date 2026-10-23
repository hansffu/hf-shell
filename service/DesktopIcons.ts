import AstalApps from "gi://AstalApps"

const apps = new AstalApps.Apps()
const iconCache = new Map<string, string | null>()

// Include NoDisplay entries; their icons still apply to matching windows.
apps.show_hidden = true
apps.reload()

function normalizeId(id: string) {
  return id.toLowerCase().replace(/\.desktop$/, "")
}

function findAppIcon(appId: string) {
  const id = normalizeId(appId)
  const app = apps
    .get_list()
    .find((item) => normalizeId(item.entry) === id || item.wm_class?.toLowerCase() === id)

  return app?.icon_name || null
}

export function appIconName(
  appId: string | null | undefined,
  fallback = "application-x-executable",
) {
  if (!appId) return fallback
  if (!iconCache.has(appId)) iconCache.set(appId, findAppIcon(appId))

  return iconCache.get(appId) || appId || fallback
}
