import { createHash } from "crypto";
import { Executor } from "./executor";

interface ParsedScript {
    dependencies: string[]
    version?: string
}

export class Script {
    constructor(
        readonly path: string,
        readonly content: string,
    ) {}

    private _hash: string;
    hash(): string {
        return this._hash ??= (
            createHash('sha1')
            .update(this.content)
            .digest()
            .toString('hex').toLowerCase()
        )
    }

    version(): string | undefined {
        return this.parse().version
    }

    dependencies(): readonly string[] {
        return this.parse().dependencies
    }

    private parsedScript: ParsedScript
    private parse(): ParsedScript {
        if (this.parsedScript) {
            return this.parsedScript
        }

        const content = this.content
        const lines = content.split(/\r?\n/)
        
        const dependencies: string[] = []
        const rest: {
            version?: string
        } = {}

        for (const line of lines) {
            const trim = line.trim()
            if (trim.startsWith('--')) {
                let comment = trim.substring(2).trim()
                if (comment.startsWith('#require ')) {
                    const identifier = comment.substring('#require '.length)
                    dependencies.push(identifier)
                } else if (comment.startsWith('#version ')) {
                    rest.version = comment.substring('#version '.length)
                }
            }
        }

        return {
            dependencies,
            ...rest,
        }
    }



    async execute(executor: Executor): Promise<void> {
        if (executor.executedScripts.has(this)) {
            return
        }
        executor.executedScripts.add(this);

        try {
            const {
                dependencies
            } = this.parse()
    
            for (const dependency of dependencies) {
                const paths = await executor.manager.resolve(
                    dependency,
                    this.path,
                )
                if (paths.length === 0) {
                    throw new Error(`No script found for the dependenct: ${dependency}`)
                }
                for (const path of paths) {
                    const dependencyScript = await executor.manager.load(path)
                    await dependencyScript.execute(executor)
                }
            }
    
            executor.execute(this)
        } catch (err) {
            throw new Error(`Error while execution ${this.path}: ${err?.message}`)
        }
    }
}
