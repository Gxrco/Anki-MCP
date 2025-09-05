import { getDaysSinceEpoch, getEpochDayFromDate } from '../../utils/date-utils.js';

export function createCardTools(db) {
    return [
        {
            name: 'anki_get_next_card',
            description: 'Get the next card to review from a deck',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'ID of the deck (optional, gets from all decks if not specified)'
                    },
                    includeSubdecks: {
                        type: 'boolean',
                        default: true,
                        description: 'Include cards from subdecks'
                    }
                }
            },
            handler: async (args) => {
                const { deckId, includeSubdecks = true } = args;
                const today = getDaysSinceEpoch();

                let deckFilter = '';
                let params = [today];

                if (deckId) {
                    if (includeSubdecks) {
                        // Get all deck IDs in the hierarchy
                        const deckIds = await getDeckHierarchy(db, deckId);
                        deckFilter = `AND n.deck_id IN (${deckIds.map(() => '?').join(',')})`;
                        params.push(...deckIds);
                    } else {
                        deckFilter = 'AND n.deck_id = ?';
                        params.push(deckId);
                    }
                }

                // Get next card prioritizing: learning -> new -> review
                const sql = `
                    SELECT c.*, n.fields_json, n.tags, n.model, d.config_json
                    FROM cards c
                    JOIN notes n ON c.note_id = n.id
                    JOIN decks d ON n.deck_id = d.id
                    WHERE c.state IN ('learning', 'relearning', 'new', 'review') 
                    AND c.due <= ?
                    ${deckFilter}
                    ORDER BY 
                        CASE c.state
                            WHEN 'learning' THEN 1
                            WHEN 'relearning' THEN 2
                            WHEN 'new' THEN 3
                            WHEN 'review' THEN 4
                        END,
                        c.due ASC,
                        c.queue_position ASC,
                        c.id ASC
                    LIMIT 1
                `;

                const card = await new Promise((resolve, reject) => {
                    db.get(sql, params, (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!card) {
                    return { card: null, queueInfo: await getQueueInfo(db, deckId, includeSubdecks) };
                }

                // Generate question HTML based on model
                const fields = JSON.parse(card.fields_json);
                const questionHtml = generateQuestionHtml(card.model, card.template, fields);

                return {
                    card: {
                        id: card.id,
                        noteId: card.note_id,
                        questionHtml,
                        model: card.model,
                        tags: card.tags ? card.tags.split(' ') : [],
                        state: card.state
                    },
                    queueInfo: await getQueueInfo(db, deckId, includeSubdecks)
                };
            }
        },
        {
            name: 'anki_answer_card',
            description: 'Answer a card with a rating (1=Again, 2=Hard, 3=Good, 4=Easy)',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    cardId: {
                        type: 'integer',
                        description: 'ID of the card to answer'
                    },
                    rating: {
                        type: 'integer',
                        minimum: 1,
                        maximum: 4,
                        description: 'Rating: 1=Again, 2=Hard, 3=Good, 4=Easy'
                    },
                    answeredAt: {
                        type: 'integer',
                        description: 'Timestamp when answered (epoch seconds, optional)'
                    }
                },
                required: ['cardId', 'rating']
            },
            handler: async (args) => {
                const { cardId, rating, answeredAt } = args;
                const timestamp = answeredAt || Math.floor(Date.now() / 1000);

                // Get current card state
                const card = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT c.*, n.deck_id, d.config_json 
                        FROM cards c
                        JOIN notes n ON c.note_id = n.id
                        JOIN decks d ON n.deck_id = d.id
                        WHERE c.id = ?
                    `, [cardId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!card) {
                    throw new Error(`Card not found: ${cardId}`);
                }

                const config = JSON.parse(card.config_json);
                const beforeState = {
                    state: card.state,
                    ivl: card.ivl,
                    ease: card.ease,
                    reps: card.reps,
                    lapses: card.lapses
                };

                // Apply scheduling algorithm (simplified version)
                const afterState = applyScheduling(beforeState, rating, config);

                // Update card
                await new Promise((resolve, reject) => {
                    db.run(`
                        UPDATE cards 
                        SET state = ?, due = ?, ivl = ?, ease = ?, reps = ?, lapses = ?, updated_at = ?
                        WHERE id = ?
                    `, [
                        afterState.state,
                        afterState.due,
                        afterState.ivl,
                        afterState.ease,
                        afterState.reps,
                        afterState.lapses,
                        timestamp,
                        cardId
                    ], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                // Log the review
                const logId = await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO reviews (card_id, ts, rating, ivl_before, ivl_after, ease_before, ease_after, state_before, state_after)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        cardId,
                        timestamp,
                        rating,
                        beforeState.ivl,
                        afterState.ivl,
                        beforeState.ease,
                        afterState.ease,
                        beforeState.state,
                        afterState.state
                    ], function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                });

                return {
                    next: {
                        state: afterState.state,
                        dueTs: afterState.due * 24 * 60 * 60 + timestamp, // Convert epoch day to timestamp
                        ivlDays: afterState.ivl
                    },
                    logId
                };
            }
        },
        {
            name: 'anki_card_info',
            description: 'Get detailed information about a card',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    cardId: {
                        type: 'integer',
                        description: 'ID of the card'
                    }
                },
                required: ['cardId']
            },
            handler: async (args) => {
                const { cardId } = args;

                const card = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT c.*, n.fields_json, n.tags, n.model, d.name as deck_name
                        FROM cards c
                        JOIN notes n ON c.note_id = n.id
                        JOIN decks d ON n.deck_id = d.id
                        WHERE c.id = ?
                    `, [cardId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!card) {
                    throw new Error(`Card not found: ${cardId}`);
                }

                // Get review history
                const reviews = await new Promise((resolve, reject) => {
                    db.all(`
                        SELECT rating, ts, ivl_after, ease_after
                        FROM reviews
                        WHERE card_id = ?
                        ORDER BY ts DESC
                        LIMIT 10
                    `, [cardId], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });

                return {
                    id: card.id,
                    noteId: card.note_id,
                    template: card.template,
                    state: card.state,
                    due: card.due,
                    ivl: card.ivl,
                    ease: card.ease,
                    reps: card.reps,
                    lapses: card.lapses,
                    deckName: card.deck_name,
                    fields: JSON.parse(card.fields_json),
                    tags: card.tags ? card.tags.split(' ') : [],
                    model: card.model,
                    recentReviews: reviews
                };
            }
        }
    ];
}

// Helper functions
async function getDeckHierarchy(db, deckId) {
    const deckIds = [deckId];
    
    // Get all child decks recursively
    const getChildren = async (parentId) => {
        const children = await new Promise((resolve, reject) => {
            db.all('SELECT id FROM decks WHERE parent_id = ?', [parentId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        for (const child of children) {
            deckIds.push(child.id);
            await getChildren(child.id);
        }
    };
    
    await getChildren(deckId);
    return deckIds;
}

async function getQueueInfo(db, deckId, includeSubdecks) {
    const today = getDaysSinceEpoch();
    let deckFilter = '';
    let params = [today, today];
    
    if (deckId) {
        if (includeSubdecks) {
            const deckIds = await getDeckHierarchy(db, deckId);
            deckFilter = `AND n.deck_id IN (${deckIds.map(() => '?').join(',')})`;
            params.push(...deckIds);
            params.push(...deckIds);
        } else {
            deckFilter = 'AND n.deck_id = ?';
            params.push(deckId, deckId);
        }
    }

    const counts = await new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                SUM(CASE WHEN c.state = 'new' AND c.due <= ? THEN 1 ELSE 0 END) as new_count,
                SUM(CASE WHEN c.state IN ('review', 'learning', 'relearning') AND c.due <= ? THEN 1 ELSE 0 END) as review_count
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE c.state NOT IN ('suspended', 'buried')
            ${deckFilter}
        `, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    return {
        remainingToday: {
            new: counts.new_count || 0,
            reviews: counts.review_count || 0
        }
    };
}

function generateQuestionHtml(model, template, fields) {
    switch (model) {
        case 'basic':
            return `<div class="question">${fields.front || ''}</div>`;
        case 'basic_reverse':
            if (template === 'reverse') {
                return `<div class="question">${fields.back || ''}</div>`;
            }
            return `<div class="question">${fields.front || ''}</div>`;
        case 'cloze':
            const clozeNum = parseInt(template.replace('cloze-', ''));
            const text = fields.front || fields.text || '';
            
            // Replace current cloze with [...] and others with their content
            const processed = text.replace(/\{\{c(\d+)::([^}]+)\}\}/g, (match, num, content) => {
                return parseInt(num) === clozeNum ? '[...]' : content;
            });
            
            return `<div class="question">${processed}</div>`;
        default:
            return `<div class="question">${fields.front || ''}</div>`;
    }
}

function applyScheduling(beforeState, rating, config) {
    const afterState = { ...beforeState };
    const today = getDaysSinceEpoch();
    
    // Simplified scheduling algorithm
    switch (beforeState.state) {
        case 'new':
            afterState.reps++;
            if (rating === 1) { // Again
                afterState.state = 'learning';
                afterState.due = today;
                afterState.ivl = 0;
            } else if (rating === 4) { // Easy
                afterState.state = 'review';
                afterState.ivl = Math.ceil(config.graduatingIntervalDays * config.easyBonus);
                afterState.due = today + afterState.ivl;
                afterState.ease = 2.5 + 0.15;
            } else { // Hard or Good
                afterState.state = 'learning';
                afterState.due = today;
                afterState.ivl = 0;
            }
            break;
            
        case 'learning':
        case 'relearning':
            if (rating === 1) { // Again
                afterState.due = today;
                afterState.ivl = 0;
            } else { // Graduate
                afterState.state = 'review';
                afterState.ivl = config.graduatingIntervalDays;
                afterState.due = today + afterState.ivl;
                if (beforeState.state === 'new') {
                    afterState.ease = 2.5;
                }
            }
            break;
            
        case 'review':
            afterState.reps++;
            if (rating === 1) { // Again - lapse
                afterState.lapses++;
                afterState.state = 'relearning';
                afterState.ease = Math.max(config.minEase, afterState.ease - 0.2);
                afterState.due = today;
                afterState.ivl = 0;
            } else {
                const fuzz = (Math.random() - 0.5) * 2 * config.fuzzPercent;
                let multiplier = afterState.ease;
                
                if (rating === 2) { // Hard
                    multiplier = config.hardInterval;
                    afterState.ease = Math.max(config.minEase, afterState.ease - 0.15);
                } else if (rating === 4) { // Easy
                    multiplier = afterState.ease * config.easyBonus;
                    afterState.ease += 0.15;
                }
                
                afterState.ivl = Math.ceil(afterState.ivl * multiplier * (1 + fuzz));
                afterState.due = today + afterState.ivl;
            }
            break;
    }
    
    return afterState;
}