import "dotenv/config";
import * as path from "path";
import { Bot } from "./core/bot";
import { PluginLoader } from "./core/loader";
import { ConfigLoader } from "./core/config_loader";

async function main() {
    const bot = new Bot();

    // 插件目录
    const pluginDir = path.join(__dirname, "plugins");
    // 配置目录
    const configDir = path.join(process.cwd(), "config");

    const configLoader = new ConfigLoader(bot, configDir);
    configLoader.start();

    const loader = new PluginLoader(bot, pluginDir, configLoader);

    // 启动热重载加载器
    loader.start();

    // 启动机器人
    await bot.start();
}

main().catch(console.error);
