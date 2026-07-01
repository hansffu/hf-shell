# just a bar ++ made for myself

## Theming

`hf-shell` loads bundled defaults, then watches `$XDG_CONFIG_HOME/hf-shell/config.toml` for runtime overrides. Set `HF_SHELL_THEME_CONFIG` to point at another TOML file.

The public theme contract is a small set of color roles:

```toml
[colors]
bg = "#1c1e24"
surface = "#1c1f24"
on_surface = "#bbc2cf"
border = "#3f444a"
fg = "#bbc2cf"
muted = "#7f8490"
primary = "#51afef"
secondary = "#c678dd"
danger = "#ff6c6b"
warning = "#e5c07b"
on_accent = "#1c1f24"
```

For Stylix/Home Manager, generate those roles from `config.lib.stylix.colors`:

```nix
{ config, lib, ... }:

let
  c = config.lib.stylix.colors;
  colors = {
    bg = c.base00;
    surface = c.base01;
    on_surface = c.base05;
    border = c.base03;
    fg = c.base05;
    muted = c.base04;
    primary = c.base0D;
    secondary = c.base0E;
    danger = c.base08;
    warning = c.base0A;
    on_accent = c.base00;
  };
  tomlColor = name: value: ''${name} = "#${value}"'';
in {
  xdg.configFile."hf-shell/config.toml".text = ''
    [colors]
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList tomlColor colors)}
  '';
}
```

Component states are derived inside the stylesheet. For example, active workspace uses `primary`, occupied workspace uses `secondary`, empty workspace uses transparent `secondary`, and hover colors are shaded from their base roles.
