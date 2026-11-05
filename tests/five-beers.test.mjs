import test from "node:test";
import assert from "node:assert/strict";


test("all six ales install exactly once with correct ingredients, icons, skill keys and normal use", async () => {
  const callbacks = new Map();
  globalThis.Hooks = {
    on(event, cb) { callbacks.set(event, [...(callbacks.get(event) ?? []), cb]); },
    once(event, cb) { callbacks.set(event, [...(callbacks.get(event) ?? []), cb]); }
  };
  function fire(event, ...args) {
    for (const cb of callbacks.get(event) ?? []) cb(...args);
  }
  const created = [], notifications = [], returnedBottles = [];
  let fed = 0;
  const module = { api: {
    feed: async () => { fed++; },
    giveHeatherEmptyBottle: async actor => { returnedBottles.push(actor.uuid); }
  }};
  globalThis.game = {
    user: { id: "gm", isGM: true }, users: [{ id: "gm", isGM: true, active: true }],
    actors: { contents: [] }, items: { contents: created },
    modules: { get() { return module; } }, time: { worldTime: 200 }
  };
  globalThis.ui = { notifications: {
    info(message) { notifications.push(message); },
    error(message) { throw Error(message); }
  }};
  globalThis.Item = { createDocuments: async items => {
    const result = items.map((src, i) => ({
      ...structuredClone(src), id: "template" + (created.length + i),
      toObject() { return { system: structuredClone(this.system) }; },
      async update(patch) {
        for (const [key, value] of Object.entries(patch)) {
          const keys = key.split(".");
          let cursor = this;
          while (keys.length > 1) cursor = cursor[keys.shift()];
          cursor[keys[0]] = value;
        }
      }
    }));
    created.push(...result);
    return result;
  }};
  const food = await import("../scripts/food.mjs");
  const installed = await food.installBeerItems();
  assert.equal(installed.length, 6);
  assert.equal((await food.installBeerItems()).length, 0);
  assert.equal(food.listFood().length, 11);
  assert.equal(food.listBeerItems().length, 6);
  const beers = [
    ["Весёлый трубадур", "Хмельная удаль", "system.skills.prf.roll.bonus"],
    ["Кабанья ярость", "Кабанья отвага", "system.skills.itm.roll.bonus"],
    ["Лесной шёпот", "Лесное чутьё", "system.skills.nat.roll.bonus"],
    ["Пастуший эль", "Звериное доверие", "system.skills.ani.roll.bonus"],
    ["Шалфейный эль", "Целебное чутьё", "system.skills.med.roll.bonus"],
    ["Панцирный эль", "Багровый панцирь", "system.attributes.ac.bonus"]
  ];
  for (const [name] of beers) {
    const template = created.find(item => item.name === name);
    assert.ok(template, name);
    assert.equal(template.img, "icons/svg/item-bag.svg", name + " has no bundled image");
    assert.equal(template.system.uses.autoDestroy, true);
    assert.equal(template.system.activities.useFood000000001.name, "Использовать");
    assert.equal(template.flags["lipatos-buffs-debuffs"].brewedBeer, true);
    assert.equal(template.flags["lipatos-buffs-debuffs"].batchYield, name === "Панцирный эль" ? 2 : 3);
    assert.ok(template.flags["lipatos-buffs-debuffs"].ingredients.length >= 5);
  }
  let id = 0;
  const actor = {
    uuid: "Actor.Brewer", documentName: "Actor", isOwner: true,
    system: { attributes: { hp: { temp: 0 } } }, effects: [],
    items: { contents: [], get(id) { return this.contents.find(x => x.id === id) ?? null; } },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "ActiveEffect");
      const list = data.map(effect => ({ ...effect, id: "effect" + (++id) }));
      this.effects.push(...list); return list;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.effects.splice(0, this.effects.length, ...this.effects.filter(x => !ids.includes(x.id)));
    }
  };
  actor.effects.get = key => actor.effects.find(x => x.id === key);
  game.actors.contents.push(actor);
  actor.effects.push({ id: "existing-mead",
    flags: { "lipatos-buffs-debuffs": { heatherWarmth: true, lastRoll: 0, displayedTemp: 0 } }
  });
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve));
  };
  for (const [name, buff, skillKey] of beers) {
    const template = created.find(t => t.name === name);
    const item = {
      ...template, id: "owned-" + (++id), parent: actor, actor,
      uuid: actor.uuid + ".Item." + id, system: structuredClone(template.system),
      async delete() {
        actor.items.contents = actor.items.contents.filter(x => x.id !== this.id);
        fire("deleteItem", this, {}, "gm");
      }
    };
    if (name === "Весёлый трубадур")
      item.system.identifier = "mastercrafted-other-id";
    item.system.uses.spent = 1;
    actor.items.contents.push(item);
    fire("updateItem", item, { system: { uses: { spent: 1 } } }, {}, "gm");
    await settle();
    assert.equal(actor.effects.length, 1, name);
    assert.equal(actor.effects[0].name, buff);
    assert.deepEqual(actor.effects[0].changes.map(x => [x.key, x.value]), [[skillKey, name === "Панцирный эль" ? "1" : "2"]]);
    assert.doesNotMatch(actor.effects[0].description, /Любая другая еда|медовуха заменяет/);
    assert.equal(actor.items.get(item.id), null);
  }
  assert.equal(returnedBottles.length, 6, "Every consumed ale returns exactly one bottle");
  assert.equal(fed, 0, "Drinking beer must not count as eating");
  fire("dnd5e.restCompleted", actor, { longRest: true }, { type: "long" });
  await settle();
  assert.equal(actor.effects.length, 0);
});
