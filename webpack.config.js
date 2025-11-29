/**
 * Webpack Configuration for Webview Bundle
 * 
 * Bundles the React webview code into a single JavaScript file
 * that can be loaded by the VS Code webview.
 */

const path = require('path');

module.exports = {
    entry: './src/webview/index.tsx',
    mode: 'development',
    devtool: 'source-map',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.webview.json'
                    }
                },
                exclude: /node_modules/
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'postcss-loader'
                ]
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.jsx']
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'out', 'webview')
    },
    externals: {
        'vscode': 'commonjs vscode' // Exclude vscode module from bundle
    }
};

