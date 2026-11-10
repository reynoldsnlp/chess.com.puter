# Move classification: research notes

This document summarizes research (November 2026) into how established chess
services and open-source tools classify moves (Best, Great, Brilliant, Miss,
Inaccuracy, Mistake, Blunder, …), and records the design this extension adopted.

Sources are cited inline. Where a claim was taken from source code, the file is
named; where it comes from community discussion or could not be verified from a
primary source, that is stated. Reddit could not be accessed during the
research, so community evidence comes from chess.com forums, blogs, and
open-source code.

## Contents

1. [Shared foundation: win probability](#1-shared-foundation-win-probability)
2. [Lichess](#2-lichess)
3. [Chess.com](#3-chesscom)
4. [Open-source tools](#4-open-source-tools)
5. [Research and writing on "brilliant" moves](#5-research-and-writing-on-brilliant-moves)
6. [Synthesis](#6-synthesis)
7. [What this extension does](#7-what-this-extension-does)
8. [Open questions and possible next steps](#8-open-questions-and-possible-next-steps)

---

## 1. Shared foundation: win probability

Nearly every modern system converts an engine evaluation (centipawns, or mate)
into a win probability and grades a move by how much probability it loses.
The reasoning, stated by Lichess developer niklasf when proposing the switch:
"Going from +100 cp to -200 cp is usually a huge mistake, but going from -600
to -900 hardly changes anything"
([lila#4705](https://github.com/lichess-org/lila/issues/4705)).

The common curve is a logistic function:

```
win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)     // Lichess, 0–100
EP   = 1 / (1 + exp(-k * cp))                               // "expected points", 0–1
```

| System | Constant `k` | Notes |
|---|---|---|
| Lichess (since 2022) | 0.00368208 | Fit by scipy on 75k positions from 2300+ rapid games ([lila PR #11148](https://github.com/lichess-org/lila/pull/11148)); was 0.004 before. cp clamped to ±1000. |
| Chesskit, En Croissant | 0.00368208 | Copy Lichess's formula. |
| WintrChess | 0.0035 | `shared/src/lib/reporter/expectedPoints.ts`. |
| Chess.com | unpublished | Curve depends on the player's rating ([help center](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)). |
| This extension | 0.00368208 | `cpToExpectedPoints` in `src/side-panel/engine/gameAnalyzer.js`. |

---

## 2. Lichess

Lichess is open source, so its behavior can be read directly from
[lila](https://github.com/lichess-org/lila) and
[scalachess](https://github.com/lichess-org/scalachess) (commits `0ef6104` and
`24c1cbf` respectively at the time of research).

### 2.1 Only negative judgements

Server-side analysis assigns only **Inaccuracy (?!)**, **Mistake (?)** and
**Blunder (??)**. It never assigns `!` or `!!`. Those glyphs exist only for
manual annotation in studies and PGN (scalachess
`core/src/main/scala/format/pgn/Glyph.scala`).

### 2.2 Thresholds

From `modules/tree/src/main/Advice.scala` (moved from `modules/analyse` in
2024):

```scala
winningChanceJudgements = List(.3 -> Blunder, .2 -> Mistake, .1 -> Inaccuracy)
```

These are on a −1…+1 "winning chances" scale, i.e. drops of **5 / 10 / 15
win-percentage points** (0.05 / 0.10 / 0.15 on a 0–1 scale). Note Lichess's
Blunder line (0.15) is stricter than chess.com's (0.20).

### 2.3 The engine's best move is never judged

Fishnet's `AnalysisBuilder.scala` drops the variation when the played move equals
the engine's first PV move, and `Analysis.scala` only creates advice when a
variation exists. So the top move is never flagged, regardless of eval swing.

### 2.4 Mate handling (`MateAdvice`)

- **Mate created** (you allow a forced mate against you): Inaccuracy if you
  were already below −999 cp, Mistake if below −700 cp, otherwise Blunder.
  Comment: "Checkmate is now unavoidable."
- **Mate lost** (you had a forced mate and lost it): Inaccuracy if still above
  +999 cp, Mistake if above +700 cp, otherwise Blunder.
  Comment: "Lost forced checkmate sequence."
- **Mate delayed** (longer mate): not flagged. This was deliberately removed in
  commit `e6b43d3a1a` ("Delayed checkmate is not an inaccuracy").

### 2.5 History

| Date | Change | Reference |
|---|---|---|
| ≤ 2019 | Raw centipawn loss: 300 / 100 / 50 cp | — |
| 2019‑07‑24 | Switched to winning chances (k = 0.004), thresholds .3/.2/.1 | commit `133a1ebe76`, issue [#4705](https://github.com/lichess-org/lila/issues/4705) |
| 2019‑07/08 | Blunder threshold briefly .5, then back to .3 | commits `77fe2205e3`, `39509d49d4` |
| 2022‑07‑09 | k changed to 0.00368208 | [PR #11148](https://github.com/lichess-org/lila/pull/11148) |
| 2026‑10‑14 | Transitions into being mated are now graded (final move of a game) | commit `b7fb42b8bd` |

### 2.6 Client-side variants

The browser UI uses the same curve with different thresholds:

- **Practice mode** (`ui/analyse/src/practice/practiceCtrl.ts`): good move if
  best or loss < 2.5 win%; inaccuracy < 6; mistake < 14; else blunder.
- **Learn from your mistakes** (`ui/analyse/src/nodeFinder.ts`): a move becomes
  an exercise if it loses > 10 win%, or misses a mate in ≤ 3.
- **Live annotations** (`ui/analyse/src/liveAnnotate.ts`, added 2026): same
  thresholds as the server.

### 2.7 Why Lichess has no Brilliant / Great

Issue [#12419 "Identify good and brilliant moves"](https://github.com/lichess-org/lila/issues/12419)
has been open since 2023. Team member niklasf framed the blocker as whether
"there's a useful definition of 'good/brilliant move'." Several duplicates were
closed (e.g. #15586 as not planned). In a 2026 "Missed Win" request
([#19294](https://github.com/lichess-org/lila/issues/19294)), ornicar asked for
definitions in terms of win%. No detailed developer rationale beyond "no useful
definition" was found.

### 2.8 Accuracy (for reference)

Per move: `103.1668 * exp(-0.04354 * (winBefore − winAfter)) − 3.1669` (+1
uncertainty bonus), clamped to 0–100. Game accuracy averages a
volatility-weighted mean and a harmonic mean
([lichess.org/page/accuracy](https://lichess.org/page/accuracy),
`modules/analyse/src/main/AccuracyPercent.scala`).

---

## 3. Chess.com

Chess.com's algorithm is proprietary. Official statements come from the help
center, news posts, and staff; everything else is community observation.

### 3.1 Official thresholds (Expected Points lost)

From ["How are moves classified?"](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc):

| Class | EP lost |
|---|---|
| Best | 0.00 |
| Excellent | 0.00–0.02 |
| Good | 0.02–0.05 |
| Inaccuracy | 0.05–0.10 |
| Mistake | 0.10–0.20 |
| Blunder | 0.20–1.00 |

"Expected Points uses data science to determine a player's winning chances
based on their rating and the engine evaluation." The curve is **rating
dependent** and unpublished.

### 3.2 Blunder must lose material

Since Game Review V2 (2023): "a blunder must not only drop the position's
evaluation significantly but also lose material or allow checkmate"
([news](https://www.chess.com/news/view/chesscom-launches-game-review-v2);
confirmed by staff member Martin_Stahl in
[this thread](https://www.chess.com/forum/view/site-feedback/implementation-of-the-miss-in-game-review)).

### 3.3 Brilliant (!!)

Official:

- "A Brilliant move is when you find a good piece sacrifice." It must be "the
  best or nearly best move", "you should not be in a bad position after", and
  "you should not be completely winning even if you hadn't found the move."
  Sacrifice detection is "more generous … for newer players"
  ([help center](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)).
- The sacrifice-based definition replaced an older one in late 2021
  ([news](https://www.chess.com/news/view/chesscom-releases-new-game-review)).
  CEO Erik described the old one as "a little bit about what the engine didn't
  expect and found later"
  ([forum](https://www.chess.com/forum/view/game-analysis/erik-confirms-what-makes-a-move-brilliant)).
- NM Jeremy Kane's chess.com article adds: "In the endgame, a brilliant
  sacrifice must be the only good move. In the opening or middlegame … it's OK
  if it's one of several good options," and "If you were winning in several
  ways before the sacrifice, then the move may be best, but it won't be
  brilliant"
  ([article](https://www.chess.com/article/view/how-to-play-a-brilliant-move)).

Community:

- Among moves tied for best, only the one that sacrifices material gets `!!`
  ([Alramech's blog](https://www.chess.com/blog/Alramech/the-new-brilliant-move-algorithm-in-action)).
- Reported false positives include forced sequences and non-sacrifices
  ([forum](https://www.chess.com/forum/view/general/brilliant-moves-are-just-sacrifices)).
- Observed frequency is roughly 0.3–0.4% of moves for strong players
  ([blog](https://notjoemartienz.pages.dev/blog/find_chess_com_brilliant_moves)).

### 3.4 Great (!)

Official: "moves that were critical to the outcome of the game, such as turning
a losing position into an equal one, an equal position into a winning one, or
finding the only good move in a position," with more generosity for newer
players ([help center](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc)).

Community complaints confirm the concern that motivated this research:

- An obvious king recapture after a rook sacrifice was marked Great: "It was an
  easy to find move for even the most novice of players"
  ([forum](https://www.chess.com/forum/view/site-feedback/analysis-gives-out-great-moves-a-little-cheaply)).
- One of two legal moves marked Great; a moderator defended it
  ([forum](https://www.chess.com/forum/view/game-analysis/great-move-bug)).
- Conversely, a free capture that was the only good move was *not* Great, and
  "for an algorithm it's really hard to determine how hard a move is to find"
  ([forum](https://www.chess.com/forum/view/game-analysis/why-great-move)).

No official statement says chess.com excludes recaptures or other obvious only
moves. Behavior appears inconsistent.

### 3.5 Miss

"A Miss is when you fail to capitalize on your opponent's mistake and miss the
opportunity to gain a winning position … The engine evaluation required to
determine a winning, equal, or losing position varies according to the
player's rating"
([help center](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc);
see also [Miss 101](https://www.chess.com/forum/view/game-analysis/miss-101)).
No numeric thresholds are published.

### 3.6 Other factors

- **Engine:** an announcement reports Game Review moving from Stockfish to a
  "more human" Torch variant
  ([announcement](https://www.chess.com/announcements/view/update-game-review-now-more-human);
  seen only via search snippets, login required).
- **Book:** the opening database was overhauled in V2; selection logic is not
  published.
- **Forced / Critical / Theory** are not current chess.com classes; they are
  WintrChess names.
- **Accuracy:** CAPS2, formula unpublished
  ([help center](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined)).

---

## 4. Open-source tools

### 4.1 WintrChess (and its predecessor Freechess)

[WintrCat/wintrchess](https://github.com/WintrCat/wintrchess) (GPL-3.0),
`shared/src/lib/reporter/`. The most complete open reimplementation of
chess.com-style review, and the basis for this extension's current
Brilliant/Great rules.

**Order of checks** (`classify.ts`): Forced (≤ 1 legal move) → Theory (book) →
checkmate = Best → top move = Best, else point-loss bands → Critical (their
"Great") may override → Brilliant may override if the class is at least Best.

**Point-loss bands** (`classification/pointLoss.ts`): Best < 0.01,
Excellent < 0.045, Okay < 0.08, Inaccuracy < 0.12, Mistake < 0.22, else
Blunder, with separate mate↔cp tables.

**Shared gate** for Critical and Brilliant (`utils/criticalMove.ts`). Reject if:

- the second-best line is still ≥ +7.00 for the mover (or, with no second line,
  the eval after the move is) — "still completely winning even if this move
  hadn't been found";
- the mover is losing after the move;
- the move is a queen promotion;
- the mover was in check ("moves that must be played anyway to escape check").

**Critical / Great** (`classification/critical.ts`):

- must be the engine's top move;
- not when the mover already has a forced mate;
- **"A critical move cannot be a capture of free material"**: if the move
  captures, the captured piece must have been safe beforehand;
- the second-best move must lose ≥ 0.10 EP.

**Brilliant** (`classification/brilliant.ts`):

- no promotions;
- at least one of the mover's non-pawn, non-king pieces is unsafe after the
  move (and worth more than anything just captured);
- rejected if the move reduced the number of unsafe pieces (moving to safety),
  unless it gives check;
- rejected if every unsafe piece is protected by "danger levels" — capturing it
  leaves the capturer with an equal-or-greater piece en prise, or (for pieces
  worth less than a queen) allows mate in one (`utils/dangerLevels.ts`);
- rejected if the unsafe pieces were all trapped anyway, or the moved piece was
  already trapped (`utils/pieceTrapped.ts`).

**Piece safety** (`utils/pieceSafety.ts`), an approximate static exchange test:
unsafe if attacked by something cheaper; safe if attackers ≤ defenders (with
x-ray/battery attackers, `utils/attackers.ts`); safe if cheaper than every
attacker and defended by something cheaper than them; safe if defended by a
pawn; plus a "rook for two minors" exception.

**Freechess** ([WintrCat/freechess](https://github.com/WintrCat/freechess)),
the older version: quadratic cp-loss thresholds that depend on the prior eval
(`src/lib/classification.ts`; the author's comment calls it the "WTF
Algorithm"); a similar hanging-piece Brilliant; and Great limited to punishing
an opponent's blunder with a ≥ 150 cp gap to the second-best move.

### 4.2 Chesskit

[GuillaumeSD/Chesskit](https://github.com/GuillaumeSD/Chesskit),
`src/lib/engine/helpers/moveClassification.ts`.

- Lichess win% curve; Blunder > 20, Mistake > 10, Inaccuracy > 5, Okay > 2
  win% lost.
- **"Splendid" (Brilliant):** ≤ 2 win% lost, a piece sacrifice measured by
  replaying the engine PV until quiet and comparing material, not losing, and
  the alternative not already > 97% winning.
- **"Perfect" (Great):** ≤ 2 win% lost, **not a simple recapture** (this move
  and the previous one land on the same square, which was occupied), and either
  the move flips the outcome (gain > 10 win% crossing 50%) or the best
  alternative is > 10 win% worse.

### 4.3 En Croissant

[franciscoBSalgueiro/en-croissant](https://github.com/franciscoBSalgueiro/en-croissant).

- Sacrifice (`src-tauri/src/chess.rs`): a capture-only quiescence search on
  material before vs. after the move; a drop of more than ~1 pawn is a
  sacrifice.
- Annotation (`src/utils/score.ts`): `??`/`?`/`?!` at > 20/10/5 win% lost. If
  the move is the clear best (> 10 win% over the second line): `!!` if a
  sacrifice; `!` if it improves > 5 win% over two plies earlier (punishing an
  error). Otherwise a playable sacrifice (eval > −200 cp) gets `!?`.

### 4.4 Lucas Chess

[lukasmonk/lucaschessR2](https://github.com/lukasmonk/lucaschessR2),
`bin/Code/Engines/EngineResponse.py`. Uses **search depth as a measure of
difficulty**: the first depth at which the move becomes best. ≥ 8 with a unique
best and > 70 cp gap → `!!`; ≥ 5 → `!`; ≥ 3 → `!?`. No sacrifice requirement
([parameters](https://lucaschess.blogspot.com/2022/10/setting-analysis-parameters.html)).

### 4.5 Scid

[benini/scid](https://github.com/benini/scid), `tcl/tools/analysis.tcl`
(`markExercise`). Marks tactical exercises when the eval swing is ≥ 1.5 pawns,
the best–second gap is ≥ 1.5, not several winning moves, and **the move is not
obvious: rejected if the engine already picks it at depths 1, 2 and 3**
([wiki](https://sourceforge.net/p/scid/wiki/TheAnnotateDialog)).

### 4.6 Others

- [Fu01978/Chess_Analyzer](https://huggingface.co/spaces/Fu01978/Chess_Analyzer/blob/main/analyzer.py):
  recursive static exchange evaluation for sacrifices; Brilliant downgraded to
  Great when the net material given up is only 1–2 pawns.
- Fritz/ChessBase: no public documentation of `!!`/`!` rules was found
  ([Fritz 15 help](https://help.chessbase.com/Fritz/15/eng/000017.htm)).
- Nibbler, python-chess-annotator: no brilliant/great logic (not verified in
  detail).

---

## 5. Research and writing on "brilliant" moves

- **Zaidi & Guerzhoy, "Predicting User Perception of Move Brilliance in Chess"**
  (ICCC 2024, [arXiv:2406.11895](https://arxiv.org/abs/2406.11895)). Labels from
  `!!`/`!` in 624 Lichess studies (820 brilliant, 1,637 good, 4,518 other).
  Features from Leela and Maia search trees at varying node counts. 79% balanced
  accuracy; win chance alone gets 61%. **Key finding:** at equal strong-engine
  evaluation, a move is more likely seen as brilliant when a weaker, human-like
  engine rates it lower — i.e. "brilliant" means *hard to find*, not just *a
  sacrifice*. (Summary:
  [Science of Chess](https://benbalas.substack.com/p/science-of-chess-what-makes-a-move).)
- **Chess Engine Lab**
  ([Substack](https://saychess.substack.com/p/finding-brilliant-moves-with-engines)):
  Brilliant = best move + Leela small-net policy < 2.5% (surprise) + ≥ 15 win%
  better than the second-best move. No sacrifice test.
- **Guid & Bratko** (2006 onward): position complexity as the sum of best–second
  gaps across search iterations where the best move changes; humans' chance of
  finding the best move correlates with the gap
  ([TalkChess discussion](https://talkchess.com/viewtopic.php?p=641263)).
- **Regan's Intrinsic Performance Ratings**: a probabilistic model of move
  choice from eval deltas, fitted per rating. Useful as an "unlikely but
  correct" signal, but needs fitted parameters (not verified in detail).

---

## 6. Synthesis

### Mistakes are a solved, shared problem

Everyone uses a win-probability curve and loss bands in roughly the 5 / 10 /
15–20 % range. Refinements worth noting:

- never grade the engine's top move (Lichess);
- a Blunder must lose material or allow mate (chess.com);
- dedicated rules for gaining or losing a forced mate (Lichess);
- rating-dependent curves (chess.com) — needs data we don't have.

### "Great" has no clean deterministic definition

Lichess declined to implement it for exactly this reason. Chess.com's version
is visibly inconsistent, with obvious recaptures marked Great. The practical
filters used elsewhere are:

| Filter | Used by | Cost |
|---|---|---|
| Exclude captures of unsafe ("free") material | WintrChess | static board check |
| Exclude simple recaptures (same square) | Chesskit | trivial |
| Exclude moves while in check, queen promotions, existing forced mates, still-winning positions | WintrChess | trivial |
| Exclude moves a shallow search already finds | Scid, Lucas Chess | per-depth PV (nearly free from existing search) |
| Only award when punishing an opponent's error | Freechess, En Croissant | trivial |

### "Brilliant" is really "sound sacrifice"

Every open-source implementation, and chess.com since 2021, detects a
sacrifice that is (near-)best, in a competitive position. The research
(Zaidi & Guerzhoy; chess.com's own pre-2021 approach; Lucas Chess) suggests
that human-perceived brilliance additionally requires the move to be **hard to
find**. A more honest scheme separates the two, as En Croissant does
(`!!` for a sacrifice that is also the clear best move; `!?` for other playable
sacrifices).

---

## 7. What this extension does

Implemented in `src/side-panel/engine/gameAnalyzer.js` (`classifyMove`) and
`src/side-panel/engine/moveHeuristics.js` (`analyzeMoveTactics`), following
WintrChess's concepts in an independent chessops-based implementation.

**Inputs:** Stockfish with MultiPV 2. Evals become Expected Points with the
Lichess curve. The engine's top move is compared to the played move with
`isSameMove` (`src/shared/chessUtils.js`), which treats both castling notations
(`e1g1` / `e1h1`) as equal.

**Order of checks:**

1. **Book** — resulting position is a named opening.
2. **Forced** — only one legal move.
3. Checkmate with the top move → **Best**.
4. If the move is the engine's top move:
   - **Gate:** not still ≥ +7.00 with the second-best move (or, without a
     second line, after the move); not losing after the move; not a queen
     promotion; not escaping check. A second-best line that is itself a
     winning mate counts as "still winning" (a deliberate difference from
     WintrChess).
   - **Brilliant (!!)** — passes the gate, not a promotion, and a genuine
     sacrifice: leaves a piece en prise that isn't merely moved to safety,
     isn't poisoned (capturing it costs equal-or-greater material or allows
     mate in one), and wasn't trapped anyway.
   - **Great (!)** — passes the gate, no existing forced mate, not a capture of
     free material, and the second-best move loses ≥ 0.10 EP.
   - otherwise **Best**.
5. **Excellent** ≤ 0.02 EP lost; **Good** ≤ 0.05.
6. **Miss** — ≥ 0.10 lost, from ≥ 0.75 to ≤ 0.55.
7. **Inaccuracy** ≤ 0.10; **Mistake** ≤ 0.20; **Blunder** > 0.20.

---

## 8. Open questions and possible next steps

- **Rename Brilliant** to something like "Sacrifice", or reserve `!!` for
  sacrifices that are also hard to find and label other sound sacrifices `!?`.
- **"Hard to find" signal:** record the PV's first move at each depth during
  the existing search; treat a move already chosen at depth ≤ 3–5 as obvious.
  This would strengthen both Great and Brilliant.
- **Even-trade recaptures:** a recapture of a *defended* piece (an even trade)
  is not "free material" and can still be Great.
- **Book overrides everything**, including bad moves that transpose into a
  named position late in the game; consider restricting to the opening phase.
- **Adopt from Lichess/chess.com:** never grade the top move as an error; Blunder
  requires material loss or allowing mate; explicit mate-created/mate-lost
  rules.
- **Test coverage:** the poisoned-sacrifice and trapped-piece paths in
  `moveHeuristics.js` lack dedicated unit tests.
