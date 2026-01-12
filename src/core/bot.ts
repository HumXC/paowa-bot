import { NapLink, MessageEvent, GroupMessageEvent } from "@naplink/naplink";
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
import {
    Command,
    Plugin,
    MessageHandler,
    parseCommandBasename,
    BotMiddleware,
    MiddlewareMeta,
} from "./types";
import { breadc, type Breadc, ParseError } from "breadc";
import { z } from "zod";
import { Logger, withScope } from "./logger";

export class Bot {
    public client: NapLink;
    public plugins: Map<string, Plugin> = new Map();
    public commands: Map<string, Command<any>> = new Map();
    public pluginsDir: string;
    public configDir: string;
    private services: Map<string, any> = new Map();
    private middlewares: BotMiddleware[] = [];
    private messageHandlers: Map<string, MessageHandler[]> = new Map();
    private cli: Breadc;
    private logger: Logger;
    private __id: number = 0;
    private __nickname: string = "";
    public get id() {
        return this.__id;
    }
    public get nickname() {
        return this.__nickname;
    }

    constructor(pluginsDir: string, configDir: string) {
        this.pluginsDir = pluginsDir;
        this.configDir = configDir;
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
            ctx.is_at_self = this.isSelfMentioned(ctx);
            await this.handleMessage(ctx);
        });

        this.client.on("message.private", async (data) => {
            const ctx = new Context(this.client, data, false);
            await this.handleMessage(ctx);
        });
    }

    private isSelfMentioned(ctx: Context): boolean {
        const selfId = this.id;
        if (!selfId) return false;
        return ctx.message.some(
            (seg) => seg.type === "at" && (seg as any).data?.qq === selfId.toString()
        );
    }

    private async handleMessage(ctx: Context) {
        const selfId = this.id;

        // 从 message 段提取文本
        const messageTexts: string[] = ctx.message.map((seg) => {
            if (seg.type === "text") {
                return (seg as any).data?.text || "";
            }
            return seg.toString();
        });

        // Trim 首尾空白，并处理纯空白行
        let content = messageTexts.join(" ").trim();
        if (!content) return;

        // 如果开头是 @self，剔除
        if (ctx.is_at_self && ctx.message.length > 0) {
            const firstSeg = ctx.message[0];
            if (firstSeg.type === "at" && (firstSeg as AtSegment).data.qq === selfId.toString()) {
                content = messageTexts.slice(1).join(" ").trim();
                if (!content) return;
            }
        }

        const argv = content.split(/\s+/);

        // 1. 尝试匹配命令
        try {
            // breadc.run 会直接返回 action 的 return 值
            const match = await this.cli.run(argv);

            // 如果 match 存在且包含我们定义的指令信息
            if (match && typeof match === "object" && "cmd" in match) {
                const { cmd, rawArgs } = match as { cmd: any; rawArgs: any[] };

                // 作用域检查
                if (cmd.scope === "private" && ctx.is_group) {
                    ctx.reply.text("该命令仅限私聊使用").commit();
                    return;
                }
                if (cmd.scope === "group" && !ctx.is_group) {
                    ctx.reply.text("该命令仅限群聊使用").commit();
                    return;
                }

                const executeCommand = async () => {
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

                    if (ctx.reply_message.length > 0) {
                        await ctx.reply.commit();
                    }
                };

                const runMiddleware = async (
                    index: number,
                    meta: MiddlewareMeta,
                    next: () => Promise<void>
                ) => {
                    if (index < this.middlewares.length) {
                        await this.middlewares[index](ctx, meta, () =>
                            runMiddleware(index + 1, meta, next)
                        );
                    } else {
                        await next();
                    }
                };

                await runMiddleware(
                    0,
                    {
                        type: "command",
                        pluginName: cmd.pluginName,
                        commandName: cmd.name,
                        permission: cmd.permission,
                        args: rawArgs,
                    },
                    executeCommand
                );
                return; // 命令已处理，直接返回
            }
        } catch (e) {
            if (e instanceof ParseError) {
                const name = parseCommandBasename(argv.join(" "));
                for (const [fullName, cmd] of this.commands) {
                    if (fullName.startsWith(name)) {
                        await ctx.reply.text(`Invalid command:\n${cmd.name}`).commit();
                        return;
                    }
                }
            }
            if (e instanceof Error && e.message === "Unknown sub-command") {
                const cmds = [];
                for (const [c, cmd] of this.commands) {
                    if (cmd.root === argv[0]) {
                        cmds.push(" - " + cmd.name);
                    }
                }
                cmds.sort();
                await ctx.reply.text(`Usage:\n${cmds.join("\n")}`).commit();
                return;
            }
            this.logger.error(e);
        }

        // 2. 遍历 MessageHandlers
        const runMiddleware = async (
            index: number,
            meta: MiddlewareMeta,
            next: () => Promise<void>
        ) => {
            if (index < this.middlewares.length) {
                await this.middlewares[index](ctx, meta, () =>
                    runMiddleware(index + 1, meta, next)
                );
            } else {
                await next();
            }
        };

        for (const [pluginName, handlers] of this.messageHandlers) {
            for (const handlerObj of handlers) {
                if (handlerObj.scope === "private" && ctx.is_group) continue;
                if (handlerObj.scope === "group" && !ctx.is_group) continue;

                try {
                    await runMiddleware(
                        0,
                        {
                            type: "message",
                            pluginName: pluginName,
                            permission: handlerObj.permission,
                        },
                        async () => {
                            const intercepted = await handlerObj.handler(ctx);
                            if (intercepted === true) {
                                if (ctx.reply_message.length > 0) await ctx.reply.commit();
                                ctx.isHandled = true;
                            }
                        }
                    );

                    if (ctx.isHandled) return;
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
                    if (this.commands.has(cmd.name)) {
                        this.logger.warn(`Command ${cmd.name} already exists, skipping...`);
                        return;
                    }

                    this.logger.info(`- ${cmd.name}`);
                    this.logger.info(`  ${cmd.description}`);
                    this.commands.set(cmd.name, cmd);

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

    public registerService(name: string, service: any) {
        this.services.set(name, service);
        this.logger.info(`Service registered: ${name}`);
    }

    public getService<T>(name: string): T | undefined {
        return this.services.get(name);
    }

    public useMiddleware(middleware: BotMiddleware) {
        this.middlewares.push(middleware);
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
            const loginInfo = await this.client.getLoginInfo();
            this.__id = loginInfo.user_id;
            this.__nickname = loginInfo.nickname;
            this.logger.info(`Bot started with self ID: ${loginInfo.user_id}`);
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
    public is_at_self: boolean = false; // 消息是否 @ 了机器人
    public message: MessageSegment[] = [];
    public reply_message: MessageSegment[] = [];
    public isHandled: boolean = false;
    private _isSending: boolean = false;
    private _recallTimeout: number = -1;
    private _recallSenderTimeout: number = -1;

    public recallSender(timeout: number = 0) {
        this._recallSenderTimeout = timeout;
    }
    public get reply() {
        const self = this;
        return {
            commit: async () => {
                if (self.reply_message.length === 0 || self._isSending) return;
                var result: { message_id: number } = { message_id: 0 };
                self._isSending = true;
                try {
                    const msgCopy = [...self.reply_message]; // 拷贝当前消息栈
                    self.reply_message = []; // 立即清空，防止重发

                    if (self.is_group) {
                        result = await self.client.sendGroupMessage(self.group_id, msgCopy);
                    } else {
                        result = await self.client.sendPrivateMessage(self.sender_id, msgCopy);
                    }
                } finally {
                    self._isSending = false;
                    if (self._recallTimeout > 0 && result.message_id) {
                        setTimeout(() => {
                            self.client.deleteMessage(result.message_id);
                        }, self._recallTimeout);
                    }
                    if (self._recallSenderTimeout >= 0 && result.message_id) {
                        setTimeout(() => {
                            self.client.deleteMessage(self.raw.message_id);
                        }, self._recallSenderTimeout);
                    }
                }
            },
            recall: (timeout: number) => {
                self._recallTimeout = timeout;
            },
            text: (content: string) => {
                const msg: TextSegment = {
                    type: "text",
                    data: {
                        text: content,
                    },
                };
                self.reply_message.push(msg);
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
                self.reply_message.push(msg);
                return self.reply;
            },
            face: (id: number) => {
                const msg: FaceSegment = {
                    type: "face",
                    data: {
                        id: id.toString(),
                    },
                };
                self.reply_message.push(msg);
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
                self.reply_message.push(msg);
                return self.reply;
            },
            record: (file: string) => {
                const msg: RecordSegment = {
                    type: "record",
                    data: {
                        file: file,
                    },
                };
                self.reply_message.push(msg);
                return self.reply;
            },
            video: (file: string) => {
                const msg: VideoSegment = {
                    type: "video",
                    data: {
                        file: file,
                    },
                };
                self.reply_message.push(msg);
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
                self.reply_message.push(msg);
                return self.reply;
            },
            json: (json: any) => {
                const msg: JsonSegment = {
                    type: "json",
                    data: {
                        data: JSON.stringify(json),
                    },
                };
                self.reply_message.push(msg);
                return self.reply;
            },
            xml: (xml: string) => {
                const msg: XmlSegment = {
                    type: "xml",
                    data: {
                        data: xml,
                    },
                };
                self.reply_message.push(msg);
                return self.reply;
            },
            markdown: (content: string) => {
                const msg: MarkdownSegment = {
                    type: "markdown",
                    data: {
                        content: content,
                    },
                };
                self.reply_message.push(msg);
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
        this.message = event.message;
    }
}
