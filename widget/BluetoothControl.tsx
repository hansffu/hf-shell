import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import {
  type BluetoothAudioCard,
  type BluetoothDevice,
  type BluetoothProfile,
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
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
    refresh()
    return GLib.SOURCE_CONTINUE
  })
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
      controls.list.append(
        <box class="bluetooth-empty" orientation={Gtk.Orientation.VERTICAL}>
          <image
            iconName={
              state.adapterAvailable ? "bluetooth-disabled-symbolic" : "dialog-warning-symbolic"
            }
            pixelSize={28}
            useFallback
          />
          <label
            label={
              state.adapterAvailable
                ? state.powered
                  ? "No paired devices"
                  : "Bluetooth is powered off"
                : "Bluetooth is not available"
            }
          />
        </box>,
      )
      return
    }

    for (const device of state.devices) {
      controls.list.append(
        <BluetoothDeviceRow
          device={device}
          onRefresh={() => {
            refresh()
          }}
        />,
      )
    }
  }

  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
    refresh()
    return GLib.SOURCE_CONTINUE
  })

  controls.powerSwitch.connect("notify::active", (toggle) => {
    const state = getBluetoothState()

    if (!state.adapterAvailable || toggle.active === state.powered) return

    setBluetoothPowered(toggle.active)
    refreshSoon(refresh)
  })

  refresh()
}

function setupProfileDropdown(
  dropdown: Gtk.DropDown,
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

  dropdown.connect("notify::selected", (select) => {
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
  const dropdown = Gtk.DropDown.new(null, null)

  dropdown.add_css_class("bluetooth-profile-select")
  dropdown.hexpand = true
  setupProfileDropdown(dropdown, card, onRefresh)

  return dropdown
}

function BluetoothDeviceRow({
  device,
  onRefresh,
}: {
  device: BluetoothDevice
  onRefresh: () => void
}) {
  const card = device.connected ? getBluetoothAudioCard(device.mac) : null

  return (
    <box class="bluetooth-device-row" orientation={Gtk.Orientation.VERTICAL}>
      <box class="bluetooth-device-header" orientation={Gtk.Orientation.HORIZONTAL}>
        <image
          iconName={device.connected ? "bluetooth-active-symbolic" : "bluetooth-symbolic"}
          pixelSize={18}
          useFallback
        />
        <box class="bluetooth-device-labels" orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="bluetooth-device-name" xalign={0} ellipsize={3} label={device.name} />
          <label
            class="bluetooth-device-status"
            xalign={0}
            label={device.connected ? "Connected" : "Disconnected"}
          />
        </box>
        <button
          class={device.connected ? "bluetooth-connect active" : "bluetooth-connect"}
          tooltipText={device.connected ? "Disconnect" : "Connect"}
          onClicked={() => {
            if (device.connected) {
              disconnectBluetoothDevice(device)
            } else {
              connectBluetoothDevice(device)
            }

            refreshSoon(onRefresh)
          }}
        >
          <box orientation={Gtk.Orientation.HORIZONTAL}>
            <image
              iconName={device.connected ? "bluetooth-disabled-symbolic" : "bluetooth-active-symbolic"}
              pixelSize={16}
              useFallback
            />
            <label label={device.connected ? "Disconnect" : "Connect"} />
          </box>
        </button>
      </box>
      {device.connected && (
        <box class="bluetooth-profile-row" orientation={Gtk.Orientation.HORIZONTAL}>
          <label class="bluetooth-profile-title" xalign={0} label="Headset profile" />
          <BluetoothProfileDropdown card={card} onRefresh={onRefresh} />
        </box>
      )}
    </box>
  )
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
