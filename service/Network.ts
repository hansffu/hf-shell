import AstalNetwork from "gi://AstalNetwork"
import GLib from "gi://GLib"
import NM from "gi://NM"
import { execAsync } from "ags/process"
import { createBinding, createComputed, createState } from "gnim"

export type WifiAccessPoint = AstalNetwork.AccessPoint

export type VpnConnection = {
  active: NM.ActiveConnection | null
  connection: NM.RemoteConnection
  device: string
  name: string
}

const VPN_TYPES = new Set([NM.SETTING_VPN_SETTING_NAME, NM.SETTING_WIREGUARD_SETTING_NAME])

export const network = AstalNetwork.get_default()
export const wifi = network.wifi
const client = network.client

export const networkingEnabled = createBinding(client, "networkingEnabled")
export const wifiEnabled = wifi ? createBinding(wifi, "enabled") : createComputed(() => false)
export const activeAccessPoint = wifi
  ? createBinding(wifi, "activeAccessPoint")
  : createComputed((): WifiAccessPoint | null => null)

function readConnections() {
  return {
    active: (client.get_active_connections() ?? []).filter(Boolean),
    saved: (client.get_connections() ?? []).filter(Boolean),
  }
}

// libnm's connection lists can briefly hold objects that are being removed, so they are
// snapshotted on idle after the change signals instead of read inside the notify handlers.
const [connections, setConnections] = createState(readConnections())
let connectionsRefreshId = 0

function scheduleConnectionsRefresh() {
  if (connectionsRefreshId !== 0) return

  connectionsRefreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    connectionsRefreshId = 0
    setConnections(readConnections())
    return GLib.SOURCE_REMOVE
  })
}

for (const signal of [
  "connection-added",
  "connection-removed",
  "active-connection-added",
  "active-connection-removed",
]) {
  client.connect(signal, scheduleConnectionsRefresh)
}

const activeConnections = connections.as(({ active }) => active)
const savedConnections = connections.as(({ saved }) => saved)

const knownSsids = savedConnections.as(
  (saved) =>
    new Set(
      saved.flatMap((connection) => {
        const ssid = connection.get_setting_wireless()?.get_ssid()?.get_data()

        return ssid ? [NM.utils_ssid_to_utf8(ssid)] : []
      }),
    ),
)

export const activeWired = createComputed(
  () =>
    activeConnections().find(
      (connection) => connection.type === NM.SETTING_WIRED_SETTING_NAME,
    ) ?? null,
)

function compareAccessPoints(left: WifiAccessPoint, right: WifiAccessPoint, active: string | null) {
  return (
    Number(right.ssid === active) - Number(left.ssid === active) ||
    right.strength - left.strength ||
    (left.ssid ?? "").localeCompare(right.ssid ?? "")
  )
}

const accessPoints = wifi
  ? createBinding(wifi, "accessPoints")
  : createComputed((): WifiAccessPoint[] => [])

// One entry per SSID, keeping the strongest access point. Rescans update the strength of
// existing access points without changing the list, so strength is tracked per access point.
export const wifiAccessPoints = createComputed(() => {
  const active = activeAccessPoint()?.ssid ?? null
  const bySsid = new Map<string, WifiAccessPoint>()

  for (const accessPoint of accessPoints() ?? []) {
    createBinding(accessPoint, "strength")()

    const ssid = accessPoint.ssid
    const current = ssid ? bySsid.get(ssid) : null

    if (ssid && (!current || accessPoint.strength > current.strength)) {
      bySsid.set(ssid, accessPoint)
    }
  }

  return [...bySsid.values()].sort((left, right) => compareAccessPoints(left, right, active))
})

export const vpnConnections = createComputed(() => {
  const active = activeConnections()

  return savedConnections()
    .filter((connection) => VPN_TYPES.has(connection.get_connection_type()))
    .map((connection): VpnConnection => {
      const activeConnection =
        active.find((item) => item.uuid === connection.get_uuid()) ?? null

      return {
        active: activeConnection,
        connection,
        device: activeConnection?.get_devices()?.[0]?.get_iface() ?? "",
        name: connection.get_id() ?? "",
      }
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
        left.name.localeCompare(right.name),
    )
})

export const activeVpnCount = createComputed(
  () => vpnConnections().filter((connection) => connection.active).length,
)

export const networkStatus = createComputed(() => {
  const wired = activeWired()
  const accessPoint = activeAccessPoint()

  if (!networkingEnabled()) return "Networking disabled"
  if (accessPoint?.ssid) return accessPoint.ssid
  if (wired) return `Ethernet: ${wired.id}`
  if (!wifi) return "Wi-Fi unavailable"
  if (!wifiEnabled()) return "Wi-Fi disabled"

  return "Not connected"
})

const OFFLINE_ICON = "network-wireless-offline-symbolic"
const primary = createBinding(network, "primary")
const wifiIcon = wifi ? createBinding(wifi, "iconName") : createComputed(() => OFFLINE_ICON)
const wiredIcon = network.wired
  ? createBinding(network.wired, "iconName")
  : createComputed(() => OFFLINE_ICON)

export const networkIcon = createComputed(() => {
  if (!networkingEnabled()) return OFFLINE_ICON
  if (primary() === AstalNetwork.Primary.WIFI) return wifiIcon()
  if (primary() === AstalNetwork.Primary.WIRED) return wiredIcon()

  return OFFLINE_ICON
})

function logError(error: unknown) {
  console.error(error)
}

export function isKnownAccessPoint(accessPoint: WifiAccessPoint) {
  return Boolean(accessPoint.ssid && knownSsids().has(accessPoint.ssid))
}

export function setWifiEnabled(enabled: boolean) {
  if (wifi && wifi.enabled !== enabled) wifi.enabled = enabled
}

export function rescanWifi() {
  wifi?.scan()
}

export function connectWifi(accessPoint: WifiAccessPoint) {
  if (!wifi) return

  if (isKnownAccessPoint(accessPoint)) {
    accessPoint.activate(null, (_source, result) => {
      try {
        accessPoint.activate_finish(result)
      } catch (error) {
        logError(error)
      }
    })
    return
  }

  // Let NetworkManager fill in security settings and ask the secret agent for a password.
  client.add_and_activate_connection_async(
    null,
    wifi.device,
    accessPoint.get_path(),
    null,
    (_source, result) => {
      try {
        client.add_and_activate_connection_finish(result)
      } catch (error) {
        logError(error)
      }
    },
  )
}

export function disconnectWifi() {
  wifi?.deactivate_connection((_source, result) => {
    try {
      wifi.deactivate_connection_finish(result)
    } catch (error) {
      logError(error)
    }
  })
}

export function connectVpn(vpn: VpnConnection) {
  client.activate_connection_async(vpn.connection, null, null, null, (_source, result) => {
    try {
      client.activate_connection_finish(result)
    } catch (error) {
      logError(error)
    }
  })
}

export function disconnectVpn(vpn: VpnConnection) {
  if (!vpn.active) return

  client.deactivate_connection_async(vpn.active, null, (_source, result) => {
    try {
      client.deactivate_connection_finish(result)
    } catch (error) {
      logError(error)
    }
  })
}

export function openNetworkManager() {
  const command = [
    ["nm-connection-editor"],
    ["gnome-control-center", "network"],
    ["systemsettings", "kcm_networkmanagement"],
  ].find(([program]) => GLib.find_program_in_path(program))

  if (command) execAsync(command).catch(logError)
}
