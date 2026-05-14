import { Gdk, Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import { createComputed } from "gnim"
import {
  CaptureFormat,
  CaptureScope,
  pinImage,
  pinRegion,
  runScreenToolkit,
  screenToolkitPollCommand,
  ScreenToolkitCommand,
  startScreenCapture,
} from "../service/ScreenToolkit"
import Panel, { PanelSection } from "./Panel"
import { setupPanelPopover } from "./PanelRevealer"

type Tool = {
  command: ScreenToolkitCommand
  description: string
  icon: string
  label: string
}

const screenshotTools: Tool[] = [
  {
    command: "annotate",
    description: "Select a region and annotate it",
    icon: "document-edit-symbolic",
    label: "Annotate",
  },
  {
    command: "annotateFullscreen",
    description: "Annotate the full screen",
    icon: "view-fullscreen-symbolic",
    label: "Full Screen",
  },
  {
    command: "annotateWindow",
    description: "Annotate the active Hyprland window",
    icon: "window-symbolic",
    label: "Window",
  },
  {
    command: "measure",
    description: "Select a region and copy its pixel size",
    icon: "tool-measure-symbolic",
    label: "Measure",
  },
]

const analysisTools: Tool[] = [
  {
    command: "colorPicker",
    description: "Pick a pixel color and copy HEX, RGB, HSL, and HSV",
    icon: "color-select-symbolic",
    label: "Color",
  },
  {
    command: "palette",
    description: "Extract dominant colors from a region",
    icon: "applications-graphics-symbolic",
    label: "Palette",
  },
  {
    command: "ocr",
    description: "Extract text from a region",
    icon: "insert-text-symbolic",
    label: "OCR",
  },
  {
    command: "qr",
    description: "Scan QR codes and barcodes from a region",
    icon: "view-grid-symbolic",
    label: "QR",
  },
  {
    command: "lens",
    description: "Upload a region and open Google Lens",
    icon: "edit-find-symbolic",
    label: "Lens",
  },
]

const formatOptions: Array<{ label: string; value: CaptureFormat }> = [
  { label: "MP4", value: "mp4" },
  { label: "GIF", value: "gif" },
]

const scopeOptions: Array<{ label: string; value: CaptureScope }> = [
  { label: "Region", value: "region" },
  { label: "Window", value: "window" },
  { label: "Full", value: "fullscreen" },
]

const durationOptions = [
  { label: "Manual", value: 0 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
]

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
}

function ToolButton({
  icon,
  label,
  tooltip,
  onActivate,
}: {
  icon: string
  label: string
  tooltip: string
  onActivate: () => void
}) {
  return (
    <button
      class="screen-toolkit-tool"
      tooltipText={tooltip}
      $={(button) => {
        button.connect("clicked", onActivate)
      }}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
      >
        <image iconName={icon} pixelSize={26} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} useFallback />
        <label
          class="screen-toolkit-tool-label"
          xalign={0.5}
          justify={Gtk.Justification.CENTER}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          label={label}
        />
      </box>
    </button>
  )
}

function ToolSection({
  title,
  tools,
  onCommand,
}: {
  title: string
  tools: Tool[]
  onCommand: (command: ScreenToolkitCommand) => void
}) {
  return (
    <PanelSection title={title}>
      <box class="screen-toolkit-grid" orientation={Gtk.Orientation.HORIZONTAL}>
        {tools.map((tool) => (
          <ToolButton
            icon={tool.icon}
            label={tool.label}
            tooltip={tool.description}
            onActivate={() => onCommand(tool.command)}
          />
        ))}
      </box>
    </PanelSection>
  )
}

function ChoiceButton({
  active,
  label,
  onActivate,
  onReady,
}: {
  active: boolean
  label: string
  onActivate: () => void
  onReady: (button: Gtk.Button) => void
}) {
  return (
    <button
      class={active ? "screen-toolkit-choice active" : "screen-toolkit-choice"}
      $={(button) => {
        onReady(button)
        button.connect("clicked", onActivate)
      }}
    >
      <label label={label} />
    </button>
  )
}

function CaptureMenu({ onStart }: { onStart: () => void }) {
  let format: CaptureFormat = "mp4"
  let scope: CaptureScope = "region"
  let duration = 0
  let popover: Gtk.Popover | null = null
  const formatButtons = new Map<CaptureFormat, Gtk.Button>()
  const scopeButtons = new Map<CaptureScope, Gtk.Button>()
  const durationButtons = new Map<number, Gtk.Button>()

  const sync = () => {
    for (const [value, button] of formatButtons) {
      button.set_css_classes(
        value === format ? ["screen-toolkit-choice", "active"] : ["screen-toolkit-choice"],
      )
    }
    for (const [value, button] of scopeButtons) {
      button.set_css_classes(
        value === scope ? ["screen-toolkit-choice", "active"] : ["screen-toolkit-choice"],
      )
    }
    for (const [value, button] of durationButtons) {
      button.set_css_classes(
        value === duration ? ["screen-toolkit-choice", "active"] : ["screen-toolkit-choice"],
      )
    }
  }

  const start = () => {
    popover?.popdown()
    onStart()
    startScreenCapture(format, scope, duration)
  }

  return (
    <menubutton class="screen-capture" direction={Gtk.ArrowType.RIGHT}>
      <box orientation={Gtk.Orientation.HORIZONTAL}>
        <image iconName="media-record-symbolic" pixelSize={16} useFallback />
        <label label="Capture" />
      </box>
      <popover
        $={(widget: Gtk.Popover) => {
          popover = widget
          setupPanelPopover(widget)
        }}
      >
        <Panel title="Screen Capture" class="screen-capture-menu">
          <PanelSection title="Format" class="screen-toolkit-picker">
            <box class="screen-toolkit-choice-row" orientation={Gtk.Orientation.HORIZONTAL}>
              {formatOptions.map((option) => (
                <ChoiceButton
                  active={option.value === format}
                  label={option.label}
                  onActivate={() => {
                    format = option.value
                    sync()
                  }}
                  onReady={(button) => formatButtons.set(option.value, button)}
                />
              ))}
            </box>
          </PanelSection>
          <PanelSection title="Area" class="screen-toolkit-picker">
            <box class="screen-toolkit-choice-row" orientation={Gtk.Orientation.HORIZONTAL}>
              {scopeOptions.map((option) => (
                <ChoiceButton
                  active={option.value === scope}
                  label={option.label}
                  onActivate={() => {
                    scope = option.value
                    sync()
                  }}
                  onReady={(button) => scopeButtons.set(option.value, button)}
                />
              ))}
            </box>
          </PanelSection>
          <PanelSection title="Duration" class="screen-toolkit-picker">
            <box class="screen-toolkit-choice-row" orientation={Gtk.Orientation.HORIZONTAL}>
              {durationOptions.map((option) => (
                <ChoiceButton
                  active={option.value === duration}
                  label={option.label}
                  onActivate={() => {
                    duration = option.value
                    sync()
                  }}
                  onReady={(button) => durationButtons.set(option.value, button)}
                />
              ))}
            </box>
          </PanelSection>
          <button
            class="screen-capture-start"
            $={(button) => {
              button.connect("clicked", start)
            }}
          >
            <box orientation={Gtk.Orientation.HORIZONTAL}>
              <image iconName="media-record-symbolic" pixelSize={16} useFallback />
              <label label="Start" />
            </box>
          </button>
        </Panel>
      </popover>
    </menubutton>
  )
}

export function ScreenCaptureStopButton() {
  const status = createPoll("idle", 1000, screenToolkitPollCommand("status"))
  const elapsed = createComputed(() => {
    const [, rawSeconds] = status().split(" ")
    return Number(rawSeconds ?? 0)
  })
  const isRecording = createComputed(() => status().startsWith("recording"))
  const tooltip = createComputed(() => `Stop recording (${formatDuration(elapsed())})`)

  return (
    <button
      class="screen-capture-stop"
      visible={isRecording}
      tooltipText={tooltip}
      $={(button) => {
        button.connect("clicked", () => runScreenToolkit("recordStop"))
      }}
    >
      <image iconName="media-playback-stop-symbolic" pixelSize={17} useFallback />
    </button>
  )
}

export default function ScreenToolkit({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let popover: Gtk.Popover | null = null

  const close = () => popover?.popdown()

  const run = (command: ScreenToolkitCommand) => {
    close()
    runScreenToolkit(command)
  }

  const runPinRegion = () => {
    close()
    pinRegion(gdkmonitor)
  }

  const runPinImage = () => {
    close()
    pinImage(gdkmonitor)
  }

  return (
    <menubutton class="screen-toolkit" direction={Gtk.ArrowType.RIGHT}>
      <image iconName="applets-screenshooter-symbolic" pixelSize={17} useFallback />
      <popover
        $={(widget: Gtk.Popover) => {
          popover = widget
          setupPanelPopover(widget)
        }}
      >
        <Panel title="Screen Toolkit" class="screen-toolkit-menu">
          <ToolSection title="Screenshot" tools={screenshotTools} onCommand={run} />

          <PanelSection title="Pin">
            <box class="screen-toolkit-grid" orientation={Gtk.Orientation.HORIZONTAL}>
              <ToolButton
                icon="insert-image-symbolic"
                label="Region"
                tooltip="Capture a region and pin it as a floating window"
                onActivate={runPinRegion}
              />
              <ToolButton
                icon="folder-pictures-symbolic"
                label="Image"
                tooltip="Choose an image and pin it as a floating window"
                onActivate={runPinImage}
              />
            </box>
          </PanelSection>

          <ToolSection title="Analyze" tools={analysisTools} onCommand={run} />
          <PanelSection title="Screen Capture">
            <CaptureMenu onStart={close} />
          </PanelSection>
        </Panel>
      </popover>
    </menubutton>
  )
}
