{
  bun2nix,
  pkgs,
  ...
}:
bun2nix.mkDerivation {
  pname = "paowa";
  version = "1.0.0";

  src = ./.;

  # nix run github:nix-community/bun2nix -- -o bun.nix
  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  # 1. 禁用默认的打包行为
  dontBuild = true;

  # 或者显式设置为空
  # buildPhase = "true";

  installPhase = ''
    mkdir -p $out/bin
    mkdir -p $out/lib/paowa

    # 2. 复制所有必要文件到 lib 目录
    # 注意：这里会包含 node_modules，因为 bun2nix 已经帮你安装好了
    cp -r . $out/lib/paowa

    # 3. 创建启动包装脚本
    cat > $out/bin/paowa <<EOF
    #!/bin/sh
    # 这里的 PATH 确保能找到 bun
    export PATH="${pkgs.bun}/bin:\$PATH"
    exec bun run src/cmd/paowa.ts "\$@"
    EOF

    chmod +x $out/bin/paowa
  '';
}
