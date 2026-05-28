import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import AstalTray from "gi://AstalTray"
import { createBinding, createComputed, For, onCleanup } from "gnim"
import { setupPanelPopover } from "./PanelRevealer"

const tray = AstalTray.get_default()

function itemLabel(item: AstalTray.TrayItem) {
  return item.get_tooltip_text() || item.get_title() || item.get_id() || "Tray item"
}

function bindMenuActions(button: Gtk.Button, item: AstalTray.TrayItem) {
  const popover = Gtk.PopoverMenu.new_from_model(item.get_menu_model())
  const sync = () => button.insert_action_group("dbusmenu", item.get_action_group())
  const rightClick = Gtk.GestureClick.new()

  popover.set_parent(button)
  popover.add_css_class("shell-menu")
  setupPanelPopover(popover)
  sync()
  const menuSignal = item.connect("notify::menu-model", () => popover.set_menu_model(item.get_menu_model()))
  const actionSignal = item.connect("notify::action-group", sync)

  rightClick.set_button(3)
  rightClick.connect("pressed", () => {
    item.about_to_show()
    popover.popup()
  })
  button.add_controller(rightClick)

  onCleanup(() => {
    item.disconnect(menuSignal)
    item.disconnect(actionSignal)
    button.remove_controller(rightClick)
    popover.unparent()
  })
}

function TrayButton({ item }: { item: AstalTray.TrayItem }) {
  const icon = createBinding<Gio.Icon | null>(item, "gicon")
  const tooltipText = createBinding<string>(item, "tooltipText")
  const title = createBinding<string>(item, "title")
  const id = createBinding<string>(item, "id")
  const tooltip = createComputed(() => tooltipText() || title() || id() || "Tray item")

  return (
    <button
      class="tray-item"
      tooltipText={tooltip}
      onClicked={() => item.activate(0, 0)}
      $={(button: Gtk.Button) => bindMenuActions(button, item)}
    >
      <image gicon={icon} pixelSize={18} />
    </button>
  )
}

export default function SystemTray() {
  const items = createBinding(tray, "items").as((items: AstalTray.TrayItem[] | null) =>
    [...(items ?? [])].sort((left, right) => itemLabel(left).localeCompare(itemLabel(right))),
  )

  return (
    <box
      class="SystemTray"
      orientation={Gtk.Orientation.VERTICAL}
      visible={items.as((items) => items.length > 0)}
    >
      <For each={items}>{(item) => <TrayButton item={item} />}</For>
    </box>
  )
}
