/**
 * Every feel number of the game lives in this file and nowhere else: gravity,
 * jump strength, run speed, coyote time, jump buffering, thruster fuel, enemy
 * speeds, hitbox insets, timers.
 *
 * Rules:
 * - src/core reads these values; it never hard-codes a number that changes how
 *   the game feels.
 * - Each entry carries a comment with its unit (pixels, pixels per tick, ticks
 *   at 60 Hz) so that playtest feedback such as "the jump is floaty" can be
 *   answered by editing this file alone.
 *
 * It is empty on purpose: Phase 1 (movement feel) adds the first entries.
 */

/** The shape of the tuning table: named numbers, read-only. */
export type Tuning = Readonly<Record<string, number>>;

export const TUNING = {} as const satisfies Tuning;
