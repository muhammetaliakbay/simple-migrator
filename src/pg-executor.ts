import { Client, Pool } from "pg";
import { BaseExecutor } from "./executor";
import { Script } from "./script";
import { ScriptManager } from "./script-manager";

export class PGExecutor extends BaseExecutor {
    constructor(
        manager: ScriptManager,
        readonly pool: Pool,
    ) {
        super(manager)
    }

    async setup() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                path varchar NOT NULL,
                version varchar,
                hash varchar NOT NULL,
                key varchar NOT NULL,

                UNIQUE (path, key)
            );
        `);
    }

    private executionOrder: Script[] = []

    async execute(script: Script): Promise<void> {
        this.executionOrder.push(script)
    }

    private async migrateScript(script: Script) {
        const path = script.path
        const version = script.version()
        const hash = script.hash()
        const key = version ?? hash;
        const client = await this.pool.connect()
        const scriptLogInfo = {
            path,
            version,
            hash,
        }
        try {
            await client.query('BEGIN');
            
            const previous = await client.query('SELECT * FROM migrations WHERE path = $1 AND key = $2', [path, key])
            if (previous.rowCount != 0) {
                console.log('Script is already migrated', scriptLogInfo)

                await client.query('ROLLBACK');
                return
            }

            console.log('Migrating script...', scriptLogInfo)
            await client.query(script.content);

            await client.query(
                'INSERT INTO migrations (path, version, hash, key) VALUES ($1, $2, $3, $4)',
                [path, version, hash, key],
            )

            await client.query('COMMIT');
            console.log('Migrated script', scriptLogInfo)
        } catch (err) {
            await client.query('ROLLBACK');
            throw err
        } finally {
            client.release()
        }
    }

    async migrate() {
        for (const script of this.executionOrder) {
            await this.migrateScript(script);
        }
    }
}