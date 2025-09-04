import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseConnection } from '../database/connection.js';

// Tool handlers
import { createDeckTools } from './tools/deck-tools.js';
import { createNoteTools } from './tools/note-tools.js';
import { createCardTools } from './tools/card-tools.js';
import { createSearchTools } from './tools/search-tools.js';
import { createImportTools } from './tools/import-tools.js';
import { createStatsTools } from './tools/stats-tools.js';
import { createConfigTools } from './tools/config-tools.js';
import { createUtilityTools } from './tools/utility-tools.js';

export class MCPAnkiServer {
    constructor(config) {
        this.config = config;
        this.server = new Server(
            {
                name: 'mcp-anki',
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );
        this.dbConnection = new DatabaseConnection(config.dbPath);
        this.tools = new Map();
    }

    async start() {
        // Connect to database
        await this.dbConnection.connect();
        const db = this.dbConnection.getDb();

        // Register all tool categories
        this.registerTools(createDeckTools(db));
        this.registerTools(createNoteTools(db));
        this.registerTools(createCardTools(db));
        this.registerTools(createSearchTools(db));
        this.registerTools(createImportTools(db));
        this.registerTools(createStatsTools(db));
        this.registerTools(createConfigTools(db));
        this.registerTools(createUtilityTools(db));

        // Set up MCP handlers
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: Array.from(this.tools.values()).map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema
                }))
            };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            const tool = this.tools.get(name);
            
            if (!tool) {
                throw new Error(`Unknown tool: ${name}`);
            }

            if (this.config.readonly && tool.mutating) {
                throw new Error(`Tool ${name} is not available in readonly mode`);
            }

            try {
                const result = await tool.handler(args);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }
                    ]
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({ error: error.message }, null, 2)
                        }
                    ],
                    isError: true
                };
            }
        });

        // Start the server
        const transport = new StdioServerTransport();
        await this.server.connect(transport);

        console.error('MCP Anki Server started successfully');
    }

    registerTools(toolsArray) {
        for (const tool of toolsArray) {
            this.tools.set(tool.name, tool);
        }
    }

    async close() {
        if (this.dbConnection) {
            await this.dbConnection.close();
        }
    }
}