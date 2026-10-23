import { Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp"
import { createBinding, createComputed, createState, For, With } from "gnim"
import {
  type BluetoothDevice,
  adapterAvailable,
  bluetoothAudioDevice,
  bluetoothDeviceName,
  bluetoothPowered,
  connectBluetoothDevice,
  connectedCount,
  disconnectBluetoothDevice,
  headsetProfiles,
  openBluetoothManager,
  pairedDevices,
  setBluetoothAudioProfile,
  setBluetoothPowered,
} from "../service/Bluetooth"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"
import Select from "./Select"

function connectedLabel(count: number) {
  if (count === 0) return "No devices connected"
  if (count === 1) return "1 device connected"

  return `${count} devices connected`
}

function profileLabel(profile: AstalWp.Profile) {
  const name = profile.name.toLowerCase()
  const prefix = name.includes("a2dp")
    ? "Music"
    : name.includes("handsfree") || name.includes("headset") || name.includes("hfp")
      ? "Handsfree"
      : "Profile"
  const availability = profile.available === AstalWp.Available.NO ? " (unavailable)" : ""

  return `${prefix}: ${profile.description || profile.name}${availability}`
}

function uniqueProfileLabels(profiles: AstalWp.Profile[]) {
  const labels = profiles.map(profileLabel)
  const counts = new Map<string, number>()

  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)

  return labels.map((label, index) =>
    counts.get(label) === 1 ? label : `${label} (${profiles[index].name})`,
  )
}

function EmptyState() {
  const iconName = adapterAvailable.as((available) =>
    available ? "bluetooth-disabled-symbolic" : "dialog-warning-symbolic",
  )
  const label = createComputed(() => {
    if (!adapterAvailable()) return "Bluetooth is not available"
    if (!bluetoothPowered()) return "Bluetooth is powered off"

    return "No paired devices"
  })

  return (
    <box class="bluetooth-empty" orientation={Gtk.Orientation.VERTICAL}>
      <image iconName={iconName} pixelSize={28} useFallback />
      <label label={label} />
    </box>
  )
}

function ProfileDropdown({ device }: { device: BluetoothDevice }) {
  const audioDevice = bluetoothAudioDevice(device)

  return (
    <box hexpand>
      <With value={audioDevice}>
        {(card) => {
          if (!card) {
            return (
              <Select
                class="bluetooth-profile-select"
                hexpand
                items={createComputed(() => ["No audio profile"])}
                selected={createComputed(() => 0)}
                sensitive={false}
                onSelect={() => {}}
              />
            )
          }

          const profiles = headsetProfiles(card)
          const activeProfileId = createBinding(card, "activeProfileId")

          return (
            <Select
              class="bluetooth-profile-select"
              hexpand
              items={profiles.as((items) =>
                items.length > 0 ? uniqueProfileLabels(items) : ["No headset profiles"],
              )}
              selected={createComputed(() =>
                profiles().findIndex((profile) => profile.index === activeProfileId()),
              )}
              sensitive={profiles.as((items) => items.length > 0)}
              onSelect={(index) => {
                const profile = profiles()[index]

                if (profile) setBluetoothAudioProfile(card, profile)
              }}
            />
          )
        }}
      </With>
    </box>
  )
}

function DeviceRow({ device }: { device: BluetoothDevice }) {
  const connected = createBinding(device, "connected")
  const connecting = createBinding(device, "connecting")
  const battery = createBinding(device, "battery_percentage")
  const name = createBinding(device, "alias").as(() => bluetoothDeviceName(device))
  const status = createComputed(() => {
    if (connecting()) return "Connecting"
    if (!connected()) return "Disconnected"

    return battery() >= 0 ? `Connected, ${battery()}% battery` : "Connected"
  })

  return (
    <box class="bluetooth-device-row" orientation={Gtk.Orientation.VERTICAL}>
      <box class="bluetooth-device-header" orientation={Gtk.Orientation.HORIZONTAL}>
        <image
          iconName={connected.as((value) =>
            value ? "bluetooth-active-symbolic" : "bluetooth-symbolic",
          )}
          pixelSize={18}
          useFallback
        />
        <box class="bluetooth-device-labels" orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="bluetooth-device-name" xalign={0} label={name} />
          <label class="bluetooth-device-status" xalign={0} label={status} />
        </box>
        <button
          class={connected.as((value) =>
            value ? "bluetooth-connect active" : "bluetooth-connect",
          )}
          tooltipText={connected.as((value) => (value ? "Disconnect" : "Connect"))}
          sensitive={connecting.as((value) => !value)}
          onClicked={() =>
            device.connected ? disconnectBluetoothDevice(device) : connectBluetoothDevice(device)
          }
        >
          <box orientation={Gtk.Orientation.HORIZONTAL}>
            <image
              iconName={connected.as((value) =>
                value ? "bluetooth-disabled-symbolic" : "bluetooth-active-symbolic",
              )}
              pixelSize={16}
              useFallback
            />
            <label label={connected.as((value) => (value ? "Disconnect" : "Connect"))} />
          </box>
        </button>
      </box>
      <With value={connected}>
        {(isConnected) =>
          isConnected && (
            <box class="bluetooth-profile-row" orientation={Gtk.Orientation.HORIZONTAL}>
              <label class="bluetooth-profile-title" xalign={0} label="Headset profile" />
              <ProfileDropdown device={device} />
            </box>
          )
        }
      </With>
    </box>
  )
}

export default function BluetoothControl() {
  const [open, setOpen] = createState(false)
  const enabled = createComputed(() => adapterAvailable() && bluetoothPowered())
  const devices = createComputed(() => (enabled() ? pairedDevices() : []))
  const tooltip = createComputed(() => {
    if (!adapterAvailable()) return "Bluetooth unavailable"

    return `${bluetoothPowered() ? "Bluetooth" : "Bluetooth disabled"}: ${connectedLabel(connectedCount())}`
  })
  const status = createComputed(() => {
    if (!adapterAvailable()) return "Adapter unavailable"

    return bluetoothPowered() ? "Known devices" : "Adapter powered off"
  })

  return (
    <menubutton
      class="bluetooth-control"
      direction={Gtk.ArrowType.RIGHT}
      tooltipText={tooltip}
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
    >
      <box class="bluetooth-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName={enabled.as((value) =>
            value ? "bluetooth-active-symbolic" : "bluetooth-disabled-symbolic",
          )}
          pixelSize={17}
          useFallback
        />
        <label
          class="bluetooth-control-count"
          label={connectedCount.as(String)}
          visible={connectedCount.as((count) => count > 0)}
        />
      </box>
      <PanelPopover open={open} setOpen={setOpen}>
        {() => (
          <Panel
            title="Bluetooth"
            class="bluetooth-menu"
            headerEnd={<label class="bluetooth-menu-subtitle" label={status} />}
          >
            <box class="bluetooth-toolbar" orientation={Gtk.Orientation.HORIZONTAL}>
              <label
                class="bluetooth-count"
                xalign={0}
                hexpand
                label={connectedCount.as(connectedLabel)}
              />
              <switch
                class="bluetooth-power"
                tooltipText="Bluetooth power"
                active={bluetoothPowered}
                sensitive={adapterAvailable}
                onNotifyActive={(toggle: Gtk.Switch) => setBluetoothPowered(toggle.active)}
              />
              <button
                class="bluetooth-manager"
                tooltipText="Open Bluetooth manager"
                onClicked={openBluetoothManager}
              >
                <image iconName="preferences-system-symbolic" pixelSize={16} useFallback />
              </button>
            </box>
            <PanelSection title="Devices">
              <box class="bluetooth-device-list" orientation={Gtk.Orientation.VERTICAL}>
                <With value={devices.as((items) => items.length === 0)}>
                  {(empty) => empty && <EmptyState />}
                </With>
                <For each={devices}>{(device) => <DeviceRow device={device} />}</For>
              </box>
            </PanelSection>
          </Panel>
        )}
      </PanelPopover>
    </menubutton>
  )
}
