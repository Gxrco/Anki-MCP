import sanitizeHtml from 'sanitize-html';

const allowedTags = [
    'b', 'i', 'u', 'strong', 'em', 'code', 'pre', 'br', 'p', 'div', 'span',
    'img', 'audio', 'video', 'source',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'tr', 'td', 'th', 'tbody', 'thead',
    'a', 'sup', 'sub',
    'blockquote'
];

const allowedAttributes = {
    '*': ['class', 'id', 'style'],
    'img': ['src', 'alt', 'width', 'height', 'title'],
    'audio': ['src', 'controls', 'preload'],
    'video': ['src', 'controls', 'width', 'height', 'preload'],
    'source': ['src', 'type'],
    'a': ['href', 'target', 'title'],
    'table': ['border', 'cellpadding', 'cellspacing'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan']
};

const allowedSchemes = ['http', 'https', 'data', 'file'];

export function sanitizeHtml(dirty) {
    if (!dirty || typeof dirty !== 'string') {
        return '';
    }

    return sanitizeHtml(dirty, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
        allowedSchemes: allowedSchemes,
        allowedSchemesByTag: {
            img: ['http', 'https', 'data', 'file'],
            audio: ['http', 'https', 'data', 'file'],
            video: ['http', 'https', 'data', 'file'],
            source: ['http', 'https', 'data', 'file'],
            a: ['http', 'https', 'mailto']
        },
        allowedSchemesAppliedToAttributes: ['href', 'src'],
        transformTags: {
            // Convert dangerous script tags to text
            'script': sanitizeHtml.simpleTransform('code'),
            'object': sanitizeHtml.simpleTransform('div'),
            'embed': sanitizeHtml.simpleTransform('div'),
            'iframe': sanitizeHtml.simpleTransform('div'),
            
            // Ensure external links open in new tab
            'a': function(tagName, attribs) {
                if (attribs.href && (attribs.href.startsWith('http://') || attribs.href.startsWith('https://'))) {
                    return {
                        tagName: 'a',
                        attribs: {
                            ...attribs,
                            target: '_blank',
                            rel: 'noopener noreferrer'
                        }
                    };
                }
                return {
                    tagName: 'a',
                    attribs: attribs
                };
            }
        },
        allowedIframeHostnames: [], // No iframes allowed
        allowedIframeDomains: [], // No iframes allowed
        
        // Custom parser for style attributes
        parser: {
            lowerCaseAttributeNames: false
        }
    });
}

export function sanitizeField(field) {
    if (!field || typeof field !== 'string') {
        return '';
    }
    
    // Basic sanitization for field content
    return sanitizeHtml(field);
}

export function sanitizeFields(fields) {
    if (!fields || typeof fields !== 'object') {
        return {};
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'string') {
            sanitized[key] = sanitizeField(value);
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
}

// Helper function to extract and validate media references
export function extractMediaReferences(html) {
    const mediaRefs = [];
    
    // Extract image sources
    const imgMatches = html.match(/<img[^>]+src=['"]([^'"]+)['"]/gi) || [];
    for (const match of imgMatches) {
        const srcMatch = match.match(/src=['"]([^'"]+)['"]/i);
        if (srcMatch) {
            mediaRefs.push({
                type: 'image',
                src: srcMatch[1],
                tag: 'img'
            });
        }
    }
    
    // Extract audio sources
    const audioMatches = html.match(/<audio[^>]+src=['"]([^'"]+)['"]/gi) || [];
    for (const match of audioMatches) {
        const srcMatch = match.match(/src=['"]([^'"]+)['"]/i);
        if (srcMatch) {
            mediaRefs.push({
                type: 'audio',
                src: srcMatch[1],
                tag: 'audio'
            });
        }
    }
    
    // Extract video sources
    const videoMatches = html.match(/<video[^>]+src=['"]([^'"]+)['"]/gi) || [];
    for (const match of videoMatches) {
        const srcMatch = match.match(/src=['"]([^'"]+)['"]/i);
        if (srcMatch) {
            mediaRefs.push({
                type: 'video',
                src: srcMatch[1],
                tag: 'video'
            });
        }
    }
    
    // Extract Anki-style [sound:...] references
    const soundMatches = html.match(/\[sound:([^\]]+)\]/gi) || [];
    for (const match of soundMatches) {
        const fileMatch = match.match(/\[sound:([^\]]+)\]/i);
        if (fileMatch) {
            mediaRefs.push({
                type: 'sound',
                src: fileMatch[1],
                tag: 'anki-sound'
            });
        }
    }
    
    return mediaRefs;
}

// Validate that media references are safe
export function validateMediaReference(src) {
    if (!src || typeof src !== 'string') {
        return false;
    }
    
    // Allow data URIs
    if (src.startsWith('data:')) {
        return true;
    }
    
    // Allow local file references
    if (src.startsWith('file://') || !src.includes('://')) {
        return true;
    }
    
    // Allow HTTPS URLs
    if (src.startsWith('https://')) {
        return true;
    }
    
    // Block HTTP and other protocols for security
    return false;
}