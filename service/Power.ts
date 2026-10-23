import AstalBattery from "gi://AstalBattery"
import { createBinding, createComputed } from "gnim"

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

const unavailable: PowerState = {
  available: false,
  charging: false,
  className: "power-control-content unavailable",
  iconName: "battery-missing-symbolic",
  label: "--",
  percentage: 0,
  status: "No battery",
  tooltip: "No battery detected",
}

function createPowerState(device: AstalBattery.Device) {
  const isBattery = createBinding(device, "is_battery")
  const isPresent = createBinding(device, "is_present")
  const percentage = createBinding(device, "percentage").as(clamp)
  const charging = createBinding(device, "charging")
  const iconName = createBinding(device, "battery_icon_name")
  const timeToEmpty = createBinding(device, "time_to_empty")
  const timeToFull = createBinding(device, "time_to_full")

  return createComputed((): PowerState => {
    if (!isBattery() || !isPresent()) return unavailable

    const duration = formatDuration(charging() ? timeToFull() : timeToEmpty())
    const status = charging() ? "Charging" : "On battery"
    const timeLabel = charging() ? "Time until full" : "Time remaining"
    const tooltip = [
      `Battery ${percent(percentage())}`,
      status,
      duration ? `${timeLabel}: ${duration}` : "",
    ].filter(Boolean).join("\n")

    return {
      available: true,
      charging: charging(),
      className: `power-control-content ${chargeClass(percentage(), charging())}`,
      iconName: iconName() || "battery-missing-symbolic",
      label: percent(percentage()),
      percentage: percentage(),
      status,
      tooltip,
    }
  })
}

export const powerState = battery ? createPowerState(battery) : createComputed(() => unavailable)
