import { Script } from "./script";
import { ScriptManager } from "./script-manager";

export interface Executor {
    manager: ScriptManager
    executedScripts: Set<Script>

    execute(script: Script): Promise<void>
}

export abstract class BaseExecutor {
    constructor (
        readonly manager: ScriptManager,
    ) {}

    readonly executedScripts: Set<Script> = new Set<Script>();

    abstract execute(script: Script): Promise<void>
}
