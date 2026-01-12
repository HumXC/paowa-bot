import { Bot, Context } from "./bot";

/**
 * 用户权限等级（从低到高）
 * - user: 普通用户，可执行基础命令
 * - admin: 管理员，可执行管理类命令
 * - owner: 所有者/群主，拥有最高权限
 */
export type PermissionLevel = "user" | "admin" | "owner";

/**
 * 消息作用域
 * - private: 仅私聊
 * - group: 仅群聊
 * - all: 私聊和群聊都可用
 *
 * 命令的 scope 必须是插件 scope 的子集。
 * 例如：插件 scope 为 all 时，命令可为 private/group/all
 *       插件 scope 为 group 时，命令只能为 group
 *       插件 scope 为 private 时，命令只能为 private
 */
export type Scope = "private" | "group" | "all";

/**
 * 命令权限配置
 *
 * 优先级（从高到低）：
 * 1. 全局黑名单（用户或群组）- 最高优先级，直接禁止
 * 2. 群组禁用（群组整体/插件/命令）- 群聊时检查
 * 3. 命令黑名单 - 禁止特定用户/群组使用命令
 * 4. 命令白名单 - 若设置，仅白名单内用户可执行
 * 5. 权限等级 - 用户等级需 >= 命令要求的等级
 * 6. 插件全局禁用
 * 7. 命令全局禁用
 * 8. 默认允许
 */
export interface CommandPermissionConfig {
    /** 权限等级要求 */
    level?: PermissionLevel;
    /** 允许的用户ID列表（白名单） */
    users?: number[];
    /** 允许的群组ID列表（白名单） */
    groups?: number[];
    /** 禁止的用户ID列表（黑名单） */
    blacklistedUsers?: number[];
    /** 禁止的群组ID列表（黑名单） */
    blacklistedGroups?: number[];
    /** 是否全局禁用该命令 */
    disabled?: boolean;
}

export interface MiddlewareMeta {
    type: "command" | "message";
    pluginName: string;
    commandName?: string;
    permission?: CommandPermissionConfig | PermissionLevel;
    args?: any;
}

export type BotMiddleware = (
    ctx: Context,
    meta: MiddlewareMeta,
    next: () => Promise<void>
) => Promise<void>;

export interface Listener {
    event: string;
    handler: (ctx: any) => Promise<void> | void;
}

export interface MessageHandler {
    scope: Scope;
    handler: (ctx: Context) => Promise<void | boolean> | void | boolean;
    permission?: CommandPermissionConfig;
}

export interface PluginMeta {
    name: string;
    version: string;
    description?: string;
    scope?: Scope;
}

export interface PluginSpec {
    meta: PluginMeta;
    commands?: Command<any>[];
    listeners?: Listener[];
    messageHandlers?: MessageHandler[];
    config?: any;
    onLoad?: (bot: Bot) => void;
    onUnload?: () => void;
}
export class Plugin implements PluginSpec {
    meta: PluginMeta;
    commands: Command<any>[];
    listeners: Listener[];
    messageHandlers: MessageHandler[];
    config?: any;
    onLoad?: ((bot: Bot) => void) | undefined;
    onUnload?: (() => void) | undefined;
    logger: Logger;

    constructor(spec: PluginSpec) {
        this.meta = spec.meta;
        this.commands = spec.commands ?? [];
        this.listeners = spec.listeners ?? [];
        this.messageHandlers = spec.messageHandlers ?? [];
        this.config = spec.config ?? undefined;
        this.onLoad = spec.onLoad ?? undefined;
        this.onUnload = spec.onUnload ?? undefined;
        this.logger = withScope(this.meta.name);
    }
}

export type Command<T> = {
    name: string;
    basename: string;
    root: string;
    description: string;
    args?: T;
    scope?: Scope;
    permission?: CommandPermissionConfig | PermissionLevel;
    handler: (ctx: Context, args: InferArgs<T>) => void | Promise<void>;
};

type InferArgs<T> = T extends any[]
    ? { [K in keyof T]: T[K] extends z.ZodType<any> ? z.infer<T[K]> : never }
    : T extends z.ZodType<any>
    ? z.infer<T>
    : undefined;

import { z } from "zod";
import { Logger, withScope } from "./logger";

export function createCommand<
    T extends z.ZodType<any> | [z.ZodType<any>, ...z.ZodType<any>[]] | undefined
>(cmd: Omit<Command<T>, "basename" | "root" | "logger">) {
    const defaultScope = cmd.scope ?? "all";

    let permission: CommandPermissionConfig | undefined;
    if (cmd.permission) {
        if (typeof cmd.permission === "string") {
            permission = { level: cmd.permission as PermissionLevel };
        } else {
            permission = cmd.permission;
        }
    }
    const basename = parseCommandBasename(cmd.name);
    return {
        ...cmd,
        basename,
        root: basename.split(" ")[0],
        scope: defaultScope,
        permission,
    } as Command<T>; // 强制断言回完整的 Command 类型
}

export function parseCommandBasename(name: string): string {
    if (!name) return "";

    // 正则表达式逻辑：
    // 1. \s+[\-\<\[].* : 匹配空格后跟着 - (选项), < (必选参数), 或 [ (可选参数)
    // 2. .* : 匹配后面所有的字符并将其替换为空
    const commandName = name.replace(/\s+([\-\<\[]).*/, "");

    return commandName.trim();
}
