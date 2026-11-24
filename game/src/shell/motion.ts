/**
 * Whether the device asks for reduced motion (`prefers-reduced-motion: reduce`). What the shell does then is
 * docs/ART-AND-SOUND.md section 13, "Reduced motion": no shake, no screen flash, no shutter wipe, no particles,
 * nothing that blinks, and the few things that drift (score pop-ups, the airlock pointer, the win glow, the
 * rotate message's phone) held still. Read once when a scene or the effects are built.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false; // no media queries (a locked-down frame): full motion
  }
}
