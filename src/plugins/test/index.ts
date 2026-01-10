import { createCommand, definePlugin } from "@paowa-bot/core";
import { z } from "zod";

export default definePlugin({
    meta: {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin for command system",
    },
    commands: [
        createCommand({
            name: "ping",
            description: "Ping command",
            handler: async (ctx) => {
                ctx.reply.text("pong").commit();
            },
        }),
        createCommand({
            name: "echo <msg>",
            description: "Echo command",
            scope: "all",
            args: z.string(),
            handler: async (ctx, msg) => {
                ctx.reply.text(`Echo: ${msg}`).commit();
            },
        }),
    ],
});
