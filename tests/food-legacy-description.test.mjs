import test from "node:test";
import assert from "node:assert/strict";

test("migration removes old replacement text from active buffs and updates existing roast item descriptions", async () => {
  globalThis.Hooks = { on() {}, once() {} };
  const oldText = "Любая другая еда или вересковая медовуха заменяет этот бафф.";
  const roast = {
    name: "Жаркое из дикого кабана", type: "consumable",
    img: "icons/svg/item-bag.svg", flags: {},
    system: {
      identifier: "zharkoe-iz-dikogo-kabana",
      type: { value: "food" }, uses: { max: 1, autoDestroy: true, prompt: false },
      description: { value: "<p>После употребления: 8 временных хитов.</p>" },
      activities: { existing: { name: "Использовать", type: "utility" } }
    },
    toObject() { return { system: structuredClone(this.system) }; },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split(".");
        if (keys.length === 1) { this[path] = value; continue; }
        let target = this;
        while (keys.length > 1) {
          const k = keys.shift();
          target[k] ??= {};
          target = target[k];
        }
        target[keys[0]] = value;
      }
    }
  };
  const active = {
    id: "old-buff",
    flags: { "lipatos-buffs-debuffs": { foodBuff: true, foodIdentifier: "zharkoe-iz-dikogo-kabana",
      grantedTemporaryHp: 8, displayedTemporaryHp: 8 } },
    description: "<p>Действует до завершения следующего долгого отдыха. " + oldText + "</p>",
    async update(patch) { Object.assign(this, patch); }
  };
  const actor = { effects: [active], items: { contents: [] }, system: { attributes: { hp: { temp: 8 } } } };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: [{ id: "gm", isGM: true, active: true }],
    items: { contents: [roast] },
    actors: { contents: [actor] },
    modules: { get() { return { api: {} }; } }
  };
  globalThis.Item = { createDocuments: async () => [] };
  await import("../scripts/food.mjs");
  const { installFoodItems } = await import("../scripts/food.mjs");
  await installFoodItems();
  assert.match(roast.system.description.value, /1к4 \+ 2 временных хитов/);
  assert.doesNotMatch(roast.system.description.value, /8 временных хитов/);
  assert.deepEqual(Object.keys(roast.system.activities), ["existing"]);
  assert.doesNotMatch(active.description, /Любая другая еда|медовуха заменяет/);
  assert.equal(active.flags["lipatos-buffs-debuffs"].grantedTemporaryHp, 8,
    "Migrating text must not reroll an already active old HP pool");
});
