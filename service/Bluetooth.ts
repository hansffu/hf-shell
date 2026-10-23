import AstalBluetooth from "gi://AstalBluetooth"
import AstalWp from "gi://AstalWp"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { createBinding, createComputed } from "gnim"

export type BluetoothDevice = AstalBluetooth.Device

export const bluetooth = AstalBluetooth.get_default()
const wp = AstalWp.get_default()

export const adapterAvailable = createBinding(bluetooth, "adapter").as(Boolean)
export const bluetoothPowered = createBinding(bluetooth, "is_powered")

const devices = createBinding(bluetooth, "devices")
const wpDevices = createBinding(wp, "devices")

export const pairedDevices = createComputed(() =>
  [...(devices() ?? [])]
    .filter((device) => createBinding(device, "paired")())
    .sort((left, right) => bluetoothDeviceName(left).localeCompare(bluetoothDeviceName(right))),
)

export const connectedCount = createComputed(
  () => pairedDevices().filter((device) => createBinding(device, "connected")()).length,
)

export function bluetoothDeviceName(device: BluetoothDevice) {
  return device.alias || device.name || device.address.toUpperCase()
}

function isHeadsetProfile(profile: AstalWp.Profile) {
  return /a2dp|handsfree|headset|hfp|hsp/i.test(profile.name)
}

// The WirePlumber device for a Bluetooth device, matched by its BlueZ address.
export function bluetoothAudioDevice(device: BluetoothDevice) {
  return createComputed(
    () =>
      (wpDevices() ?? []).find(
        (audioDevice) =>
          audioDevice.get_pw_property("api.bluez5.address")?.toUpperCase() ===
          device.address.toUpperCase(),
      ) ?? null,
  )
}

export function headsetProfiles(audioDevice: AstalWp.Device) {
  return createBinding(audioDevice, "profiles").as((profiles) =>
    (profiles ?? [])
      .filter(isHeadsetProfile)
      .sort(
        (left, right) =>
          Number(right.available !== AstalWp.Available.NO) -
          Number(left.available !== AstalWp.Available.NO),
      ),
  )
}

export function setBluetoothAudioProfile(audioDevice: AstalWp.Device, profile: AstalWp.Profile) {
  if (profile.available === AstalWp.Available.NO) return
  if (profile.index === audioDevice.active_profile_id) return

  audioDevice.set_active_profile_id(profile.index)
}

export function connectBluetoothDevice(device: BluetoothDevice) {
  device.connect_device((_source, result) => {
    try {
      device.connect_device_finish(result)
    } catch (error) {
      console.error(error)
    }
  })
}

export function disconnectBluetoothDevice(device: BluetoothDevice) {
  device.disconnect_device((_source, result) => {
    try {
      device.disconnect_device_finish(result)
    } catch (error) {
      console.error(error)
    }
  })
}

export function setBluetoothPowered(powered: boolean) {
  const adapter = bluetooth.adapter

  if (adapter && adapter.powered !== powered) adapter.powered = powered
}

export function openBluetoothManager() {
  const command = [
    ["blueman-manager"],
    ["overskride"],
    ["blueberry"],
    ["gnome-control-center", "bluetooth"],
    ["systemsettings", "kcm_bluetooth"],
  ].find(([program]) => GLib.find_program_in_path(program))

  if (command) execAsync(command).catch(console.error)
}
