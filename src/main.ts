#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { readFile } from 'fs/promises'
import { ScriptManager } from './script-manager'
import { Executor } from './executor'

import { join } from "path"
import { CompileExecutor } from './compile-executor'
import { Pool } from 'pg'
import { PGMigrator } from './pg-migrator'
import { Script } from './script'
import { OrderResolver } from './order-resolver'
import { DependencyResolver } from './dependency-resolver'

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
let dependencyResolver: DependencyResolver
let config: Config

async function resolve(identifiers: string[]): Promise<{
    order: OrderResolver
}> {
    const scripts: Script[] = []
    for (const identifier of identifiers) {
        const paths = await manager.resolve(identifier)
        for (const path of paths) {
            scripts.push(
                await manager.load(path)
            )
        }
    }

    const order = new OrderResolver(dependencyResolver)

    for (const script of scripts) {
        await order.resolveOrder(script)
    }

    return {
        order
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
            dependencyResolver = new DependencyResolver(manager)
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
        'calculate [identifiers...]', 'calculate execution steps for identifiers',
        args => args.array('identifiers').string('identifiers'), async ({identifiers}) => {
            const { order } = await resolve(identifiers)

            for (const script of order) {
                console.log('-', script.path)
            }
        }
    )
    .command(
        'compile [identifiers...]', 'compile execution steps for identifiers',
        args => args.array('identifiers').string('identifiers'), async ({identifiers}) => {
            const { order } = await resolve(identifiers)

            const executor = new CompileExecutor(manager)
            for (const script of order) {
                await executor.execute(script)
            }
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
        'migrate <connection> [identifiers...]', 'migrate execution steps for identifiers',
        args => args.boolean('dry-run').alias('dry-run', 'd').string('connection').array('identifiers').string('identifiers'), async ({identifiers, connection: connName, "dry-run": dryRun}) => {
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

                const migrator = new PGMigrator(dependencyResolver, pool)

                console.log('Setting up migrator...')
                await migrator.setup()

                console.log('Calculating migration steps...');
                const { order } = await resolve(identifiers)
                const steps = await migrator.calculate(order)

                if (dryRun) {
                    console.log(`Required ${steps.length} step(s)`)
                    for (const step of steps) {
                        console.log('-', step)
                    }
                } else {
                    console.log('Migrating scripts...')
                    await migrator.execute(steps)
                    console.log('Done')
                }

                process.exit(0)
            } catch (err) {
                console.error(err)
                process.exit(1)
            }
        }
    )
    .demandCommand(1)
    .parse()