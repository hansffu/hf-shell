import Gio from "gi://Gio"
import GLib from "gi://GLib"

export type WifiAccessPoint = {
  active: boolean
  knownConnection: string | null
  security: string
  signal: number
  ssid: string
}

export type VpnConnection = {
  active: boolean
  device: string
  name: string
  type: string
}

export type NetworkState = {
  activeWifi: WifiAccessPoint | null
  connectivity: string
  networkingEnabled: boolean
  vpnConnections: VpnConnection[]
  wifiAccessPoints: WifiAccessPoint[]
  wifiDevice: string | null
  wifiEnabled: boolean
}

export type NetworkSummary = {
  activeVpnCount: number
  activeWifiName: string | null
  networkingEnabled: boolean
  wifiDevice: string | null
  wifiEnabled: boolean
}

type ActiveConnection = {
  device: string
  name: string
  type: string
}

type SavedConnection = {
  device: string
  name: string
  type: string
}

function bytesToString(bytes: Uint8Array) {
  return String.fromCharCode(...bytes)
}

function runSync(args: string[]) {
  try {
    const [ok, stdout, stderr, status] = GLib.spawn_sync(
      null,
      args,
      null,
      GLib.SpawnFlags.SEARCH_PATH,
      null,
    )

    if (!ok || status !== 0) {
      void stderr
      return null
    }

    return bytesToString(stdout ?? new Uint8Array()).trim()
  } catch (error) {
    void error
    return null
  }
}

function runAsync(args: string[]) {
  try {
    GLib.spawn_async(null, args, null, GLib.SpawnFlags.SEARCH_PATH, null)
  } catch (error) {
    void error
  }
}

function runOutputAsync(args: string[]) {
  return new Promise<string | null>((resolve) => {
    try {
      const process = Gio.Subprocess.new(
        args,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      )

      process.communicate_utf8_async(null, null, (_process, result) => {
        try {
          const [ok, stdout] = process.communicate_utf8_finish(result)
          const successful = ok && process.get_successful()

          resolve(successful ? (stdout ?? "").trim() : null)
        } catch (error) {
          void error
          resolve(null)
        }
      })
    } catch (error) {
      void error
      resolve(null)
    }
  })
}

function nmcli(args: string[]) {
  return runSync(["nmcli", "--terse", "--escape", "yes", ...args])
}

function nmcliAsync(args: string[]) {
  return runOutputAsync(["nmcli", "--terse", "--escape", "yes", ...args])
}

function parseEscapedLine(line: string) {
  const fields: string[] = []
  let current = ""
  let escaping = false

  for (const char of line) {
    if (escaping) {
      current += char
      escaping = false
    } else if (char === "\\") {
      escaping = true
    } else if (char === ":") {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }

  fields.push(current)

  return fields
}

function parseRows(output: string | null) {
  if (!output) return []

  return output
    .split("\n")
    .filter(Boolean)
    .map(parseEscapedLine)
}

function normalizeType(type: string) {
  return type.toLowerCase()
}

function isWifiType(type: string) {
  return normalizeType(type).includes("wireless") || normalizeType(type) === "wifi"
}

function isVpnType(type: string) {
  const lower = normalizeType(type)

  return lower === "vpn" || lower === "wireguard"
}

function getRadioState(name: string) {
  return nmcli(["radio", name]) === "enabled"
}

function getNetworkingState() {
  return nmcli(["networking"]) === "enabled"
}

function getConnectivity() {
  return nmcli(["-f", "CONNECTIVITY", "general"]) || "unknown"
}

async function getConnectivityAsync() {
  return (await nmcliAsync(["-f", "CONNECTIVITY", "general"])) || "unknown"
}

function getWifiDevice() {
  const row = parseRows(nmcli(["-f", "DEVICE,TYPE,STATE", "device", "status"]))
    .find(([, type]) => isWifiType(type ?? ""))

  return row?.[0] || null
}

async function getWifiDeviceAsync() {
  const row = parseRows(await nmcliAsync(["-f", "DEVICE,TYPE,STATE", "device", "status"]))
    .find(([, type]) => isWifiType(type ?? ""))

  return row?.[0] || null
}

function getSavedConnections() {
  return parseRows(nmcli(["-f", "NAME,TYPE,DEVICE", "connection", "show"]))
    .map(([name, type, device]) => ({
      device: device || "",
      name: name || "",
      type: type || "",
    }))
    .filter((connection) => connection.name)
}

async function getSavedConnectionsAsync() {
  return parseRows(await nmcliAsync(["-f", "NAME,TYPE,DEVICE", "connection", "show"]))
    .map(([name, type, device]) => ({
      device: device || "",
      name: name || "",
      type: type || "",
    }))
    .filter((connection) => connection.name)
}

function getActiveConnections() {
  return parseRows(nmcli(["-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"]))
    .map(([name, type, device]) => ({
      device: device || "",
      name: name || "",
      type: type || "",
    }))
    .filter((connection) => connection.name)
}

async function getActiveConnectionsAsync() {
  return parseRows(await nmcliAsync(["-f", "NAME,TYPE,DEVICE", "connection", "show", "--active"]))
    .map(([name, type, device]) => ({
      device: device || "",
      name: name || "",
      type: type || "",
    }))
    .filter((connection) => connection.name)
}

function connectionSsid(connectionName: string) {
  const ssid = nmcli(["-g", "802-11-wireless.ssid", "connection", "show", connectionName])

  return ssid || connectionName
}

async function connectionSsidAsync(connectionName: string) {
  const ssid = await nmcliAsync(["-g", "802-11-wireless.ssid", "connection", "show", connectionName])

  return ssid || connectionName
}

function getKnownWifiMap(saved: SavedConnection[]) {
  const known = new Map<string, string>()

  for (const connection of saved.filter((item) => isWifiType(item.type))) {
    known.set(connectionSsid(connection.name), connection.name)
  }

  return known
}

async function getKnownWifiMapAsync(saved: SavedConnection[]) {
  const known = new Map<string, string>()

  await Promise.all(
    saved
      .filter((item) => isWifiType(item.type))
      .map(async (connection) => {
        known.set(await connectionSsidAsync(connection.name), connection.name)
      }),
  )

  return known
}

function compareAccessPoints(left: WifiAccessPoint, right: WifiAccessPoint) {
  const active = Number(right.active) - Number(left.active)

  if (active !== 0) return active

  return right.signal - left.signal || left.ssid.localeCompare(right.ssid)
}

function getWifiAccessPoints(known: Map<string, string>, active: ActiveConnection[]) {
  const activeWifiNames = new Set(active.filter((item) => isWifiType(item.type)).map((item) => item.name))
  const bySsid = new Map<string, WifiAccessPoint>()

  for (const [activeFlag, ssid, signal, security] of parseRows(
    nmcli(["-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "no"]),
  )) {
    if (!ssid) continue

    const candidate: WifiAccessPoint = {
      active: activeFlag === "*",
      knownConnection: known.get(ssid) ?? null,
      security: security || "",
      signal: Number(signal) || 0,
      ssid,
    }
    const current = bySsid.get(ssid)

    if (!current || candidate.active || candidate.signal > current.signal) bySsid.set(ssid, candidate)
  }

  for (const [ssid, connection] of known) {
    const current = bySsid.get(ssid)

    if (!current) {
      bySsid.set(ssid, {
        active: activeWifiNames.has(connection),
        knownConnection: connection,
        security: "",
        signal: 0,
        ssid,
      })
    } else if (!current.knownConnection) {
      current.knownConnection = connection
    }
  }

  return [...bySsid.values()].sort(compareAccessPoints)
}

async function getWifiAccessPointsAsync(known: Map<string, string>, active: ActiveConnection[]) {
  const activeWifiNames = new Set(active.filter((item) => isWifiType(item.type)).map((item) => item.name))
  const bySsid = new Map<string, WifiAccessPoint>()

  for (const [activeFlag, ssid, signal, security] of parseRows(
    await nmcliAsync(["-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "no"]),
  )) {
    if (!ssid) continue

    const candidate: WifiAccessPoint = {
      active: activeFlag === "*",
      knownConnection: known.get(ssid) ?? null,
      security: security || "",
      signal: Number(signal) || 0,
      ssid,
    }
    const current = bySsid.get(ssid)

    if (!current || candidate.active || candidate.signal > current.signal) bySsid.set(ssid, candidate)
  }

  for (const [ssid, connection] of known) {
    const current = bySsid.get(ssid)

    if (!current) {
      bySsid.set(ssid, {
        active: activeWifiNames.has(connection),
        knownConnection: connection,
        security: "",
        signal: 0,
        ssid,
      })
    } else if (!current.knownConnection) {
      current.knownConnection = connection
    }
  }

  return [...bySsid.values()].sort(compareAccessPoints)
}

function getVpnConnections(saved: SavedConnection[], active: ActiveConnection[]) {
  const activeByName = new Map(active.filter((item) => isVpnType(item.type)).map((item) => [item.name, item]))

  return saved
    .filter((connection) => isVpnType(connection.type))
    .map((connection) => {
      const activeConnection = activeByName.get(connection.name)

      return {
        active: Boolean(activeConnection),
        device: activeConnection?.device || connection.device,
        name: connection.name,
        type: connection.type,
      }
    })
    .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
}

export function getNetworkState(): NetworkState {
  const saved = getSavedConnections()
  const active = getActiveConnections()
  const knownWifi = getKnownWifiMap(saved)
  const wifiAccessPoints = getWifiAccessPoints(knownWifi, active)
  const activeWifi = wifiAccessPoints.find((accessPoint) => accessPoint.active) ?? null

  return {
    activeWifi,
    connectivity: getConnectivity(),
    networkingEnabled: getNetworkingState(),
    vpnConnections: getVpnConnections(saved, active),
    wifiAccessPoints,
    wifiDevice: getWifiDevice(),
    wifiEnabled: getRadioState("wifi"),
  }
}

export async function getNetworkStateAsync(): Promise<NetworkState> {
  const [saved, active, connectivity, networkingEnabled, wifiDevice, wifiEnabled] = await Promise.all([
    getSavedConnectionsAsync(),
    getActiveConnectionsAsync(),
    getConnectivityAsync(),
    nmcliAsync(["networking"]).then((state) => state === "enabled"),
    getWifiDeviceAsync(),
    nmcliAsync(["radio", "wifi"]).then((state) => state === "enabled"),
  ])
  const knownWifi = await getKnownWifiMapAsync(saved)
  const wifiAccessPoints = await getWifiAccessPointsAsync(knownWifi, active)
  const activeWifi = wifiAccessPoints.find((accessPoint) => accessPoint.active) ?? null
  const vpnConnections = getVpnConnections(saved, active)

  return {
    activeWifi,
    connectivity,
    networkingEnabled,
    vpnConnections,
    wifiAccessPoints,
    wifiDevice,
    wifiEnabled,
  }
}

export function getNetworkSummary(): NetworkSummary {
  const active = getActiveConnections()
  const activeWifi = active.find((connection) => isWifiType(connection.type))

  return {
    activeVpnCount: active.filter((connection) => isVpnType(connection.type)).length,
    activeWifiName: activeWifi?.name ?? null,
    networkingEnabled: getNetworkingState(),
    wifiDevice: getWifiDevice(),
    wifiEnabled: getRadioState("wifi"),
  }
}

export async function getNetworkSummaryAsync(): Promise<NetworkSummary> {
  const [active, networkingEnabled, wifiDevice, wifiEnabled] = await Promise.all([
    getActiveConnectionsAsync(),
    nmcliAsync(["networking"]).then((state) => state === "enabled"),
    getWifiDeviceAsync(),
    nmcliAsync(["radio", "wifi"]).then((state) => state === "enabled"),
  ])
  const activeWifi = active.find((connection) => isWifiType(connection.type))
  const activeVpnCount = active.filter((connection) => isVpnType(connection.type)).length

  return {
    activeVpnCount,
    activeWifiName: activeWifi?.name ?? null,
    networkingEnabled,
    wifiDevice,
    wifiEnabled,
  }
}

export function connectNetworkStateSignals(refresh: () => void) {
  const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
    refresh()
    return GLib.SOURCE_CONTINUE
  })

  return () => GLib.source_remove(timer)
}

export function setWifiEnabled(enabled: boolean) {
  runAsync(["nmcli", "radio", "wifi", enabled ? "on" : "off"])
}

export function connectWifi(accessPoint: WifiAccessPoint) {
  if (accessPoint.knownConnection) {
    runAsync(["nmcli", "connection", "up", accessPoint.knownConnection])
    return
  }

  runAsync(["nmcli", "device", "wifi", "connect", accessPoint.ssid])
}

export function disconnectWifi(device: string | null) {
  if (device) runAsync(["nmcli", "device", "disconnect", device])
}

export function rescanWifi() {
  runAsync(["nmcli", "device", "wifi", "rescan"])
}

export function connectVpn(connection: VpnConnection) {
  runAsync(["nmcli", "connection", "up", connection.name])
}

export function disconnectVpn(connection: VpnConnection) {
  runAsync(["nmcli", "connection", "down", connection.name])
}

function launchFirstAvailable(candidates: string[][]) {
  const command = candidates.find(([program]) => GLib.find_program_in_path(program))

  if (command) runAsync(command)
}

export function openNetworkManager() {
  launchFirstAvailable([
    ["nm-connection-editor"],
    ["gnome-control-center", "wifi"],
    ["systemsettings", "kcm_networkmanagement"],
  ])
}
