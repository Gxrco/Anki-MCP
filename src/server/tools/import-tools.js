import { CSVImporter } from '../../domain/import/csv-importer.js';
import { JSONImporter } from '../../domain/import/json-importer.js';
import { MarkdownImporter } from '../../domain/import/markdown-importer.js';

export function createImportTools(db) {
    return [
        {
            name: 'anki_import',
            description: 'Import notes from various formats (CSV, TSV, JSON, Markdown)',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    format: {
                        type: 'string',
                        enum: ['csv', 'tsv', 'json', 'markdown'],
                        description: 'Format of the input data'
                    },
                    payload: {
                        type: 'string',
                        description: 'Content to import as string'
                    },
                    options: {
                        type: 'object',
                        properties: {
                            deckDefault: {
                                type: 'string',
                                default: 'Inbox',
                                description: 'Default deck if not specified in data'
                            },
                            dedupe: {
                                type: 'boolean',
                                default: true,
                                description: 'Skip duplicate notes based on front+back+deck'
                            },
                            dryRun: {
                                type: 'boolean',
                                default: false,
                                description: 'Preview import without making changes'
                            }
                        }
                    }
                },
                required: ['format', 'payload']
            },
            handler: async (args) => {
                const { format, payload, options = {} } = args;

                if (!payload || typeof payload !== 'string') {
                    throw new Error('Payload must be a non-empty string');
                }

                let importer;
                switch (format.toLowerCase()) {
                    case 'csv':
                        importer = new CSVImporter(db);
                        break;
                    case 'tsv':
                        // TSV is just CSV with tab delimiter
                        importer = new CSVImporter(db);
                        // Replace tabs with commas and handle quoted fields
                        const tsvPayload = convertTsvToCsv(payload);
                        return await importer.import(tsvPayload, options);
                    case 'json':
                        importer = new JSONImporter(db);
                        break;
                    case 'markdown':
                        importer = new MarkdownImporter(db);
                        break;
                    default:
                        throw new Error(`Unsupported format: ${format}`);
                }

                const result = await importer.import(payload, options);

                return {
                    insertedNotes: result.insertedNotes,
                    insertedCards: result.insertedCards,
                    errors: result.errors,
                    summary: {
                        format,
                        totalProcessed: result.insertedNotes + result.errors.length,
                        successful: result.insertedNotes,
                        failed: result.errors.length,
                        dryRun: options.dryRun || false
                    }
                };
            }
        }
    ];
}

function convertTsvToCsv(tsvContent) {
    // Simple TSV to CSV conversion
    // This handles basic cases but doesn't handle all edge cases
    const lines = tsvContent.split('\n');
    const csvLines = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const fields = line.split('\t');
        const csvFields = fields.map(field => {
            // Escape fields that contain commas, quotes, or newlines
            if (field.includes(',') || field.includes('"') || field.includes('\n')) {
                return `"${field.replace(/"/g, '""')}"`;
            }
            return field;
        });
        
        csvLines.push(csvFields.join(','));
    }
    
    return csvLines.join('\n');
}