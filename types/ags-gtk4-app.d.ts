declare module "ags/gtk4/app" {
  import Gdk from "gi://Gdk?version=4.0"
  import Gtk from "gi://Gtk?version=4.0"

  type StartOptions = {
    css?: string
    main(): void
  }

  const app: {
    start(options: StartOptions): void
    get_monitors(): Gdk.Monitor[]
    get_window(name: string): Gtk.Window | null
    toggle_window(name: string): void
  }

  export default app
}
