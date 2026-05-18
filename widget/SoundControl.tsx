import { Astal, Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp"
import { createState, onCleanup } from "gnim"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"
import Select, { type SelectControl } from "./Select"

const wp = AstalWp.get_default()
const audio = wp.get_audio()

type EndpointKind = "speaker" | "microphone"

type AudioRowControls = {
  deviceLabel: Gtk.Label
  dropdown: SelectControl
  icon: Gtk.Image
  muteButton: Gtk.Button
  muteIcon: Gtk.Image
  profileRow: Gtk.Box
  profileDropdown: SelectControl
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

function uniqueEndpointLabels(endpoints: AstalWp.Endpoint[]) {
  const labels = endpoints.map(endpointLabel)
  const counts = new Map<string, number>()

  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)

  return labels.map((label, index) =>
    counts.get(label) === 1 ? label : `${label} (${endpoints[index].name})`,
  )
}

function profileLabel(profile: AstalWp.Profile) {
  return profile.description || profile.name
}

function uniqueProfileLabels(profiles: AstalWp.Profile[]) {
  const labels = profiles.map(profileLabel)
  const counts = new Map<string, number>()

  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)

  return labels.map((label, index) =>
    counts.get(label) === 1 ? label : `${label} (${profiles[index].name})`,
  )
}

function compareEndpoints(left: AstalWp.Endpoint, right: AstalWp.Endpoint) {
  return endpointLabel(left).localeCompare(endpointLabel(right))
}

function compareProfiles(left: AstalWp.Profile, right: AstalWp.Profile) {
  const availability = Number(right.available !== AstalWp.Available.NO) -
    Number(left.available !== AstalWp.Available.NO)

  if (availability !== 0) return availability

  return right.priority - left.priority
}

function getDefaultEndpoint(kind: EndpointKind) {
  const endpoints = kind === "speaker" ? audio.get_speakers() : audio.get_microphones()
  const defaultEndpoint = [...(endpoints ?? [])].find((endpoint) => endpoint.is_default)

  if (defaultEndpoint) return defaultEndpoint

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
  const audioSignals: number[] = []
  let endpointSignals: Array<[AstalWp.Endpoint, number]> = []

  const disconnectEndpointSignals = () => {
    for (const [endpoint, signal] of endpointSignals) endpoint.disconnect(signal)
    endpointSignals = []
  }

  const bindEndpointSignals = () => {
    disconnectEndpointSignals()

    const defaultEndpoint = getDefaultEndpoint(kind)
    const endpointSet = new Set<AstalWp.Endpoint>(getEndpoints(kind))

    endpointSet.add(defaultEndpoint)

    endpointSignals = [...endpointSet].flatMap((endpoint) => {
      const signals: Array<[AstalWp.Endpoint, number]> = [
        [endpoint, endpoint.connect("notify::is-default", refresh)],
      ]

      if (endpoint.id === defaultEndpoint.id) {
        signals.push(
          [endpoint, endpoint.connect("notify::description", sync)],
          [endpoint, endpoint.connect("notify::device", sync)],
          [endpoint, endpoint.connect("notify::device-id", sync)],
          [endpoint, endpoint.connect("notify::id", sync)],
          [endpoint, endpoint.connect("notify::name", sync)],
        )
      }

      return signals
    })
  }

  const refresh = () => {
    bindEndpointSignals()
    sync()
  }

  if (kind === "speaker") {
    audioSignals.push(
      audio.connect("notify::default-speaker", refresh),
      audio.connect("speaker-added", refresh),
      audio.connect("speaker-removed", refresh),
    )
  } else {
    audioSignals.push(
      audio.connect("notify::default-microphone", refresh),
      audio.connect("microphone-added", refresh),
      audio.connect("microphone-removed", refresh),
    )
  }

  bindEndpointSignals()

  onCleanup(() => {
    disconnectEndpointSignals()
    for (const signal of audioSignals) audio.disconnect(signal)
  })
}

function setupDeviceDropdown(
  dropdown: SelectControl,
  kind: EndpointKind,
  onDefaultChanged: () => void,
) {
  let endpoints: AstalWp.Endpoint[] = []
  let endpointSignals: Array<[AstalWp.Endpoint, number]> = []
  let syncing = false

  const disconnectEndpoints = () => {
    for (const [endpoint, signal] of endpointSignals) endpoint.disconnect(signal)
    endpointSignals = []
  }

  const bindEndpointSignals = () => {
    disconnectEndpoints()
    endpointSignals = endpoints.flatMap((endpoint) => [
      [endpoint, endpoint.connect("notify::description", refresh)] as [AstalWp.Endpoint, number],
      [endpoint, endpoint.connect("notify::is-default", sync)] as [AstalWp.Endpoint, number],
      [endpoint, endpoint.connect("notify::name", refresh)] as [AstalWp.Endpoint, number],
    ])
  }

  const sync = () => {
    const defaultEndpoint = getDefaultEndpoint(kind)
    let selectedIndex = endpoints.findIndex((endpoint) => endpoint.id === defaultEndpoint.id)

    if (selectedIndex < 0) {
      selectedIndex = endpoints.findIndex((endpoint) => endpoint.is_default)
    }

    syncing = true
    dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : 0)
    syncing = false
  }

  const refresh = () => {
    endpoints = getEndpoints(kind)
    bindEndpointSignals()

    syncing = true
    dropdown.set_model(
      Gtk.StringList.new(endpoints.length > 0
        ? uniqueEndpointLabels(endpoints)
        : ["No devices"]),
    )
    dropdown.set_sensitive(endpoints.length > 0)
    syncing = false

    sync()
  }

  const selectedSignal = dropdown.connect("notify::selected", (select) => {
    if (syncing) return

    const endpoint = endpoints[select.selected]

    if (!endpoint || endpoint.is_default) return

    endpoint.set_is_default(true)
    onDefaultChanged()
  })

  connectEndpointSignals(kind, refresh)
  refresh()

  onCleanup(() => {
    disconnectEndpoints()
    dropdown.disconnect(selectedSignal)
  })
}

function setupProfileDropdown(
  row: Gtk.Box,
  dropdown: SelectControl,
  kind: EndpointKind,
) {
  let device: AstalWp.Device | null = null
  let deviceSignals: number[] = []
  let profiles: AstalWp.Profile[] = []
  let syncing = false

  const disconnectDevice = () => {
    if (!device) return

    for (const signal of deviceSignals) device.disconnect(signal)
    deviceSignals = []
  }

  const bindDevice = (nextDevice: AstalWp.Device | null, refresh: () => void) => {
    if (device?.id === nextDevice?.id) return

    disconnectDevice()
    device = nextDevice
    deviceSignals = device
      ? [
          device.connect("notify::active-profile-id", refresh),
          device.connect("notify::description", refresh),
          device.connect("notify::profiles", refresh),
        ]
      : []
  }

  const refresh = () => {
    const endpoint = getDefaultEndpoint(kind)

    bindDevice(endpoint.device, refresh)
    profiles = [...(device?.profiles ?? [])]
      .filter((profile) => profile.available !== AstalWp.Available.NO)
      .sort(compareProfiles)

    const selectedIndex = profiles.findIndex((profile) => profile.index === device?.active_profile_id)
    const showSwitcher = profiles.length > 1

    syncing = true
    dropdown.set_model(
      Gtk.StringList.new(
        showSwitcher
          ? uniqueProfileLabels(profiles)
          : ["No profile options"],
      ),
    )
    dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : 0)
    dropdown.set_sensitive(showSwitcher)
    row.set_visible(showSwitcher)
    syncing = false
  }

  const selectedSignal = dropdown.connect("notify::selected", (select) => {
    if (syncing || !device) return

    const profile = profiles[select.selected]

    if (!profile || profile.available === AstalWp.Available.NO) return
    if (profile.index === device.active_profile_id) return

    device.set_active_profile_id(profile.index)
  })

  connectEndpointSignals(kind, refresh)
  refresh()

  onCleanup(() => {
    disconnectDevice()
    dropdown.disconnect(selectedSignal)
  })

  return refresh
}

function setupSoundButton(button: Gtk.MenuButton, controls: SoundButtonControls) {
  let speaker = getDefaultEndpoint("speaker")
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
    speaker = getDefaultEndpoint("speaker")
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
  connectEndpointSignals("speaker", bindSpeaker)
  bindSpeaker()

  onCleanup(disconnectSpeaker)
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
      endpoint.connect("notify::device", update),
      endpoint.connect("notify::device-id", update),
      endpoint.connect("notify::id", update),
      endpoint.connect("notify::mute", update),
      endpoint.connect("notify::name", update),
      endpoint.connect("notify::volume", update),
      endpoint.connect("notify::volume-icon", update),
    ]
    update()
  }

  const sliderSignal = controls.slider.connect("notify::value", () => {
    if (!syncingSlider) setEndpointVolume(endpoint, controls.slider.value)
  })

  const muteSignal = controls.muteButton.connect("clicked", () => endpoint.set_mute(!endpoint.mute))
  const refreshProfiles = setupProfileDropdown(controls.profileRow, controls.profileDropdown, kind)

  setupDeviceDropdown(controls.dropdown, kind, refreshProfiles)
  connectEndpointSignals(kind, bindEndpoint)
  bindEndpoint()

  onCleanup(() => {
    disconnectEndpoint()
    controls.slider.disconnect(sliderSignal)
    controls.muteButton.disconnect(muteSignal)
  })
}

function DeviceDropdown({ onReady }: { onReady: (dropdown: SelectControl) => void }) {
  return <Select class="audio-device-select" hexpand onReady={onReady} />
}

function ProfileDropdown({ onReady }: { onReady: (dropdown: SelectControl) => void }) {
  return <Select class="audio-profile-select" hexpand onReady={onReady} />
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
      !controls.profileDropdown ||
      !controls.profileRow ||
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
      profileDropdown: controls.profileDropdown,
      profileRow: controls.profileRow,
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
      <box
        class="audio-profile-row"
        orientation={Gtk.Orientation.HORIZONTAL}
        visible={false}
        $={(row) => {
          controls = { ...controls, profileRow: row }
          maybeSetup()
        }}
      >
        <label class="audio-profile-title" xalign={0} label="Device profile" />
        <ProfileDropdown
          onReady={(dropdown) => {
            controls = { ...controls, profileDropdown: dropdown }
            maybeSetup()
          }}
        />
      </box>
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
  const [open, setOpen] = createState(false)
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
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
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
      <PanelPopover open={open} setOpen={setOpen}>
        {() => (
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
        )}
      </PanelPopover>
    </menubutton>
  )
}
