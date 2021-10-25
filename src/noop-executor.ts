import { BaseExecutor } from "./executor";
import { Script } from "./script";

export class NoopExecutor extends BaseExecutor {
    executionOrder: Script[] = []
    async execute(script: Script): Promise<void> {
        this.executionOrder.push(script)
    }
    
}