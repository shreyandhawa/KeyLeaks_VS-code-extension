/**
 * Type definitions for VS Code Webview API
 */

declare function acquireVsCodeApi(): {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

// Extend Window interface for webview-specific properties
declare global {
    interface Window {
        vscode?: {
            postMessage: (message: any) => void;
            getState: () => any;
            setState: (state: any) => void;
        };
        initialData?: {
            secretMatch: any;
            uri: string;
            advice: any;
        };
    }
}

