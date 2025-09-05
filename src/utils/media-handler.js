import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export class MediaHandler {
    constructor(mediaDir = null) {
        this.mediaDir = mediaDir || this.getDefaultMediaDir();
        this.ensureMediaDir();
    }

    getDefaultMediaDir() {
        const homeDir = os.homedir();
        return path.join(homeDir, '.mcp-anki', 'media');
    }

    ensureMediaDir() {
        if (!fs.existsSync(this.mediaDir)) {
            fs.mkdirSync(this.mediaDir, { recursive: true });
        }
    }

    // Calculate hash for file content
    calculateHash(buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    // Process media file - copy to media dir and return hash
    async processMediaFile(filePath, originalName = null) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`Media file not found: ${filePath}`);
            }

            const buffer = await fs.promises.readFile(filePath);
            const hash = this.calculateHash(buffer);
            const extension = path.extname(originalName || filePath);
            const mediaFileName = `${hash}${extension}`;
            const mediaFilePath = path.join(this.mediaDir, mediaFileName);

            // Copy to media directory if not already exists
            if (!fs.existsSync(mediaFilePath)) {
                await fs.promises.copyFile(filePath, mediaFilePath);
            }

            // Get file stats
            const stats = fs.statSync(mediaFilePath);
            const mime = this.getMimeType(extension);

            return {
                hash,
                path: mediaFilePath,
                relativePath: mediaFileName,
                mime,
                size: stats.size,
                originalName: originalName || path.basename(filePath)
            };
        } catch (error) {
            throw new Error(`Failed to process media file: ${error.message}`);
        }
    }

    // Process data URI - extract and save to media dir
    async processDataUri(dataUri) {
        try {
            const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) {
                throw new Error('Invalid data URI format');
            }

            const [, mimeType, base64Data] = match;
            const buffer = Buffer.from(base64Data, 'base64');
            const hash = this.calculateHash(buffer);
            
            // Determine extension from MIME type
            const extension = this.getExtensionFromMime(mimeType);
            const mediaFileName = `${hash}${extension}`;
            const mediaFilePath = path.join(this.mediaDir, mediaFileName);

            // Save to media directory if not already exists
            if (!fs.existsSync(mediaFilePath)) {
                await fs.promises.writeFile(mediaFilePath, buffer);
            }

            return {
                hash,
                path: mediaFilePath,
                relativePath: mediaFileName,
                mime: mimeType,
                size: buffer.length,
                originalName: `data_${hash}${extension}`
            };
        } catch (error) {
            throw new Error(`Failed to process data URI: ${error.message}`);
        }
    }

    // Store media reference in database
    async storeMediaReference(db, mediaInfo) {
        return new Promise((resolve, reject) => {
            db.run(
                'INSERT OR IGNORE INTO media (hash, path, mime, size) VALUES (?, ?, ?, ?)',
                [mediaInfo.hash, mediaInfo.relativePath, mediaInfo.mime, mediaInfo.size],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID || this.changes);
                }
            );
        });
    }

    // Get media info from database by hash
    async getMediaByHash(db, hash) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM media WHERE hash = ?', [hash], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Clean unused media files
    async cleanUnusedMedia(db) {
        // Get all media hashes referenced in notes
        const referencedHashes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT DISTINCT 
                    SUBSTR(fields_json, 
                           INSTR(fields_json, '"') + 1,
                           INSTR(SUBSTR(fields_json, INSTR(fields_json, '"') + 1), '"') - 1
                    ) as hash
                FROM notes
                WHERE fields_json LIKE '%media%'
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(new Set(rows.map(r => r.hash).filter(h => h && h.length === 64)));
            });
        });

        // Get all media files in database
        const allMedia = await new Promise((resolve, reject) => {
            db.all('SELECT hash, path FROM media', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const cleanedFiles = [];
        for (const media of allMedia) {
            if (!referencedHashes.has(media.hash)) {
                const fullPath = path.join(this.mediaDir, media.path);
                try {
                    if (fs.existsSync(fullPath)) {
                        await fs.promises.unlink(fullPath);
                    }
                    await new Promise((resolve, reject) => {
                        db.run('DELETE FROM media WHERE hash = ?', [media.hash], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    cleanedFiles.push(media.hash);
                } catch (error) {
                    console.error(`Failed to clean media file ${media.hash}:`, error);
                }
            }
        }

        return cleanedFiles;
    }

    // Get MIME type from file extension
    getMimeType(extension) {
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.ogv': 'video/ogg'
        };
        return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
    }

    // Get file extension from MIME type
    getExtensionFromMime(mimeType) {
        const extensionMap = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg',
            'audio/mp4': '.m4a',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/ogg': '.ogv'
        };
        return extensionMap[mimeType] || '.bin';
    }

    // Replace media references in HTML with hash-based references
    replaceMediaReferences(html, mediaMap) {
        let processedHtml = html;
        
        for (const [originalSrc, mediaInfo] of mediaMap) {
            // Replace image sources
            processedHtml = processedHtml.replace(
                new RegExp(`src=['"]${originalSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'gi'),
                `src="media:${mediaInfo.hash}"`
            );
            
            // Replace Anki-style sound references
            processedHtml = processedHtml.replace(
                new RegExp(`\\[sound:${originalSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'gi'),
                `[sound:${mediaInfo.hash}${path.extname(mediaInfo.originalName)}]`
            );
        }
        
        return processedHtml;
    }

    // Restore media references from hash-based to file paths
    restoreMediaReferences(html, mediaMap) {
        let processedHtml = html;
        
        for (const [hash, mediaInfo] of mediaMap) {
            // Restore image sources
            processedHtml = processedHtml.replace(
                new RegExp(`src=['"]media:${hash}['"]`, 'gi'),
                `src="file://${mediaInfo.path}"`
            );
            
            // Restore Anki-style sound references
            processedHtml = processedHtml.replace(
                new RegExp(`\\[sound:${hash}[^\\]]*\\]`, 'gi'),
                `[sound:${mediaInfo.path}]`
            );
        }
        
        return processedHtml;
    }
}