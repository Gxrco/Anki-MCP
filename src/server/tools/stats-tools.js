import { getDaysSinceEpoch } from '../../utils/date-utils.js';

export function createStatsTools(db) {
    return [
        {
            name: 'anki_stats',
            description: 'Get statistics for a deck over a specified time range',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'Deck ID to get stats for (optional, all decks if not specified)'
                    },
                    range: {
                        type: 'string',
                        enum: ['today', '7d', '30d', 'all'],
                        default: '30d',
                        description: 'Time range for statistics'
                    },
                    includeSubdecks: {
                        type: 'boolean',
                        default: true,
                        description: 'Include statistics from subdecks'
                    }
                }
            },
            handler: async (args) => {
                const { deckId, range = '30d', includeSubdecks = true } = args;
                const today = getDaysSinceEpoch();
                
                // Calculate time range
                let startDate = 0;
                switch (range) {
                    case 'today':
                        startDate = today;
                        break;
                    case '7d':
                        startDate = today - 7;
                        break;
                    case '30d':
                        startDate = today - 30;
                        break;
                    case 'all':
                        startDate = 0;
                        break;
                }

                const startTimestamp = startDate * 24 * 60 * 60;
                
                // Build deck filter
                let deckFilter = '';
                let deckParams = [];
                
                if (deckId) {
                    if (includeSubdecks) {
                        const deckIds = await getDeckHierarchy(db, deckId);
                        deckFilter = `AND n.deck_id IN (${deckIds.map(() => '?').join(',')})`;
                        deckParams = deckIds;
                    } else {
                        deckFilter = 'AND n.deck_id = ?';
                        deckParams = [deckId];
                    }
                }

                // Get basic counts
                const counts = await getBasicCounts(db, startTimestamp, deckFilter, deckParams);
                
                // Get review history by day
                const histories = await getReviewHistories(db, startTimestamp, deckFilter, deckParams);
                
                // Get due cards breakdown
                const due = await getDueBreakdown(db, today, deckFilter, deckParams);
                
                // Get ease distribution
                const easeDistribution = await getEaseDistribution(db, deckFilter, deckParams);
                
                // Get interval distribution
                const intervalDistribution = await getIntervalDistribution(db, deckFilter, deckParams);

                return {
                    range,
                    deckId: deckId || null,
                    includeSubdecks,
                    counts,
                    histories,
                    due,
                    distributions: {
                        ease: easeDistribution,
                        intervals: intervalDistribution
                    }
                };
            }
        }
    ];
}

async function getDeckHierarchy(db, deckId) {
    const deckIds = [deckId];
    
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

async function getBasicCounts(db, startTimestamp, deckFilter, deckParams) {
    const params = [startTimestamp, ...deckParams, startTimestamp, ...deckParams, startTimestamp, ...deckParams];
    
    const result = await new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                -- New notes added in period
                (SELECT COUNT(*) FROM notes n WHERE n.created_at >= ? ${deckFilter}) as newAdded,
                
                -- Reviews done in period
                (SELECT COUNT(*) FROM reviews r 
                 JOIN cards c ON r.card_id = c.id 
                 JOIN notes n ON c.note_id = n.id 
                 WHERE r.ts >= ? ${deckFilter}) as reviewsDone,
                
                -- Lapses in period (rating = 1)
                (SELECT COUNT(*) FROM reviews r 
                 JOIN cards c ON r.card_id = c.id 
                 JOIN notes n ON c.note_id = n.id 
                 WHERE r.ts >= ? AND r.rating = 1 ${deckFilter}) as lapses
        `, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    // Get current card state counts
    const stateParams = [...deckParams];
    const stateCounts = await new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_cards,
                SUM(CASE WHEN c.state = 'learning' THEN 1 ELSE 0 END) as learning_cards,
                SUM(CASE WHEN c.state = 'review' THEN 1 ELSE 0 END) as review_cards,
                SUM(CASE WHEN c.state = 'suspended' THEN 1 ELSE 0 END) as suspended_cards,
                COUNT(*) as total_cards
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE 1=1 ${deckFilter}
        `, stateParams, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    return {
        newAdded: result.newAdded || 0,
        reviewsDone: result.reviewsDone || 0,
        lapses: result.lapses || 0,
        cardStates: {
            new: stateCounts.new_cards || 0,
            learning: stateCounts.learning_cards || 0,
            review: stateCounts.review_cards || 0,
            suspended: stateCounts.suspended_cards || 0,
            total: stateCounts.total_cards || 0
        }
    };
}

async function getReviewHistories(db, startTimestamp, deckFilter, deckParams) {
    const params = [startTimestamp, ...deckParams];
    
    const reviews = await new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                DATE(r.ts, 'unixepoch') as day,
                COUNT(*) as reviews,
                AVG(CASE WHEN r.rating = 1 THEN 0 ELSE 1 END) as success_rate,
                SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) as lapses
            FROM reviews r
            JOIN cards c ON r.card_id = c.id
            JOIN notes n ON c.note_id = n.id
            WHERE r.ts >= ? ${deckFilter}
            GROUP BY DATE(r.ts, 'unixepoch')
            ORDER BY day DESC
            LIMIT 30
        `, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    return {
        byDay: reviews.map(row => ({
            day: row.day,
            reviews: row.reviews,
            successRate: Math.round((row.success_rate || 0) * 100),
            lapses: row.lapses || 0
        }))
    };
}

async function getDueBreakdown(db, today, deckFilter, deckParams) {
    const params = [today, ...deckParams, today + 7, today, ...deckParams];
    
    const result = await new Promise((resolve, reject) => {
        db.get(`
            SELECT 
                -- Due today
                (SELECT COUNT(*) FROM cards c 
                 JOIN notes n ON c.note_id = n.id 
                 WHERE c.due <= ? AND c.state IN ('new', 'learning', 'review', 'relearning') ${deckFilter}) as today,
                 
                -- Due in next 7 days
                (SELECT COUNT(*) FROM cards c 
                 JOIN notes n ON c.note_id = n.id 
                 WHERE c.due BETWEEN ? AND ? AND c.state IN ('new', 'learning', 'review', 'relearning') ${deckFilter}) as future7d
        `, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    return {
        today: result.today || 0,
        future7d: result.future7d || 0
    };
}

async function getEaseDistribution(db, deckFilter, deckParams) {
    const result = await new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                CASE 
                    WHEN c.ease < 2.0 THEN '< 2.0'
                    WHEN c.ease < 2.5 THEN '2.0 - 2.5'
                    WHEN c.ease < 3.0 THEN '2.5 - 3.0'
                    WHEN c.ease < 3.5 THEN '3.0 - 3.5'
                    ELSE '>= 3.5'
                END as ease_range,
                COUNT(*) as count
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE c.state = 'review' ${deckFilter}
            GROUP BY ease_range
            ORDER BY ease_range
        `, deckParams, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    return result.map(row => ({
        range: row.ease_range,
        count: row.count
    }));
}

async function getIntervalDistribution(db, deckFilter, deckParams) {
    const result = await new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                CASE 
                    WHEN c.ivl = 0 THEN '0 days'
                    WHEN c.ivl <= 7 THEN '1-7 days'
                    WHEN c.ivl <= 30 THEN '1-4 weeks'
                    WHEN c.ivl <= 90 THEN '1-3 months'
                    WHEN c.ivl <= 365 THEN '3-12 months'
                    ELSE '> 1 year'
                END as interval_range,
                COUNT(*) as count,
                AVG(c.ivl) as avg_interval
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE c.state IN ('learning', 'review', 'relearning') ${deckFilter}
            GROUP BY interval_range
            ORDER BY MIN(c.ivl)
        `, deckParams, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    return result.map(row => ({
        range: row.interval_range,
        count: row.count,
        avgInterval: Math.round(row.avg_interval || 0)
    }));
}