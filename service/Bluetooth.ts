import AstalBluetooth from "gi://AstalBluetooth"
import GLib from "gi://GLib"

const bluetooth = AstalBluetooth.get_default()

export type BluetoothDevice = AstalBluetooth.Device

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

export function getBluetoothState(): BluetoothState {
  const devices = [...(bluetooth.devices ?? [])]
    .filter((device) => device.paired)
    .sort((left, right) => bluetoothDeviceName(left).localeCompare(bluetoothDeviceName(right)))

  return {
    adapterAvailable: Boolean(bluetooth.adapter),
    devices,
    powered: bluetooth.is_powered,
  }
}

export function connectBluetoothDevice(device: BluetoothDevice) {
  try {
    device.connect_device((_source, result) => {
      try {
        device.connect_device_finish(result)
      } catch (error) {
        void error
      }
    })
  } catch (error) {
    void error
  }
}

export function disconnectBluetoothDevice(device: BluetoothDevice) {
  try {
    device.disconnect_device((_source, result) => {
      try {
        device.disconnect_device_finish(result)
      } catch (error) {
        void error
      }
    })
  } catch (error) {
    void error
  }
}

export function setBluetoothPowered(powered: boolean) {
  const adapter = bluetooth.adapter

  if (adapter && adapter.powered !== powered) adapter.powered = powered
}

export function connectBluetoothStateSignals(refresh: () => void) {
  bluetooth.connect("notify::adapter", refresh)
  bluetooth.connect("notify::adapters", refresh)
  bluetooth.connect("notify::devices", refresh)
  bluetooth.connect("notify::is-powered", refresh)
  bluetooth.connect("notify::is-connected", refresh)
  bluetooth.connect("adapter-added", refresh)
  bluetooth.connect("adapter-removed", refresh)
  bluetooth.connect("device-added", (_service, device) => {
    connectBluetoothDeviceSignals(device, refresh)
    refresh()
  })
  bluetooth.connect("device-removed", refresh)

  for (const device of bluetooth.devices ?? []) connectBluetoothDeviceSignals(device, refresh)
}

export function connectBluetoothDeviceSignals(device: BluetoothDevice, refresh: () => void) {
  device.connect("notify::alias", refresh)
  device.connect("notify::connected", refresh)
  device.connect("notify::connecting", refresh)
  device.connect("notify::paired", refresh)
  device.connect("notify::battery-percentage", refresh)
}

export function bluetoothDeviceName(device: BluetoothDevice) {
  return device.alias || device.name || normalizeMac(device.address)
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
