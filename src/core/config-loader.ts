import * as fs from "fs";
import * as path from "path";
import * as chokidar from "chokidar";
import { Bot } from "./bot";
import { Logger, withScope } from "./logger";

export class ConfigLoader {
    private bot: Bot;
    private configDir: string;
    private watcher: chokidar.FSWatcher | null = null;
    private configs: Map<string, any> = new Map();
    private logger: Logger;
    constructor(bot: Bot, configDir: string) {
        this.bot = bot;
        this.configDir = configDir;
        this.logger = withScope("ConfigLoader");
        this.logger.info(`Config directory: ${configDir}`);

        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

    public start() {
        this.loadAll();
        this.watch();
    }

    public getConfig(pluginName: string, defaultConfig?: any): any {
        if (defaultConfig === null || defaultConfig === undefined) {
            return this.configs.get(pluginName) || {};
        }

        let config = this.configs.get(pluginName);
        if (!config && defaultConfig) {
            const filePath = path.join(this.configDir, `${pluginName}.json`);
            if (fs.existsSync(filePath)) {
                this.loadConfig(filePath);
                config = this.configs.get(pluginName);
            } else {
                this.logger.info(
                    `Config file for ${pluginName} not found, creating default config`
                );
                this.saveConfig(pluginName, defaultConfig);
                config = defaultConfig;
                this.configs.set(pluginName, config);
            }
        }

        if (defaultConfig && config) {
            return { ...defaultConfig, ...config };
        }

        return config || {};
    }

    public syncConfig(pluginName: string, defaultConfig: any): void {
        if (defaultConfig === null || defaultConfig === undefined) {
            return;
        }

        const filePath = path.join(this.configDir, `${pluginName}.json`);

        if (!fs.existsSync(filePath)) {
            this.saveConfig(pluginName, defaultConfig);
            this.configs.set(pluginName, defaultConfig);
            this.logger.info(`Created config for ${pluginName}`);
            return;
        }

        const existingConfig = this.configs.get(pluginName);
        if (!existingConfig) {
            this.loadConfig(filePath);
        }

        const currentConfig = this.configs.get(pluginName) || {};
        const mergedConfig = this.deepMerge(defaultConfig, currentConfig);

        if (this.hasChanges(currentConfig, mergedConfig)) {
            this.saveConfig(pluginName, mergedConfig);
            this.configs.set(pluginName, mergedConfig);
            this.logger.info(`Synced config for ${pluginName}`);
        }
    }

    private deepMerge(target: any, source: any): any {
        const result = { ...target };

        for (const key of Object.keys(source)) {
            if (key in target && typeof target[key] === "object" && target[key] !== null && !Array.isArray(target[key])) {
                result[key] = this.deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }

        return result;
    }

    private hasChanges(original: any, merged: any): boolean {
        const originalStr = JSON.stringify(original, Object.keys(original).sort());
        const mergedStr = JSON.stringify(merged, Object.keys(merged).sort());
        return originalStr !== mergedStr;
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
            this.logger.error(`Failed to save config for ${pluginName}:`, err);
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
                this.logger.info(`Config added: ${filePath}`);
                this.loadConfig(filePath);
            })
            .on("change", (filePath) => {
                this.logger.info(`Config changed: ${filePath}`);
                this.reloadConfig(filePath);
            })
            .on("unlink", (filePath) => {
                this.logger.info(`Config removed: ${filePath}`);
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
                this.logger.info(`Updated config for plugin: ${pluginName}`);
            }
        } catch (err) {
            this.logger.error(`Failed to load config ${filePath}:`, err);
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
        }
    }
}
