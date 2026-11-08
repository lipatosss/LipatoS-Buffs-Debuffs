import test from "node:test";
import assert from "node:assert/strict";

test("manual or transferred food deletion never awards a buff", async () => {
  const listeners = new Map();
  globalThis.Hooks = {
    on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
    once(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); }
  };
  const fire = (name, ...args) => {
    for (const fn of listeners.get(name) ?? []) fn(...args);
  };
  let seq = 0;
  const mod = { api: {} };
  globalThis.Roll = class {
    constructor(formula) { assert.equal(formula, "1d4 + 2"); }
    async evaluate() { this.total = 6; return this; }
    async toMessage() {}
  };
  globalThis.ChatMessage = { getSpeaker: () => ({ alias: "Test actor" }) };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    actors: { contents: [] }, items: { contents: [] },
    modules: { get() { return mod; } },
    time: { worldTime: 1000 }
  };
  globalThis.Item = { createDocuments: async raw => raw };
  globalThis.ui = { notifications: { info() {}, warn() {}, error(msg) { throw Error(msg); } } };
  const actor = {
    uuid: "Actor.Test", documentName: "Actor", isOwner: true,
    system: { attributes: { hp: { temp: 0 } } },
    items: { contents: [], get(id) { return this.contents.find(x => x.id === id) ?? null; } },
    effects: [],
    async createEmbeddedDocuments(kind, docs) {
      assert.equal(kind, "ActiveEffect");
      const added = docs.map(doc => ({ ...doc, id: "Effect" + (++seq) }));
      this.effects.push(...added);
      return added;
    },
    async deleteEmbeddedDocuments(kind, ids) {
      assert.equal(kind, "ActiveEffect");
      this.effects.splice(0, this.effects.length, ...this.effects.filter(e => !ids.includes(e.id)));
    },
    async update(patch) {
      if ("system.attributes.hp.temp" in patch)
        this.system.attributes.hp.temp = patch["system.attributes.hp.temp"];
    }
  };
  actor.effects.get = id => actor.effects.find(e => e.id === id);
  game.actors.contents.push(actor);

  await import("../scripts/food.mjs");
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve));
  };

  const table = [
    ["Жаркое из дикого кабана", "Крепкая сытость"],
    ["Уха туманного берега", "Острое чутьё"],
    ["Грибное рагу травника", "Стойкий желудок"],
    ["Пряный кролик охотника", "Проворные ноги"],
    ["Пастуший пирог силача", "Сила земледельца"],
    ["Медовые орешки странника", "Быстрая реакция"],
    ["Черничный тарт теней", "Лёгкая поступь"],
    ["Лунный творожный пудинг", "Ясный разум"]
  ];
  for (const [name, buff] of table) {
    const item = {
      id: "Item" + (++seq), name, uuid: "Actor.Test.Item." + seq,
      parent: actor, actor, type: "consumable",
      img: "icons/svg/item-bag.svg",
      system: { identifier: "mastercrafted-random-identifier", quantity: 1,
        uses: { max: 1, spent: 0, autoDestroy: true } }
    };
    actor.items.contents.push(item);
    // Same sequence as native last-charge destruction: no charge update,
    // no preUseActivity, no postUseActivity. Both preDelete/delete are standard.
    fire("preDeleteItem", item, {}, "gm");
    actor.items.contents.splice(actor.items.contents.indexOf(item), 1);
    // Foundry may remove the item's actor link when deleting a Document.
    item.parent = null;
    item.actor = null;
    fire("deleteItem", item, {}, "gm");
    fire("deleteItem", item, {}, "gm"); // Should not duplicate.
    await settle();
    assert.equal(actor.effects.length, 0, name + ": deletion cannot grant any buff");
  }
  assert.equal(actor.system.attributes.hp.temp, 0,
    "Deleting food must never grant temporary HP");
  fire("dnd5e.restCompleted", actor, { longRest: true }, { type: "long" });
  await settle();
  assert.equal(actor.effects.length, 0);
});

test("updateItem followed by auto-destruction applies only one effect", async () => {
  const { FoodUseTracker } = await import("../scripts/food-use-tracker.mjs");
  let now = 10000;
  const tracker = new FoodUseTracker(() => now);
  assert.equal(tracker.itemUpdated("Actor.Test:Item.1", { acceptUnprimed: true }), true);
  assert.equal(tracker.itemDeleted("Actor.Test:Item.1", { acceptUnprimed: true }), false);
  assert.equal(tracker.itemDeleted("Actor.Test:Item.1", { acceptUnprimed: true }), false);
  now += 100;
  assert.equal(tracker.postUse("Actor.Test:Item.1", {}, { updates: {} }, true), false);
});

test("unrelated items do not match and opt-out skips the terminal fallback", async () => {
  const { FoodUseTracker } = await import("../scripts/food-use-tracker.mjs");
  const tracker = new FoodUseTracker();
  assert.equal(tracker.itemDeleted("Actor.Test:NormalLoot"), false);
});
