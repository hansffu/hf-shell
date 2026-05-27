import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import GLib from "gi://GLib"
import { showScreenCaptureOsd } from "./Osd"

export type ScreenToolkitCommand =
  | "annotate"
  | "annotateFullscreen"
  | "annotateWindow"
  | "colorPicker"
  | "lens"
  | "measure"
  | "ocr"
  | "palette"
  | "pin"
  | "pinImage"
  | "qr"
  | "record"
  | "recordMp4"
  | "recordFullscreen"
  | "recordFullscreenMp4"
  | "recordStop"

export type CaptureFormat = "gif" | "mp4"
export type CaptureScope = "fullscreen" | "window" | "region"

const globalWithSrc = globalThis as typeof globalThis & { SRC?: string }
const sourceRoot = globalWithSrc.SRC ?? "."
const scriptPath = GLib.build_filenamev([sourceRoot, "scripts", "screen-toolkit"])

let nextPinId = 0

function bytesToString(bytes: Uint8Array) {
  return String.fromCharCode(...bytes)
}

function spawnArgs(command: string) {
  return ["sh", scriptPath, command]
}

function spawnScreenToolkit(args: string[]) {
  GLib.spawn_async(
    null,
    ["sh", scriptPath, ...args],
    null,
    GLib.SpawnFlags.SEARCH_PATH,
    null,
  )
}

function commandOsd(command: ScreenToolkitCommand) {
  switch (command) {
    case "annotate":
      return ["Select screenshot region", "document-edit-symbolic"] as const
    case "annotateFullscreen":
      return ["Capturing full screen", "view-fullscreen-symbolic"] as const
    case "annotateWindow":
      return ["Capturing active window", "window-symbolic"] as const
    case "measure":
      return ["Select area to measure", "tool-measure-symbolic"] as const
    case "colorPicker":
      return ["Pick a color", "color-select-symbolic"] as const
    case "palette":
      return ["Select area for palette", "applications-graphics-symbolic"] as const
    case "ocr":
      return ["Select area for OCR", "insert-text-symbolic"] as const
    case "qr":
      return ["Select area for QR scan", "view-grid-symbolic"] as const
    case "lens":
      return ["Select area for Lens", "edit-find-symbolic"] as const
    case "record":
      return ["Recording region GIF", "media-record-symbolic"] as const
    case "recordMp4":
      return ["Recording region MP4", "media-record-symbolic"] as const
    case "recordFullscreen":
      return ["Recording full screen GIF", "media-record-symbolic"] as const
    case "recordFullscreenMp4":
      return ["Recording full screen MP4", "media-record-symbolic"] as const
    case "recordStop":
      return ["Recording stopped", "media-playback-stop-symbolic"] as const
    default:
      return null
  }
}

function captureScopeLabel(scope: CaptureScope) {
  if (scope === "fullscreen") return "full screen"
  return scope
}

export function runScreenToolkit(command: ScreenToolkitCommand) {
  try {
    const osd = commandOsd(command)

    if (osd) showScreenCaptureOsd(osd[0], osd[1])
    spawnScreenToolkit([command])
  } catch (error) {
    void error
  }
}

export function startScreenCapture(
  format: CaptureFormat,
  scope: CaptureScope,
  durationSeconds: number,
) {
  try {
    const duration = durationSeconds > 0 ? String(durationSeconds) : ""
    const durationLabel = durationSeconds > 0 ? `${durationSeconds}s ` : ""

    showScreenCaptureOsd(
      `Recording ${durationLabel}${captureScopeLabel(scope)} ${format.toUpperCase()}`,
      "media-record-symbolic",
    )
    spawnScreenToolkit(["capture", format, scope, duration])
  } catch (error) {
    void error
  }
}

function runScreenToolkitSync(command: string) {
  try {
    const [ok, stdout, stderr, status] = GLib.spawn_sync(
      null,
      spawnArgs(command),
      null,
      GLib.SpawnFlags.SEARCH_PATH,
      null,
    )

    if (!ok || status !== 0) {
      void stderr
      return null
    }

    const output = bytesToString(stdout).trim()
    return output.length > 0 ? output.split("\n")[0] : null
  } catch (error) {
    void error
    return null
  }
}

export function screenToolkitStatus() {
  return runScreenToolkitSync("status") ?? "idle"
}

export function pinRegion(gdkmonitor: Gdk.Monitor) {
  showScreenCaptureOsd("Select region to pin", "insert-image-symbolic")
  const file = runScreenToolkitSync("pin-region")
  if (file) createPinnedImage(file, gdkmonitor)
}

export function pinImage(gdkmonitor: Gdk.Monitor) {
  showScreenCaptureOsd("Choose image to pin", "folder-pictures-symbolic")
  const file = runScreenToolkitSync("pick-file")
  if (file) createPinnedImage(file, gdkmonitor)
}

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "Pinned image"
}

function createPinnedImage(path: string, gdkmonitor: Gdk.Monitor) {
  const name = `screen-toolkit-pin-${nextPinId++}`
  const picture = Gtk.Picture.new_for_filename(path)

  picture.set_can_shrink(true)
  picture.set_size_request(240, 160)

  return (
    <window
      visible
      name={name}
      class="ScreenToolkitPin"
      application={app}
      gdkmonitor={gdkmonitor}
      defaultWidth={420}
      defaultHeight={280}
      resizable
    >
      <box class="screen-toolkit-pin-frame" orientation={Gtk.Orientation.VERTICAL}>
        <box class="screen-toolkit-pin-header" orientation={Gtk.Orientation.HORIZONTAL}>
          <label
            class="screen-toolkit-pin-title"
            xalign={0}
            ellipsize={3}
            label={basename(path)}
            hexpand
          />
          <button
            class="screen-toolkit-pin-close"
            tooltipText="Close"
            $={(button) => {
              button.connect("clicked", () => app.get_window(name)?.close())
            }}
          >
            <image iconName="window-close-symbolic" pixelSize={14} useFallback />
          </button>
        </box>
        {picture}
      </box>
    </window>
  )
}
