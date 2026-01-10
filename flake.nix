{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = {
    nixpkgs,
    bun2nix,
    ...
  }: let
    forAllSystems = nixpkgs.lib.genAttrs [
      "aarch64-linux"
      "x86_64-linux"
    ];
  in {
    overlays = import ./nix/overlays.nix {inherit nixpkgs bun2nix;};
    devShells = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            sqlite
          ];
        };
      }
    );
    packages = forAllSystems (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        paowa = pkgs.callPackage ./nix/package.nix {
          inherit (bun2nix.packages.${system}) bun2nix;
        };
      in {
        default = paowa;
        paowa = paowa;
        dockerImage = pkgs.callPackage ./nix/docker.nix {inherit paowa;};
      }
    );
  };
}
