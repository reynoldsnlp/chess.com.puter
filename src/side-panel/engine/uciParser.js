// Parse UCI protocol output from Stockfish into structured objects.

/**
 * Parse a UCI "info" line.
 * Example: "info depth 20 seldepth 30 multipv 1 score cp 35 nodes 1234567 nps 1200000 time 1029 pv e2e4 e7e5 g1f3"
 * @param {string} line
 * @returns {object|null}
 */
export function parseInfoLine(line) {
  if (!line.startsWith('info ')) return null;

  // Skip "info string" messages
  if (line.startsWith('info string')) return null;

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
        i++;
        if (tokens[i] === 'cp') {
          result.score = { type: 'cp', value: parseInt(tokens[++i]) || 0 };
        } else if (tokens[i] === 'mate') {
          result.score = { type: 'mate', value: parseInt(tokens[++i]) || 0 };
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
        // Everything after "pv" is the principal variation
        result.pv = tokens.slice(i + 1);
        i = tokens.length; // End parsing
        break;
      default:
        break;
    }
    i++;
  }

  // Only return if we have meaningful data
  if (result.depth > 0 && result.score) return result;
  return null;
}

/**
 * Parse a UCI "bestmove" line.
 * Example: "bestmove e2e4 ponder e7e5"
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
