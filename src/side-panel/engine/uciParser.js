// Parse UCI protocol output from Stockfish into structured objects.

/**
 * Parse a UCI "info" line.
 * Handles modern Stockfish output with WDL: "score wdl 500 450 50 cp 35"
 * as well as classic format: "score cp 35"
 * @param {string} line
 * @returns {object|null}
 */
export function parseInfoLine(line) {
  if (!line.startsWith('info ') || line.startsWith('info string')) return null;

  const result = {
    depth: 0,
    seldepth: 0,
    multipv: 1,
    score: null,
    nodes: 0,
    nps: 0,
    time: 0,
    pv: [],
  };

  const tokens = line.split(/\s+/);
  let i = 1; // Skip "info"

  while (i < tokens.length) {
    switch (tokens[i]) {
      case 'depth':
        result.depth = parseInt(tokens[++i]) || 0;
        break;
      case 'seldepth':
        result.seldepth = parseInt(tokens[++i]) || 0;
        break;
      case 'multipv':
        result.multipv = parseInt(tokens[++i]) || 1;
        break;
      case 'score':
        // Scan ahead for cp/mate/wdl tokens within the score section.
        // Modern Stockfish may output: "score wdl W D L cp C" or "score cp C wdl W D L"
        i++;
        while (i < tokens.length) {
          if (tokens[i] === 'cp') {
            result.score = { type: 'cp', value: parseInt(tokens[++i]) || 0 };
          } else if (tokens[i] === 'mate') {
            result.score = { type: 'mate', value: parseInt(tokens[++i]) || 0 };
          } else if (tokens[i] === 'wdl') {
            // Skip the 3 WDL values
            i += 3;
          } else if (tokens[i] === 'lowerbound' || tokens[i] === 'upperbound') {
            // Skip bound markers
          } else {
            // Hit a non-score token — back up and let the outer loop handle it
            i--;
            break;
          }
          i++;
        }
        break;
      case 'nodes':
        result.nodes = parseInt(tokens[++i]) || 0;
        break;
      case 'nps':
        result.nps = parseInt(tokens[++i]) || 0;
        break;
      case 'time':
        result.time = parseInt(tokens[++i]) || 0;
        break;
      case 'pv':
        result.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      default:
        break;
    }
    i++;
  }

  if (result.depth > 0 && result.score) return result;
  return null;
}

/**
 * Parse a UCI "bestmove" line.
 * @param {string} line
 * @returns {{ bestmove: string, ponder: string|null }|null}
 */
export function parseBestMove(line) {
  if (!line.startsWith('bestmove ')) return null;
  const tokens = line.split(/\s+/);
  return {
    bestmove: tokens[1] || '',
    ponder: tokens[3] || null,
  };
}
