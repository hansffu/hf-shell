import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import {
  type BluetoothAudioCard,
  type BluetoothDevice,
  type BluetoothProfile,
  bluetoothDeviceName,
  connectBluetoothStateSignals,
  connectBluetoothDevice,
  disconnectBluetoothDevice,
  getBluetoothAudioCard,
  getBluetoothState,
  openBluetoothManager,
  setBluetoothPowered,
  setBluetoothAudioProfile,
} from "../service/Bluetooth"
import Panel, { PanelSection } from "./Panel"
import { setupPanelPopover } from "./PanelRevealer"
import Select, { type SelectControl } from "./Select"

type BluetoothButtonControls = {
  icon: Gtk.Image
  label: Gtk.Label
}

type BluetoothListControls = {
  countLabel: Gtk.Label
  list: Gtk.Box
  powerSwitch: Gtk.Switch
  statusLabel: Gtk.Label
}

function connectedLabel(count: number) {
  if (count === 0) return "No devices connected"
  if (count === 1) return "1 device connected"

  return `${count} devices connected`
}

function profileLabel(profile: BluetoothProfile) {
  const name = profile.name.toLowerCase()
  const prefix = name.includes("a2dp")
    ? "Music"
    : name.includes("handsfree") || name.includes("headset") || name.includes("hfp")
      ? "Handsfree"
      : "Profile"
  const availability = profile.available ? "" : " (unavailable)"

  return `${prefix}: ${profile.description}${availability}`
}

function clearBox(box: Gtk.Box) {
  let child = box.get_first_child()

  while (child) {
    box.remove(child)
    child = box.get_first_child()
  }
}

function refreshSoon(refresh: () => void) {
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
    refresh()
    return GLib.SOURCE_REMOVE
  })
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3200, () => {
    refresh()
    return GLib.SOURCE_REMOVE
  })
}

function addClasses(widget: Gtk.Widget, classes: string) {
  for (const className of classes.split(" ").filter(Boolean)) widget.add_css_class(className)
}

function createImage(iconName: string, pixelSize: number) {
  const image = Gtk.Image.new_from_icon_name(iconName)

  image.set_pixel_size(pixelSize)
  image.use_fallback = true

  return image
}

function createLabel(label: string, className = "", xalign: number | null = null) {
  const widget = Gtk.Label.new(label)

  if (className) addClasses(widget, className)
  if (xalign !== null) widget.set_xalign(xalign)

  return widget
}

function createEmptyState(state: ReturnType<typeof getBluetoothState>) {
  const box = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)
  const iconName = state.adapterAvailable ? "bluetooth-disabled-symbolic" : "dialog-warning-symbolic"
  const label = state.adapterAvailable
    ? state.powered
      ? "No paired devices"
      : "Bluetooth is powered off"
    : "Bluetooth is not available"

  addClasses(box, "bluetooth-empty")
  box.append(createImage(iconName, 28))
  box.append(createLabel(label))

  return box
}

function setupBluetoothButton(button: Gtk.MenuButton, controls: BluetoothButtonControls) {
  const refresh = () => {
    const state = getBluetoothState()
    const connected = state.devices.filter((device) => device.connected).length

    controls.icon.set_from_icon_name(
      state.adapterAvailable && state.powered
        ? "bluetooth-active-symbolic"
        : "bluetooth-disabled-symbolic",
    )
    controls.label.set_label(connected > 0 ? String(connected) : "")
    button.set_tooltip_text(
      state.adapterAvailable
        ? `${state.powered ? "Bluetooth" : "Bluetooth disabled"}: ${connectedLabel(connected)}`
        : "Bluetooth unavailable",
    )
  }

  button.connect("map", refresh)
  connectBluetoothStateSignals(refresh)
  refresh()
}

function setupBluetoothList(controls: BluetoothListControls) {
  const refresh = () => {
    const state = getBluetoothState()
    const connected = state.devices.filter((device) => device.connected).length

    controls.countLabel.set_label(connectedLabel(connected))
    controls.statusLabel.set_label(
      state.adapterAvailable
        ? state.powered
          ? "Known devices"
          : "Adapter powered off"
        : "Adapter unavailable",
    )
    controls.powerSwitch.set_active(state.powered)
    controls.powerSwitch.set_sensitive(state.adapterAvailable)

    clearBox(controls.list)

    if (!state.adapterAvailable || !state.powered || state.devices.length === 0) {
      controls.list.append(createEmptyState(state))
      return
    }

    for (const device of state.devices) {
      controls.list.append(createBluetoothDeviceRow(device, refresh))
    }
  }

  connectBluetoothStateSignals(refresh)

  controls.powerSwitch.connect("notify::active", (toggle: Gtk.Switch) => {
    const state = getBluetoothState()

    if (!state.adapterAvailable || toggle.active === state.powered) return

    setBluetoothPowered(toggle.active)
    refreshSoon(refresh)
  })

  refresh()
}

function setupProfileDropdown(
  dropdown: SelectControl,
  card: BluetoothAudioCard | null,
  onRefresh: () => void,
) {
  const profiles = card?.profiles ?? []
  let syncing = true
  const selectedIndex = profiles.findIndex((profile) => profile.active)

  dropdown.set_model(
    Gtk.StringList.new(
      profiles.length > 0
        ? profiles.map(profileLabel)
        : [card ? "No headset profiles" : "No audio profile"],
    ),
  )
  dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : 0)
  dropdown.set_sensitive(Boolean(card && profiles.length > 0))
  syncing = false

  dropdown.connect("notify::selected", (select: Gtk.DropDown) => {
    if (syncing || !card) return

    const profile = profiles[select.selected]

    if (!profile) return

    setBluetoothAudioProfile(card, profile)
    refreshSoon(onRefresh)
  })
}

function BluetoothProfileDropdown({
  card,
  onRefresh,
}: {
  card: BluetoothAudioCard | null
  onRefresh: () => void
}) {
  return (
    <Select
      class="bluetooth-profile-select"
      hexpand
      onReady={(dropdown) => {
        setupProfileDropdown(dropdown, card, onRefresh)
      }}
    />
  )
}

function createBluetoothDeviceRow(device: BluetoothDevice, onRefresh: () => void) {
  const card = device.connected ? getBluetoothAudioCard(device.address) : null
  const status = device.connecting
    ? "Connecting"
    : device.connected
      ? device.battery_percentage >= 0
        ? `Connected, ${device.battery_percentage}% battery`
        : "Connected"
      : "Disconnected"
  const row = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)
  const header = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)
  const labels = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)
  const button = Gtk.Button.new()
  const buttonContent = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)

  addClasses(row, "bluetooth-device-row")
  addClasses(header, "bluetooth-device-header")
  addClasses(labels, "bluetooth-device-labels")
  labels.set_hexpand(true)

  header.append(createImage(device.connected ? "bluetooth-active-symbolic" : "bluetooth-symbolic", 18))
  labels.append(createLabel(bluetoothDeviceName(device), "bluetooth-device-name", 0))
  labels.append(createLabel(status, "bluetooth-device-status", 0))
  header.append(labels)

  addClasses(button, device.connected ? "bluetooth-connect active" : "bluetooth-connect")
  button.set_tooltip_text(device.connected ? "Disconnect" : "Connect")
  button.set_sensitive(!device.connecting)
  button.connect("clicked", () => {
    if (device.connected) {
      disconnectBluetoothDevice(device)
    } else {
      connectBluetoothDevice(device)
    }

    refreshSoon(onRefresh)
  })

  buttonContent.append(
    createImage(device.connected ? "bluetooth-disabled-symbolic" : "bluetooth-active-symbolic", 16),
  )
  buttonContent.append(createLabel(device.connected ? "Disconnect" : "Connect"))
  button.set_child(buttonContent)
  header.append(button)
  row.append(header)

  if (device.connected) {
    const profileRow = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)

    addClasses(profileRow, "bluetooth-profile-row")
    profileRow.append(createLabel("Headset profile", "bluetooth-profile-title", 0))
    profileRow.append(BluetoothProfileDropdown({ card, onRefresh }))
    row.append(profileRow)
  }

  return row
}

export default function BluetoothControl() {
  let buttonControls: Partial<BluetoothButtonControls> = {}
  let listControls: Partial<BluetoothListControls> = {}
  let menuButton: Gtk.MenuButton | null = null
  let buttonSetupDone = false
  let listSetupDone = false

  const maybeSetupButton = () => {
    if (buttonSetupDone || !menuButton || !buttonControls.icon || !buttonControls.label) return

    buttonSetupDone = true
    setupBluetoothButton(menuButton, {
      icon: buttonControls.icon,
      label: buttonControls.label,
    })
  }

  const maybeSetupList = () => {
    if (
      listSetupDone ||
      !listControls.countLabel ||
      !listControls.list ||
      !listControls.powerSwitch ||
      !listControls.statusLabel
    ) {
      return
    }

    listSetupDone = true
    setupBluetoothList({
      countLabel: listControls.countLabel,
      list: listControls.list,
      powerSwitch: listControls.powerSwitch,
      statusLabel: listControls.statusLabel,
    })
  }

  return (
    <menubutton
      class="bluetooth-control"
      direction={Gtk.ArrowType.RIGHT}
      $={(button) => {
        menuButton = button
        maybeSetupButton()
      }}
    >
      <box class="bluetooth-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName="bluetooth-symbolic"
          pixelSize={17}
          useFallback
          $={(image) => {
            buttonControls = { ...buttonControls, icon: image }
            maybeSetupButton()
          }}
        />
        <label
          class="bluetooth-control-count"
          $={(label) => {
            buttonControls = { ...buttonControls, label }
            maybeSetupButton()
          }}
        />
      </box>
      <popover
        $={(popover: Gtk.Popover) => {
          setupPanelPopover(popover)
        }}
      >
        <Panel
          title="Bluetooth"
          class="bluetooth-menu"
          headerEnd={
            <label
              class="bluetooth-menu-subtitle"
              $={(label) => {
                listControls = { ...listControls, statusLabel: label }
                maybeSetupList()
              }}
            />
          }
        >
          <box class="bluetooth-toolbar" orientation={Gtk.Orientation.HORIZONTAL}>
            <label
              class="bluetooth-count"
              xalign={0}
              hexpand
              $={(label) => {
                listControls = { ...listControls, countLabel: label }
                maybeSetupList()
              }}
            />
            <switch
              class="bluetooth-power"
              tooltipText="Bluetooth power"
              $={(toggle) => {
                listControls = { ...listControls, powerSwitch: toggle }
                maybeSetupList()
              }}
            />
            <button
              class="bluetooth-manager"
              tooltipText="Open Bluetooth manager"
              onClicked={() => {
                openBluetoothManager()
              }}
            >
              <image iconName="preferences-system-symbolic" pixelSize={16} useFallback />
            </button>
          </box>
          <PanelSection title="Devices">
            <box
              class="bluetooth-device-list"
              orientation={Gtk.Orientation.VERTICAL}
              $={(box) => {
                listControls = { ...listControls, list: box }
                maybeSetupList()
              }}
            />
          </PanelSection>
        </Panel>
      </popover>
    </menubutton>
  )
}
