/** Pure hunger transitions for D&D5e 2014.
 * Eating clears existing hunger immediately. The next long rest always starts
 * a new hunger cycle at warning level 0, even if food was eaten beforehand.
 * The ateSinceRest flag is for native rest recovery, not for skipping hunger.
 */
export const advanceHunger = level => level === null ? 0 : Math.min(level + 1, 6);
export const reduceHunger = level => level === null ? null : level === 0 ? null : level - 1;
