import { createHash } from "crypto";
import { parseDirectives } from "./directive-parser";

interface ParsedScript {
    dependencies: string[]
    // version?: string
    migration: string
    revert?: string
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

    /*version(): string | undefined {
        return this.parse().version
    }*/

    dependencies(): readonly string[] {
        return this.parse().dependencies
    }

    migration(): string {
        return this.parse().migration
    }

    revert(): string | undefined {
        return this.parse().revert
    }

    private parsedScript: ParsedScript
    private parse(): ParsedScript {
        if (this.parsedScript) {
            return this.parsedScript
        }

        const content = this.content

        const directives = parseDirectives(content)
        
        const dependencies: string[] = directives.filter(
            ({command}) => command === 'require'
        ).map(
            ({args}) => args
        )

        /*const version = directives.find(
            ({command}) => command === 'version'
        )?.args*/

        const revertPos = directives.find(
            ({command}) => command === 'revert'
        )?.pos

        const migration = revertPos == undefined ? content : content.substring(0, revertPos.start)
        const revert = revertPos == undefined ? undefined : content.substring(revertPos.end)

        return {
            dependencies,
            // ...(version && {version}),
            migration,
            ...(revert && {revert}),
        }
    }
}
