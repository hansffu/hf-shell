import { Gtk } from "ags/gtk4"

export type SelectControl = Gtk.DropDown

type SelectProps = {
  class?: string
  hexpand?: boolean
  onReady?: (select: SelectControl) => void
}

type DropDownJsxProps = Partial<Gtk.DropDown.ConstructorProps> & {
  $?: (select: Gtk.DropDown) => void
  $constructor?: (props: Partial<Gtk.DropDown.ConstructorProps>) => Gtk.DropDown
  class?: string
}

const DropDown = Gtk.DropDown as unknown as {
  new(props: DropDownJsxProps): Gtk.DropDown
}

export default function Select({
  class: className = "",
  hexpand = false,
  onReady,
}: SelectProps) {
  const classes = ["shell-select", className].filter(Boolean)

  return (
    <DropDown
      $constructor={() => Gtk.DropDown.new(null, null)}
      class={classes.join(" ")}
      hexpand={hexpand}
      showArrow
      $={(select: Gtk.DropDown) => {
        for (const classPart of classes.join(" ").split(" ").filter(Boolean)) {
          select.add_css_class(classPart)
        }
        onReady?.(select)
      }}
    />
  )
}
