{
  description = "My Awesome Desktop Shell";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";

    ags = {
      url = "github:aylur/ags";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    astal-niri = {
      url = "github:sameoldlab/astal/feat/niri";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    ags,
    astal-niri,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    pname = "my-shell";
    entry = "app.ts";

    astalPackages = with ags.packages.${system}; [
      io
      astal4 # or astal3 for gtk3
      battery
      bluetooth
      notifd
      tray
      wireplumber
      astal-niri.packages.${system}.niri
    ];

    screenToolkitPackages = with pkgs; [
      curl
      ffmpeg
      gifski
      grim
      hyprpicker
      imagemagick
      jq
      libnotify
      satty
      slurp
      swappy
      tesseract
      wf-recorder
      wl-clipboard
      wl-screenrec
      xdg-utils
      zbar
      zenity
    ];

    bluetoothPackages = with pkgs; [
      blueman
      pulseaudio
    ];

    iconThemePackages = with pkgs; [
      adwaita-icon-theme
      hicolor-icon-theme
    ];

    extraPackages =
      astalPackages
      ++ screenToolkitPackages
      ++ bluetoothPackages
      ++ iconThemePackages
      ++ [
        pkgs.libadwaita
        pkgs.libsoup_3
      ];
  in {
    packages.${system} = {
      default = pkgs.stdenv.mkDerivation {
        name = pname;
        src = ./.;

        nativeBuildInputs = with pkgs; [
          wrapGAppsHook3
          gobject-introspection
          ags.packages.${system}.default
        ];

        buildInputs = extraPackages ++ [pkgs.gjs];

        preFixup = ''
          gappsWrapperArgs+=(
            --prefix PATH : "${pkgs.lib.makeBinPath (screenToolkitPackages ++ bluetoothPackages)}"
            --prefix XDG_DATA_DIRS : "${pkgs.lib.makeSearchPath "share" iconThemePackages}"
          )
        '';

        installPhase = ''
          runHook preInstall

          mkdir -p $out/bin
          mkdir -p $out/share
          cp -r * $out/share
          ags bundle ${entry} $out/bin/${pname} -d "SRC='$out/share'"

          runHook postInstall
        '';
      };
    };

    devShells.${system} = {
      default = pkgs.mkShell {
        buildInputs = [
          (ags.packages.${system}.default.override {
            inherit extraPackages;
          })
        ];

        shellHook = ''
          export XDG_DATA_DIRS="${pkgs.lib.makeSearchPath "share" iconThemePackages}:$XDG_DATA_DIRS"
        '';
      };
    };
  };
}
