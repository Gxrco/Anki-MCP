import { getDaysSinceEpoch } from '../../utils/date-utils.js';

export class CardRepository {
    constructor(db) {
        this.db = db;
    }

    async create(noteId, template, state = 'new', due = 0, ivl = 0, ease = 2.5) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO cards (note_id, template, state, due, ivl, ease) VALUES (?, ?, ?, ?, ?, ?)',
                [noteId, template, state, due, ivl, ease],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, noteId, template, state, due, ivl, ease, reps: 0, lapses: 0 });
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM cards WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    async findByNoteId(noteId) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM cards WHERE note_id = ? ORDER BY template', [noteId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async findDueCards(deckId = null, includeSubdecks = true, limit = null) {
        const today = getDaysSinceEpoch();
        let deckFilter = '';
        let params = [today];

        if (deckId) {
            if (includeSubdecks) {
                // This would need deck hierarchy logic - simplified for now
                deckFilter = 'AND n.deck_id = ?';
                params.push(deckId);
            } else {
                deckFilter = 'AND n.deck_id = ?';
                params.push(deckId);
            }
        }

        let limitClause = '';
        if (limit) {
            limitClause = 'LIMIT ?';
            params.push(limit);
        }

        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT c.*, n.fields_json, n.tags, n.model, d.name as deck_name, d.config_json
                FROM cards c
                JOIN notes n ON c.note_id = n.id
                JOIN decks d ON n.deck_id = d.id
                WHERE c.due <= ? 
                AND c.state IN ('new', 'learning', 'relearning', 'review')
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
                ${limitClause}
            `, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async findNewCards(deckId = null, includeSubdecks = true, limit = null) {
        let deckFilter = '';
        let params = [];

        if (deckId) {
            deckFilter = 'AND n.deck_id = ?';
            params.push(deckId);
        }

        let limitClause = '';
        if (limit) {
            limitClause = 'LIMIT ?';
            params.push(limit);
        }

        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT c.*, n.fields_json, n.tags, n.model, d.name as deck_name
                FROM cards c
                JOIN notes n ON c.note_id = n.id
                JOIN decks d ON n.deck_id = d.id
                WHERE c.state = 'new' ${deckFilter}
                ORDER BY c.id ASC
                ${limitClause}
            `, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async update(id, updates) {
        const setClause = [];
        const params = [];

        const allowedFields = ['state', 'due', 'ivl', 'ease', 'reps', 'lapses', 'queue_position'];
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClause.push(`${field} = ?`);
                params.push(updates[field]);
            }
        }

        if (setClause.length === 0) {
            return this.findById(id);
        }

        setClause.push('updated_at = ?');
        params.push(Math.floor(Date.now() / 1000));
        params.push(id);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards SET ${setClause.join(', ')} WHERE id = ?`,
                params,
                async (err) => {
                    if (err) reject(err);
                    else {
                        try {
                            const updated = await this.findById(id);
                            resolve(updated);
                        } catch (findErr) {
                            reject(findErr);
                        }
                    }
                }
            );
        });
    }

    async suspend(cardIds) {
        const placeholders = cardIds.map(() => '?').join(',');
        const timestamp = Math.floor(Date.now() / 1000);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards SET state = 'suspended', updated_at = ? WHERE id IN (${placeholders})`,
                [timestamp, ...cardIds],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async unsuspend(cardIds) {
        const placeholders = cardIds.map(() => '?').join(',');
        const timestamp = Math.floor(Date.now() / 1000);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards 
                 SET state = CASE 
                     WHEN reps = 0 THEN 'new' 
                     ELSE 'review' 
                 END, 
                 updated_at = ? 
                 WHERE id IN (${placeholders}) AND state = 'suspended'`,
                [timestamp, ...cardIds],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async bury(cardIds) {
        const placeholders = cardIds.map(() => '?').join(',');
        const timestamp = Math.floor(Date.now() / 1000);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards SET state = 'buried', updated_at = ? WHERE id IN (${placeholders})`,
                [timestamp, ...cardIds],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async unburyAll() {
        const timestamp = Math.floor(Date.now() / 1000);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards 
                 SET state = CASE 
                     WHEN reps = 0 THEN 'new' 
                     ELSE 'review' 
                 END, 
                 updated_at = ? 
                 WHERE state = 'buried'`,
                [timestamp],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async reset(cardIds) {
        const placeholders = cardIds.map(() => '?').join(',');
        const timestamp = Math.floor(Date.now() / 1000);
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE cards 
                 SET state = 'new', due = 0, ivl = 0, ease = 2.5, reps = 0, lapses = 0, updated_at = ? 
                 WHERE id IN (${placeholders})`,
                [timestamp, ...cardIds],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async delete(cardIds) {
        const placeholders = cardIds.map(() => '?').join(',');
        
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM cards WHERE id IN (${placeholders})`,
                cardIds,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    async search(query, limit = 100) {
        // Simplified search - full implementation would parse the query
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT c.*, n.fields_json, n.tags, n.model, d.name as deck_name
                FROM cards c
                JOIN notes n ON c.note_id = n.id
                JOIN decks d ON n.deck_id = d.id
                WHERE n.fields_json LIKE ?
                ORDER BY c.id DESC
                LIMIT ?
            `, [`%${query}%`, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getQueueInfo(deckId = null, includeSubdecks = true) {
        const today = getDaysSinceEpoch();
        let deckFilter = '';
        let params = [today, today];
        
        if (deckId) {
            deckFilter = 'AND n.deck_id = ?';
            params.push(deckId);
            params.push(deckId);
        }

        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    SUM(CASE WHEN c.state = 'new' AND c.due <= ? THEN 1 ELSE 0 END) as new_count,
                    SUM(CASE WHEN c.state IN ('review', 'learning', 'relearning') AND c.due <= ? THEN 1 ELSE 0 END) as review_count
                FROM cards c
                JOIN notes n ON c.note_id = n.id
                WHERE c.state NOT IN ('suspended', 'buried')
                ${deckFilter}
            `, params, (err, row) => {
                if (err) reject(err);
                else resolve({
                    new: row.new_count || 0,
                    reviews: row.review_count || 0
                });
            });
        });
    }
}