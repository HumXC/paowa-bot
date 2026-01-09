import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import { Bot } from "./bot";
import { Plugin } from "./types";
import { ConfigLoader } from "./config_loader";

export class PluginLoader {
    private bot: Bot;
    private pluginDir: string;
    private watcher: chokidar.FSWatcher | null = null;
    private configLoader: ConfigLoader;
    // Map<PluginName, FilePath>
    private pluginPaths: Map<string, string> = new Map();

    constructor(bot: Bot, pluginDir: string, configLoader: ConfigLoader) {
        this.bot = bot;
        this.pluginDir = pluginDir;
        this.configLoader = configLoader;

        // 注册 Bot 的重载处理器
        this.bot.reloadPluginHandler = (pluginName: string) => {
            const filePath = this.pluginPaths.get(pluginName);
            if (filePath) {
                console.log(`Reloading plugin due to config change: ${pluginName}`);
                this.reloadPlugin(filePath);
            } else {
                console.warn(`Cannot reload plugin ${pluginName}: path not found`);
            }
        };
    }

    public start() {
        this.loadAll();
        this.watch();
    }

    private loadAll() {
        const files = fs.readdirSync(this.pluginDir);
        for (const file of files) {
            // 简单判断，只处理 .ts 文件或目录
            // 注意：编译后运行时是 .js，开发时是 .ts
            // 这里为了演示方便，假设直接运行 ts (如使用 bun)
            if (
                file.endsWith(".ts") ||
                fs.statSync(path.join(this.pluginDir, file)).isDirectory()
            ) {
                this.loadPlugin(path.join(this.pluginDir, file));
            }
        }
    }

    private watch() {
        this.watcher = chokidar.watch(this.pluginDir, {
            ignored: /(^|[\/\\])\../, // 忽略隐藏文件
            persistent: true,
            depth: 1, // 仅监听一层或两层
        });

        this.watcher
            .on("add", (filePath) => {
                console.log(`File added: ${filePath}`);
                // 首次启动时 loadAll 已经加载过，这里需要防抖或者判断是否已加载
                // 实际上 chokidar 启动时会触发 add，需要处理
            })
            .on("change", (filePath) => {
                console.log(`File changed: ${filePath}`);
                this.reloadPlugin(filePath);
            })
            .on("unlink", (filePath) => {
                console.log(`File removed: ${filePath}`);
                this.unloadPlugin(filePath);
            });
    }

    private async loadPlugin(filePath: string) {
        try {
            // 清除 require 缓存
            const resolvedPath = require.resolve(filePath);
            delete require.cache[resolvedPath];

            // 动态导入
            // 注意：使用 import() 也可以，但在 CommonJS 环境下 require 更方便清除缓存
            // Bun 环境下 import 也可以工作，但清除缓存可能需要特殊处理
            // 这里使用 require
            const module = require(filePath);
            const plugin: Plugin = module.default || module;

            if (!plugin.meta || !plugin.meta.name) {
                console.error(`Invalid plugin at ${filePath}: missing meta`);
                return;
            }

            // 将文件路径关联到插件名，以便后续卸载
            // 这里简化处理，假设 plugin.meta.name 是唯一的
            this.pluginPaths.set(plugin.meta.name, filePath);

            // 注入配置
            plugin.config = this.configLoader.getConfig(plugin.meta.name, plugin.config);

            this.bot.registerPlugin(plugin);
            console.log(`Plugin loaded: ${plugin.meta.name}`);
        } catch (err) {
            console.error(`Failed to load plugin ${filePath}:`, err);
        }
    }

    private unloadPlugin(filePath: string) {
        // 查找对应的插件名
        let pluginName = "";
        for (const [name, path] of this.pluginPaths) {
            if (path === filePath) {
                pluginName = name;
                break;
            }
        }

        if (pluginName) {
            this.bot.unregisterPlugin(pluginName);
            this.pluginPaths.delete(pluginName);

            // 清除 require 缓存
            try {
                const resolvedPath = require.resolve(filePath);
                delete require.cache[resolvedPath];
            } catch (e) {
                // ignore
            }
            console.log(`Plugin unloaded: ${pluginName}`);
        } else {
            // 如果没找到记录，可能是启动时加载出错没记录上，或者已经卸载
            // 尝试强制清除缓存
            try {
                const resolvedPath = require.resolve(filePath);
                delete require.cache[resolvedPath];
            } catch (e) {}
            console.log(`Unloading plugin from ${filePath} (Name unknown or already unloaded)`);
        }
    }

    private reloadPlugin(filePath: string) {
        this.unloadPlugin(filePath);
        this.loadPlugin(filePath);
    }
}
