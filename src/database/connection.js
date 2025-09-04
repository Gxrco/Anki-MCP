import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { MigrationRunner } from './migration-runner.js';

export class DatabaseConnection {
    constructor(dbPath = null) {
        this.dbPath = dbPath || this.getDefaultDbPath();
        this.db = null;
    }

    getDefaultDbPath() {
        const homeDir = os.homedir();
        const ankiDir = path.join(homeDir, '.mcp-anki');
        
        if (!fs.existsSync(ankiDir)) {
            fs.mkdirSync(ankiDir, { recursive: true });
        }
        
        return path.join(ankiDir, 'anki.db');
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Enable WAL mode for better concurrency
                this.db.run('PRAGMA journal_mode = WAL', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Enable foreign keys
                    this.db.run('PRAGMA foreign_keys = ON', async (err) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        
                        try {
                            // Run migrations
                            const migrationRunner = new MigrationRunner(this.db);
                            await migrationRunner.runMigrations();
                            resolve(this.db);
                        } catch (migrationErr) {
                            reject(migrationErr);
                        }
                    });
                });
            });
        });
    }

    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }

    getDb() {
        if (!this.db) {
            throw new Error('Database not connected. Call connect() first.');
        }
        return this.db;
    }
}