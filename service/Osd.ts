import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"
import { readFile as readTextFile } from "ags/file"
import { createComputed, createState } from "gnim"

export type OsdKind = "volume" | "microphone" | "brightness" | "screenCapture"

export type OsdState = {
  kind: OsdKind
  icon: string
  label: string
  value?: number
  percent?: number
}

const SHOW_MS = 1400
const STARTUP_SUPPRESS_MS = 1500
const BRIGHTNESS_POLL_MS = 250
const BACKLIGHT_PATH = "/sys/class/backlight"

const wp = AstalWp.get_default()
const audio = wp.get_audio()

export const [osdState, setOsdState] = createState<OsdState | null>(null)
export const hasOsd = createComputed(() => osdState() !== null)

// The default endpoints are stable proxies that follow whichever node is currently default.
const speaker = audio.get_default_speaker()
const microphone = audio.get_default_microphone()

let hideTimer = 0
let brightnessDevice = ""
let lastBrightness: number | null = null
const suppressUntil = Date.now() + STARTUP_SUPPRESS_MS

function readFile(path: string) {
  try {
    return readTextFile(path).trim()
  } catch {
    return ""
  }
}

function listDirectory(path: string) {
  try {
    const dir = GLib.Dir.open(path, 0)
    const files: string[] = []
    let file = dir.read_name()

    while (file !== null) {
      files.push(file)
      file = dir.read_name()
    }

    dir.close()
    return files
  } catch {
    return []
  }
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function percent(value: number) {
  return Math.max(0, Math.round(value * 100))
}

function showOsd(state: OsdState) {
  if (hideTimer !== 0) {
    GLib.source_remove(hideTimer)
    hideTimer = 0
  }

  setOsdState(state)
  hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_MS, () => {
    hideTimer = 0
    setOsdState(null)
    return GLib.SOURCE_REMOVE
  })
}

function showVolume() {
  const value = speaker.mute ? 0 : clamp(speaker.volume)
  const volumeIcon = speaker.mute ? "audio-volume-muted-symbolic" : speaker.volume_icon

  showOsd({
    kind: "volume",
    icon: volumeIcon || "audio-volume-high-symbolic",
    label: speaker.mute ? "Muted" : "Volume",
    value,
    percent: percent(value),
  })
}

function showMicrophone() {
  const value = microphone.mute ? 0 : clamp(microphone.volume)

  showOsd({
    kind: "microphone",
    icon: microphone.mute
      ? "microphone-sensitivity-muted-symbolic"
      : "audio-input-microphone-symbolic",
    label: microphone.mute ? "Microphone muted" : "Microphone",
    value,
    percent: percent(microphone.mute ? 0 : microphone.volume),
  })
}

export function showScreenCaptureOsd(label: string, icon = "applets-screenshooter-symbolic") {
  showOsd({
    kind: "screenCapture",
    icon,
    label,
  })
}

// Show the OSD when volume or mute changes, but not when the default device itself changes.
// Retargeting notifies id before volume/mute, so the baseline is re-read once that burst is over.
function watchEndpoint(endpoint: AstalWp.Endpoint, show: () => void) {
  const snapshot = () => ({ volume: endpoint.volume, mute: endpoint.mute })
  let last = snapshot()
  let retargetId = 0

  const update = () => {
    if (retargetId !== 0) return

    const changed =
      Math.abs(endpoint.volume - last.volume) > 0.005 || endpoint.mute !== last.mute

    last = snapshot()
    if (changed && Date.now() >= suppressUntil) show()
  }

  endpoint.connect("notify::id", () => {
    if (retargetId !== 0) GLib.source_remove(retargetId)

    retargetId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      retargetId = 0
      last = snapshot()
      return GLib.SOURCE_REMOVE
    })
  })
  endpoint.connect("notify::mute", update)
  endpoint.connect("notify::volume", update)
}

function findBrightnessDevice() {
  for (const device of listDirectory(BACKLIGHT_PATH)) {
    const path = GLib.build_filenamev([BACKLIGHT_PATH, device])
    const max = Number(readFile(GLib.build_filenamev([path, "max_brightness"])))

    if (max > 0) return path
  }

  return ""
}

function readBrightness() {
  if (!brightnessDevice) brightnessDevice = findBrightnessDevice()
  if (!brightnessDevice) return null

  const current = Number(readFile(GLib.build_filenamev([brightnessDevice, "brightness"])))
  const max = Number(readFile(GLib.build_filenamev([brightnessDevice, "max_brightness"])))

  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return null
  return clamp(current / max)
}

function pollBrightness() {
  const brightness = readBrightness()

  if (brightness === null) {
    lastBrightness = null
    return GLib.SOURCE_CONTINUE
  }

  if (lastBrightness === null) {
    lastBrightness = brightness
    return GLib.SOURCE_CONTINUE
  }

  const changed = Math.abs(brightness - lastBrightness) > 0.005
  lastBrightness = brightness

  if (changed) {
    showOsd({
      kind: "brightness",
      icon: "display-brightness-symbolic",
      label: "Brightness",
      value: brightness,
      percent: percent(brightness),
    })
  }

  return GLib.SOURCE_CONTINUE
}

watchEndpoint(speaker, showVolume)
watchEndpoint(microphone, showMicrophone)
pollBrightness()
GLib.timeout_add(GLib.PRIORITY_DEFAULT, BRIGHTNESS_POLL_MS, pollBrightness)
