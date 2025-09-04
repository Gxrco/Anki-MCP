export function createNoteTools(db) {
    return [
        {
            name: 'anki.add_note',
            description: 'Add a new note to a deck',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'ID of the deck to add the note to'
                    },
                    model: {
                        type: 'string',
                        enum: ['basic', 'basic_reverse', 'cloze', 'custom'],
                        default: 'basic',
                        description: 'Note model/template type'
                    },
                    fields: {
                        type: 'object',
                        description: 'Note fields (front, back, extra, etc.)',
                        properties: {
                            front: { type: 'string' },
                            back: { type: 'string' },
                            extra: { type: 'string' }
                        },
                        required: ['front']
                    },
                    tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Tags for the note',
                        default: []
                    }
                },
                required: ['deckId', 'fields']
            },
            handler: async (args) => {
                const { deckId, model = 'basic', fields, tags = [] } = args;

                // Verify deck exists
                const deck = await new Promise((resolve, reject) => {
                    db.get('SELECT id FROM decks WHERE id = ?', [deckId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!deck) {
                    throw new Error(`Deck not found: ${deckId}`);
                }

                // Validate fields based on model
                if (model === 'basic' && !fields.back) {
                    throw new Error('Basic model requires both front and back fields');
                }

                const tagsString = Array.isArray(tags) ? tags.join(' ') : tags;
                const fieldsJson = JSON.stringify(fields);

                const result = await new Promise((resolve, reject) => {
                    db.run(
                        'INSERT INTO notes (deck_id, model, fields_json, tags) VALUES (?, ?, ?, ?)',
                        [deckId, model, fieldsJson, tagsString],
                        function(err) {
                            if (err) reject(err);
                            else resolve({ noteId: this.lastID });
                        }
                    );
                });

                return result;
            }
        },
        {
            name: 'anki.generate_cards_for_note',
            description: 'Generate cards for a note based on its model',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    noteId: {
                        type: 'integer',
                        description: 'ID of the note to generate cards for'
                    }
                },
                required: ['noteId']
            },
            handler: async (args) => {
                const { noteId } = args;

                // Get note details
                const note = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM notes WHERE id = ?', [noteId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!note) {
                    throw new Error(`Note not found: ${noteId}`);
                }

                const cardIds = [];
                const fields = JSON.parse(note.fields_json);

                switch (note.model) {
                    case 'basic':
                        const basicCard = await new Promise((resolve, reject) => {
                            db.run(
                                'INSERT INTO cards (note_id, template, state, due) VALUES (?, ?, ?, ?)',
                                [noteId, 'forward', 'new', 0],
                                function(err) {
                                    if (err) reject(err);
                                    else resolve(this.lastID);
                                }
                            );
                        });
                        cardIds.push(basicCard);
                        break;

                    case 'basic_reverse':
                        const forwardCard = await new Promise((resolve, reject) => {
                            db.run(
                                'INSERT INTO cards (note_id, template, state, due) VALUES (?, ?, ?, ?)',
                                [noteId, 'forward', 'new', 0],
                                function(err) {
                                    if (err) reject(err);
                                    else resolve(this.lastID);
                                }
                            );
                        });
                        cardIds.push(forwardCard);

                        const reverseCard = await new Promise((resolve, reject) => {
                            db.run(
                                'INSERT INTO cards (note_id, template, state, due) VALUES (?, ?, ?, ?)',
                                [noteId, 'reverse', 'new', 0],
                                function(err) {
                                    if (err) reject(err);
                                    else resolve(this.lastID);
                                }
                            );
                        });
                        cardIds.push(reverseCard);
                        break;

                    case 'cloze':
                        // Extract cloze deletions
                        const clozeMatches = (fields.front || fields.text || '').match(/\{\{c(\d+)::[^}]+\}\}/g) || [];
                        const clozeNumbers = [...new Set(clozeMatches.map(match => {
                            const num = match.match(/\{\{c(\d+)::/);
                            return num ? parseInt(num[1]) : 1;
                        }))];

                        for (const clozeNum of clozeNumbers) {
                            const clozeCard = await new Promise((resolve, reject) => {
                                db.run(
                                    'INSERT INTO cards (note_id, template, state, due) VALUES (?, ?, ?, ?)',
                                    [noteId, `cloze-${clozeNum}`, 'new', 0],
                                    function(err) {
                                        if (err) reject(err);
                                        else resolve(this.lastID);
                                    }
                                );
                            });
                            cardIds.push(clozeCard);
                        }
                        break;

                    default:
                        throw new Error(`Unsupported model: ${note.model}`);
                }

                return { cardIds };
            }
        }
    ];
}