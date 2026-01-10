import {
    NapLink,
    MessageEvent,
    PrivateMessageEvent,
    GroupMessageEvent,
    Logger as NapLogger,
} from "@naplink/naplink";
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
import { PermissionManager } from "./permission";
import { breadc, type Breadc, ParseError } from "breadc";
import { z } from "zod";
import { Logger, withScope } from "./logger";
function parseCommandName(name: string): string {
    if (!name) return "";

    // 正则表达式逻辑：
    // 1. \s+[\-\<\[].* : 匹配空格后跟着 - (选项), < (必选参数), 或 [ (可选参数)
    // 2. .* : 匹配后面所有的字符并将其替换为空
    const commandName = name.replace(/\s+([\-\<\[]).*/, "");

    return commandName.trim();
}

export class Bot {
    public client: NapLink;
    public plugins: Map<string, Plugin> = new Map();
    public commands: Map<string, Command<any>> = new Map();
    public permission: PermissionManager;
    private messageHandlers: Map<string, MessageHandler[]> = new Map();
    private cli: Breadc;
    private logger: Logger;

    constructor() {
        this.permission = new PermissionManager();
        const logger = withScope("NapLink");
        this.logger = withScope("Bot");
        this.client = new NapLink({
            connection: {
                url: process.env.NAPCAT_URL || "ws://localhost:3001",
                token: process.env.NAPCAT_TOKEN,
            },
            logging: {
                logger: {
                    debug: function (message: string, ...meta: any[]): void {
                        logger.debug(message, ...meta);
                    },
                    info: function (message: string, ...meta: any[]): void {
                        logger.info(message, ...meta);
                    },
                    warn: function (message: string, ...meta: any[]): void {
                        logger.warn(message, ...meta);
                    },
                    error: function (message: string, error?: Error, ...meta: any[]): void {
                        logger.error(message, error, ...meta);
                    },
                },
            },
        });
        // 初始化 breadc
        this.cli = breadc("bot", {});
        this.setupListeners();
    }

    private setupListeners() {
        this.client.on("message.group", async (data) => {
            const ctx = new Context(this.client, data, true);
            await this.handleMessage(ctx);
        });

        this.client.on("message.private", async (data) => {
            const ctx = new Context(this.client, data, false);
            await this.handleMessage(ctx);
        });
    }

    private async handleMessage(ctx: Context) {
        const content = ctx.raw.raw_message?.trim() || "";
        if (!content) return;
        const argv = content.split(/\s+/);

        // 1. 尝试匹配命令
        try {
            // breadc.run 会直接返回 action 的 return 值
            const match = await this.cli.run(argv);

            // 如果 match 存在且包含我们定义的指令信息
            if (match && typeof match === "object" && "cmd" in match) {
                const { cmd, rawArgs } = match as { cmd: any; rawArgs: any[] };

                // 作用域检查
                if (cmd.scope === "private" && ctx.is_group) return;
                if (cmd.scope === "group" && !ctx.is_group) return;

                // 权限检查
                const hasPerm = this.permission.checkPermission(
                    ctx,
                    cmd.pluginName,
                    cmd.name,
                    cmd.permission
                );
                if (!hasPerm) return;

                // 参数校验与转换逻辑
                let validatedArgs: any;
                try {
                    if (Array.isArray(cmd.args)) {
                        // 如果定义的是元组/数组，逐个校验
                        validatedArgs = cmd.args.map((schema: any, i: number) =>
                            schema.parse(rawArgs[i])
                        );
                    } else if (cmd.args) {
                        // 如果定义的是单参数，直接校验第一个
                        validatedArgs = cmd.args.parse(rawArgs[0]);
                    }
                } catch (e) {
                    if (e instanceof z.ZodError) {
                        ctx.reply.text("Invalid arguments:");
                        for (const err of e.issues) {
                            ctx.reply.text(`\n- ${err.message}`);
                        }
                        await ctx.reply.commit();
                        return;
                    }
                    throw e;
                }

                // 执行 Handler
                this.logger.info(
                    `Executing command: ${cmd.name} ${
                        validatedArgs ? "args: " + JSON.stringify(validatedArgs) : ""
                    }`
                );
                await cmd.handler(ctx, validatedArgs);

                if (ctx.message.length > 0) {
                    await ctx.reply.commit();
                }
                return; // 命令已处理，直接返回
            }
        } catch (e) {
            if (e instanceof ParseError) {
                const name = parseCommandName(argv.join(" "));
                for (const [c, cmd] of this.commands) {
                    if (c === name) {
                        await ctx.reply.text(`Invalid command:\n${cmd.name}`).commit();
                        return;
                    }
                }
            }
            this.logger.error(e);
        }

        // 2. 遍历 MessageHandlers (逻辑保持不变)
        for (const [pluginName, handlers] of this.messageHandlers) {
            for (const handlerObj of handlers) {
                if (handlerObj.scope === "private" && ctx.is_group) continue;
                if (handlerObj.scope === "group" && !ctx.is_group) continue;

                try {
                    const intercepted = await handlerObj.handler(ctx);
                    if (intercepted === true) {
                        if (ctx.message.length > 0) await ctx.reply.commit();
                        return;
                    }
                } catch (e) {
                    this.logger.error(`Handler error in ${pluginName}:`, e);
                }
            }
        }
    }
    public registerCommand() {
        if (this.commands.size > 0) {
            this.logger.info("Registering commands...");
        } else {
            this.logger.info("Registering commands...");
        }

        // Breadc 不支持直接删除 command，需要重置并重新注册
        this.commands.clear();
        this.cli = breadc("bot");

        for (const [_, plugin] of this.plugins) {
            if (plugin.commands) {
                this.logger.info(`Registering commands from plugin: ${plugin.meta.name}`);
                plugin.commands.forEach((cmd) => {
                    const c = parseCommandName(cmd.name);
                    if (this.commands.has(c)) {
                        this.logger.warn(`Command ${cmd.name} already exists, skipping...`);
                        return;
                    }

                    this.logger.info(`- ${cmd.name}`);
                    this.logger.info(`  ${cmd.description}`);
                    this.commands.set(c, cmd);

                    // 将命令元数据包装
                    const fullCmd = { ...cmd, pluginName: plugin.meta.name };

                    // 注册到 breadc
                    // breadc 的 action 接收参数，最后一个通常是 options
                    this.cli.command(cmd.name, cmd.description).action((...args: any[]) => {
                        // 排除掉 breadc 自动添加的最后一个 options 对象
                        const rawArgs = args.slice(0, -1);
                        // 返回给 cli.run
                        return { cmd: fullCmd, rawArgs };
                    });
                });
            }
        }
    }

    public registerPlugin(plugin: Plugin, isReload: boolean = false) {
        if (!isReload) {
            this.logger.info(`Registering plugin: ${plugin.meta.name}`);
        }
        plugin.onLoad?.(this);

        if (plugin.messageHandlers) {
            this.messageHandlers.set(plugin.meta.name, plugin.messageHandlers);
        }
        this.plugins.set(plugin.meta.name, plugin);
    }

    public unregisterPlugin(pluginName: string, isReload: boolean = false) {
        if (!isReload) {
            this.logger.info(`Unregistering plugin: ${pluginName}`);
        }
        if (!this.plugins.has(pluginName)) return;
        const plugin = this.plugins.get(pluginName)!;
        plugin.onUnload?.();
        this.plugins.delete(pluginName);
        this.messageHandlers.delete(pluginName);
    }

    public async start() {
        this.logger.info("Bot starting...");
        try {
            await this.client.connect();
        } catch (error) {
            this.logger.error("Failed to connect:", error);
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
    public message: MessageSegment[] = [];
    private _isSending: boolean = false;
    public get reply() {
        const self = this;
        return {
            commit: async () => {
                if (self.message.length === 0 || self._isSending) return;

                self._isSending = true;
                try {
                    const msgCopy = [...self.message]; // 拷贝当前消息栈
                    self.message = []; // 立即清空，防止重发

                    if (self.is_group) {
                        await self.client.sendGroupMessage(self.group_id, msgCopy);
                    } else {
                        await self.client.sendPrivateMessage(self.sender_id, msgCopy);
                    }
                } finally {
                    self._isSending = false;
                }
            },
            text: (content: string) => {
                const msg: TextSegment = {
                    type: "text",
                    data: {
                        text: content,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            at: (user_id: number | null = null) => {
                if (!self.is_group) {
                    return self.reply;
                }
                const msg: AtSegment = {
                    type: "at",
                    data: {
                        qq: user_id ? user_id.toString() : self.sender_id.toString(),
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            face: (id: number) => {
                const msg: FaceSegment = {
                    type: "face",
                    data: {
                        id: id.toString(),
                    },
                };
                self.message.push(msg);
                return self.reply;
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
                self.message.push(msg);
                return self.reply;
            },
            record: (file: string) => {
                const msg: RecordSegment = {
                    type: "record",
                    data: {
                        file: file,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            video: (file: string) => {
                const msg: VideoSegment = {
                    type: "video",
                    data: {
                        file: file,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            file: (file: string, name?: string) => {
                const msg: FileSegment = {
                    type: "file",
                    data: {
                        file: file,
                        name: name,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            json: (json: any) => {
                const msg: JsonSegment = {
                    type: "json",
                    data: {
                        data: JSON.stringify(json),
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            xml: (xml: string) => {
                const msg: XmlSegment = {
                    type: "xml",
                    data: {
                        data: xml,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
            markdown: (content: string) => {
                const msg: MarkdownSegment = {
                    type: "markdown",
                    data: {
                        content: content,
                    },
                };
                self.message.push(msg);
                return self.reply;
            },
        };
    }
    constructor(client: NapLink, event: MessageEvent, isGroup: boolean) {
        const groupMessage = event as GroupMessageEvent;
        this.raw = event;
        this.sender_id = event.sender.user_id ?? 0;
        this.group_id = isGroup ? groupMessage.group_id : 0;
        this.is_group = isGroup;
        this.client = client;
    }
}
