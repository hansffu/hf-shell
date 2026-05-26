import { Gtk } from "ags/gtk4"
import { With } from "gnim"
import { powerState } from "../service/Power"

export default function PowerControl() {
  return (
    <box class="power-control" visible={powerState.as((state) => state.available)}>
      <With value={powerState}>
        {(state) => (
          <box
            class={state.className}
            orientation={Gtk.Orientation.VERTICAL}
            tooltipText={state.tooltip}
          >
            <image iconName={state.iconName} pixelSize={17} useFallback />
            <label class="power-control-percent" label={state.label} />
          </box>
        )}
      </With>
    </box>
  )
}
