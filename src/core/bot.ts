import { NapLink, MessageEvent, PrivateMessageEvent, GroupMessageEvent } from "@naplink/naplink";
import {
    TextSegment,
    AtSegment,
    FaceSegment,
    ReplySegment,
    ImageSegment,
    RecordSegment,
    VideoSegment,
    FileSegment,
    JsonSegment,
    XmlSegment,
    MarkdownSegment,
} from "@naplink/naplink";
import { Command, Plugin, MessageHandler } from "./types";

export class Bot {
    public client: NapLink;
    public plugins: Map<string, Plugin> = new Map();
    public commands: Map<string, Command> = new Map();
    private messageHandlers: Map<string, MessageHandler[]> = new Map();
    public reloadPluginHandler?: (pluginName: string) => void;

    constructor() {
        this.client = new NapLink({
            connection: {
                url: process.env.NAPCAT_URL || "ws://localhost:3001",
                token: process.env.NAPCAT_TOKEN,
            },
        });

        this.setupListeners();
    }

    private setupListeners() {
        this.client.on("connect", () => {
            console.log("✅ Connected to NapCat");
        });

        this.client.on("disconnect", () => {
            console.log("❌ Disconnected from NapCat");
        });

        // 监听群消息
        this.client.on("message.group", async (data: any) => {
            const ctx = new Context(this.client, data, true);
            await this.handleMessage(ctx);
        });

        // 监听私聊消息
        this.client.on("message.private", async (data: any) => {
            const ctx = new Context(this.client, data, false);
            await this.handleMessage(ctx);
        });
    }

    private async handleMessage(ctx: Context) {
        const content = ctx.raw.raw_message || "";

        // 1. 优先匹配指令
        for (const [_, cmd] of this.commands) {
            let matched = false;
            if (typeof cmd.trigger === "string") {
                if (content.startsWith(cmd.trigger)) {
                    matched = true;
                }
            } else if (cmd.trigger instanceof RegExp) {
                if (cmd.trigger.test(content)) {
                    matched = true;
                }
            }

            if (matched) {
                if (cmd.scope === "private" && ctx.is_group) continue;
                if (cmd.scope === "group" && !ctx.is_group) continue;

                try {
                    await cmd.handler(ctx);
                    if (ctx.message.length > 0) {
                        throw new Error("Message not committed");
                    }
                } catch (e) {
                    console.error(`Error executing command:`, e);
                    ctx.reply.text(`执行指令出错: ${e}`).commit();
                }
                return;
            }
        }

        // 2. 如果没有匹配到指令，遍历所有插件的 messageHandlers
        for (const [pluginName, handlers] of this.messageHandlers) {
            for (const handlerObj of handlers) {
                if (handlerObj.scope === "private" && ctx.is_group) continue;
                if (handlerObj.scope === "group" && !ctx.is_group) continue;

                try {
                    // 如果处理器返回 true，则表示消息已被消费，停止后续处理
                    const intercepted = await handlerObj.handler(ctx);
                    if (intercepted === true) {
                        if (ctx.message.length > 0) {
                            throw new Error("Message not committed");
                        }
                        return;
                    }
                } catch (e) {
                    console.error(`Error executing message handler in plugin ${pluginName}:`, e);
                }
            }
        }
    }

    public registerPlugin(plugin: Plugin) {
        console.log(`Loading plugin: ${plugin.meta.name}`);

        if (plugin.onLoad) {
            plugin.onLoad(this);
        }

        if (plugin.commands) {
            plugin.commands.forEach((cmd) => {
                const key = `${plugin.meta.name}:${cmd.trigger.toString()}`;
                this.commands.set(key, cmd);
            });
        }

        if (plugin.messageHandlers) {
            this.messageHandlers.set(plugin.meta.name, plugin.messageHandlers);
        }

        this.plugins.set(plugin.meta.name, plugin);
    }

    public unregisterPlugin(pluginName: string) {
        const plugin = this.plugins.get(pluginName);
        if (!plugin) return;

        console.log(`Unloading plugin: ${pluginName}`);

        if (plugin.onUnload) {
            plugin.onUnload();
        }

        if (plugin.commands) {
            plugin.commands.forEach((cmd) => {
                const key = `${pluginName}:${cmd.trigger.toString()}`;
                this.commands.delete(key);
            });
        }

        if (plugin.messageHandlers) {
            this.messageHandlers.delete(pluginName);
        }

        this.plugins.delete(pluginName);
    }

    public async start() {
        console.log("Bot starting...");
        try {
            await this.client.connect();
        } catch (error) {
            console.error("Connection failed:", error);
        }
    }

    public reloadPlugin(pluginName: string) {
        if (this.reloadPluginHandler) {
            this.reloadPluginHandler(pluginName);
        }
    }
}
export type MessageSegment =
    | TextSegment
    | AtSegment
    | FaceSegment
    | ReplySegment
    | ImageSegment
    | RecordSegment
    | VideoSegment
    | FileSegment
    | JsonSegment
    | XmlSegment
    | MarkdownSegment;

export class Context {
    public client: NapLink;
    public raw: MessageEvent; // 原始事件数据
    public sender_id: number;
    public group_id: number;
    public is_group: boolean;
    constructor(client: NapLink, event: MessageEvent, isGroup: boolean) {
        const groupMessage = event as GroupMessageEvent;
        this.raw = event;
        this.sender_id = event.sender.user_id ?? 0;
        this.group_id = isGroup ? groupMessage.group_id : 0;
        this.is_group = isGroup;
        this.client = client;
    }
    public message: MessageSegment[] = [];

    public reply = {
        commit: async () => {
            let message: any = this.message;
            if (this.is_group) {
                await this.client.sendGroupMessage(this.group_id, message);
            } else {
                await this.client.sendPrivateMessage(this.sender_id, message);
            }
            this.message = [];
        },
        text: (content: string) => {
            const msg: TextSegment = {
                type: "text",
                data: {
                    text: content,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        at: (user_id: number) => {
            const msg: AtSegment = {
                type: "at",
                data: {
                    qq: user_id.toString(),
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        face: (id: number) => {
            const msg: FaceSegment = {
                type: "face",
                data: {
                    id: id.toString(),
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        image: (file: string, summary?: string, sub_type?: string) => {
            const msg: ImageSegment = {
                type: "image",
                data: {
                    file: file,
                    summary: summary,
                    sub_type: sub_type,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        record: (file: string) => {
            const msg: RecordSegment = {
                type: "record",
                data: {
                    file: file,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        video: (file: string) => {
            const msg: VideoSegment = {
                type: "video",
                data: {
                    file: file,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        file: (file: string, name?: string) => {
            const msg: FileSegment = {
                type: "file",
                data: {
                    file: file,
                    name: name,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        json: (json: any) => {
            const msg: JsonSegment = {
                type: "json",
                data: {
                    data: JSON.stringify(json),
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        xml: (xml: string) => {
            const msg: XmlSegment = {
                type: "xml",
                data: {
                    data: xml,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
        markdown: (content: string) => {
            const msg: MarkdownSegment = {
                type: "markdown",
                data: {
                    content: content,
                },
            };
            this.message.push(msg);
            return this.reply;
        },
    };
}
