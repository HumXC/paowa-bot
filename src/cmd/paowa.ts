#!/usr/bin/env bun
import "dotenv/config";
import * as path from "path";
import { Bot, PluginLoader, ConfigLoader } from "@paowa-bot/core";

async function main() {
    const bot = new Bot();

    // 插件目录
    const pluginDir = process.env.PLUGIN_DIR || path.join(process.cwd(), "plugins");
    // 配置目录
    const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), "config");

    const configLoader = new ConfigLoader(bot, configDir);
    configLoader.start();

    const loader = new PluginLoader(bot, pluginDir, configLoader);

    // 启动热重载加载器
    loader.start();

    // 启动机器人
    await bot.start();
}

main().catch(console.error);
