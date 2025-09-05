export function createConfigTools(db) {
    return [
        {
            name: 'anki_config_get',
            description: 'Get configuration for a deck',
            mutating: false,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'Deck ID to get configuration for'
                    }
                },
                required: ['deckId']
            },
            handler: async (args) => {
                const { deckId } = args;

                const deck = await new Promise((resolve, reject) => {
                    db.get('SELECT name, config_json FROM decks WHERE id = ?', [deckId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!deck) {
                    throw new Error(`Deck not found: ${deckId}`);
                }

                const config = JSON.parse(deck.config_json);

                return {
                    deckId,
                    deckName: deck.name,
                    config: {
                        ...getDefaultConfig(),
                        ...config
                    }
                };
            }
        },
        {
            name: 'anki_config_set',
            description: 'Update configuration for a deck',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'Deck ID to update configuration for'
                    },
                    patch: {
                        type: 'object',
                        description: 'Configuration values to update',
                        properties: {
                            learningStepsMins: {
                                type: 'array',
                                items: { type: 'number' },
                                description: 'Learning steps in minutes'
                            },
                            graduatingIntervalDays: {
                                type: 'number',
                                description: 'Graduating interval in days'
                            },
                            easyBonus: {
                                type: 'number',
                                minimum: 1.0,
                                description: 'Easy bonus multiplier'
                            },
                            hardInterval: {
                                type: 'number',
                                minimum: 1.0,
                                description: 'Hard interval multiplier'
                            },
                            lapseStepsMins: {
                                type: 'array',
                                items: { type: 'number' },
                                description: 'Relearning steps in minutes'
                            },
                            newPerDay: {
                                type: 'integer',
                                minimum: 0,
                                description: 'Maximum new cards per day'
                            },
                            reviewsPerDay: {
                                type: 'integer',
                                minimum: 0,
                                description: 'Maximum reviews per day'
                            },
                            minEase: {
                                type: 'number',
                                minimum: 1.3,
                                description: 'Minimum ease factor'
                            },
                            leechThreshold: {
                                type: 'integer',
                                minimum: 1,
                                description: 'Number of lapses before card becomes leech'
                            },
                            leechAction: {
                                type: 'string',
                                enum: ['suspend', 'tag'],
                                description: 'Action to take on leeches'
                            },
                            fuzzPercent: {
                                type: 'number',
                                minimum: 0,
                                maximum: 0.5,
                                description: 'Fuzz factor for intervals (0-0.5)'
                            },
                            burySiblings: {
                                type: 'boolean',
                                description: 'Bury sibling cards until next day'
                            }
                        }
                    }
                },
                required: ['deckId', 'patch']
            },
            handler: async (args) => {
                const { deckId, patch } = args;

                // Get current config
                const deck = await new Promise((resolve, reject) => {
                    db.get('SELECT name, config_json FROM decks WHERE id = ?', [deckId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!deck) {
                    throw new Error(`Deck not found: ${deckId}`);
                }

                const currentConfig = JSON.parse(deck.config_json);
                const defaultConfig = getDefaultConfig();
                
                // Merge configurations: default -> current -> patch
                const newConfig = {
                    ...defaultConfig,
                    ...currentConfig,
                    ...patch
                };

                // Validate configuration
                validateConfig(newConfig);

                // Update database
                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE decks SET config_json = ?, updated_at = ? WHERE id = ?',
                        [JSON.stringify(newConfig), Math.floor(Date.now() / 1000), deckId],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                return {
                    deckId,
                    deckName: deck.name,
                    config: newConfig,
                    updated: Object.keys(patch)
                };
            }
        },
        {
            name: 'anki_config_reset',
            description: 'Reset deck configuration to defaults',
            mutating: true,
            inputSchema: {
                type: 'object',
                properties: {
                    deckId: {
                        type: 'integer',
                        description: 'Deck ID to reset configuration for'
                    }
                },
                required: ['deckId']
            },
            handler: async (args) => {
                const { deckId } = args;

                const deck = await new Promise((resolve, reject) => {
                    db.get('SELECT name FROM decks WHERE id = ?', [deckId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (!deck) {
                    throw new Error(`Deck not found: ${deckId}`);
                }

                const defaultConfig = getDefaultConfig();

                await new Promise((resolve, reject) => {
                    db.run(
                        'UPDATE decks SET config_json = ?, updated_at = ? WHERE id = ?',
                        [JSON.stringify(defaultConfig), Math.floor(Date.now() / 1000), deckId],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                return {
                    deckId,
                    deckName: deck.name,
                    config: defaultConfig,
                    message: 'Configuration reset to defaults'
                };
            }
        }
    ];
}

function getDefaultConfig() {
    return {
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
}

function validateConfig(config) {
    const errors = [];

    // Validate learning steps
    if (!Array.isArray(config.learningStepsMins) || config.learningStepsMins.length === 0) {
        errors.push('learningStepsMins must be a non-empty array');
    } else if (config.learningStepsMins.some(step => typeof step !== 'number' || step <= 0)) {
        errors.push('All learning steps must be positive numbers');
    }

    // Validate graduating interval
    if (typeof config.graduatingIntervalDays !== 'number' || config.graduatingIntervalDays <= 0) {
        errors.push('graduatingIntervalDays must be a positive number');
    }

    // Validate easy bonus
    if (typeof config.easyBonus !== 'number' || config.easyBonus < 1.0) {
        errors.push('easyBonus must be a number >= 1.0');
    }

    // Validate hard interval
    if (typeof config.hardInterval !== 'number' || config.hardInterval < 1.0) {
        errors.push('hardInterval must be a number >= 1.0');
    }

    // Validate lapse steps
    if (!Array.isArray(config.lapseStepsMins) || config.lapseStepsMins.length === 0) {
        errors.push('lapseStepsMins must be a non-empty array');
    } else if (config.lapseStepsMins.some(step => typeof step !== 'number' || step <= 0)) {
        errors.push('All lapse steps must be positive numbers');
    }

    // Validate daily limits
    if (!Number.isInteger(config.newPerDay) || config.newPerDay < 0) {
        errors.push('newPerDay must be a non-negative integer');
    }

    if (!Number.isInteger(config.reviewsPerDay) || config.reviewsPerDay < 0) {
        errors.push('reviewsPerDay must be a non-negative integer');
    }

    // Validate minimum ease
    if (typeof config.minEase !== 'number' || config.minEase < 1.3) {
        errors.push('minEase must be a number >= 1.3');
    }

    // Validate leech threshold
    if (!Number.isInteger(config.leechThreshold) || config.leechThreshold < 1) {
        errors.push('leechThreshold must be a positive integer');
    }

    // Validate leech action
    if (!['suspend', 'tag'].includes(config.leechAction)) {
        errors.push('leechAction must be either "suspend" or "tag"');
    }

    // Validate fuzz percent
    if (typeof config.fuzzPercent !== 'number' || config.fuzzPercent < 0 || config.fuzzPercent > 0.5) {
        errors.push('fuzzPercent must be a number between 0 and 0.5');
    }

    // Validate bury siblings
    if (typeof config.burySiblings !== 'boolean') {
        errors.push('burySiblings must be a boolean');
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
}