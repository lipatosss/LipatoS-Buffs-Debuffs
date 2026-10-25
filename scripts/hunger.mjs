/** LipatoS hunger for D&D5e 6.0.6 / Foundry V14, Legacy 2014 rules.
 * Only the D&D5e built-in "exhaustion" CONDITION has mechanical effects.
 * Hunger flags track missed meals; the cosmetic level-0 warning has no changes.
 * Neither actor.attributes.exhaustion nor any roll formulas are overridden here.
 */
const NS = 'lipatos-buffs-debuffs';
const CHANNEL = `module.${NS}`;
const tasks = new Map();
// De-duplicate the SAME rest result, not every rest inside a time window.
// Fast consecutive long rests are valid (GM testing often does this).
const processedRestEvents = new WeakSet();
const received = new Set();
const ZERO_ICON = `modules/${NS}/icons/hunger-0.webp`;
// Fixed document ID used by D&D5e 6.x for the official Exhaustion condition.
const EXHAUSTION_ID = 'dnd5eexhaustion0';

export const STEP = Object.freeze([
  'Пора поесть. Пока штрафов нет; следующий долгий отдых без еды вызовет истощение 1.',
  'Помеха на проверки характеристик.',
  'Скорость передвижения уменьшается вдвое.',
  'Помеха на броски атаки и спасброски.',
  'Максимум хитов уменьшается вдвое.',
  'Скорость становится 0.',
  'Смерть от истощения.'
]);
export const INFO = STEP;
export const advanceHunger = (level, fed) => fed ? null : level === null ? 0 : Math.min(level + 1, 6);
export const reduceHunger = level => level === null ? null : level === 0 ? null : level - 1;

function levelOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 6 ? number : null;
}
function effectsOf(actor) { return [...(actor?.effects ?? [])]; }
function isExhaustion(effect) {
  return effect?.system?.type === 'exhaustion'
    || effect?.statuses?.has?.('exhaustion') === true
    || effect?.statuses?.includes?.('exhaustion') === true;
}
function nativeCondition(actor) {
  // Foundry's actor.effects can briefly hold a stale ActiveEffect while the
  // native D&D5e long-rest handler deletes the persisted document. Never
  // update a document whose ID is missing from the underlying source.
  if (!persistedCanonical(actor)) return null;
  return actor?.effects?.get?.(EXHAUSTION_ID) ?? null;
}
function obsoleteExhaustion(actor) {
  // Only include real embedded source documents. Virtual/derived effects must
  // NEVER be passed to deleteEmbeddedDocuments ("does not exist" error).
  const persisted = new Set((actor?.toObject?.()?.effects ?? actor?._source?.effects ?? [])
    .map(effect => effect?._id).filter(Boolean));
  return effectsOf(actor).filter(effect => effect?.id && effect.id !== EXHAUSTION_ID
    && isExhaustion(effect) && persisted.has(effect.id));
}
function nativeLevel(actor) {
  // D&D5e 6.0.6 derives the effective level from its canonical ActiveEffect.
  // Account for old non-canonical effects during one-time migration so the
  // previous hunger level is not lost when upgrading from 0.6.6.
  const active = nativeCondition(actor);
  const legacy = obsoleteExhaustion(actor);
  return Math.max(
    levelOf(active?.system?.level) ?? (active ? 1 : 0),
    ...legacy.map(effect => levelOf(effect.system?.level) ?? 1),
    // Only use the derived value if no effect is present; it can be stale.
    active || legacy.length ? 0 : (levelOf(actor?.system?.attributes?.exhaustion) ?? 0)
  );
}
function legacyEffects(actor) {
  return effectsOf(actor).filter(effect => effect.getFlag?.(NS, 'hunger') === true && !isExhaustion(effect));
}
function zeroEffects(actor) {
  return effectsOf(actor).filter(effect => effect.getFlag?.(NS, 'hungerZero') === true);
}
export function getHunger(actor) {
  const stored = levelOf(actor?.getFlag?.(NS, 'hungerLevel'));
  if (stored !== null) return stored;
  // Migration from versions which stored hunger only on a cosmetic effect.
  return levelOf(legacyEffects(actor)[0]?.getFlag?.(NS, 'level'));
}
export function zeroEffectData() {
  return {
    name: 'Голод: истощение 0', img: ZERO_ICON,
    description: STEP[0], type: 'base', system: {},
    statuses: [], changes: [], disabled: false, transfer: false,
    flags: { [NS]: { hungerZero: true } }
  };
}

/**
 * Never write system.attributes.exhaustion for hunger. In D&D5e 6.0.6
 * Actor5e._onUpdate calls _onUpdateExhaustion without awaiting it: two quick
 * updates can both try to create the fixed-ID effect and throw a duplicate-ID
 * rejection outside the module's promise chain. Change the condition document
 * itself instead. The system derives exhaustion and all 2014 penalties from it.
 */
function persistedCanonical(actor) {
  const raw = actor?._source?.effects ?? actor?.toObject?.()?.effects ?? [];
  return raw.some?.(effect => effect?._id === EXHAUSTION_ID) === true;
}
function pause(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// D&D5e may be completing a native rest condition write on this same actor.
async function settleCanonical(actor, attempts=6, gap=50) {
  for (let i = 0; i < attempts; i++) {
    const effect = nativeCondition(actor);
    if (effect) return effect;
    await pause(gap);
  }
  return nativeCondition(actor);
}

function missingEffect(error) {
  return /does not exist|not found|doesn't exist|не существует|не найден/i
    .test(String(error?.message ?? error));
}
function duplicateEffect(error) {
  return /already exists|duplicate|уже существует/i
    .test(String(error?.message ?? error));
}

async function changeCanonicalLevel(actor, target) {
  // Native D&D5e v6 performs its own exhaustion delta asynchronously during
  // long rest. Other modules can also modify the condition. Re-read each
  // operation and retry on transient delete/create races; never rely on a
  // detached ActiveEffect instance left in actor.effects.
  for (let retry = 0; retry < 5; retry++) {
    const effect = nativeCondition(actor);
    if (effect) {
      const current = levelOf(effect.system?.level) ?? 1;
      if (current === target) return;
      try {
        if (target === 0) await effect.delete();
        else await effect.update({ 'system.level': target });
        return;
      } catch (error) {
        if (!missingEffect(error)) throw error;
        // Foundry removed this document between lookup and update.
        await pause(90);
        continue;
      }
    }
    if (target === 0) return;

    // Do not try to create while the native system has a creation pending.
    if (persistedCanonical(actor)) {
      await pause(90);
      continue;
    }
    if (retry === 0) {
      await settleCanonical(actor, 3, 60);
      if (nativeCondition(actor)) continue;
    }

    const ActiveEffect = getDocumentClass('ActiveEffect');
    const template = await ActiveEffect.fromStatusEffect('exhaustion');
    const data = foundry.utils.mergeObject(template.toObject(), {
      _id: EXHAUSTION_ID,
      'system.level': target
    });
    if (nativeCondition(actor)) continue;
    try {
      await actor.createEmbeddedDocuments('ActiveEffect', [data], { keepId: true });
      return;
    } catch (error) {
      if (!duplicateEffect(error) && !missingEffect(error)) throw error;
      await pause(90);
    }
  }
  // A missing/stale effect is not success. Never increment the hunger counter
  // when the mechanical exhaustion level failed to change.
  throw new Error(`Unable to synchronize exhaustion condition for ${actor?.uuid ?? 'actor'} at level ${target}`);
}

export async function setNativeExhaustion(actor, target) {
  if (!Number.isInteger(target) || target < 0 || target > 6) {
    throw new RangeError('Invalid exhaustion level');
  }
  await changeCanonicalLevel(actor, target);

  // Legacy builds used random-ID imitation effects. Clear only real embedded
  // documents, after the canonical condition is ready, to avoid removing it.
  for (const effect of obsoleteExhaustion(actor)) {
    if (!actor.effects?.get?.(effect.id)) continue;
    try { await effect.delete(); }
    catch (error) {
      if (actor.effects?.get?.(effect.id)) throw error;
    }
  }
}
async function syncZeroWarning(actor, hunger) {
  const effects = zeroEffects(actor);
  if (hunger === 0 && !effects.length) {
    await actor.createEmbeddedDocuments('ActiveEffect', [zeroEffectData()]);
  } else if (hunger !== 0 && effects.length) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', effects.map(e => e.id));
  } else if (hunger === 0 && effects.length > 1) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', effects.slice(1).map(e => e.id));
  }
}
function serial(actor, operation) {
  const key = actor.uuid;
  const previous = tasks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  tasks.set(key, next);
  void next.finally(() => { if (tasks.get(key) === next) tasks.delete(key); }).catch(() => {});
  return next;
}

/** A baseline is the exhaustion that existed BEFORE hunger began. We use
 * max(baseline,hunger), not addition, to avoid double-counting native statuses.
 * A successful meal removes hunger but must not remove this independent level.
 */
export async function updateHunger(actor, action) {
  if (!actor || actor.type !== 'character') return null;
  return serial(actor, async () => {
    if (!['eat', 'rest', 'lower'].includes(action)) throw new Error('Unknown hunger action');
    const previous = getHunger(actor);
    const fed = actor.getFlag?.(NS, 'ateSinceRest') === true;
    const next = action === 'eat' ? null
      : action === 'lower' ? reduceHunger(previous)
      : advanceHunger(previous, fed);
    const currentNative = nativeLevel(actor);
    const oldBaseline = levelOf(actor.getFlag?.(NS, 'hungerBaseline'));
    let baseline = oldBaseline ?? (previous === null ? currentNative : Math.max(0, currentNative - previous));
    // The user/GM may manually reduce native exhaustion while this module is
    // inactive. Never restore a larger baseline than currently exists.
    if (previous !== null) baseline = Math.min(baseline, currentNative);
    if (previous === null && next === 0) baseline = currentNative;
    const target = previous === null && next === null ? currentNative : Math.max(baseline, next ?? 0);

    // Commit mechanics BEFORE updating bookkeeping. Failed ActiveEffect
    // updates therefore do not advance hunger silently.
    if (target !== currentNative || obsoleteExhaustion(actor).length) await setNativeExhaustion(actor, target);
    const obsolete = legacyEffects(actor);
    if (obsolete.length) await actor.deleteEmbeddedDocuments('ActiveEffect', obsolete.map(e => e.id));
    // The warning is cosmetic: a failure should not cause a second rest to
    // be counted. Its repair is retried when the next hunger action occurs.
    try { await syncZeroWarning(actor, next); }
    catch (error) { console.warn(NS + ' | zero-level reminder could not sync', error); }
    await actor.update({
      [`flags.${NS}.hungerLevel`]: next,
      [`flags.${NS}.hungerBaseline`]: next === null ? null : baseline,
      [`flags.${NS}.ateSinceRest`]: action === 'eat' ? true : action === 'rest' ? false : fed
    });
    return next;
  });
}

function controllingGM() {
  return [...(game.users ?? [])].filter(u => u?.active && u.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}
function isOwner(actor, user) {
  return actor?.documentName === 'Actor' && actor.type === 'character'
    && Boolean(user && (user.isGM || actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)));
}
async function request(actor, action) {
  if (!isOwner(actor, game.user)) {
    ui.notifications.warn('Недостаточно прав на изменение голода персонажа.');
    return false;
  }
  const gm = controllingGM();
  if (!gm) { ui.notifications.warn('Для голода требуется ГМ в сети.'); return false; }
  if (game.user.id === gm.id) return updateHunger(actor, action);
  game.socket.emit(CHANNEL, {
    actorUuid: actor.uuid, action, userId: game.user.id,
    requestId: foundry.utils.randomID()
  });
  return true;
}
async function receive(data) {
  if (!game.user?.isGM || controllingGM()?.id !== game.user.id) return;
  if (!['eat', 'rest'].includes(data?.action) || typeof data?.requestId !== 'string') return;
  if (received.has(data.requestId)) return;
  received.add(data.requestId);
  if (received.size > 1000) received.clear();
  try {
    const user = game.users.get(data.userId);
    const actor = await fromUuid(data.actorUuid);
    if (!isOwner(actor, user)) return;
    // requestId is already de-duplicated above. Never throttle distinct rests
    // by elapsed time: two separate long rests must advance hunger twice.
    await updateHunger(actor, data.action);
  } catch (error) { console.error(NS + ' | GM socket hunger action', error); }
}

function pipOf(event) {
  return event.target?.closest?.('.sidebar .stats .top .pips[data-prop="system.attributes.exhaustion"] .pip');
}
function iconOf(event) { return event.target?.closest?.('.lipatos-bd-icon[data-hunger-level]'); }
function blockPips(event) {
  if (game.user?.isGM) return;
  const pip = pipOf(event);
  if (!pip?.closest?.('.dnd5e2.sheet.actor')) return;
  event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation();
}
function showGmMenu(event) {
  if (!game.user?.isGM) return;
  const icon = pipOf(event) ?? iconOf(event);
  const uuid = icon?.closest?.('[data-lipatos-actor-uuid]')?.dataset?.lipatosActorUuid;
  if (!uuid) return;
  event.preventDefault(); event.stopPropagation();
  document.querySelectorAll('.lipatos-hunger-menu').forEach(el => el.remove());
  const popup = document.createElement('div'); popup.className = 'lipatos-hunger-menu';
  popup.style.left = `${Math.max(6, Math.min(event.clientX, window.innerWidth - 230))}px`;
  popup.style.top = `${Math.max(6, Math.min(event.clientY, window.innerHeight - 48))}px`;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Убрать 1 уровень голода';
  popup.append(button); document.body.append(popup);
  const close = e => { if (!popup.contains(e.target)) popup.remove(); };
  setTimeout(() => document.addEventListener('pointerdown', close, { once:true }), 0);
  button.addEventListener('click', async () => {
    popup.remove();
    try {
      const actor = await fromUuid(uuid);
      if (!isOwner(actor, game.user)) return;
      const previous = getHunger(actor);
      if (previous === null) return ui.notifications.info('У персонажа нет голода.');
      const next = await updateHunger(actor, 'lower');
      ui.notifications.info(next === null ? 'Голод снят.' : `Голод: истощение ${next}`);
    } catch (error) { console.error(NS + ' | reduce hunger', error); ui.notifications.error('Не удалось уменьшить голод.'); }
  });
}
export function decoratePips(root, actor) {
  const pips = root?.querySelectorAll?.('.sidebar .stats .top .pips[data-prop="system.attributes.exhaustion"] .pip') ?? [];
  for (const [i, pip] of [...pips].entries()) {
    if (!STEP[i + 1]) continue;
    const name = `Истощение ${i + 1}`;
    const explanation = STEP[i + 1] + (i ? ' Предыдущие штрафы сохраняются.' : '');
    pip.setAttribute('aria-label', name + '. ' + explanation);
    if (pip.dataset.lipatosHungerTooltip === '1') continue;
    pip.dataset.lipatosHungerTooltip = '1';
    const show = () => {
      pip._lipatosHungerTooltip?.remove();
      const tip = document.createElement('div'); tip.className = 'lipatos-bd-tooltip lipatos-hunger-tooltip';
      const h = document.createElement('div'); h.className = 'lipatos-bd-tooltip-title'; h.textContent = name;
      const b = document.createElement('div'); b.className = 'lipatos-bd-tooltip-body';
      b.textContent = explanation + (i === 0 && getHunger(actor) === 0 ? ' Сейчас голод 0 — поешьте.' : '');
      tip.append(h, b);
      const rect = pip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 275)) + 'px';
      tip.style.top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 105)) + 'px';
      document.body.append(tip); pip._lipatosHungerTooltip = tip;
    };
    const hide = () => { pip._lipatosHungerTooltip?.remove(); pip._lipatosHungerTooltip = null; };
    pip.addEventListener('mouseenter', show); pip.addEventListener('mouseleave', hide);
    pip.addEventListener('focusin', show); pip.addEventListener('focusout', hide);
  }
}

// D&D5e 6.0.6 normally *reduces* exhaustion by 1 during every long rest.
// Starving characters must not lose their hunger exhaustion and then have our
// restCompleted handler race that pending asynchronous deletion. Prevent this
// native decrement BEFORE the rest bulk update is applied. Other rest recovery
// data (HP, spells, resources) remains untouched.
Hooks.on('dnd5e.preRestCompleted', (actor, result, config) => {
  if (actor?.type !== 'character' || (config?.type !== 'long' && config?.restType !== 'long' && !result?.longRest)) return;
  const hunger = getHunger(actor);
  const fed = actor.getFlag?.(NS, 'ateSinceRest') === true;
  if (hunger === null || fed || !result?.updateData) return;
  delete result.updateData['system.attributes.exhaustion'];
  if (result.updateData.system?.attributes) delete result.updateData.system.attributes.exhaustion;
});

Hooks.on('dnd5e.restCompleted', (actor, result, config) => {
  if (actor?.type !== 'character' || (config?.type !== 'long' && config?.restType !== 'long' && !result?.longRest)) return;
  // A hook fires on the client completing this rest. Prevent accidental
  // re-processing of the *same* result object, but allow any number of
  // distinct completed long rests in rapid succession.
  if (result && typeof result === 'object') {
    if (processedRestEvents.has(result)) return;
    processedRestEvents.add(result);
  }
  void request(actor, 'rest').catch(error => {
    console.error(NS + ' | long rest hunger', error);
    ui.notifications?.error?.('LipatoS: не удалось применить голод после отдыха (F12).');
  });
});
Hooks.once('ready', () => {
  game.socket?.on?.(CHANNEL, receive);
  const module = game.modules.get(NS);
  if (module) module.api = {
    ...(module.api ?? {}), getHunger,
    feed: actor => request(actor, 'eat'),
    lowerHunger: actor => game.user.isGM ? updateHunger(actor, 'lower') : false
  };
  document.addEventListener('contextmenu', showGmMenu, true);
  for (const type of ['click', 'dblclick', 'mousedown', 'pointerdown', 'auxclick', 'contextmenu'])
    document.addEventListener(type, blockPips, true);
  console.info(NS + ' | Native D&D5e 2014 exhaustion; no double roll modifiers');
});
