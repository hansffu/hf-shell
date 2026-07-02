import { Gtk } from "ags/gtk4"
import { With } from "gnim"
import { powerState } from "../service/Power"

export default function PowerControl() {
  return (
    <box
      class="power-control"
      orientation={Gtk.Orientation.VERTICAL}
      visible={powerState.as((state) => state.available)}
    >
      <With value={powerState}>
        {(state) => (
          <box
            class={state.className}
            orientation={Gtk.Orientation.VERTICAL}
            tooltipText={state.tooltip}
          >
            <image iconName={state.iconName} pixelSize={17} halign={Gtk.Align.CENTER} useFallback />
            <label
              class="power-control-percent"
              halign={Gtk.Align.CENTER}
              justify={Gtk.Justification.CENTER}
              label={state.label}
            />
          </box>
        )}
      </With>
    </box>
  )
}
