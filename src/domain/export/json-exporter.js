export class JSONExporter {
    constructor(db) {
        this.db = db;
    }

    async export(deckId, options = {}) {
        const { includeMedia = true, includeStats = false } = options;
        
        // Get deck info
        const deck = await this.getDeck(deckId);
        
        // Get all notes and cards for this deck
        const notes = await this.getNotes(deckId);
        
        // Get media if requested
        let media = [];
        if (includeMedia) {
            media = await this.getMedia(deckId);
        }
        
        // Get stats if requested
        let stats = null;
        if (includeStats) {
            stats = await this.getStats(deckId);
        }
        
        const exportData = {
            version: '1.0',
            exported_at: new Date().toISOString(),
            deck: {
                id: deck.id,
                name: deck.name,
                config: JSON.parse(deck.config_json)
            },
            notes: notes.map(note => ({
                id: note.id,
                model: note.model,
                fields: JSON.parse(note.fields_json),
                tags: note.tags ? note.tags.split(' ') : [],
                created_at: note.created_at,
                updated_at: note.updated_at,
                cards: note.cards.map(card => ({
                    id: card.id,
                    template: card.template,
                    state: card.state,
                    due: card.due,
                    ivl: card.ivl,
                    ease: card.ease,
                    reps: card.reps,
                    lapses: card.lapses,
                    created_at: card.created_at,
                    updated_at: card.updated_at
                }))
            })),
            media: media,
            stats: stats
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    async getDeck(deckId) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM decks WHERE id = ?', [deckId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error(`Deck not found: ${deckId}`));
                else resolve(row);
            });
        });
    }

    async getNotes(deckId) {
        const notes = await new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM notes WHERE deck_id = ? ORDER BY id', [deckId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get cards for each note
        for (const note of notes) {
            note.cards = await new Promise((resolve, reject) => {
                this.db.all('SELECT * FROM cards WHERE note_id = ? ORDER BY id', [note.id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        }

        return notes;
    }

    async getMedia(deckId) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT DISTINCT m.*
                FROM media m
                JOIN notes n ON n.fields_json LIKE '%' || m.hash || '%'
                WHERE n.deck_id = ?
            `, [deckId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => ({
                    id: row.id,
                    hash: row.hash,
                    path: row.path,
                    mime: row.mime,
                    size: row.size,
                    created_at: row.created_at
                })));
            });
        });
    }

    async getStats(deckId) {
        const cardStats = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as total_cards,
                    SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_cards,
                    SUM(CASE WHEN c.state = 'learning' THEN 1 ELSE 0 END) as learning_cards,
                    SUM(CASE WHEN c.state = 'review' THEN 1 ELSE 0 END) as review_cards,
                    SUM(CASE WHEN c.state = 'suspended' THEN 1 ELSE 0 END) as suspended_cards,
                    AVG(c.ivl) as avg_interval,
                    AVG(c.ease) as avg_ease
                FROM cards c
                JOIN notes n ON c.note_id = n.id
                WHERE n.deck_id = ?
            `, [deckId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const reviewStats = await new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(*) as total_reviews,
                    AVG(rating) as avg_rating,
                    SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as lapses
                FROM reviews r
                JOIN cards c ON r.card_id = c.id
                JOIN notes n ON c.note_id = n.id
                WHERE n.deck_id = ?
            `, [deckId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        return {
            cards: cardStats,
            reviews: reviewStats
        };
    }
}