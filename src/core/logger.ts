import { Signale, SignaleOptions, DefaultMethods } from "signale";

const options: SignaleOptions = {
    disabled: false,
    interactive: false,
    logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
    // 核心配置：开启时间戳
    config: {
        displayTimestamp: true,
        displayDate: true,
        underlinePrefix: false,
    },
};

const signale = new Signale(options);

export default signale.scope;

export type Logger = Signale;
export function withScope(scope: string): Logger {
    const logger = signale.scope(scope);
    // 覆盖 _logLevels getter
    Object.defineProperty(logger, "_logLevels", {
        get: () => ({
            debug: 0,
            timer: 2,
            info: 3,
            warn: 4,
            error: 5,
        }),
    });
    return logger;
}
