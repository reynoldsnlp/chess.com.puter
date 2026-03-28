# chess.com.puter

### *Free the fish!*

A Chrome extension that brings free Stockfish analysis to chess.com (and other
platforms) in a side panel -- powered by Lichess open-source tools. Analyze your
completed games without leaving the page and without paying for a premium
subscription.

## What it does

- Extracts PGN from completed games on chess.com and lichess.org via DOM scraping
- Displays an interactive analysis board ([chessground](https://github.com/lichess-org/chessground)) with a clickable move list
- Runs Stockfish 18 locally in your browser via WebAssembly -- no server, no API calls
- Shows multi-PV engine lines, an evaluation bar, and one-click "Open in Lichess" for full analysis
- During live games, provides non-evaluative helper tools (time comparison, low-time alerts) -- **engine analysis is disabled until the game ends**

## Anti-cheating

This extension **only enables Stockfish analysis for completed games**. Engine
evaluation is strictly disabled during active games. Three independent checks
enforce this:

1. The content script detects game completion from PGN results and DOM signals
2. The service worker strips PGN from messages for live games
3. The side panel re-validates the game result before initializing the engine

During live games, the side panel shows time-management tools instead.

## Install

```bash
git clone https://github.com/reynoldsnlp/chess.com.puter.git
cd chess.com.puter
npm install
npm run build
```

Then load the extension in Chrome:

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` directory

## Usage

1. Navigate to a completed game on chess.com or lichess.org
2. Click the chess.com.puter extension icon to open the side panel
3. The game PGN is extracted automatically and loaded into the analysis board
4. Click any move to navigate -- Stockfish analyzes each position in real-time
5. Use "Open in Lichess" to open the full analysis on lichess.org
6. You can also paste any completed game PGN manually via the "Paste PGN" button

## Supported platforms

| Platform | Auto-extraction | Live helper |
|----------|:-:|:-:|
| chess.com | yes | yes |
| lichess.org | yes | -- |
| Any page (manual PGN paste) | -- | -- |

## Dependencies

Only three runtime dependencies, all Lichess/Stockfish open-source projects:

| Package | Purpose | License |
|---------|---------|---------|
| [@lichess-org/chessground](https://github.com/lichess-org/chessground) | Interactive chess board UI | GPL-3.0+ |
| [chessops](https://github.com/niklasf/chessops) | Chess logic, PGN/FEN parsing | GPL-3.0+ |
| [@lichess-org/stockfish-web](https://github.com/lichess-org/stockfish-web) | Stockfish 18 WASM engine | AGPL-3.0 |

Build tool: [esbuild](https://esbuild.github.io/) (dev only).

No frameworks. No APIs. No TypeScript. Vanilla JS/HTML/CSS.

## License

[GPL-3.0-or-later](LICENSE)

## Credits

This extension is a wrapper around tools built by the [Lichess](https://lichess.org)
open-source community. Lichess provides world-class chess tools for free -- if
you find this extension useful, consider
[donating to Lichess](https://lichess.org/patron).
