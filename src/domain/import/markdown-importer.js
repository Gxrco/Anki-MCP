export class MarkdownImporter {
    constructor(db) {
        this.db = db;
    }

    async import(markdownContent, options = {}) {
        const {
            deckDefault = 'Inbox',
            dedupe = true,
            dryRun = false
        } = options;

        const records = this.parseMarkdown(markdownContent);
        const results = {
            insertedNotes: 0,
            insertedCards: 0,
            errors: []
        };

        // Ensure default deck exists
        await this.ensureDeckExists(deckDefault);

        for (let i = 0; i < records.length; i++) {
            try {
                const record = records[i];
                await this.processRecord(record, deckDefault, dedupe, dryRun, results);
            } catch (error) {
                results.errors.push({
                    index: i,
                    error: error.message,
                    data: records[i]
                });
            }
        }

        return results;
    }

    parseMarkdown(content) {
        const records = [];
        const sections = content.split(/^---\s*$/m);
        
        for (const section of sections) {
            if (!section.trim()) continue;
            
            const lines = section.split('\n').map(line => line.trim()).filter(line => line);
            let currentRecord = {
                deck: null,
                model: 'basic',
                fields: {},
                tags: []
            };
            
            let currentField = null;
            let currentFieldContent = [];
            
            for (const line of lines) {
                // Check for metadata
                if (line.startsWith('### Deck:')) {
                    currentRecord.deck = line.replace('### Deck:', '').trim();
                } else if (line.startsWith('Tags:')) {
                    currentRecord.tags = line.replace('Tags:', '').trim().split(/\s+/).filter(t => t);
                } else if (line.startsWith('Model:')) {
                    currentRecord.model = line.replace('Model:', '').trim();
                } else if (line.startsWith('Q:')) {
                    // Basic model question
                    if (currentField) {
                        currentRecord.fields[currentField] = currentFieldContent.join('\n');
                    }
                    currentField = 'front';
                    currentFieldContent = [line.replace('Q:', '').trim()];
                } else if (line.startsWith('A:')) {
                    // Basic model answer
                    if (currentField) {
                        currentRecord.fields[currentField] = currentFieldContent.join('\n');
                    }
                    currentField = 'back';
                    currentFieldContent = [line.replace('A:', '').trim()];
                } else if (line.startsWith('Cloze:')) {
                    // Cloze deletion
                    if (currentField) {
                        currentRecord.fields[currentField] = currentFieldContent.join('\n');
                    }
                    currentRecord.model = 'cloze';
                    currentField = 'front';
                    currentFieldContent = [line.replace('Cloze:', '').trim()];
                } else if (line.startsWith('Extra:')) {
                    // Extra field
                    if (currentField) {
                        currentRecord.fields[currentField] = currentFieldContent.join('\n');
                    }
                    currentField = 'extra';
                    currentFieldContent = [line.replace('Extra:', '').trim()];
                } else {
                    // Continue current field content
                    if (currentField) {
                        currentFieldContent.push(line);
                    }
                }
            }
            
            // Save last field
            if (currentField && currentFieldContent.length > 0) {
                currentRecord.fields[currentField] = currentFieldContent.join('\n');
            }
            
            // Only add if we have content
            if (Object.keys(currentRecord.fields).length > 0 && currentRecord.fields.front) {
                records.push(currentRecord);
            }
        }
        
        return records;
    }

    async processRecord(record, deckDefault, dedupe, dryRun, results) {
        const deck = record.deck || deckDefault;
        const model = record.model || 'basic';
        const fields = record.fields || {};
        const tags = record.tags || [];

        // Validate required fields
        if (!fields.front) {
            throw new Error('Front field is required');
        }

        if (model === 'basic' && !fields.back) {
            throw new Error('Back field is required for basic model');
        }

        // Check for duplicates if requested
        if (dedupe) {
            const exists = await this.checkDuplicate(deck, fields.front, fields.back || '');
            if (exists) {
                return; // Skip duplicate
            }
        }

        if (!dryRun) {
            // Get or create deck
            const deckId = await this.getDeckId(deck);

            // Create note
            const noteId = await this.createNote(deckId, model, fields, tags);
            results.insertedNotes++;

            // Generate cards
            const cardIds = await this.generateCards(noteId, model, fields);
            results.insertedCards += cardIds.length;
        } else {
            // Dry run - just count
            results.insertedNotes++;
            results.insertedCards += this.getCardCount(model, fields);
        }
    }

    async ensureDeckExists(deckName) {
        const existing = await new Promise((resolve, reject) => {
            this.db.get('SELECT id FROM decks WHERE name = ?', [deckName], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!existing) {
            const defaultConfig = JSON.stringify({
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
            });

            await new Promise((resolve, reject) => {
                this.db.run(
                    'INSERT INTO decks (name, config_json) VALUES (?, ?)',
                    [deckName, defaultConfig],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
    }

    async checkDuplicate(deckName, front, back) {
        const exists = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT n.id 
                FROM notes n 
                JOIN decks d ON n.deck_id = d.id 
                WHERE d.name = ? AND n.fields_json LIKE ? AND n.fields_json LIKE ?
            `, [deckName, `%"front":"${front}"%`, `%"back":"${back}"%`], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        return !!exists;
    }

    async getDeckId(deckName) {
        const deck = await new Promise((resolve, reject) => {
            this.db.get('SELECT id FROM decks WHERE name = ?', [deckName], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!deck) {
            throw new Error(`Deck not found: ${deckName}`);
        }

        return deck.id;
    }

    async createNote(deckId, model, fields, tags) {
        const fieldsJson = JSON.stringify(fields);
        const tagsString = tags.join(' ');

        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO notes (deck_id, model, fields_json, tags) VALUES (?, ?, ?, ?)',
                [deckId, model, fieldsJson, tagsString],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    async generateCards(noteId, model, fields) {
        const cardIds = [];

        switch (model) {
            case 'basic':
                const basicCard = await this.createCard(noteId, 'forward');
                cardIds.push(basicCard);
                break;

            case 'basic_reverse':
                const forward = await this.createCard(noteId, 'forward');
                const reverse = await this.createCard(noteId, 'reverse');
                cardIds.push(forward, reverse);
                break;

            case 'cloze':
                const clozeText = fields.front || fields.text || '';
                const clozeMatches = clozeText.match(/\{\{c(\d+)::[^}]+\}\}/g) || [];
                const clozeNumbers = [...new Set(clozeMatches.map(match => {
                    const num = match.match(/\{\{c(\d+)::/);
                    return num ? parseInt(num[1]) : 1;
                }))];

                for (const clozeNum of clozeNumbers) {
                    const clozeCard = await this.createCard(noteId, `cloze-${clozeNum}`);
                    cardIds.push(clozeCard);
                }
                break;
        }

        return cardIds;
    }

    async createCard(noteId, template) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO cards (note_id, template, state, due) VALUES (?, ?, ?, ?)',
                [noteId, template, 'new', 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    getCardCount(model, fields) {
        switch (model) {
            case 'basic':
                return 1;
            case 'basic_reverse':
                return 2;
            case 'cloze':
                const clozeText = fields.front || fields.text || '';
                const clozeMatches = clozeText.match(/\{\{c(\d+)::[^}]+\}\}/g) || [];
                const clozeNumbers = [...new Set(clozeMatches.map(match => {
                    const num = match.match(/\{\{c(\d+)::/);
                    return num ? parseInt(num[1]) : 1;
                }))];
                return clozeNumbers.length;
            default:
                return 1;
        }
    }
}