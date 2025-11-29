/**
 * KeyLeaks VS Code Extension
 * 
 * Real-time secret leak detection and prevention with AI-powered security advice.
 * 
 * Security Principles:
 * 1. Local-only scanning - no file uploads to external servers
 * 2. Minimal data transmission - only redacted secrets sent to AI
 * 3. Native dependencies - uses Node.js https module, no external HTTP clients
 */

import * as vscode from 'vscode';
import { scanForSecrets, SecretMatch, redactSecret } from './secretDetector';
import { getSecurityAdvice, SecurityAdvice } from './geminiService';
import { createAdvicePanel } from './webviewPanel';

interface ScannedFile {
    uri: vscode.Uri;
    matches: SecretMatch[];
    lastScanned: number;
}

class KeyLeaksExtension implements vscode.Disposable {
    private context: vscode.ExtensionContext;
    private diagnostics: vscode.DiagnosticCollection;
    private scannedFiles: Map<string, ScannedFile> = new Map();
    private changeDelayTimer: NodeJS.Timeout | undefined;
    private readonly SCAN_DELAY_MS = 1000; // Delay after typing before scanning

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.diagnostics = vscode.languages.createDiagnosticCollection('keyleaks');
        
        // Register commands
        this.registerCommands();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initial workspace scan
        this.scanWorkspace();
        
        vscode.window.showInformationMessage('KeyLeaks: Real-time secret detection enabled');
    }

    private registerCommands(): void {
        // Register scan workspace command
        const scanWorkspaceCmd = vscode.commands.registerCommand(
            'keyleaks.scanWorkspace',
            () => this.scanWorkspace()
        );

        // Register show advice command
        const showAdviceCmd = vscode.commands.registerCommand(
            'keyleaks.showAdvice',
            async (match?: SecretMatch, uri?: vscode.Uri) => {
                if (!match || !uri) {
                    vscode.window.showWarningMessage('Please select a detected secret first');
                    return;
                }
                await this.showSecurityAdvice(match, uri);
            }
        );

        // Register toggle real-time scanning command
        const toggleScanningCmd = vscode.commands.registerCommand(
            'keyleaks.toggleRealTimeScanning',
            () => this.toggleRealTimeScanning()
        );

        this.context.subscriptions.push(
            scanWorkspaceCmd,
            showAdviceCmd,
            toggleScanningCmd
        );
    }

    private setupEventListeners(): void {
        // Listen for document changes (real-time scanning)
        const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
            (event) => {
                const config = vscode.workspace.getConfiguration('keyleaks');
                if (config.get<boolean>('enableRealTimeScanning', true)) {
                    // Debounce rapid changes
                    if (this.changeDelayTimer) {
                        clearTimeout(this.changeDelayTimer);
                    }
                    this.changeDelayTimer = setTimeout(() => {
                        this.scanDocument(event.document);
                    }, this.SCAN_DELAY_MS);
                }
            }
        );

        // Listen for document saves
        const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(
            (document) => {
                const config = vscode.workspace.getConfiguration('keyleaks');
                if (config.get<boolean>('scanOnSave', true)) {
                    this.scanDocument(document);
                }
            }
        );

        // Listen for document opens
        const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(
            (document) => {
                this.scanDocument(document);
            }
        );

        this.context.subscriptions.push(
            onDidChangeTextDocument,
            onDidSaveTextDocument,
            onDidOpenTextDocument
        );
    }

    /**
     * Scans a single document for secrets
     */
    private async scanDocument(document: vscode.TextDocument): Promise<void> {
        // Skip non-file URIs and excluded files
        if (document.uri.scheme !== 'file') {
            return;
        }

        // Skip very large files (performance)
        if (document.getText().length > 1000000) { // 1MB limit
            return;
        }

        const text = document.getText();
        const matches = scanForSecrets(text, document.uri);
        const fileKey = document.uri.toString();

        // Store scan results
        this.scannedFiles.set(fileKey, {
            uri: document.uri,
            matches,
            lastScanned: Date.now()
        });

        // Update diagnostics (underlines in editor)
        this.updateDiagnostics(document.uri, matches);

        // Show alerts for new high-severity matches
        const newHighSeverityMatches = matches.filter(m => m.severity === 'high');
        if (newHighSeverityMatches.length > 0) {
            this.showAlerts(document.uri, newHighSeverityMatches);
        }
    }

    /**
     * Scans all workspace files
     */
    private async scanWorkspace(): Promise<void> {
        const files = await vscode.workspace.findFiles(
            '**/*',
            '**/{node_modules,.git,dist,build,.next,out}/**',
            1000 // Limit to 1000 files for performance
        );

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'KeyLeaks: Scanning workspace for secrets...',
            cancellable: false
        }, async (progress) => {
            let scanned = 0;
            for (const file of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    await this.scanDocument(document);
                    scanned++;
                    progress.report({ increment: 100 / files.length, message: `Scanned ${scanned}/${files.length} files` });
                } catch (error) {
                    // Skip binary files or files that can't be opened
                    continue;
                }
            }

            const totalMatches = Array.from(this.scannedFiles.values())
                .reduce((sum, file) => sum + file.matches.length, 0);

            if (totalMatches > 0) {
                vscode.window.showWarningMessage(
                    `KeyLeaks: Found ${totalMatches} potential secret(s) in your workspace`,
                    'Show Details'
                ).then(selection => {
                    if (selection === 'Show Details') {
                        this.showResultsSummary();
                    }
                });
            } else {
                vscode.window.showInformationMessage('KeyLeaks: No secrets detected in workspace');
            }
        });
    }

    /**
     * Updates VS Code diagnostics to highlight secrets in the editor
     */
    private updateDiagnostics(uri: vscode.Uri, matches: SecretMatch[]): void {
        const diagnostics: vscode.Diagnostic[] = matches.map(match => {
            const line = match.line - 1; // VS Code uses 0-based indexing
            const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
            
            const diagnostic = new vscode.Diagnostic(
                range,
                `Secret detected: ${match.type} - ${redactSecret(match.value)}`,
                this.getDiagnosticSeverity(match.severity)
            );
            
            diagnostic.source = 'keyleaks';
            diagnostic.code = match.type;
            
            // Add code action to show AI advice
            diagnostic.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(uri, range),
                    `Click to get AI-powered security advice for this ${match.type}`
                )
            ];
            
            return diagnostic;
        });

        this.diagnostics.set(uri, diagnostics);
    }

    /**
     * Converts severity level to VS Code diagnostic severity
     */
    private getDiagnosticSeverity(severity: 'high' | 'medium' | 'low'): vscode.DiagnosticSeverity {
        switch (severity) {
            case 'high':
                return vscode.DiagnosticSeverity.Error;
            case 'medium':
                return vscode.DiagnosticSeverity.Warning;
            case 'low':
                return vscode.DiagnosticSeverity.Information;
        }
    }

    /**
     * Shows visual and auditory alerts for detected secrets
     */
    private showAlerts(uri: vscode.Uri, matches: SecretMatch[]): void {
        const config = vscode.workspace.getConfiguration('keyleaks');
        
        // Visual alert
        const match = matches[0]; // Show alert for first match
        vscode.window.showErrorMessage(
            `🔒 SECRET DETECTED: ${match.type} found at line ${match.line}`,
            'Get Security Advice',
            'Dismiss'
        ).then(selection => {
            if (selection === 'Get Security Advice') {
                this.showSecurityAdvice(match, uri);
            }
        });

        // Auditory alert (if enabled)
        if (config.get<boolean>('enableSoundAlerts', true)) {
            // Play system beep sound
            // Note: VS Code doesn't have direct audio API, but we can use terminal bell
            process.stdout.write('\x07');
        }

        // Show in status bar
        vscode.window.setStatusBarMessage(
            `⚠️ KeyLeaks: ${matches.length} secret(s) detected in ${vscode.workspace.asRelativePath(uri)}`,
            5000
        );
    }

    /**
     * Shows AI-powered security advice in a webview panel
     */
    private async showSecurityAdvice(match: SecretMatch, uri: vscode.Uri): Promise<void> {
        const config = vscode.workspace.getConfiguration('keyleaks');
        const apiKey = config.get<string>('geminiApiKey', '');

        // Show loading indicator
        const loadingMessage = vscode.window.setStatusBarMessage(
            'KeyLeaks: Fetching AI security advice...',
            0
        );

        try {
            const advice = await getSecurityAdvice(match, apiKey);
            loadingMessage.dispose();

            if (advice) {
                createAdvicePanel(this.context, {
                    secretMatch: match,
                    uri: uri,
                    advice: advice
                });
            }
        } catch (error) {
            loadingMessage.dispose();
            vscode.window.showErrorMessage(
                `Failed to get security advice: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Shows a summary of all detected secrets
     */
    private showResultsSummary(): void {
        const allMatches: Array<{ file: vscode.Uri; match: SecretMatch }> = [];
        
        for (const scannedFile of this.scannedFiles.values()) {
            for (const match of scannedFile.matches) {
                allMatches.push({ file: scannedFile.uri, match });
            }
        }

        if (allMatches.length === 0) {
            vscode.window.showInformationMessage('No secrets detected');
            return;
        }

        // Create output channel to display results
        const outputChannel = vscode.window.createOutputChannel('KeyLeaks Results');
        outputChannel.clear();
        outputChannel.appendLine('KeyLeaks: Secret Detection Results');
        outputChannel.appendLine('='.repeat(50));
        outputChannel.appendLine('');

        for (const { file, match } of allMatches) {
            outputChannel.appendLine(`File: ${vscode.workspace.asRelativePath(file)}`);
            outputChannel.appendLine(`Line: ${match.line}, Column: ${match.column}`);
            outputChannel.appendLine(`Type: ${match.type}`);
            outputChannel.appendLine(`Severity: ${match.severity.toUpperCase()}`);
            outputChannel.appendLine(`Redacted Value: ${redactSecret(match.value)}`);
            outputChannel.appendLine(`Context: ${match.context}`);
            outputChannel.appendLine('-'.repeat(50));
        }

        outputChannel.show();
    }

    /**
     * Toggles real-time scanning on/off
     */
    private toggleRealTimeScanning(): void {
        const config = vscode.workspace.getConfiguration('keyleaks');
        const current = config.get<boolean>('enableRealTimeScanning', true);
        config.update('enableRealTimeScanning', !current, vscode.ConfigurationTarget.Global);
        
        vscode.window.showInformationMessage(
            `Real-time scanning ${!current ? 'enabled' : 'disabled'}`
        );
    }

    /**
     * Cleanup on deactivation
     */
    public dispose(): void {
        if (this.changeDelayTimer) {
            clearTimeout(this.changeDelayTimer);
        }
        this.diagnostics.dispose();
        this.scannedFiles.clear();
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const extension = new KeyLeaksExtension(context);
    context.subscriptions.push(extension);
    
    console.log('KeyLeaks extension is now active');
}

export function deactivate(): void {
    console.log('KeyLeaks extension is deactivated');
}

