/**
 * Aindor cooked meals for Foundry V14 + dnd5e 6.0.6 (2014).
 * All mechanical benefits are actor effects, never transferable item effects.
 * Meal buffs apply ONLY through the explicit right-click "Использовать" command.
 * Transfers, deletion, inventory changes and generic activities cannot eat food.
 */
import { replaceMealEffects } from "./meal-shared.mjs";

const NS = "lipatos-buffs-debuffs";
const STEALTH_TART = "chernichnyy-tart-teney";
const DEFAULT_MEAL_ICON = "icons/svg/item-bag.svg";
const foodIcon = () => DEFAULT_MEAL_ICON;
const ADD = 2; // CONST.ACTIVE_EFFECT_MODES.ADD
const tasks = new Map();

const restResults = new WeakSet();
const rerolls = new Set();
const foodAudit = [];
function auditFood(event, actor, item, detail = "") {
  foodAudit.push({ event, actor: actor?.uuid ?? null, food: item?.name ?? null,
    detail: String(detail).slice(0, 240) });
  if (foodAudit.length > 40) foodAudit.shift();
  console.info(NS + " | food:", foodAudit[foodAudit.length - 1]);
}
const FOOD_ACTIVITY_ID = "eatMeal000000001"; // Old, REMOVE on upgrade
const USE_ACTIVITY_ID = "useFood000000001";

const FOODS = Object.freeze([
  {
    id: "zharkoe-iz-dikogo-kabana", name: "Жаркое из дикого кабана",
    buff: "Крепкая сытость", effect: "1к4 + 2 временных хитов.",
    dc: 11, batch: 2, batchCp: 98, recipeGp: 35, portionSp: 9, weight: 1,
    components: ["Мясо кабана ×2", "Картофель ×2", "Чеснок ×1", "Розмарин ×1", "Соль ×1"],
    tempHpFormula: "1d4 + 2"
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
  },
  {
    id: "korolevskiy-kleshnyar-v-chesnochnom-masle",
    name: "Королевский клешняр в чесночном масле",
    buff: "Королевская меткость",
    effect: "+1 к броскам атаки любым оружием ближнего и дальнего боя (не заклинаниям).",
    description: "Сочное белоснежное мясо королевского клешняра запекают в алом панцире под растопленным чесночным маслом с шалфеем. Нежная сладость морского мяса и пряный аромат придают рукам едока уверенную точность.",
    dc: 14, batch: 2, batchCp: 195, recipeGp: 110, portionSp: 18, weight: 1,
    components: ["Королевский клешняр ×1", "Сливочное масло ×1", "Чеснок ×2", "Шалфей ×1", "Соль ×1", "Лимон ×1"],
    changes: [["system.rolls.attack.mwak.bonus", "1"], ["system.rolls.attack.rwak.bonus", "1"]],
    rarity: "uncommon"
  },
  {
    id: "rybnoe-sashimi", name: "Рыбное сашими", buff: "Чутьё рыболова",
    effect: "+2 к проверкам ремесла «Рыболовство».",
    description: "Тонкие, аккуратно нарезанные ломтики свежеподготовленного морского филе выложены веером на охлаждённой тарелке. Чистый вкус рыбы, капля цитруса и щепоть морской соли пробуждают тонкое понимание подводной добычи.",
    dc: 12, batch: 2, batchCp: 105, recipeGp: 65, portionSp: 10, weight: 0.5,
    components: ["Морская рыба ×2", "Лимон ×1", "Морская соль ×1", "Пряные травы ×1"],
    professionBonuses: ["fishing"], rarity: "uncommon"
  },
  {
    id: "onigiri", name: "Онигири", buff: "Тонкий вкус мастера",
    effect: "+2 к проверкам ремесла «Пивоварение и виноделие».",
    description: "Плотные треугольники тёплого риса с солёной начинкой бережно обёрнуты листами водорослей. Скромная закуска очищает вкус и позволяет тоньше различать хмельные, солодовые и винные оттенки.",
    dc: 11, batch: 3, batchCp: 75, recipeGp: 55, portionSp: 7, weight: 0.4,
    components: ["Рис ×2", "Морская рыба ×1", "Водоросли ×1", "Соль ×1", "Уксус ×1"],
    professionBonuses: ["brewing"]
  },
  {
    id: "zhemchuzhnye-gnezda-dlinnousov",
    name: "Жемчужные гнёзда длинноусов",
    buff: "Чуткость алхимика",
    effect: "+2 к проверкам ремесла «Алхимия».",
    description: "Нежное прибрежное блюдо из крупных длинноусов, уложенных поверх небольших округлых гнёзд из белоснежного риса. Слегка обжаренное мясо обладает сладковатым морским вкусом, который дополняют свежие листья салата, ароматный чеснок и лёгкая цитрусовая кислинка. Среди алхимиков Айндора это блюдо особенно ценится за способность обострять восприятие тонких запахов и вкусов, помогая точнее различать свойства трав, настоев и алхимических компонентов.",
    dc: 13, batch: 2, batchCp: 125, recipeGp: 80, portionSp: 13, weight: 0.6,
    components: ["Длинноус ×4", "Рис ×2", "Листья салата ×2", "Чеснок ×1", "Лимон ×1", "Соль ×1"],
    professionBonuses: ["alchemy"], rarity: "uncommon"
  }
]);


const BEERS = Object.freeze([
  {
    id: "veselyy-trubadur", name: "Весёлый трубадур", buff: "Хмельная удаль",
    effect: "+2 к проверкам Харизмы (Выступление).",
    description: "Медно-янтарный эль с мёдом и хмелем. Его любят певцы и странствующие артисты.",
    dc: 11, batch: 3, batchCp: 54, recipeGp: 40, portionSp: 7, weight: 1,
    components: ["Ячмень ×3", "Хмель ×2", "Мёд ×1", "Дрожжи ×1", "Чистая вода ×1"],
    changes: [["system.skills.prf.roll.bonus", "2"]], beer: true
  },
  {
    id: "kabanya-yarost-pivo", name: "Кабанья ярость", buff: "Кабанья отвага",
    effect: "+2 к проверкам Харизмы (Запугивание).",
    description: "Тёмный крепкий эль из обжаренного солода с терпким послевкусием.",
    dc: 13, batch: 3, batchCp: 87, recipeGp: 65, portionSp: 12, weight: 1,
    components: ["Ячмень ×3", "Жареный солод ×2", "Хмель ×1", "Дрожжи ×1", "Чистая вода ×1"],
    changes: [["system.skills.itm.roll.bonus", "2"]], beer: true
  },
  {
    id: "lesnoy-shepot", name: "Лесной шёпот", buff: "Лесное чутьё",
    effect: "+2 к проверкам Интеллекта (Природа).",
    description: "Светлый золотисто-зелёный эль, настоянный на душистых лесных травах.",
    dc: 12, batch: 3, batchCp: 69, recipeGp: 70, portionSp: 10, weight: 1,
    components: ["Пшеница ×3", "Хмель ×1", "Лесные травы ×2", "Дрожжи ×1", "Чистая вода ×1"],
    changes: [["system.skills.nat.roll.bonus", "2"]], beer: true
  },
  {
    id: "pastushiy-el", name: "Пастуший эль", buff: "Звериное доверие",
    effect: "+2 к проверкам Мудрости (Дрессировка).",
    description: "Мягкий светлый эль с овсом и ромашкой, любимый пастухами и конюхами.",
    dc: 11, batch: 3, batchCp: 57, recipeGp: 45, portionSp: 8, weight: 1,
    components: ["Ячмень ×2", "Овёс ×2", "Хмель ×1", "Ромашка ×1", "Дрожжи ×1", "Чистая вода ×1"],
    changes: [["system.skills.ani.roll.bonus", "2"]], beer: true
  },
  {
    id: "shalfejnyj-el", name: "Шалфейный эль", buff: "Целебное чутьё",
    effect: "+2 к проверкам Мудрости (Медицина).",
    description: "Душистый эль с мёдом и шалфеем, который ценят странствующие лекари.",
    dc: 13, batch: 3, batchCp: 84, recipeGp: 80, portionSp: 12, weight: 1,
    components: ["Пшеница ×2", "Хмель ×1", "Шалфей ×2", "Мёд ×1", "Дрожжи ×1", "Чистая вода ×1"],
    changes: [["system.skills.med.roll.bonus", "2"]], beer: true
  },
  {
    id: "pancirnyy-el", name: "Панцирный эль", buff: "Багровый панцирь",
    effect: "+1 к классу доспеха (КД).",
    description: "Густой багрово-янтарный эль с медной пеной варят на отваре из обжаренных панцирей Багрового латника. Его солодовому вкусу сопутствуют солоноватые морские нотки. Моряки прозвали напиток жидкой бронёй за чувство прочности, разливающееся по телу.",
    dc: 13, batch: 2, batchCp: 130, recipeGp: 95, portionSp: 12, weight: 1.5,
    components: ["Багровый латник ×1", "Ячмень ×1", "Жареный солод ×1", "Хмель ×1", "Дрожжи ×1", "Соль ×1", "Чистая вода ×1", "Пустая бутылка ×2"],
    changes: [["system.attributes.ac.bonus", "1"]], rarity: "uncommon", beer: true
  }
]);

const ALL_MEALS = [...FOODS, ...BEERS];
// Only the exact 13 image paths shipped by older releases are migrated.
// Other paths may be custom icons selected by the GM and must be preserved.
const BUNDLED_MEAL_ICONS = new Set(ALL_MEALS.map(food =>
  `modules/${NS}/icons/${food.beer ? "beers" : "foods"}/${food.id}.webp`
));
const isOldBundledMealIcon = img => BUNDLED_MEAL_ICONS.has(String(img ?? "").split("?")[0]);
const byId = new Map(ALL_MEALS.map(food => [food.id, food]));

function foodDefinition(item) {
  if (item?.type !== "consumable") return null;
  const identifier = String(item.system?.identifier ?? "").trim().toLowerCase();
  const byIdentifier = byId.get(identifier);
  if (byIdentifier) return byIdentifier;
  // Mastercrafted and Item Piles may copy a product without the identifier
  // we originally assigned to the world template. Exact Russian names are
  // unique and let those newly crafted items remain fully automated.
  const name = String(item.name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
  return ALL_MEALS.find(food => food.name.toLocaleLowerCase("ru") === name) ?? null;
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
    + "<p>Действует до завершения следующего долгого отдыха.</p>";
}
function nativeUseActivity() {
  // D&D5e 6.x needs a single ordinary utility activity so the INVENTORY'S
  // built-in "Использовать" control has something to activate.
  // There is no separate "Съесть" button and no script/macro popup.
  return {
    type: "utility", name: "Использовать",
    activation: { type: "action", value: 1, condition: "" },
    consumption: {
      targets: [{ type: "itemUses", target: "", value: "1",
        scaling: { mode: "", formula: "" } }],
      scaling: { allowed: false }
    }
  };
}
function makeItem(food) {
  const description = "<p>" + (food.beer ? "Пиво «" + food.name + "»" : food.name) + ". " + (food.description ? food.description + " " : "") + "После употребления: <strong>"
    + food.buff + "</strong> — " + food.effect + "</p>"
    + "<p><strong>Длительность:</strong> до долгого отдыха.</p>"
    + "<p><strong>Крафт:</strong> " + (food.beer ? "Пивоварение" : "Кулинария") + ", СЛ " + food.dc
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
      rarity: food.rarity ?? "common",
      uses: { spent: 0, max: "1", recovery: [], prompt: false, autoDestroy: true },
      activities: { [USE_ACTIVITY_ID]: nativeUseActivity() }
    },
    flags: { [NS]: { cookedFood: !food.beer, brewedBeer: food.beer === true, recipeDc: food.dc,
      batchYield: food.batch, batchCostCp: food.batchCp,
      recipePriceGp: food.recipeGp, ingredients: food.components,
      dessert: food.dessert === true,
      professionBonuses: food.professionBonuses ?? [] } }
  };
}

/** Repair a crafted/legacy product in place, without changing its quantity,
 * custom names, weight, price, ingredients or arbitrary other activities. */
async function repairFoodItem(item) {
  const food = foodDefinition(item);
  if (!food) return false;
  const patch = {};
  // One-time migration from image files removed in v0.6.26. Never overwrite
  // a manually configured icon, even after crafting or on future restarts.
  if (isOldBundledMealIcon(item.img)) patch.img = DEFAULT_MEAL_ICON;
  if (food.beer && item.flags?.[NS]?.brewedBeer !== true)
    patch["flags." + NS + ".brewedBeer"] = true;
  // Existing crafted and world items must also stop displaying the old fixed
  // "8 temporary HP" text; preserve all unrelated custom description fields.
  const oldDescription = String(item.system?.description?.value ?? "");
  if (food.id === "onigiri" && oldDescription.includes("ремёсел «Пивоварение» и «Виноделие»")) {
    patch["system.description.value"] = oldDescription.replace(
      "ремёсел «Пивоварение» и «Виноделие»", "ремесла «Пивоварение и виноделие»"
    );
  }
  if (food.professionBonuses?.length
      && JSON.stringify(item.flags?.[NS]?.professionBonuses ?? []) !== JSON.stringify(food.professionBonuses)) {
    patch["flags." + NS + ".professionBonuses"] = [...food.professionBonuses];
  }
  if (food.tempHpFormula && /8\s+(?:временных|бонусных)\s+хитов/i.test(oldDescription)) {
    patch["system.description.value"] = oldDescription.replace(
      /8\s+(?:временных|бонусных)\s+хитов/gi,
      "1к4 + 2 временных хитов"
    );
  }
  if (String(item.system?.identifier ?? "") !== food.id)
    patch["system.identifier"] = food.id;
  if (item.system?.type?.value !== "food")
    patch["system.type.value"] = "food";
  if (!food.beer && item.flags?.[NS]?.cookedFood !== true)
    patch["flags." + NS + ".cookedFood"] = true;
  const uses = item.system?.uses ?? {};
  if (Number(uses.max ?? 0) !== 1) patch["system.uses.max"] = "1";
  if (uses.autoDestroy !== true) patch["system.uses.autoDestroy"] = true;
  if (uses.prompt !== false) patch["system.uses.prompt"] = false;
  const raw = item.toObject?.()?.system?.activities ?? {};
  // Previous releases injected "Съесть". Remove that *only*.
  // Preserve all user-created actions including an existing "Использовать".
  const remaining = Object.keys(raw).filter(id => id !== FOOD_ACTIVITY_ID);
  if (!remaining.length) {
    patch["system.activities." + USE_ACTIVITY_ID] = nativeUseActivity();
  }
  if (raw[FOOD_ACTIVITY_ID]) {
    patch["system.activities.-=" + FOOD_ACTIVITY_ID] = null;
  }
  if (!Object.keys(patch).length) return false;
  await item.update(patch);
  return true;
}

/**
 * One-time cleanup for active food buffs created by earlier module versions.
 * Do not reroll their old HP totals or interfere with any effect mechanics:
 * newly consumed roast portions use 1d4+2; prior active effects keep their HP
 * until normal replacement/rest.
 */
async function cleanLegacyFoodEffectDescriptions() {
  if (!game.user?.isGM) return;
  for (const actor of game.actors?.contents ?? []) {
    for (const effect of actor.effects ?? []) {
      if (effect.flags?.[NS]?.foodBuff !== true) continue;
      const previous = String(effect.description ?? "");
      const cleaned = previous.replace(
        " Любая другая еда или вересковая медовуха заменяет этот бафф.", ""
      );
      const patch = {};
      if (cleaned !== previous) patch.description = cleaned;
      if (isOldBundledMealIcon(effect.img)) patch.img = DEFAULT_MEAL_ICON;
      if (Object.keys(patch).length) await effect.update(patch);
    }
  }
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
  await cleanLegacyFoodEffectDescriptions();
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

/** Create all beer templates once, without duplicates. */
export async function installBeerItems() {
  if (!game.user?.isGM) throw new Error("Создание пива доступно только ГМ.");
  const world = game.items?.contents ?? [];
  const actors = game.actors?.contents ?? [];
  for (const item of [...world, ...actors.flatMap(actor => actor.items?.contents ?? [])]) {
    if (foodDefinition(item)?.beer) await repairFoodItem(item);
  }
  const existing = new Set(world.map(item => foodDefinition(item)?.id).filter(Boolean));
  const missing = BEERS.filter(beer => !existing.has(beer.id));
  if (!missing.length) return [];
  return Item.createDocuments(missing.map(makeItem));
}
export const listBeerItems = () => BEERS.map(beer => ({
  identifier: beer.id, name: beer.name, buff: beer.buff, effect: beer.effect,
  description: beer.description, recipeDc: beer.dc, batchYield: beer.batch,
  batchCostCp: beer.batchCp, recipePriceGp: beer.recipeGp,
  priceSp: beer.portionSp, weight: beer.weight, img: foodIcon(beer),
  ingredients: [...beer.components]
}));


// Profession bonuses are consumed by the real LipatoS-professions module
// from the actor effect's professionBonuses flag at roll time. Never mutate
// character proficiency flags or invent dnd5e skill keys.
async function applyFood(actor, item, food) {
  if (!actor?.isOwner) return false;
  // Roll temporary HP using Foundry's dice engine (and show the roll in chat),
  // just like "Вересковая медовуха". Roll once per actual meal use.
  let grantedTemp = 0;
  if (food.tempHpFormula) {
    const roll = await new Roll(food.tempHpFormula).evaluate();
    grantedTemp = Number(roll.total);
    if (!Number.isFinite(grantedTemp) || grantedTemp < 0)
      throw new Error("Некорректный результат броска временных хитов: " + food.tempHpFormula);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: food.name + " — " + food.buff + " (временные хиты)"
    });
  }
  // A new meal still replaces the old food or heather-mead Active Effect.
  await replaceMealEffects(actor, food.beer ? "drink" : "food");
  const oldTemp = Number(actor.system?.attributes?.hp?.temp ?? 0);
  const newTemp = food.tempHpFormula ? Math.max(oldTemp, grantedTemp) : oldTemp;
  const flags = { foodBuff: true, foodIdentifier: food.id,
    mealChannel: food.beer ? "drink" : "food", rerollSpent: false,
    professionBonuses: food.professionBonuses ?? [],
    grantedTemporaryHp: grantedTemp,
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
  if (food.tempHpFormula && newTemp !== oldTemp) {
    await actor.update({ "system.attributes.hp.temp": newTemp });
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [effect]);
  if (food.beer) {
    // As with heather mead, drinking one bottle returns an empty bottle.
    // Reuse its existing item-template and inventory-stack handling.
    try {
      await game.modules.get(NS)?.api?.giveHeatherEmptyBottle?.(actor);
    } catch (error) {
      console.warn(NS + " | Не удалось вернуть бутылку из-под пива", error);
    }
  } else {
    // Solid meals count as eating for the Hunger subsystem; beer does not.
    try { await game.modules.get(NS)?.api?.feed?.(actor); }
    catch (error) { console.warn(NS + " | Не удалось учесть еду для голода", error); }
  }
  return true;
}

/**
 * This is the only entry point that may grant crafted meal buffs.
 * It is called by LipatoS Item Move Stack's right-click "Использовать".
 * Quantity changes and deletion alone are never evidence of consumption.
 */
export async function useMealFromContext(item) {
  const actor = item?.parent?.documentName === "Actor" ? item.parent : item?.actor;
  const food = foodDefinition(item);
  if (!food || actor?.documentName !== "Actor" || !actor.isOwner || !item?.id) return false;

  // Serialize both use and subsequent item writes for this actor. A double
  // click cannot eat the same final portion twice.
  return workFor(actor, async () => {
    const owned = actor.items?.get?.(item.id);
    const currentFood = foodDefinition(owned);
    const qty = Number(owned?.system?.quantity ?? 0);
    if (!currentFood || !Number.isSafeInteger(qty) || qty < 1) {
      ui.notifications?.warn?.("Блюдо уже отсутствует в инвентаре.");
      return false;
    }

    // Spend exactly one portion of either a single item or a crafted stack.
    // Other modules see a normal deletion/update, never an item use.
    if (qty > 1) {
      await owned.update({ "system.quantity": qty - 1, "system.uses.spent": 0 },
        { lipatosSkipMealBuff: true });
    } else {
      await owned.delete({ lipatosSkipMealBuff: true });
    }

    const applied = await applyFood(actor, owned, currentFood);
    if (applied) {
      auditFood("used:context-menu", actor, owned, currentFood.buff);
      console.info(NS + " | Употреблено через ПКМ: " + currentFood.name);
    }
    return Boolean(applied);
  }).catch(error => {
    console.error(NS + " | Ошибка употребления еды через ПКМ", error);
    ui.notifications?.error?.("Не удалось употребить блюдо (F12).");
    return false;
  });
}

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
    ...(module.api ?? {}), listFoodItems: listFood, listBeerItems,
    installFoodItems, installBeerItems, rerollFoodStealth: rerollStealth,
    isMealItem: item => Boolean(foodDefinition(item)),
    useMealFromContext,
    recentFoodEvents: () => foodAudit.slice()
  };
  if (game.user?.isGM && firstGM()?.id === game.user.id) {
    void (async () => {
      const createdFood = await installFoodItems();
      const createdBeers = await installBeerItems();
      if (createdFood.length || createdBeers.length) ui.notifications?.info?.(
        "LipatoS: создано " + createdFood.length + " блюд и " +
        createdBeers.length + " сортов пива в «Предметах мира»."
      );
    })().catch(error => console.error(NS + " | Ошибка установки еды и пива", error));
  }
});
