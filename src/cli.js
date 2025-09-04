#!/usr/bin/env node

import { MCPAnkiServer } from './server/mcp-server.js';
import process from 'process';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        dbPath: process.env.MCP_ANKI_DB_PATH || null,
        mediaDir: process.env.MCP_ANKI_MEDIA_DIR || null,
        readonly: false,
        logLevel: 'info'
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--readonly':
                config.readonly = true;
                break;
            case '--log-level':
                config.logLevel = args[++i];
                break;
            case '--db-path':
                config.dbPath = args[++i];
                break;
            case '--media-dir':
                config.mediaDir = args[++i];
                break;
            case '--help':
                console.log(`
MCP Anki Server

Usage: mcp-anki [options]

Options:
  --readonly        Run in read-only mode
  --log-level LEVEL Set log level (debug|info|warn|error)
  --db-path PATH    SQLite database path
  --media-dir PATH  Media directory path
  --help            Show this help

Environment Variables:
  MCP_ANKI_DB_PATH    Default database path
  MCP_ANKI_MEDIA_DIR  Default media directory
                `);
                process.exit(0);
                break;
            default:
                console.error(`Unknown argument: ${arg}`);
                process.exit(1);
        }
    }

    return config;
}

async function main() {
    try {
        const config = parseArgs();
        const server = new MCPAnkiServer(config);
        await server.start();
    } catch (error) {
        console.error('Failed to start MCP Anki server:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}