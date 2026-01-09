import { Bot, Context } from "./bot";
export type Scope = "private" | "group" | "all";

export interface Command {
    trigger: string | RegExp;
    scope: Scope;
    handler: (ctx: Context) => Promise<void> | void;
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
    commands?: Command[];
    listeners?: Listener[];
    messageHandlers?: MessageHandler[]; // 新增消息处理器
    config?: any; // 插件配置
    onLoad?: (bot: Bot) => void;
    onUnload?: () => void;
}
