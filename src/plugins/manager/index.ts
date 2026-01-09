import { Bot } from "../../core/bot";
import { Command, Plugin, MessageHandler } from "../../core/types";
import { ImageSegment, MessageSegment, TextSegment } from "@naplink/naplink";
import { cacheFile, definePlugin } from "../../core/utils";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "fs/promises";
import React from "react";
import path from "path";
import { PluginList } from "./plugin-list";
import { mkdir, mkdirSync } from "fs";

class Plug implements Plugin {
    bot: Bot = null as any;
    meta = {
        name: "manager",
        version: "1.0.0",
        description: "A simple example plugin",
    };
    config = {
        fontPath: null,
    };
    onLoad: (bot: Bot) => void = (ctx) => {
        this.bot = ctx;
    };
    commands: Command[] = [
        {
            trigger: "plugins",
            scope: "private",
            handler: async (ctx) => {
                let fontPath = cacheFile("MiSans-Regular.ttf");
                if (this.config.fontPath) {
                    fontPath = this.config.fontPath;
                } else {
                    const fontUrl =
                        "https://gh-proxy.org/https://github.com/dsrkafuu/misans/raw/refs/heads/main/raw/Normal/ttf/MiSans-Regular.ttf";
                    const res = await fetch(fontUrl);
                    const buffer = await res.bytes();
                    mkdirSync(path.dirname(fontPath), { recursive: true, mode: 0o755 });
                    await writeFile(fontPath, buffer, { mode: 0o644 });
                }

                const plugins = Array.from(this.bot.plugins.values());

                const fontData = await readFile(fontPath);
                const element = React.createElement(PluginList, { plugins });

                const svg = await satori(element, {
                    width: 600,
                    fonts: [
                        {
                            name: "Roboto Slab",
                            data: fontData,
                            weight: 400,
                            style: "normal",
                        },
                    ],
                });

                const resvg = new Resvg(svg);
                const pngData = resvg.render();
                const pngBuffer = pngData.asPng();

                // Convert buffer to base64
                const base64 = pngBuffer.toString("base64");

                await ctx.reply.image(`base64://${base64}`).commit();
            },
        },
    ];
}
export default definePlugin(new Plug());
