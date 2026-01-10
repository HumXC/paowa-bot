import { Bot, Context } from "./bot";
export type Scope = "private" | "group" | "all";

export type PermissionLevel = "user" | "admin" | "owner";

export interface PermissionConfig {
    level?: PermissionLevel;
    users?: number[]; // 白名单用户 ID
    groups?: number[]; // 白名单群组 ID
    blacklistedUsers?: number[]; // 黑名单用户 ID
    blacklistedGroups?: number[]; // 黑名单群组 ID
}

import { z } from "zod";

// 核心推导：如果是数组则映射推导，如果是单个 Zod 则直接推导，否则返回 undefined
type InferArgs<T> = T extends any[]
    ? { [K in keyof T]: T[K] extends z.ZodType<any> ? z.infer<T[K]> : never }
    : T extends z.ZodType<any>
    ? z.infer<T>
    : undefined;

export type Command<T> = {
    name: string;
    description: string;
    args?: T;
    scope?: string;
    permission?: string;
    // args 的类型现在由上面的 InferArgs 动态决定
    handler: (ctx: Context, args: InferArgs<T>) => void | Promise<void>;
};

export function createCommand<
    T extends z.ZodType<any> | [z.ZodType<any>, ...z.ZodType<any>[]] | undefined
>(cmd: Command<T>) {
    return {
        ...cmd,
        // 运行时我们将 args 统一，但在类型层面它们是分立的
        scope: cmd.scope ?? "all",
        permission: cmd.permission ?? "user",
    } as Command<T> & { scope: string; permission: string };
}

export interface Listener {
    event: string;
    handler: (ctx: any) => Promise<void> | void;
}

export interface PluginMeta {
    name: string;
    version: string;
    description?: string;
}

export interface MessageHandler {
    scope: Scope;
    handler: (ctx: Context) => Promise<void | boolean> | void | boolean; // 返回 true 表示拦截消息，不再继续处理
}

export interface Plugin {
    meta: PluginMeta;
    commands?: Command<any>[];
    listeners?: Listener[];
    messageHandlers?: MessageHandler[]; // 新增消息处理器
    config?: any; // 插件配置
    onLoad?: (bot: Bot) => void;
    onUnload?: () => void;
}
