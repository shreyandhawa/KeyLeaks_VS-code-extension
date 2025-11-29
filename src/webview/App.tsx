/**
 * React App Component for KeyLeaks Advice Panel
 * 
 * This component runs in an isolated webview context, completely separate
 * from the VS Code extension host process. It communicates with the extension
 * via message passing only.
 */

import * as React from 'react';
import { SecretMatch } from '../secretDetector';
import { SecurityAdvice } from '../geminiService';

interface AppProps {
    secretMatch: SecretMatch;
    uri: string;
    advice: SecurityAdvice;
}

interface AppState {
    data: AppProps | null;
}

declare global {
    interface Window {
        initialData: AppProps;
        vscode: any; // VS Code API injected into webview
    }
}

export class App extends React.Component<{}, AppState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            data: window.initialData || null
        };

        // Listen for messages from extension host
        window.addEventListener('message', (event: MessageEvent) => {
            const message = event.data;
            if (message.secretMatch && message.advice) {
                this.setState({ data: message });
            }
        });
    }

    private handleOpenFile = () => {
        if (this.state.data) {
            // Send message to extension host to open file
            if (window.vscode) {
                window.vscode.postMessage({
                    command: 'openFile',
                    uri: this.state.data.uri,
                    line: this.state.data.secretMatch.line,
                    column: this.state.data.secretMatch.column
                });
            }
        }
    };

    private handleCopyRecommendation = (text: string) => {
        if (window.vscode) {
            window.vscode.postMessage({
                command: 'copyRecommendation',
                text: text
            });
        }
    };

    private getUrgencyColor = (urgency: string): string => {
        switch (urgency) {
            case 'critical':
                return 'bg-red-600';
            case 'high':
                return 'bg-orange-600';
            case 'medium':
                return 'bg-yellow-600';
            case 'low':
                return 'bg-blue-600';
            default:
                return 'bg-gray-600';
        }
    };

    render() {
        if (!this.state.data) {
            return (
                <div className="flex items-center justify-center h-screen bg-gray-50">
                    <div className="text-gray-500">Loading security advice...</div>
                </div>
            );
        }

        const { secretMatch, advice } = this.state.data;

        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                                    🔒 Security Alert
                                </h1>
                                <p className="text-gray-600">{advice.title}</p>
                            </div>
                            <span className={`px-4 py-2 rounded-full text-white font-semibold ${this.getUrgencyColor(advice.urgency)}`}>
                                {advice.urgency.toUpperCase()}
                            </span>
                        </div>
                        
                        <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded">
                            <div className="flex items-start">
                                <div className="flex-shrink-0">
                                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="ml-3 flex-1">
                                    <h3 className="text-sm font-medium text-red-800">
                                        Detected: {secretMatch.type}
                                    </h3>
                                    <div className="mt-2 text-sm text-red-700">
                                        <p>Location: Line {secretMatch.line}, Column {secretMatch.column}</p>
                                        <p className="mt-1 font-mono text-xs bg-red-100 p-2 rounded">
                                            {secretMatch.context}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-3">
                            Why This Is Dangerous
                        </h2>
                        <p className="text-gray-700 leading-relaxed">
                            {advice.description}
                        </p>
                    </div>

                    {/* Recommendations */}
                    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">
                            Recommended Actions
                        </h2>
                        <ul className="space-y-3">
                            {advice.recommendations.map((rec, index) => (
                                <li key={index} className="flex items-start">
                                    <span className="flex-shrink-0 h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center mr-3 mt-0.5">
                                        <span className="text-blue-600 text-sm font-semibold">{index + 1}</span>
                                    </span>
                                    <div className="flex-1">
                                        <p className="text-gray-700">{rec}</p>
                                    </div>
                                    <button
                                        onClick={() => this.handleCopyRecommendation(rec)}
                                        className="ml-2 text-gray-400 hover:text-gray-600"
                                        title="Copy to clipboard"
                                    >
                                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Revocation Steps */}
                    {advice.revocationSteps && advice.revocationSteps.length > 0 && (
                        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                            <h2 className="text-xl font-semibold text-gray-900 mb-4">
                                Step-by-Step Revocation Guide
                            </h2>
                            <ol className="space-y-3">
                                {advice.revocationSteps.map((step, index) => (
                                    <li key={index} className="flex items-start">
                                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-orange-100 flex items-center justify-center mr-3 mt-0.5">
                                            <span className="text-orange-600 text-sm font-semibold">{index + 1}</span>
                                        </span>
                                        <p className="text-gray-700 flex-1">{step}</p>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="bg-white rounded-lg shadow-md p-6">
                        <div className="flex space-x-4">
                            <button
                                onClick={this.handleOpenFile}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200"
                            >
                                Open File Location
                            </button>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-6 text-center text-sm text-gray-500">
                        <p>Powered by KeyLeaks - Real-time Secret Detection</p>
                        <p className="mt-1">Security advice powered by Google Gemini AI</p>
                    </div>
                </div>
            </div>
        );
    }
}

