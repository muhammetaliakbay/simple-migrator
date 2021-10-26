import { DependencyResolver } from "./dependency-resolver";
import { Script } from "./script";

export class OrderResolver implements Iterable<Script> {
    constructor (
        readonly dependencyResolver: DependencyResolver,
    ) {
    }

    private loads = new Set<Script>()
    private order: Script[] = []

    async resolveOrder(script: Script): Promise<void> {
        if (this.loads.has(script)) {
            return
        }
        this.loads.add(script)

        const dependencies = await this.dependencyResolver.resolveDependencies(script)
        for (const dependency of dependencies) {
            await this.resolveOrder(dependency)
        }

        this.order.push(script)
    }
    
    [Symbol.iterator](): Iterator<Script> {
        return this.order[Symbol.iterator]();
    }
}
