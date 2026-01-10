{
  pkgs,
  paowa,
  ...
}:
pkgs.dockerTools.streamLayeredImage {
  name = "paowa";
  tag = "latest";

  contents = [
    pkgs.bashInteractive
    pkgs.coreutils
    paowa
  ];

  config = {
    WorkingDir = "/app";
    # 建议使用绝对路径确保万无一失
    Cmd = ["/bin/paowa"];

    Volumes = {
      "/app/plugins" = {}; # 建议挂载在 /app 下，方便相对路径读写
      "/app/cache" = {};
      "/app/data" = {};
    };

    Env = [
      "NODE_ENV=production"
      "PLUGIN_DIR=/app/plugins"
      "CACHE_DIR=/app/cache"
      "DATA_DIR=/app/data"
    ];
  };

  # 3. 在镜像构建时预设权限（如果需要以非 root 运行）
  fakeRootCommands = ''
    mkdir -p $out/app/plugins $out/app/cache $out/app/data
    chmod 1777 $out/app/plugins $out/app/cache $out/app/data
  '';
}
