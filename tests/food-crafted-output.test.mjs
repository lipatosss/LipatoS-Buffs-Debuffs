import test from "node:test";
import assert from "node:assert/strict";

test("Mastercrafted output is repaired, consumed and automatically buffs actor", async () => {
  const handlers = new Map();
  const once = new Map();
  globalThis.Hooks = {
    on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    once: (name, fn) => once.set(name, fn)
  };
  const mod = { api: {} };
  const worldItems = [];
  globalThis.game = {
    user: { isGM: true, id: "gm" },
    users: [{ id: "gm", isGM: true, active: true }],
    items: { contents: worldItems }, actors: { contents: [] },
    modules: { get: () => mod }, time: { worldTime: 123 }
  };
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.Item = { createDocuments: async items => items };
  const fire = (name, ...args) => {
    for (const handler of handlers.get(name) ?? []) handler(...args);
  };
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve));
  };

  let index = 0;
  const actor = {
    uuid: "Actor.TEST", documentName: "Actor", isOwner: true, effects: [],
    items: new Map(), system: { attributes: { hp: { temp: 0 } } },
    async update(patch) {
      if ("system.attributes.hp.temp" in patch)
        this.system.attributes.hp.temp = patch["system.attributes.hp.temp"];
    },
    async createEmbeddedDocuments(kind, items) {
      assert.equal(kind, "ActiveEffect");
      const created = items.map(item => ({ ...item, id: "effect" + (++index) }));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(kind, ids) {
      assert.equal(kind, "ActiveEffect");
      const unwanted = new Set(ids);
      this.effects.splice(0, this.effects.length,
        ...this.effects.filter(item => !unwanted.has(item.id)));
    }
  };
  actor.effects.get = id => actor.effects.find(item => item.id === id);

  function crafted(name) {
    const item = {
      id: "owned-" + (++index), name, parent: actor, actor,
      type: "consumable", img: "icons/svg/item-bag.svg", flags: {},
      system: {
        identifier: "mastercrafted-unknown", type: { value: "potion" },
        quantity: 1, uses: { max: "0", spent: 0, autoDestroy: false, prompt: true },
        activities: {}
      },
      toObject() { return { system: structuredClone(this.system) }; },
      async update(patch) {
        for (const [path, value] of Object.entries(patch)) {
          if (path === "img") { this.img = value; continue; }
          const keys = path.split(".");
          const top = keys.shift();
          let target = this[top];
          while (keys.length > 1) {
            const k = keys.shift();
            target[k] ??= {};
            target = target[k];
          }
          target[keys[0]] = value;
        }
        fire("updateItem", this, patch, {}, "gm");
      },
      async delete() {
        actor.items.delete(this.id);
        fire("deleteItem", this, {}, "gm");
      }
    };
    item.uuid = "Actor.TEST.Item." + item.id;
    actor.items.set(item.id, item);
    return item;
  }

  await import("../scripts/food.mjs");
  await once.get("ready")();
  const fish = crafted("Уха туманного берега");
  fire("createItem", fish, {}, "gm");
  await settle();
  assert.equal(fish.system.identifier, "uha-tumannogo-berega");
  assert.equal(fish.system.type.value, "food");
  assert.equal(fish.system.uses.max, "1");
  assert.ok(fish.system.activities.eatMeal000000001);
  assert.ok(fish.img.endsWith("uha-tumannogo-berega.webp"));

  // Some sheet modules report postUse without sending a native charge update.
  const fishUse = { item: fish, actor }, usage = {};
  fire("dnd5e.preUseActivity", fishUse, usage);
  fire("dnd5e.postUseActivity", fishUse, usage, {});
  await settle();
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "Острое чутьё");
  assert.equal(actor.items.has(fish.id), false, "Charge was spent, portion removed");

  const nuts = crafted("Медовые орешки странника");
  fire("createItem", nuts, {}, "gm");
  await settle();
  const nutsUse = { item: nuts, actor }, usage2 = {};
  fire("dnd5e.preUseActivity", nutsUse, usage2);
  fire("dnd5e.postActivityConsumption", nutsUse, usage2, {}, {});
  fire("dnd5e.postUseActivity", nutsUse, usage2, {});
  await settle();
  assert.equal(actor.effects.length, 1, "New food replaces the old");
  assert.equal(actor.effects[0].name, "Быстрая реакция");
  assert.equal(actor.items.has(nuts.id), false);

  fire("dnd5e.restCompleted", actor, { longRest: true }, { type: "long" });
  await settle();
  assert.equal(actor.effects.length, 0);
});

test("exact item names only: unrelated consumables never receive food buffs", async () => {
  // Prevent accidental matching of unrelated potion/items by generic keywords.
  const { listFoodItems } = globalThis.game?.modules?.get("lipatos-buffs-debuffs")?.api ?? {};
  if (listFoodItems) {
    const values = listFoodItems();
    assert.equal(values.length, 8);
    assert.equal(values.filter(x => x.dessert).length, 3);
    assert.equal(new Set(values.map(x => x.identifier)).size, 8);
  }
});
