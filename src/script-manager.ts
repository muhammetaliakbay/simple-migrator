import { Script } from "./script";
import { join, isAbsolute, basename, relative } from "path";
import { stat, readFile, access } from "fs/promises"
import { constants } from "fs"
import { glob as globCb } from "glob"
import { promisify } from "util"

const glob = promisify(globCb)

function isFile(path: string): Promise<boolean> {
    return access(path, constants.R_OK).then(
        () => true,
        () => false,
    )
}

async function isSQLFile(path: string) {
    return path.toLowerCase().endsWith('.sql') && await isFile(path)
}

export class ScriptManager {
    constructor(
        readonly rootDir: string,
    ) {
    }

    private cache: {
        [path: string]: Promise<Script>
    } = {}

    private async loadInternal(path: string): Promise<Script> {
        const fullPath = join(this.rootDir, path);
        const content = await readFile(fullPath, 'utf-8');
        return new Script(path, content);
    }
    
    async resolve(identifier: string, caller?: string): Promise<string[]> {
        if (isAbsolute(identifier)) {
            throw new Error(`Invalid identifier: ${identifier}`)
        }

        let pattern: string;
        if (identifier.startsWith('.')) {
            if (caller == undefined) {
                throw new Error(`Relative identifier with no caller: ${identifier}`)
            }

            pattern = join(caller, '..', identifier);
        } else {
            pattern = identifier
        }
        
        pattern = join(this.rootDir, pattern)

        const patternPaths = [
            ...new Set<string>([
                ...await glob(pattern),
                ...await glob(pattern + '.sql')
            ])
        ]
        let paths: string[] = []

        for (const patternPath of patternPaths) {
            let path: string;
            if (await isSQLFile(path = patternPath)) {
                paths.push(path)
            } else if (await isSQLFile(path = join(patternPath, basename(patternPath) + '.sql'))) {
                paths.push(path)
            } else if (await isSQLFile(path = join(patternPath, 'index.sql'))) {
                paths.push(path)
            }
        }

        return paths.map(
            path => relative(this.rootDir, path)
        )
    }

    load(path: string): Promise<Script> {
        return this.cache[path] ??= this.loadInternal(path)
    }
}
