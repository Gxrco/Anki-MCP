export class DeckRepository {
    constructor(db) {
        this.db = db;
    }

    async create(name, parentId = null, config = null) {
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

        const finalConfig = { ...defaultConfig, ...config };

        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO decks (name, parent_id, config_json) VALUES (?, ?, ?)',
                [name, parentId, JSON.stringify(finalConfig)],
                function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID, name, parentId, config: finalConfig });
                }
            );
        });
    }

    async findById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM decks WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else if (row) {
                    resolve({
                        ...row,
                        config: JSON.parse(row.config_json)
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async findByName(name) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM decks WHERE name = ?', [name], (err, row) => {
                if (err) reject(err);
                else if (row) {
                    resolve({
                        ...row,
                        config: JSON.parse(row.config_json)
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async findAll() {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM decks ORDER BY name', (err, rows) => {
                if (err) reject(err);
                else {
                    const decks = rows.map(row => ({
                        ...row,
                        config: JSON.parse(row.config_json)
                    }));
                    resolve(decks);
                }
            });
        });
    }

    async findChildren(parentId) {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM decks WHERE parent_id = ? ORDER BY name', [parentId], (err, rows) => {
                if (err) reject(err);
                else {
                    const decks = rows.map(row => ({
                        ...row,
                        config: JSON.parse(row.config_json)
                    }));
                    resolve(decks);
                }
            });
        });
    }

    async findHierarchy(deckId) {
        const deckIds = [deckId];
        
        const getChildren = async (parentId) => {
            const children = await this.findChildren(parentId);
            for (const child of children) {
                deckIds.push(child.id);
                await getChildren(child.id);
            }
        };
        
        await getChildren(deckId);
        return deckIds;
    }

    async updateConfig(id, config) {
        const currentDeck = await this.findById(id);
        if (!currentDeck) {
            throw new Error(`Deck not found: ${id}`);
        }

        const newConfig = { ...currentDeck.config, ...config };

        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE decks SET config_json = ?, updated_at = ? WHERE id = ?',
                [JSON.stringify(newConfig), Math.floor(Date.now() / 1000), id],
                function(err) {
                    if (err) reject(err);
                    else resolve({ ...currentDeck, config: newConfig });
                }
            );
        });
    }

    async update(id, updates) {
        const setClause = [];
        const params = [];

        if (updates.name) {
            setClause.push('name = ?');
            params.push(updates.name);
        }

        if (updates.parent_id !== undefined) {
            setClause.push('parent_id = ?');
            params.push(updates.parent_id);
        }

        if (updates.config) {
            setClause.push('config_json = ?');
            params.push(JSON.stringify(updates.config));
        }

        if (setClause.length === 0) {
            return this.findById(id);
        }

        setClause.push('updated_at = ?');
        params.push(Math.floor(Date.now() / 1000));
        params.push(id);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE decks SET ${setClause.join(', ')} WHERE id = ?`,
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

    async delete(id) {
        // Check if deck has children
        const children = await this.findChildren(id);
        if (children.length > 0) {
            throw new Error('Cannot delete deck with child decks');
        }

        // Check if deck has notes
        const hasNotes = await new Promise((resolve, reject) => {
            this.db.get('SELECT COUNT(*) as count FROM notes WHERE deck_id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row.count > 0);
            });
        });

        if (hasNotes) {
            throw new Error('Cannot delete deck with notes');
        }

        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM decks WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    }

    async getStats(id, includeSubdecks = true) {
        let deckIds = [id];
        
        if (includeSubdecks) {
            deckIds = await this.findHierarchy(id);
        }

        const placeholders = deckIds.map(() => '?').join(',');

        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    COUNT(DISTINCT n.id) as total_notes,
                    COUNT(c.id) as total_cards,
                    SUM(CASE WHEN c.state = 'new' THEN 1 ELSE 0 END) as new_cards,
                    SUM(CASE WHEN c.state = 'learning' THEN 1 ELSE 0 END) as learning_cards,
                    SUM(CASE WHEN c.state = 'review' THEN 1 ELSE 0 END) as review_cards,
                    SUM(CASE WHEN c.state = 'suspended' THEN 1 ELSE 0 END) as suspended_cards,
                    AVG(CASE WHEN c.state = 'review' THEN c.ivl ELSE NULL END) as avg_interval,
                    AVG(CASE WHEN c.state = 'review' THEN c.ease ELSE NULL END) as avg_ease
                FROM notes n
                LEFT JOIN cards c ON n.id = c.note_id
                WHERE n.deck_id IN (${placeholders})
            `, deckIds, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}