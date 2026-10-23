import { Gtk } from "ags/gtk4"
import { createBinding, createComputed, createState, For, With } from "gnim"
import type { Accessor } from "gnim"
import {
  type VpnConnection,
  type WifiAccessPoint,
  activeAccessPoint,
  activeVpnCount,
  activeWired,
  connectVpn,
  connectWifi,
  disconnectVpn,
  disconnectWifi,
  isKnownAccessPoint,
  networkIcon,
  networkingEnabled,
  networkStatus,
  openNetworkManager,
  rescanWifi,
  setWifiEnabled,
  vpnConnections,
  wifi,
  wifiAccessPoints,
  wifiEnabled,
} from "../service/Network"
import { closePanels } from "../service/Panels"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"

const NETWORK_ROW_HEIGHT = 58
const NETWORK_ROW_SPACING = 10

type EmptyStateProps = {
  icon: string
  label: string
}

type Active = boolean | Accessor<boolean>

function whenActive<T>(active: Active, ifActive: T, otherwise: T) {
  const pick = (value: boolean) => (value ? ifActive : otherwise)

  return typeof active === "boolean" ? pick(active) : active.as(pick)
}

function vpnLabel(count: number) {
  if (count === 0) return ""
  if (count === 1) return "VPN"

  return `${count} VPN`
}

function listHeightForRows(rows: number) {
  const spacingCount = Math.max(0, Math.ceil(rows) - 1)

  return Math.ceil(NETWORK_ROW_HEIGHT * rows + NETWORK_ROW_SPACING * spacingCount)
}

function EmptyState({ icon, label }: EmptyStateProps) {
  return (
    <box class="network-empty" orientation={Gtk.Orientation.VERTICAL}>
      <image iconName={icon} pixelSize={28} useFallback />
      <label label={label} />
    </box>
  )
}

function ListScroller({
  children,
  class: className,
  maxRows,
}: {
  children: Gtk.Widget
  class: string
  maxRows: number
}) {
  return (
    <scrolledwindow
      class={`network-scroll ${className}`}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      minContentHeight={listHeightForRows(1)}
      maxContentHeight={listHeightForRows(maxRows)}
      propagateNaturalHeight
    >
      {children}
    </scrolledwindow>
  )
}

function ConnectButton({
  active,
  activeIcon,
  inactiveIcon,
  onClicked,
  tooltip,
}: {
  active: Active
  activeIcon: string
  inactiveIcon: string
  onClicked: () => void
  tooltip: [string, string]
}) {
  return (
    <button
      class={whenActive(active, "network-connect active", "network-connect")}
      tooltipText={whenActive(active, ...tooltip)}
      onClicked={onClicked}
    >
      <box orientation={Gtk.Orientation.HORIZONTAL}>
        <image iconName={whenActive(active, activeIcon, inactiveIcon)} pixelSize={16} useFallback />
        <label label={whenActive(active, "Disconnect", "Connect")} />
      </box>
    </button>
  )
}

function NetworkRow({
  active,
  children,
  icon,
  name,
  status,
}: {
  active: Active
  children?: Gtk.Widget
  icon: string | Accessor<string>
  name: string
  status: string | Accessor<string>
}) {
  return (
    <box
      class={whenActive(active, "network-row active", "network-row")}
      orientation={Gtk.Orientation.HORIZONTAL}
    >
      <image iconName={icon} pixelSize={18} useFallback />
      <box class="network-row-labels" orientation={Gtk.Orientation.VERTICAL} hexpand>
        <label class="network-row-name" xalign={0} label={name} />
        <label class="network-row-status" xalign={0} label={status} />
      </box>
      {children}
    </box>
  )
}

function WifiRow({ accessPoint }: { accessPoint: WifiAccessPoint }) {
  const active = createComputed(() => activeAccessPoint()?.ssid === accessPoint.ssid)
  const strength = createBinding(accessPoint, "strength")
  const status = createComputed(() => {
    if (active()) return "Connected"

    return [
      strength() > 0 ? `${strength()}% signal` : "",
      accessPoint.requires_password ? "Secured" : "Open",
      isKnownAccessPoint(accessPoint) ? "Known" : "",
    ]
      .filter(Boolean)
      .join(" - ")
  })

  return (
    <NetworkRow
      active={active}
      icon={createBinding(accessPoint, "iconName")}
      name={accessPoint.ssid ?? ""}
      status={status}
    >
      <ConnectButton
        active={active}
        activeIcon="network-wireless-offline-symbolic"
        inactiveIcon="network-wireless-symbolic"
        tooltip={["Disconnect", "Connect"]}
        onClicked={() => {
          if (active()) return disconnectWifi()

          // Release the panel's keyboard grab so the secret agent's password dialog gets focus.
          if (!isKnownAccessPoint(accessPoint)) closePanels()
          connectWifi(accessPoint)
        }}
      />
    </NetworkRow>
  )
}

function VpnRow({ vpn }: { vpn: VpnConnection }) {
  const active = Boolean(vpn.active)

  return (
    <NetworkRow
      active={active}
      icon="network-vpn-symbolic"
      name={vpn.name}
      status={active ? `Connected${vpn.device ? ` on ${vpn.device}` : ""}` : "Disconnected"}
    >
      <ConnectButton
        active={active}
        activeIcon="network-offline-symbolic"
        inactiveIcon="network-vpn-symbolic"
        tooltip={["Disconnect VPN", "Connect VPN"]}
        onClicked={() => (active ? disconnectVpn(vpn) : connectVpn(vpn))}
      />
    </NetworkRow>
  )
}

function EthernetSection() {
  const wired = createComputed(() => (networkingEnabled() ? activeWired() : null))

  return (
    <box class="network-ethernet-list" orientation={Gtk.Orientation.VERTICAL}>
      <With value={wired}>
        {(connection) => {
          if (!connection) {
            return (
              <EmptyState
                icon="network-wired-disconnected-symbolic"
                label={networkingEnabled() ? "No Ethernet connection" : "Networking disabled"}
              />
            )
          }

          const device = connection.get_devices()?.[0]?.get_iface()

          return (
            <NetworkRow
              active
              icon="network-wired-symbolic"
              name={connection.id}
              status={device ? `Ethernet connected on ${device}` : "Ethernet connected"}
            />
          )
        }}
      </With>
    </box>
  )
}

function WifiSection() {
  const available = createComputed(() => networkingEnabled() && Boolean(wifi) && wifiEnabled())
  const accessPoints = createComputed(() => (available() ? wifiAccessPoints() : []))
  const emptyState = createComputed((): EmptyStateProps | null => {
    if (!available()) {
      return {
        icon: wifi ? "network-wireless-offline-symbolic" : "dialog-warning-symbolic",
        label: networkStatus(),
      }
    }

    if (accessPoints().length === 0) {
      return { icon: "network-wireless-signal-none-symbolic", label: "No Wi-Fi networks" }
    }

    return null
  })

  return (
    <ListScroller class="network-wifi-scroll" maxRows={3.5}>
      <box class="network-list" orientation={Gtk.Orientation.VERTICAL}>
        <With value={emptyState}>{(state) => state && <EmptyState {...state} />}</With>
        <For each={accessPoints}>{(accessPoint) => <WifiRow accessPoint={accessPoint} />}</For>
      </box>
    </ListScroller>
  )
}

function VpnSection() {
  return (
    <ListScroller class="network-vpn-scroll" maxRows={2.5}>
      <box class="network-vpn-list" orientation={Gtk.Orientation.VERTICAL}>
        <With value={vpnConnections.as((connections) => connections.length === 0)}>
          {(empty) => empty && <EmptyState icon="network-vpn-symbolic" label="No VPN profiles" />}
        </With>
        <For each={vpnConnections}>{(vpn) => <VpnRow vpn={vpn} />}</For>
      </box>
    </ListScroller>
  )
}

export default function NetworkControl() {
  const [open, setOpen] = createState(false)
  const vpnText = activeVpnCount.as(vpnLabel)
  const tooltip = createComputed(() =>
    vpnText() ? `${networkStatus()} - ${vpnText()}` : networkStatus(),
  )

  return (
    <menubutton
      class="network-control"
      direction={Gtk.ArrowType.RIGHT}
      tooltipText={tooltip}
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
    >
      <box class="network-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image iconName={networkIcon} pixelSize={17} useFallback />
        <label
          class="network-control-vpn"
          label={vpnText}
          visible={vpnText.as((text) => text.length > 0)}
        />
      </box>
      <PanelPopover open={open} setOpen={setOpen}>
        {() => (
          <Panel
            title="Network"
            class="network-menu"
            headerEnd={<label class="network-menu-subtitle" label={networkStatus} />}
          >
            <box class="network-toolbar" orientation={Gtk.Orientation.HORIZONTAL}>
              <label class="network-toolbar-title" label="Wi-Fi" xalign={0} hexpand />
              <switch
                class="network-wifi-power"
                tooltipText="Wi-Fi power"
                active={wifiEnabled}
                sensitive={createComputed(() => networkingEnabled() && Boolean(wifi))}
                onNotifyActive={(toggle: Gtk.Switch) => setWifiEnabled(toggle.active)}
              />
              <button class="network-rescan" tooltipText="Rescan Wi-Fi" onClicked={rescanWifi}>
                <image iconName="view-refresh-symbolic" pixelSize={16} useFallback />
              </button>
              <button
                class="network-manager"
                tooltipText="Open network settings"
                onClicked={openNetworkManager}
              >
                <image iconName="preferences-system-network-symbolic" pixelSize={16} useFallback />
              </button>
            </box>
            <PanelSection title="Ethernet">
              <EthernetSection />
            </PanelSection>
            <PanelSection title="Wi-Fi">
              <WifiSection />
            </PanelSection>
            <PanelSection title="VPN">
              <VpnSection />
            </PanelSection>
          </Panel>
        )}
      </PanelPopover>
    </menubutton>
  )
}
