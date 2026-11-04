/** Shared, actor-local exclusivity for Heather mead and cooked food. */
const NS = "lipatos-buffs-debuffs";
const UNIQUE = "lipatos-aindor-unique-items";

export function isMealEffect(effect) {
  if (!effect) return false;
  return effect.flags?.[NS]?.foodBuff === true
    || effect.flags?.[NS]?.heatherWarmth === true
    || effect.flags?.[UNIQUE]?.heatherWarmth === true;
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
 * Remove ONLY meal buffs owned by this module or its existing mead feature.
 * Never delete class, spell, magic item, hunger or unrelated effects.
 * A granted temporary HP pool is cleared only when it is identifiable as
 * the meal's own pool; stronger, unrelated temp HP remain untouched.
 */
export async function replaceMealEffects(actor) {
  if (!actor?.effects) return;
  const current = [...actor.effects].filter(isMealEffect)
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
