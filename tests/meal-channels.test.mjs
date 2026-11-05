import test from "node:test";
import assert from "node:assert/strict";

import { mealEffectChannel, isMealEffect, replaceMealEffects } from "../scripts/meal-shared.mjs";

const NS = "lipatos-buffs-debuffs";
const UNIQUE = "lipatos-aindor-unique-items";
const mk = (id, data, scope = NS) => ({ id, flags: { [scope]: data } });

function actorWith(...effects) {
  const actor = {
    effects: [...effects],
    system: { attributes: { hp: { temp: 0 } } },
    deleted: [],
    async deleteEmbeddedDocuments(kind, ids) {
      assert.equal(kind, "ActiveEffect");
      this.deleted.push(...ids);
      this.effects.splice(0, this.effects.length,
        ...this.effects.filter(x => !ids.includes(x.id)));
    },
    async update(patch) {
      this.system.attributes.hp.temp = patch["system.attributes.hp.temp"];
    }
  };
  actor.effects.get = id => actor.effects.find(x => x.id === id);
  return actor;
}

test("old beer buffs, new food/drink buffs and either heather module are classified correctly", () => {
  const effects = [
    mk("newBeer", { foodBuff: true, foodIdentifier: "pancirnyy-el", mealChannel: "drink" }),
    mk("oldBeer", { foodBuff: true, foodIdentifier: "shalfejnyj-el" }),
    mk("newFood", { foodBuff: true, foodIdentifier: "onigiri", mealChannel: "food" }),
    mk("oldFood", { foodBuff: true, foodIdentifier: "zharkoe-iz-dikogo-kabana" }),
    mk("mead", { heatherWarmth: true }),
    mk("uniqueMead", { heatherWarmth: true }, UNIQUE),
    mk("spell", { someOtherBuff: true })
  ];
  assert.deepEqual(effects.map(mealEffectChannel),
    ["drink", "drink", "food", "food", "drink", "drink", null]);
  assert.deepEqual(effects.map(isMealEffect), [true,true,true,true,true,true,false]);
});

test("replacing food keeps both old beer and mead while clearing only food", async () => {
  const a = actorWith(
    mk("food", { foodBuff: true, foodIdentifier: "zharkoe-iz-dikogo-kabana" }),
    mk("beer", { foodBuff: true, foodIdentifier: "pancirnyy-el" }),
    mk("mead", { heatherWarmth: true }, UNIQUE),
    mk("spell", { other: true })
  );
  await replaceMealEffects(a, "food");
  assert.deepEqual(a.deleted, ["food"]);
  assert.deepEqual(a.effects.map(e => e.id), ["beer", "mead", "spell"]);
});

test("replacing drink keeps food and spells, removes legacy beer + mead", async () => {
  const a = actorWith(
    mk("food", { foodBuff: true, foodIdentifier: "onigiri", mealChannel: "food" }),
    mk("beer", { foodBuff: true, foodIdentifier: "lesnoy-shepot" }),
    mk("mead", { heatherWarmth: true }),
    mk("spell", { magicalEffect: true })
  );
  await replaceMealEffects(a, "drink");
  assert.deepEqual(a.deleted, ["beer", "mead"]);
  assert.deepEqual(a.effects.map(e => e.id), ["food", "spell"]);
});

test("replacing only one channel preserves the other's temp HP attribution", async () => {
  const a = actorWith(
    mk("food", { foodBuff: true, foodIdentifier: "zharkoe-iz-dikogo-kabana",
      grantedTemporaryHp: 5, displayedTemporaryHp: 5 }),
    mk("beer", { foodBuff: true, foodIdentifier: "pancirnyy-el" })
  );
  a.system.attributes.hp.temp = 5;
  await replaceMealEffects(a, "drink");
  assert.equal(a.system.attributes.hp.temp, 5);
  assert.deepEqual(a.effects.map(x => x.id), ["food"]);
  await replaceMealEffects(a, "food");
  assert.equal(a.system.attributes.hp.temp, 0);
  assert.equal(a.effects.length, 0);
});

test("invalid channels refuse to accidentally remove all buffs", async () => {
  const a = actorWith(mk("food", { foodBuff: true, foodIdentifier: "onigiri" }));
  await assert.rejects(() => replaceMealEffects(a), /Unknown meal channel/);
  assert.equal(a.effects.length, 1);
});

// Integration: native consumption of a meal and ale with existing heather mead.
test("using food and drink retains one buff in each channel, medovukha also replaces only drinks", async () => {
  const hooks = new Map();
  globalThis.Hooks = {
    on(n, cb) { hooks.set(n, [...(hooks.get(n) ?? []), cb]); },
    once(n, cb) { hooks.set(n, [...(hooks.get(n) ?? []), cb]); }
  };
  const fire = (n,...args) => { for (const cb of hooks.get(n) ?? []) cb(...args); };
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = 4; return this; }
    async toMessage() {}
  };
  globalThis.ChatMessage = { getSpeaker: ({actor}) => ({alias:actor.uuid}) };
  const module = { active: true, api: { giveHeatherEmptyBottle: async () => {},
    feed: async () => {} } };
  globalThis.game = {
    modules: { get: () => module }, user: { isGM: false, id: "owner" },
    users: [], actors: { contents: [] }, items: { contents: [] },
    packs: [], time: { worldTime: 400 }
  };
  globalThis.ui = { notifications: { warn() {}, error(message) { throw Error(message); } } };
  let seq = 0;
  const a = actorWith();
  Object.assign(a, {
    uuid: "Actor.FoodDrink", documentName: "Actor", isOwner: true,
    items: { contents: [], get(id) { return this.contents.find(x => x.id === id) ?? null; } },
    async createEmbeddedDocuments(kind, data) {
      const docs = data.map(x=>({ ...structuredClone(x), id:"effect-"+(++seq) }));
      if(kind==="ActiveEffect") this.effects.push(...docs);
      else if(kind==="Item") this.items.contents.push(...docs);
      else throw Error("Unexpected documents");
      return docs;
    }
  });
  await import("../scripts/food.mjs");
  await import("../scripts/heather-mead.mjs");
  for (const cb of hooks.get("ready") ?? []) cb();
  const settle = async () => { for(let i=0;i<35;i++) await new Promise(r=>setImmediate(r)); };
  async function eat(name) {
    const item = {
      id:"owned-"+(++seq), name, type:"consumable", actor:a, parent:a,
      uuid:a.uuid+".Item."+seq, img:"icons/svg/item-bag.svg",
      system: { identifier:"custom-crafted-id", quantity:1,
        uses:{ max:1, spent:1, autoDestroy:true } },
      async delete() { a.items.contents = a.items.contents.filter(x=>x!==this); fire("deleteItem",this,{},"owner"); }
    };
    a.items.contents.push(item);
    fire("updateItem",item,{system:{uses:{spent:1}}},{},"owner");
    await settle();
    assert.equal(a.items.get(item.id),null);
  }
  const names = () => a.effects.map(e=>e.name).sort();
  await eat("Жаркое из дикого кабана");
  assert.deepEqual(names(), ["Крепкая сытость"]);
  await eat("Панцирный эль");
  assert.deepEqual(names(), ["Багровый панцирь", "Крепкая сытость"]);
  await eat("Онигири");
  assert.deepEqual(names(), ["Багровый панцирь", "Тонкий вкус мастера"]);
  const mead = { type:"consumable", uuid:"Actor.Mead", img:"mead.webp",
    system:{identifier:"vereskovaya-medovuha"} };
  assert.equal(await module.api.applyHeatherWarmth(mead,a), true);
  assert.deepEqual(names(), ["Вересковое тепло","Тонкий вкус мастера"]);
  await eat("Шалфейный эль");
  assert.deepEqual(names(), ["Тонкий вкус мастера","Целебное чутьё"]);
  await eat("Рыбное сашими");
  assert.deepEqual(names(), ["Целебное чутьё","Чутьё рыболова"]);
  fire("dnd5e.restCompleted",a,{longRest:true},{type:"long"});
  await settle();
  assert.deepEqual(names(), []);
});
