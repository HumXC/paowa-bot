import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import { Bot } from "./bot";
import { Plugin, PluginMeta, Scope } from "./types";
import { ConfigLoader } from "./config-loader";
import { Logger, withScope } from "./logger";

const scopeHierarchy: Record<Scope, number> = {
    private: 0,
    group: 1,
    all: 2,
};

function isScopeAllowed(pluginScope: Scope | undefined, commandScope: Scope | undefined): boolean {
    const p = pluginScope ?? "all";
    const c = commandScope ?? "all";
    return scopeHierarchy[c] <= scopeHierarchy[p];
}

export class PluginLoader {
    private bot: Bot;
    private pluginDir: string;
    private watcher: chokidar.FSWatcher | null = null;
    private configLoader: ConfigLoader;
    private logger: Logger;
    // 存储 pluginName -> fullPath
    private pluginPaths = new Map<string, string>();
    // 存储 fullPath -> pluginNames[] (一个文件可能包含多个插件)
    private pathRef = new Map<string, string[]>();
    constructor(bot: Bot, pluginDir: string, configLoader: ConfigLoader) {
        this.bot = bot;
        this.pluginDir = path.resolve(pluginDir);
        this.configLoader = configLoader;
        this.logger = withScope("PluginLoader");
    }

    public start() {
        this.loadAll();
        this.watch();
    }

    private loadAll() {
        const files = fs.readdirSync(this.pluginDir);
        for (const file of files) {
            if (
                file.endsWith(".ts") ||
                file.endsWith(".js") ||
                fs.statSync(path.join(this.pluginDir, file)).isDirectory()
            ) {
                this.loadPlugin(path.join(this.pluginDir, file));
            }
        }
        this.bot.registerCommand();
    }

    private watch() {
        this.watcher = chokidar.watch(this.pluginDir, {
            ignored: /(^|[\/\\])\../, // 忽略隐藏文件
            persistent: true,
            depth: 1, // 仅监听一层或两层
        });

        this.watcher
            .on("add", (filePath) => {
                this.logger.info(`File added: ${filePath}`);
                // 首次启动时 loadAll 已经加载过，这里需要防抖或者判断是否已加载
                // 实际上 chokidar 启动时会触发 add，需要处理
            })
            .on("change", (filePath) => {
                this.logger.info(`File changed: ${filePath}`);
                this.reloadPlugin(filePath);
            })
            .on("unlink", (filePath) => {
                this.logger.info(`File removed: ${filePath}`);
                this.unloadPlugin(filePath);
            });
    }
    private getFullPath(filePath: string): string | null {
        try {
            return require.resolve(filePath);
        } catch (e) {
            return null;
        }
    }

    private async loadPlugin(filePath: string) {
        const fullPath = this.getFullPath(filePath);
        if (!fullPath) {
            this.logger.error(`Cannot resolve path: ${filePath}`);
            return;
        }

        try {
            // 1. 无论是初次加载还是重载，都先清理该路径缓存
            delete require.cache[fullPath];

            // 2. 导入模块
            const module = require(fullPath);
            const exported = module.default || module;

            const plugins: Plugin[] = Array.isArray(exported) ? exported : [exported];
            const loadedPluginNames: string[] = [];

            for (const plugin of plugins) {
                // 3. 元数据校验
                if (!plugin.meta?.name) {
                    this.logger.error(`Invalid plugin at ${fullPath}: missing meta.name`);
                    continue;
                }

                const pluginName = plugin.meta.name;

                // 4. 检查是否已经存在同名插件（热重载安全防护）
                if (this.pluginPaths.has(pluginName)) {
                    this.bot.unregisterPlugin(pluginName, true);
                }

                // 4.1 验证命令 scope
                if (plugin.commands) {
                    const pluginScope = plugin.meta.scope;
                    for (const cmd of plugin.commands) {
                        const cmdScope = cmd.scope;
                        if (!isScopeAllowed(pluginScope, cmdScope)) {
                            this.logger.warn(
                                `Plugin ${pluginName}: command "${cmd.name}" has scope "${
                                    cmdScope ?? "all"
                                }" ` +
                                    `which is not allowed by plugin scope "${pluginScope ?? "all"}"`
                            );
                        }
                    }
                }

                // 5. 建立索引
                this.pluginPaths.set(pluginName, fullPath);
                loadedPluginNames.push(pluginName);

                // 6. 注入配置并注册
                plugin.config = this.configLoader.getConfig(pluginName, plugin.config);
                this.configLoader.syncConfig(pluginName, plugin.config);
                this.bot.registerPlugin(plugin);

                this.logger.success(`Successfully loaded: ${pluginName}`);
            }

            // 建立文件到多个插件名的映射
            this.pathRef.set(fullPath, loadedPluginNames);
        } catch (err) {
            this.logger.error(`Failed to load plugin from ${fullPath}:`, err);
        }
    }

    private unloadPlugin(filePath: string) {
        const fullPath = this.getFullPath(filePath);
        if (!fullPath) return;

        // 直接通过路径索引获取插件名列表，无需循环
        const pluginNames = this.pathRef.get(fullPath);

        if (pluginNames && pluginNames.length > 0) {
            for (const pluginName of pluginNames) {
                // 1. 调用 Bot 的注销逻辑
                this.bot.unregisterPlugin(pluginName);

                // 2. 清理内部映射记录
                this.pluginPaths.delete(pluginName);

                this.logger.info(`Unloaded: ${pluginName}`);
            }
            // 清理文件映射
            this.pathRef.delete(fullPath);
        } else {
            this.logger.info(`No active plugin linked to: ${fullPath}`);
        }

        // 无论是否匹配到插件名，都清理一次 require 缓存
        delete require.cache[fullPath];
    }
    private reloadPlugin(filePath: string) {
        this.unloadPlugin(filePath);
        this.loadPlugin(filePath);
        this.bot.registerCommand();
    }
}
