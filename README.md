# KeyLeaks - VS Code Extension

Real-time secret leak detection and prevention with AI-powered security advice.

## Features

- 🔒 **Real-time Detection**: Scans code as you type to detect secrets instantly
- 🤖 **AI-Powered Advice**: Get actionable security recommendations from Google Gemini AI
- 🎯 **Smart Filtering**: Dummy value filtering prevents false positives and security fatigue
- 🔔 **Visual & Auditory Alerts**: Instant awareness through visual highlights and sound alerts
- 🛡️ **Local-Only Scanning**: All scanning happens locally - no file uploads to external servers
- 🔐 **Privacy-Focused**: Only redacted secrets sent to AI, never full file content

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press `F5` in VS Code to launch the Extension Development Host

## Configuration

### Required Settings

- `keyleaks.geminiApiKey` (optional): Your Google Gemini API key for AI-powered security advice
  - Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
  - Without this, the extension will show default security advice

### Optional Settings

- `keyleaks.enableRealTimeScanning`: Enable/disable real-time scanning (default: `true`)
- `keyleaks.enableSoundAlerts`: Enable/disable sound alerts (default: `true`)
- `keyleaks.scanOnSave`: Scan files when saved (default: `true`)
- `keyleaks.ignoredPatterns`: Custom regex patterns to ignore

## Architecture & Security Design

### Secure Software Design Principles

#### 1. Minimize Supply Chain Risk
- **Native HTTPS Module**: The extension uses Node.js's built-in `https` module for Gemini API calls instead of external HTTP client libraries. This reduces:
  - Attack surface from third-party dependencies
  - Supply chain vulnerabilities
  - Bundle size and complexity

#### 2. Data Privacy
- **Local-Only Scanning**: All file scanning happens entirely on the local machine
- **Minimal Data Transmission**: Only redacted secrets (first/last 4 characters visible) are sent to the AI API
- **No File Uploads**: Full file contents are never transmitted to external servers
- **Context Isolation**: Only the detected secret type, line number, and redacted value are sent - no surrounding code

#### 3. Safe Defaults
- **Dummy Value Filtering**: Prevents "Security Fatigue" by filtering out common placeholder values
  - Security Fatigue occurs when developers become desensitized to security warnings due to excessive false alarms
  - By filtering patterns like "YOUR_API_KEY_HERE", "example.com", "test", etc., we ensure only real secrets trigger alerts
  - This maintains developer trust and attention to genuine security threats

### React/Tailwind Webview Architecture

The AI advice panel is implemented as an isolated webview that runs in a separate process from the extension host. This architecture provides:

#### Process Isolation
```
Extension Host Process (Node.js)
    ↓ Message Passing
Webview Process (Chromium-based)
    ↓ React + Tailwind UI
User Interface
```

**Benefits:**
1. **Security**: Webview cannot access Node.js APIs, file system, or system resources
2. **Stability**: Crashes in the webview don't affect the extension host
3. **Performance**: Webview runs in a separate process, avoiding blocking the extension
4. **Sandboxing**: Webview is sandboxed by VS Code's security model

#### Communication Pattern

**Extension Host → Webview:**
```typescript
webviewPanel.webview.postMessage({
    secretMatch: {...},
    advice: {...}
});
```

**Webview → Extension Host:**
```typescript
window.vscode.postMessage({
    command: 'openFile',
    uri: 'file://...',
    line: 42
});
```

#### Implementation Details

1. **Webpack Bundle**: React and Tailwind code is bundled into a single `bundle.js` file
2. **Content Security Policy**: Strict CSP ensures only our bundle can execute
3. **Message API**: VS Code's message passing API enables secure communication
4. **Tailwind CSS**: Utility-first CSS framework for rapid UI development

#### Building the Webview

The webview is built separately from the extension:
```bash
npm run webpack-prod  # Production build
npm run webpack-dev   # Development with watch mode
```

The compiled bundle is placed in `out/webview/bundle.js` and loaded by the extension host.

## Development

### Project Structure

```
.
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── secretDetector.ts     # Secret pattern matching and filtering
│   ├── geminiService.ts      # AI API integration (native HTTPS)
│   ├── webviewPanel.ts       # Webview panel management
│   └── webview/              # React webview application
│       ├── index.tsx         # Webview entry point
│       ├── App.tsx           # React component
│       └── styles.css        # Tailwind CSS
├── out/                      # Compiled output
│   └── webview/              # Webpack bundle
├── package.json
├── tsconfig.json
├── webpack.config.js
├── tailwind.config.js
└── postcss.config.js
```

### Building

```bash
# Install dependencies
npm install

# Build extension and webview
npm run compile

# Watch mode (development)
npm run watch
```

### Testing

1. Open this folder in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a file with a secret (e.g., `API_KEY=sk_test_1234567890abcdef`)
4. Observe the detection and advice panel

## Secret Detection Patterns

The extension detects:
- API Keys (Generic, AWS, Google, Stripe, etc.)
- GitHub Tokens
- JWT Tokens
- Database Connection Strings
- Private Keys (SSH, RSA, EC)
- OAuth Tokens
- Slack Tokens
- And more...

## Contributing

Contributions are welcome! Please ensure:
- Code follows TypeScript best practices
- Security principles are maintained
- Tests are added for new features

## License

MIT

## Security

If you discover a security vulnerability, please email security@example.com instead of using the issue tracker.

