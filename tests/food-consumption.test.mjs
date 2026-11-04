import test from "node:test";
import assert from "node:assert/strict";
import { FoodUseTracker } from "../scripts/food-use-tracker.mjs";

test("activity consumption is granted once across all hook event orders", () => {
  for (const sequence of [
    ["update", "consume", "post"],
    ["consume", "update", "post"],
    ["consume", "post", "update"],
    ["update", "post", "consume"],
    ["delete", "consume", "post"],
    ["post", "consume", "update"]
  ]) {
    const t = new FoodUseTracker();
    const usage = {}, result = {};
    const key = "Actor.X:Item.FOOD";
    t.begin(key, usage);
    let grants = 0;
    for (const event of sequence) {
      if (event === "consume") grants += +t.consumed(key, usage);
      if (event === "update" || event === "delete") grants += +t.itemUpdated(key);
      if (event === "post") grants += +t.postUse(key, usage, result, true);
    }
    assert.equal(grants, 1, sequence.join(" -> "));
  }
});

test("cancelled item use and inventory edits do not award food buffs", () => {
  const t = new FoodUseTracker();
  assert.equal(t.itemUpdated("A:I"), false);
  const usage = {}, result = {};
  t.begin("A:I", usage);
  assert.equal(t.postUse("A:I", usage, result, false), false);
  assert.equal(t.postUse("A:I", usage, result, true), false);
});

test("fast repeated legitimate item uses are each rewarded once", () => {
  const t = new FoodUseTracker();
  const key = "Actor.X:Item.FOOD";
  let grants = 0;
  for (let i = 0; i < 5; i++) {
    const usage = {}, result = {};
    t.begin(key, usage);
    grants += +t.itemUpdated(key);
    grants += +t.consumed(key, usage);
    grants += +t.postUse(key, usage, result, true);
  }
  assert.equal(grants, 5);
});

test("postActivityConsumption works even if no preUse hook was fired", () => {
  const t = new FoodUseTracker();
  const usage = {};
  assert.equal(t.consumed("Actor.X:Item.FOOD", usage), true);
  assert.equal(t.consumed("Actor.X:Item.FOOD", usage), false);
  assert.equal(t.postUse("Actor.X:Item.FOOD", usage, {}, true), false);
});

test("separate actor item uses cannot suppress each other's buff", () => {
  const t = new FoodUseTracker();
  const a = {}, b = {};
  t.begin("A:I", a);
  t.begin("B:I", b);
  assert.equal(t.consumed("A:I", a), true);
  assert.equal(t.consumed("B:I", b), true);
  assert.equal(t.consumed("B:I", b), false);
});
