import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import {
  type NetworkState,
  type VpnConnection,
  type WifiAccessPoint,
  getNetworkSummaryAsync,
  connectNetworkStateSignals,
  connectVpn,
  connectWifi,
  disconnectVpn,
  disconnectWifi,
  getNetworkStateAsync,
  openNetworkManager,
  rescanWifi,
  setWifiEnabled,
} from "../service/Network"
import Panel, { PanelSection } from "./Panel"
import { setupPanelPopover } from "./PanelRevealer"

type NetworkButtonControls = {
  icon: Gtk.Image
  label: Gtk.Label
}

type NetworkListControls = {
  list: Gtk.Box
  popover: Gtk.Popover
  statusLabel: Gtk.Label
  vpnList: Gtk.Box
  wifiSwitch: Gtk.Switch
}

function debug(message: string) {
  console.log(`[NetworkControl] ${message}`)
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

function wifiIconName(signal: number, active: boolean) {
  if (!active) return "network-wireless-signal-none-symbolic"
  if (signal >= 80) return "network-wireless-signal-excellent-symbolic"
  if (signal >= 55) return "network-wireless-signal-good-symbolic"
  if (signal >= 30) return "network-wireless-signal-ok-symbolic"

  return "network-wireless-signal-weak-symbolic"
}

function vpnLabel(count: number) {
  if (count === 0) return ""
  if (count === 1) return "VPN"

  return `${count} VPN`
}

function statusText(state: NetworkState) {
  if (!state.networkingEnabled) return "Networking disabled"
  if (!state.wifiDevice) return "Wi-Fi unavailable"
  if (!state.wifiEnabled) return "Wi-Fi disabled"
  if (state.activeWifi) return state.activeWifi.ssid

  return "Not connected"
}

function accessPointStatus(accessPoint: WifiAccessPoint) {
  if (accessPoint.active) return "Connected"

  const parts = [
    accessPoint.signal > 0 ? `${accessPoint.signal}% signal` : "",
    accessPoint.security ? "Secured" : "Open",
    accessPoint.knownConnection ? "Known" : "",
  ].filter(Boolean)

  return parts.join(" - ")
}

function createEmptyState(iconName: string, label: string) {
  const box = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)

  addClasses(box, "network-empty")
  box.append(createImage(iconName, 28))
  box.append(createLabel(label))

  return box
}

function setupListScroller(scroller: Gtk.ScrolledWindow, minHeight: number, maxHeight: number) {
  scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroller.set_min_content_height(minHeight)
  scroller.set_max_content_height(maxHeight)
  scroller.set_propagate_natural_height(false)
}

function setupNetworkButton(button: Gtk.MenuButton, controls: NetworkButtonControls) {
  let requestId = 0

  const refresh = () => {
    const id = ++requestId

    debug(`button refresh start id=${id}`)
    void getNetworkSummaryAsync()
      .then((state) => {
        if (id !== requestId) {
          debug(`button refresh stale id=${id} current=${requestId}`)
          return
        }

        controls.icon.set_from_icon_name(
          state.wifiEnabled && state.activeWifiName
            ? "network-wireless-symbolic"
            : "network-wireless-offline-symbolic",
        )
        controls.label.set_label(vpnLabel(state.activeVpnCount))
        button.set_tooltip_text(
          state.activeVpnCount > 0
            ? `${summaryStatusText(state)} - ${vpnLabel(state.activeVpnCount)}`
            : summaryStatusText(state),
        )
        debug(`button refresh done id=${id} wifi=${state.activeWifiName ?? "none"} vpn=${state.activeVpnCount}`)
      })
      .catch((error) => {
        if (id !== requestId) {
          debug(`button refresh error stale id=${id} current=${requestId}: ${String(error)}`)
          return
        }

        controls.icon.set_from_icon_name("network-wireless-offline-symbolic")
        controls.label.set_label("")
        button.set_tooltip_text("Network unavailable")
        debug(`button refresh failed id=${id}: ${String(error)}`)
      })
  }

  debug("button setup")
  button.connect("map", refresh)
  connectNetworkStateSignals(refresh)
  controls.icon.set_from_icon_name("network-wireless-symbolic")
  controls.label.set_label("")
  button.set_tooltip_text("Network")
  refresh()
}

function summaryStatusText(state: Awaited<ReturnType<typeof getNetworkSummaryAsync>>) {
  if (!state.networkingEnabled) return "Networking disabled"
  if (!state.wifiDevice) return "Wi-Fi unavailable"
  if (!state.wifiEnabled) return "Wi-Fi disabled"
  if (state.activeWifiName) return state.activeWifiName

  return "Not connected"
}

function setupNetworkList(controls: NetworkListControls) {
  let visible = controls.popover.visible
  let currentState: NetworkState | null = null
  let requestId = 0
  let rendering = false
  let syncingSwitch = false

  const showLoading = () => {
    debug("panel show loading")
    controls.statusLabel.set_label("Loading")
    controls.wifiSwitch.set_sensitive(false)
    clearBox(controls.list)
    clearBox(controls.vpnList)
    controls.list.append(createEmptyState("network-wireless-symbolic", "Loading networks"))
    controls.vpnList.append(createEmptyState("network-vpn-symbolic", "Loading VPN profiles"))
  }

  const render = (state: NetworkState) => {
    currentState = state
    rendering = true
    debug(
      `panel render wifi=${state.wifiAccessPoints.length} vpn=${state.vpnConnections.length} activeWifi=${state.activeWifi?.ssid ?? "none"} visible=${visible}`,
    )
    controls.statusLabel.set_label(statusText(state))
    syncingSwitch = true
    controls.wifiSwitch.set_active(state.wifiEnabled)
    syncingSwitch = false
    controls.wifiSwitch.set_sensitive(state.networkingEnabled && Boolean(state.wifiDevice))
    clearBox(controls.list)
    clearBox(controls.vpnList)

    if (!state.networkingEnabled || !state.wifiDevice || !state.wifiEnabled) {
      controls.list.append(
        createEmptyState(
          state.wifiDevice ? "network-wireless-offline-symbolic" : "dialog-warning-symbolic",
          statusText(state),
        ),
      )
    } else if (state.wifiAccessPoints.length === 0) {
      controls.list.append(createEmptyState("network-wireless-signal-none-symbolic", "No Wi-Fi networks"))
    } else {
      for (const accessPoint of state.wifiAccessPoints) {
        controls.list.append(createWifiRow(accessPoint, state.wifiDevice, refresh))
      }
    }

    if (state.vpnConnections.length === 0) {
      controls.vpnList.append(createEmptyState("network-vpn-symbolic", "No VPN profiles"))
    } else {
      for (const connection of state.vpnConnections) {
        controls.vpnList.append(createVpnRow(connection, refresh))
      }
    }

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      rendering = false
      return GLib.SOURCE_REMOVE
    })
  }

  const refresh = (loading = currentState === null) => {
    const id = ++requestId

    debug(`panel refresh start id=${id} loading=${loading} visible=${visible}`)
    if (loading) showLoading()
    void getNetworkStateAsync()
      .then((state) => {
        if (id !== requestId || !visible) {
          debug(`panel refresh ignored id=${id} current=${requestId} visible=${visible}`)
          return
        }

        render(state)
      })
      .catch((error) => {
        if (id !== requestId || !visible) {
          debug(`panel refresh error ignored id=${id} current=${requestId} visible=${visible}: ${String(error)}`)
          return
        }

        controls.statusLabel.set_label("Network unavailable")
        controls.wifiSwitch.set_sensitive(false)
        clearBox(controls.list)
        clearBox(controls.vpnList)
        controls.list.append(createEmptyState("dialog-warning-symbolic", "NetworkManager did not respond"))
        controls.vpnList.append(createEmptyState("network-vpn-symbolic", "VPN unavailable"))
        debug(`panel refresh failed id=${id}: ${String(error)}`)
      })
  }

  debug(`panel setup visible=${visible}`)
  connectNetworkStateSignals(() => {
    debug(`panel periodic visible=${visible}`)
    if (visible) refresh(false)
  })
  controls.popover.connect("notify::visible", () => {
    visible = controls.popover.visible
    debug(`popover notify visible=${visible}`)

    if (visible) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        debug(`popover idle visible=${visible}`)
        if (visible) refresh(false)

        return GLib.SOURCE_REMOVE
      })
    }
  })
  controls.popover.connect("closed", () => {
    visible = controls.popover.visible
    debug(`popover closed visible=${visible} rendering=${rendering}`)
  })
  controls.popover.connect("destroy", () => {
    debug("popover destroy")
  })

  controls.wifiSwitch.connect("notify::active", (toggle: Gtk.Switch) => {
    debug(`wifi switch notify active=${toggle.active} syncing=${syncingSwitch} hasState=${Boolean(currentState)}`)
    if (syncingSwitch || !currentState) return

    const state = currentState

    if (!state.networkingEnabled || !state.wifiDevice || toggle.active === state.wifiEnabled) return

    setWifiEnabled(toggle.active)
    refreshSoon(() => refresh(true))
  })

  showLoading()

  return refresh
}

function createWifiRow(accessPoint: WifiAccessPoint, wifiDevice: string | null, onRefresh: () => void) {
  const row = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)
  const labels = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)
  const button = Gtk.Button.new()
  const buttonContent = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)

  addClasses(row, accessPoint.active ? "network-row active" : "network-row")
  addClasses(labels, "network-row-labels")
  labels.set_hexpand(true)

  row.append(createImage(wifiIconName(accessPoint.signal, true), 18))
  labels.append(createLabel(accessPoint.ssid, "network-row-name", 0))
  labels.append(createLabel(accessPointStatus(accessPoint), "network-row-status", 0))
  row.append(labels)

  addClasses(button, accessPoint.active ? "network-connect active" : "network-connect")
  button.set_tooltip_text(accessPoint.active ? "Disconnect" : "Connect")
  button.connect("clicked", () => {
    if (accessPoint.active) {
      disconnectWifi(wifiDevice)
    } else {
      connectWifi(accessPoint)
    }

    refreshSoon(onRefresh)
  })

  buttonContent.append(
    createImage(accessPoint.active ? "network-wireless-offline-symbolic" : "network-wireless-symbolic", 16),
  )
  buttonContent.append(createLabel(accessPoint.active ? "Disconnect" : "Connect"))
  button.set_child(buttonContent)
  row.append(button)

  return row
}

function createVpnRow(connection: VpnConnection, onRefresh: () => void) {
  const row = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)
  const labels = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)
  const button = Gtk.Button.new()
  const buttonContent = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)

  addClasses(row, connection.active ? "network-row active" : "network-row")
  addClasses(labels, "network-row-labels")
  labels.set_hexpand(true)

  row.append(createImage("network-vpn-symbolic", 18))
  labels.append(createLabel(connection.name, "network-row-name", 0))
  labels.append(
    createLabel(
      connection.active ? `Connected${connection.device ? ` on ${connection.device}` : ""}` : "Disconnected",
      "network-row-status",
      0,
    ),
  )
  row.append(labels)

  addClasses(button, connection.active ? "network-connect active" : "network-connect")
  button.set_tooltip_text(connection.active ? "Disconnect VPN" : "Connect VPN")
  button.connect("clicked", () => {
    if (connection.active) {
      disconnectVpn(connection)
    } else {
      connectVpn(connection)
    }

    refreshSoon(onRefresh)
  })

  buttonContent.append(createImage(connection.active ? "network-offline-symbolic" : "network-vpn-symbolic", 16))
  buttonContent.append(createLabel(connection.active ? "Disconnect" : "Connect"))
  button.set_child(buttonContent)
  row.append(button)

  return row
}

export default function NetworkControl() {
  let buttonControls: Partial<NetworkButtonControls> = {}
  let listControls: Partial<NetworkListControls> = {}
  let menuButton: Gtk.MenuButton | null = null
  let refreshList: (() => void) | null = null
  let buttonSetupDone = false
  let listSetupDone = false

  const maybeSetupButton = () => {
    if (buttonSetupDone || !menuButton || !buttonControls.icon || !buttonControls.label) return

    buttonSetupDone = true
    debug("maybeSetupButton ready")
    setupNetworkButton(menuButton, {
      icon: buttonControls.icon,
      label: buttonControls.label,
    })
  }

  const maybeSetupList = () => {
    if (
      listSetupDone ||
      !listControls.list ||
      !listControls.popover ||
      !listControls.statusLabel ||
      !listControls.vpnList ||
      !listControls.wifiSwitch
    ) {
      return
    }

    listSetupDone = true
    debug("maybeSetupList ready")
    refreshList = setupNetworkList({
      list: listControls.list,
      popover: listControls.popover,
      statusLabel: listControls.statusLabel,
      vpnList: listControls.vpnList,
      wifiSwitch: listControls.wifiSwitch,
    })
  }

  return (
    <menubutton
      class="network-control"
      direction={Gtk.ArrowType.RIGHT}
      $={(button) => {
        menuButton = button
        debug("menubutton ready")
        maybeSetupButton()
      }}
    >
      <box class="network-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName="network-wireless-symbolic"
          pixelSize={17}
          useFallback
          $={(image) => {
            buttonControls = { ...buttonControls, icon: image }
            debug("button icon ready")
            maybeSetupButton()
          }}
        />
        <label
          class="network-control-vpn"
          $={(label) => {
            buttonControls = { ...buttonControls, label }
            debug("button label ready")
            maybeSetupButton()
          }}
        />
      </box>
      <popover
        $={(popover: Gtk.Popover) => {
          listControls = { ...listControls, popover }
          debug("popover ready")
          setupPanelPopover(popover)
          maybeSetupList()
        }}
      >
        <Panel
          title="Network"
          class="network-menu"
          headerEnd={
            <label
              class="network-menu-subtitle"
              $={(label) => {
                listControls = { ...listControls, statusLabel: label }
                debug("status label ready")
                maybeSetupList()
              }}
            />
          }
        >
          <box class="network-toolbar" orientation={Gtk.Orientation.HORIZONTAL}>
            <label class="network-toolbar-title" label="Wi-Fi" xalign={0} hexpand />
            <switch
              class="network-wifi-power"
              tooltipText="Wi-Fi power"
              $={(toggle) => {
                listControls = { ...listControls, wifiSwitch: toggle }
                debug("wifi switch ready")
                maybeSetupList()
              }}
            />
            <button
              class="network-rescan"
              tooltipText="Rescan Wi-Fi"
              onClicked={() => {
                debug("rescan clicked")
                rescanWifi()
                if (refreshList) refreshSoon(refreshList)
              }}
            >
              <image iconName="view-refresh-symbolic" pixelSize={16} useFallback />
            </button>
            <button
              class="network-manager"
              tooltipText="Open network settings"
              onClicked={() => {
                debug("network manager clicked")
                openNetworkManager()
              }}
            >
              <image iconName="preferences-system-network-symbolic" pixelSize={16} useFallback />
            </button>
          </box>
          <PanelSection title="Wi-Fi">
            <scrolledwindow
              class="network-scroll network-wifi-scroll"
              $={(scroller: Gtk.ScrolledWindow) => {
                setupListScroller(scroller, 168, 360)
              }}
            >
              <box
                class="network-list"
                orientation={Gtk.Orientation.VERTICAL}
                $={(box) => {
                  listControls = { ...listControls, list: box }
                  debug("wifi list ready")
                  maybeSetupList()
                }}
              />
            </scrolledwindow>
          </PanelSection>
          <PanelSection title="VPN">
            <scrolledwindow
              class="network-scroll network-vpn-scroll"
              $={(scroller: Gtk.ScrolledWindow) => {
                setupListScroller(scroller, 84, 168)
              }}
            >
              <box
                class="network-vpn-list"
                orientation={Gtk.Orientation.VERTICAL}
                $={(box) => {
                  listControls = { ...listControls, vpnList: box }
                  debug("vpn list ready")
                  maybeSetupList()
                }}
              />
            </scrolledwindow>
          </PanelSection>
        </Panel>
      </popover>
    </menubutton>
  )
}
