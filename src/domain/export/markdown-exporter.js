export class MarkdownExporter {
    constructor(db) {
        this.db = db;
    }

    async export(deckId, options = {}) {
        const { includeStats = false } = options;
        
        // Get deck info
        const deck = await this.getDeck(deckId);
        
        // Get all notes for this deck
        const notes = await this.getNotes(deckId);
        
        let markdown = '';
        
        // Header
        markdown += `# ${deck.name}\n\n`;
        markdown += `Exported on: ${new Date().toISOString()}\n`;
        markdown += `Total notes: ${notes.length}\n\n`;
        
        if (includeStats) {
            const stats = await this.getStats(deckId);
            markdown += `## Statistics\n\n`;
            markdown += `- Total cards: ${stats.cards.total_cards}\n`;
            markdown += `- New cards: ${stats.cards.new_cards}\n`;
            markdown += `- Learning cards: ${stats.cards.learning_cards}\n`;
            markdown += `- Review cards: ${stats.cards.review_cards}\n`;
            markdown += `- Suspended cards: ${stats.cards.suspended_cards}\n`;
            if (stats.cards.avg_interval) {
                markdown += `- Average interval: ${Math.round(stats.cards.avg_interval)} days\n`;
            }
            if (stats.cards.avg_ease) {
                markdown += `- Average ease: ${Math.round(stats.cards.avg_ease * 100) / 100}\n`;
            }
            markdown += `\n`;
        }
        
        markdown += `## Cards\n\n`;
        
        // Process each note
        for (const note of notes) {
            const fields = JSON.parse(note.fields_json);
            const tags = note.tags ? note.tags.split(' ') : [];
            
            markdown += `### Deck: ${deck.name}\n`;
            
            if (tags.length > 0) {
                markdown += `Tags: ${tags.join(' ')}\n`;
            }
            
            if (note.model) {
                markdown += `Model: ${note.model}\n`;
            }
            
            // Format based on model type
            switch (note.model) {
                case 'basic':
                    markdown += `Q: ${fields.front || ''}\n`;
                    markdown += `A: ${fields.back || ''}\n`;
                    if (fields.extra) {
                        markdown += `Extra: ${fields.extra}\n`;
                    }
                    break;
                    
                case 'basic_reverse':
                    markdown += `Q: ${fields.front || ''}\n`;
                    markdown += `A: ${fields.back || ''}\n`;
                    if (fields.extra) {
                        markdown += `Extra: ${fields.extra}\n`;
                    }
                    break;
                    
                case 'cloze':
                    markdown += `Cloze: ${fields.front || fields.text || ''}\n`;
                    if (fields.extra) {
                        markdown += `Extra: ${fields.extra}\n`;
                    }
                    break;
                    
                default:
                    // Custom model - export all fields
                    Object.entries(fields).forEach(([key, value]) => {
                        if (value) {
                            markdown += `${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}\n`;
                        }
                    });
                    break;
            }
            
            markdown += `\n---\n\n`;
        }
        
        return markdown;
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
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM notes WHERE deck_id = ? ORDER BY id', [deckId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
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

        return { cards: cardStats };
    }
}