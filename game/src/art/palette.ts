/**
 * The game's 24 colours (docs/ART-AND-SOUND.md, section 2).
 *
 * Every picture in the game is a text grid whose characters are the one-character
 * codes below; '.' is a transparent pixel. Nothing else may appear in a grid.
 *
 * Pure data and pure helpers: no Phaser, no DOM.
 */

/** The character that means "transparent" in a sprite grid. */
export const TRANSPARENT = '.';

export interface PaletteColor {
  /** The one-character code used in sprite grids. */
  readonly code: string;
  /** '#rrggbb', exactly as the guide lists it. */
  readonly hex: string;
  /** The guide's name, for example 'light steel'. */
  readonly name: string;
  /** 0xRRGGBB, the form Phaser tints take. */
  readonly rgb: number;
  /** What the colour is for (its hue lane). */
  readonly role: string;
}

const color = (code: string, hex: string, name: string, role: string): PaletteColor => ({
  code,
  hex,
  name,
  rgb: Number.parseInt(hex.slice(1), 16),
  role,
});

/** The palette in the guide's order. */
export const PALETTE: readonly PaletteColor[] = [
  color('0', '#0b0d1a', 'void', 'Space, the bars beside the picture, the page background, outlines, text shadow'),
  color('1', '#151a36', 'night', 'Far wall panels, button fill'),
  color('2', '#232a54', 'indigo', 'Panel seams, far machinery'),
  color('3', '#37426e', 'slate', 'Wall shade, pipes, disabled text, empty fuel pips'),
  color('4', '#53628c', 'steel', 'Wall body'),
  color('5', '#8090b4', 'light steel', 'Wall edge, moth wing shade, button rims'),
  color('6', '#bfcbe0', 'earthlight', 'Walkable top edge, spike body, stars, moth wings'),
  color('7', '#f5f8fc', 'white', 'Highlights, text, coolant froth'),
  color('8', '#f1e2c3', 'cream', 'Sprue, light side'),
  color('9', '#c4a073', 'tan', 'Sprue, mid tone'),
  color('a', '#8a5a44', 'rust', 'Sprue shade, Cinderpeg body'),
  color('b', '#3b2a30', 'char', 'Cinderpeg shade, scorch marks'),
  color('c', '#ffd65c', 'gold', 'Cog, score, fire core'),
  color('d', '#f4972a', 'amber', 'Fire, warnings, cog shade, under-glow'),
  color('e', '#d8442a', 'furnace red', 'Fire edge, spike tips, enemy cracks'),
  color('f', '#8a1c38', 'crimson', 'Fire base, game-over text'),
  color('g', '#b4f04a', 'lime', "Sprue's eye, bolt, thruster flame, focus"),
  color('h', '#4f9e3a', 'green', 'Lime shade'),
  color('i', '#7fe6ff', 'ice', 'Coolant surface'),
  color('j', '#1e9bd8', 'coolant', 'Coolant body'),
  color('k', '#135a9e', 'deep coolant', 'Coolant depth'),
  color('l', '#a56bff', 'violet', 'Ore'),
  color('m', '#ff6fb5', 'rose', 'Ore highlight, second ore'),
  color('n', '#5b2f8f', 'plum', 'Ore shade'),
];

/** All 24 codes in palette order: '0123456789abcdefghijklmn'. */
export const PALETTE_CODES: string = PALETTE.map((c) => c.code).join('');

const BY_CODE: ReadonlyMap<string, PaletteColor> = new Map(PALETTE.map((c) => [c.code, c]));

/**
 * Colours by a code-friendly name, as 0xRRGGBB. For tints and fills in the shell:
 * `text.setTint(COLOR.gold)`.
 */
export const COLOR = {
  void: 0x0b0d1a,
  night: 0x151a36,
  indigo: 0x232a54,
  slate: 0x37426e,
  steel: 0x53628c,
  lightSteel: 0x8090b4,
  earthlight: 0xbfcbe0,
  white: 0xf5f8fc,
  cream: 0xf1e2c3,
  tan: 0xc4a073,
  rust: 0x8a5a44,
  char: 0x3b2a30,
  gold: 0xffd65c,
  amber: 0xf4972a,
  furnaceRed: 0xd8442a,
  crimson: 0x8a1c38,
  lime: 0xb4f04a,
  green: 0x4f9e3a,
  ice: 0x7fe6ff,
  coolant: 0x1e9bd8,
  deepCoolant: 0x135a9e,
  violet: 0xa56bff,
  rose: 0xff6fb5,
  plum: 0x5b2f8f,
} as const;

export type ColorName = keyof typeof COLOR;

/** True for the 24 palette codes (not for '.'). */
export function isPaletteCode(ch: string): boolean {
  return BY_CODE.has(ch);
}

/** True for anything that may appear in a sprite grid: a palette code or '.'. */
export function isGridChar(ch: string): boolean {
  return ch === TRANSPARENT || BY_CODE.has(ch);
}

/** The palette entry of a code, or undefined for '.' and for anything unknown. */
export function paletteColor(code: string): PaletteColor | undefined {
  return BY_CODE.get(code);
}

/** 0xRRGGBB of a code. Throws on anything that is not one of the 24 codes. */
export function codeToRgb(code: string): number {
  const entry = BY_CODE.get(code);
  if (!entry) throw new Error(`not a palette code: '${code}'`);
  return entry.rgb;
}

/** One pixel as [red, green, blue, alpha], each 0 to 255. */
export type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];

/**
 * A grid character as RGBA: an opaque palette colour, or fully transparent for '.'.
 * Throws on a character that is neither.
 */
export function codeToRgba(code: string): Rgba {
  if (code === TRANSPARENT) return CLEAR;
  const rgb = codeToRgb(code);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255];
}

/** '#rrggbb' of a code, for CSS. Throws on anything that is not one of the 24 codes. */
export function codeToHex(code: string): string {
  const entry = BY_CODE.get(code);
  if (!entry) throw new Error(`not a palette code: '${code}'`);
  return entry.hex;
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance (WCAG) of a palette code, 0 to 1. */
export function luminance(code: string): number {
  const [r, g, b] = codeToRgba(code);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio (WCAG) between two palette codes, 1 to 21. The guide's rule: anything
 * the player must see has at least 5.0 against 'night' (code '1').
 */
export function contrast(codeA: string, codeB: string): number {
  const a = luminance(codeA);
  const b = luminance(codeB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
