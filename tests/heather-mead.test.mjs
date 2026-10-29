import test from "node:test";
import assert from "node:assert/strict";

// Minimal Foundry mocks exercise only the heather-mead integration contract.
const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
  once(name, fn) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); }
};
const uniqueModule = { active: true, api: {} };
const warnings = [];
const errors = [];
const bottleTemplate = {
  name: "Пустая бутылка",
  type: "loot",
  img: "custom-empty-bottle.webp",
  system: {
    identifier: "pustaya-butylka", quantity: 55,
    price: { value: 2, denomination: "sp" },
    weight: { value: 0.5, units: "lb" }
  },
  toObject() { return JSON.parse(JSON.stringify({ _id: "worldBottle", name: this.name,
    type: this.type, img: this.img, system: this.system })); }
};
globalThis.game = {
  modules: new Map([
    ["lipatos-buffs-debuffs", { active: false }],
    ["lipatos-aindor-unique-items", uniqueModule]
  ]),
  items: { contents: [bottleTemplate] },
  actors: { contents: [] },
  packs: [],
  time: { worldTime: 4500 }
};
globalThis.ui = { notifications: {
  warn(message) { warnings.push(message); },
  error(message) { errors.push(message); }
} };
globalThis.ChatMessage = { getSpeaker() { return { alias: "Tester" }; } };
let rolls = 0;
globalThis.Roll = class {
  async evaluate() { this.total = 4; rolls++; return this; }
  async toMessage() {}
};

await import("../scripts/heather-mead.mjs");
for (const callback of hooks.get("ready") ?? []) callback();

let nextId = 0;
function makeActor() {
  const actor = {
    uuid: "Actor." + ++nextId,
    documentName: "Actor",
    isOwner: true,
    system: { attributes: { hp: { temp: 0 } } },
    effects: [],
    items: {
      contents: [],
      get(id) { return this.contents.find(item => item.id === id) ?? null; }
    },
    async update(changes) {
      if (changes["system.attributes.hp.temp"] !== undefined)
        this.system.attributes.hp.temp = changes["system.attributes.hp.temp"];
    },
    async createEmbeddedDocuments(type, entries) {
      return entries.map(entry => {
        const item = { ...structuredClone(entry), id: "embedded" + ++nextId,
          async update(changes) {
            if (changes["system.quantity"] !== undefined)
              this.system.quantity = changes["system.quantity"];
          }
        };
        if (type === "Item") actor.items.contents.push(item);
        else if (type === "ActiveEffect") actor.effects.push(item);
        else throw Error("Unexpected document type: " + type);
        return item;
      });
    }
  };
  actor.effects.get = id => actor.effects.find(effect => effect.id === id);
  return actor;
}
async function waitFor(check) {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error("Did not complete post-use workflow");
}

test("bottle template preserves the exact image and price, without touching the world item", async () => {
  const actor = makeActor();
  const returned = await uniqueModule.api.giveHeatherEmptyBottle(actor);
  assert.equal(returned.img, "custom-empty-bottle.webp");
  assert.equal(returned.type, "loot");
  assert.equal(returned.system.identifier, "pustaya-butylka");
  assert.equal(returned.system.price.value, 2);
  assert.equal(returned.system.quantity, 1);
  assert.equal(bottleTemplate.system.quantity, 55);
  assert.equal(actor.items.contents.length, 1);
  await uniqueModule.api.giveHeatherEmptyBottle(actor);
  assert.equal(returned.system.quantity, 2, "adds to an existing stack");
  assert.equal(actor.items.contents.length, 1, "no duplicate row");
});

test("completed mead use creates one effect and one bottle, even after duplicate post-use hook", async () => {
  const actor = makeActor();
  const mead = {
    id: "mead", uuid: "Actor.mead", actor,
    type: "consumable", img: "original-mead.webp",
    system: { identifier: "vereskovaya-medovuha", quantity: 1, uses: { spent: 0 } },
    async delete() {
      actor.items.contents = actor.items.contents.filter(entry => entry !== mead);
    }
  };
  actor.items.contents.push(mead);
  const activity = { actor, item: mead };
  for (const fn of hooks.get("dnd5e.preUseActivity") ?? []) fn(activity);
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? []) fn(activity, {}, {});
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? []) fn(activity, {}, {});
  await waitFor(() => actor.items.contents.some(item => item.system.identifier === "pustaya-butylka"));
  assert.equal(rolls, 1, "one native roll");
  assert.equal(actor.system.attributes.hp.temp, 4);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "Вересковое тепло");
  assert.equal(actor.effects[0].img, "original-mead.webp");
  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.items.contents[0].system.quantity, 1);
  assert.equal(errors.length, 0, errors.join(", "));
});

test("cancelled activity does not return a bottle", async () => {
  const actor = makeActor();
  const mead = { id: "cancelled-mead", actor,
    type: "consumable", system: { identifier: "vereskovaya-medovuha", quantity: 1 } };
  actor.items.contents.push(mead);
  const activity = { actor, item: mead };
  for (const fn of hooks.get("dnd5e.preUseActivity") ?? []) fn(activity);
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? []) fn(activity, {}, false);
  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.effects.length, 0);
  assert.equal(warnings.length, 0);
});
