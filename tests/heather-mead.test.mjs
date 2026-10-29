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
  time: { worldTime: 4500 },
  user: { id: "tester" }
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

test("D&D5e 6.x cloned activity: one successful use rolls, applies effect and returns a bottle", async () => {
  const actor = makeActor();
  const mead = {
    id: "mead", uuid: "Actor.mead", actor,
    type: "consumable", img: "original-mead.webp",
    // The system already spent the charge before postUseActivity runs.
    system: { identifier: "vereskovaya-medovuha", quantity: 1,
      uses: { max: 1, spent: 1, autoDestroy: true } },
    async delete() {
      actor.items.contents = actor.items.contents.filter(entry => entry !== mead);
    }
  };
  actor.items.contents.push(mead);
  const beforeActivity = { actor, item: { ...mead } };
  const afterActivity = { actor, item: { ...mead } };
  assert.notEqual(beforeActivity, afterActivity);
  // Each user activity is cloned at least once by the 6.x system.
  for (const fn of hooks.get("dnd5e.preUseActivity") ?? []) fn(beforeActivity);
  const results = { updates: {} };
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? []) fn(afterActivity, {}, results);
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? []) fn(afterActivity, {}, results);
  await waitFor(() => actor.items.contents.some(item => item.system.identifier === "pustaya-butylka"));
  assert.equal(rolls, 1, "one native roll even if the same results object repeats");
  assert.equal(actor.system.attributes.hp.temp, 4);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "Вересковое тепло");
  assert.equal(actor.effects[0].img, "original-mead.webp");
  assert.equal(actor.items.contents.length, 1, "consumed filled bottle is deleted");
  assert.equal(actor.items.contents[0].system.quantity, 1);
  assert.equal(errors.length, 0, errors.join(", "));
});

test("two-bottle stack spends only one and resets limited uses for the next", async () => {
  const actor = makeActor();
  const mead = {
    id: "stacked-mead", uuid: "Actor.stackedMead", actor,
    type: "consumable", img: "original-mead.webp",
    system: { identifier: "vereskovaya-medovuha", quantity: 2,
      uses: { max: 1, spent: 1, autoDestroy: true } },
    async update(changes) {
      if (changes["system.quantity"] !== undefined) this.system.quantity = changes["system.quantity"];
      if (changes["system.uses.spent"] !== undefined) this.system.uses.spent = changes["system.uses.spent"];
    },
    async delete() { throw Error("Should not delete whole stack"); }
  };
  actor.items.contents.push(mead);
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? [])
    fn({ actor, item: { ...mead } }, {}, { updates: {} });
  await waitFor(() => actor.items.contents.some(item => item.system.identifier === "pustaya-butylka"));
  assert.equal(mead.system.quantity, 1);
  assert.equal(mead.system.uses.spent, 0);
  assert.equal(actor.items.contents.length, 2);
});

test("native auto-destruction before post-use still returns a bottle", async () => {
  const actor = makeActor();
  const source = { id: "native-removed", uuid: "Actor.nativeRemoved", actor,
    type: "consumable", img: "original-mead.webp",
    system: { identifier: "vereskovaya-medovuha", quantity: 1, uses: { spent: 1, max: 1, autoDestroy: true } } };
  // The dnd5e system has already deleted this item, but the activity clone survives.
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? [])
    fn({ actor, item: source }, {}, { updates: {} });
  await waitFor(() => actor.items.contents.some(item => item.system.identifier === "pustaya-butylka"));
  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.effects.length, 1);
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


test("resource update hook applies mead even when dnd5e.postUseActivity is absent", async () => {
  const actor = makeActor();
  const beforeRolls = rolls;
  const mead = {
    id: "resource-mead", uuid: "Actor.resource", actor,
    parent: actor, type: "consumable", img: "original-mead.webp",
    system: { identifier: "vereskovaya-medovuha", quantity: 1,
      uses: { max: 1, spent: 1, autoDestroy: true } },
    async delete() {
      actor.items.contents = actor.items.contents.filter(entry => entry !== mead);
      for (const fn of hooks.get("deleteItem") ?? [])
        fn(mead, {}, "tester");
    }
  };
  actor.items.contents.push(mead);
  for (const fn of hooks.get("updateItem") ?? [])
    fn(mead, { system: { uses: { spent: 1 } } }, {}, "tester");
  await waitFor(() => actor.items.contents.some(entry =>
    entry.system.identifier === "pustaya-butylka"));
  assert.equal(rolls, beforeRolls + 1);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.items.contents[0].system.identifier, "pustaya-butylka");
});

test("a late postUseActivity after resource update cannot double the bottle", async () => {
  const actor = makeActor();
  const mead = {
    id: "double-mead", uuid: "Actor.doubleMead", actor,
    parent: actor, type: "consumable", img: "original-mead.webp",
    system: { identifier: "vereskovaya-medovuha", quantity: 1,
      uses: { max: 1, spent: 1, autoDestroy: true } },
    async delete() {
      actor.items.contents = actor.items.contents.filter(entry => entry !== mead);
    }
  };
  actor.items.contents.push(mead);
  for (const fn of hooks.get("updateItem") ?? [])
    fn(mead, { "system.uses.spent": 1 }, {}, "tester");
  await waitFor(() => actor.items.contents.some(entry =>
    entry.system.identifier === "pustaya-butylka"));
  for (const fn of hooks.get("dnd5e.postUseActivity") ?? [])
    fn({ actor, item: mead }, {}, { updates: {} });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.items.contents[0].system.quantity, 1);
  assert.equal(actor.effects.length, 1);
});

test("resetting a charge and editing unrelated item data never grants bottle", async () => {
  const actor = makeActor();
  const mead = {
    id: "reset-mead", parent: actor, type: "consumable",
    system: { identifier: "vereskovaya-medovuha", quantity: 1,
      uses: { spent: 0, max: 1, autoDestroy: true } }
  };
  actor.items.contents.push(mead);
  for (const fn of hooks.get("updateItem") ?? []) {
    fn(mead, { "system.uses.spent": 0 }, {}, "tester");
    fn(mead, { "system.quantity": 5 }, {}, "tester");
  }
  assert.equal(actor.effects.length, 0);
  assert.equal(actor.items.contents.length, 1);
});
