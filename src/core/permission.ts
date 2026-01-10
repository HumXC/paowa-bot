import { PermissionConfig, PermissionLevel } from "./types";
import { Database } from "bun:sqlite";
import * as path from "path";
import * as fs from "fs";
import { Context } from "./bot";
import { Logger } from "@naplink/naplink";
import { withScope } from "./logger";

export class PermissionManager {
    private db: Database;
    private logger: Logger;

    constructor() {
        const dbPath = path.join(process.cwd(), "data", "permissions.sqlite");
        const dir = path.dirname(dbPath);
        this.logger = withScope("PermissionManager");
        this.logger.info(`Using permission database: ${dbPath}`);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.initDb();
    }

    private initDb() {
        // 用户权限表
        this.db.run(`
            CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INTEGER PRIMARY KEY,
                level TEXT DEFAULT 'user'
            )
        `);

        // 全局黑名单表
        this.db.run(`
            CREATE TABLE IF NOT EXISTS global_blacklist (
                target_id INTEGER PRIMARY KEY,
                type TEXT -- 'user' or 'group'
            )
        `);

        // 插件命令权限表 (存储 JSON 配置)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS command_permissions (
                plugin_name TEXT,
                trigger TEXT,
                config TEXT,
                PRIMARY KEY (plugin_name, trigger)
            )
        `);
    }

    public getUserLevel(userId: number): PermissionLevel {
        const row = this.db
            .query("SELECT level FROM user_permissions WHERE user_id = ?")
            .get(userId) as any;
        return row ? (row.level as PermissionLevel) : "user";
    }

    public checkPermission(
        ctx: Context,
        pluginName: string,
        commandTrigger: string,
        defaultPermission?: PermissionConfig
    ): boolean {
        const userId = ctx.sender_id;
        const groupId = ctx.group_id;

        // 1. 全局黑名单检查
        const blacklistedUser = this.db
            .query("SELECT 1 FROM global_blacklist WHERE target_id = ? AND type = 'user'")
            .get(userId);
        if (blacklistedUser) return false;

        if (ctx.is_group) {
            const blacklistedGroup = this.db
                .query("SELECT 1 FROM global_blacklist WHERE target_id = ? AND type = 'group'")
                .get(groupId);
            if (blacklistedGroup) return false;
        }

        // 2. 获取生效的权限配置 (持久化配置优先于插件默认配置)
        let config = defaultPermission;
        const row = this.db
            .query("SELECT config FROM command_permissions WHERE plugin_name = ? AND trigger = ?")
            .get(pluginName, commandTrigger) as any;
        if (row) {
            try {
                config = JSON.parse(row.config);
            } catch (e: any) {
                this.logger.error("Failed to parse command permission config:", e);
            }
        }

        if (!config) return true; // 无限制

        // 3. 黑名单检查
        if (config.blacklistedUsers?.includes(userId)) return false;
        if (ctx.is_group && config.blacklistedGroups?.includes(groupId)) return false;

        // 4. 白名单检查
        if (config.users && config.users.length > 0) {
            if (!config.users.includes(userId)) return false;
        }
        if (ctx.is_group && config.groups && config.groups.length > 0) {
            if (!config.groups.includes(groupId)) return false;
        }

        // 5. 等级检查
        if (config.level) {
            const userLevel = this.getUserLevel(userId);
            const levels: PermissionLevel[] = ["user", "admin", "owner"];
            if (levels.indexOf(userLevel) < levels.indexOf(config.level)) {
                return false;
            }
        }

        return true;
    }

    // 管理接口
    public addOwner(userId: number) {
        this.db.run(
            "INSERT OR REPLACE INTO user_permissions (user_id, level) VALUES (?, 'owner')",
            [userId]
        );
    }
    public removeOwner(userId: number) {
        this.db.run("DELETE FROM user_permissions WHERE user_id = ? AND level = 'owner'", [userId]);
    }
    public listOwners(): number[] {
        return (
            this.db.query(
                "SELECT user_id FROM user_permissions WHERE level = 'owner'"
            ) as unknown as any[]
        ).map((row) => row.user_id as number);
    }

    public addAdmin(userId: number) {
        this.db.run(
            "INSERT OR REPLACE INTO user_permissions (user_id, level) VALUES (?, 'admin')",
            [userId]
        );
    }
    public removeAdmin(userId: number) {
        this.db.run("DELETE FROM user_permissions WHERE user_id = ? AND level = 'admin'", [userId]);
    }
    public listAdmins(): number[] {
        const rows = this.db
            .query("SELECT user_id FROM user_permissions WHERE level = 'admin'")
            .values();
        return rows.map((row) => row[0] as number);
    }

    public setCommandPermission(pluginName: string, trigger: string, config: PermissionConfig) {
        this.db.run(
            "INSERT OR REPLACE INTO command_permissions (plugin_name, trigger, config) VALUES (?, ?, ?)",
            [pluginName, trigger, JSON.stringify(config)]
        );
    }

    public addToGlobalBlacklist(targetId: number, type: "user" | "group") {
        this.db.run("INSERT OR IGNORE INTO global_blacklist (target_id, type) VALUES (?, ?)", [
            targetId,
            type,
        ]);
    }
}
