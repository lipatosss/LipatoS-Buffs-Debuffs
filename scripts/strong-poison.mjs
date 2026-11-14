/**
 * Aindor — Strong Poison potion (Foundry v14 / dnd5e 6.x).
 *
 * Drinking the potion grants an attacker's single-use buff via potions.mjs.
 * This file handles the NEXT confirmed weapon hit with Midi-QOL:
 * 1d8 poison damage immediately, plus a distinct Poisoned status on the target.
 * At the start of each subsequent target turn: 1d8 poison.
 * At the end of each target turn: Constitution save DC 14 ends the effect.
 *
 * Effects are independent of meal/drink buffs and are also cleared by long rest.
 */
const STRONG_POISON_NS = "lipatos-buffs-debuffs";
const STRONG_POISON_ID = "zele-silnogo-yada";
const STRONG_POISON_DOT_ID = "zele-silnogo-yada-dot";
const STRONG_POISON_DC = 14;
const strongPoisonWorkflows = new WeakSet();
const strongPoisonPending = new Set();

function strongPoisonExecutor() {
  const gm = game.users?.activeGM;
  return gm ? gm.id === game.user?.id : game.user?.isGM === true;
}
function strongPoisonEffect(actor, potionId) {
  return [...(actor?.effects ?? [])].find(effect =>
    !effect.disabled && !effect.isSuppressed
    && effect.flags?.[STRONG_POISON_NS]?.aindorPotion === true
    && effect.flags[STRONG_POISON_NS].potionId === potionId);
}
function strongPoisonIsWeaponHit(workflow) {
  const item = workflow?.item ?? workflow?.activity?.item;
  if (item?.type !== "weapon") return false; // No spell attacks or unarmed strike.
  if (!workflow?.attackRoll && !workflow?.activity?.attack) return false;
  return [...(workflow?.hitTargets ?? [])].some(token => token?.actor);
}
function strongPoisonSource(workflow) {
  return workflow?.actor ?? workflow?.token?.actor ?? workflow?.tokenDocument?.actor
    ?? workflow?.activity?.actor ?? null;
}
function strongPoisonToken(actor, combatant = null) {
  return combatant?.token?.object
    ?? [...(globalThis.canvas?.tokens?.placeables ?? [])].find(token => token?.actor?.uuid === actor?.uuid)
    ?? null;
}
function strongPoisonConditionImmune(actor) {
  const set = actor?.system?.traits?.ci?.value;
  if (typeof set?.has === "function") return set.has("poisoned");
  return Array.isArray(set) ? set.includes("poisoned") : false;
}
function strongPoisonSafe(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function strongPoisonMessage(actor, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: "<p>" + text + "</p>"
  });
}
async function strongPoisonDamage(sourceActor, sourceToken, targetToken, targetActor, flavor) {
  const roll = await new Roll("1d8").evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor ?? targetActor }),
    flavor
  }); // Native chat roll is animated by Dice So Nice.
  const midi = globalThis.MidiQOL;
  if (typeof midi?.DamageOnlyWorkflow === "function" && targetToken) {
    try {
      new midi.DamageOnlyWorkflow(
        sourceActor ?? targetActor, sourceToken ?? targetToken,
        Number(roll.total), "poison", [targetToken], roll, { flavor }
      );
      return true;
    } catch (error) {
      console.error(STRONG_POISON_NS + " | Ошибка Midi-QOL: сильный яд", error);
    }
  }
  // Never silently fake damage or overwrite hit points, ignoring resistance.
  ui.notifications?.warn?.("Сильный яд: нет Midi-QOL или токена цели — примените " + roll.total + " урона ядом вручную.");
  await strongPoisonMessage(targetActor,
    "<strong>" + strongPoisonSafe(flavor) + ":</strong> " + roll.total
    + " урона ядом — требуется ручное применение с учётом сопротивлений.");
  return false;
}
async function strongPoisonHit(workflow, sourceActor, sourceEffect, targetToken) {
  if (!sourceActor.effects?.get?.(sourceEffect.id)) return;
  const victim = targetToken?.actor;
  if (!victim) return;
  // Consume once, only on a successful hit; misses never reach this function.
  await sourceActor.deleteEmbeddedDocuments("ActiveEffect", [sourceEffect.id]);
  const sourceToken = workflow?.token ?? workflow?.tokenDocument?.object ?? null;
  await strongPoisonDamage(sourceActor, sourceToken, targetToken, victim,
    "Зелье сильного яда — дополнительный урон от попадания");
  if (strongPoisonConditionImmune(victim)) {
    await strongPoisonMessage(victim,
      "Сильный яд: цель невосприимчива к состоянию «Отравлен». Периодический эффект не применяется.");
    return;
  }
  // Replace only our OWN earlier strong-poison condition, not other poison sources.
  const old = [...(victim.effects ?? [])].filter(e =>
    e.flags?.[STRONG_POISON_NS]?.strongPoisonDot === true);
  if (old.length) await victim.deleteEmbeddedDocuments("ActiveEffect", old.map(e => e.id));
  await victim.createEmbeddedDocuments("ActiveEffect", [{
    name: "Сильный яд — отравление",
    img: sourceEffect.img ?? "icons/svg/poison.svg",
    type: "base", transfer: false, disabled: false,
    statuses: ["poisoned"],
    description: "<p>Состояние «Отравлен». В начале каждого своего хода цель получает 1к8 урона ядом. "
      + "В конце каждого своего хода — спасбросок Телосложения СЛ 14; успех прекращает яд.</p>",
    origin: sourceEffect.origin ?? sourceActor.uuid,
    duration: { startTime: Number(game.time?.worldTime ?? 0) },
    changes: [],
    flags: {
      [STRONG_POISON_NS]: {
        aindorPotion: true, potionId: STRONG_POISON_DOT_ID,
        strongPoisonDot: true, dc: STRONG_POISON_DC,
        sourceActorUuid: sourceActor.uuid
      }
    }
  }]);
  await strongPoisonMessage(victim,
    "<strong>Сильный яд:</strong> цель Отравлена. В начале её ходов — 1к8 ядом, "
      + "в конце — спасбросок Телосложения СЛ 14 до успеха.");
}
Hooks.on("midi-qol.hitsChecked", workflow => {
  if (!strongPoisonExecutor() || !workflow || typeof workflow !== "object") return;
  if (strongPoisonWorkflows.has(workflow)) return;
  if (!strongPoisonIsWeaponHit(workflow)) return;
  const attacker = strongPoisonSource(workflow);
  const charge = strongPoisonEffect(attacker, STRONG_POISON_ID);
  if (!charge) return;
  const target = [...(workflow.hitTargets ?? [])].find(token => token?.actor);
  if (!target) return;
  // Workflow is claimed BEFORE any async call so duplicates cannot consume twice.
  strongPoisonWorkflows.add(workflow);
  const key = attacker.uuid + ":" + charge.id;
  if (strongPoisonPending.has(key)) return;
  strongPoisonPending.add(key);
  void strongPoisonHit(workflow, attacker, charge, target).catch(error => {
    console.error(STRONG_POISON_NS + " | Срабатывание сильного яда", error);
    ui.notifications?.error?.("Сильный яд: ошибка обработки попадания. Проверьте F12.");
  }).finally(() => strongPoisonPending.delete(key));
});
function strongPoisonCombatant(combat, state) {
  if (!state || state.turn === null || state.turn === undefined) return null;
  const id = state.combatantId ?? state.combatant?.id;
  return (id ? combat.combatants?.get?.(id) : null)
    ?? combat.turns?.[Number(state.turn)] ?? null;
}
function strongPoisonTurnKey(combat, state, combatant) {
  return [combat.id, state.round, state.turn, combatant?.id].join(":");
}
function strongPoisonRollTotal(result) {
  if (Array.isArray(result)) return strongPoisonRollTotal(result[0]);
  const candidate = result?.total ?? result?.roll?.total ?? result?.rolls?.[0]?.total;
  return Number.isFinite(Number(candidate)) ? Number(candidate) : null;
}
async function strongPoisonConSave(actor) {
  let result;
  if (typeof actor.rollSavingThrow === "function") {
    try {
      result = await actor.rollSavingThrow({
        ability: "con", dc: STRONG_POISON_DC, dialog: false, chatMessage: true
      });
    } catch (error) {
      console.warn(STRONG_POISON_NS + " | Native CON save failed; trying legacy API", error);
    }
  }
  if (strongPoisonRollTotal(result) === null && typeof actor.rollAbilitySave === "function") {
    result = await actor.rollAbilitySave("con", { fastForward: true, chatMessage: true });
  }
  return strongPoisonRollTotal(result);
}
async function strongPoisonTurnStart(combat, state) {
  const combatant = strongPoisonCombatant(combat, state);
  const actor = combatant?.actor;
  const effect = strongPoisonEffect(actor, STRONG_POISON_DOT_ID);
  if (!effect) return;
  const turnKey = strongPoisonTurnKey(combat, state, combatant);
  if (effect.flags?.[STRONG_POISON_NS]?.lastStartTurn === turnKey) return;
  // Persist first: reconnects/other client events cannot create duplicate ticks.
  await effect.update({ ["flags." + STRONG_POISON_NS + ".lastStartTurn"]: turnKey });
  const token = strongPoisonToken(actor, combatant);
  await strongPoisonDamage(actor, token, token, actor, "Сильный яд — урон в начале хода");
}
async function strongPoisonTurnEnd(combat, state) {
  const combatant = strongPoisonCombatant(combat, state);
  const actor = combatant?.actor;
  const effect = strongPoisonEffect(actor, STRONG_POISON_DOT_ID);
  if (!effect) return;
  const turnKey = strongPoisonTurnKey(combat, state, combatant);
  if (effect.flags?.[STRONG_POISON_NS]?.lastEndTurn === turnKey) return;
  await effect.update({ ["flags." + STRONG_POISON_NS + ".lastEndTurn"]: turnKey });
  const total = await strongPoisonConSave(actor);
  if (total === null) {
    ui.notifications?.warn?.("Сильный яд: не удалось автоматически бросить спасбросок Телосложения СЛ 14.");
    await strongPoisonMessage(actor,
      "Сильный яд: сделайте спасбросок Телосложения СЛ 14 вручную. Пока он не подтверждён, яд остаётся.");
    return;
  }
  if (total >= STRONG_POISON_DC) {
    if (actor.effects?.get?.(effect.id))
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    await strongPoisonMessage(actor,
      "<strong>Сильный яд:</strong> спасбросок Телосложения " + total
      + " против СЛ 14 успешен. Отравление прекращается.");
  } else {
    await strongPoisonMessage(actor,
      "<strong>Сильный яд:</strong> спасбросок Телосложения " + total
      + " против СЛ 14 провален. Отравление продолжается.");
  }
}
Hooks.on("combatTurnChange", (combat, prior, current) => {
  if (!strongPoisonExecutor()) return;
  void (async () => {
    if (prior?.turn !== undefined && prior?.turn !== null)
      await strongPoisonTurnEnd(combat, prior);
    if (current?.turn !== undefined && current?.turn !== null)
      await strongPoisonTurnStart(combat, current);
  })().catch(error => {
    console.error(STRONG_POISON_NS + " | Сильный яд: смена хода", error);
    ui.notifications?.error?.("Сильный яд: ошибка урона/спасброска при смене хода (F12).");
  });
});
Hooks.once("ready", () => {
  console.info(STRONG_POISON_NS + " | Сильный яд: одно попадание оружием, 1к8 сразу, "
    + "состояние Отравлен, 1к8 в начале хода, CON СЛ 14 в конце хода.");
});
