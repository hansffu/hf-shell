declare module "ags/gtk4/jsx-runtime" {
  import Gtk from "gi://Gtk?version=4.0"

  type WidgetProps<T extends Gtk.Widget> = Record<string, unknown> & {
    $?: (self: T) => void
  }

  export namespace JSX {
    type Element = Gtk.Widget

    interface IntrinsicElements {
      box: WidgetProps<Gtk.Box>
      button: WidgetProps<Gtk.Button>
      centerbox: WidgetProps<Gtk.CenterBox>
      image: WidgetProps<Gtk.Image>
      label: WidgetProps<Gtk.Label>
      levelbar: WidgetProps<Gtk.LevelBar>
      menubutton: WidgetProps<Gtk.MenuButton>
      overlay: WidgetProps<Gtk.Overlay>
      popover: WidgetProps<Gtk.Popover>
      revealer: WidgetProps<Gtk.Revealer>
      scrolledwindow: WidgetProps<Gtk.ScrolledWindow>
      stack: WidgetProps<Gtk.Stack>
      switch: WidgetProps<Gtk.Switch>
      togglebutton: WidgetProps<Gtk.ToggleButton>
      window: WidgetProps<Gtk.Window>
    }
  }

  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element
  export const Fragment: unique symbol
}
