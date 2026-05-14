import { Astal, Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp"
import Panel, { PanelSection } from "./Panel"
import { setupPanelPopover } from "./PanelRevealer"

const wp = AstalWp.get_default()
const audio = wp.get_audio()

type EndpointKind = "speaker" | "microphone"

type AudioRowControls = {
  deviceLabel: Gtk.Label
  dropdown: Gtk.DropDown
  icon: Gtk.Image
  muteButton: Gtk.Button
  muteIcon: Gtk.Image
  slider: Astal.Slider
  valueLabel: Gtk.Label
}

type SoundButtonControls = {
  icon: Gtk.Image
  label: Gtk.Label
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function endpointLabel(endpoint: AstalWp.Endpoint) {
  return endpoint.description || endpoint.name || "Audio device"
}

function compareEndpoints(left: AstalWp.Endpoint, right: AstalWp.Endpoint) {
  return endpointLabel(left).localeCompare(endpointLabel(right))
}

function getDefaultEndpoint(kind: EndpointKind) {
  return kind === "speaker"
    ? audio.get_default_speaker()
    : audio.get_default_microphone()
}

function getEndpoints(kind: EndpointKind) {
  const endpoints = kind === "speaker" ? audio.get_speakers() : audio.get_microphones()

  return [...(endpoints ?? [])].sort(compareEndpoints)
}

function setEndpointVolume(endpoint: AstalWp.Endpoint, value: number) {
  const next = Math.max(0, Math.min(1.5, value))

  if (Math.abs(endpoint.volume - next) > 0.005) endpoint.set_volume(next)
}

function scrollEndpointVolume(endpoint: AstalWp.Endpoint, dy: number) {
  if (dy === 0) return

  setEndpointVolume(endpoint, endpoint.volume + (dy < 0 ? 0.05 : -0.05))
}

function iconName(icon: string, muted: boolean) {
  if (muted) return "audio-volume-muted-symbolic"
  if (icon.endsWith("-symbolic")) return icon
  return `${icon}-symbolic`
}

function connectEndpointSignals(kind: EndpointKind, sync: () => void) {
  if (kind === "speaker") {
    audio.connect("notify::default-speaker", sync)
    audio.connect("speaker-added", sync)
    audio.connect("speaker-removed", sync)
  } else {
    audio.connect("notify::default-microphone", sync)
    audio.connect("microphone-added", sync)
    audio.connect("microphone-removed", sync)
  }
}

function setupDeviceDropdown(dropdown: Gtk.DropDown, kind: EndpointKind) {
  let endpoints: AstalWp.Endpoint[] = []
  let syncing = false

  const sync = () => {
    const defaultEndpoint = getDefaultEndpoint(kind)
    const selectedIndex = endpoints.findIndex((endpoint) => endpoint.id === defaultEndpoint.id)

    syncing = true
    dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : 0)
    syncing = false
  }

  const refresh = () => {
    endpoints = getEndpoints(kind)

    syncing = true
    dropdown.set_model(
      Gtk.StringList.new(endpoints.length > 0
        ? endpoints.map(endpointLabel)
        : ["No devices"]),
    )
    dropdown.set_sensitive(endpoints.length > 0)
    syncing = false

    sync()
  }

  dropdown.connect("notify::selected", (select) => {
    if (syncing) return

    const endpoint = endpoints[select.selected]

    if (endpoint && !endpoint.is_default) endpoint.set_is_default(true)
  })

  connectEndpointSignals(kind, refresh)
  refresh()
}

function setupSoundButton(button: Gtk.MenuButton, controls: SoundButtonControls) {
  let speaker = audio.get_default_speaker()
  let speakerSignals: number[] = []

  const disconnectSpeaker = () => {
    for (const signal of speakerSignals) speaker.disconnect(signal)
    speakerSignals = []
  }

  const update = () => {
    controls.icon.set_from_icon_name(iconName(speaker.volume_icon, speaker.mute))
    controls.label.set_label(percent(speaker.volume))
    button.set_tooltip_text(`${speaker.mute ? "Muted" : "Volume"} ${percent(speaker.volume)}`)
  }

  const bindSpeaker = () => {
    disconnectSpeaker()
    speaker = audio.get_default_speaker()
    speakerSignals = [
      speaker.connect("notify::mute", update),
      speaker.connect("notify::volume", update),
      speaker.connect("notify::volume-icon", update),
    ]
    update()
  }

  const scroll = Gtk.EventControllerScroll.new(
    Gtk.EventControllerScrollFlags.VERTICAL |
      Gtk.EventControllerScrollFlags.DISCRETE,
  )

  scroll.connect("scroll", (_controller, _dx, dy) => {
    scrollEndpointVolume(speaker, dy)
    return true
  })

  button.add_controller(scroll)
  audio.connect("notify::default-speaker", bindSpeaker)
  bindSpeaker()
}

function setupAudioRow(kind: EndpointKind, icon: string, controls: AudioRowControls) {
  let endpoint = getDefaultEndpoint(kind)
  let endpointSignals: number[] = []
  let syncingSlider = false

  const disconnectEndpoint = () => {
    for (const signal of endpointSignals) endpoint.disconnect(signal)
    endpointSignals = []
  }

  const update = () => {
    syncingSlider = true
    controls.icon.set_from_icon_name(iconName(endpoint.volume_icon || icon, endpoint.mute))
    controls.deviceLabel.set_label(endpointLabel(endpoint))
    controls.valueLabel.set_label(percent(endpoint.volume))
    controls.muteButton.set_css_classes(endpoint.mute ? ["audio-mute", "active"] : ["audio-mute"])
    controls.muteButton.set_tooltip_text(endpoint.mute ? "Unmute" : "Mute")
    controls.muteIcon.set_from_icon_name(endpoint.mute ? "audio-volume-muted-symbolic" : icon)
    controls.slider.value = endpoint.volume
    syncingSlider = false
  }

  const bindEndpoint = () => {
    disconnectEndpoint()
    endpoint = getDefaultEndpoint(kind)
    endpointSignals = [
      endpoint.connect("notify::description", update),
      endpoint.connect("notify::mute", update),
      endpoint.connect("notify::name", update),
      endpoint.connect("notify::volume", update),
      endpoint.connect("notify::volume-icon", update),
    ]
    update()
  }

  controls.slider.connect("notify::value", () => {
    if (!syncingSlider) setEndpointVolume(endpoint, controls.slider.value)
  })

  controls.muteButton.connect("clicked", () => endpoint.set_mute(!endpoint.mute))
  setupDeviceDropdown(controls.dropdown, kind)
  connectEndpointSignals(kind, bindEndpoint)
  bindEndpoint()
}

function DeviceDropdown({ onReady }: { onReady: (dropdown: Gtk.DropDown) => void }) {
  const dropdown = Gtk.DropDown.new(null, null)

  dropdown.add_css_class("audio-device-select")
  dropdown.hexpand = true
  onReady(dropdown)

  return dropdown
}

function AudioRow({
  icon,
  kind,
  title,
}: {
  icon: string
  kind: EndpointKind
  title: string
}) {
  let controls: Partial<AudioRowControls> = {}
  let setupDone = false

  const maybeSetup = () => {
    if (
      setupDone ||
      !controls.deviceLabel ||
      !controls.dropdown ||
      !controls.icon ||
      !controls.muteButton ||
      !controls.muteIcon ||
      !controls.slider ||
      !controls.valueLabel
    ) {
      return
    }

    setupDone = true
    setupAudioRow(kind, icon, {
      deviceLabel: controls.deviceLabel,
      dropdown: controls.dropdown,
      icon: controls.icon,
      muteButton: controls.muteButton,
      muteIcon: controls.muteIcon,
      slider: controls.slider,
      valueLabel: controls.valueLabel,
    })
  }

  return (
    <box class="audio-row" orientation={Gtk.Orientation.VERTICAL}>
      <box class="audio-row-header" orientation={Gtk.Orientation.HORIZONTAL}>
        <image
          iconName={icon}
          pixelSize={18}
          useFallback
          $={(image) => {
            controls = { ...controls, icon: image }
            maybeSetup()
          }}
        />
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="audio-row-title" xalign={0} label={title} />
          <label
            class="audio-row-device"
            xalign={0}
            $={(label) => {
              controls = { ...controls, deviceLabel: label }
              maybeSetup()
            }}
          />
        </box>
        <label
          class="audio-row-value"
          $={(label) => {
            controls = { ...controls, valueLabel: label }
            maybeSetup()
          }}
        />
        <button
          class="audio-mute"
          $={(button) => {
            controls = { ...controls, muteButton: button }
            maybeSetup()
          }}
        >
          <image
            iconName={icon}
            pixelSize={16}
            useFallback
            $={(image) => {
              controls = { ...controls, muteIcon: image }
              maybeSetup()
            }}
          />
        </button>
      </box>
      <DeviceDropdown
        onReady={(dropdown) => {
          controls = { ...controls, dropdown }
          maybeSetup()
        }}
      />
      <slider
        class="audio-slider"
        hexpand
        min={0}
        max={1.5}
        step={0.01}
        $={(slider) => {
          controls = { ...controls, slider }
          maybeSetup()
        }}
      />
    </box>
  )
}

export default function SoundControl() {
  let controls: Partial<SoundButtonControls> = {}
  let menuButton: Gtk.MenuButton | null = null
  let setupDone = false

  const maybeSetup = () => {
    if (setupDone || !menuButton || !controls.icon || !controls.label) return

    setupDone = true
    setupSoundButton(menuButton, {
      icon: controls.icon,
      label: controls.label,
    })
  }

  return (
    <menubutton
      class="sound-control"
      direction={Gtk.ArrowType.RIGHT}
      $={(button) => {
        menuButton = button
        maybeSetup()
      }}
    >
      <box class="sound-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName="audio-volume-medium-symbolic"
          pixelSize={17}
          useFallback
          $={(image) => {
            controls = { ...controls, icon: image }
            maybeSetup()
          }}
        />
        <label
          class="sound-control-percent"
          $={(label) => {
            controls = { ...controls, label }
            maybeSetup()
          }}
        />
      </box>
      <popover
        $={(popover: Gtk.Popover) => {
          setupPanelPopover(popover)
        }}
      >
        <Panel
          title="Sound"
          class="sound-menu"
          headerEnd={<label class="sound-menu-subtitle" label="Devices" />}
        >
          <PanelSection title="Output">
            <AudioRow kind="speaker" icon="audio-speakers-symbolic" title="Output" />
          </PanelSection>
          <PanelSection title="Input">
            <AudioRow kind="microphone" icon="audio-input-microphone-symbolic" title="Input" />
          </PanelSection>
        </Panel>
      </popover>
    </menubutton>
  )
}
