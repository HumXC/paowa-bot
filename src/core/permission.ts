import { CommandPermissionConfig, PermissionLevel, Scope } from "./types";
import { Database } from "bun:sqlite";
import * as path from "path";
import * as fs from "fs";
import { Context } from "./bot";
import { Logger } from "@naplink/naplink";
import { withScope } from "./logger";

export class PermissionManager {
    private db: Database;
    private logger: Logger;
    private selfId: number = 0;

    constructor(selfId: number = 0) {
        this.selfId = selfId;
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
        this.db.run(`
            CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INTEGER PRIMARY KEY,
                level TEXT DEFAULT 'user'
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS global_blacklist (
                target_id INTEGER,
                type TEXT,
                PRIMARY KEY (target_id, type)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS plugin_permissions (
                plugin_name TEXT PRIMARY KEY,
                disabled INTEGER DEFAULT 0
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS command_permissions (
                plugin_name TEXT,
                command_name TEXT,
                disabled INTEGER DEFAULT 0,
                level TEXT,
                users TEXT,
                groups TEXT,
                blacklisted_users TEXT,
                blacklisted_groups TEXT,
                PRIMARY KEY (plugin_name, command_name)
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS group_permissions (
                group_id INTEGER,
                plugin_name TEXT,
                command_name TEXT,
                disabled INTEGER DEFAULT 0,
                PRIMARY KEY (group_id, plugin_name, command_name)
            )
        `);
    }

    public setSelfId(id: number): void {
        this.selfId = id;
    }

    private isSelf(userId: number): boolean {
        return this.selfId > 0 && userId === this.selfId;
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
        commandName: string,
        defaultPermission?: CommandPermissionConfig
    ): boolean {
        const userId = ctx.sender_id;
        const groupId = ctx.group_id;

        if (this.isSelf(userId)) {
            return true;
        }

        const isGroup = ctx.is_group;

        const levels: PermissionLevel[] = ["user", "admin", "owner"];

        let config = defaultPermission;

        if (isGroup) {
            const groupRow = this.db
                .query("SELECT disabled FROM group_permissions WHERE group_id = ? AND plugin_name IS NULL AND command_name IS NULL")
                .get(groupId) as any;
            if (groupRow?.disabled) return false;

            const groupPluginRow = this.db
                .query("SELECT disabled FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name IS NULL")
                .get(groupId, pluginName) as any;
            if (groupPluginRow?.disabled) return false;

            const groupCommandRow = this.db
                .query("SELECT disabled FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name = ?")
                .get(groupId, pluginName, commandName) as any;
            if (groupCommandRow?.disabled) return false;
        }

        const userBlacklisted = this.db
            .query("SELECT 1 FROM global_blacklist WHERE target_id = ? AND type = 'user'")
            .get(userId);
        if (userBlacklisted) return false;

        if (isGroup) {
            const groupBlacklisted = this.db
                .query("SELECT 1 FROM global_blacklist WHERE target_id = ? AND type = 'group'")
                .get(groupId);
            if (groupBlacklisted) return false;
        }

        const pluginRow = this.db
            .query("SELECT disabled FROM plugin_permissions WHERE plugin_name = ?")
            .get(pluginName) as any;
        if (pluginRow?.disabled) return false;

        const commandRow = this.db
            .query("SELECT * FROM command_permissions WHERE plugin_name = ? AND command_name = ?")
            .get(pluginName, commandName) as any;
        if (commandRow) {
            if (commandRow.disabled) return false;

            if (commandRow.blacklisted_users) {
                const blacklistedUsers = JSON.parse(commandRow.blacklisted_users);
                if (blacklistedUsers.includes(userId)) return false;
            }
            if (isGroup && commandRow.blacklisted_groups) {
                const blacklistedGroups = JSON.parse(commandRow.blacklisted_groups);
                if (blacklistedGroups.includes(groupId)) return false;
            }

            if (commandRow.users) {
                const users = JSON.parse(commandRow.users);
                if (!users.includes(userId)) return false;
            }
            if (isGroup && commandRow.groups) {
                const groups = JSON.parse(commandRow.groups);
                if (!groups.includes(groupId)) return false;
            }

            if (commandRow.level) {
                const userLevel = this.getUserLevel(userId);
                const requiredLevel = commandRow.level as PermissionLevel;
                if (levels.indexOf(userLevel) < levels.indexOf(requiredLevel)) {
                    return false;
                }
            }
        }

        if (config) {
            if (config.disabled) return false;

            if (config.blacklistedUsers?.includes(userId)) return false;
            if (isGroup && config.blacklistedGroups?.includes(groupId)) return false;

            if (config.users && config.users.length > 0) {
                if (!config.users.includes(userId)) return false;
            }
            if (isGroup && config.groups && config.groups.length > 0) {
                if (!config.groups.includes(groupId)) return false;
            }

            if (config.level) {
                const userLevel = this.getUserLevel(userId);
                if (levels.indexOf(userLevel) < levels.indexOf(config.level)) {
                    return false;
                }
            }
        }

        return true;
    }

    public addOwner(userId: number) {
        if (this.isSelf(userId)) return;
        this.db.run(
            "INSERT OR REPLACE INTO user_permissions (user_id, level) VALUES (?, 'owner')",
            [userId]
        );
    }

    public removeOwner(userId: number) {
        this.db.run("DELETE FROM user_permissions WHERE user_id = ? AND level = 'owner'", [userId]);
    }

    public listOwners(): number[] {
        return (this.db.query(
            "SELECT user_id FROM user_permissions WHERE level = 'owner'"
        ) as unknown as any[]).map((row) => row.user_id as number);
    }

    public addAdmin(userId: number) {
        if (this.isSelf(userId)) return;
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

    public addToGlobalBlacklist(targetId: number, type: "user" | "group") {
        if (type === "user" && this.isSelf(targetId)) return;
        this.db.run("INSERT OR IGNORE INTO global_blacklist (target_id, type) VALUES (?, ?)", [
            targetId,
            type,
        ]);
    }

    public removeFromGlobalBlacklist(targetId: number, type: "user" | "group") {
        this.db.run("DELETE FROM global_blacklist WHERE target_id = ? AND type = ?", [
            targetId,
            type,
        ]);
    }

    public isBlacklisted(targetId: number, type: "user" | "group"): boolean {
        const result = this.db
            .query("SELECT 1 FROM global_blacklist WHERE target_id = ? AND type = ?")
            .get(targetId, type);
        return !!result;
    }

    public disablePlugin(pluginName: string) {
        this.db.run(
            "INSERT OR REPLACE INTO plugin_permissions (plugin_name, disabled) VALUES (?, 1)",
            [pluginName]
        );
    }

    public enablePlugin(pluginName: string) {
        this.db.run("DELETE FROM plugin_permissions WHERE plugin_name = ?", [pluginName]);
    }

    public isPluginDisabled(pluginName: string): boolean {
        const result = this.db
            .query("SELECT 1 FROM plugin_permissions WHERE plugin_name = ? AND disabled = 1")
            .get(pluginName);
        return !!result;
    }

    public disableCommand(pluginName: string, commandName: string) {
        this.db.run(
            "INSERT OR REPLACE INTO command_permissions (plugin_name, command_name, disabled) VALUES (?, ?, 1)",
            [pluginName, commandName]
        );
    }

    public enableCommand(pluginName: string, commandName: string) {
        this.db.run(
            "DELETE FROM command_permissions WHERE plugin_name = ? AND command_name = ?",
            [pluginName, commandName]
        );
    }

    public setCommandPermission(pluginName: string, commandName: string, config: CommandPermissionConfig) {
        if (this.selfId > 0) {
            if (config.users?.includes(this.selfId)) {
                config.users = config.users.filter((id: number) => id !== this.selfId);
            }
            if (config.blacklistedUsers?.includes(this.selfId)) {
                config.blacklistedUsers = config.blacklistedUsers.filter((id: number) => id !== this.selfId);
            }
        }
        this.db.run(
            `INSERT OR REPLACE INTO command_permissions 
            (plugin_name, command_name, disabled, level, users, groups, blacklisted_users, blacklisted_groups) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pluginName,
                commandName,
                config.disabled ? 1 : 0,
                config.level || null,
                config.users ? JSON.stringify(config.users) : null,
                config.groups ? JSON.stringify(config.groups) : null,
                config.blacklistedUsers ? JSON.stringify(config.blacklistedUsers) : null,
                config.blacklistedGroups ? JSON.stringify(config.blacklistedGroups) : null,
            ]
        );
    }

    public disableGroupPlugin(groupId: number, pluginName: string) {
        this.db.run(
            "INSERT OR REPLACE INTO group_permissions (group_id, plugin_name, command_name, disabled) VALUES (?, ?, NULL, 1)",
            [groupId, pluginName]
        );
    }

    public enableGroupPlugin(groupId: number, pluginName: string) {
        this.db.run(
            "DELETE FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name IS NULL",
            [groupId, pluginName]
        );
    }

    public disableGroupCommand(groupId: number, pluginName: string, commandName: string) {
        this.db.run(
            "INSERT OR REPLACE INTO group_permissions (group_id, plugin_name, command_name, disabled) VALUES (?, ?, ?, 1)",
            [groupId, pluginName, commandName]
        );
    }

    public enableGroupCommand(groupId: number, pluginName: string, commandName: string) {
        this.db.run(
            "DELETE FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name = ?",
            [groupId, pluginName, commandName]
        );
    }

    public disableGroup(groupId: number) {
        this.db.run(
            "INSERT OR REPLACE INTO group_permissions (group_id, plugin_name, command_name, disabled) VALUES (?, NULL, NULL, 1)",
            [groupId]
        );
    }

    public enableGroup(groupId: number) {
        this.db.run(
            "DELETE FROM group_permissions WHERE group_id = ? AND plugin_name IS NULL AND command_name IS NULL",
            [groupId]
        );
    }

    public isGroupDisabled(groupId: number): boolean {
        const result = this.db
            .query("SELECT 1 FROM group_permissions WHERE group_id = ? AND plugin_name IS NULL AND command_name IS NULL AND disabled = 1")
            .get(groupId);
        return !!result;
    }

    public isGroupPluginDisabled(groupId: number, pluginName: string): boolean {
        const result = this.db
            .query("SELECT 1 FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name IS NULL AND disabled = 1")
            .get(groupId, pluginName);
        return !!result;
    }

    public isGroupCommandDisabled(groupId: number, pluginName: string, commandName: string): boolean {
        const result = this.db
            .query("SELECT 1 FROM group_permissions WHERE group_id = ? AND plugin_name = ? AND command_name = ? AND disabled = 1")
            .get(groupId, pluginName, commandName);
        return !!result;
    }
}
