import { Pool, PoolClient } from "pg";
import { DependencyResolver } from "./dependency-resolver";
import { OrderResolver } from "./order-resolver";
import { Script } from "./script";

export type Step = {
    type: 'revert'
    path: string
    hash: string
    scripts: {
        revert: string | undefined
    }
} | {
    type: 'migrate'
    path: string
    hash: string
    dependencies: string[]
    scripts: {
        migration: string
        revert: string | undefined
    }
}

export interface MigratedScript {
    path: string
    hash: string
    dependencies: string[]
    revertScript: string | undefined
}

export interface MigratedSchema {
    [path: string]: MigratedScript
}

class RevertOrderResolver implements Iterable<MigratedScript> {
    constructor(
        readonly schema: MigratedSchema
    ) {
    }

    private getDependents(path: string): MigratedScript[] {
        return Object.values(this.schema).filter(
            script => script.dependencies.includes(path)
        )
    }

    private order: MigratedScript[] = [];
    [Symbol.iterator](): Iterator<MigratedScript> {
        return this.order[Symbol.iterator]();
    }

    revert(script: MigratedScript) {
        if (this.schema[script.path] !== script) {
            throw new Error('Script is not in the schema')
        }
        if (this.order.includes(script)) {
            return
        }
        for (const dependent of this.getDependents(script.path)) {
            this.revert(dependent)
        }
        this.order.push(script)
    }
}

export class PGMigrator {
    constructor(
        readonly dependencyResolver: DependencyResolver,
        readonly pool: Pool,
    ) {
    }

    async setup() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS migration (
                path varchar NOT NULL,
                hash varchar NOT NULL,
                revert_script text,

                PRIMARY KEY (path)
            );
            CREATE TABLE IF NOT EXISTS migration_dependency (
                dependent_path varchar NOT NULL,
                dependency_path varchar NOT NULL,

                PRIMARY KEY (dependent_path, dependency_path),
                FOREIGN KEY (dependent_path) REFERENCES migration ON DELETE CASCADE,
                FOREIGN KEY (dependency_path) REFERENCES migration
            );
        `);
    }

    async getMigratedSchema(): Promise<MigratedSchema> {
        const dependencyRows = (await this.pool.query('SELECT * FROM migration_dependency')).rows
        const migrationRows = (await this.pool.query('SELECT * FROM migration')).rows
    
        const dependencies: {[path: string]: string[]} = {}
        for (const dependencyRow of dependencyRows) {
            (dependencies[dependencyRow.dependent_path] ??= [])
                .push(dependencyRow.dependency_path)
        }
    
        const scripts = migrationRows.map(
            ({path, hash, revert_script}) => ({
                path,
                hash,
                revertScript: revert_script,
                dependencies: dependencies[path] ?? []
            })
        )

        const schema: MigratedSchema = Object.fromEntries(
            scripts.map(
                migratedScript => [migratedScript.path, migratedScript]
            )
        )

        return schema
    }

    async calculate(order: OrderResolver): Promise<Step[]> {
        const schema = await this.getMigratedSchema()
        
        const steps: Step[] = []

        const revertOrder = new RevertOrderResolver(schema)
        const migratingScripts = new Set<Script>()

        for (const script of order) {
            const migratedScript = schema[script.path]
            if (migratedScript != undefined) {
                if (migratedScript.hash !== script.hash()) {
                    revertOrder.revert(migratedScript)
                }
            } else {
                migratingScripts.add(script)
            }
        }

        for (const revertedScript of revertOrder) {
            steps.push({
                type: 'revert',
                hash: revertedScript.hash,
                path: revertedScript.path,
                scripts: {
                    revert: revertedScript.revertScript,
                },
            })
            migratingScripts.add(
                await order.dependencyResolver.scriptManager.load(
                    revertedScript.path
                )
            )
        }

        for (const script of order) {
            if (migratingScripts.has(script)) {
                const dependencies = [
                    ...await order.dependencyResolver.resolveDependencies(script)
                ].map(
                    ({ path }) => path
                )
                steps.push({
                    type: 'migrate',
                    path: script.path,
                    hash: script.hash(),
                    dependencies,
                    scripts: {
                        migration: script.migration(),
                        revert: script.revert()
                    }
                })
            }
        }

        return steps;
    }

    async execute(steps: Step[]) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (const step of steps) {
                if (step.type === 'revert') {
                    console.log(`Reverting ${step.path} ${step.hash}`)
                    await client.query(
                        'DELETE FROM migration WHERE path = $1',
                        [step.path],
                    )
                    if (step.scripts.revert != undefined) {
                        await client.query(step.scripts.revert);
                    }
                } else if (step.type === 'migrate') {
                    console.log(`Migrating ${step.path} ${step.hash}`)
                    await client.query(
                        'INSERT INTO migration (path, hash, revert_script) VALUES ($1, $2, $3)',
                        [step.path, step.hash, step.scripts.revert],
                    )
                    for (const dependency of step.dependencies) {
                        await client.query(
                            'INSERT INTO migration_dependency (dependent_path, dependency_path) VALUES ($1, $2)',
                            [step.path, dependency],
                        )
                    }
                    await client.query(step.scripts.migration);
                } else {
                    throw new Error(`Invalid step type: ${(step as any).type}`)
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err
        } finally {
            client.release()
        }
    }
}