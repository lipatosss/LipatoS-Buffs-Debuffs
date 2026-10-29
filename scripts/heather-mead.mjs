/**
 * Heather mead for Foundry V14 / dnd5e 6.x.
 * This file deliberately ships in both LipatoS modules. Buffs/Debuffs
 * takes precedence when both are enabled, so one dose creates one effect.
 */
const HEATHER_BUFFS = "lipatos-buffs-debuffs";
const HEATHER_UNIQUE = "lipatos-aindor-unique-items";
const HEATHER_SELF = import.meta.url.includes("/lipatos-buffs-debuffs/")
  ? HEATHER_BUFFS : HEATHER_UNIQUE;
const HEATHER_IDENTIFIER = "vereskovaya-medovuha";
const HEATHER_BOTTLE_IDENTIFIER = "pustaya-butylka";
const HEATHER_NAME = "Вересковое тепло";
const HEATHER_HOUR = 3600;
const heatherPending = new Set();
const heatherCompletedUses = new WeakSet();
const heatherRestEvents = new WeakSet();

function heatherOwnsWorkflow() {
  return HEATHER_SELF === HEATHER_BUFFS || game.modules.get(HEATHER_BUFFS)?.active !== true;
}

function heatherItem(item) {
  return item?.type === "consumable"
    && String(item.system?.identifier ?? "").trim().toLowerCase() === HEATHER_IDENTIFIER;
}

function heatherEffect(actor) {
  return (actor?.effects ?? []).find(effect => [HEATHER_BUFFS, HEATHER_UNIQUE]
    .some(scope => effect.flags?.[scope]?.heatherWarmth === true)) ?? null;
}

function heatherState(effect) {
  return effect?.flags?.[HEATHER_BUFFS]?.heatherWarmth
    ? effect.flags[HEATHER_BUFFS]
    : effect?.flags?.[HEATHER_UNIQUE]?.heatherWarmth
      ? effect.flags[HEATHER_UNIQUE] : null;
}

function heatherTime() {
  return Number(game.time?.worldTime ?? 0);
}

function heatherFearActive(actor) {
  const effect = heatherEffect(actor);
  const state = heatherState(effect);
  return Boolean(effect && !effect.disabled && !effect.isSuppressed && state
    && Number(state.fearUntil) > heatherTime());
}

function heatherDescription(rolled, applied, fearUntil) {
  return "<p>После употребления вересковой медовухи персонаж получает:</p>"
    + "<ul><li><strong>1к4 + 1 временных хитов.</strong> Последний бросок: <strong>"
    + rolled + "</strong>. Временные хиты после применения: <strong>" + applied
    + "</strong>. Они не складываются и сохраняются до долгого отдыха или потери.</li>"
    + "<li><strong>Преимущество на спасброски против испуга</strong> на 1 час "
    + "(до мирового времени " + fearUntil + " сек.).</li></ul>"
    + "<p>Повторное употребление не суммирует преимущества или временные хиты, "
    + "но обновляет час действия преимущества.</p>";
}


// Every completed use returns exactly one empty bottle. Prefer the game's own
// loot template so its picture, weight, price, description and custom flags match.
function heatherIsBottle(item) {
  return String(item?.system?.identifier ?? "").trim().toLowerCase() === HEATHER_BOTTLE_IDENTIFIER;
}

async function heatherBottleTemplate(actor) {
  const sources = [
    ...(game.items?.contents ?? []),
    ...(actor.items?.contents ?? []),
    ...(game.actors?.contents ?? []).flatMap(entry => entry.items?.contents ?? [])
  ];
  const match = sources.find(heatherIsBottle);
  if (match) return match;

  // The bottle may live in an Item compendium rather than the world directory.
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item" || pack.visible === false) continue;
    try {
      const index = await pack.getIndex({ fields: ["system.identifier"] });
      const entry = [...index].find(heatherIsBottle);
      if (!entry) continue;
      const item = await pack.getDocument(entry._id ?? entry.id);
      if (heatherIsBottle(item)) return item;
    } catch (error) {
      console.warn(HEATHER_SELF + " | Не удалось прочитать шаблон пустой бутылки", error);
    }
  }
  return null;
}

async function heatherGiveBottle(actor) {
  // Stack with the actor's existing bottle, not a second duplicate inventory row.
  const owned = (actor.items?.contents ?? []).find(heatherIsBottle);
  if (owned) {
    await owned.update({
      "system.quantity": Math.max(0, Number(owned.system?.quantity ?? 0)) + 1
    });
    return owned;
  }

  const source = await heatherBottleTemplate(actor);
  let data;
  if (source) {
    data = source.toObject();
    delete data._id; // A world/compendium UUID must not be reused as an actor Item ID.
    delete data._stats;
    data.system ??= {};
    data.system.quantity = 1;
  } else {
    // Fallback when the world/compendiums have no such template at all.
    // With a matching template the original custom icon and properties are used.
    data = {
      name: "Пустая бутылка",
      type: "loot",
      img: "icons/svg/item-bag.svg",
      system: {
        identifier: HEATHER_BOTTLE_IDENTIFIER,
        quantity: 1,
        weight: { value: 0.5, units: "lb" },
        price: { value: 2, denomination: "sp" }
      }
    };
  }
  // Do not silently modify the source document; create only on the consumer.
  const created = await actor.createEmbeddedDocuments("Item", [data]);
  if (!source) ui.notifications?.warn?.(
    "Предмет «pustaya-butylka» не найден в справочнике: выдана пустая бутылка с запасной иконкой. " +
    "Добавьте оригинал в Предметы мира, чтобы использовалась ваша иконка."
  );
  return created?.[0] ?? null;
}

const heatherUseTasks = new Map();
function heatherSerialUse(actor, action) {
  const key = actor.uuid;
  const previous = heatherUseTasks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  heatherUseTasks.set(key, next);
  void next.finally(() => {
    if (heatherUseTasks.get(key) === next) heatherUseTasks.delete(key);
  }).catch(() => {});
  return next;
}

/** Use the native Foundry Roll -> chat path; Dice So Nice animates such rolls. */
async function heatherApply(item, actor) {
  if (!heatherOwnsWorkflow() || !heatherItem(item) || !actor || !actor.isOwner) return false;
  const key = actor.uuid;
  if (heatherPending.has(key)) return false;
  heatherPending.add(key);
  try {
    const roll = await new Roll("1d4 + 1").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "Вересковая медовуха — Вересковое тепло (временные хиты)"
    });
    const rolled = Number(roll.total);
    if (!Number.isFinite(rolled)) throw new Error("Некорректный результат 1к4 + 1");
    const previousTemp = Number(actor.system?.attributes?.hp?.temp ?? 0);
    const appliedTemp = Math.max(previousTemp, rolled);
    const now = heatherTime();
    const until = now + HEATHER_HOUR;
    const existing = heatherEffect(actor);
    const data = {
      name: HEATHER_NAME,
      img: item.img || "icons/svg/aura.svg",
      description: heatherDescription(rolled, appliedTemp, until),
      origin: item.uuid,
      type: "base",
      disabled: false,
      transfer: false,
      changes: [],
      duration: { startTime: now },
      flags: {
        [HEATHER_SELF]: {
          heatherWarmth: true,
          identifier: HEATHER_IDENTIFIER,
          lastRoll: rolled,
          displayedTemp: appliedTemp,
          fearUntil: until
        }
      }
    };
    // Temp HP is a resource, NOT an additive ActiveEffect change.
    // Update it with the higher of the old value and the new roll.
    if (appliedTemp !== previousTemp) {
      await actor.update({ "system.attributes.hp.temp": appliedTemp });
    }
    if (existing) {
      const scope = existing.flags?.[HEATHER_BUFFS]?.heatherWarmth
        ? HEATHER_BUFFS : HEATHER_UNIQUE;
      await existing.update({
        name: data.name, img: data.img, description: data.description,
        "duration.startTime": now,
        ["flags." + scope + ".lastRoll"]: rolled,
        ["flags." + scope + ".displayedTemp"]: appliedTemp,
        ["flags." + scope + ".fearUntil"]: until
      });
    } else {
      await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    }
    return true;
  } catch (error) {
    console.error(HEATHER_SELF + " | Ошибка применения вересковой медовухи", error);
    ui.notifications?.error?.("Не удалось применить «Вересковое тепло». Подробности в F12.");
    return false;
  } finally {
    heatherPending.delete(key);
  }
}

// D&D5e 6.x mutates the *embedded Item* when spending a charge.
// This document update is the primary trigger; it also catches consumption
// that never reaches the activity completion hook.
const heatherUpdateCounters = new Map();
const heatherUsePrimed = new Map();

function heatherKey(actor, item) {
  return actor?.uuid && item?.id ? actor.uuid + ":" + item.id : null;
}

function heatherActor(activity) {
  return activity?.actor ?? activity?.item?.actor
    ?? (activity?.item?.parent?.documentName === "Actor" ? activity.item.parent : null);
}

function heatherPrime(activity) {
  if (!heatherOwnsWorkflow() || !heatherItem(activity?.item)) return;
  const key = heatherKey(heatherActor(activity), activity.item);
  if (key) heatherUsePrimed.set(key, Date.now());
}

function heatherClaim(key, from) {
  if (!key) return false;
  const state = heatherUpdateCounters.get(key) ?? { updates: 0, posts: 0 };
  if (from === "update") {
    state.updates++;
    heatherUpdateCounters.set(key, state);
    return true;
  }
  // One postUseActivity hook corresponds to one actual use. If an item update
  // already handled the use, postUse must not grant another bottle.
  if (state.posts < state.updates) {
    state.posts++;
    heatherUpdateCounters.set(key, state);
    return false;
  }
  state.posts++;
  heatherUpdateCounters.set(key, state);
  return true;
}

function heatherRun(actor, sourceItem, trigger) {
  if (!heatherOwnsWorkflow() || !heatherItem(sourceItem) || actor?.documentName !== "Actor") return;
  if (!actor.isOwner) return;
  void heatherSerialUse(actor, async () => {
    console.info(HEATHER_SELF + " | Вересковая медовуха: событие " + trigger, {
      actor: actor.uuid, item: sourceItem.id
    });
    const applied = await heatherApply(sourceItem, actor);
    if (!applied) return;

    // Preserve D&D5e's own item-use consumption. Do not spend it again!
    const owned = actor.items?.get?.(sourceItem.id);
    if (owned && heatherItem(owned)) {
      const uses = owned.system?.uses ?? {};
      const spent = Number(uses.spent ?? 0);
      const max = Number(uses.max ?? 0);
      const qty = Number(owned.system?.quantity ?? 1);
      if (uses.autoDestroy && max > 0 && spent >= max) {
        if (qty > 1) {
          await owned.update({ "system.quantity": qty - 1, "system.uses.spent": 0 });
        } else {
          await owned.delete();
        }
      }
    }
    await heatherGiveBottle(actor);
  }).catch(error => {
    console.error(HEATHER_SELF + " | Медовуха: ошибка применения/возврата бутылки", error);
    ui.notifications?.error?.("Вересковая медовуха: ошибка обработки, подробности в F12.");
  });
}

Hooks.on("dnd5e.preUseActivity", heatherPrime);
Hooks.on("dnd5e.preActivityConsumption", heatherPrime);

Hooks.on("updateItem", (item, changed, options, userId) => {
  if (!heatherOwnsWorkflow() || !heatherItem(item)) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor") return;
  // Only the client which caused the update can grant the reward.
  if (userId && game.user?.id !== userId) return;
  const spentValue = changed?.["system.uses.spent"] ?? changed?.system?.uses?.spent;
  const spentNow = Number(item.system?.uses?.spent ?? 0);
  const usedCharge = spentValue !== undefined && Number(spentValue) > 0
    && spentNow > 0;
  const reducedQuantity = false; // No reliable pre-value in updateItem; postUse covers quantity.
  // The screenshot's consumption type "Использование предмета" increments spent.
  // Quantity-only consumables are handled too when we can confirm consumption.
  if (!usedCharge && !reducedQuantity) return;
  const key = heatherKey(actor, item);
  if (heatherClaim(key, "update")) heatherRun(actor, item, "updateItem");
});

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if (!heatherOwnsWorkflow() || !heatherItem(activity?.item)) return;
  if (!results || typeof results !== "object") return;
  if (heatherCompletedUses.has(results)) return;
  heatherCompletedUses.add(results);
  const actor = heatherActor(activity);
  const key = heatherKey(actor, activity.item);
  if (heatherClaim(key, "post")) heatherRun(actor, activity.item, "postUseActivity");
});

// Some versions delete the whole item at final consumption rather than issue
// updateItem. Only treat deletion as drinking if an Activity was primed shortly
// before it; manual inventory deletion must not give a bottle.
Hooks.on("deleteItem", (item, options, userId) => {
  if (!heatherOwnsWorkflow() || !heatherItem(item)) return;
  const actor = item.parent;
  const key = heatherKey(actor, item);
  if (!key || (userId && game.user?.id !== userId)) return;
  const primed = heatherUsePrimed.get(key);
  if (primed === undefined || Date.now() - primed > 15000) return;
  heatherUsePrimed.delete(key);
  // If updateItem already applied this use, do not replay it on deletion.
  const counts = heatherUpdateCounters.get(key);
  if ((counts?.updates ?? 0) > (counts?.posts ?? 0)) return;
  if (heatherClaim(key, "update")) heatherRun(actor, item, "deleteItem");
});

// Only grant advantage when the save's explicit source or label identifies
// fear/frightened. Never grant blanket advantage to all Wisdom/all saves.
// Generic saves with no fear context can use the normal advantage toggle.
Hooks.on("dnd5e.preRollSavingThrow", (config, dialog, message) => {
  if (!heatherOwnsWorkflow()) return;
  const actor = config?.subject ?? config?.actor;
  if (actor?.documentName !== "Actor" || !heatherFearActive(actor)) return;
  const originText = [
    config?.flavor, config?.label, config?.source?.name,
    config?.activity?.name, config?.context?.flavor,
    dialog?.title, message?.flavor
  ].filter(value => typeof value === "string").join(" ");
  if (!/(испуг|испугать|страх|frighten|frightened|fear)/i.test(originText)) return;
  config.advantage = true;
});

// Expire the status at each completed LONG rest. Foundry/D&D5e normally
// clears temporary HP at long rest; explicitly enforce the 2014 rule here.
Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
  if (!heatherOwnsWorkflow() || actor?.documentName !== "Actor") return;
  if (config?.type !== "long" && config?.restType !== "long" && !result?.longRest) return;
  if (result && typeof result === "object") {
    if (heatherRestEvents.has(result)) return;
    heatherRestEvents.add(result);
  }
  void (async () => {
    const effect = heatherEffect(actor);
    if (!effect || !actor.isOwner) return;
    // The effect is the sole source of the mead status; preserve unrelated AEs.
    if (actor.effects.get(effect.id)) await effect.delete();
    if (Number(actor.system?.attributes?.hp?.temp ?? 0) > 0) {
      await actor.update({ "system.attributes.hp.temp": 0 });
    }
  })().catch(error => console.error(HEATHER_SELF + " | Ошибка отдыха", error));
});

Hooks.once("ready", () => {
  const module = game.modules.get(HEATHER_SELF);
  if (module) module.api = {
    ...(module.api ?? {}),
    isHeatherMead: heatherItem,
    getHeatherWarmth: heatherEffect,
    isHeatherFearAdvantageActive: heatherFearActive,
    applyHeatherWarmth: heatherApply,
    giveHeatherEmptyBottle: heatherGiveBottle
  };
  console.info(HEATHER_SELF + " | Вересковая медовуха: 1к4+1, временные хиты, пустая бутылка, испуг/1 час, долгий отдых");
});