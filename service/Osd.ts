import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"
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

function getDefaultSpeaker() {
  const defaultSpeaker = [...(audio.get_speakers() ?? [])].find((endpoint) => endpoint.is_default)

  return defaultSpeaker ?? audio.get_default_speaker()
}

function getDefaultMicrophone() {
  const defaultMicrophone = [...(audio.get_microphones() ?? [])].find((endpoint) => endpoint.is_default)

  return defaultMicrophone ?? audio.get_default_microphone()
}

let hideTimer = 0
let speaker = getDefaultSpeaker()
let speakerSignals: number[] = []
let lastSpeakerVolume = speaker.volume
let lastSpeakerMute = speaker.mute
let microphone = getDefaultMicrophone()
let microphoneSignals: number[] = []
let lastMicrophoneVolume = microphone.volume
let lastMicrophoneMute = microphone.mute
let brightnessDevice = ""
let lastBrightness: number | null = null
const suppressVolumeUntil = Date.now() + STARTUP_SUPPRESS_MS
const suppressMicrophoneUntil = Date.now() + STARTUP_SUPPRESS_MS

function bytesToString(bytes: Uint8Array) {
  let output = ""

  for (const byte of bytes) output += String.fromCharCode(byte)

  return output
}

function readFile(path: string) {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)

    return ok ? bytesToString(bytes).trim() : ""
  } catch (error) {
    void error
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
  } catch (error) {
    void error
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

function bindSpeaker() {
  for (const signal of speakerSignals) speaker.disconnect(signal)
  speakerSignals = []
  speaker = getDefaultSpeaker()
  lastSpeakerVolume = speaker.volume
  lastSpeakerMute = speaker.mute

  const update = () => {
    const volumeChanged = Math.abs(speaker.volume - lastSpeakerVolume) > 0.005
    const muteChanged = speaker.mute !== lastSpeakerMute

    lastSpeakerVolume = speaker.volume
    lastSpeakerMute = speaker.mute

    if (Date.now() < suppressVolumeUntil) return
    if (volumeChanged || muteChanged) showVolume()
  }

  speakerSignals = [
    speaker.connect("notify::mute", update),
    speaker.connect("notify::volume", update),
    speaker.connect("notify::volume-icon", update),
  ]
}

function bindMicrophone() {
  for (const signal of microphoneSignals) microphone.disconnect(signal)
  microphoneSignals = []
  microphone = getDefaultMicrophone()
  lastMicrophoneVolume = microphone.volume
  lastMicrophoneMute = microphone.mute

  const update = () => {
    const volumeChanged = Math.abs(microphone.volume - lastMicrophoneVolume) > 0.005
    const muteChanged = microphone.mute !== lastMicrophoneMute

    lastMicrophoneVolume = microphone.volume
    lastMicrophoneMute = microphone.mute

    if (Date.now() < suppressMicrophoneUntil) return
    if (volumeChanged || muteChanged) showMicrophone()
  }

  microphoneSignals = [
    microphone.connect("notify::mute", update),
    microphone.connect("notify::volume", update),
    microphone.connect("notify::volume-icon", update),
  ]
}

function connectEndpointDefaultSignals(
  kind: "speaker" | "microphone",
  bindDefault: () => void,
) {
  let endpointSignals: Array<[AstalWp.Endpoint, number]> = []

  const disconnectEndpoints = () => {
    for (const [endpoint, signal] of endpointSignals) endpoint.disconnect(signal)
    endpointSignals = []
  }

  const refresh = () => {
    disconnectEndpoints()

    const endpoints = kind === "speaker" ? audio.get_speakers() : audio.get_microphones()

    endpointSignals = [...(endpoints ?? [])].map((endpoint) => [
      endpoint,
      endpoint.connect("notify::is-default", refresh),
    ])

    bindDefault()
  }

  if (kind === "speaker") {
    audio.connect("notify::default-speaker", refresh)
    audio.connect("speaker-added", refresh)
    audio.connect("speaker-removed", refresh)
  } else {
    audio.connect("notify::default-microphone", refresh)
    audio.connect("microphone-added", refresh)
    audio.connect("microphone-removed", refresh)
  }

  refresh()
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

connectEndpointDefaultSignals("speaker", bindSpeaker)
connectEndpointDefaultSignals("microphone", bindMicrophone)
pollBrightness()
GLib.timeout_add(GLib.PRIORITY_DEFAULT, BRIGHTNESS_POLL_MS, pollBrightness)
