// What every whiteboard prompt (steps and Q&A sketches) says about the board: its objects,
// targets and actions, and how a narration is spoken and cued. Built from constants only, so
// the step prompt that embeds it stays byte-identical between requests and keeps its cache.
import "server-only";
import { CANVAS, CELL, MAX_MATRIX_DIM } from "@/shared/scene";

/** The "# The whiteboard" section: the canvas and the kinds of object. */
export const BOARD_OBJECTS_PROMPT = `# The whiteboard

The canvas is ${CANVAS.w} wide and ${CANVAS.h} high, origin at the top left. Every object needs a unique id (lowercase letters, digits and underscores, starting with a letter, at most 32 characters). In objects, use only these kinds of object (there are no images):

- matrix: x, y is the top-left corner. rows is 1 to ${MAX_MATRIX_DIM} rows of 1 to ${MAX_MATRIX_DIM} cells, all the same length; "" is an empty cell. Every cell is ${CELL.w} wide and ${CELL.h} high, so cell (r, c) has its centre at (x + ${CELL.w}c + ${CELL.w / 2}, y + ${CELL.h}r + ${CELL.h / 2}) and the whole matrix fits in its cell box. Optional label, drawn outside the box. Keep cell values short (a number or a symbol).
- text: x, y is the centre. size is "s", "m" or "l".
- latex: x, y is the centre. tex is KaTeX math (no \\href, \\url or other links).
- arrow: from and to are each an object (its centre), a matrix row, column or cell, or a point {x, y}. Never another arrow. Optional label.

Every object, and every point, must be inside the canvas: a matrix's whole cell box, the centre of a text or latex. Leave room around objects so nothing overlaps, including after moves.`;

/** What a target is, and what each action does. */
export const BOARD_ACTIONS_PROMPT = `A target is an object id, optionally with row and/or col (0-based) to pick a part of a grid: a row, column or cell of a matrix or a heatmap, or a plot's series (row) and a point of it (col). Other objects have no parts, and a part must be inside its object.

- show / hide: show or hide a whole object. show takes a part only on a heatmap (a row, column or cell, revealing it) or a plot (a series, drawing it on from left to right), never a single plot point.
- highlight / unhighlight: color "accent" (the default) or "warn".
- move: the target's centre slides to the anchor in to (an object, a matrix part or a point). Moving a row, column or cell slides a copy of it and leaves the matrix whole; later actions on that part use the copy, and hide on the part removes the copy. Arrows can't move, and neither can a part of a heatmap or a plot (move the whole object).
- write: replaces a text object's text, or a matrix cell's value (needs both row and col), with value. Not for latex, arrows, heatmaps or plots.

Every action has the same fields: color is only for highlight and unhighlight, to only for move (which needs it), and value only for write (which needs it).`;

/** How a narration is written for the voice, and how its cue markers work (two list items). */
export const NARRATION_RULES_PROMPT = `- Plain spoken English. The voice reads symbols badly, so spell all maths out in words: "x squared", not "x²" or "x^2"; "the square root of d", not "√d"; "alpha", not "α". No markdown, no LaTeX, no maths symbols. Formulas belong on the board, in latex objects.
- Cue markers mark the word where an action fires: \`[[name]]\` placed directly before that word, as in "take the [[first]]first row". A name is lowercase letters, digits and underscores, starting with a letter, at most 32 characters. Each name appears once. Any other use of double square brackets is an error.`;
