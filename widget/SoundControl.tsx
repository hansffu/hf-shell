import { Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp"
import { createBinding, createComputed, createState } from "gnim"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"
import Select from "./Select"

const audio = AstalWp.get_default().get_audio()

// The default endpoints are stable proxies that follow whichever node is currently default.
const defaultEndpoints = {
  speaker: audio.get_default_speaker(),
  microphone: audio.get_default_microphone(),
}

type EndpointKind = keyof typeof defaultEndpoints

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function endpointLabel(endpoint: AstalWp.Endpoint) {
  return endpoint.description || endpoint.name || "Audio device"
}

function uniqueLabels<T extends { name: string }>(items: T[], label: (item: T) => string) {
  const labels = items.map(label)
  const counts = new Map<string, number>()

  for (const text of labels) counts.set(text, (counts.get(text) ?? 0) + 1)

  return labels.map((text, index) =>
    counts.get(text) === 1 ? text : `${text} (${items[index].name})`,
  )
}

function compareProfiles(left: AstalWp.Profile, right: AstalWp.Profile) {
  const availability = Number(right.available !== AstalWp.Available.NO) -
    Number(left.available !== AstalWp.Available.NO)

  if (availability !== 0) return availability

  return right.priority - left.priority
}

function setEndpointVolume(endpoint: AstalWp.Endpoint, value: number) {
  const next = Math.max(0, Math.min(1.5, value))

  if (Math.abs(endpoint.volume - next) > 0.005) endpoint.set_volume(next)
}

function iconName(icon: string, muted: boolean) {
  if (muted) return "audio-volume-muted-symbolic"
  if (icon.endsWith("-symbolic")) return icon
  return `${icon}-symbolic`
}

function DeviceDropdown({ kind }: { kind: EndpointKind }) {
  const defaultId = createBinding(defaultEndpoints[kind], "id")
  const endpoints = createBinding(audio, kind === "speaker" ? "speakers" : "microphones").as(
    (items: AstalWp.Endpoint[] | null) =>
      [...(items ?? [])].sort((left, right) =>
        endpointLabel(left).localeCompare(endpointLabel(right)),
      ),
  )
  const labels = createComputed(() => {
    const items = endpoints()

    for (const endpoint of items) createBinding(endpoint, "description")()

    return items.length > 0 ? uniqueLabels(items, endpointLabel) : ["No devices"]
  })
  const selected = createComputed(() => {
    const items = endpoints()
    const index = items.findIndex((endpoint) => endpoint.id === defaultId())

    return index >= 0 ? index : items.findIndex((endpoint) => endpoint.is_default)
  })

  return (
    <Select
      class="audio-device-select"
      hexpand
      items={labels}
      selected={selected}
      sensitive={endpoints.as((items) => items.length > 0)}
      onSelect={(index) => {
        const endpoint = endpoints()[index]

        if (endpoint && !endpoint.is_default) endpoint.set_is_default(true)
      }}
    />
  )
}

function ProfileRow({ endpoint }: { endpoint: AstalWp.Endpoint }) {
  const device = createBinding(endpoint, "device")
  const activeProfileId = createBinding<number | null>(endpoint, "device", "activeProfileId")
  const profiles = createBinding<AstalWp.Profile[] | null>(endpoint, "device", "profiles").as(
    (items) =>
      [...(items ?? [])]
        .filter((profile) => profile.available !== AstalWp.Available.NO)
        .sort(compareProfiles),
  )
  const showSwitcher = profiles.as((items) => items.length > 1)

  return (
    <box class="audio-profile-row" orientation={Gtk.Orientation.HORIZONTAL} visible={showSwitcher}>
      <label class="audio-profile-title" xalign={0} label="Device profile" />
      <Select
        class="audio-profile-select"
        hexpand
        items={profiles.as((items) =>
          items.length > 1
            ? uniqueLabels(items, (profile) => profile.description || profile.name)
            : ["No profile options"],
        )}
        selected={createComputed(() =>
          profiles().findIndex((profile) => profile.index === activeProfileId()),
        )}
        sensitive={showSwitcher}
        onSelect={(index) => {
          const profile = profiles()[index]
          const current = device()

          if (profile && current && profile.index !== current.active_profile_id) {
            current.set_active_profile_id(profile.index)
          }
        }}
      />
    </box>
  )
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
  const endpoint = defaultEndpoints[kind]
  const volume = createBinding(endpoint, "volume")
  const mute = createBinding(endpoint, "mute")
  const volumeIcon = createBinding(endpoint, "volumeIcon")
  const description = createBinding(endpoint, "description").as(() => endpointLabel(endpoint))

  return (
    <box class="audio-row" orientation={Gtk.Orientation.VERTICAL}>
      <box class="audio-row-header" orientation={Gtk.Orientation.HORIZONTAL}>
        <image
          iconName={createComputed(() => iconName(volumeIcon() || icon, mute()))}
          pixelSize={18}
          useFallback
        />
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="audio-row-title" xalign={0} label={title} />
          <label class="audio-row-device" xalign={0} label={description} />
        </box>
        <label class="audio-row-value" label={volume.as(percent)} />
        <button
          class={mute.as((muted) => (muted ? "audio-mute active" : "audio-mute"))}
          tooltipText={mute.as((muted) => (muted ? "Unmute" : "Mute"))}
          onClicked={() => endpoint.set_mute(!endpoint.mute)}
        >
          <image
            iconName={mute.as((muted) => (muted ? "audio-volume-muted-symbolic" : icon))}
            pixelSize={16}
            useFallback
          />
        </button>
      </box>
      <DeviceDropdown kind={kind} />
      <ProfileRow endpoint={endpoint} />
      <slider
        class="audio-slider"
        hexpand
        min={0}
        max={1.5}
        step={0.01}
        value={volume}
        onNotifyValue={(slider: { value: number }) => setEndpointVolume(endpoint, slider.value)}
      />
    </box>
  )
}

export default function SoundControl() {
  const [open, setOpen] = createState(false)
  const speaker = defaultEndpoints.speaker
  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")
  const volumeIcon = createBinding(speaker, "volumeIcon")

  return (
    <menubutton
      class="sound-control"
      direction={Gtk.ArrowType.RIGHT}
      tooltipText={createComputed(() => `${mute() ? "Muted" : "Volume"} ${percent(volume())}`)}
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
      $={(button: Gtk.MenuButton) => {
        const scroll = Gtk.EventControllerScroll.new(
          Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE,
        )

        scroll.connect("scroll", (_controller, _dx, dy) => {
          if (dy !== 0) setEndpointVolume(speaker, speaker.volume + (dy < 0 ? 0.05 : -0.05))
          return true
        })
        button.add_controller(scroll)
      }}
    >
      <box class="sound-control-content" orientation={Gtk.Orientation.VERTICAL}>
        <image
          iconName={createComputed(() => iconName(volumeIcon(), mute()))}
          pixelSize={17}
          useFallback
        />
        <label class="sound-control-percent" label={volume.as(percent)} />
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
