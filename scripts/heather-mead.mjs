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
const HEATHER_NAME = "Вересковое тепло";
const HEATHER_HOUR = 3600;
const heatherPending = new Set();
const heatherBefore = new WeakMap();
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

// Take a pre-use snapshot. Some consumables have native item-quantity
// consumption, others spend the item's limited uses instead.
Hooks.on("dnd5e.preUseActivity", activity => {
  if (!heatherOwnsWorkflow() || !heatherItem(activity?.item)) return;
  const item = activity.item;
  heatherBefore.set(activity, {
    quantity: Number(item.system?.quantity ?? 0),
    spent: Number(item.system?.uses?.spent ?? 0)
  });
});

Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
  if (!heatherOwnsWorkflow() || !heatherItem(activity?.item)) return;
  const item = activity.item;
  const actor = activity.actor ?? item.actor ?? item.parent;
  if (actor?.documentName !== "Actor") return;
  // This hook is fired AFTER the use has succeeded. Do not run on cancelled uses.
  void (async () => {
    const before = heatherBefore.get(activity);
    heatherBefore.delete(activity);
    if (results === false) return;
    const currentQty = Number(item.system?.quantity ?? 0);
    const currentSpent = Number(item.system?.uses?.spent ?? 0);
    const nativeSpent = before && (currentQty < before.quantity
      || currentSpent > before.spent);
    // If the activity was configured without consumption, spend one bottle.
    // Native consumption always takes precedence; never double-charge it.
    if (!nativeSpent && actor.items?.get(item.id) && currentQty > 0) {
      if (currentQty === 1) await item.delete();
      else await item.update({ "system.quantity": currentQty - 1 });
    }
    await heatherApply(item, actor);
  })().catch(error => {
    console.error(HEATHER_SELF + " | Ошибка использования медовухи", error);
    ui.notifications?.error?.("Не удалось обработать использование вересковой медовухи (F12).");
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
    applyHeatherWarmth: heatherApply
  };
  console.info(HEATHER_SELF + " | Вересковая медовуха: 1к4+1, временные хиты, испуг/1 час, долгий отдых");
});