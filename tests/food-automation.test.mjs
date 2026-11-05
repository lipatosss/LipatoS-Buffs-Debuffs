import test from "node:test";
import assert from "node:assert/strict";

test("Foundry food hooks apply real actor effects exactly once, replace buffs and expire on rest", async () => {
  const handlers = new Map();
  const once = new Map();
  globalThis.Hooks = {
    on: (event, callback) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(callback);
    },
    once: (event, callback) => once.set(event, callback)
  };
  const mod = { api: {} };
  const rolls = [], chatMessages = [];
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; rolls.push(formula); }
    async evaluate() { this.total = 5; return this; }
    async toMessage(message) { chatMessages.push(message); }
  };
  globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ alias: actor.uuid }) };
  const docs = [];
  let sequence = 0;
  globalThis.game = {
    system: { id: "dnd5e" }, user: { id: "gm", isGM: true },
    users: [{ id: "gm", active: true, isGM: true }],
    actors: { contents: [] }, items: { contents: docs },
    modules: { get: () => mod }, time: { worldTime: 30 }
  };
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.Item = {
    createDocuments: async data => {
      const created = data.map(raw => {
        const document = {
          ...structuredClone(raw), id: "world-" + (++sequence),
          toObject() { return { system: structuredClone(this.system) }; },
          async update(patch) {
            for (const [k, v] of Object.entries(patch)) {
              if (k === "img") this.img = v;
              else if (k === "system.uses.max") this.system.uses.max = v;
              else if (k === "system.uses.autoDestroy") this.system.uses.autoDestroy = v;
              else if (k.startsWith("system.activities."))
                this.system.activities[k.slice("system.activities.".length)] = v;
            }
          }
        };
        docs.push(document);
        return document;
      });
      return created;
    }
  };
  await import("../scripts/food.mjs");
  await once.get("ready")();
  await mod.api.installFoodItems();
  // Ready now installs twelve meals plus six brewed ales.
  for (let i = 0; i < 10 && docs.length < 18; i++)
    await new Promise(resolve => setImmediate(resolve));
  assert.equal(docs.length, 18);
  const actor = {
    uuid: "Actor.Player1", documentName: "Actor", isOwner: true,
    items: new Map(), effects: [], system: { attributes: { hp: { temp: 0 } } },
    async createEmbeddedDocuments(kind, sources) {
      if (kind !== "ActiveEffect") throw Error("Unexpected embedded type");
      const created = sources.map(source => ({ ...source, id: "effect-" + (++sequence), flags: structuredClone(source.flags) }));
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(kind, ids) {
      if (kind !== "ActiveEffect") throw Error("Unexpected embedded type");
      for (const id of ids) {
        const index = this.effects.findIndex(effect => effect.id === id);
        if (index >= 0) this.effects.splice(index, 1);
      }
    },
    async update(patch) {
      if ("system.attributes.hp.temp" in patch) this.system.attributes.hp.temp = patch["system.attributes.hp.temp"];
    }
  };
  actor.effects.get = id => actor.effects.find(effect => effect.id === id);
  const fire = (event, ...args) => {
    for (const callback of handlers.get(event) ?? []) callback(...args);
  };
  const settle = async () => {
    // applyFood, replaceMealEffects and workFor each contain asynchronous stages
    for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve));
  };
  const makeOwned = id => {
    const source = docs.find(doc => doc.system.identifier === id);
    assert.ok(source, id);
    return { ...source, id: "owned-" + (++sequence), actor, parent: actor,
      uuid: actor.uuid + ".Item." + sequence,
      system: structuredClone(source.system)
    };
  };

  const roast = makeOwned("zharkoe-iz-dikogo-kabana");
  actor.items.set(roast.id, roast);
  const activity = { item: roast, actor }, config = {};
  fire("dnd5e.preUseActivity", activity, config);
  // Native D&D5e has already auto-destroyed the portion.
  actor.items.delete(roast.id);
  fire("deleteItem", roast, {}, "gm");
  fire("dnd5e.postActivityConsumption", activity, config, {}, {});
  fire("dnd5e.postUseActivity", activity, config, {});
  await settle();
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "Крепкая сытость");
  assert.equal(actor.system.attributes.hp.temp, 5);
  assert.deepEqual(rolls, ["1d4 + 2"]);
  assert.equal(chatMessages.length, 1);
  assert.equal(actor.effects[0].flags["lipatos-buffs-debuffs"].grantedTemporaryHp, 5);
  assert.match(actor.effects[0].description, /1к4 \+ 2 временных хитов/);
  assert.doesNotMatch(actor.effects[0].description, /Любая другая еда|медовуха заменяет/);

  const nuts = makeOwned("medovye-oreshki-strannika");
  actor.items.set(nuts.id, nuts);
  const next = { item: nuts, actor }, usage = {};
  fire("dnd5e.preUseActivity", next, usage);
  actor.items.delete(nuts.id);
  fire("dnd5e.postActivityConsumption", next, usage, {}, {});
  fire("dnd5e.postUseActivity", next, usage, {});
  await settle();
  assert.equal(actor.effects.length, 1, "New food must replace the former effect");
  assert.equal(actor.effects[0].name, "Быстрая реакция");
  assert.deepEqual(actor.effects[0].changes.map(c => [c.key, c.value]),
    [["system.attributes.init.roll.bonus", "2"]]);

  fire("dnd5e.restCompleted", actor, { longRest: true }, { type: "long" });
  await settle();
  assert.equal(actor.effects.length, 0);

  const tart = makeOwned("chernichnyy-tart-teney");
  actor.items.set(tart.id, tart);
  const cancelled = { item: tart, actor }, noConsume = {};
  fire("dnd5e.preUseActivity", cancelled, noConsume);
  // In dnd5e, cancelling the use dialog aborts before postUseActivity.
  await settle();
  assert.equal(actor.effects.length, 0, "Cancelled/unsuccessful use must not apply buffs");
  // An integration that explicitly signals a cancelled postUse is also ignored.
  fire("dnd5e.postUseActivity", cancelled, noConsume, { cancelled: true });
  await settle();
  assert.equal(actor.effects.length, 0, "Cancelled activity result must not apply buffs");
});
