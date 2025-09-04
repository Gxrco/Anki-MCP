export function createDeckTools(db) {
    return [
        {
            name: 'anki.create_deck',
            description: 'Create a new deck with optional parent and configuration',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Deck name (can include :: for hierarchy)'
                    },
                    parent: {
                        type: 'string',
                        description: 'Parent deck name (optional)'
                    },
                    configOverride: {
                        type: 'object',
                        description: 'Override default deck configuration (optional)'
                    }
                },
                required: ['name']
            },
            handler: async (args) => {
                const { name, parent, configOverride } = args;
                
                const defaultConfig = {
                    learningStepsMins: [1, 10],
                    graduatingIntervalDays: 1,
                    easyBonus: 1.3,
                    hardInterval: 1.2,
                    lapseStepsMins: [10],
                    newPerDay: 20,
                    reviewsPerDay: 200,
                    minEase: 1.3,
                    leechThreshold: 8,
                    leechAction: 'suspend',
                    fuzzPercent: 0.05,
                    burySiblings: true
                };

                const config = { ...defaultConfig, ...configOverride };
                let parentId = null;

                if (parent) {
                    const parentRow = await new Promise((resolve, reject) => {
                        db.get('SELECT id FROM decks WHERE name = ?', [parent], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    
                    if (!parentRow) {
                        throw new Error(`Parent deck not found: ${parent}`);
                    }
                    parentId = parentRow.id;
                }

                const result = await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO decks (name, parent_id, config_json) VALUES (?, ?, ?)',
                        [name, parentId, JSON.stringify(config)],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ deckId: this.lastID, name });
                        }
                    );
                });

                return result;
            }
        },
        {
            name: 'anki.list_decks',
            description: 'List all decks with optional hierarchical structure',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    flat: {
                        type: 'boolean',
                        description: 'Return flat list instead of hierarchical',
                        default: false
                    }
                }
            },
            handler: async (args) => {
                const { flat = false } = args;

                const decks = await new Promise((resolve, reject) => {
                    db.all('SELECT id, name, parent_id FROM decks ORDER BY name', (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });

                if (flat) {
                    return { decks: decks.map(deck => ({
                        id: deck.id,
                        name: deck.name,
                        parentId: deck.parent_id
                    }))};
                }

                // Build hierarchical structure
                const deckMap = new Map();
                const roots = [];

                decks.forEach(deck => {
                    deckMap.set(deck.id, {
                        id: deck.id,
                        name: deck.name,
                        parentId: deck.parent_id,
                        children: []
                    });
                });

                decks.forEach(deck => {
                    const deckObj = deckMap.get(deck.id);
                    if (deck.parent_id) {
                        const parent = deckMap.get(deck.parent_id);
                        if (parent) {
                            parent.children.push(deckObj);
                        }
                    } else {
                        roots.push(deckObj);
                    }
                });

                return { decks: roots };
            }
        }
    ];
}