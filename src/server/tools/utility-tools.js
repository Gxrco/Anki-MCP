import fs from 'fs';
import path from 'path';
import os from 'os';
import { JSONExporter } from '../../domain/export/json-exporter.js';
import { MarkdownExporter } from '../../domain/export/markdown-exporter.js';

export function createUtilityTools(db) {
    return [
        {
            name: 'anki_suspend_cards',
            description: 'Suspend one or more cards',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to suspend'
                    }
                },
                required: ['cardIds']
            },
            handler: async (args) => {
                const { cardIds } = args;
                
                if (!Array.isArray(cardIds) || cardIds.length === 0) {
                    throw new Error('cardIds must be a non-empty array');
                }

                const placeholders = cardIds.map(() => '?').join(',');
                const timestamp = Math.floor(Date.now() / 1000);
                
                return new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE cards SET state = 'suspended', updated_at = ? WHERE id IN (${placeholders})`,
                        [timestamp, ...cardIds],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ updated: this.changes });
                        }
                    );
                });
            }
        },
        {
            name: 'anki_unsuspend_cards',
            description: 'Unsuspend one or more cards',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to unsuspend'
                    }
                },
                required: ['cardIds']
            },
            handler: async (args) => {
                const { cardIds } = args;
                
                if (!Array.isArray(cardIds) || cardIds.length === 0) {
                    throw new Error('cardIds must be a non-empty array');
                }

                const placeholders = cardIds.map(() => '?').join(',');
                const timestamp = Math.floor(Date.now() / 1000);
                
                // Determine appropriate state for unsuspended cards
                // New cards go back to 'new', others go to 'review'
                return new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE cards 
                         SET state = CASE 
                             WHEN reps = 0 THEN 'new' 
                             ELSE 'review' 
                         END, 
                         updated_at = ? 
                         WHERE id IN (${placeholders}) AND state = 'suspended'`,
                        [timestamp, ...cardIds],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ updated: this.changes });
                        }
                    );
                });
            }
        },
        {
            name: 'anki_bury_cards',
            description: 'Bury one or more cards until next day',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to bury'
                    }
                },
                required: ['cardIds']
            },
            handler: async (args) => {
                const { cardIds } = args;
                
                if (!Array.isArray(cardIds) || cardIds.length === 0) {
                    throw new Error('cardIds must be a non-empty array');
                }

                const placeholders = cardIds.map(() => '?').join(',');
                const timestamp = Math.floor(Date.now() / 1000);
                
                return new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE cards SET state = 'buried', updated_at = ? WHERE id IN (${placeholders})`,
                        [timestamp, ...cardIds],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ updated: this.changes });
                        }
                    );
                });
            }
        },
        {
            name: 'anki_unbury_cards',
            description: 'Unbury cards (typically called automatically at start of new day)',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to unbury (optional, unbury all if not specified)'
                    }
                }
            },
            handler: async (args) => {
                const { cardIds } = args;
                const timestamp = Math.floor(Date.now() / 1000);
                
                let sql, params;
                if (cardIds && cardIds.length > 0) {
                    const placeholders = cardIds.map(() => '?').join(',');
                    sql = `UPDATE cards 
                           SET state = CASE 
                               WHEN reps = 0 THEN 'new' 
                               ELSE 'review' 
                           END, 
                           updated_at = ? 
                           WHERE id IN (${placeholders}) AND state = 'buried'`;
                    params = [timestamp, ...cardIds];
                } else {
                    sql = `UPDATE cards 
                           SET state = CASE 
                               WHEN reps = 0 THEN 'new' 
                               ELSE 'review' 
                           END, 
                           updated_at = ? 
                           WHERE state = 'buried'`;
                    params = [timestamp];
                }
                
                return new Promise((resolve, reject) => {
                    db.run(sql, params, function(err) {
                        if (err) reject(err);
                        else resolve({ updated: this.changes });
                    });
                });
            }
        },
        {
            name: 'anki_export',
            description: 'Export deck to JSON or Markdown format',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'Deck ID to export'
                    },
                    format: {
                        type: 'string',
                        enum: ['json', 'markdown'],
                        default: 'json',
                        description: 'Export format'
                    },
                    includeMedia: {
                        type: 'boolean',
                        default: true,
                        description: 'Include media references (JSON only)'
                    },
                    includeStats: {
                        type: 'boolean',
                        default: false,
                        description: 'Include deck statistics'
                    },
                    outputPath: {
                        type: 'string',
                        description: 'Output file path (optional, generates if not provided)'
                    }
                },
                required: ['deckId']
            },
            handler: async (args) => {
                const { deckId, format = 'json', includeMedia = true, includeStats = false, outputPath } = args;

                // Get deck name for filename
                const deck = await new Promise((resolve, reject) => {
                    db.get('SELECT name FROM decks WHERE id = ?', [deckId], (err, row) => {
                        if (err) reject(err);
                        else if (!row) reject(new Error(`Deck not found: ${deckId}`));
                        else resolve(row);
                    });
                });

                let exporter, content, extension;
                const options = { includeMedia, includeStats };

                switch (format) {
                    case 'json':
                        exporter = new JSONExporter(db);
                        content = await exporter.export(deckId, options);
                        extension = '.json';
                        break;
                    case 'markdown':
                        exporter = new MarkdownExporter(db);
                        content = await exporter.export(deckId, options);
                        extension = '.md';
                        break;
                    default:
                        throw new Error(`Unsupported format: ${format}`);
                }

                // Generate output path if not provided
                let filePath = outputPath;
                if (!filePath) {
                    const sanitizedName = deck.name.replace(/[^a-zA-Z0-9-_]/g, '_');
                    const timestamp = new Date().toISOString().split('T')[0];
                    const filename = `${sanitizedName}_${timestamp}${extension}`;
                    filePath = path.join(os.tmpdir(), filename);
                }

                // Write file
                await fs.promises.writeFile(filePath, content, 'utf8');

                return {
                    filePath,
                    format,
                    deckId,
                    deckName: deck.name,
                    size: content.length,
                    exported_at: new Date().toISOString()
                };
            }
        },
        {
            name: 'anki_reset_cards',
            description: 'Reset cards to new state (removes learning progress)',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to reset'
                    }
                },
                required: ['cardIds']
            },
            handler: async (args) => {
                const { cardIds } = args;
                
                if (!Array.isArray(cardIds) || cardIds.length === 0) {
                    throw new Error('cardIds must be a non-empty array');
                }

                const placeholders = cardIds.map(() => '?').join(',');
                const timestamp = Math.floor(Date.now() / 1000);
                
                return new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE cards 
                         SET state = 'new', due = 0, ivl = 0, ease = 2.5, reps = 0, lapses = 0, updated_at = ? 
                         WHERE id IN (${placeholders})`,
                        [timestamp, ...cardIds],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ updated: this.changes });
                        }
                    );
                });
            }
        },
        {
            name: 'anki_delete_cards',
            description: 'Permanently delete cards',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardIds: {
                        type: 'array',
                        items: { type: 'integer' },
                        description: 'Array of card IDs to delete'
                    }
                },
                required: ['cardIds']
            },
            handler: async (args) => {
                const { cardIds } = args;
                
                if (!Array.isArray(cardIds) || cardIds.length === 0) {
                    throw new Error('cardIds must be a non-empty array');
                }

                const placeholders = cardIds.map(() => '?').join(',');
                
                // Delete reviews first (foreign key constraint)
                await new Promise((resolve, reject) => {
                    db.run(
                        `DELETE FROM reviews WHERE card_id IN (${placeholders})`,
                        cardIds,
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                // Delete cards
                return new Promise((resolve, reject) => {
                    db.run(
                        `DELETE FROM cards WHERE id IN (${placeholders})`,
                        cardIds,
                        function(err) {
                            if (err) reject(err);
                            else resolve({ deleted: this.changes });
                        }
                    );
                });
            }
        }
    ];
}