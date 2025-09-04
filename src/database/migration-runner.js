import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MigrationRunner {
    constructor(db) {
        this.db = db;
        this.migrationsDir = path.join(__dirname, 'migrations');
    }

    async runMigrations() {
        await this.ensureMigrationsTable();
        const appliedMigrations = await this.getAppliedMigrations();
        const availableMigrations = this.getAvailableMigrations();
        
        for (const migration of availableMigrations) {
            if (!appliedMigrations.includes(migration.version)) {
                console.log(`Applying migration ${migration.version}: ${migration.name}`);
                await this.applyMigration(migration);
            }
        }
    }

    async ensureMigrationsTable() {
        const sql = `
            CREATE TABLE IF NOT EXISTS migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            )
        `;
        return new Promise((resolve, reject) => {
            this.db.run(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async getAppliedMigrations() {
        const sql = 'SELECT version FROM migrations ORDER BY version';
        return new Promise((resolve, reject) => {
            this.db.all(sql, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.version));
            });
        });
    }

    getAvailableMigrations() {
        const files = fs.readdirSync(this.migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();
        
        return files.map(file => {
            const match = file.match(/^(\d{3})-(.+)\.sql$/);
            if (!match) {
                throw new Error(`Invalid migration filename: ${file}`);
            }
            return {
                version: parseInt(match[1]),
                name: match[2],
                filename: file,
                path: path.join(this.migrationsDir, file)
            };
        });
    }

    async applyMigration(migration) {
        const sql = fs.readFileSync(migration.path, 'utf8');
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                this.db.exec(sql, (err) => {
                    if (err) {
                        this.db.run('ROLLBACK');
                        reject(err);
                        return;
                    }
                    
                    this.db.run(
                        'INSERT INTO migrations (version) VALUES (?)', 
                        [migration.version], 
                        (err) => {
                            if (err) {
                                this.db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            
                            this.db.run('COMMIT', (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        }
                    );
                });
            });
        });
    }
}