import { Script } from "./script";
import { ScriptManager } from "./script-manager";

export class DependencyResolver {
    constructor (
        readonly scriptManager: ScriptManager,
    ) {
    }

    private async _resolveDependencies(script: Script): Promise<Set<Script>> {
        const dependencies = new Set<Script>()
        for (const identity of script.dependencies()) {
            const paths = await this.scriptManager.resolve(identity, script.path)
            if (paths.length === 0) {
                throw new Error(`Couldn't resolve "${identity}" at "${script.path}"`)
            }
            for (const path of paths) {
                const dependency = await this.scriptManager.load(path);
                dependencies.add(dependency)
            }
        }
        return dependencies
    }

    private map: {
        [path: string]: Promise<Set<Script>>
    } = {}

    resolveDependencies(script: Script): Promise<Set<Script>> {
        return this.map[script.path] ??= this._resolveDependencies(script)
    }
}
