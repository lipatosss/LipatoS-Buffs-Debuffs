/**
 * Aindor potions for Foundry VTT 14 / dnd5e 6.x (2014 rules).
 * Item definitions live in "lipatos-aindor-unique-items".
 * This module applies actual consumed effects to actors; unrelated meal
 * and alcoholic drink buffs are never replaced.
 */
const NS = "lipatos-buffs-debuffs";
const UNIQUE = "lipatos-aindor-unique-items";
const IDS = Object.freeze({
  "zele-krovavyh-shipov": ["Кровавые шипы", "До долгого отдыха при попадании по вам рукопашной атакой нападавший получает 1к4 колющего урона."],
  "zele-feniksa": ["Возрождение феникса", "Первое падение до 0 хитов оставляет 1 хит. Одно срабатывание до долгого отдыха."],
  "zele-prizrachnogo-shaga": ["Призрачный шаг", "Можно двигаться через пространство враждебных существ и не провоцировать атак при выходе из их досягаемости. Нельзя заканчивать ход в пространстве другого существа."],
  "zele-kostyanogo-pancirya": ["Костяной панцирь", "Первое критическое попадание превращается в обычное попадание. Одно срабатывание до долгого отдыха."],
  "zele-posledney-mesti": ["Последняя месть", "При первом падении до 0 хитов можно реакцией совершить одну атаку оружием перед потерей сознания. Требуется решение игрока."],
  "zele-lecheniya": ["Исцеление", "Немедленно восстанавливает 2к4 + 2 хита."],
  "zele-skorosti": ["Стремительность", "Скорость передвижения удвоена на 10 минут; дополнительных действий и атак нет."],
  "zele-buyvola": ["Буйволиная сила", "Максимальный переносимый вес увеличен на 200 фунтов до долгого отдыха; Сила не меняется."]
});
const potionId = item => {
  if (item?.type !== "consumable") return null;
  const id = String(item?.system?.identifier ?? item?.flags?.[UNIQUE]?.aindorPotion ?? "").trim().toLowerCase();
  return Object.hasOwn(IDS, id) ? id : null;
};
const potionActor = activity => activity?.actor ?? activity?.item?.actor
  ?? (activity?.item?.parent?.documentName === "Actor" ? activity.item.parent : null);
const potionKey = (actor, item) => actor?.uuid && item?.id ? actor.uuid + ":" + item.id : null;
const isOwner = actor => actor?.documentName === "Actor" && actor.isOwner === true;
const allEffects = actor => [...(actor?.effects ?? [])];
const potionEffects = actor => allEffects(actor).filter(e => e.flags?.[NS]?.aindorPotion === true);
const potionEffect = (actor, id) => potionEffects(actor).find(e =>
  e.flags?.[NS]?.potionId === id && !e.disabled && !e.isSuppressed);
const worldTime = () => Number(game.time?.worldTime ?? 0);
const message = async (actor, html) => ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }), content: html
});
const safe = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const sessions = new Map();
const pendingActorWork = new Map();
function workFor(actor, callback) {
  const key = actor.uuid, previous = pendingActorWork.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(callback);
  pendingActorWork.set(key, next);
  void next.finally(() => { if (pendingActorWork.get(key) === next) pendingActorWork.delete(key); }).catch(() => {});
  return next;
}
function prepareUse(activity) {
  const id = potionId(activity?.item), actor = potionActor(activity), key = potionKey(actor, activity?.item);
  if (!id || !key || !isOwner(actor)) return;
  sessions.set(key, { id, at: Date.now(), handled: false });
}
function claim(actor, item, source, confirmed = false) {
  if (!isOwner(actor)) return;
  const id = potionId(item), key = potionKey(actor, item);
  if (!id || !key) return;
  let session = sessions.get(key);
  if (!session || Date.now() - session.at > 15000) {
    if (!confirmed) return;
    session = { id, at: Date.now(), handled: false };
    sessions.set(key, session);
  }
  if (session.handled) return;
  session.handled = true;
  void workFor(actor, () => applyPotion(actor, item, id)).catch(error => {
    console.error(NS + " | Ошибка зелья (" + source + "): " + id, error);
    ui.notifications?.error?.("Ошибка применения зелья «" + item.name + "». Подробности в F12.");
  });
}
async function grantBottle(actor) {
  try { await game.modules.get(NS)?.api?.giveHeatherEmptyBottle?.(actor); }
  catch (error) { console.warn(NS + " | Не удалось вернуть пустую бутылку зелья", error); }
}
async function applyPotion(actor, item, id) {
  if (!isOwner(actor)) return false;
  const definition = IDS[id];
  if (!definition) return false;
  if (id === "zele-lecheniya") {
    const roll = await new Roll("2d4 + 2").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: item.name + " — Исцеление"
    });
    const hp = actor.system?.attributes?.hp ?? {};
    const oldHp = Number(hp.value ?? 0);
    const maxHp = Number(hp.max ?? oldHp);
    const healed = Math.max(0, Math.min(Number(roll.total), maxHp - oldHp));
    if (healed > 0) await actor.update({ "system.attributes.hp.value": oldHp + healed }, { lipatosPotionHealing: true });
    await message(actor, "<p><strong>Зелье лечения:</strong> восстановлено " + healed + " хитов.</p>");
  } else {
    const old = potionEffects(actor).filter(e => e.flags?.[NS]?.potionId === id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map(e => e.id));
    const now = worldTime();
    const changes = [];
    if (id === "zele-skorosti") {
      for (const movement of ["walk", "fly", "swim", "climb", "burrow"]) {
        changes.push({ key: "system.attributes.movement." + movement, mode: 1, value: "2", priority: 20 });
      }
    }
    const data = {
      name: definition[0], img: item.img || "icons/svg/aura.svg",
      description: "<p>" + definition[1] + "</p>",
      origin: item.uuid, type: "base", transfer: false, disabled: false,
      duration: id === "zele-skorosti" ? { startTime: now, seconds: 600 } : { startTime: now },
      changes,
      flags: { [NS]: { aindorPotion: true, potionId: id, createdAt: now,
        ...(id === "zele-skorosti" ? { expiresAt: now + 600 } : {}) } }
    };
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    await message(actor, "<p><strong>" + safe(definition[0]) + "</strong>: эффект зелья применён.</p>");
  }
  await grantBottle(actor);
  // dnd5e consumes the item use itself; only finish auto-destroy stacks
  // that remain at their last spent charge. Never subtract a charge twice.
  const owned = actor.items?.get?.(item.id);
  if (owned && potionId(owned) === id) {
    const uses = owned.system?.uses ?? {};
    const max = Number(uses.max ?? 0), spent = Number(uses.spent ?? 0);
    if (uses.autoDestroy && max > 0 && spent >= max) {
      const quantity = Number(owned.system?.quantity ?? 1);
      if (quantity > 1) await owned.update({
        "system.quantity": quantity - 1, "system.uses.spent": 0
      }, { lipatosPotionInternal: true });
      else await owned.delete({ lipatosPotionInternal: true });
    }
  }
  return true;
}
Hooks.on("dnd5e.preUseActivity", prepareUse);
Hooks.on("dnd5e.preActivityConsumption", activity => {
  const actor = potionActor(activity), key = potionKey(actor, activity?.item);
  if (potionId(activity?.item) && key && !sessions.has(key)) prepareUse(activity);
});
Hooks.on("dnd5e.postActivityConsumption", (activity, config, msg, updates) => {
  if (!potionId(activity?.item)) return;
  // A successful consumption is enough, even if core auto-deletes the last dose.
  // Do not infer success from a cancelled activation.
  if (updates !== null && updates !== undefined) claim(potionActor(activity), activity.item, "consumption");
});
Hooks.on("dnd5e.postUseActivity", (activity, config, result) => {
  if (!potionId(activity?.item) || !result || typeof result !== "object") return;
  claim(potionActor(activity), activity.item, "postUse", true);
});
Hooks.on("updateItem", (item, change, options, userId) => {
  if (options?.lipatosPotionInternal || !potionId(item) || item.parent?.documentName !== "Actor") return;
  if (userId && userId !== game.user?.id) return;
  const raw = change?.["system.uses.spent"] ?? change?.system?.uses?.spent;
  if (raw === undefined || Number(raw) <= 0 || Number(item.system?.uses?.spent ?? 0) <= 0) return;
  claim(item.parent, item, "spent", true);
});
Hooks.on("deleteItem", (item, options, userId) => {
  if (options?.lipatosPotionInternal || !potionId(item) || item.parent?.documentName !== "Actor") return;
  if (userId && userId !== game.user?.id) return;
  // Manual deletion / sale must never simulate drinking.
  claim(item.parent, item, "destroyed");
});
async function expireSpeed(actor) {
  if (!isOwner(actor)) return;
  const expired = potionEffects(actor).filter(e =>
    e.flags?.[NS]?.potionId === "zele-skorosti"
    && Number(e.flags?.[NS]?.expiresAt ?? Infinity) <= worldTime());
  if (expired.length) await actor.deleteEmbeddedDocuments("ActiveEffect", expired.map(e => e.id));
}
function expireAllSpeed() {
  for (const actor of game.actors?.contents ?? []) {
    void expireSpeed(actor).catch(error => console.warn(NS + " | Время зелья скорости", error));
  }
}
Hooks.on("updateWorldTime", expireAllSpeed);
Hooks.on("updateCombat", expireAllSpeed);
Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
  if (!isOwner(actor) || (config?.type !== "long" && config?.restType !== "long" && !result?.longRest)) return;
  void workFor(actor, async () => {
    const active = potionEffects(actor);
    if (active.length) await actor.deleteEmbeddedDocuments("ActiveEffect", active.map(e => e.id));
  }).catch(error => console.error(NS + " | Очистка зелий после отдыха", error));
});
// Derived carrying capacity is rebuilt by dnd5e, so simply setting an Actor
// property or a persistent numerical base value is unsafe. A libWrapper runs
// after normal preparation and applies +200 once per prepared result.
const encProcessed = new WeakMap();
Hooks.once("setup", () => {
  if (typeof globalThis.libWrapper?.register !== "function") {
    console.warn(NS + " | Для увеличения переносимого веса нужен libWrapper.");
    return;
  }
  try {
    globalThis.libWrapper.register(NS,
      "CONFIG.Actor.documentClass.prototype.prepareData",
      function(wrapped, ...args) {
        const apply = () => {
          if (this?.type !== "character" || !potionEffect(this, "zele-buyvola")) return;
          const enc = this.system?.attributes?.encumbrance;
          if (!enc || !Number.isFinite(Number(enc.max))) return;
          const previous = encProcessed.get(this);
          if (previous?.object === enc && previous.max === enc.max) return;
          enc.max = Number(enc.max) + 200;
          if (Number.isFinite(Number(enc.value)) && enc.max > 0 && "pct" in enc)
            enc.pct = Math.min(100, Number(enc.value) / enc.max * 100);
          encProcessed.set(this, { object: enc, max: enc.max });
        };
        const result = wrapped(...args);
        if (result && typeof result.then === "function") return result.then(value => { apply(); return value; });
        apply();
        return result;
      }, "WRAPPER");
  } catch (error) { console.error(NS + " | Регистрация грузоподъёмности не удалась", error); }
});
// A pre-update interception is required: healing from zero after unconscious
// would not meet Phoenix's stated "instead remain at 1 HP" condition.
const zeroPending = new Map();
function incomingHP(changed) {
  return changed?.system?.attributes?.hp?.value ?? changed?.["system.attributes.hp.value"];
}
function setIncomingHP(changed, hp) {
  if (changed?.system?.attributes?.hp && Object.hasOwn(changed.system.attributes.hp, "value"))
    changed.system.attributes.hp.value = hp;
  else changed["system.attributes.hp.value"] = hp;
}
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (!isOwner(actor) || (userId && userId !== game.user?.id)) return;
  if (options?.lipatosPotionHealing) return;
  const hp = incomingHP(changes);
  if (hp === undefined || !Number.isFinite(Number(hp))) return;
  const before = Number(actor.system?.attributes?.hp?.value ?? 0);
  if (!(before > 0 && Number(hp) <= 0)) return;
  const phoenix = potionEffect(actor, "zele-feniksa");
  if (phoenix) {
    setIncomingHP(changes, 1);
    zeroPending.set(actor.uuid, { id: phoenix.id, kind: "phoenix", at: Date.now() });
    return;
  }
  const revenge = potionEffect(actor, "zele-posledney-mesti");
  if (revenge) zeroPending.set(actor.uuid, { id: revenge.id, kind: "revenge", at: Date.now() });
});
async function offerRevenge(actor, effect) {
  if (!actor.effects?.get(effect.id)) return;
  const weapons = (actor.items?.contents ?? []).filter(item =>
    item.type === "weapon" && item.system?.equipped === true
    && [...(item.system?.activities ?? [])].some(a => a.type === "attack"));
  const Dialog = foundry?.applications?.api?.DialogV2;
  let chosen = null;
  if (weapons.length && Dialog?.wait) {
    chosen = await Dialog.wait({
      window: { title: "Зелье последней мести — реакция" },
      content: "<p>Вы падаете до 0 хитов. Совершить <strong>одну атаку оружием</strong> перед потерей сознания?</p>",
      buttons: [
        ...weapons.slice(0, 8).map((weapon, i) =>
          ({ action: "weapon" + i, label: weapon.name, callback: () => weapon.id })),
        { action: "skip", label: "Не атаковать", default: true, callback: () => null }
      ], rejectClose: false
    });
  } else ui.notifications?.warn?.("Последняя месть: для реакции нужно экипировать оружие с активностью атаки.");
  if (chosen) {
    const weapon = actor.items.get(chosen);
    const attack = weapon && [...(weapon.system?.activities ?? [])].find(a => a.type === "attack");
    if (attack) {
      try {
        await attack.use({}, { configure: false }, {});
        await message(actor, "<p><strong>Последняя месть:</strong> совершена последняя атака оружием.</p>");
      } catch (error) {
        console.warn(NS + " | Не удалось автоматически выполнить последнюю атаку", error);
        ui.notifications?.warn?.("Последняя месть: выполнить бросок оружием вручную (см. F12).");
      }
    }
  }
  if (actor.effects.get(effect.id)) await effect.delete();
}
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (!isOwner(actor) || (userId && userId !== game.user?.id)) return;
  if (incomingHP(changes) === undefined) return;
  const pending = zeroPending.get(actor.uuid);
  if (!pending || Date.now() - pending.at > 5000) return;
  zeroPending.delete(actor.uuid);
  const effect = actor.effects?.get(pending.id);
  if (!effect) return;
  if (pending.kind === "phoenix" && Number(actor.system?.attributes?.hp?.value ?? 0) === 1) {
    void effect.delete().then(() =>
      message(actor, "<p><strong>Возрождение феникса:</strong> падение до 0 хитов предотвращено, остался 1 хит.</p>")
    ).catch(error => console.error(NS + " | Феникс", error));
  } else if (pending.kind === "revenge" && Number(actor.system?.attributes?.hp?.value ?? 1) <= 0) {
    void offerRevenge(actor, effect).catch(error => console.error(NS + " | Последняя месть", error));
  }
});
// Midi-QOL exposes hit targets for a melee attack. Never infer the attacker
// from combat turn or apply damage on mere HP changes (poisons, hazards, etc.).
// Only reject a *positively identified* opportunity attack. Ordinary
// reactions and normal weapon attacks must remain available to opponents.
Hooks.on("midi-qol.preAttackRoll", workflow => {
  const activity = workflow?.activity;
  const hints = [
    activity?.name, activity?.activation?.condition,
    workflow?.item?.name, workflow?.item?.system?.activation?.condition
  ].filter(v => typeof v === "string").join(" ").toLowerCase();
  const opportunity = workflow?.isOpportunityAttack === true
    || /opportunity attack|attack of opportunity|провоцированн.*атак|атака по возможности/i.test(hints);
  if (!opportunity) return;
  const victims = [...(workflow?.targets ?? [])];
  if (!victims.some(token => potionEffect(token?.actor, "zele-prizrachnogo-shaga"))) return;
  ui.notifications?.info?.("Призрачный шаг: провоцированная атака предотвращена.");
  return false;
});
const handledMeleeWorkflows = new WeakSet();
function midiExecutor() {
  const gm = game.users?.activeGM;
  return gm ? gm.id === game.user?.id : game.user?.isGM === true;
}
function midiIsMelee(workflow) {
  const attackType = workflow?.activity?.attack?.type?.value
    ?? workflow?.item?.system?.actionType;
  return ["melee", "mwak", "msak"].includes(attackType);
}
Hooks.on("midi-qol.hitsChecked", workflow => {
  if (!workflow || typeof workflow !== "object" || handledMeleeWorkflows.has(workflow)) return;
  const victims = Array.from(workflow.hitTargets ?? []);
  if (!victims.length) return;
  handledMeleeWorkflows.add(workflow);
  // Prevent a critical roll's extra damage dice before damage is generated.
  if (workflow.isCritical) {
    const protectedTarget = victims.find(token => potionEffect(token.actor, "zele-kostyanogo-pancirya"));
    if (protectedTarget) {
      workflow.isCritical = false;
      if (workflow.attackRoll?.options) workflow.attackRoll.options.critical = false;
      if (midiExecutor()) {
        const effect = potionEffect(protectedTarget.actor, "zele-kostyanogo-pancirya");
        if (effect) void effect.delete().then(() =>
          message(protectedTarget.actor, "<p><strong>Костяной панцирь:</strong> критическое попадание стало обычным.</p>")
        ).catch(error => console.error(NS + " | Костяной панцирь", error));
      }
    }
  }
  if (!midiExecutor() || !midiIsMelee(workflow)) return;
  const attacker = workflow?.token ?? workflow?.tokenDocument?.object;
  if (!attacker?.actor) return;
  for (const victim of victims) {
    if (!potionEffect(victim?.actor, "zele-krovavyh-shipov")) continue;
    void (async () => {
      const roll = await new Roll("1d4").evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: victim.actor }),
        flavor: "Кровавые шипы — ответный колющий урон"
      });
      if (typeof globalThis.MidiQOL?.DamageOnlyWorkflow === "function") {
        new globalThis.MidiQOL.DamageOnlyWorkflow(victim.actor, victim, roll.total,
          "piercing", [attacker], roll, { flavor: "Кровавые шипы" });
      } else {
        ui.notifications?.warn?.("Кровавые шипы: нанесите " + roll.total + " колющего урона атакующему.");
      }
    })().catch(error => console.error(NS + " | Кровавые шипы", error));
  }
});
async function usePotionFromContext(item) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : item?.actor;
  const id = potionId(item);
  if (!id || !isOwner(actor)) return false;
  return workFor(actor, async () => {
    const owned = actor.items?.get?.(item.id);
    const quantity = Number(owned?.system?.quantity ?? 0);
    if (!owned || potionId(owned) !== id || !Number.isSafeInteger(quantity) || quantity < 1) return false;
    if (quantity > 1)
      await owned.update({ "system.quantity": quantity - 1, "system.uses.spent": 0 }, { lipatosPotionInternal: true });
    else await owned.delete({ lipatosPotionInternal: true });
    return applyPotion(actor, item, id);
  });
}
Hooks.once("ready", () => {
  const module = game.modules.get(NS);
  if (module) module.api = {
    ...(module.api ?? {}),
    isAindorPotion: item => potionId(item) !== null,
    getAindorPotionEffect: potionEffect,
    usePotionFromContext
  };
  expireAllSpeed();
  console.info(NS + " | Зелья Айндора: лечение, скорость, груз, феникс, последняя месть, боевые эффекты");
});
