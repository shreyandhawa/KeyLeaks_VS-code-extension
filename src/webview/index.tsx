/**
 * Webview Entry Point
 * 
 * This is the entry point for the React webview application.
 * It initializes React and renders the App component.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import './styles.css';
import { App } from './App';

// Get VS Code API (injected by VS Code)
// The acquireVsCodeApi function is provided globally by VS Code in webview context
const vscode = acquireVsCodeApi();

// Make vscode API available globally
(window as any).vscode = vscode;

// Render the React app
ReactDOM.render(
    <App />,
    document.getElementById('root')
);

