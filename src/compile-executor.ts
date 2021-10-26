import { BaseExecutor } from "./executor";
import { Script } from "./script";

export class CompileExecutor extends BaseExecutor {
    private parts: string[] = []
    compile(): string {
        return this.parts.join('\r\n\r\n')
    }

    async execute(script: Script) {
        this.parts.push(
            [
                `-- ${script.path}`,
                script.migration()
            ].join('\r\n\r\n')
        )
    }
    
}