import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The source rules of docs/ARCHITECTURE.md, section 1, that keep src/core
 * deterministic and that lint does not (or not fully) enforce. This test
 * reads the text of every file under src/core that is not a test and fails,
 * naming file and line, on:
 *
 * - `**` (exponent);
 * - `for (... in ...)`;
 * - `Math` used for anything but Math.min, max, abs, sign, floor, trunc, imul
 *   (Math.round also in compileTuning.ts and validate/handicap.ts, the two
 *   places where fractions are allowed);
 * - a division that is not directly inside Math.trunc( ) or Math.floor( ),
 *   and `%` (both allowed in those same two files);
 * - `globalThis`, `self`, `window`, `global`, `eval` and `Function`: each is
 *   a way round the other rules (`globalThis.Math.sqrt`, text run as code);
 * - `.sort()` and `.toSorted()` without a comparator, or with `undefined`,
 *   and either method used any other way than `.sort(comparator)` (`['sort']`,
 *   `.sort.call`, a variable called sort), where no comparator can be seen;
 * - module-level state: a top-level `let` or `var`, and a top-level array,
 *   object or `new` that is not read-only (`as const`, a readonly type or
 *   Object.freeze);
 * - an import of src/tuning.ts anywhere but testkit.ts: the core is handed a
 *   compiled Phys and never reads TUNING itself; and a module name built
 *   from a template with `${ }`, which this test cannot check.
 *
 * It also reads every non-test file under src/ and fails when one imports
 * src/core/testkit.ts: the reference numbers are test data, not a second home
 * for feel numbers. Only *.test.ts files (and tests/, e2e/) may import it.
 * Imports are found by `from`, `import(` and `require(` with a quoted or
 * backquoted name; a name held in a variable is out of this test's reach.
 *
 * Comments, strings, template text and regular expressions are blanked out
 * before the patterns are tried, so writing about a rule does not break it.
 * The first half of this file tests that scanner on small samples; the second
 * half runs it over the real files.
 */

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

const ALLOWED_MATH = ['min', 'max', 'abs', 'sign', 'floor', 'trunc', 'imul'];
/** The two files in which fractional numbers, and so Math.round, are allowed. */
const ROUNDING_FILES = ['src/core/compileTuning.ts', 'src/core/validate/handicap.ts'];
const TUNING_MODULE = 'src/tuning';
const TESTKIT_MODULE = 'src/core/testkit';

/** Words after which a `/` starts a regular expression, not a division. */
const WORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

/** Names that reach the global object, or run text as code: through them anything the other rules ban is reachable. */
const ESCAPE_NAMES = ['globalThis', 'self', 'window', 'global', 'eval', 'Function'];

const isWordChar = (ch: string): boolean => /[\w$]/.test(ch);

/** The masked source, and the offset of every `/` that the lexer took for a division. */
interface Lexed {
  readonly masked: string;
  readonly divisions: readonly number[];
}

/**
 * The source with everything that is not code replaced by spaces: comments,
 * the inside of strings, the text of template literals (the code inside
 * `${ }` stays) and the inside of regular expressions. Line breaks and the
 * length are kept, so an offset in the result is the same offset in the
 * source.
 *
 * It is a small lexer, not a parser. Its one guess: a `/` is a division
 * after a name, a number, `)`, `]`, `++` or `--`, and the start of a regular
 * expression anywhere else, provided the expression closes on the same line.
 */
function maskSource(source: string): string {
  return lexSource(source).masked;
}

function lexSource(source: string): Lexed {
  const divisions: number[] = [];
  const out = source.split('');
  const end = source.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < end; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  /** Brace depth outside each open `${`, innermost last: the `}` that returns to that depth ends the expression. */
  const templateDepths: number[] = [];
  let braceDepth = 0;
  /** The last piece of code seen: a word, or one punctuation character. Tells a regex from a division. */
  let previous = '';

  /** Blanks template text from `from` to the closing backtick or the next `${`; returns where code resumes. */
  const skipTemplateText = (from: number): number => {
    let k = from;
    while (k < end) {
      const ch = source[k];
      if (ch === '\\') {
        k += 2;
      } else if (ch === '`') {
        blank(from, k);
        previous = '`';
        return k + 1;
      } else if (ch === '$' && source[k + 1] === '{') {
        blank(from, k);
        templateDepths.push(braceDepth);
        braceDepth += 1;
        previous = '{';
        return k + 2;
      } else {
        k += 1;
      }
    }
    blank(from, end);
    return end;
  };

  let i = 0;
  while (i < end) {
    const ch = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (ch === '/' && next === '/') {
      const stop = source.indexOf('\n', i);
      blank(i, stop < 0 ? end : stop);
      i = stop < 0 ? end : stop;
    } else if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const stop = close < 0 ? end : close + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < end && source[k] !== ch && source[k] !== '\n') k += source[k] === '\\' ? 2 : 1;
      blank(i + 1, k);
      previous = ch;
      i = k + 1;
    } else if (ch === '`') {
      i = skipTemplateText(i + 1);
    } else if (ch === '}' && templateDepths.at(-1) === braceDepth - 1) {
      // The end of a `${ }`: back to template text.
      templateDepths.pop();
      braceDepth -= 1;
      i = skipTemplateText(i + 1);
    } else if (ch === '/' && (previous === '' || WORDS_BEFORE_REGEX.has(previous) || /^[^\w$)\]'"`]$/.test(previous))) {
      // A regular expression, if it closes on this line; otherwise it was a division after all.
      let k = i + 1;
      let inClass = false;
      while (k < end && source[k] !== '\n' && (inClass || source[k] !== '/')) {
        if (source[k] === '\\') k += 1;
        else if (source[k] === '[') inClass = true;
        else if (source[k] === ']') inClass = false;
        k += 1;
      }
      if (k < end && source[k] === '/') {
        blank(i + 1, k);
        previous = ')';
        i = k + 1;
      } else {
        divisions.push(i);
        previous = '/';
        i += 1;
      }
    } else if (isWordChar(ch)) {
      let k = i + 1;
      while (k < end && isWordChar(source[k] ?? '')) k += 1;
      previous = source.slice(i, k);
      i = k;
    } else {
      if (ch === '{') braceDepth += 1;
      if (ch === '}') braceDepth -= 1;
      if (ch === '/') divisions.push(i);
      // `i++ / 2`: after a postfix ++ or -- a slash divides. Remembered as two characters, so the
      // regular-expression test above (one punctuation character) does not take it for an operator.
      if ((ch === '+' || ch === '-') && previous === ch && source[i - 1] === ch) previous = ch + ch;
      else if (ch.trim() !== '') previous = ch;
      i += 1;
    }
  }
  return { masked: out.join(''), divisions };
}

/** The 1-based line of an offset. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset; k++) {
    if (source[k] === '\n') line += 1;
  }
  return line;
}

interface ImportName {
  readonly specifier: string;
  readonly offset: number;
  /** A template with `${ }`: the module is only known when the code runs. */
  readonly computed: boolean;
}

/** Every module named by an import, re-export, import( ) or require( ) of the file, with the offset of its name. */
function importsOf(source: string, masked: string): ImportName[] {
  const found: ImportName[] = [];
  // In the masked text only real code is left, and the quotes of a string (and the backquotes of a
  // template) survive around its blanked inside.
  for (const match of masked.matchAll(/(?<![\w$.])(?:from\s*|import\s*\(?\s*|require\s*\(\s*)(['"`])/g)) {
    const quote = match[1] ?? '"';
    const open = match.index + match[0].length - 1;
    const close = source.indexOf(quote, open + 1);
    if (close > open) {
      const specifier = source.slice(open + 1, close);
      found.push({ specifier, offset: open, computed: quote === '`' && specifier.includes('${') });
    }
  }
  return found;
}

/** What a relative import of `file` points at, as a path from the project root without extension; null for a package. */
function resolveImport(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const withoutQuery = specifier.replace(/[?#].*$/, '');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), withoutQuery));
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

/** The text of a `for (` header at paren depth 0 only: nested brackets and their contents are left out. */
function topLevelHeader(masked: string, openParen: number): string {
  let depth = 0;
  let text = '';
  for (let k = openParen; k < masked.length; k++) {
    const ch = masked[k] ?? '';
    if ('([{'.includes(ch)) {
      depth += 1;
      if (depth > 1) text += ' ';
    } else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return text;
      text += ' ';
    } else if (depth === 1) {
      text += ch;
    }
  }
  return text;
}

/** For every offset of the masked text, the depth of `{ }` and of `( )` around it (index = offset). */
function depthsOf(masked: string): { braces: Int32Array; parens: Int32Array } {
  const braces = new Int32Array(masked.length + 1);
  const parens = new Int32Array(masked.length + 1);
  for (let k = 0; k < masked.length; k++) {
    const ch = masked[k];
    braces[k + 1] = (braces[k] ?? 0) + (ch === '{' ? 1 : ch === '}' ? -1 : 0);
    parens[k + 1] = (parens[k] ?? 0) + (ch === '(' ? 1 : ch === ')' ? -1 : 0);
  }
  return { braces, parens };
}

/** The offset of the bracket that closes the one opening at `open`, or -1. */
function closingBracket(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    const ch = masked[k] ?? '';
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Whether the division at `offset` sits directly inside the parentheses of Math.trunc( ) or Math.floor( ). */
function insideTruncOrFloor(masked: string, offset: number): boolean {
  let depth = 0;
  for (let k = offset - 1; k >= 0; k--) {
    const ch = masked[k] ?? '';
    if (')]}'.includes(ch)) {
      depth += 1;
    } else if ('([{'.includes(ch)) {
      if (depth > 0) {
        depth -= 1;
      } else {
        // The innermost bracket around the division: it must be the call's own parenthesis.
        return ch === '(' && /(?<![\w$.])Math\s*\.\s*(?:trunc|floor)\s*$/.test(masked.slice(0, k));
      }
    }
  }
  return false;
}

/**
 * The determinism rules for one non-test file of src/core. `file` is its
 * path from the project root with forward slashes. Returns one line per
 * offence: "src/core/x.ts:12: what is wrong".
 */
function coreViolations(file: string, source: string): string[] {
  const { masked, divisions } = lexSource(source);
  const found: { offset: number; message: string }[] = [];
  const report = (offset: number, message: string): void => {
    found.push({ offset, message });
  };
  const fractionsAllowed = ROUNDING_FILES.includes(file);

  for (const match of masked.matchAll(/\*\*/g)) {
    report(match.index, '"**" is forbidden in the core: its result need not be an integer; multiply instead');
  }

  for (const match of masked.matchAll(/(?<![\w$.])for\s*(?:await\s*)?\(/g)) {
    // A header without ";" is for...in or for...of: the first of the two words decides which.
    const header = topLevelHeader(masked, match.index + match[0].length - 1);
    if (!header.includes(';') && /\b(in|of)\b/.exec(header)?.[1] === 'in') {
      report(match.index, 'for...in is forbidden in the core: its order depends on how the object was built');
    }
  }

  for (const match of masked.matchAll(/(?<![\w$.])Math\b(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g)) {
    const member = match[1];
    if (member === undefined) {
      report(match.index, 'Math may be used only as Math.<function> in the core, so that the function is in plain sight');
    } else if (member === 'round') {
      if (!ROUNDING_FILES.includes(file)) {
        report(
          match.index,
          'Math.round is allowed only in compileTuning.ts and validate/handicap.ts: the rest of the core never sees a fraction',
        );
      }
    } else if (!ALLOWED_MATH.includes(member)) {
      report(match.index, `Math.${member} is forbidden in the core (allowed: Math.${ALLOWED_MATH.join(', ')})`);
    }
  }

  if (!fractionsAllowed) {
    for (const offset of divisions) {
      if (!insideTruncOrFloor(masked, offset)) {
        report(offset, 'a division must sit directly inside Math.trunc( ) or Math.floor( ) in the core: anything else can leave a fraction');
      }
    }
    for (const match of masked.matchAll(/%/g)) {
      report(match.index, '"%" is forbidden in the core: it is not on the list of allowed arithmetic (on a negative number it gives a negative remainder); use a mask or Math.floor');
    }
  }

  for (const match of masked.matchAll(new RegExp(`(?<![\\w$.])(${ESCAPE_NAMES.join('|')})(?![\\w$])`, 'g'))) {
    report(match.index, `${match[1] ?? ''} is forbidden in the core: through it code reaches what the other rules forbid (Math, timers, the DOM, text run as code)`);
  }

  // Every sort must be a call `.sort(comparator)` that this test can see. A call with nothing or
  // `undefined` orders numbers as text; any other use (`.sort.call`, `['sort']`, a variable named sort)
  // hides the comparator from this test.
  for (const match of masked.matchAll(/(?<![\w$])(sort|toSorted)(?![\w$])/g)) {
    const name = match[1] ?? 'sort';
    const asMethod = /\??\.\s*$/.test(masked.slice(Math.max(0, match.index - 4), match.index));
    const after = match.index + name.length;
    const call = /^\s*\(/.exec(masked.slice(after));
    if (asMethod && call !== null) {
      const open = after + call[0].length - 1;
      const close = closingBracket(masked, open);
      const argument = masked.slice(open + 1, close < 0 ? masked.length : close).trim();
      if (argument === '' || /^(?:undefined|void\s+0|null)$/.test(argument)) {
        report(match.index - 1, `.${name}() without a comparator is forbidden in the core: it orders numbers as text`);
      }
    } else {
      report(match.index, `${name} used other than as .${name}(comparator) is forbidden in the core: this test cannot see its comparator`);
    }
  }
  for (const match of source.matchAll(/\[\s*(['"`])(sort|toSorted)\1\s*\]/g)) {
    if (masked[match.index] === '[') {
      report(match.index, `${match[2] ?? 'sort'} used other than as .${match[2] ?? 'sort'}(comparator) is forbidden in the core: this test cannot see its comparator`);
    }
  }

  // Module-level state: only constants may live outside a function, so nothing carries over from one call to the next.
  const { braces, parens } = depthsOf(masked);
  const topLevel = (offset: number): boolean => braces[offset] === 0 && parens[offset] === 0;
  for (const match of masked.matchAll(/(?<![\w$.])(let|var)(?![\w$])/g)) {
    if (topLevel(match.index)) {
      report(match.index, `a module-level ${match[1] ?? 'let'} is forbidden in the core: state lives in GameState, never in a module`);
    }
  }
  for (const match of masked.matchAll(/(?<![\w$.])const\s+[A-Za-z_$][\w$]*\s*(:[^=;]*)?=\s*(\[|\{|new(?![\w$]))/g)) {
    if (!topLevel(match.index)) continue;
    const readonlyType = /\breadonly\b|\bReadonly(?:Set|Map|Array)?\s*</.test(match[1] ?? '');
    const start = match.index + match[0].length - (match[2] ?? '').length;
    const close = match[2] === 'new' ? -1 : closingBracket(masked, start);
    const asConst = close >= 0 && /^\s*as\s+const\b/.test(masked.slice(close + 1));
    if (!readonlyType && !asConst) {
      report(match.index, 'a module-level array, object or "new" must be read-only in the core (as const, a readonly type or Object.freeze): state lives in GameState, never in a module');
    }
  }

  for (const { specifier, offset, computed } of importsOf(source, masked)) {
    if (computed) {
      report(offset, `a module name in the core must be written out in full ('${specifier}'), so that this test can check it`);
    } else if (file !== `${TESTKIT_MODULE}.ts` && resolveImport(file, specifier) === TUNING_MODULE) {
      report(offset, `the core must not import src/tuning.ts ('${specifier}'): it is handed a compiled Phys instead`);
    }
  }

  return found
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, message }) => `${file}:${lineAt(source, offset)}: ${message}`);
}

/** The one rule for every non-test file of the game, core and shell alike: no import of the test kit. */
function testkitViolations(file: string, source: string): string[] {
  if (file === `${TESTKIT_MODULE}.ts`) return [];
  const why = 'it is test data, for *.test.ts files only';
  return importsOf(source, maskSource(source))
    .filter(({ specifier, computed }) =>
      // A computed name cannot be resolved here; one that spells out "testkit" is reported all the same.
      computed ? specifier.includes('testkit') : resolveImport(file, specifier) === TESTKIT_MODULE,
    )
    .map(({ specifier, offset }) => {
      const where = `${file}:${lineAt(source, offset)}`;
      return `${where}: game code must not import src/core/testkit.ts ('${specifier}'): ${why}`;
    });
}

// ---------------------------------------------------------------------------
// The scanner, tested on samples
// ---------------------------------------------------------------------------

const SAMPLE = 'src/core/sample.ts';

/** The offences of a sample, shortened to "line: first words" so the expectations stay readable. */
const offences = (source: string, file = SAMPLE): string[] =>
  coreViolations(file, source).map((line) => line.slice(file.length + 1).replace(/^(\d+: \S+(?: \S+)?).*$/, '$1'));

/** The masked source with every run of blanks drawn as one space, so an expectation shows what is left as code. */
const codeOf = (source: string): string => maskSource(source).replace(/\s+/g, ' ').trim();

describe('the scanner: what counts as code', () => {
  it('keeps the length and the line breaks of the source', () => {
    const source = "const a = 'x'; // note\n/* two\nlines */ const b = `t${a}t`;\nconst r = /x'y/;\n";
    const masked = maskSource(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n').map((line) => line.length)).toEqual(source.split('\n').map((line) => line.length));
  });

  it('blanks line comments, block comments and doc comments', () => {
    expect(codeOf('a = 1; // Math.sqrt(2) ** 3\nb = 2;')).toBe('a = 1; b = 2;');
    expect(codeOf('/** x ** y */ c = 3; /* for (k in o) */')).toBe('c = 3;');
    expect(codeOf('/*\n * for (k in o)\n */\nd = 4;')).toBe('d = 4;');
  });

  it('blanks the inside of strings and keeps their quotes', () => {
    expect(codeOf(`a = 'Math.pow'; b = "it's ** here"; c = 'a\\'b ** c';`)).toBe(`a = ' '; b = " "; c = ' ';`);
  });

  it('blanks template text and keeps the code inside ${ }, nested templates included', () => {
    expect(codeOf('t = `sum ** ${a + b} done`;')).toBe('t = ` ${a + b} `;');
    expect(codeOf('t = `a ${ `b ${ x * 2 } c` } d ${ {k: 1}.k } e`;')).toBe('t = ` ${ ` ${ x * 2 } ` } ${ {k: 1}.k } `;');
  });

  it('blanks regular expressions, quotes and slashes inside them included', () => {
    expect(codeOf(`r = /['"]\\/\\*\\*[/]x/g; s = 'kept';`)).toBe(`r = / /g; s = ' ';`);
    expect(codeOf('ok = list.filter((x) => /^@\\w+ **$/.test(x));')).toBe('ok = list.filter((x) => / /.test(x));');
    expect(codeOf('return /a b/.test(s) ? 1 : 2;')).toBe('return / /.test(s) ? 1 : 2;');
  });

  it('leaves a division alone, also several on one line and one after ++ or --', () => {
    const source = 'const mid = (a + b) / 2 + total / count / 2 + list[0] / n + i++ / 2;';
    expect(maskSource(source)).toBe(source);
    // A second slash later on the line once made the first one look like the start of a regular expression.
    for (const after of ['i++ / 2 ** 3 / 4;', 'i-- / 2 ** 3 / 4;', 'a[i++] / 2 / b;']) {
      expect(maskSource(after), after).toBe(after);
    }
  });
});

describe('the scanner: the rules', () => {
  it('finds ** and **= in code', () => {
    expect(offences('const a = b ** 2;\nfunction f(c: number) {\n  c **= 3;\n}')).toEqual(['1: "**" is', '3: "**" is']);
  });

  it('does not mistake a doc comment, a comment or a string for **', () => {
    const source = ['/** The power x ** y is not used. */', "const text = 'a ** b'; // 2 ** 3", 'const t = `${text} ** `;'];
    expect(offences(source.join('\n'))).toEqual([]);
  });

  it('finds ** inside a template expression, where it is code', () => {
    expect(offences('const t = `area ${side ** 2} px`;')).toEqual(['1: "**" is']);
  });

  it('finds for...in, with or without a declaration, also when the header spans lines', () => {
    expect(offences('for (const key in table) use(key);')).toEqual(['1: for...in is']);
    expect(offences('function f() {\n  let key;\n  for (key in table) use(key);\n}')).toEqual(['3: for...in is']);
    expect(offences('for (\n  const key\n  in table\n) {\n}')).toEqual(['1: for...in is']);
  });

  it('accepts for...of, counted loops and the in operator elsewhere', () => {
    expect(
      offences(
        [
          'for (const item of list) use(item);',
          'for (const [key, value] of Object.entries(table)) use(key, value);',
          'for (let i = 0; i < n; i++) use(i);',
          "for (let i = 0; 'a' in table; i++) use(i);",
          "if ('a' in table) use(1);",
          'for (const item of pick(a in b)) use(item);',
          'inform(x); platform(y);',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('accepts the seven allowed Math functions', () => {
    expect(
      offences(
        [
          'const v = Math.min(a, b) + Math.max(a, b) + Math.abs(a) + Math.sign(a);',
          'const w = Math.floor(a / b) + Math.trunc(a / b) + Math.imul(a, b);',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('finds every other use of Math, with the name of the function', () => {
    expect(offences('const a = Math.sqrt(2);')).toEqual(['1: Math.sqrt is']);
    expect(offences('const a = 1;\nconst b = Math.sin(a) + Math.PI;')).toEqual(['2: Math.sin is', '2: Math.PI is']);
    expect(offences('const a = Math.ceil(1.5);')).toEqual(['1: Math.ceil is']);
    expect(offences('const a = Math.random();')).toEqual(['1: Math.random is']);
    expect(offences('const a = Math\n  .pow(2, 3);')).toEqual(['1: Math.pow is']);
    expect(offences('const a = Math . hypot(3, 4);')).toEqual(['1: Math.hypot is']);
  });

  it('finds Math used in a way that hides the function', () => {
    expect(offences("const a = Math['pow'](2, 3);")).toEqual(['1: Math may']);
    expect(offences('const { sqrt } = Math;')).toEqual(['1: Math may']);
    expect(offences('const a = Math?.sqrt(2);')).toEqual(['1: Math may']);
  });

  it('does not mistake other names, comments or strings for Math', () => {
    const source = ['const a = myMath.sqrt(2) + lib.Math.sqrt(2) + Mathematics.sqrt(2); // Math.sqrt', "const s = 'Math.sqrt';"];
    expect(offences(source.join('\n'))).toEqual([]);
  });

  it('allows Math.round in compileTuning.ts and validate/handicap.ts only', () => {
    const source = 'const sub = Math.round(px * 256);';
    expect(offences(source)).toEqual(['1: Math.round is']);
    expect(offences(source, 'src/core/validate/search.ts')).toEqual(['1: Math.round is']);
    expect(offences(source, 'src/core/compileTuning.ts')).toEqual([]);
    expect(offences(source, 'src/core/validate/handicap.ts')).toEqual([]);
    expect(offences('const a = Math.sqrt(2);', 'src/core/compileTuning.ts')).toEqual(['1: Math.sqrt is']);
  });

  it('finds sort() and toSorted() without a comparator, however they are spaced', () => {
    expect(offences('list.sort();')).toEqual(['1: .sort() without']);
    expect(offences('use([...list].toSorted());')).toEqual(['1: .toSorted() without']);
    expect(offences('const a = list\n  .filter(Boolean)\n  .sort(\n  );')).toEqual(['3: .sort() without']);
    expect(offences('list?.sort ( );')).toEqual(['1: .sort() without']);
  });

  it('accepts sort with a comparator, and names that only contain "sort"', () => {
    expect(offences('list.sort((a, b) => a - b); list.sort(byCost); resort(); list.sorted();')).toEqual([]);
  });

  it('finds an import of src/tuning.ts, from any depth, type-only included', () => {
    expect(offences("import { TUNING } from '../tuning';")).toEqual(['1: the core']);
    expect(offences("import type { Tuning } from '../tuning.ts';")).toEqual(['1: the core']);
    const deep = ["import { x } from './types';", 'export { TUNING } from "../../tuning";'].join('\n');
    expect(offences(deep, 'src/core/validate/search.ts')).toEqual(['2: the core']);
    expect(offences("const t = await import('../tuning');")).toEqual(['1: the core']);
    expect(offences('const t = await import(`../tuning`);')).toEqual(['1: the core']);
    expect(offences("const t = require('../tuning');")).toEqual(['1: the core']);
  });

  it('finds a module name built from a template with ${ }: this test could not check where it leads', () => {
    expect(offences('const t = await import(`../${name}`);')).toEqual(['1: a module']);
  });

  it('accepts imports that only look like tuning, and mentions of it in comments and strings', () => {
    expect(
      offences(
        [
          "import { compileTuning } from './compileTuning';",
          "import type { Tuning } from './types';",
          "import { thing } from './tuning';",
          "// import { TUNING } from '../tuning';",
          "const hint = \"import { TUNING } from '../tuning'\";",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('lets testkit.ts import src/tuning.ts: the shell-only groups of the reference tuning come from it', () => {
    expect(offences("import { TUNING } from '../tuning';", 'src/core/testkit.ts')).toEqual([]);
  });

  it('finds a division that is not directly inside Math.trunc( ) or Math.floor( ), outside the two fraction files', () => {
    expect(offences('const half = a / 2;')).toEqual(['1: a division']);
    expect(offences('function f(x: number) {\n  x /= 2;\n  return x;\n}')).toEqual(['2: a division']);
    // Inside the call, but inside something else first: the fraction reaches f or the array.
    expect(offences('const a = Math.floor(f(x / 2));')).toEqual(['1: a division']);
    expect(offences('const a = Math.floor([x / 2][0]);')).toEqual(['1: a division']);
    expect(offences('const a = myMath.floor(x / 2);')).toEqual(['1: a division']);
    expect(offences('const a = Math.round(x / 2);', 'src/core/validate/handicap.ts')).toEqual([]);
    expect(offences('const a = x / 2;', 'src/core/compileTuning.ts')).toEqual([]);
  });

  it('accepts a division directly inside Math.trunc( ) or Math.floor( ), and slashes that are not divisions', () => {
    expect(
      offences(
        [
          'const a = Math.floor(x / y) + Math.trunc((x + y) / 2) + Math.floor(x / y + z / 4);',
          'const b = Math . trunc ( x / y );',
          '// a / b in a comment, and in a string:',
          "const c = 'a / b' + `${Math.floor(x / 2)} / 2`;",
          'const d = /a\\/b/.test(s);',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('finds % and %=, outside the two fraction files', () => {
    expect(offences('const m = a % 3;')).toEqual(['1: "%" is']);
    expect(offences('function f(a: number) {\n  a %= 3;\n  return a;\n}')).toEqual(['2: "%" is']);
    expect(offences("const s = '100%' + `${n}%`;")).toEqual([]);
    expect(offences('const odd = (16 - w) % 2;', 'src/core/compileTuning.ts')).toEqual([]);
  });

  it('finds the names that lead round the other rules: globalThis, self, window, global, eval, Function', () => {
    expect(offences('const a = globalThis.Math.sqrt(2);')).toEqual(['1: globalThis is']);
    expect(offences('const M = globalThis.Math;\nconst b = M.pow(2, 3);')).toEqual(['1: globalThis is']);
    expect(offences('const a = self.Math.random();')).toEqual(['1: self is']);
    expect(offences('const a = window.Math.random();')).toEqual(['1: window is']);
    expect(offences('const a = global.Math.random();')).toEqual(['1: global is']);
    expect(offences("const a = eval('Math.random()');")).toEqual(['1: eval is']);
    expect(offences("use(new Function('return Math.random()')());")).toEqual(['1: Function is']);
  });

  it('accepts names that only contain those words, and properties called that way', () => {
    expect(offences('use(node.self, item.global, myself, globalThing, evaluate, isFunction);')).toEqual([]);
  });

  it('finds every sort whose comparator cannot be seen: undefined, a string key, .call, a variable', () => {
    expect(offences('list.sort(undefined);')).toEqual(['1: .sort() without']);
    expect(offences('list.toSorted( void 0 );')).toEqual(['1: .toSorted() without']);
    expect(offences("list['sort']();")).toEqual(['1: sort used']);
    expect(offences('list[`toSorted`]();')).toEqual(['1: toSorted used']);
    expect(offences('Array.prototype.sort.call(list);')).toEqual(['1: sort used']);
    expect(offences('function f(list: number[]) {\n  const { sort } = Array.prototype;\n  return sort.apply(list);\n}')).toEqual([
      '2: sort used',
      '3: sort used',
    ]);
  });

  it('finds module-level state: a top-level let or var, and a top-level array, object or new that is not read-only', () => {
    const first = (source: string): string => coreViolations(SAMPLE, source).join('\n');
    expect(first('let calls = 0;\nexport const f = (): number => (calls += 1);')).toMatch(/^src\/core\/sample\.ts:1: a module-level let is/);
    expect(first('var seen = 0;')).toMatch(/:1: a module-level var is/);
    for (const source of ['const cache = new Map<number, number>();', 'export const seen: number[] = [];', 'const table = { a: 1 };']) {
      expect(first(source), source).toMatch(/:1: a module-level array, object or "new" must be read-only/);
      expect(offences(source), source).toHaveLength(1);
    }
  });

  it('accepts read-only module-level constants, and let, var and literals inside functions', () => {
    expect(
      offences(
        [
          "const ORDER = ['a', 'b'] as const;",
          "export const Kind = { A: 0, B: 1 } as const;",
          "const NAMES: readonly string[] = ['a'];",
          "const LEGEND: ReadonlySet<string> = new Set('ab');",
          'const BITS: Readonly<Record<string, number>> = { a: 1 };',
          'const FROZEN = Object.freeze({ a: 1 });',
          'const N = 3;',
          'const { a } = b;',
          'function f(): number[] {',
          '  let n = 0;',
          '  var m = 1;',
          '  const list = [n, m];',
          '  for (let i = 0; i < 2; i++) n += i;',
          '  return list;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reports offences in file order with file and line', () => {
    expect(coreViolations(SAMPLE, 'const a = 1;\n\nconst b = Math.sqrt(a) ** 2;\nlist.sort();')).toEqual([
      'src/core/sample.ts:3: Math.sqrt is forbidden in the core (allowed: Math.min, max, abs, sign, floor, trunc, imul)',
      'src/core/sample.ts:3: "**" is forbidden in the core: its result need not be an integer; multiply instead',
      'src/core/sample.ts:4: .sort() without a comparator is forbidden in the core: it orders numbers as text',
    ]);
  });
});

describe('the scanner: imports of the test kit', () => {
  it('finds an import of testkit.ts from the core, from the shell, static, dynamic or re-exported', () => {
    const why = 'it is test data, for *.test.ts files only';
    expect(testkitViolations('src/core/game.ts', "import { REFERENCE_PHYS } from './testkit';")).toEqual([
      `src/core/game.ts:1: game code must not import src/core/testkit.ts ('./testkit'): ${why}`,
    ]);
    expect(testkitViolations('src/core/validate/search.ts', "import { IN } from '../testkit.ts';")).toHaveLength(1);
    expect(testkitViolations('src/shell/scenes/PlayScene.ts', "\nimport type { X } from '../../core/testkit';")).toEqual([
      `src/shell/scenes/PlayScene.ts:2: game code must not import src/core/testkit.ts ('../../core/testkit'): ${why}`,
    ]);
    expect(testkitViolations('src/main.ts', "const kit = await import('./core/testkit');")).toHaveLength(1);
    expect(testkitViolations('src/core/index.ts', "export * from './testkit';")).toHaveLength(1);
    // Template literals, with and without ${ }, and require.
    expect(testkitViolations('src/core/game.ts', 'const kit = await import(`./testkit`);')).toHaveLength(1);
    expect(testkitViolations('src/shell/scenes/PlayScene.ts', 'const kit = await import(`../../core/testkit`);')).toHaveLength(1);
    expect(testkitViolations('src/shell/x.ts', 'const kit = await import(`../core/${"testkit"}.ts`);')).toHaveLength(1);
    expect(testkitViolations('src/main.ts', "const kit = require('./core/testkit');")).toHaveLength(1);
  });

  it('accepts other imports, and mentions of the test kit in comments and strings', () => {
    expect(
      testkitViolations(
        'src/core/game.ts',
        [
          "import { createRun } from './run';",
          "// see './testkit'",
          "const s = \"from './testkit'\";",
          "import x from './testkitty';",
        ].join('\n'),
      ),
    ).toEqual([]);
    expect(testkitViolations('src/shell/testkit.ts', "import { a } from './testkit';")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real files
// ---------------------------------------------------------------------------

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(CORE_DIR);
const ROOT_DIR = path.dirname(SRC_DIR);

const isSourceFile = (name: string): boolean => /\.[cm]?[jt]sx?$/.test(name);
const isTestFile = (name: string): boolean => /\.test\.[cm]?[jt]sx?$/.test(name);

/** Every non-test source file under `dir`, as a path from the project root with forward slashes, in a fixed order. */
function gameFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...gameFiles(full));
    else if (isSourceFile(entry.name) && !isTestFile(entry.name)) {
      files.push(path.relative(ROOT_DIR, full).split(path.sep).join('/'));
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const read = (file: string): string => readFileSync(path.join(ROOT_DIR, file), 'utf8');

describe('src/core', () => {
  const coreFiles = gameFiles(CORE_DIR);

  it('is found by this test: the scan covers the contract and the modules beside it', () => {
    expect(coreFiles).toContain('src/core/types.ts');
    expect(coreFiles).toContain('src/core/level.ts');
    expect(coreFiles).toContain('src/core/testkit.ts');
    expect(coreFiles.filter(isTestFile)).toEqual([]);
  });

  it('holds no **, no for...in, no Math beyond the allowed list, no bare sort() and no import of src/tuning.ts', () => {
    expect(coreFiles.flatMap((file) => coreViolations(file, read(file)))).toEqual([]);
  });
});

describe('game code', () => {
  it('never imports src/core/testkit.ts: only test files may', () => {
    const files = gameFiles(SRC_DIR);
    expect(files).toContain('src/main.ts');
    expect(files.flatMap((file) => testkitViolations(file, read(file)))).toEqual([]);
  });
});
