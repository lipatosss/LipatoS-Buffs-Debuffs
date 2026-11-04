/**
 * Aindor cooked meals for Foundry V14 + dnd5e 6.0.6 (2014).
 * All mechanical benefits are actor effects, never transferable item effects.
 * One charge is consumed by the native dnd5e Activity, not by this file.
 */
import { replaceMealEffects } from "./meal-shared.mjs";
import { FoodUseTracker } from "./food-use-tracker.mjs";

const NS = "lipatos-buffs-debuffs";
const STEALTH_TART = "chernichnyy-tart-teney";
const foodIcon = food => `modules/${NS}/icons/foods/${food.id}.webp`;
const ADD = 2; // CONST.ACTIVE_EFFECT_MODES.ADD
const tasks = new Map();
const useTracker = new FoodUseTracker();
const primed = new Map();

const restResults = new WeakSet();
const rerolls = new Set();
const ignoredUpdates = new Set();
const FOOD_ACTIVITY_ID = "eatMeal000000001";

const FOODS = Object.freeze([
  {
    id: "zharkoe-iz-dikogo-kabana", name: "Жаркое из дикого кабана",
    buff: "Крепкая сытость", effect: "8 временных хитов.",
    dc: 11, batch: 2, batchCp: 98, recipeGp: 35, portionSp: 9, weight: 1,
    components: ["Мясо кабана ×2", "Картофель ×2", "Чеснок ×1", "Розмарин ×1", "Соль ×1"],
    tempHp: 8
  },
  {
    id: "uha-tumannogo-berega", name: "Уха туманного берега",
    buff: "Острое чутьё", effect: "Преимущество на проверки Мудрости (Внимательность).",
    dc: 12, batch: 2, batchCp: 73, recipeGp: 75, portionSp: 7, weight: 1,
    components: ["Речной окунь ×2", "Морковь ×1", "Лук ×1", "Укроп ×1", "Соль ×1"],
    changes: [["system.skills.prc.roll.mode", "1"]]
  },
  {
    id: "gribnoe-ragu-travnika", name: "Грибное рагу травника",
    buff: "Стойкий желудок",
    effect: "Сопротивление урону ядом; преимущество на спасброски против отравления.",
    dc: 13, batch: 2, batchCp: 97, recipeGp: 85, portionSp: 9, weight: 1,
    components: ["Пещерные грибы ×3", "Лук ×1", "Чеснок ×1", "Сливки ×1", "Лечебные травы ×1"],
    changes: [["system.traits.dr.value", "poison"]], poisonSave: true
  },
  {
    id: "pryanyy-krolik-ohotnika", name: "Пряный кролик охотника",
    buff: "Проворные ноги", effect: "+5 футов ко всем имеющимся скоростям передвижения.",
    dc: 14, batch: 2, batchCp: 81, recipeGp: 65, portionSp: 10, weight: 1,
    components: ["Мясо кролика ×2", "Острый перец ×1", "Чеснок ×1", "Мёд ×1", "Соль ×1"],
    changes: [["system.attributes.movement.bonus", "5"]]
  },
  {
    id: "pastushiy-pirog-silacha", name: "Пастуший пирог силача",
    buff: "Сила земледельца",
    effect: "Преимущество на проверки Силы (Атлетика), включая захваты и толчки.",
    dc: 12, batch: 3, batchCp: 83, recipeGp: 45, portionSp: 6, weight: 0.8,
    components: ["Говядина ×2", "Картофель ×2", "Мука ×1", "Сливочное масло ×1", "Соль ×1"],
    changes: [["system.skills.ath.roll.mode", "1"]]
  },
  {
    id: "medovye-oreshki-strannika", name: "Медовые орешки странника",
    buff: "Быстрая реакция", effect: "+2 к инициативе.",
    dc: 11, batch: 2, batchCp: 44, recipeGp: 35, portionSp: 5, weight: 0.3, dessert: true,
    components: ["Лесные орехи ×2", "Мёд ×1", "Сливочное масло ×1", "Корица ×1"],
    changes: [["system.attributes.init.roll.bonus", "2"]]
  },
  {
    id: STEALTH_TART, name: "Черничный тарт теней",
    buff: "Лёгкая поступь",
    effect: "+2 к проверкам Ловкости (Скрытность). Один раз до долгого отдыха можно перебросить проверку Скрытности: нажмите на иконку баффа.",
    dc: 13, batch: 3, batchCp: 51, recipeGp: 70, portionSp: 4, weight: 0.4, dessert: true,
    components: ["Черника ×3", "Мука ×1", "Сахар ×1", "Яйцо ×1", "Сливочное масло ×1"],
    changes: [["system.skills.ste.roll.bonus", "2"]]
  },
  {
    id: "lunnyy-tvorozhnyy-puding", name: "Лунный творожный пудинг",
    buff: "Ясный разум",
    effect: "+2 к спасброскам Телосложения для поддержания концентрации.",
    dc: 15, batch: 2, batchCp: 92, recipeGp: 100, portionSp: 12, weight: 0.5, dessert: true,
    components: ["Творог ×2", "Молоко ×1", "Яйцо ×1", "Мёд ×1", "Лунные ягоды ×1"],
    changes: [["system.attributes.concentration.roll.bonus", "2"]]
  }
]);

const byId = new Map(FOODS.map(food => [food.id, food]));

function foodDefinition(item) {
  if (item?.type !== "consumable") return null;
  const identifier = String(item.system?.identifier ?? "").trim().toLowerCase();
  const byIdentifier = byId.get(identifier);
  if (byIdentifier) return byIdentifier;
  // Mastercrafted and Item Piles may copy a product without the identifier
  // we originally assigned to the world template. Exact Russian names are
  // unique and let those newly crafted items remain fully automated.
  const name = String(item.name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
  return FOODS.find(food => food.name.toLocaleLowerCase("ru") === name) ?? null;
}
function ownActor(activity) {
  return activity?.actor ?? activity?.item?.actor
    ?? (activity?.item?.parent?.documentName === "Actor" ? activity.item.parent : null);
}
function foodKey(actor, item) {
  return actor?.uuid && item?.id ? actor.uuid + ":" + item.id : null;
}
function firstGM() {
  return [...(game.users ?? [])].filter(user => user.active && user.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}
function workFor(actor, fn) {
  const key = actor.uuid, previous = tasks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  tasks.set(key, next);
  void next.finally(() => { if (tasks.get(key) === next) tasks.delete(key); }).catch(() => {});
  return next;
}
function foodEffects(actor) {
  return [...(actor?.effects ?? [])].filter(effect => effect.flags?.[NS]?.foodBuff === true);
}
function mealDescription(food) {
  return "<p><strong>" + food.buff + ".</strong> " + food.effect + "</p>"
    + "<p>Действует до завершения следующего долгого отдыха. "
    + "Любая другая еда или вересковая медовуха заменяет этот бафф.</p>";
}
function makeItem(food) {
  const description = "<p>" + food.name + ". После употребления: <strong>"
    + food.buff + "</strong> — " + food.effect + "</p>"
    + "<p><strong>Длительность:</strong> до долгого отдыха.</p>"
    + "<p><strong>Крафт:</strong> Кулинария, СЛ " + food.dc
    + "; результат " + food.batch + " порц.; ингредиенты: "
    + food.components.join(", ") + ".</p>";
  return {
    name: food.name, type: "consumable", img: foodIcon(food),
    system: {
      identifier: food.id, description: { value: description },
      type: { value: "food", subtype: "" },
      quantity: 1,
      weight: { value: food.weight, units: "lb" },
      price: { value: food.portionSp, denomination: "sp" },
      rarity: "common",
      uses: { spent: 0, max: "1", recovery: [], prompt: false, autoDestroy: true },
      activities: {
        [FOOD_ACTIVITY_ID]: {
          type: "utility", name: "Съесть",
          activation: { type: "action", value: 1, condition: "" },
          consumption: {
            targets: [{ type: "itemUses", target: "", value: "1",
              scaling: { mode: "", formula: "" } }],
            scaling: { allowed: false }
          }
        }
      }
    },
    flags: { [NS]: { cookedFood: true, recipeDc: food.dc,
      batchYield: food.batch, batchCostCp: food.batchCp,
      recipePriceGp: food.recipeGp, ingredients: food.components,
      dessert: food.dessert === true } }
  };
}

/** Repair a crafted/legacy product in place, without changing its quantity,
 * custom names, weight, price, ingredients or arbitrary other activities. */
async function repairFoodItem(item) {
  const food = foodDefinition(item);
  if (!food) return false;
  const patch = {};
  const image = foodIcon(food);
  if (item.img !== image) patch.img = image;
  if (String(item.system?.identifier ?? "") !== food.id)
    patch["system.identifier"] = food.id;
  if (item.system?.type?.value !== "food")
    patch["system.type.value"] = "food";
  if (item.flags?.[NS]?.cookedFood !== true)
    patch["flags." + NS + ".cookedFood"] = true;
  const uses = item.system?.uses ?? {};
  if (Number(uses.max ?? 0) !== 1) patch["system.uses.max"] = "1";
  if (uses.autoDestroy !== true) patch["system.uses.autoDestroy"] = true;
  if (uses.prompt !== false) patch["system.uses.prompt"] = false;
  const raw = item.toObject?.()?.system?.activities ?? {};
  const ownActivity = raw[FOOD_ACTIVITY_ID];
  const target = ownActivity?.consumption?.targets?.find(t =>
    t.type === "itemUses" && Number(t.value) === 1);
  if (!target) {
    patch["system.activities." + FOOD_ACTIVITY_ID] =
      makeItem(food).system.activities[FOOD_ACTIVITY_ID];
  }
  if (!Object.keys(patch).length) return false;
  await item.update(patch);
  return true;
}

/** GM-only installer; existing world and actor items are repaired safely. */
export async function installFoodItems() {
  if (!game.user?.isGM) throw new Error("Создание блюд доступно только ГМ.");
  const world = game.items?.contents ?? [];
  const actors = game.actors?.contents ?? [];
  const owned = actors.flatMap(actor => actor.items?.contents ?? []);
  for (const item of [...world, ...owned]) {
    if (foodDefinition(item)) await repairFoodItem(item);
  }
  const existing = new Set(world
    .map(item => foodDefinition(item)?.id).filter(Boolean));
  const missing = FOODS.filter(food => !existing.has(food.id));
  if (!missing.length) return [];
  return Item.createDocuments(missing.map(makeItem));
}
export const listFood = () => FOODS.map(food => ({
  identifier: food.id, name: food.name, buff: food.buff, effect: food.effect,
  recipeDc: food.dc, batchYield: food.batch, batchCostCp: food.batchCp,
  recipePriceGp: food.recipeGp, priceSp: food.portionSp,
  dessert: food.dessert === true, img: foodIcon(food), ingredients: [...food.components]
}));

async function applyFood(actor, item, food) {
  if (!actor?.isOwner) return false;
  // Explicitly remove all former food AND the already installed mead effect.
  await replaceMealEffects(actor);
  const oldTemp = Number(actor.system?.attributes?.hp?.temp ?? 0);
  const newTemp = food.tempHp ? Math.max(oldTemp, food.tempHp) : oldTemp;
  const flags = { foodBuff: true, foodIdentifier: food.id, rerollSpent: false,
    grantedTemporaryHp: Number(food.tempHp ?? 0),
    displayedTemporaryHp: newTemp };
  const effect = {
    name: food.buff, img: item.img || "icons/svg/item-bag.svg",
    description: mealDescription(food), origin: item.uuid,
    type: "base", disabled: false, transfer: false,
    duration: { startTime: Number(game.time?.worldTime ?? 0) },
    changes: (food.changes ?? []).map(([key, value]) => ({
      key, value, mode: ADD, priority: 20
    })),
    flags: { [NS]: flags }
  };
  if (food.tempHp && newTemp !== oldTemp) {
    await actor.update({ "system.attributes.hp.temp": newTemp });
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  // Cooked meals also count as eating for the existing Hunger subsystem.
  try { await game.modules.get(NS)?.api?.feed?.(actor); }
  catch (error) { console.warn(NS + " | Не удалось учесть еду для голода", error); }
  return true;
}

async function finalizeCharge(actor, item) {
  const owned = actor.items?.get?.(item.id);
  if (!owned || !foodDefinition(owned)) return;
  const uses = owned.system?.uses ?? {};
  const spent = Number(uses.spent ?? 0), max = Number(uses.max ?? 0);
  if (!uses.autoDestroy || max <= 0 || spent < max) return;
  const key = foodKey(actor, owned);
  ignoredUpdates.add(key);
  try {
    const qty = Number(owned.system?.quantity ?? 1);
    if (qty > 1) await owned.update({ "system.quantity": qty - 1, "system.uses.spent": 0 });
    else await owned.delete();
  } finally { ignoredUpdates.delete(key); }
}
function runFood(actor, item, trigger, { manualConsumption = false } = {}) {
  const food = foodDefinition(item);
  if (!food || !actor?.isOwner || actor.documentName !== "Actor") return;
  void workFor(actor, async () => {
    // A successful native "Use" action must spend exactly one charge.
    // If third-party modules bypass the dnd5e consumption pipeline,
    // our postUse fallback spends it once before applying the buff.
    if (manualConsumption) {
      const owned = actor.items?.get?.(item.id);
      const key = foodKey(actor, item);
      if (owned && foodDefinition(owned)) {
        ignoredUpdates.add(key);
        try { await owned.update({ "system.uses.spent": 1 }); }
        finally { ignoredUpdates.delete(key); }
      }
    }
    const applied = await applyFood(actor, item, food);
    if (!applied) return;
    await finalizeCharge(actor, item);
    console.info(NS + " | Автоматически применена еда: " + food.name + " (" + trigger + ")");
  }).catch(error => {
    console.error(NS + " | Ошибка применения еды " + food.name, error);
    ui.notifications?.error?.("Не удалось применить бафф «" + food.buff + "» (F12).");
  });
}
// D&D5e 6.0.6 confirmed consumption is the primary trigger. The old
// implementation checked for remaining charges AFTER autoDestroy and could
// silently skip a successfully eaten food. Track individual activations so
// updateItem, deleteItem, postUse and postActivityConsumption never stack buffs.
function prime(activity, usageConfig, isNew) {
  if (!foodDefinition(activity?.item)) return;
  const actor = ownActor(activity), key = foodKey(actor, activity.item);
  if (!key || !actor?.isOwner) return;
  if (isNew) useTracker.begin(key, usageConfig);
  else useTracker.preConsumption(key, usageConfig);
  if (isNew || !primed.has(key)) {
    primed.set(key, {
      time: Date.now(),
      quantity: Number(activity.item.system?.quantity ?? 1)
    });
  }
}
Hooks.on("dnd5e.preUseActivity", (activity, usageConfig) => prime(activity, usageConfig, true));
Hooks.on("dnd5e.preActivityConsumption", (activity, usageConfig) => prime(activity, usageConfig, false));

Hooks.on("dnd5e.postActivityConsumption", (activity, usageConfig) => {
  const item = activity?.item, food = foodDefinition(item);
  if (!food) return;
  const actor = ownActor(activity), key = foodKey(actor, item);
  if (!actor?.isOwner || !key) return;
  // This hook is called by dnd5e after it has performed the consumption.
  // Do not depend on item still being present after autoDestroy.
  if (useTracker.consumed(key, usageConfig)) {
    // Native versions & third-party sheets may report successful use without
    // spending the charge. Make consumption real, but NEVER consume twice.
    const owned = actor.items?.get?.(item.id);
    const before = primed.get(key);
    const chargeSpent = Number(owned?.system?.uses?.spent ?? 0) > 0;
    const portionSpent = Boolean(before && owned &&
      Number(owned.system?.quantity ?? 1) < before.quantity);
    console.info(NS + " | Завершено употребление (postActivityConsumption):", food.name);
    runFood(actor, item, "postActivityConsumption",
      { manualConsumption: Boolean(owned && !chargeSpent && !portionSpent) });
  }
});

Hooks.on("updateItem", (item, changed, options, userId) => {
  if (!foodDefinition(item) || item.parent?.documentName !== "Actor") return;
  if (userId && userId !== game.user?.id) return;
  const actor = item.parent, key = foodKey(actor, item);
  if (ignoredUpdates.has(key)) return;
  const spent = changed?.["system.uses.spent"] ?? changed?.system?.uses?.spent;
  const quantity = changed?.["system.quantity"] ?? changed?.system?.quantity;
  const usedCharge = spent !== undefined && Number(spent) > 0
    && Number(item.system?.uses?.spent ?? 0) > 0;
  const entry = primed.get(key);
  const usedPortion = entry && Date.now() - entry.time < 30000
    && quantity !== undefined && Number(quantity) < entry.quantity;
  if ((usedCharge || usedPortion) && useTracker.itemUpdated(key)) {
    runFood(actor, item, "updateItem");
  }
});
Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, result) => {
  // postUseActivity fires only after an activity has successfully activated.
  // Do NOT demand remaining item uses here: autoDestroy may have removed
  // the item, or a custom sheet may have bypassed its native consumption.
  if (!foodDefinition(activity?.item) || !result || typeof result !== "object") return;
  const actor = ownActor(activity), key = foodKey(actor, activity.item);
  if (!actor?.isOwner || !key) return;
  const before = primed.get(key);
  const current = actor.items?.get?.(activity.item.id);
  const usedCharge = Number(current?.system?.uses?.spent ?? 0) > 0;
  const usedPortion = Boolean(before && current &&
    Number(current.system?.quantity ?? 1) < before.quantity);
  const fullyConsumed = Boolean(before && actor.items && !current);
  const nativeConsumed = Boolean(usedCharge || usedPortion || fullyConsumed);
  if (useTracker.postUse(key, usageConfig, result, true)) {
    runFood(actor, activity.item, "postUseActivity",
      { manualConsumption: !nativeConsumed && Boolean(current) });
  }
  primed.delete(key);
});
Hooks.on("deleteItem", (item, options, userId) => {
  if (!foodDefinition(item) || item.parent?.documentName !== "Actor") return;
  if (userId && userId !== game.user?.id) return;
  const actor = item.parent, key = foodKey(actor, item);
  const entry = primed.get(key);
  if (!entry || Date.now() - entry.time > 30000 || ignoredUpdates.has(key)) return;
  if (useTracker.itemUpdated(key)) runFood(actor, item, "deleteItem");
});

// Poison resistance comes from an ActiveEffect. Advantage must only apply to
// poison-related saves; never blanket-advantage every Constitution saving throw.
Hooks.on("dnd5e.preRollSavingThrow", (config, dialog, message) => {
  const actor = config?.subject ?? config?.actor;
  if (actor?.documentName !== "Actor") return;
  if (!foodEffects(actor).some(effect =>
    !effect.disabled && effect.flags?.[NS]?.foodIdentifier === "gribnoe-ragu-travnika")) return;
  const context = [
    config?.flavor, config?.label, config?.source?.name,
    config?.activity?.name, config?.context?.flavor,
    dialog?.title, message?.flavor
  ].filter(value => typeof value === "string").join(" ");
  if (/(яд|отрав|poison)/i.test(context)) config.advantage = true;
});

export function canRerollStealth(effect) {
  return effect?.flags?.[NS]?.foodIdentifier === STEALTH_TART
    && effect.flags[NS].foodBuff === true
    && effect.flags[NS].rerollSpent !== true && !effect.disabled;
}
export async function rerollStealth(actor) {
  if (!actor?.isOwner || typeof actor.rollSkill !== "function") return false;
  const effect = foodEffects(actor).find(canRerollStealth);
  if (!effect || rerolls.has(actor.uuid)) return false;
  rerolls.add(actor.uuid);
  try {
    const result = await actor.rollSkill("ste");
    if (!result) return false; // No use spent when the roll was cancelled.
    await effect.update({ ["flags." + NS + ".rerollSpent"]: true });
    ui.notifications?.info?.("Переброс Скрытности из блюда «Черничный тарт теней» использован.");
    return true;
  } finally { rerolls.delete(actor.uuid); }
}

Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  if (config?.type !== "long" && config?.restType !== "long" && !result?.longRest) return;
  if (result && typeof result === "object") {
    if (restResults.has(result)) return;
    restResults.add(result);
  }
  void workFor(actor, async () => {
    const effects = foodEffects(actor).filter(effect => actor.effects.get(effect.id));
    if (effects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
    // dnd5e itself resets temp HP on long rest; do not wipe unrelated resources.
  }).catch(error => console.error(NS + " | Долгий отдых: еда", error));
});

// Mastercrafted may generate a fresh actor item during crafting. Repair it
// immediately so the "Съесть" activity, type, icon and charges appear without
// a world reload. The user who created it (or first active GM) performs the
// update to avoid multiple clients modifying the same item.
Hooks.on("createItem", (item, options, userId) => {
  if (item.parent?.documentName !== "Actor" || !foodDefinition(item)) return;
  if (game.user?.isGM) {
    if (firstGM()?.id !== game.user.id) return;
  } else if (userId !== game.user?.id) return;
  void repairFoodItem(item).catch(error => {
    console.error(NS + " | Не удалось настроить блюдо после крафта", error);
  });
});

Hooks.once("ready", () => {
  const module = game.modules.get(NS);
  if (module) module.api = {
    ...(module.api ?? {}), listFoodItems: listFood,
    installFoodItems, rerollFoodStealth: rerollStealth
  };
  if (game.user?.isGM && firstGM()?.id === game.user.id) {
    void installFoodItems().then(created => {
      if (created.length) ui.notifications?.info?.(
        "LipatoS: создано " + created.length + " блюд в «Предметах мира»."
      );
    }).catch(error => console.error(NS + " | Ошибка установки блюд", error));
  }
});
