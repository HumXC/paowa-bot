import path from "path";
import { Plugin, PluginSpec } from "./types";

export function definePlugin(plugin: PluginSpec): Plugin {
    return new Plugin(plugin);
}

export function cacheFile(filePath: string): string {
    return path.resolve(path.join(process.cwd(), process.env.CACHE_DIR || "cache", filePath));
}

export function dataFile(filePath: string): string {
    return path.resolve(path.join(process.cwd(), process.env.DATA_DIR || "data", filePath));
}
