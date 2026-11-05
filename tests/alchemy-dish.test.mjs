import test from "node:test";
import assert from "node:assert/strict";

// Integration contract with the already published LipatoS-professions v0.1.9.
test("alchemy dish matches real profession ID and is preserved by the drink slot", async () => {
  const hooks = new Map();
  globalThis.Hooks = {
    on(name, cb) { hooks.set(name, [...(hooks.get(name) ?? []), cb]); },
    once(name, cb) { hooks.set(name, [...(hooks.get(name) ?? []), cb]); }
  };
  const fire = (name,...args) => { for (const cb of hooks.get(name) ?? []) cb(...args); };
  const ns = "lipatos-buffs-debuffs";
  const bottles = [];
  const mod = { api: { feed: async () => {}, giveHeatherEmptyBottle: async actor => bottles.push(actor.uuid) } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    items: { contents: [] }, actors: { contents: [] },
    modules: { get: () => mod }, time: { worldTime: 500 }
  };
  globalThis.ui = { notifications: { info() {}, error(message) { throw Error(message); } } };
  globalThis.Item = { createDocuments: async data => {
    const docs = data.map((d,i) => ({ ...structuredClone(d), id: "world-"+i }));
    game.items.contents.push(...docs);
    return docs;
  }};
  const food = await import("../scripts/food.mjs");
  const created = await food.installFoodItems();
  const dish = created.find(d => d.system.identifier === "zhemchuzhnye-gnezda-dlinnousov");
  assert.ok(dish);
  assert.deepEqual(dish.flags[ns].professionBonuses, ["alchemy"]);
  assert.equal(dish.img, "icons/svg/item-bag.svg");
  const ale = (await food.installBeerItems()).find(d => d.system.identifier === "pancirnyy-el");
  assert.ok(ale);

  let ix = 0;
  const actor = {
    uuid: "Actor.Alchemy", documentName: "Actor", isOwner: true,
    effects: [], system: { attributes: { hp: { temp: 0 } } },
    items: { contents: [], get(id) { return this.contents.find(x => x.id === id) ?? null; } },
    async createEmbeddedDocuments(type, docs) {
      assert.equal(type, "ActiveEffect");
      const list = docs.map(d => ({ ...structuredClone(d), id: "effect-"+(++ix) }));
      this.effects.push(...list);
      return list;
    },
    async deleteEmbeddedDocuments(type, ids) {
      this.effects.splice(0,this.effects.length,...this.effects.filter(e => !ids.includes(e.id)));
    }
  };
  actor.effects.get = id => actor.effects.find(e => e.id === id);
  const settle = async () => { for(let i=0;i<30;i++) await new Promise(resolve=>setImmediate(resolve)); };
  async function consume(template) {
    const source = {
      ...structuredClone(template), actor, parent:actor,
      id:"owned-"+(++ix), uuid:actor.uuid+".Item."+ix,
      async delete() {
        actor.items.contents=actor.items.contents.filter(x=>x.id!==this.id);
        fire("deleteItem",this,{},"gm");
      }
    };
    actor.items.contents.push(source);
    source.system.uses.spent=1;
    fire("updateItem",source,{system:{uses:{spent:1}}},{},"gm");
    await settle();
  }
  await consume(dish);
  assert.deepEqual(actor.effects.map(e=>e.name),["Чуткость алхимика"]);
  const matching = actor.effects.filter(e => !e.disabled &&
    e.flags[ns]?.foodBuff === true &&
    e.flags[ns].professionBonuses?.includes("alchemy"));
  assert.equal(matching.length,1);
  await consume(ale);
  assert.deepEqual(actor.effects.map(e=>e.name).sort(),["Багровый панцирь","Чуткость алхимика"]);
  assert.equal(bottles.length,1);
  await consume(dish);
  assert.deepEqual(actor.effects.map(e=>e.name).sort(),["Багровый панцирь","Чуткость алхимика"],
    "repeating the dish does not stack its bonus or remove the ale buff");
  fire("dnd5e.restCompleted",actor,{longRest:true},{type:"long"});
  await settle();
  assert.equal(actor.effects.length,0,"long rest clears food and ale buffs");
});
