{pkgs, ...}:
pkgs.dockerTools.streamLayeredImage {
  name = "paowa";
  tag = "latest";
  contents = [
    pkgs.bun
    pkgs.coreutils
  ];
  config = {
    WorkingDir = "/app";
    Cmd = ["bun" "run" "src/cmd/paowa.ts"];
    Volumes = {
      "/plugins" = {};
      "/cache" = {};
      "/data" = {};
    };
    Env = [
      "BUN_INSTALL=/usr/local"
      "PLUGIN_DIR=/plugins"
      "CACHE_DIR=/cache"
      "DATA_DIR=/data"
      "NODE_ENV=production"
    ];
  };
  fakeRootCommands = ''
    mkdir -p $out/plugins $out/cache $out/data
    chmod 755 $out/plugins $out/cache $out/data
  '';
}
