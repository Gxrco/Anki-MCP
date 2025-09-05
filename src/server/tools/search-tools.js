import { getDaysSinceEpoch } from '../../utils/date-utils.js';

export function createSearchTools(db) {
    return [
        {
            name: 'anki_search_cards',
            description: 'Search cards using Anki-style queries',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query (e.g., "deck:Spanish is:due", "tag:pharm prop:ivl>10")'
                    },
                    limit: {
                        type: 'integer',
                        default: 100,
                        description: 'Maximum number of cards to return'
                    }
                },
                required: ['query']
            },
            handler: async (args) => {
                const { query, limit = 100 } = args;
                
                try {
                    const { sql, params } = parseSearchQuery(query);
                    
                    const cards = await new Promise((resolve, reject) => {
                        db.all(`
                            SELECT c.id, c.note_id, c.state, c.due, c.ivl, c.ease, c.reps, c.lapses,
                                   n.fields_json, n.tags, n.model, d.name as deck_name
                            FROM cards c
                            JOIN notes n ON c.note_id = n.id
                            JOIN decks d ON n.deck_id = d.id
                            ${sql}
                            ORDER BY c.due ASC, c.id ASC
                            LIMIT ?
                        `, [...params, limit], (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows);
                        });
                    });

                    return {
                        cards: cards.map(card => ({
                            id: card.id,
                            noteId: card.note_id,
                            state: card.state,
                            due: card.due,
                            ivl: card.ivl,
                            ease: card.ease,
                            reps: card.reps,
                            lapses: card.lapses,
                            deckName: card.deck_name,
                            fields: JSON.parse(card.fields_json),
                            tags: card.tags ? card.tags.split(' ') : [],
                            model: card.model
                        })),
                        total: cards.length
                    };
                } catch (error) {
                    throw new Error(`Search query error: ${error.message}`);
                }
            }
        }
    ];
}

function parseSearchQuery(query) {
    const conditions = [];
    const params = [];
    const tokens = tokenizeQuery(query);
    
    for (const token of tokens) {
        if (token.includes(':')) {
            const [key, value] = token.split(':', 2);
            
            switch (key.toLowerCase()) {
                case 'deck':
                    const deckName = value.replace(/"/g, '');
                    conditions.push('d.name LIKE ?');
                    params.push(`%${deckName}%`);
                    break;
                    
                case 'tag':
                    const tagName = value.replace(/"/g, '');
                    conditions.push('(n.tags LIKE ? OR n.tags LIKE ? OR n.tags LIKE ? OR n.tags = ?)');
                    params.push(`${tagName} %`, `% ${tagName} %`, `% ${tagName}`, tagName);
                    break;
                    
                case 'is':
                    switch (value.toLowerCase()) {
                        case 'due':
                            const today = getDaysSinceEpoch();
                            conditions.push('c.due <= ? AND c.state IN ("review", "learning", "relearning")');
                            params.push(today);
                            break;
                        case 'new':
                            conditions.push('c.state = "new"');
                            break;
                        case 'review':
                            conditions.push('c.state = "review"');
                            break;
                        case 'learning':
                            conditions.push('c.state IN ("learning", "relearning")');
                            break;
                        case 'suspended':
                            conditions.push('c.state = "suspended"');
                            break;
                        case 'buried':
                            conditions.push('c.state = "buried"');
                            break;
                    }
                    break;
                    
                case 'rated':
                    const ratedValue = value.replace(/"/g, '');
                    if (ratedValue.includes('..')) {
                        const [start, end] = ratedValue.split('..').map(Number);
                        const startTs = Math.floor(Date.now() / 1000) - (start * 24 * 60 * 60);
                        const endTs = Math.floor(Date.now() / 1000) - (end * 24 * 60 * 60);
                        conditions.push(`EXISTS (
                            SELECT 1 FROM reviews r 
                            WHERE r.card_id = c.id 
                            AND r.ts BETWEEN ? AND ?
                        )`);
                        params.push(endTs, startTs);
                    } else {
                        const days = Number(ratedValue);
                        const sinceTs = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
                        conditions.push(`EXISTS (
                            SELECT 1 FROM reviews r 
                            WHERE r.card_id = c.id 
                            AND r.ts >= ?
                        )`);
                        params.push(sinceTs);
                    }
                    break;
                    
                case 'prop':
                    const propQuery = value.replace(/"/g, '');
                    if (propQuery.startsWith('ivl>')) {
                        const minIvl = Number(propQuery.substring(4));
                        conditions.push('c.ivl > ?');
                        params.push(minIvl);
                    } else if (propQuery.startsWith('ivl<')) {
                        const maxIvl = Number(propQuery.substring(4));
                        conditions.push('c.ivl < ?');
                        params.push(maxIvl);
                    } else if (propQuery.startsWith('ease>')) {
                        const minEase = Number(propQuery.substring(5));
                        conditions.push('c.ease > ?');
                        params.push(minEase);
                    } else if (propQuery.startsWith('ease<')) {
                        const maxEase = Number(propQuery.substring(5));
                        conditions.push('c.ease < ?');
                        params.push(maxEase);
                    }
                    break;
                    
                case 'note':
                    const noteContent = value.replace(/"/g, '');
                    conditions.push('n.fields_json LIKE ?');
                    params.push(`%${noteContent}%`);
                    break;
            }
        } else {
            // Plain text search in fields
            const plainText = token.replace(/"/g, '');
            if (plainText.trim()) {
                conditions.push('n.fields_json LIKE ?');
                params.push(`%${plainText}%`);
            }
        }
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    return {
        sql: whereClause,
        params
    };
}

function tokenizeQuery(query) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < query.length; i++) {
        const char = query[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
            current += char;
        } else if (char === ' ' && !inQuotes) {
            if (current.trim()) {
                tokens.push(current.trim());
                current = '';
            }
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        tokens.push(current.trim());
    }
    
    return tokens;
}