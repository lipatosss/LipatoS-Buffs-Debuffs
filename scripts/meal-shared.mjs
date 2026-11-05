/**
 * One active cooked-food buff and one active alcoholic drink buff per actor.
 * Both categories are independent: a meal cannot dispel a drink or vice versa.
 *
 * Some v0.6.28 drink effects only had foodBuff + foodIdentifier, so recognize
 * them by their known IDs. New effects carry an explicit mealChannel.
 */
const NS = "lipatos-buffs-debuffs";
const UNIQUE = "lipatos-aindor-unique-items";
const LEGACY_DRINKS = new Set([
  "veselyy-trubadur", "kabanya-yarost-pivo", "lesnoy-shepot",
  "pastushiy-el", "shalfejnyj-el", "pancirnyy-el"
]);

export function mealEffectChannel(effect) {
  if (!effect) return null;
  const food = effect.flags?.[NS];
  if (food?.heatherWarmth === true || effect.flags?.[UNIQUE]?.heatherWarmth === true)
    return "drink";
  if (food?.foodBuff !== true) return null;
  if (food.mealChannel === "drink" || food.brewedBeer === true
      || LEGACY_DRINKS.has(String(food.foodIdentifier ?? ""))) return "drink";
  return "food";
}

export function isMealEffect(effect) {
  return mealEffectChannel(effect) !== null;
}

function grantedTemporaryHp(effect) {
  if (effect.flags?.[NS]?.foodBuff) return {
    granted: Number(effect.flags[NS].grantedTemporaryHp ?? 0),
    displayed: Number(effect.flags[NS].displayedTemporaryHp ?? 0)
  };
  const flags = effect.flags?.[NS]?.heatherWarmth
    ? effect.flags[NS] : effect.flags?.[UNIQUE]?.heatherWarmth
      ? effect.flags[UNIQUE] : null;
  return { granted: Number(flags?.lastRoll ?? 0), displayed: Number(flags?.displayedTemp ?? 0) };
}

/**
 * Replace only the requested category ("food" or "drink"), preserving all
 * unrelated effects and the other meal category.
 * Clear a replaced effect's temporary HP only when its own tracked grant is
 * still identifiable as the current pool; never clear stronger unrelated HP.
 */
export async function replaceMealEffects(actor, channel) {
  if (channel !== "food" && channel !== "drink")
    throw new Error("Unknown meal channel: " + channel);
  if (!actor?.effects) return;
  const current = [...actor.effects].filter(effect => mealEffectChannel(effect) === channel)
    .filter(effect => effect.id && actor.effects.get(effect.id));
  if (!current.length) return;
  const temporary = Number(actor.system?.attributes?.hp?.temp ?? 0);
  const removeTemp = current.some(effect => {
    const { granted, displayed } = grantedTemporaryHp(effect);
    return granted > 0 && displayed === granted && temporary > 0 && temporary <= granted;
  });
  await actor.deleteEmbeddedDocuments("ActiveEffect", current.map(effect => effect.id));
  if (removeTemp) await actor.update({ "system.attributes.hp.temp": 0 });
}
