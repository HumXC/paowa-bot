import { Command, Plugin, MessageHandler } from "../../core/types";
import { definePlugin } from "../../core/utils";
class Plug implements Plugin {
    config = {
        test_key: "test_value",
    };
    meta = {
        name: "example-plugin",
        version: "1.0.0",
        description: "A simple example plugin",
    };
    commands: Command[] = [
        {
            trigger: "ping",
            scope: "all",
            handler: async (ctx) => {
                const conf = this.config || {};
                const replyText = conf.test_key
                    ? `Pong! Config: ${conf.test_key}`
                    : "Pong! No config.";
                await ctx.reply.text(replyText).commit();
            },
        },
        {
            trigger: "私聊",
            scope: "private",
            handler: async (ctx) => {
                await ctx.reply.text("这是一个私聊专属指令").commit();
            },
        },
        {
            trigger: "群聊",
            scope: "group",
            handler: async (ctx) => {
                await ctx.reply.text(`群聊专属指令, Group ID: ${ctx.group_id}`).commit();
            },
        },
    ];
    messageHandlers: MessageHandler[] = [
        {
            scope: "all",
            handler: async (ctx) => {
                const msg = ctx.raw.raw_message || "";
                if (msg.includes("复读机")) {
                    const repl = msg.replace("复读机", "").trim();
                    if (repl.length > 0) {
                        await ctx.reply.text(repl).commit();
                        return true; // 拦截消息，不再处理后续 Handler
                    } else {
                        return false;
                    }
                }
                return false;
            },
        },
    ];
}
export default definePlugin(new Plug());
