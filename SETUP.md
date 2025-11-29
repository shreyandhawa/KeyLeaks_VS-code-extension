 Quick Setup Guide

 Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- VS Code

 Installation Steps

1. Install Dependencies**
   ```bash
   npm install
   ```

2. **Build the Extension**
   ```bash
   npm run compile
   ```
   This will:
   - Build the webview bundle (React + Tailwind)
   - Compile TypeScript to JavaScript
   - Output to `out/` directory

3. **Configure Gemini API Key (Optional)**
   - Open VS Code Settings (Cmd/Ctrl + ,)
   - Search for "KeyLeaks"
   - Enter your Google Gemini API Key in `keyleaks.geminiApiKey`
   - Get your API key from: https://makersuite.google.com/app/apikey

4. **Run the Extension**
   - Press `F5` in VS Code to launch Extension Development Host
   - Or use the "Run Extension" debug configuration

 Testing

1. Create a test file with a secret:
   ```typescript
   const API_KEY = "sk_live_1234567890abcdef";
   ```

2. The extension should:
   - Detect the secret immediately
   - Show a red underline
   - Display an error notification
   - Allow you to get AI security advice

## Development

### Watch Mode (Auto-rebuild)
```bash
npm run watch
```

This runs:
- TypeScript compiler in watch mode
- Webpack in development watch mode

### Build for Production
```bash
npm run compile
```

### Package Extension
```bash
npm install -g vsce
vsce package
```

## Project Structure

```
.
├── src/
│   ├── extension.ts          # Main extension logic
│   ├── secretDetector.ts     # Pattern matching
│   ├── geminiService.ts      # AI API (native HTTPS)
│   ├── webviewPanel.ts       # Webview management
│   └── webview/              # React UI
├── out/                      # Compiled output
├── package.json
├── tsconfig.json
├── webpack.config.js
└── tailwind.config.js
```

## Troubleshooting

### Webview Not Loading
- Ensure `out/webview/bundle.js` exists
- Run `npm run webpack-prod` to rebuild webview
- Check browser console in webview (Right-click → Inspect)

### Secrets Not Detected
- Check that real-time scanning is enabled in settings
- Verify the pattern matches your secret format
- Ensure it's not filtered as a dummy value

### AI Advice Not Working
- Verify Gemini API key is configured
- Check network connectivity
- Review extension output for errors (View → Output → KeyLeaks)

## Next Steps

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture
- Read [README.md](./README.md) for feature documentation
- Customize secret patterns in `src/secretDetector.ts`

