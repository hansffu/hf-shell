import { Gtk } from "ags/gtk4"
import { createEffect } from "gnim"
import type { Accessor } from "gnim"

type SelectProps = {
  class?: string
  hexpand?: boolean
  items: Accessor<string[]>
  selected: Accessor<number>
  sensitive?: boolean | Accessor<boolean>
  onSelect: (index: number) => void
}

type DropDownJsxProps = Partial<Gtk.DropDown.ConstructorProps> & {
  $?: (select: Gtk.DropDown) => void
  $constructor?: (props: Partial<Gtk.DropDown.ConstructorProps>) => Gtk.DropDown
  class?: string
  sensitive?: boolean | Accessor<boolean>
}

const DropDown = Gtk.DropDown as unknown as {
  new(props: DropDownJsxProps): Gtk.DropDown
}

export default function Select({
  class: className = "",
  hexpand = false,
  items,
  selected,
  sensitive = true,
  onSelect,
}: SelectProps) {
  const classes = ["shell-select", className].filter(Boolean).join(" ")

  return (
    <DropDown
      $constructor={() => Gtk.DropDown.new(null, null)}
      class={classes}
      hexpand={hexpand}
      sensitive={sensitive}
      showArrow
      $={(select: Gtk.DropDown) => {
        let syncing = false
        let labels: string[] = []

        for (const classPart of classes.split(" ")) select.add_css_class(classPart)

        // Replacing the model resets the selection, so model and selection are synced
        // together and the resulting notify::selected is not treated as user input.
        createEffect(() => {
          const nextLabels = items()
          const nextSelected = selected()

          syncing = true
          if (nextLabels.join("\n") !== labels.join("\n")) {
            labels = nextLabels
            select.set_model(Gtk.StringList.new(labels))
          }
          select.set_selected(nextSelected >= 0 ? nextSelected : 0)
          syncing = false
        })

        select.connect("notify::selected", () => {
          if (!syncing) onSelect(select.selected)
        })
      }}
    />
  )
}
