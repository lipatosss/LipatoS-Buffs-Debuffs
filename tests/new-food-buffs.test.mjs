import test from "node:test";
import assert from "node:assert/strict";

test("new consumables carry exact buff keys and expose real profession bonuses", async () => {
  const hookCallbacks = new Map();
  globalThis.Hooks = {
    on(event, callback) { hookCallbacks.set(event, [...(hookCallbacks.get(event) ?? []), callback]); },
    once(event, callback) { hookCallbacks.set(event, [...(hookCallbacks.get(event) ?? []), callback]); }
  };
  const items = [], returned = [], warnings = [];
  const module = { api: { feed: async () => {}, giveHeatherEmptyBottle: async actor => returned.push(actor.uuid) } };
  globalThis.game = {
    user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }],
    modules: { get: () => module }, actors: { contents: [] },
    items: { contents: items }, time: { worldTime: 100 },
    i18n: { localize: name => name }
  };
  globalThis.ui = { notifications: { info() {}, warn: message => warnings.push(message), error: message => { throw Error(message); } } };
  globalThis.CONFIG = { DND5E: {} };
  globalThis.Item = { createDocuments: async data => {
    const docs = data.map((d, i) => ({ ...structuredClone(d), id: "i-" + (items.length + i) }));
    items.push(...docs); return docs;
  }};
  const food = await import("../scripts/food.mjs");
  assert.equal((await food.installFoodItems()).length, 12);
  assert.equal((await food.installBeerItems()).length, 6);
  const newNames = ["Королевский клешняр в чесночном масле", "Рыбное сашими", "Онигири", "Панцирный эль", "Жемчужные гнёзда длинноусов"];
  for (const name of newNames) {
    const item = items.find(it => it.name === name);
    assert.ok(item, name);
    assert.equal(item.img, "icons/svg/item-bag.svg", "No bundled art");
    assert.equal(item.system.uses.autoDestroy, true);
    assert.equal(item.system.activities.useFood000000001.name, "Использовать");
    assert.match(item.system.description.value, /долгого отдыха/);
    assert.ok(item.flags["lipatos-buffs-debuffs"].ingredients.length >= 4);
  }
  const mockActor = {
    uuid: "Actor.Meals", documentName: "Actor", isOwner: true,
    system: {
      attributes: { hp: { temp: 0 } },
      skills: { fishing: { label: "Рыболовство" }, pivovar: { label: "Пивоварение" } },
      tools: { winery: { label: "Виноделие" } }
    }, effects: [],
    items: { contents: [], get(id) { return this.contents.find(it => it.id === id) ?? null; } },
    async createEmbeddedDocuments(kind, data) {
      assert.equal(kind, "ActiveEffect");
      const created = data.map((e,i) => ({ ...e, id: "e-"+(this.effects.length+i+1) }));
      this.effects.push(...created);return created;
    },
    async deleteEmbeddedDocuments(kind, ids) { this.effects.splice(0, this.effects.length, ...this.effects.filter(e=>!ids.includes(e.id))); },
    async update() {}
  };
  mockActor.effects.get = id => mockActor.effects.find(e => e.id===id);
  let sequence = 0;
  const fire = (event,...args) => { for (const cb of hookCallbacks.get(event) ?? []) cb(...args); };
  const settle = async () => { for(let i=0;i<24;i++) await new Promise(r=>setImmediate(r)); };
  for (const name of ["Панцирный эль", "Королевский клешняр в чесночном масле", "Рыбное сашими", "Онигири", "Жемчужные гнёзда длинноусов"]) {
    const template = items.find(it => it.name===name);
    const item = {
      ...template, id:"owned-"+(++sequence), actor:mockActor, parent:mockActor,
      uuid:mockActor.uuid+".Item."+sequence, system:structuredClone(template.system),
      async delete() { mockActor.items.contents = mockActor.items.contents.filter(x => x.id !== this.id); fire("deleteItem",this,{},"gm"); }
    };
    mockActor.items.contents.push(item);
    fire("dnd5e.preUseActivity", { item, actor:mockActor }, {});
    item.system.uses.spent = 1;
    fire("updateItem", item, { system: { uses: { spent: 1 } } }, {}, "gm");
    await settle();
    // One food and one drink may coexist; subsequent meals replace only food.
    assert.equal(mockActor.effects.length, name === "Панцирный эль" ? 1 : 2, name);
    const expectedBuff = {
      "Панцирный эль":"Багровый панцирь",
      "Королевский клешняр в чесночном масле":"Королевская меткость",
      "Рыбное сашими":"Чутьё рыболова",
      "Онигири":"Тонкий вкус мастера",
      "Жемчужные гнёзда длинноусов":"Чуткость алхимика"
    }[name];
    const currentBuff = mockActor.effects.find(e => e.name === expectedBuff);
    assert.ok(currentBuff, name);
    assert.equal(mockActor.effects.filter(e =>
      e.flags["lipatos-buffs-debuffs"].mealChannel === "drink").length, 1,
      "The ale buff persists while another dish is consumed");
    const keys=currentBuff.changes.map(x=>x.key);
    if(name==="Панцирный эль") assert.deepEqual(keys,["system.attributes.ac.bonus"]);
    if(name==="Королевский клешняр в чесночном масле") {
      assert.deepEqual(keys,["system.rolls.attack.mwak.bonus","system.rolls.attack.rwak.bonus"]);
    }
    if(name==="Рыбное сашими") {
      assert.deepEqual(keys, [], "Profession bonus is read from effect flags at roll time");
      assert.deepEqual(currentBuff.flags["lipatos-buffs-debuffs"].professionBonuses, ["fishing"]);
    }
    if(name==="Онигири") {
      assert.deepEqual(keys, [], "Never mutate non-existent dnd5e skill keys");
      assert.deepEqual(currentBuff.flags["lipatos-buffs-debuffs"].professionBonuses, ["brewing"]);
      assert.match(template.system.description.value, /Пивоварение и виноделие/);
    }
    if(name==="Жемчужные гнёзда длинноусов") {
      assert.deepEqual(keys, [], "Alchemy bonus is read from effect flags by LipatoS-professions");
      assert.equal(currentBuff.flags["lipatos-buffs-debuffs"].mealChannel, "food");
      assert.deepEqual(currentBuff.flags["lipatos-buffs-debuffs"].professionBonuses, ["alchemy"]);
      assert.match(template.system.description.value, /Длинноус ×4/);
      assert.match(template.system.description.value, /Чуткость алхимика/);
      assert.equal(template.system.rarity, "uncommon");
      assert.equal(template.system.price.value, 13);
      assert.equal(template.system.weight.value, 0.6);
      assert.equal(template.flags["lipatos-buffs-debuffs"].recipeDc, 13);
      assert.equal(template.flags["lipatos-buffs-debuffs"].batchYield, 2);
    }
  }
  assert.equal(returned.length,1,"Only ale returns an empty bottle");
  assert.deepEqual(warnings,[]);
  fire("dnd5e.restCompleted",mockActor,{longRest:true},{type:"long"});
  await settle();
  assert.equal(mockActor.effects.length,0);
});
