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

// D&D5e 6.x clones an Item and its Activity once before preUseActivity
// and AGAIN after preparing scaling, so the pre/post Activity instances
// are different objects. Never key a successful use on the pre hook instance.
// postUseActivity fires only AFTER a successful completed activation.
Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if (!heatherOwnsWorkflow() || !heatherItem(activity?.item)) return;
  if (!results || typeof results !== "object") return;
  // Each successful use has its own result object. Suppress only an identical
  // hook result invoked twice; distinct real uses still grant distinct bottles.
  if (heatherCompletedUses.has(results)) return;
  heatherCompletedUses.add(results);

  const sourceItem = activity.item; // The cloned Item is safe after consumption.
  const actor = activity.actor ?? sourceItem.actor ?? sourceItem.parent;
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;

  void heatherSerialUse(actor, async () => {
    // Never spend a charge twice: D&D5e already handled activity consumption.
    // In some 6.x cases a single-use consumable with autoDestroy remains in
    // inventory after its final charge is spent. Remove only if needed.
    const applied = await heatherApply(sourceItem, actor);
    if (!applied) return;

    const owned = actor.items?.get?.(sourceItem.id);
    if (owned && heatherItem(owned)) {
      const uses = owned.system?.uses ?? {};
      const max = Number(uses.max ?? 0);
      const spent = Number(uses.spent ?? 0);
      const qty = Math.max(0, Number(owned.system?.quantity ?? 1));
      if (uses.autoDestroy && Number.isFinite(max) && max > 0 && spent >= max) {
        if (qty > 1) {
          // One filled bottle is gone, another filled bottle can be used.
          await owned.update({ "system.quantity": qty - 1, "system.uses.spent": 0 });
        } else {
          await owned.delete();
        }
      } else if (max <= 0) {
        // A consumable without a configured limited-use pool: avoid granting
        // endless buffs and empties if the activity has no native consumption.
        // If D&D5e already removed the item, owned would be missing.
        if (qty > 1) await owned.update({ "system.quantity": qty - 1 });
        else await owned.delete();
      }
    }

    // Exactly one empty bottle for every successful use, even if the
    // original consumable was auto-destroyed by the dnd5e system.
    await heatherGiveBottle(actor);
  }).catch(error => {
    console.error(HEATHER_SELF + " | Не удалось завершить использование медовухи", error);
    ui.notifications?.error?.("Баф получен, но завершить расход/возврат бутылки не удалось (F12).");
  });
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