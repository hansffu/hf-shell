import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import GLib from "gi://GLib"

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

export function screenToolkitPollCommand(command: string) {
  return `sh '${scriptPath.replaceAll("'", "'\\''")}' ${command}`
}

export function runScreenToolkit(command: ScreenToolkitCommand) {
  try {
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

export function pinRegion(gdkmonitor: Gdk.Monitor) {
  const file = runScreenToolkitSync("pin-region")
  if (file) createPinnedImage(file, gdkmonitor)
}

export function pinImage(gdkmonitor: Gdk.Monitor) {
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
