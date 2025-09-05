# MCP Anki Server

A Model Context Protocol (MCP) server that provides Anki-style flashcard management with spaced repetition scheduling.

## Features

- **Spaced Repetition System (SRS)**: Anki-compatible scheduling algorithm (SM-2 inspired)
- **Deck Management**: Hierarchical deck organization with custom configurations
- **Multiple Note Types**: Basic, basic reverse, cloze deletion, and custom templates
- **Import/Export**: Support for CSV, TSV, JSON, and Markdown formats
- **Search & Filtering**: Anki-style search queries
- **Statistics**: Comprehensive deck and card analytics
- **Media Support**: Images, audio, and other attachments
- **Local-First**: SQLite database with no external dependencies

## Installation

```bash
npm install -g mcp-anki
```

## Usage

### Starting the Server

```bash
# Start with default settings
mcp-anki

# Custom database and media paths
mcp-anki --db-path ~/my-anki.db --media-dir ~/anki-media

# Read-only mode
mcp-anki --readonly

# Enable debug logging
mcp-anki --log-level debug
```

### Environment Variables

```bash
export MCP_ANKI_DB_PATH=~/.mcp-anki/anki.db
export MCP_ANKI_MEDIA_DIR=~/.mcp-anki/media
```

## Available Tools

### Deck Management

- `anki.create_deck` - Create a new deck
- `anki.list_decks` - List all decks with optional hierarchy
- `anki.config_get` - Get deck configuration
- `anki.config_set` - Update deck configuration
- `anki.config_reset` - Reset deck to default configuration

### Note & Card Operations

- `anki.add_note` - Add a new note
- `anki.generate_cards_for_note` - Generate cards from a note
- `anki.get_next_card` - Get next card for review
- `anki.answer_card` - Submit card answer with rating (1-4)
- `anki.card_info` - Get detailed card information

### Search & Filtering

- `anki.search_cards` - Search cards with Anki-style queries

#### Search Examples

```
deck:"Spanish::Basics" is:due          # Due cards in Spanish basics
tag:vocabulary prop:ivl>30             # Vocabulary cards with interval > 30 days
rated:1..7 deck:Medicine               # Cards reviewed in last 7 days
is:new deck:"Programming"              # New cards in Programming deck
note:"furosemida" is:suspended         # Suspended cards containing "furosemida"
```

### Import/Export

- `anki.import` - Import notes from various formats
- `anki.export` - Export deck to JSON or Markdown

#### Import Formats

**CSV/TSV Example:**
```csv
deck,model,front,back,tags,extra
Spanish::Basics,basic,"¿Hola?","Hello","greeting es",""
```

**JSON Example:**
```json
[
  {
    "deck": "Spanish::Basics",
    "model": "basic",
    "fields": {
      "front": "¿Hola?",
      "back": "Hello",
      "extra": ""
    },
    "tags": ["greeting", "es"]
  }
]
```

**Markdown Example:**
```markdown
### Deck: Spanish::Basics
Tags: greeting es
Q: ¿Hola?
A: Hello
---

### Deck: Medicine::Cardio
Cloze: La {{c1::furosemida}} es un {{c2::diurético de asa}}.
Tags: pharm cardio
```

### Card State Management

- `anki.suspend_cards` - Suspend cards
- `anki.unsuspend_cards` - Unsuspend cards
- `anki.bury_cards` - Bury cards until tomorrow
- `anki.unbury_cards` - Unbury cards
- `anki.reset_cards` - Reset cards to new state
- `anki.delete_cards` - Permanently delete cards

### Statistics

- `anki.stats` - Get comprehensive deck statistics

## Database Schema

The server uses SQLite with the following main tables:

- **decks** - Deck information and configuration
- **notes** - Note content and metadata
- **cards** - Individual cards with scheduling data
- **reviews** - Review history log
- **media** - Media file references

## Configuration

Deck configurations support the following parameters:

```json
{
  "learningStepsMins": [1, 10],
  "graduatingIntervalDays": 1,
  "easyBonus": 1.3,
  "hardInterval": 1.2,
  "lapseStepsMins": [10],
  "newPerDay": 20,
  "reviewsPerDay": 200,
  "minEase": 1.3,
  "leechThreshold": 8,
  "leechAction": "suspend",
  "fuzzPercent": 0.05,
  "burySiblings": true
}
```

## Card States

- **new** - Never reviewed
- **learning** - In initial learning steps
- **review** - Graduated to spaced repetition
- **relearning** - Failed review, back in learning
- **suspended** - Manually suspended or leech
- **buried** - Hidden until next day

## Rating System

When answering cards:
- **1 (Again)** - Incorrect, repeat soon
- **2 (Hard)** - Correct but difficult, shorter interval
- **3 (Good)** - Correct, normal interval
- **4 (Easy)** - Too easy, longer interval

## Development

```bash
# Clone repository
git clone <repository-url>
cd mcp-anki

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for distribution
npm run build
```

## License

MIT License - see LICENSE file for details.