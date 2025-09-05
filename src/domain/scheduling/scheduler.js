import { getDaysSinceEpoch } from '../../utils/date-utils.js';

export class Scheduler {
    constructor(config) {
        this.config = {
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
            burySiblings: true,
            ...config
        };
    }

    // Apply scheduling algorithm to a card
    scheduleCard(card, rating, timestamp = null) {
        const ts = timestamp || Math.floor(Date.now() / 1000);
        const today = getDaysSinceEpoch();
        
        const beforeState = {
            state: card.state,
            due: card.due,
            ivl: card.ivl,
            ease: card.ease,
            reps: card.reps,
            lapses: card.lapses
        };

        const afterState = { ...beforeState };

        switch (card.state) {
            case 'new':
                afterState.reps++;
                this.scheduleNewCard(afterState, rating, today);
                break;
                
            case 'learning':
            case 'relearning':
                this.scheduleLearningCard(afterState, rating, today);
                break;
                
            case 'review':
                afterState.reps++;
                this.scheduleReviewCard(afterState, rating, today);
                break;
                
            default:
                throw new Error(`Invalid card state: ${card.state}`);
        }

        return {
            beforeState,
            afterState,
            timestamp: ts
        };
    }

    scheduleNewCard(state, rating, today) {
        switch (rating) {
            case 1: // Again
                state.state = 'learning';
                state.due = today;
                state.ivl = 0;
                break;
                
            case 2: // Hard
            case 3: // Good
                state.state = 'learning';
                state.due = today;
                state.ivl = 0;
                break;
                
            case 4: // Easy
                state.state = 'review';
                state.ivl = Math.ceil(this.config.graduatingIntervalDays * this.config.easyBonus);
                state.due = today + state.ivl;
                state.ease = 2.5 + 0.15;
                break;
        }
    }

    scheduleLearningCard(state, rating, today) {
        const isRelearning = state.state === 'relearning';
        const steps = isRelearning ? this.config.lapseStepsMins : this.config.learningStepsMins;
        
        switch (rating) {
            case 1: // Again - back to first step
                state.due = today;
                state.ivl = 0;
                break;
                
            case 2: // Hard
            case 3: // Good
            case 4: // Easy
                // Graduate to review
                state.state = 'review';
                state.ivl = this.config.graduatingIntervalDays;
                state.due = today + state.ivl;
                
                if (state.ease === 2.5) { // First time graduating
                    state.ease = 2.5;
                }
                
                if (rating === 4) { // Easy
                    state.ivl = Math.ceil(state.ivl * this.config.easyBonus);
                    state.due = today + state.ivl;
                    state.ease += 0.15;
                }
                break;
        }
    }

    scheduleReviewCard(state, rating, today) {
        switch (rating) {
            case 1: // Again - lapse
                state.lapses++;
                state.state = 'relearning';
                state.ease = Math.max(this.config.minEase, state.ease - 0.2);
                state.due = today;
                state.ivl = 0;
                
                // Check for leech
                if (state.lapses >= this.config.leechThreshold) {
                    if (this.config.leechAction === 'suspend') {
                        state.state = 'suspended';
                    }
                    // Note: leech tagging would be handled at a higher level
                }
                break;
                
            case 2: // Hard
                state.ease = Math.max(this.config.minEase, state.ease - 0.15);
                state.ivl = Math.ceil(state.ivl * this.config.hardInterval * this.getFuzzFactor());
                state.due = today + state.ivl;
                break;
                
            case 3: // Good
                state.ivl = Math.ceil(state.ivl * state.ease * this.getFuzzFactor());
                state.due = today + state.ivl;
                break;
                
            case 4: // Easy
                state.ease += 0.15;
                state.ivl = Math.ceil(state.ivl * state.ease * this.config.easyBonus * this.getFuzzFactor());
                state.due = today + state.ivl;
                break;
        }
        
        // Ensure minimum interval
        if (state.ivl < 1) {
            state.ivl = 1;
            state.due = today + 1;
        }
    }

    getFuzzFactor() {
        const fuzz = this.config.fuzzPercent;
        return 1 + (Math.random() - 0.5) * 2 * fuzz;
    }

    // Check if card should be buried due to sibling cards
    shouldBurySiblings(card, answeredCards, config) {
        if (!config.burySiblings) {
            return false;
        }

        // Check if any sibling cards from the same note were answered today
        const today = getDaysSinceEpoch();
        const todayAnswered = answeredCards.filter(c => 
            c.note_id === card.note_id && 
            c.id !== card.id &&
            Math.floor(c.answered_timestamp / (24 * 60 * 60)) === today
        );

        return todayAnswered.length > 0;
    }

    // Calculate next review times for different ratings
    getAnswerButtons(card) {
        const today = getDaysSinceEpoch();
        const buttons = [];

        switch (card.state) {
            case 'new':
                buttons.push({
                    rating: 1,
                    label: 'Again',
                    interval: '< 1m',
                    nextState: 'learning'
                });
                buttons.push({
                    rating: 2,
                    label: 'Hard',
                    interval: '< 6m',
                    nextState: 'learning'
                });
                buttons.push({
                    rating: 3,
                    label: 'Good',
                    interval: '< 10m',
                    nextState: 'learning'
                });
                buttons.push({
                    rating: 4,
                    label: 'Easy',
                    interval: `${Math.ceil(this.config.graduatingIntervalDays * this.config.easyBonus)}d`,
                    nextState: 'review'
                });
                break;
                
            case 'learning':
            case 'relearning':
                buttons.push({
                    rating: 1,
                    label: 'Again',
                    interval: '< 1m',
                    nextState: card.state
                });
                buttons.push({
                    rating: 3,
                    label: 'Good',
                    interval: `${this.config.graduatingIntervalDays}d`,
                    nextState: 'review'
                });
                buttons.push({
                    rating: 4,
                    label: 'Easy',
                    interval: `${Math.ceil(this.config.graduatingIntervalDays * this.config.easyBonus)}d`,
                    nextState: 'review'
                });
                break;
                
            case 'review':
                const hardIvl = Math.ceil(card.ivl * this.config.hardInterval);
                const goodIvl = Math.ceil(card.ivl * card.ease);
                const easyIvl = Math.ceil(card.ivl * card.ease * this.config.easyBonus);
                
                buttons.push({
                    rating: 1,
                    label: 'Again',
                    interval: '< 10m',
                    nextState: 'relearning'
                });
                buttons.push({
                    rating: 2,
                    label: 'Hard',
                    interval: `${hardIvl}d`,
                    nextState: 'review'
                });
                buttons.push({
                    rating: 3,
                    label: 'Good',
                    interval: `${goodIvl}d`,
                    nextState: 'review'
                });
                buttons.push({
                    rating: 4,
                    label: 'Easy',
                    interval: `${easyIvl}d`,
                    nextState: 'review'
                });
                break;
        }

        return buttons;
    }

    // Get daily limits for new and review cards
    getDailyLimits() {
        return {
            newPerDay: this.config.newPerDay,
            reviewsPerDay: this.config.reviewsPerDay
        };
    }

    // Check if a card is a leech
    isLeech(card) {
        return card.lapses >= this.config.leechThreshold;
    }

    // Update configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
}