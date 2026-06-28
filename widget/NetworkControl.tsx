import { Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { createState, onCleanup } from "gnim"
import {
  type VpnConnection,
  type VpnNetworkState,
  type WifiAccessPoint,
  type WifiNetworkState,
  type WiredConnection,
  type WiredNetworkState,
  getNetworkSummaryAsync,
  connectNetworkStateSignals,
  connectVpn,
  connectWifi,
  disconnectVpn,
  disconnectWifi,
  getVpnNetworkStateAsync,
  getWifiNetworkStateAsync,
  getWiredNetworkStateAsync,
  openNetworkManager,
  rescanWifi,
  setWifiEnabled,
} from "../service/Network"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"

type NetworkButtonControls = {
  icon: Gtk.Image
  label: Gtk.Label
}

type NetworkListControls = {
  ethernetList: Gtk.Box
  list: Gtk.Box
  statusLabel: Gtk.Label
  vpnList: Gtk.Box
  wifiSwitch: Gtk.Switch
}

type NetworkSummary = Awaited<ReturnType<typeof getNetworkSummaryAsync>>

const NETWORK_ROW_HEIGHT = 58
const NETWORK_ROW_SPACING = 10

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

function wifiStatusText(state: WifiNetworkState) {
  if (!state.networkingEnabled) return "Networking disabled"
  if (state.activeWifi) return state.activeWifi.ssid
  if (!state.wifiDevice) return "Wi-Fi unavailable"
  if (!state.wifiEnabled) return "Wi-Fi disabled"

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

function networkIconName(state: NetworkSummary) {
  if (state.activeWifiName) return "network-wireless-symbolic"
  if (state.activeWiredName) return "network-wired-symbolic"

  return "network-wireless-offline-symbolic"
}

function listHeightForRows(rows: number) {
  const spacingCount = Math.max(0, Math.ceil(rows) - 1)

  return Math.ceil(NETWORK_ROW_HEIGHT * rows + NETWORK_ROW_SPACING * spacingCount)
}

function setupListScroller(scroller: Gtk.ScrolledWindow, maxRows: number) {
  scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroller.set_min_content_height(listHeightForRows(1))
  scroller.set_max_content_height(listHeightForRows(maxRows))
  scroller.set_propagate_natural_height(true)
}

function setupNetworkButton(button: Gtk.MenuButton, controls: NetworkButtonControls) {
  let requestId = 0

  const refresh = () => {
    const id = ++requestId

    void getNetworkSummaryAsync()
      .then((state) => {
        if (id !== requestId) return

        controls.icon.set_from_icon_name(
          state.networkingEnabled ? networkIconName(state) : "network-wireless-offline-symbolic",
        )
        controls.label.set_label(vpnLabel(state.activeVpnCount))
        button.set_tooltip_text(
          state.activeVpnCount > 0
            ? `${summaryStatusText(state)} - ${vpnLabel(state.activeVpnCount)}`
            : summaryStatusText(state),
        )
      })
      .catch((error) => {
        void error
        if (id !== requestId) return

        controls.icon.set_from_icon_name("network-wireless-offline-symbolic")
        controls.label.set_label("")
        button.set_tooltip_text("Network unavailable")
      })
  }

  button.connect("map", refresh)
  const disconnectStateSignals = connectNetworkStateSignals(refresh)
  controls.icon.set_from_icon_name("network-wireless-symbolic")
  controls.label.set_label("")
  button.set_tooltip_text("Network")
  refresh()

  onCleanup(disconnectStateSignals)
}

function summaryStatusText(state: NetworkSummary) {
  if (!state.networkingEnabled) return "Networking disabled"
  if (state.activeWifiName) return state.activeWifiName
  if (state.activeWiredName) return `Ethernet: ${state.activeWiredName}`
  if (!state.wifiDevice) return "Wi-Fi unavailable"
  if (!state.wifiEnabled) return "Wi-Fi disabled"

  return "Not connected"
}

function setupNetworkList(controls: NetworkListControls) {
  let currentWifiState: WifiNetworkState | null = null
  let summaryRequestId = 0
  let wiredRequestId = 0
  let wifiRequestId = 0
  let vpnRequestId = 0
  let syncingSwitch = false

  const showSummaryLoading = () => {
    controls.statusLabel.set_label("Loading")
  }

  const showWiredLoading = () => {
    clearBox(controls.ethernetList)
    controls.ethernetList.append(createEmptyState("network-wired-symbolic", "Loading Ethernet"))
  }

  const showWifiLoading = () => {
    controls.wifiSwitch.set_sensitive(false)
    clearBox(controls.list)
    controls.list.append(createEmptyState("network-wireless-symbolic", "Loading networks"))
  }

  const showVpnLoading = () => {
    clearBox(controls.vpnList)
    controls.vpnList.append(createEmptyState("network-vpn-symbolic", "Loading VPN profiles"))
  }

  const renderWired = (state: WiredNetworkState) => {
    clearBox(controls.ethernetList)

    if (!state.networkingEnabled) {
      controls.ethernetList.append(createEmptyState("network-wired-disconnected-symbolic", "Networking disabled"))
    } else if (state.activeWired) {
      controls.ethernetList.append(createWiredRow(state.activeWired))
    } else {
      controls.ethernetList.append(createEmptyState("network-wired-disconnected-symbolic", "No Ethernet connection"))
    }
  }

  const renderWifi = (state: WifiNetworkState) => {
    currentWifiState = state
    syncingSwitch = true
    controls.wifiSwitch.set_active(state.wifiEnabled)
    syncingSwitch = false
    controls.wifiSwitch.set_sensitive(state.networkingEnabled && Boolean(state.wifiDevice))
    clearBox(controls.list)

    if (!state.networkingEnabled || !state.wifiDevice || !state.wifiEnabled) {
      controls.list.append(
        createEmptyState(
          state.wifiDevice ? "network-wireless-offline-symbolic" : "dialog-warning-symbolic",
          wifiStatusText(state),
        ),
      )
    } else if (state.wifiAccessPoints.length === 0) {
      controls.list.append(createEmptyState("network-wireless-signal-none-symbolic", "No Wi-Fi networks"))
    } else {
      for (const accessPoint of state.wifiAccessPoints) {
        controls.list.append(createWifiRow(accessPoint, state.wifiDevice, refresh))
      }
    }
  }

  const renderVpn = (state: VpnNetworkState) => {
    clearBox(controls.vpnList)
    if (state.vpnConnections.length === 0) {
      controls.vpnList.append(createEmptyState("network-vpn-symbolic", "No VPN profiles"))
    } else {
      for (const connection of state.vpnConnections) {
        controls.vpnList.append(createVpnRow(connection, refresh))
      }
    }
  }

  const refreshSummary = (loading: boolean) => {
    const id = ++summaryRequestId

    if (loading) showSummaryLoading()
    void getNetworkSummaryAsync()
      .then((state) => {
        if (id !== summaryRequestId) return

        controls.statusLabel.set_label(summaryStatusText(state))
      })
      .catch((error) => {
        void error
        if (id !== summaryRequestId) return

        controls.statusLabel.set_label("Network unavailable")
      })
  }

  const refreshWired = (loading: boolean) => {
    const id = ++wiredRequestId

    if (loading) showWiredLoading()
    void getWiredNetworkStateAsync()
      .then((state) => {
        if (id !== wiredRequestId) return

        renderWired(state)
      })
      .catch((error) => {
        void error
        if (id !== wiredRequestId) return

        clearBox(controls.ethernetList)
        controls.ethernetList.append(createEmptyState("dialog-warning-symbolic", "Ethernet unavailable"))
      })
  }

  const refreshWifi = (loading: boolean) => {
    const id = ++wifiRequestId

    if (loading) showWifiLoading()
    void getWifiNetworkStateAsync()
      .then((state) => {
        if (id !== wifiRequestId) return

        renderWifi(state)
      })
      .catch((error) => {
        void error
        if (id !== wifiRequestId) return

        controls.wifiSwitch.set_sensitive(false)
        clearBox(controls.list)
        controls.list.append(createEmptyState("dialog-warning-symbolic", "NetworkManager did not respond"))
      })
  }

  const refreshVpn = (loading: boolean) => {
    const id = ++vpnRequestId

    if (loading) showVpnLoading()
    void getVpnNetworkStateAsync()
      .then((state) => {
        if (id !== vpnRequestId) return

        renderVpn(state)
      })
      .catch((error) => {
        void error
        if (id !== vpnRequestId) return

        clearBox(controls.vpnList)
        controls.vpnList.append(createEmptyState("network-vpn-symbolic", "VPN unavailable"))
      })
  }

  const refresh = (loading = currentWifiState === null) => {
    refreshSummary(loading)
    refreshWired(loading)
    refreshWifi(loading)
    refreshVpn(loading)
  }

  const disconnectStateSignals = connectNetworkStateSignals(() => {
    refresh(false)
  })

  const switchSignal = controls.wifiSwitch.connect("notify::active", (toggle: Gtk.Switch) => {
    if (syncingSwitch || !currentWifiState) return

    const state = currentWifiState

    if (!state.networkingEnabled || !state.wifiDevice || toggle.active === state.wifiEnabled) return

    setWifiEnabled(toggle.active)
    refreshSoon(() => {
      refreshSummary(true)
      refreshWifi(true)
    })
  })

  showSummaryLoading()
  showWiredLoading()
  showWifiLoading()
  showVpnLoading()
  refresh(false)

  onCleanup(() => {
    disconnectStateSignals()
    controls.wifiSwitch.disconnect(switchSignal)
  })

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

function createWiredRow(connection: WiredConnection) {
  const row = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 0)
  const labels = Gtk.Box.new(Gtk.Orientation.VERTICAL, 0)

  addClasses(row, "network-row active")
  addClasses(labels, "network-row-labels")
  labels.set_hexpand(true)

  row.append(createImage("network-wired-symbolic", 18))
  labels.append(createLabel(connection.name, "network-row-name", 0))
  labels.append(
    createLabel(
      connection.device ? `Ethernet connected on ${connection.device}` : "Ethernet connected",
      "network-row-status",
      0,
    ),
  )
  row.append(labels)

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
  const [open, setOpen] = createState(false)
  let buttonControls: Partial<NetworkButtonControls> = {}
  let listControls: Partial<NetworkListControls> = {}
  let menuButton: Gtk.MenuButton | null = null
  let refreshList: (() => void) | null = null
  let buttonSetupDone = false
  let listSetupDone = false

  const maybeSetupButton = () => {
    if (buttonSetupDone || !menuButton || !buttonControls.icon || !buttonControls.label) return

    buttonSetupDone = true
    setupNetworkButton(menuButton, {
      icon: buttonControls.icon,
      label: buttonControls.label,
    })
  }

  const maybeSetupList = () => {
    if (
      listSetupDone ||
      !listControls.list ||
      !listControls.statusLabel ||
      !listControls.ethernetList ||
      !listControls.vpnList ||
      !listControls.wifiSwitch
    ) {
      return
    }

    listSetupDone = true
    refreshList = setupNetworkList({
      ethernetList: listControls.ethernetList,
      list: listControls.list,
      statusLabel: listControls.statusLabel,
      vpnList: listControls.vpnList,
      wifiSwitch: listControls.wifiSwitch,
    })
  }

  const setPanelOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const openNext = typeof next === "function" ? next(open()) : next

    if (!openNext) {
      listControls = {}
      listSetupDone = false
      refreshList = null
    }

    setOpen(openNext)
  }

  return (
    <menubutton
      class="network-control"
      direction={Gtk.ArrowType.RIGHT}
      onNotifyActive={(button: Gtk.MenuButton) => setPanelOpen(button.active)}
      $={(button) => {
        menuButton = button
        maybeSetupButton()
      }}
    >
      <box class="network-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName="network-wired-symbolic"
          pixelSize={17}
          useFallback
          $={(image) => {
            buttonControls = { ...buttonControls, icon: image }
            maybeSetupButton()
          }}
        />
        <label
          class="network-control-vpn"
          $={(label) => {
            buttonControls = { ...buttonControls, label }
            maybeSetupButton()
          }}
        />
      </box>
      <PanelPopover open={open} setOpen={setPanelOpen}>
        {() => (
        <Panel
          title="Network"
          class="network-menu"
          headerEnd={
            <label
              class="network-menu-subtitle"
              $={(label) => {
                listControls = { ...listControls, statusLabel: label }
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
                maybeSetupList()
              }}
            />
            <button
              class="network-rescan"
              tooltipText="Rescan Wi-Fi"
              onClicked={() => {
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
                openNetworkManager()
              }}
            >
              <image iconName="preferences-system-network-symbolic" pixelSize={16} useFallback />
            </button>
          </box>
          <PanelSection title="Ethernet">
            <box
              class="network-ethernet-list"
              orientation={Gtk.Orientation.VERTICAL}
              $={(box) => {
                listControls = { ...listControls, ethernetList: box }
                maybeSetupList()
              }}
            />
          </PanelSection>
          <PanelSection title="Wi-Fi">
            <scrolledwindow
              class="network-scroll network-wifi-scroll"
              $={(scroller: Gtk.ScrolledWindow) => {
                setupListScroller(scroller, 3.5)
              }}
            >
              <box
                class="network-list"
                orientation={Gtk.Orientation.VERTICAL}
                $={(box) => {
                  listControls = { ...listControls, list: box }
                  maybeSetupList()
                }}
              />
            </scrolledwindow>
          </PanelSection>
          <PanelSection title="VPN">
            <scrolledwindow
              class="network-scroll network-vpn-scroll"
              $={(scroller: Gtk.ScrolledWindow) => {
                setupListScroller(scroller, 2.5)
              }}
            >
              <box
                class="network-vpn-list"
                orientation={Gtk.Orientation.VERTICAL}
                $={(box) => {
                  listControls = { ...listControls, vpnList: box }
                  maybeSetupList()
                }}
              />
            </scrolledwindow>
          </PanelSection>
        </Panel>
        )}
      </PanelPopover>
    </menubutton>
  )
}
