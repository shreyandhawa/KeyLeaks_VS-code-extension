# KeyLeaks Architecture & Security Design

## Overview

KeyLeaks is designed following Secure Software Design principles to minimize security risks while providing powerful real-time secret detection capabilities.

## Secure Software Design Principles

### 1. Minimize Supply Chain Risk

**Problem**: External HTTP client libraries can introduce vulnerabilities, increase bundle size, and add unnecessary dependencies.

**Solution**: The extension uses Node.js's native `https` module exclusively for all external API calls.

**Implementation**: 
- File: `src/geminiService.ts`
- Uses `https.request()` directly instead of libraries like `axios`, `node-fetch`, or `request`
- Benefits:
  - Reduced attack surface (fewer dependencies)
  - Smaller bundle size
  - Better control over request/response handling
  - No supply chain vulnerabilities from HTTP clients

**Code Example**:
```typescript
const req = https.request(options, (res) => {
    // Native Node.js https handling
});
```

### 2. Data Privacy

**Problem**: Scanning files for secrets could expose sensitive code to external services.

**Solution**: Multi-layered privacy protection ensuring minimal data transmission.

**Implementation Strategy**:

#### Layer 1: Local-Only Scanning
- All file scanning happens entirely on the local machine
- No file uploads to external servers
- Pattern matching performed in-memory using regex

#### Layer 2: Secret Redaction
- Only redacted secrets are sent to AI (first 4 + last 4 characters visible)
- Implementation: `src/secretDetector.ts` → `redactSecret()`
- Example: `sk_live_1234567890abcdef` → `sk_l***ef`

#### Layer 3: Minimal Context
- Only secret type, line number, and redacted value sent to AI
- Never sends:
  - Full file content
  - Surrounding code context
  - File path or project structure
  - Other files or dependencies

**Code Example**:
```typescript
const redactedValue = redactSecret(secretMatch.value);
const prompt = `Secret Type: ${secretMatch.type}\nRedacted: ${redactedValue}`;
// Only minimal data sent, never full file
```

### 3. Safe Defaults (Preventing Security Fatigue)

**Problem**: Security Fatigue occurs when developers are overwhelmed by false positive alerts, causing them to ignore legitimate warnings.

**Solution**: Comprehensive dummy value filtering to reduce false positives.

**Implementation**: `src/secretDetector.ts` → `isDummyValue()`

**Filtered Patterns**:
- Placeholders: `YOUR_API_KEY_HERE`, `CHANGE_ME`, `PLACEHOLDER`
- Test values: `test`, `test123`, `testing`
- Example domains: `example.com`, `test.com`
- Common development patterns: `localhost`, `dev`, `local`
- Repetitive values: `aaaaaaaa`, `11111111`
- Empty/minimal values: `null`, `undefined`, `''`

**Why This Matters**:
- **Maintains Trust**: Developers trust alerts when they're accurate
- **Attention Retention**: Fewer false positives = more attention to real threats
- **Developer Experience**: Reduces alert fatigue and maintains security awareness
- **Production Ready**: Only real secrets trigger alerts

**Code Comments**:
```typescript
/**
 * DUMMY VALUE FILTERING prevents Security Fatigue by reducing false positives.
 * Security Fatigue occurs when developers are overwhelmed by too many false alarms,
 * causing them to ignore legitimate security warnings.
 */
```

## React/Tailwind Webview Architecture

### Process Isolation

The AI advice panel runs in a completely isolated webview process, separate from the VS Code extension host.

```
┌─────────────────────────────────────┐
│   Extension Host Process (Node.js)  │
│  - File system access               │
│  - VS Code API                      │
│  - Secret detection                 │
│  - AI API calls                     │
└──────────────┬──────────────────────┘
               │
               │ Message Passing
               │ (postMessage API)
               │
┌──────────────▼──────────────────────┐
│   Webview Process (Chromium)        │
│  - React UI                         │
│  - Tailwind CSS                     │
│  - Isolated context                 │
│  - No Node.js access                │
└─────────────────────────────────────┘
```

### Security Benefits of Isolation

1. **Sandboxing**: Webview cannot access:
   - File system
   - Node.js APIs
   - System resources
   - Extension host internals

2. **Crash Isolation**: Webview crashes don't affect extension host

3. **Performance**: Runs in separate process, non-blocking

4. **Content Security Policy**: Strict CSP prevents XSS attacks

### Communication Pattern

#### Extension Host → Webview
```typescript
// Send data to webview
webviewPanel.webview.postMessage({
    secretMatch: {
        type: "API Key",
        value: "sk_live_***",
        line: 42,
        column: 10
    },
    advice: {
        title: "Security Alert",
        recommendations: [...],
        urgency: "high"
    }
});
```

#### Webview → Extension Host
```typescript
// Request action from extension host
window.vscode.postMessage({
    command: 'openFile',
    uri: 'file:///path/to/file.ts',
    line: 42,
    column: 10
});
```

### Implementation Details

#### 1. Webview Creation
```typescript
// src/webviewPanel.ts
const panel = vscode.window.createWebviewPanel(
    'keyleaksAdvice',
    'Security Advice',
    vscode.ViewColumn.Beside,
    {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [/* bundle location */]
    }
);
```

#### 2. Message Handling
```typescript
// Extension host listens for webview messages
panel.webview.onDidReceiveMessage((message) => {
    switch (message.command) {
        case 'openFile':
            // Handle file opening
            break;
    }
});
```

#### 3. Content Security Policy
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               style-src 'unsafe-inline'; 
               script-src 'nonce-{random}';">
```

### Building the Webview

The webview is built separately using Webpack:

```bash
npm run webpack-prod  # Production build
```

**Build Process**:
1. TypeScript → JavaScript (ts-loader)
2. React JSX → JavaScript (Babel/ts-loader)
3. CSS → Processed (PostCSS + Tailwind)
4. Bundled into single `bundle.js`

**Output Structure**:
```
out/
  webview/
    bundle.js  # Complete React app + Tailwind CSS
```

### Why This Architecture?

#### Separation of Concerns
- **Extension Host**: Security logic, file scanning, API calls
- **Webview**: UI rendering, user interaction

#### Security Boundaries
- Clear separation between trusted (extension) and untrusted (webview) code
- Webview cannot execute arbitrary Node.js code
- All communication via controlled message passing

#### Maintainability
- React/Tailwind for modern UI development
- Isolated testing of UI components
- Easy updates to UI without affecting core logic

## File Structure

```
src/
├── extension.ts          # Main entry, orchestrates all components
├── secretDetector.ts     # Pattern matching, dummy filtering
├── geminiService.ts      # AI API integration (native HTTPS)
├── webviewPanel.ts       # Webview lifecycle management
└── webview/
    ├── index.tsx         # Webview entry point
    ├── App.tsx           # React component
    ├── styles.css        # Tailwind directives
    └── vscode.d.ts       # TypeScript types
```

## Data Flow

### Secret Detection Flow

```
1. File Change Detected
   ↓
2. Scan Document (secretDetector.ts)
   ↓
3. Apply Regex Patterns
   ↓
4. Filter Dummy Values
   ↓
5. Create SecretMatch Objects
   ↓
6. Update VS Code Diagnostics (underlines)
   ↓
7. Show Visual/Auditory Alert
```

### AI Advice Flow

```
1. User Clicks on Detected Secret
   ↓
2. Redact Secret Value
   ↓
3. Build Minimal Prompt (type + redacted value)
   ↓
4. Call Gemini API (native HTTPS)
   ↓
5. Parse AI Response
   ↓
6. Create SecurityAdvice Object
   ↓
7. Send to Webview via postMessage
   ↓
8. React Renders Advice Panel
```

## Security Checklist

- ✅ Native HTTPS module (no external HTTP clients)
- ✅ Local-only file scanning
- ✅ Secret redaction before API calls
- ✅ Minimal context sent to AI
- ✅ Webview process isolation
- ✅ Content Security Policy
- ✅ Dummy value filtering
- ✅ No file uploads
- ✅ Secure defaults

## Future Enhancements

1. **Offline Mode**: Cache common security advice
2. **Custom Patterns**: User-defined secret patterns
3. **Git History Scanning**: Detect secrets in commit history
4. **Multi-Provider AI**: Support for multiple AI providers
5. **Team Collaboration**: Share security findings

