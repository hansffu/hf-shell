import { Gtk } from "ags/gtk4"
import { createComputed, createState } from "gnim"
import {
  outputs,
  primaryOutputKey,
  primaryOutputSetting,
  setPrimaryOutputSetting,
} from "../service/Outputs"
import { PanelPopover } from "./LazyPopoverContent"
import Panel, { PanelSection } from "./Panel"
import Select from "./Select"

type PrimaryOutputOption = {
  connector: string | null
  label: string
}

function PrimaryOutputSelect() {
  const options = createComputed<PrimaryOutputOption[]>(() => {
    const connected = outputs()
    const setting = primaryOutputSetting()
    const current = connected.find((output) => output.key === primaryOutputKey())
    const automatic = {
      connector: null,
      label: !setting && current ? `Automatic (${current.label})` : "Automatic",
    }
    const choices = connected
      .filter((output) => output.connector)
      .map((output) => ({ connector: output.connector, label: output.label }))

    if (setting && !choices.some((option) => option.connector === setting)) {
      choices.push({ connector: setting, label: `${setting} (disconnected)` })
    }

    return [automatic, ...choices]
  })

  return (
    <box class="settings-row" orientation={Gtk.Orientation.HORIZONTAL}>
      <label class="settings-row-title" xalign={0} label="Primary monitor" />
      <Select
        class="settings-select"
        hexpand
        items={options.as((items) => items.map((option) => option.label))}
        selected={createComputed(() =>
          options().findIndex((option) => option.connector === primaryOutputSetting()),
        )}
        onSelect={(index) => {
          const option = options()[index]

          if (option && option.connector !== primaryOutputSetting()) {
            setPrimaryOutputSetting(option.connector)
          }
        }}
      />
    </box>
  )
}

export default function SettingsControl() {
  const [open, setOpen] = createState(false)

  return (
    <menubutton
      class="settings-control"
      direction={Gtk.ArrowType.RIGHT}
      tooltipText="Settings"
      onNotifyActive={(button: Gtk.MenuButton) => setOpen(button.active)}
    >
      <image iconName="emblem-system-symbolic" pixelSize={17} useFallback />
      <PanelPopover open={open} setOpen={setOpen}>
        {() => (
          <Panel title="Settings" class="settings-menu">
            <PanelSection title="Displays">
              <PrimaryOutputSelect />
            </PanelSection>
          </Panel>
        )}
      </PanelPopover>
    </menubutton>
  )
}
