import Gio from "gi://Gio"
import GLib from "gi://GLib"

export type BluetoothDevice = {
  connected: boolean
  mac: string
  name: string
  path?: string
}

export type BluetoothProfile = {
  active: boolean
  available: boolean
  description: string
  name: string
}

export type BluetoothAudioCard = {
  activeProfile: string
  name: string
  profiles: BluetoothProfile[]
}

export type BluetoothState = {
  adapterAvailable: boolean
  devices: BluetoothDevice[]
  powered: boolean
}

type PactlCard = {
  active_profile?: string | { name?: string }
  name?: string
  profiles?: Record<string, { available?: boolean | string; description?: string }>
  properties?: Record<string, string>
}

type BluezAdapter = {
  path: string
  powered: boolean
}

type BluezObjects = Record<string, Record<string, Record<string, unknown>>>

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

function normalizeMac(mac: string) {
  return mac.toUpperCase()
}

function cardAddress(mac: string) {
  return normalizeMac(mac).replaceAll(":", "_")
}

function parseYesNo(output: string, field: string) {
  const match = output.match(new RegExp(`^\\s*${field}:\\s+(yes|no)\\s*$`, "im"))

  return match?.[1] === "yes"
}

function parseName(output: string, fallback: string) {
  const alias = output.match(/^\s*Alias:\s+(.+)$/im)?.[1]
  const name = output.match(/^\s*Name:\s+(.+)$/im)?.[1]

  return alias || name || fallback
}

function parseDevices(output: string) {
  return output
    .split("\n")
    .map((line) => line.match(/^Device\s+([0-9A-F:]{17})\s+(.+)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      mac: normalizeMac(match[1]),
      name: match[2],
    }))
}

function unpackVariant(value: unknown) {
  if (value && typeof value === "object" && "deepUnpack" in value) {
    return (value as GLib.Variant).deepUnpack()
  }

  return value
}

function unpackString(value: unknown) {
  const unpacked = unpackVariant(value)

  return typeof unpacked === "string" ? unpacked : null
}

function unpackBoolean(value: unknown) {
  return unpackVariant(value) === true
}

function getBluezObjects() {
  try {
    const result = Gio.DBus.system.call_sync(
      "org.bluez",
      "/",
      "org.freedesktop.DBus.ObjectManager",
      "GetManagedObjects",
      null,
      new GLib.VariantType("(a{oa{sa{sv}}})"),
      Gio.DBusCallFlags.NONE,
      500,
      null,
    )

    return ((result?.deepUnpack() ?? [{}]) as [BluezObjects])[0]
  } catch (error) {
    void error
    return null
  }
}

function getBluezAdapter(objects = getBluezObjects()): BluezAdapter | null {
  if (!objects) return null

  for (const [path, interfaces] of Object.entries(objects)) {
    const adapter = interfaces["org.bluez.Adapter1"]

    if (!adapter) continue

    return {
      path,
      powered: unpackBoolean(adapter.Powered),
    }
  }

  return null
}

function getBluezDevices(objects = getBluezObjects()) {
  if (!objects) return []

  return Object.entries(objects)
    .map(([path, interfaces]): BluetoothDevice | null => {
      const device = interfaces["org.bluez.Device1"]

      if (!device || !unpackBoolean(device.Paired)) return null

      const mac = unpackString(device.Address)

      if (!mac) return null

      return {
        connected: unpackBoolean(device.Connected),
        mac: normalizeMac(mac),
        name: unpackString(device.Alias) || unpackString(device.Name) || normalizeMac(mac),
        path,
      }
    })
    .filter((device): device is BluetoothDevice => Boolean(device))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getBluetoothctlDevices() {
  return parseDevices(runSync(["bluetoothctl", "devices", "Paired"]) ?? "")
    .map((device) => {
      const info = runSync(["bluetoothctl", "info", device.mac]) ?? ""

      return {
        ...device,
        connected: parseYesNo(info, "Connected"),
        name: parseName(info, device.name),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function getBluetoothState(): BluetoothState {
  const bluezObjects = getBluezObjects()
  const adapter = getBluezAdapter(bluezObjects)
  const show = adapter ? null : runSync(["bluetoothctl", "show"])

  if (!adapter && !show) {
    return {
      adapterAvailable: false,
      devices: [],
      powered: false,
    }
  }

  const bluezDevices = getBluezDevices(bluezObjects)
  const devices = bluezDevices.length > 0 ? bluezDevices : getBluetoothctlDevices()

  return {
    adapterAvailable: true,
    devices,
    powered: adapter?.powered ?? parseYesNo(show ?? "", "Powered"),
  }
}

export function connectBluetoothDevice(device: BluetoothDevice) {
  if (device.path) {
    try {
      Gio.DBus.system.call_sync(
        "org.bluez",
        device.path,
        "org.bluez.Device1",
        "Connect",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        10000,
        null,
      )
      return
    } catch (error) {
      void error
    }
  }

  runAsync(["bluetoothctl", "connect", device.mac])
}

export function disconnectBluetoothDevice(device: BluetoothDevice) {
  if (device.path) {
    try {
      Gio.DBus.system.call_sync(
        "org.bluez",
        device.path,
        "org.bluez.Device1",
        "Disconnect",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        5000,
        null,
      )
      return
    } catch (error) {
      void error
    }
  }

  runAsync(["bluetoothctl", "disconnect", device.mac])
}

export function setBluetoothPowered(powered: boolean) {
  if (powered) runSync(["rfkill", "unblock", "bluetooth"])

  const adapter = getBluezAdapter()

  if (adapter) {
    try {
      Gio.DBus.system.call_sync(
        "org.bluez",
        adapter.path,
        "org.freedesktop.DBus.Properties",
        "Set",
        new GLib.Variant("(ssv)", [
          "org.bluez.Adapter1",
          "Powered",
          new GLib.Variant("b", powered),
        ]),
        null,
        Gio.DBusCallFlags.NONE,
        1000,
        null,
      )
      return
    } catch (error) {
      void error
    }
  }

  runAsync(["bluetoothctl", "power", powered ? "on" : "off"])
}

function activeProfileName(card: PactlCard) {
  if (typeof card.active_profile === "string") return card.active_profile

  return card.active_profile?.name ?? ""
}

function isBluetoothAudioCard(card: PactlCard, mac: string) {
  const address = cardAddress(mac)
  const deviceString = card.properties?.["device.string"]

  return card.name?.includes(address) || deviceString === normalizeMac(mac)
}

function isHeadsetProfile(name: string) {
  const lower = name.toLowerCase()

  return (
    lower.includes("a2dp") ||
    lower.includes("handsfree") ||
    lower.includes("headset") ||
    lower.includes("hfp") ||
    lower.includes("hsp")
  )
}

function isProfileAvailable(profile: { available?: boolean | string }) {
  return profile.available !== false && profile.available !== "no"
}

export function getBluetoothAudioCard(mac: string): BluetoothAudioCard | null {
  const output = runSync(["pactl", "-f", "json", "list", "cards"])

  if (!output) return null

  try {
    const cards = JSON.parse(output) as PactlCard[]
    const card = cards.find((candidate) => isBluetoothAudioCard(candidate, mac))

    if (!card?.name || !card.profiles) return null

    const activeProfile = activeProfileName(card)
    const profiles = Object.entries(card.profiles)
      .filter(([name]) => isHeadsetProfile(name))
      .map(([name, profile]) => ({
        active: name === activeProfile,
        available: isProfileAvailable(profile),
        description: profile.description || name,
        name,
      }))
      .sort((left, right) => Number(right.available) - Number(left.available))

    return {
      activeProfile,
      name: card.name,
      profiles,
    }
  } catch (error) {
    void error
    return null
  }
}

export function setBluetoothAudioProfile(card: BluetoothAudioCard, profile: BluetoothProfile) {
  if (!profile.available || profile.active) return

  runAsync(["pactl", "set-card-profile", card.name, profile.name])
}

function launchFirstAvailable(candidates: string[][]) {
  const command = candidates.find(([program]) => GLib.find_program_in_path(program))

  if (command) runAsync(command)
}

export function openBluetoothManager() {
  launchFirstAvailable([
    ["blueman-manager"],
    ["overskride"],
    ["blueberry"],
    ["gnome-control-center", "bluetooth"],
    ["systemsettings", "kcm_bluetooth"],
  ])
}
