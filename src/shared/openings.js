import aTsv from '../../vendor/chess-openings/a.tsv';
import bTsv from '../../vendor/chess-openings/b.tsv';
import cTsv from '../../vendor/chess-openings/c.tsv';
import dTsv from '../../vendor/chess-openings/d.tsv';
import eTsv from '../../vendor/chess-openings/e.tsv';
import { makeFen } from 'chessops/fen';
import { parsePgn, startingPosition } from 'chessops/pgn';
import { parseSan } from 'chessops/san';

const OPENING_TSVS = [aTsv, bTsv, cTsv, dTsv, eTsv];

let openingIndex = null;

export function openingKeyFromFen(fen) {
  if (!fen) return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  return parts.slice(0, 4).join(' ');
}

export function getOpeningMatches(fen) {
  const key = openingKeyFromFen(fen);
  if (!key) return [];
  return getOpeningIndex().get(key) || [];
}

export function getPrimaryOpening(fen) {
  const matches = getOpeningMatches(fen);
  return matches[0] || null;
}

export function isBookPosition(fen) {
  return getOpeningMatches(fen).length > 0;
}

export function getLatestCompletedOpening(fens) {
  if (!fens?.length) return null;

  for (let i = fens.length - 1; i >= 0; i--) {
    const fen = typeof fens[i] === 'string' ? fens[i] : fens[i]?.fen;
    const opening = getPrimaryOpening(fen);
    if (opening) return opening;
  }

  return null;
}

function getOpeningIndex() {
  if (openingIndex) return openingIndex;
  openingIndex = buildOpeningIndex();
  return openingIndex;
}

function buildOpeningIndex() {
  const index = new Map();

  for (const tsv of OPENING_TSVS) {
    const lines = tsv.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [eco, name, pgn] = line.split('\t');
      const opening = parseOpeningLine(eco, name, pgn);
      if (!opening) continue;

      const bucket = index.get(opening.positionKey) || [];
      bucket.push(opening);
      index.set(opening.positionKey, bucket);
    }
  }

  for (const bucket of index.values()) {
    bucket.sort(compareOpenings);
  }

  return index;
}

function parseOpeningLine(eco, name, pgn) {
  if (!eco || !name || !pgn) return null;

  try {
    const game = parseOpeningPgn(pgn);
    if (!game) return null;

    const start = startingPosition(game.headers);
    if (start.isErr) return null;

    const pos = start.value;
    let ply = 0;

    for (const node of game.moves.mainline()) {
      if (!node.san) break;
      const move = parseSan(pos, node.san);
      if (!move) return null;
      pos.play(move);
      ply++;
    }

    return {
      eco,
      name,
      ply,
      positionKey: openingKeyFromFen(makeFen(pos.toSetup())),
    };
  } catch {
    return null;
  }
}

function parseOpeningPgn(pgn) {
  const direct = parsePgn(pgn)?.[0];
  if (direct) return direct;
  return parsePgn(`[Event "?"]\n\n${pgn}`)?.[0] || null;
}

function compareOpenings(a, b) {
  return (
    a.ply - b.ply ||
    a.name.length - b.name.length ||
    a.eco.localeCompare(b.eco) ||
    a.name.localeCompare(b.name)
  );
}
