/**
 * Secret Detector Module
 * 
 * This module implements regex-based pattern detection for common secret types
 * and includes dummy value filtering to reduce false positives and prevent
 * "Security Fatigue" - a condition where developers become desensitized to
 * security warnings due to excessive false alarms.
 */

import * as vscode from 'vscode';

export interface SecretMatch {
    type: string;
    value: string;
    line: number;
    column: number;
    context: string;
    severity: 'high' | 'medium' | 'low';
}

/**
 * Comprehensive regex patterns for detecting secrets
 * Based on common patterns found in real-world credential leaks
 */
export const SECRET_PATTERNS: Array<{
    name: string;
    pattern: RegExp;
    severity: 'high' | 'medium' | 'low';
}> = [
    // API Keys
    {
        name: 'Generic API Key',
        pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?([A-Za-z0-9_\-]{32,})['"]?/i,
        severity: 'high'
    },
    {
        name: 'AWS Access Key',
        pattern: /AKIA[0-9A-Z]{16}/,
        severity: 'high'
    },
    {
        name: 'AWS Secret Key',
        pattern: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/i,
        severity: 'high'
    },
    {
        name: 'Google API Key',
        pattern: /AIza[0-9A-Za-z\-_]{35}/,
        severity: 'high'
    },
    {
        name: 'GitHub Token',
        pattern: /ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|ghr_[A-Za-z0-9]{36}/,
        severity: 'high'
    },
    {
        name: 'Stripe API Key',
        pattern: /(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}/,
        severity: 'high'
    },
    
    // JWT Tokens
    {
        name: 'JWT Token',
        pattern: /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/,
        severity: 'medium'
    },
    
    // Database Credentials
    {
        name: 'Database Connection String',
        pattern: /(?:mongodb|mysql|postgresql|postgres):\/\/[^\s'"]+/i,
        severity: 'high'
    },
    
    // Private Keys
    {
        name: 'SSH Private Key',
        pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
        severity: 'high'
    },
    {
        name: 'OpenSSH Private Key',
        pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,
        severity: 'high'
    },
    {
        name: 'EC Private Key',
        pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/,
        severity: 'high'
    },
    
    // OAuth Tokens
    {
        name: 'OAuth Token',
        pattern: /oauth[_-]?token\s*[=:]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/i,
        severity: 'high'
    },
    
    // Generic Tokens
    {
        name: 'Generic Token',
        pattern: /(?:token|secret|password|passwd|pwd)\s*[=:]\s*['"]?([A-Za-z0-9_\-+/=]{20,})['"]?/i,
        severity: 'medium'
    },
    
    // Slack Tokens
    {
        name: 'Slack Token',
        pattern: /xox[baprs]-[0-9a-zA-Z\-]{10,48}/,
        severity: 'high'
    },
    
    // Twilio API Key
    {
        name: 'Twilio API Key',
        pattern: /SK[0-9a-fA-F]{32}/,
        severity: 'high'
    }
];

/**
 * Common dummy/placeholder values that should be filtered out
 * 
 * DUMMY VALUE FILTERING prevents Security Fatigue by reducing false positives.
 * Security Fatigue occurs when developers are overwhelmed by too many false alarms,
 * causing them to ignore legitimate security warnings. By filtering out known
 * placeholder patterns (like "YOUR_API_KEY_HERE", "example.com", "test", etc.),
 * we ensure that only real secrets trigger alerts, maintaining developer trust
 * and attention to genuine security threats.
 */
const DUMMY_PATTERNS: RegExp[] = [
    // Common placeholders
    /^(?:YOUR[_-]?|EXAMPLE[_-]?|PLACEHOLDER[_-]?|CHANGE[_-]?ME|TODO|FIXME|XXX|TEMP|DUMMY)[\w_-]*$/i,
    /^(?:your|example|placeholder|changeme|test|demo|sample|fake|mock)[\w_-]*$/i,
    
    // Common test values
    /^(?:test|testing|test123|test_key|test_token|test_secret)$/i,
    /^test[\w_-]*$/i,
    
    // Example domains and emails
    /^(?:example|sample|test)\.(?:com|org|net|io)$/i,
    /^(?:example|sample|test|demo)@[\w.-]+$/i,
    
    // Common example values
    /^12345(?:67890)?$/,
    /^(?:abcdef|123456|qwerty|password)$/i,
    /^(?:api_key_here|your_key_here|key_here|token_here)$/i,
    
    // Empty or minimal values
    /^(?:null|undefined|none|empty|''|""|\[|\])$/i,
    /^.{0,3}$/, // Very short values (likely placeholders)
    
    // Common development patterns
    /^(?:dev|development|local|localhost|127\.0\.0\.1)[\w_-]*$/i,
    /^localhost/,
    
    // Common git ignore patterns that might be caught
    /^\.env\.example$/i,
    /^\.env\.sample$/i
];

/**
 * Filters out dummy/placeholder values to reduce false positives
 * This is crucial for preventing Security Fatigue - when developers become
 * desensitized to security warnings due to excessive false alarms.
 */
function isDummyValue(value: string): boolean {
    const trimmed = value.trim();
    
    // Check against dummy patterns
    for (const pattern of DUMMY_PATTERNS) {
        if (pattern.test(trimmed)) {
            return true;
        }
    }
    
    // Additional heuristics
    // Values that are too repetitive are likely placeholders
    if (trimmed.length > 3) {
        const firstChar = trimmed[0];
        if (trimmed.split('').every(c => c === firstChar)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Scans text content for secrets using regex patterns
 * Applies dummy value filtering to reduce false positives
 */
export function scanForSecrets(
    text: string,
    uri: vscode.Uri
): SecretMatch[] {
    const matches: SecretMatch[] = [];
    const lines = text.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        
        for (const { name, pattern, severity } of SECRET_PATTERNS) {
            let match;
            const regex = new RegExp(pattern, 'gi');
            
            while ((match = regex.exec(line)) !== null) {
                // Extract the secret value (use capture group if available, else full match)
                const secretValue = match[1] || match[0];
                
                // Filter out dummy values to prevent Security Fatigue
                if (!isDummyValue(secretValue)) {
                    const column = match.index;
                    const context = line.substring(Math.max(0, column - 30), Math.min(line.length, column + 50));
                    
                    matches.push({
                        type: name,
                        value: secretValue,
                        line: lineIndex + 1,
                        column: column + 1,
                        context: context.trim(),
                        severity
                    });
                }
            }
        }
    }
    
    return matches;
}

/**
 * Gets a redacted version of the secret for safe logging/display
 * Only shows first and last 4 characters, redacting the middle
 */
export function redactSecret(secret: string): string {
    if (secret.length <= 8) {
        return '*'.repeat(secret.length);
    }
    const start = secret.substring(0, 4);
    const end = secret.substring(secret.length - 4);
    return `${start}${'*'.repeat(Math.min(secret.length - 8, 20))}${end}`;
}

