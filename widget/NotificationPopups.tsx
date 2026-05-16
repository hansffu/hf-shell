import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createComputed, For } from "gnim"
import {
  hasPopups,
  popups,
  setPopupHover,
} from "../service/Notifications"
import type { NotificationPopup } from "../service/Notifications"
import { hasOsd, osdState } from "../service/Osd"
import NotificationCard from "./NotificationCard"

const hasOverlayPopups = createComputed(() => hasPopups() || hasOsd())

function PopupCard({ popup }: { popup: NotificationPopup }) {
  const progress = createComputed(() =>
    popup.timeoutMs === 0 ? 1 : popup.remainingMs() / popup.timeoutMs,
  )

  return (
    <NotificationCard
      class={`popup ${popup.urgency}`}
      notification={popup.notification}
      onHover={(hovered) => setPopupHover(popup.id, hovered)}
      progress={progress}
      showProgress={popup.timeoutMs > 0}
    />
  )
}

function OsdPopup() {
  const state = createComputed(() => osdState())
  const label = createComputed(() => {
    const current = state()

    if (!current) return ""
    return current.percent === undefined ? current.label : `${current.label} ${current.percent}%`
  })
  const value = createComputed(() => state()?.value ?? 0)
  const hasValue = createComputed(() => state()?.value !== undefined)

  return (
    <box
      class="shell-panel notification osd-popup normal"
      orientation={Gtk.Orientation.HORIZONTAL}
      widthRequest={384}
      visible={hasOsd}
    >
      <image
        class="osd-icon"
        iconName={createComputed(() => state()?.icon ?? "preferences-system-symbolic")}
        pixelSize={32}
        useFallback
      />
      <box class="osd-content" orientation={Gtk.Orientation.VERTICAL} hexpand>
        <box class="osd-header" orientation={Gtk.Orientation.HORIZONTAL}>
          <label class="notification-title" xalign={0} hexpand label={label} />
        </box>
        <levelbar
          class="osd-level"
          minValue={0}
          maxValue={1}
          value={value}
          visible={hasValue}
          hexpand
        />
      </box>
    </box>
  )
}

export default function NotificationPopups(gdkmonitor: Gdk.Monitor) {
  const { TOP, RIGHT } = Astal.WindowAnchor

  return (
    <window
      visible={hasOverlayPopups}
      name="notification-popups"
      class="Notifications"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | RIGHT}
      application={app}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <OsdPopup />
        <For each={popups}>{(popup) => <PopupCard popup={popup} />}</For>
      </box>
    </window>
  )
}
