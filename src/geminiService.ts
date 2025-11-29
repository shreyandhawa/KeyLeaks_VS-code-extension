/**
 * Gemini AI Service
 * 
 * Uses native Node.js https module instead of external client libraries
 * to minimize supply chain risk and reduce dependency footprint.
 * 
 * Data Privacy: Only sends redacted secrets or minimal context to the API,
 * never the full file content.
 */

import * as https from 'https';
import * as vscode from 'vscode';
import { SecretMatch, redactSecret } from './secretDetector';

export interface SecurityAdvice {
    title: string;
    description: string;
    recommendations: string[];
    urgency: 'critical' | 'high' | 'medium' | 'low';
    revocationSteps?: string[];
}

/**
 * Makes HTTPS request to Google Gemini API using native Node.js module
 * This minimizes supply chain risk by avoiding external HTTP client libraries
 */
function makeGeminiRequest(apiKey: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000 // 30 second timeout
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const response = JSON.parse(data);
                        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) {
                            resolve(text);
                        } else {
                            reject(new Error('Invalid response format from Gemini API'));
                        }
                    } else {
                        reject(new Error(`API error: ${res.statusCode} - ${data}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Gets AI-powered security advice for a detected secret
 * 
 * Data Privacy: Only sends redacted secret and minimal context,
 * never the full file content or surrounding code.
 */
export async function getSecurityAdvice(
    secretMatch: SecretMatch,
    apiKey: string | undefined
): Promise<SecurityAdvice | null> {
    if (!apiKey || apiKey.trim() === '') {
        return getDefaultAdvice(secretMatch);
    }

    try {
        // Create a privacy-focused prompt - only include secret type and redacted value
        const redactedValue = redactSecret(secretMatch.value);
        const prompt = `You are a security expert. A developer has accidentally exposed a ${secretMatch.type} in their code.

Secret Type: ${secretMatch.type}
Redacted Secret: ${redactedValue}
Severity: ${secretMatch.severity}
Line Number: ${secretMatch.line}

Please provide:
1. A brief title for the security issue
2. A description of why this is dangerous
3. Specific actionable recommendations (3-5 items)
4. Step-by-step revocation instructions if applicable
5. Urgency level (critical/high/medium/low)

Format your response as a structured JSON object with these fields:
- title (string)
- description (string)
- recommendations (array of strings)
- urgency (string: "critical" | "high" | "medium" | "low")
- revocationSteps (optional array of strings)

Be concise and actionable. Focus on immediate steps to secure the exposed credential.`;

        const response = await makeGeminiRequest(apiKey, prompt);
        
        // Try to parse structured JSON response
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    title: parsed.title || `Security Issue: ${secretMatch.type}`,
                    description: parsed.description || 'A secret was detected in your code.',
                    recommendations: Array.isArray(parsed.recommendations) 
                        ? parsed.recommendations 
                        : ['Rotate the exposed credential immediately'],
                    urgency: parsed.urgency || secretMatch.severity === 'high' ? 'high' : 'medium',
                    revocationSteps: parsed.revocationSteps || undefined
                };
            }
        } catch (parseError) {
            // If JSON parsing fails, try to extract useful information from text
            console.warn('Failed to parse JSON from Gemini response, using fallback');
        }

        // Fallback: parse unstructured text response
        return parseUnstructuredResponse(response, secretMatch);
    } catch (error) {
        console.error('Error getting AI advice:', error);
        vscode.window.showWarningMessage(
            `Failed to get AI advice: ${error instanceof Error ? error.message : 'Unknown error'}. Showing default advice.`
        );
        return getDefaultAdvice(secretMatch);
    }
}

/**
 * Parses unstructured text response from Gemini
 */
function parseUnstructuredResponse(
    response: string,
    secretMatch: SecretMatch
): SecurityAdvice {
    const lines = response.split('\n').filter(l => l.trim());
    
    return {
        title: `Security Issue: ${secretMatch.type}`,
        description: response.substring(0, 300) || 'A secret was detected in your code.',
        recommendations: lines.slice(0, 5).map(l => l.replace(/^[-*•]\s*/, '')),
        urgency: secretMatch.severity === 'high' ? 'high' : 'medium'
    };
}

/**
 * Returns default security advice when AI is unavailable
 */
function getDefaultAdvice(secretMatch: SecretMatch): SecurityAdvice {
    const baseRecommendations = [
        `Rotate the exposed ${secretMatch.type} immediately`,
        'Review your Git history and remove the secret from commit history',
        'Update the secret in all environments (development, staging, production)',
        'Enable secret scanning in your CI/CD pipeline',
        'Review who had access to the exposed credential and assess impact'
    ];

    const revocationSteps: string[] = [];
    
    if (secretMatch.type.includes('API Key')) {
        revocationSteps.push(
            'Log into the service provider dashboard',
            'Navigate to API Keys / Credentials section',
            'Revoke or delete the exposed key',
            'Generate a new key with appropriate permissions',
            'Update your application configuration with the new key'
        );
    } else if (secretMatch.type.includes('Token')) {
        revocationSteps.push(
            'Log into the service provider dashboard',
            'Revoke the exposed token',
            'Generate a new token',
            'Update your application configuration'
        );
    } else if (secretMatch.type.includes('Private Key')) {
        revocationSteps.push(
            'Generate a new key pair',
            'Update the public key in authorized systems',
            'Remove the old key from all systems',
            'Update your application configuration'
        );
    }

    return {
        title: `Security Alert: ${secretMatch.type} Detected`,
        description: `A ${secretMatch.type.toLowerCase()} has been detected in your code. This is a security risk as secrets should never be committed to version control or hardcoded in source files.`,
        recommendations: baseRecommendations,
        urgency: secretMatch.severity === 'high' ? 'critical' : 'high',
        revocationSteps: revocationSteps.length > 0 ? revocationSteps : undefined
    };
}

