// Generic PGN/FEN detection for arbitrary web pages.
// Scans <pre>, <code>, <textarea> and text nodes for chess notation.

const FEN_REGEX = /([rnbqkpRNBQKP1-8]{1,8}\/){7}[rnbqkpRNBQKP1-8]{1,8}\s+[wb]\s+[KQkq-]{1,4}\s+(?:[a-h][36]|-)\s+\d+\s+\d+/;
const PGN_TAG_REGEX = /\[\s*(?:Event|Site|Date|Round|White|Black|Result|FEN|ECO|Opening)\s+"[^"]*"\s*\]/g;
const PGN_MOVES_REGEX = /\b\d+\.\s*(?:[PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?|O-O(?:-O)?)[+#]?/g;

/**
 * Scan the page for PGN or FEN text.
 * @returns {Promise<string|null>}
 */
export async function extractGenericPgn() {
  // Check <textarea> elements first (common for PGN paste sites)
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const pgn = detectPgn(ta.value);
    if (pgn) return pgn;
  }

  // Check <pre> and <code> elements
  const codeBlocks = document.querySelectorAll('pre, code');
  for (const block of codeBlocks) {
    const pgn = detectPgn(block.textContent);
    if (pgn) return pgn;
  }

  // Scan visible text nodes (limited to avoid performance issues)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let node;
  let scanned = 0;
  while ((node = walker.nextNode()) && scanned < 500) {
    scanned++;
    const text = node.textContent?.trim();
    if (text && text.length > 30) {
      const pgn = detectPgn(text);
      if (pgn) return pgn;
    }
  }

  return null;
}

/**
 * Attempt to detect PGN content in a text string.
 * @param {string} text
 * @returns {string|null}
 */
function detectPgn(text) {
  if (!text || text.length < 10) return null;

  // Check for PGN header tags (high confidence)
  const tags = text.match(PGN_TAG_REGEX);
  if (tags && tags.length >= 2) return text;

  // Check for sequential numbered moves (medium confidence)
  const moves = text.match(PGN_MOVES_REGEX);
  if (moves && moves.length >= 3) {
    // Verify moves are sequential
    const firstNum = parseInt(moves[0]);
    if (firstNum === 1) return text;
  }

  // Check for FEN (returns as a FEN-only "PGN")
  const fenMatch = text.match(FEN_REGEX);
  if (fenMatch) {
    return `[FEN "${fenMatch[0]}"]\n*`;
  }

  return null;
}

/**
 * Generic games are always treated as completed
 * since there's no live game context.
 */
export function isGenericGameOver() {
  return true;
}
