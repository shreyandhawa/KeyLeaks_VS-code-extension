# React/Tailwind Webview Architecture Explanation

## Overview

The AI advice panel is built as an isolated webview using React and Tailwind CSS. This document explains how to architect and isolate the React/Tailwind webview from the main extension process.

## Architecture Pattern

### Process Isolation

```
┌─────────────────────────────────────────────┐
│  Extension Host Process (Main Process)      │
│  ────────────────────────────────────────   │
│  • Runs Node.js code                        │
│  • Has file system access                   │
│  • Makes API calls                          │
│  • Manages secret detection                 │
│  • Cannot access DOM or browser APIs        │
└────────────────┬────────────────────────────┘
                 │
                 │ Message Passing API
                 │ (vscode.Webview.postMessage)
                 │
┌────────────────▼────────────────────────────┐
│  Webview Process (Isolated Chromium)        │
│  ────────────────────────────────────────   │
│  • Runs React + Tailwind UI                 │
│  • Has DOM access                           │
│  • Can use browser APIs                     │
│  • Cannot access Node.js or file system     │
│  • Sandboxed by VS Code security model      │
└─────────────────────────────────────────────┘
```

## Why This Isolation Matters

### 1. Security Boundary

**Extension Host** = Trusted Code
- Can read/write files
- Can make system calls
- Can access VS Code APIs

**Webview** = Untrusted Code (User-Facing UI)
- Cannot access file system
- Cannot execute Node.js code
- Sandboxed environment
- Only communicates via message passing

### 2. Crash Isolation

If the React webview crashes or has errors:
- Extension host continues running
- File scanning continues working
- Only the UI is affected

If extension host crashes:
- Webview automatically closes
- User can restart extension

### 3. Performance Isolation

- Webview rendering doesn't block extension host
- Heavy UI updates don't affect file scanning
- Separate process = separate event loops

## Implementation Details

### 1. Creating the Isolated Webview

**File**: `src/webviewPanel.ts`

```typescript
const panel = vscode.window.createWebviewPanel(
    'keyleaksAdvice',                    // Panel type identifier
    'Security Advice',                    // Panel title
    vscode.ViewColumn.Beside,            // Position
    {
        enableScripts: true,             // Allow JavaScript
        retainContextWhenHidden: true,   // Keep state when hidden
        localResourceRoots: [            // Only load from these paths
            vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview'))
        ]
    }
);
```

**Key Settings**:
- `enableScripts: true` - Allows React to run
- `retainContextWhenHidden: true` - Preserves React state
- `localResourceRoots` - Restricts file access (security)

### 2. Content Security Policy (CSP)

**File**: `src/webviewPanel.ts` → `getWebviewContent()`

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               style-src 'unsafe-inline'; 
               script-src 'nonce-{random}';">
```

**What This Does**:
- `default-src 'none'` - Blocks everything by default
- `style-src 'unsafe-inline'` - Allows inline styles (Tailwind needs this)
- `script-src 'nonce-{random}'` - Only allows scripts with matching nonce

**Why It's Secure**:
- Prevents XSS attacks
- Blocks external resources
- Only allows our bundled code to execute

### 3. Message Passing API

**Extension Host → Webview**

```typescript
// Send data to webview
panel.webview.postMessage({
    secretMatch: {
        type: "API Key",
        value: "sk_live_***",
        line: 42
    },
    advice: {
        title: "Security Alert",
        recommendations: [...]
    }
});
```

**Webview → Extension Host**

```typescript
// In React component (webview)
window.vscode.postMessage({
    command: 'openFile',
    uri: 'file:///path/to/file.ts',
    line: 42,
    column: 10
});

// In extension host
panel.webview.onDidReceiveMessage((message) => {
    switch (message.command) {
        case 'openFile':
            vscode.workspace.openTextDocument(message.uri);
            break;
    }
});
```

### 4. VS Code API Injection

**File**: `src/webview/index.tsx`

```typescript
// VS Code provides this function globally in webview context
const vscode = acquireVsCodeApi();

// Make it available to React components
(window as any).vscode = vscode;
```

**What `acquireVsCodeApi()` Provides**:
- `postMessage()` - Send messages to extension host
- `getState()` - Get persisted state
- `setState()` - Persist state

**Important**: This API is only available in webview context, not in extension host.

## Building the Webview Bundle

### Webpack Configuration

**File**: `webpack.config.js`

```javascript
module.exports = {
    entry: './src/webview/index.tsx',    // React entry point
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'out', 'webview')
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader'          // TypeScript → JavaScript
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',       // Injects CSS into DOM
                    'css-loader',         // Processes CSS
                    'postcss-loader'      // Processes Tailwind
                ]
            }
        ]
    },
    externals: {
        'vscode': 'commonjs vscode'      // Don't bundle VS Code types
    }
};
```

### Build Process

1. **TypeScript Compilation**:
   - `src/webview/index.tsx` → JavaScript
   - `src/webview/App.tsx` → JavaScript
   - React JSX → JavaScript

2. **CSS Processing**:
   - `styles.css` with `@tailwind` directives
   - Tailwind generates utility classes
   - PostCSS processes autoprefixer
   - CSS injected into bundle

3. **Bundling**:
   - All React code bundled
   - All CSS inlined
   - Single `bundle.js` file output

### Loading the Bundle

**File**: `src/webviewPanel.ts` → `getWebviewContent()`

```typescript
const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview', 'bundle.js'))
);

return `
    <html>
        <body>
            <div id="root"></div>
            <script src="${scriptUri}"></script>
        </body>
    </html>
`;
```

**Security**: `asWebviewUri()` converts file path to secure webview URI that respects CSP.

## React Component Architecture

### Component Structure

**File**: `src/webview/App.tsx`

```typescript
export class App extends React.Component<{}, AppState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            data: window.initialData || null  // Data from extension host
        };

        // Listen for updates from extension host
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.secretMatch && message.advice) {
                this.setState({ data: message });
            }
        });
    }

    // Send message to extension host
    private handleOpenFile = () => {
        window.vscode.postMessage({
            command: 'openFile',
            uri: this.state.data.uri,
            line: this.state.data.secretMatch.line
        });
    };
}
```

### Data Flow

```
1. Extension Host detects secret
   ↓
2. Extension Host calls Gemini API
   ↓
3. Extension Host gets security advice
   ↓
4. Extension Host sends data via postMessage
   ↓
5. React component receives via window.addEventListener
   ↓
6. React component updates state
   ↓
7. React re-renders with new data
```

## Tailwind CSS Integration

### Setup

**File**: `tailwind.config.js`

```javascript
module.exports = {
    content: [
        "./src/webview/**/*.{js,jsx,ts,tsx}",  // Scan React files
    ],
    theme: {
        extend: {},
    },
    plugins: [],
}
```

**File**: `src/webview/styles.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Usage in React

```tsx
<div className="bg-white rounded-lg shadow-md p-6">
    <h1 className="text-2xl font-bold text-gray-900">
        Security Alert
    </h1>
</div>
```

**Why Tailwind Works**:
- Utility-first CSS
- Small bundle size (only used classes)
- Fast development
- Consistent design system

## Best Practices

### 1. Keep Webview Simple

- **Do**: Display data, handle user interactions
- **Don't**: Business logic, file operations, API calls

### 2. Use Message Passing

- **Do**: Send commands like `openFile`, `copyText`
- **Don't**: Try to access file system directly

### 3. Handle Errors Gracefully

```typescript
try {
    window.vscode.postMessage({ command: 'action' });
} catch (error) {
    // Webview might not be ready
    console.error('Failed to send message:', error);
}
```

### 4. Secure Initial Data

```typescript
// In extension host
<script nonce="${nonce}">
    window.initialData = ${JSON.stringify(sanitizedData)};
</script>
```

**Never** send:
- Full file contents
- Sensitive data
- User credentials

### 5. Optimize Bundle Size

- Use Tailwind's purge (only include used classes)
- Code split if webview grows large
- Minimize dependencies

## Debugging

### Webview Console

1. Right-click in webview
2. Select "Inspect"
3. Opens Chrome DevTools for webview
4. Check Console for React errors

### Extension Host Console

1. View → Output
2. Select "Log (Extension Host)"
3. See extension host logs

### Message Debugging

```typescript
// In webview
console.log('Sending message:', message);
window.vscode.postMessage(message);

// In extension host
panel.webview.onDidReceiveMessage((message) => {
    console.log('Received message:', message);
});
```

## Summary

The React/Tailwind webview is isolated from the extension host through:

1. **Separate Process** - Runs in Chromium, not Node.js
2. **Message Passing** - Only communication method
3. **CSP** - Prevents unauthorized code execution
4. **Sandboxing** - VS Code restricts file access
5. **Bundle Separation** - Built separately, loaded securely

This architecture ensures:
- ✅ Security (webview cannot access sensitive APIs)
- ✅ Stability (crashes don't affect extension)
- ✅ Performance (non-blocking UI)
- ✅ Maintainability (clear separation of concerns)

