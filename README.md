# chess.com.puter

### *Free the fish!*

A Chrome extension that brings free Stockfish analysis to chess.com (and other
platforms) in a side panel -- powered by Lichess open-source tools. Analyze your
completed games without leaving the page and without paying for a premium
subscription.

## Features

- **Full game analysis** with progress bar -- every position evaluated by
  Stockfish 18 running locally in your browser via WebAssembly
- **Move classification** using chess.com's Expected Points model: Best, Excellent,
  Good, Inaccuracy, Mistake, Blunder, Book, and Forced
- **Accuracy percentage** calculated using the Lichess formula (harmonic mean of
  per-move accuracies)
- **Interactive analysis board** ([chessground](https://github.com/lichess-org/chessground))
  with drag-and-drop piece movement for exploring hypothetical lines
- **Evaluation chart** -- smoothed win-probability graph over the entire game,
  click to jump to any position
- **Evaluation bar** -- vertical bar showing who's winning, syncs with board
  orientation
- **Multi-PV engine lines** with real-time depth updates and UCI-to-SAN conversion
- **Best move arrows** on the board (semi-transparent green)
- **Classification icons** on the board showing move quality at a glance
- **Hypothetical line exploration** -- move a piece to diverge from the game and
  explore "what if" variations, shown inline in a blue-bordered notation block
- **Player-focused UI** -- summary counts, accuracy, move coloring, and chart
  markers all focused on your moves (detected automatically, or flip the board
  to switch perspective)
- **One-click "Open in Lichess"** to continue analysis on lichess.org
- **Manual PGN paste** for analyzing games from any source
- **Page scanning** -- automatically detects completed games on chess.com; manual
  refresh button with spinner for re-scanning
- **No server, no APIs, no tracking** -- everything runs locally in your browser

## Anti-cheating

This extension **only enables Stockfish analysis for completed games**. Engine
evaluation is strictly disabled during active games. Three independent checks
enforce this:

1. The content script detects game completion from PGN results and DOM signals
2. The service worker strips PGN from messages for live games
3. The side panel re-validates the game result before initializing the engine

Games are never auto-imported. The user must explicitly click "Import game from
current page" to load a detected game.

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

Note: `npm install` downloads the Stockfish NNUE neural network (~15 MB) from
stockfishchess.org. This is a one-time build dependency -- the file is bundled
into the extension and no network calls are made at runtime.

## Usage

1. Navigate to a completed game on chess.com
2. Click the chess.com.puter extension icon to open the side panel
3. Click "Import game from current page" (the extension scans the page
   automatically and enables the button when a completed game is found)
4. Full game analysis runs automatically with a progress bar
5. Browse moves with arrow keys or click the move list -- each position shows
   the engine's best move, evaluation, and classification
6. Move pieces on the board to explore hypothetical lines
7. Use "Open in Lichess" for deeper analysis
8. Click "Flip" to switch perspective and see your opponent's accuracy
9. Click "X Close game" to return to the lobby and analyze another game

You can also paste PGN from any source via the "Paste PGN" button in the lobby.

## Supported platforms

| Platform | Auto-detection | Manual PGN paste |
|----------|:-:|:-:|
| chess.com | yes | yes |
| lichess.org | yes | yes |
| Any page | -- | yes |

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

## Disclaimer

Chess.com is a registered trademark of Chess.com, LLC. This extension is an
independent, open-source project and is not affiliated with, endorsed by, or
sponsored by Chess.com, LLC. Lichess is a registered trademark of Lichess.org.
This extension is not affiliated with or endorsed by Lichess.org.
