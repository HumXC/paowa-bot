{nixpkgs, bun2nix}:
final: prev: {
  bun2nix = bun2nix.packages.${final.system}.default;
}
