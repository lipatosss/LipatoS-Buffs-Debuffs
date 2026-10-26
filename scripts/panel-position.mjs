/**
 * Anchor the buffs/debuffs bar with the actor-sheet CSS, not live DOM geometry.
 *
 * D&D5e re-renders its sidebar during ActiveEffect changes (including eating).
 * While the old portrait is detaching, getBoundingClientRect() may yield a
 * negative coordinate and move the bar outside the actor window. The fixed
 * stylesheet anchor remains stable through those re-renders and sheet scrolls.
 */
export function keepBarAnchored(bar) {
  if (!bar) return;
  // Also fix any inline top accidentally left by an older module render.
  bar.style.removeProperty('top');
}
