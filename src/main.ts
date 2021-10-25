#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { readFile } from 'fs/promises'
import { ScriptManager } from './script-manager'
import { Executor } from './executor'

import { hasMagic, sync } from "glob"
import { join, relative } from "path"
import { NoopExecutor } from './noop-executor'
import { CompileExecutor } from './compile-executor'
import { Client, Pool } from 'pg'
import { PGExecutor } from './pg-executor'

interface Connection {
    host: string,
    port?: number,
    db: string,
    user: string,
    password: string,
}

interface Config {
    rootDir: string,
    connections: {
        [name: string]: Connection
    }
}

async function parseConfig(path: string): Promise<Config> {
    const content = await readFile(path, 'utf-8')
    const object = JSON.parse(content)
    if (typeof object !== 'object' || Array.isArray(object)) {
        throw new Error('Config must be an object')
    }

    let rootDir = object.rootDir
    if (typeof rootDir !== 'string') {
        throw new Error('invalid rootDir')
    }
    rootDir = join(path, '..', rootDir)

    let connections: {[name: string]: Connection} = object.connections
    if (typeof connections !== 'object' || Array.isArray(connections)) {
        throw new Error('invalid connections')
    }
    for (const [name, connection] of Object.entries(connections)) {
        if (typeof connection !== "object" || Array.isArray(connection)) {
            throw new Error('invalid connection: ' + name)
        }
        if (typeof connection.host !== 'string') {
            throw new Error('invalid connection.host: ' + name)
        }
        if ('port' in connection && typeof connection.port !== 'number') {
            throw new Error('invalid connection.port: ' + name)
        }
        if (typeof connection.db !== 'string') {
            throw new Error('invalid connection.db: ' + name)
        }
        if (typeof connection.user !== 'string') {
            throw new Error('invalid connection.user: ' + name)
        }
        if (typeof connection.password !== 'string') {
            throw new Error('invalid connection.password: ' + name)
        }
    }

    return {
        rootDir,
        connections,
    }
}

let manager: ScriptManager
let config: Config

async function execute(executor: Executor, identifiers: string[]): Promise<void> {
    identifiers = identifiers.flatMap(
        identifier => {
            if (hasMagic(identifier)) {
                return sync(join(executor.manager.rootDir, identifier)).map(
                    path => relative(executor.manager.rootDir, path)
                )
            } else {
                return [identifier]
            }
        }
    )

    for (const identifier of identifiers) {
        for (const path of await executor.manager.resolve(identifier)) {
            const script = await executor.manager.load(path);
            await script.execute(executor)
        }
    }
}

yargs(hideBin(process.argv))
    .string('config').describe('config', 'Config file path').demandOption('config')
    .default('config', 'migrator-config.json')
    .middleware(
        async ({config: configObject}) => {
            const {
                rootDir
            } = config = await parseConfig(configObject)
            manager = new ScriptManager(rootDir)
        }
    )
    .command(
        'resolve <identifier> [caller]', 'resolve paths for idenfier and caller',
        args => args.string('identifier').string('caller'), async ({identifier, caller}) => {
            for (const path of await manager.resolve(identifier, caller)) {
                console.log('-', path)
            }
        }
    )
    .command(
        'compile [identifiers...]', 'compile execution steps for identifiers',
        args => args.array('identifiers').string('identifiers'), async ({identifiers}) => {
            const executor = new CompileExecutor(manager)
            await execute(executor, identifiers)

            const compiled = executor.compile()

            await new Promise<void>(
                (resolve, reject) => {
                    process.stdout.write(
                        compiled,
                        err => {
                            if (err) {
                                reject(err)
                            } else {
                                resolve()
                            }
                        }
                    )
                }
            )
        }
    )
    .command(
        'calculate [identifiers...]', 'calculate execution steps for identifiers',
        args => args.array('identifiers').string('identifiers'), async ({identifiers}) => {
            const executor = new NoopExecutor(manager)
            await execute(executor, identifiers)

            for (const script of executor.executionOrder) {
                console.log('-', script.path)
            }
        }
    )
    .command(
        'migrate <connection> [identifiers...]', 'migrate execution steps for identifiers',
        args => args.string('connection').array('identifiers').string('identifiers'), async ({identifiers, connection: connName}) => {
            try {
                const connection = config.connections[connName]
                if (connection == undefined) {
                    throw new Error('No connection configuration found with name: ' + connection)
                }

                const pool = new Pool({
                    host: connection.host,
                    port: connection.port,
                    database: connection.db,
                    user: connection.user,
                    password: connection.password,
                })

                const executor = new PGExecutor(manager, pool)

                console.log('Setting up executor...')
                await executor.setup()

                console.log('Collecting migration scripts...')
                await execute(executor, identifiers)

                console.log('Migrating scripts...')
                await executor.migrate()

                console.log('Done')
                process.exit(0)
            } catch (err) {
                console.error(err)
                process.exit(1)
            }
        }
    )
    .demandCommand(1)
    .parse()