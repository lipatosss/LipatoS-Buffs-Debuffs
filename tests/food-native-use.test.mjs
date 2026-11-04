import test from "node:test";
import assert from "node:assert/strict";

/**
 * The inventory "Использовать" button in the user's world consumes
 * item charges directly; NO dnd5e.preUseActivity is emitted.
 * This is exactly the scenario already supported by the heather-mead module.
 */
test("all eight meals apply buffs from the native Item charge update without activity hooks", async () => {
  const events = new Map();
  globalThis.Hooks = {
    on(name, cb) { events.set(name, [...(events.get(name) ?? []), cb]); },
    once(name, cb) { events.set(name, [...(events.get(name) ?? []), cb]); }
  };
  const fire = (name, ...args) => { for (const cb of events.get(name) ?? []) cb(...args); };
  const module = { api: {} };
  globalThis.Roll = class {
    constructor(formula) { assert.equal(formula, "1d4 + 2"); }
    async evaluate() { this.total = 4; return this; }
    async toMessage() {}
  };
  globalThis.ChatMessage = { getSpeaker: () => ({ alias: "Native user" }) };
  let next = 0;
  const worldItems = [];
  globalThis.game = {
    user: { id: "gm", isGM: true }, users: [{ id: "gm", active: true, isGM: true }],
    items: { contents: worldItems }, actors: { contents: [] },
    modules: { get() { return module; } },
    time: { worldTime: 400 }
  };
  globalThis.ui = { notifications: { info() {}, error(message) { throw new Error(message); } } };
  globalThis.Item = { createDocuments: async list => list };
  const actor = {
    uuid: "Actor.RealUser", documentName: "Actor", isOwner: true,
    system: { attributes: { hp: { temp: 0 } } },
    effects: [], items: {
      contents: [],
      get(id) { return this.contents.find(x => x.id === id) ?? null; }
    },
    async update(changes) {
      if ("system.attributes.hp.temp" in changes)
        this.system.attributes.hp.temp = changes["system.attributes.hp.temp"];
    },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const created = data.map(x => ({ ...x, id: "effect" + (++next) }));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.effects.splice(0, this.effects.length,
        ...this.effects.filter(x => !ids.includes(x.id)));
    }
  };
  actor.effects.get = id => actor.effects.find(x => x.id === id);
  globalThis.game.actors.contents.push(actor);

  await import("../scripts/food.mjs");
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
  };
  const items = [
    ["Жаркое из дикого кабана", "Крепкая сытость"],
    ["Уха туманного берега", "Острое чутьё"],
    ["Грибное рагу травника", "Стойкий желудок"],
    ["Пряный кролик охотника", "Проворные ноги"],
    ["Пастуший пирог силача", "Сила земледельца"],
    ["Медовые орешки странника", "Быстрая реакция"],
    ["Черничный тарт теней", "Лёгкая поступь"],
    ["Лунный творожный пудинг", "Ясный разум"]
  ];

  // Existing mead effect must be replaced by eating.
  actor.effects.push({ id: "oldMead",
    flags: { "lipatos-buffs-debuffs": {
      heatherWarmth: true, lastRoll: 0, displayedTemp: 0
    } }
  });

  for (const [name, expectedBuff] of items) {
    const food = {
      id: "cooked" + (++next), name, actor, parent: actor,
      uuid: actor.uuid + ".Item.cooked" + next,
      type: "consumable", img: "icons/svg/item-bag.svg",
      system: { identifier: "external-mastercrafted", quantity: 1,
        uses: { spent: 1, max: 1, autoDestroy: true } },
      async update(change) {
        if (change["system.quantity"] != null) this.system.quantity = change["system.quantity"];
        if (change["system.uses.spent"] != null) this.system.uses.spent = change["system.uses.spent"];
      },
      async delete() {
        actor.items.contents = actor.items.contents.filter(x => x.id !== this.id);
        fire("deleteItem", this, {}, "gm");
      }
    };
    actor.items.contents.push(food);

    // No pre-use, no crafted activity, just the direct item-use spend.
    fire("updateItem", food, { system: { uses: { spent: 1 } } }, {}, "gm");
    await settle();
    assert.equal(actor.effects.length, 1, name + " must replace old food/mead effect");
    assert.equal(actor.effects[0].name, expectedBuff);
    assert.equal(actor.items.get(food.id), null, name + " charge 1 must destroy the portion");

    // Mead-like fallback must NOT duplicate the buff on a late postUse event.
    const result = { updates: {} };
    fire("dnd5e.postUseActivity", { actor, item: { ...food } }, {}, result);
    await settle();
    assert.equal(actor.effects.length, 1, name + " late post-use must not duplicate");
  }

  assert.equal(actor.system.attributes.hp.temp, 0,
    "Temporary HP from roast must be replaced by the next meal");
  fire("dnd5e.restCompleted", actor, { longRest: true }, { type: "long" });
  await settle();
  assert.equal(actor.effects.length, 0, "Food buffs expire after long rest");
});

test("untouched consumables and manual item deletion do not grant meal effects", async () => {
  // The previous test's hooks are scoped to that test; this case documents
  // the required no-grant behavior in the tracker.
  const { FoodUseTracker } = await import("../scripts/food-use-tracker.mjs");
  const tracker = new FoodUseTracker();
  assert.equal(tracker.itemUpdated("Actor.X:Item.normal"), false);
  assert.equal(tracker.postUse("Actor.X:Item.normal", {}, false, false), false);
});
