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
        let config = this.configs.get(pluginName);
        if (!config && defaultConfig) {
            // 如果内存中没有配置，尝试加载文件
            const filePath = path.join(this.configDir, `${pluginName}.json`);
            if (fs.existsSync(filePath)) {
                this.loadConfig(filePath);
                config = this.configs.get(pluginName);
            } else {
                // 文件不存在，创建默认配置
                this.logger.info(
                    `Config file for ${pluginName} not found, creating default config`
                );
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
