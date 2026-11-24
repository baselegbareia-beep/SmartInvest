/**
 * The sprite manifest (docs/ART-AND-SOUND.md, section 4) as data: 62 sprites, 111 frames.
 *
 * This is the single list that the tests, the sheet builder (pixels.ts) and the game's
 * view code read. The grids themselves live in src/art/sprites/<group>.ts.
 *
 * Art numbers only (sizes, frames, ticks per frame, overlay offsets). Feel numbers
 * live in src/tuning.ts. No Phaser, no DOM.
 */
import type { EnemyKind, ItemKind } from '../core/types.ts';
import type { Sprite } from './grid.ts';

/** One tile, in art pixels. The same number as TILE_PX in src/core/types.ts (a test checks it). */
export const TILE_SIZE = 16;

/**
 * Which texture a sprite is packed onto.
 * - 'tiles': the sheet of equal 16 x 16 cells that the tile layer addresses by number
 *   (walls, hazards, decoration; the porthole takes four cells).
 * - 'sprites': everything else, packed with named frames.
 */
export type SheetName = 'tiles' | 'sprites';

/** The file in src/art/sprites that holds a sprite's grids. */
export type SpriteGroup = 'hero' | 'things' | 'enemies' | 'fx' | 'tiles' | 'background' | 'hud' | 'buttons' | 'ui';

export interface SpriteSpec<N extends string = string, G extends SpriteGroup = SpriteGroup> {
  /** The sprite's name. Its frames are `<name>_0`, `<name>_1`, ... */
  readonly name: N;
  /** Width of every frame, in art pixels. */
  readonly width: number;
  /** Height of every frame, in art pixels. */
  readonly height: number;
  /** Number of frames. */
  readonly frames: number;
  /**
   * Ticks each frame stays up, for sprites that loop at a steady rate. Absent where the
   * guide gives no rate (single frames, glints, and the two special cases below).
   */
  readonly ticksPerFrame?: number;
  readonly sheet: SheetName;
  readonly group: G;
}

function sprite<const N extends string, const G extends SpriteGroup>(
  group: G,
  name: N,
  width: number,
  height: number,
  frames: number,
  ticksPerFrame?: number,
): SpriteSpec<N, G> {
  const sheet: SheetName = group === 'tiles' || (group === 'background' && name.startsWith('bg_')) ? 'tiles' : 'sprites';
  return ticksPerFrame === undefined
    ? { name, width, height, frames, sheet, group }
    : { name, width, height, frames, ticksPerFrame, sheet, group };
}

/**
 * Every sprite, in the guide's order. The order is also the packing order of the tile
 * sheet, so the tile numbers stay the same while the art is redrawn: add new tiles at
 * the end of their sheet, never in the middle.
 */
export const MANIFEST = [
  // --- Hero and tools (src/art/sprites/hero.ts)
  sprite('hero', 'hero_idle', 16, 16, 2), // frame 1 is the blink: see HERO_BLINK
  sprite('hero', 'hero_run', 16, 16, 4, 6),
  sprite('hero', 'hero_jump', 16, 16, 1),
  sprite('hero', 'hero_fall', 16, 16, 1),
  sprite('hero', 'hero_thrust', 16, 16, 2, 4),
  sprite('hero', 'hero_die', 16, 16, 4), // spread evenly over TUNING.timing.deathAnimFrames
  sprite('hero', 'ovl_blaster', 8, 6, 1),
  sprite('hero', 'ovl_pack', 5, 8, 1),
  sprite('hero', 'thrust_flame', 6, 8, 2, 3),
  sprite('hero', 'bolt', 8, 6, 2, 3),

  // --- Things in the level (things.ts, enemies.ts)
  sprite('things', 'trophy', 16, 16, 4, 8),
  sprite('things', 'door_locked', 16, 16, 1),
  sprite('things', 'door_opening', 16, 16, 3, 6),
  sprite('things', 'door_open', 16, 16, 2), // the lamp pulses: see DOOR_OPEN_PULSE_TICKS
  sprite('things', 'gem_a', 16, 16, 2), // frame 1 is a glint
  sprite('things', 'gem_b', 16, 16, 2),
  sprite('things', 'gem_c', 16, 16, 2),
  sprite('things', 'pickup_blaster', 16, 16, 2),
  sprite('things', 'pickup_thruster', 16, 16, 2),
  sprite('enemies', 'cinderpeg', 16, 16, 4, 10),
  sprite('enemies', 'moth', 16, 16, 4, 5),

  // --- Effects (fx.ts)
  sprite('fx', 'fx_poof', 16, 16, 4),
  sprite('fx', 'fx_sparkle', 5, 5, 3),
  sprite('fx', 'fx_dust', 4, 4, 2),
  sprite('fx', 'fx_spark', 2, 2, 1),
  sprite('fx', 'fx_scrap', 4, 4, 4), // four different bits, not an animation

  // --- Tiles (tiles.ts): the tile sheet, in tile-number order
  sprite('tiles', 'wall_fill', 16, 16, 1),
  sprite('tiles', 'wall_fill_b', 16, 16, 1),
  sprite('tiles', 'wall_top', 16, 16, 1),
  sprite('tiles', 'wall_bottom', 16, 16, 1),
  sprite('tiles', 'wall_beam', 16, 16, 1),
  sprite('tiles', 'trim_left', 16, 16, 1),
  sprite('tiles', 'trim_right', 16, 16, 1),
  sprite('tiles', 'fire', 16, 16, 4, 8),
  sprite('tiles', 'coolant_top', 16, 16, 4, 15),
  sprite('tiles', 'coolant_body', 16, 16, 2, 30),
  sprite('tiles', 'spikes', 16, 16, 1),

  // --- Background (background.ts): decoration tiles on the tile sheet, backdrop pictures on the sprite sheet
  sprite('background', 'bg_panel', 16, 16, 2), // two looks (plain, seamed), not an animation
  sprite('background', 'bg_pipe_h', 16, 16, 1),
  sprite('background', 'bg_pipe_v', 16, 16, 1),
  sprite('background', 'bg_vent', 16, 16, 1),
  sprite('background', 'bg_brace', 16, 16, 1),
  sprite('background', 'bg_chain', 16, 16, 1),
  sprite('background', 'bg_hook', 16, 16, 1),
  sprite('background', 'bg_porthole', 32, 32, 1), // four tiles
  sprite('background', 'backdrop_earth', 48, 48, 1),
  sprite('background', 'backdrop_ridge', 64, 24, 1),

  // --- Top bar (hud.ts)
  sprite('hud', 'hud_life', 8, 8, 2), // lit, dark
  sprite('hud', 'hud_cog', 8, 8, 2), // outline, gold
  sprite('hud', 'hud_blaster', 8, 8, 1),
  sprite('hud', 'hud_thruster', 8, 8, 1),
  sprite('hud', 'hud_pip', 2, 6, 2), // lime, slate

  // --- Touch buttons (buttons.ts)
  sprite('buttons', 'btn_arrow', 16, 16, 1),
  sprite('buttons', 'btn_jump', 16, 16, 1),
  sprite('buttons', 'btn_fire', 16, 16, 1),
  sprite('buttons', 'btn_thrust', 16, 16, 1),
  sprite('buttons', 'btn_pause', 12, 12, 1),
  sprite('buttons', 'btn_sound', 12, 12, 2), // on, off
  sprite('buttons', 'btn_vibe', 12, 12, 2), // on, off

  // --- Menus and icon (ui.ts)
  sprite('ui', 'ui_panel', 24, 24, 1),
  sprite('ui', 'logo_cog', 32, 32, 1),
  sprite('ui', 'icon', 32, 32, 1),
] as const;

type Entry = (typeof MANIFEST)[number];

/** The name of any sprite in the manifest. */
export type SpriteName = Entry['name'];

/** The names of the sprites drawn in one file of src/art/sprites. */
export type SpriteNameIn<G extends SpriteGroup> = Extract<Entry, { readonly group: G }>['name'];

/**
 * The grids of one file of src/art/sprites: every sprite of that group, by name.
 * Typing a group file's export with this makes a missing or misspelt sprite a compile error.
 */
export type SpriteGrids<G extends SpriteGroup = SpriteGroup> = Readonly<Record<SpriteNameIn<G>, Sprite>>;

/** The manifest as a plain list of specs, for loops that do not need the literal names. */
export const SPRITE_SPECS: readonly SpriteSpec<SpriteName>[] = MANIFEST;

const BY_NAME: ReadonlyMap<string, SpriteSpec<SpriteName>> = new Map(SPRITE_SPECS.map((s) => [s.name, s]));

/** The spec of a sprite. */
export function spriteSpec(name: SpriteName): SpriteSpec<SpriteName> {
  const spec = BY_NAME.get(name);
  if (!spec) throw new Error(`not in the manifest: ${name}`);
  return spec;
}

/** The spec of a name that may or may not be a sprite (for command-line tools). */
export function findSpriteSpec(name: string): SpriteSpec<SpriteName> | undefined {
  return BY_NAME.get(name);
}

/** `hero_run` gives ['hero_run_0', 'hero_run_1', 'hero_run_2', 'hero_run_3']. */
export function frameNamesOf(spec: SpriteSpec): string[] {
  return Array.from({ length: spec.frames }, (_, i) => `${spec.name}_${i}`);
}

/** The name of one frame, with the index wrapped into the sprite's frame count. */
export function frameOf(name: SpriteName, index: number): string {
  const { frames } = spriteSpec(name);
  return `${name}_${((index % frames) + frames) % frames}`;
}

/**
 * The frame of a steadily looping sprite at a tick: `loopFrame('fire', run.tick)`.
 * Sprites without `ticksPerFrame` always give frame 0.
 */
export function loopFrame(name: SpriteName, tick: number): string {
  const spec = spriteSpec(name);
  const index = spec.ticksPerFrame === undefined ? 0 : Math.floor(tick / spec.ticksPerFrame);
  return frameOf(name, index);
}

/** Sprites and frames in total: 62 and 111. */
export const SPRITE_COUNT: number = SPRITE_SPECS.length;
export const FRAME_COUNT: number = SPRITE_SPECS.reduce((sum, s) => sum + s.frames, 0);

// ---------------------------------------------------------------------------------------
// Art numbers that belong to single sprites (docs/ART-AND-SOUND.md, section 4)
// ---------------------------------------------------------------------------------------

/** hero_idle: frame 1 (the blink) is shown for `ticks` out of every `everyTicks`. */
export const HERO_BLINK = { everyTicks: 180, ticks: 6 } as const;

/** door_open: the lamp changes frame every 30 ticks. */
export const DOOR_OPEN_PULSE_TICKS = 30;

/** door_opening plays once: 3 frames of 6 ticks after the event `doorOpened`. */
export const DOOR_OPENING_TICKS = 18;

/**
 * Where the overlays sit, as an offset from the top-left corner of the hero's 16 x 16
 * sprite when he faces right. Facing left, the overlay is flipped and the x offset is
 * mirrored: `16 - x - overlayWidth`.
 */
export const OVERLAY_OFFSET = {
  ovl_blaster: { x: 8, y: 6 },
  ovl_pack: { x: 0, y: 5 },
  thrust_flame: { x: 0, y: 13 },
} as const satisfies Partial<Record<SpriteName, { readonly x: number; readonly y: number }>>;

/** The three overlays: ovl_blaster, ovl_pack, thrust_flame. */
export type OverlayName = keyof typeof OVERLAY_OFFSET;

/**
 * Hero frames whose body is drawn higher than in hero_idle_0, in px (negative is up):
 * the bob of the run and the tuck of the jump. The overlays move with the body on these
 * frames, so the gear does not slide against it.
 */
export const HERO_BODY_LIFT: Readonly<Partial<Record<string, number>>> = {
  hero_run_1: -1,
  hero_run_3: -1,
  hero_jump_0: -1,
};

/**
 * Hero frames on which no overlay is drawn: from the second frame of the death on, the
 * crucible is in pieces, and the gear would hang in the air over them (fx_scrap carries
 * the debris).
 */
export const HERO_FRAMES_WITHOUT_GEAR: ReadonlySet<string> = new Set(['hero_die_1', 'hero_die_2', 'hero_die_3']);

/**
 * Where an overlay sits on one frame of the hero, as an offset from the top-left corner
 * of the hero's 16 x 16 sprite facing right (mirror x as for OVERLAY_OFFSET when he faces
 * left), or null when the overlay is not drawn on that frame. The view code calls this
 * instead of reading OVERLAY_OFFSET directly:
 *
 *   const at = overlayOffsetOn('ovl_pack', heroFrameName);
 *   if (at) pack.setPosition(heroX + at.x, heroY + at.y);
 */
export function overlayOffsetOn(overlay: OverlayName, heroFrame: string): { readonly x: number; readonly y: number } | null {
  if (HERO_FRAMES_WITHOUT_GEAR.has(heroFrame)) return null;
  const base = OVERLAY_OFFSET[overlay];
  return { x: base.x, y: base.y + (HERO_BODY_LIFT[heroFrame] ?? 0) };
}

/**
 * Which fx_scrap bits each event throws (frame numbers of fx_scrap: 0 rim shard, 1 leg,
 * 2 plate, 3 lamp eye). The rim shard is cream and the eye lime, Sprue's colours, so only
 * his own breaking throws them; an enemy breaks into legs and plates.
 */
export const FX_SCRAP_FRAMES = {
  enemyKilled: [1, 2],
  playerDied: [0, 1, 2, 3],
} as const satisfies Readonly<Record<string, readonly number[]>>;

// ---------------------------------------------------------------------------------------
// From the core's names to sprites (the shell's frames.ts and TileLayer.ts read these)
// ---------------------------------------------------------------------------------------

/** The sprite of each enemy kind. */
export const ENEMY_SPRITE: Readonly<Record<EnemyKind, SpriteName>> = {
  cinderpeg: 'cinderpeg',
  moth: 'moth',
};

/** The sprite of each item lying in the level. */
export const ITEM_PICKUP_SPRITE: Readonly<Record<ItemKind, SpriteName>> = {
  blaster: 'pickup_blaster',
  thruster: 'pickup_thruster',
};

/** The icon of each held item in the top bar. */
export const ITEM_HUD_SPRITE: Readonly<Record<ItemKind, SpriteName>> = {
  blaster: 'hud_blaster',
  thruster: 'hud_thruster',
};

/** The three crystal looks. A crystal at (col, row) uses `GEM_SPRITES[(col + 2 * row) % 3]`. */
export const GEM_SPRITES = ['gem_a', 'gem_b', 'gem_c'] as const satisfies readonly SpriteName[];

/** The sprite of the crystal at a cell. */
export function gemSpriteAt(col: number, row: number): SpriteName {
  return GEM_SPRITES[(col + 2 * row) % 3] ?? 'gem_a';
}

/** The five wall pictures, indexed by the guide's `base` number: 0 fill, 1 top, 2 bottom, 3 beam; 4 is the riveted fill. */
export const WALL_SPRITES = ['wall_fill', 'wall_top', 'wall_bottom', 'wall_beam', 'wall_fill_b'] as const satisfies readonly SpriteName[];

export type WallSpriteName = (typeof WALL_SPRITES)[number];

// ---------------------------------------------------------------------------------------
// Texture and font keys (makeSheet.ts creates them, the scenes use them)
// ---------------------------------------------------------------------------------------

/** Phaser texture keys of the three sheets. */
export const TEXTURE_KEY = { tiles: 'tiles', sprites: 'sprites', font: 'font' } as const;

/** Phaser bitmap font key: `this.add.bitmapText(x, y, FONT_KEY, 'TEXT', FONT_SIZE)`. */
export const FONT_KEY = 'pix';
