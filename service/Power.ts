import AstalBattery from "gi://AstalBattery"
import { createState } from "gnim"

export type PowerState = {
  available: boolean
  charging: boolean
  className: string
  iconName: string
  label: string
  percentage: number
  status: string
  tooltip: string
}

const battery = AstalBattery.get_default()

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return ""

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`

  return `${minutes}m`
}

function chargeClass(percentage: number, charging: boolean) {
  if (charging) return "charging"
  if (percentage <= 0.1) return "critical"
  if (percentage <= 0.2) return "low"
  if (percentage <= 0.5) return "medium"

  return "high"
}

function readPowerState(): PowerState {
  if (!battery?.is_battery || !battery.is_present) {
    return {
      available: false,
      charging: false,
      className: "power-control-content unavailable",
      iconName: "battery-missing-symbolic",
      label: "--",
      percentage: 0,
      status: "No battery",
      tooltip: "No battery detected",
    }
  }

  const percentage = clamp(battery.percentage)
  const charging = battery.charging
  const duration = formatDuration(charging ? battery.time_to_full : battery.time_to_empty)
  const status = charging ? "Charging" : "On battery"
  const timeLabel = charging ? "Time until full" : "Time remaining"
  const tooltip = [
    `Battery ${percent(percentage)}`,
    status,
    duration ? `${timeLabel}: ${duration}` : "",
  ].filter(Boolean).join("\n")

  return {
    available: true,
    charging,
    className: `power-control-content ${chargeClass(percentage, charging)}`,
    iconName: battery.battery_icon_name || "battery-missing-symbolic",
    label: percent(percentage),
    percentage,
    status,
    tooltip,
  }
}

export const [powerState, setPowerState] = createState<PowerState>(readPowerState())

function refreshPowerState() {
  setPowerState(readPowerState())
}

if (battery) {
  for (const property of [
    "battery-icon-name",
    "charging",
    "is-battery",
    "is-present",
    "percentage",
    "state",
    "time-to-empty",
    "time-to-full",
  ]) {
    battery.connect(`notify::${property}`, refreshPowerState)
  }
}
