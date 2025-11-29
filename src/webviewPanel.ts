/**
 * Webview Panel Manager
 * 
 * Creates and manages the React/Tailwind webview panel for displaying
 * AI-powered security advice. The webview runs in an isolated context,
 * communicating with the extension host via message passing.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SecretMatch } from './secretDetector';
import { SecurityAdvice } from './geminiService';

interface AdvicePanelData {
    secretMatch: SecretMatch;
    uri: vscode.Uri;
    advice: SecurityAdvice;
}

let currentPanel: vscode.WebviewPanel | undefined = undefined;

/**
 * Creates or reveals the advice panel
 * 
 * Architecture Note: The webview runs in a completely isolated process
 * separate from the extension host. This isolation provides:
 * - Security: Webview cannot access Node.js APIs or file system
 * - Stability: Crashes in webview don't affect extension host
 * - Performance: Webview runs in separate process
 * 
 * Communication between extension host and webview is via:
 * - postMessage() from extension to webview
 * - onDidReceiveMessage() from webview to extension
 */
export function createAdvicePanel(
    context: vscode.ExtensionContext,
    data: AdvicePanelData
): void {
    const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

    if (currentPanel) {
        // If panel already exists, reveal it and update content
        currentPanel.reveal(columnToShowIn);
        currentPanel.webview.postMessage(data);
        return;
    }

    // Create new panel
    currentPanel = vscode.window.createWebviewPanel(
        'keyleaksAdvice',
        `KeyLeaks: Security Advice - ${data.secretMatch.type}`,
        columnToShowIn || vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview'))
            ]
        }
    );

    // Set initial HTML content
    currentPanel.webview.html = getWebviewContent(currentPanel.webview, context, data);

    // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(
        (message) => {
            switch (message.command) {
                case 'openFile':
                    vscode.workspace.openTextDocument(message.uri).then(doc => {
                        vscode.window.showTextDocument(doc, {
                            selection: new vscode.Range(
                                message.line - 1,
                                message.column - 1,
                                message.line - 1,
                                message.column + 20
                            )
                        });
                    });
                    break;
                case 'refresh':
                    // Refresh advice by re-fetching from API
                    break;
                case 'copyRecommendation':
                    vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage('Copied to clipboard');
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    // Clean up when panel is closed
    currentPanel.onDidDispose(
        () => {
            currentPanel = undefined;
        },
        null,
        context.subscriptions
    );

    // Update panel content when data changes
    currentPanel.webview.postMessage(data);
}

/**
 * Generates HTML content for the webview
 * This HTML loads the React bundle which will render the advice panel
 */
function getWebviewContent(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    data: AdvicePanelData
): string {
    // Get paths to webview assets
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview', 'bundle.js'))
    );

    // Use Content Security Policy to ensure webview isolation
    // Only allow scripts from our bundle and styles inline
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KeyLeaks Security Advice</title>
    <script nonce="${nonce}">
        window.initialData = ${JSON.stringify(data)};
    </script>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

