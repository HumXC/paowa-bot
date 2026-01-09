import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import { Bot } from "./bot";

export class ConfigLoader {
    private bot: Bot;
    private configDir: string;
    private watcher: chokidar.FSWatcher | null = null;
    private configs: Map<string, any> = new Map();

    constructor(bot: Bot, configDir: string) {
        this.bot = bot;
        this.configDir = configDir;
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

    public start() {
        this.loadAll();
        this.watch();
    }

    public getConfig(pluginName: string, defaultConfig?: any): any {
        let config = this.configs.get(pluginName);
        if (!config && defaultConfig) {
            // 如果内存中没有配置，尝试加载文件
            const filePath = path.join(this.configDir, `${pluginName}.json`);
            if (fs.existsSync(filePath)) {
                this.loadConfig(filePath);
                config = this.configs.get(pluginName);
            } else {
                // 文件不存在，创建默认配置
                console.log(`Creating default config for ${pluginName}`);
                this.saveConfig(pluginName, defaultConfig);
                config = defaultConfig;
                this.configs.set(pluginName, config);
            }
        }

        // 合并默认配置（以防配置文件缺少某些字段）
        if (defaultConfig && config) {
            return { ...defaultConfig, ...config };
        }

        return config || {};
    }

    private loadAll() {
        if (!fs.existsSync(this.configDir)) return;
        const files = fs.readdirSync(this.configDir);
        for (const file of files) {
            if (file.endsWith(".json")) {
                this.loadConfig(path.join(this.configDir, file));
            }
        }
    }

    private saveConfig(pluginName: string, config: any) {
        try {
            const filePath = path.join(this.configDir, `${pluginName}.json`);
            fs.writeFileSync(filePath, JSON.stringify(config, null, 4)); // 4缩进
        } catch (err) {
            console.error(`Failed to save config for ${pluginName}:`, err);
        }
    }

    private watch() {
        this.watcher = chokidar.watch(this.configDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            depth: 0,
        });

        this.watcher
            .on("add", (filePath) => {
                console.log(`Config added: ${filePath}`);
                this.loadConfig(filePath);
            })
            .on("change", (filePath) => {
                console.log(`Config changed: ${filePath}`);
                this.reloadConfig(filePath);
            })
            .on("unlink", (filePath) => {
                console.log(`Config removed: ${filePath}`);
                this.removeConfig(filePath);
            });
    }

    private loadConfig(filePath: string) {
        try {
            const pluginName = path.basename(filePath, ".json");
            const content = fs.readFileSync(filePath, "utf-8");
            const config = JSON.parse(content);
            this.configs.set(pluginName, config);

            // 如果插件已经加载，更新插件配置
            const plugin = this.bot.plugins.get(pluginName);
            if (plugin) {
                plugin.config = config;
                console.log(`Updated config for plugin: ${pluginName}`);

                // 可选：触发插件的 reload 或其他生命周期，这里简单起见，可以尝试重新加载插件
                // 但重新加载插件逻辑在 PluginLoader 里，ConfigLoader 不好直接调
                // 暂时只更新内存中的 config 对象
                // 如果需要重新触发 onLoad，可能需要事件通知机制
                // 这里我们假设 PluginLoader 会监听 ConfigLoader 的变化，或者 ConfigLoader 通知 Bot

                // 简单实现：尝试调用 Bot 上的方法通知插件重载（如果 Bot 有这个能力）
                // 目前 Bot 没有 reloadPlugin 方法，但我们可以设计一个机制。
                // 为了题目要求的 "配置文件如果有变化需要重新加载插件"，
                // 我们应该通知 PluginLoader 去 reload 对应的插件。

                this.bot.reloadPlugin(pluginName);
            }
        } catch (err) {
            console.error(`Failed to load config ${filePath}:`, err);
        }
    }

    private reloadConfig(filePath: string) {
        this.loadConfig(filePath);
    }

    private removeConfig(filePath: string) {
        const pluginName = path.basename(filePath, ".json");
        this.configs.delete(pluginName);
        const plugin = this.bot.plugins.get(pluginName);
        if (plugin) {
            plugin.config = undefined;
            this.bot.reloadPlugin(pluginName);
        }
    }
}
