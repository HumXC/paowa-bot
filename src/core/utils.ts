import path from "path";
import { Plugin } from "./types";

export function definePlugin(plugin: Plugin): Plugin {
    return plugin;
}

export function cacheFile(filePath: string): string {
    return path.join(process.cwd(), "cache", filePath);
}
