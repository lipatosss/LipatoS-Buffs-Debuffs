import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function setup() {
  const hooks = new Map();
  const effects = [];
  effects.get = id => effects.find(effect => effect.id === id);
  const inventory = new Map();
  const flaskTemplate = {
    _id: "gcZIt59eKbVeeASi", id: "gcZIt59eKbVeeASi",
    documentName: "Item", name: "Небольшой флакон для зелья",
    type: "loot", img: "icons/custom-small-flask.webp",
    system: {identifier:"nebolshoi-flakon-dlya-zelia", quantity:1,
      weight:{value:0.5,units:"lb"}, price:{value:4,denomination:"sp"}},
    toObject() { return {_id:this._id,name:this.name,type:this.type,img:this.img,
      system: {...this.system}}; }
  };
  const actor = {
    uuid: "Actor.test", documentName: "Actor", isOwner: true, type: "character",
    name: "Test Hero", effects,
    system: { attributes: { hp: { value: 5, max: 10 }, encumbrance: {value: 20, max: 100, pct: 20} } },
    items: { get: id => inventory.get(id), contents: [] },
    async update(patch) {
      if (patch["system.attributes.hp.value"] !== undefined)
        this.system.attributes.hp.value = patch["system.attributes.hp.value"];
    },
    async createEmbeddedDocuments(type, entries) {
      if (type === "Item") {
        const docs = entries.map(data => ({
          ...data, id: "newitem" + (this.items.contents.length + 1),
          async update(patch) {
            if (patch["system.quantity"] !== undefined) this.system.quantity = patch["system.quantity"];
          }
        }));
        this.items.contents.push(...docs);
        for (const doc of docs) inventory.set(doc.id, doc);
        return docs;
      }
      assert.equal(type, "ActiveEffect");
      for (const data of entries) effects.push({ ...data, id: "effect" + (effects.length + 1), delete: async function() {
        const index = effects.indexOf(this); if (index >= 0) effects.splice(index, 1);
      } });
    },
    async deleteEmbeddedDocuments(type, ids) {
      for (const id of ids) { const effect = effects.get(id); if (effect) await effect.delete(); }
    }
  };
  const rolls = [];
  const messages = [];
  const module = {api: { giveHeatherEmptyBottle: async () => {} }};
  const source = fs.readFileSync("scripts/potions.mjs", "utf8");
  const ctx = vm.createContext({
    Hooks: { on: (name, callback) => hooks.set(name, callback), once: (name, callback) => hooks.set(name, callback) },
    game: { user: { id: "user", isGM: true }, users: {}, actors: { contents: [actor] },
      time: { worldTime: 100 }, modules: { get: () => module },
      items: {get: id => id === flaskTemplate.id ? flaskTemplate : null, contents:[flaskTemplate]} },
    fromUuid: async uuid => uuid === "Item.gcZIt59eKbVeeASi" ? flaskTemplate : null,
    Roll: class { constructor(formula) { this.formula = formula; this.total = 7; rolls.push(this); }
      async evaluate() { return this; } async toMessage() {} },
    ChatMessage: { getSpeaker: () => ({}), create: async m => messages.push(m) },
    ui: { notifications: {warn() {}, error() {}} },
    console, Date
  });
  vm.runInContext(source, ctx);
  return { ctx, hooks, actor, effects, inventory, rolls, messages, flaskTemplate };
}
test("healing rolls only once and caps at maximum HP", async () => {
  const t = setup();
  const apply = vm.runInContext("applyPotion", t.ctx);
  const item = { id: "p1", uuid: "Actor.test.Item.p1", name: "Зелье лечения", type:"consumable",
    system: { identifier: "zele-malogo-lecheniya", uses: {autoDestroy: false} }, img: "icons/svg/item-bag.svg" };
  await apply(t.actor, item, "zele-malogo-lecheniya");
  assert.equal(t.actor.system.attributes.hp.value, 10);
  assert.equal(t.rolls.length, 1);
  assert.equal(t.rolls[0].formula, "2d4 + 2");
  assert.equal(t.effects.length, 0);
  const flasks = t.actor.items.contents.filter(i => i.system?.identifier === "nebolshoi-flakon-dlya-zelia");
  assert.equal(flasks.length, 1);
  assert.equal(flasks[0].img, "icons/custom-small-flask.webp");
  assert.equal(flasks[0].system.price.value, 4);
  assert.equal(flasks[0].system.quantity, 1);
});
test("speed applies a timed effect and buffalo adds a distinct flagged effect", async () => {
  const t = setup();
  const apply = vm.runInContext("applyPotion", t.ctx);
  for (const id of ["zele-skorosti", "zele-buyvola"]) {
    await apply(t.actor, {id,uuid:"Actor.test.Item."+id,type:"consumable",
      name:id,system:{identifier:id,uses:{autoDestroy:false}}}, id);
  }
  assert.equal(t.effects.length, 2);
  const speed = t.effects.find(e => e.flags["lipatos-buffs-debuffs"].potionId === "zele-skorosti");
  const buffalo = t.effects.find(e => e.flags["lipatos-buffs-debuffs"].potionId === "zele-buyvola");
  assert.equal(speed.duration.seconds, 600);
  assert.equal(speed.flags["lipatos-buffs-debuffs"].expiresAt, 700);
  assert.equal(speed.changes.length, 5);
  assert.equal(buffalo.flags["lipatos-buffs-debuffs"].potionId,"zele-buyvola");
  assert.equal(buffalo.changes.length,0);
});
test("only one buff per confirmed native use, even with postUse repeating", async () => {
  const t = setup();
  const item = {id:"p1",uuid:"Actor.test.Item.p1",name:"Зелье призрачного шага",type:"consumable",
    system:{identifier:"zele-prizrachnogo-shaga",uses:{autoDestroy:false}},
    actor:t.actor,parent:t.actor};
  t.inventory.set(item.id,item);
  const activity = {item,actor:t.actor};
  t.hooks.get("dnd5e.preUseActivity")(activity);
  t.hooks.get("dnd5e.postUseActivity")(activity,{}, {});
  t.hooks.get("dnd5e.postUseActivity")(activity,{}, {});
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(t.effects.length, 1);
  assert.equal(t.effects[0].flags["lipatos-buffs-debuffs"].potionId,"zele-prizrachnogo-shaga");
});

test("each drunk potion returns only the specified small flask, stacking quantities", async () => {
  const t = setup();
  const apply = vm.runInContext("applyPotion", t.ctx);
  for (const id of ["zele-malogo-lecheniya", "zele-buyvola", "zele-skorosti"]) {
    await apply(t.actor, {id, uuid:"Actor.test.Item."+id, type:"consumable",
      name:id, system:{identifier:id, uses:{autoDestroy:false}}}, id);
  }
  const flasks = t.actor.items.contents.filter(i => i.system?.identifier === "nebolshoi-flakon-dlya-zelia");
  assert.equal(flasks.length, 1);
  assert.equal(flasks[0].system.quantity, 3);
  assert.equal(flasks[0].name, "Небольшой флакон для зелья");
  assert.equal(flasks[0].img, "icons/custom-small-flask.webp");
  assert.equal(t.actor.items.contents.some(i => i.system?.identifier === "pustaya-butylka"), false);
});
