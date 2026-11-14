import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function setup() {
  const hooks = new Map();
  const rolls = [], damages = [], messages = [], warnings = [];
  let effectSequence = 0;
  function makeActor(name, uuid, saves = []) {
    const effects = [];
    effects.get = id => effects.find(effect => effect.id === id);
    return {
      uuid, name, documentName: "Actor", isOwner: true, type: "character",
      effects, saved: [...saves], saveCount: 0, system: {traits:{ci:{value:new Set()}}},
      async rollSavingThrow({ability}) {
        assert.equal(ability, "con");
        this.saveCount++;
        const total = this.saved.shift() ?? 10;
        return [{total}];
      },
      async deleteEmbeddedDocuments(type, ids) {
        assert.equal(type, "ActiveEffect");
        for (const id of ids) {
          const index = effects.findIndex(e => e.id === id);
          if (index >= 0) effects.splice(index, 1);
        }
      },
      async createEmbeddedDocuments(type, entries) {
        assert.equal(type, "ActiveEffect");
        const created = entries.map(data => {
          const effect = {...data, id:"ae"+(++effectSequence)};
          effect.update = async patch => {
            for (const [key,value] of Object.entries(patch)) {
              if (key.startsWith("flags.lipatos-buffs-debuffs."))
                effect.flags["lipatos-buffs-debuffs"][key.slice("flags.lipatos-buffs-debuffs.".length)] = value;
            }
          };
          return effect;
        });
        effects.push(...created);
        return created;
      }
    };
  }
  const attacker = makeActor("Attacker", "Actor.attacker");
  const victim = makeActor("Victim", "Actor.victim", [9, 17]);
  const attackerToken = {id:"tAtt", actor:attacker};
  const victimToken = {id:"tVic", actor:victim};
  const charge = {
    id:"charged", name:"Смертоносный яд", img:"icons/svg/poison.svg",
    flags: {"lipatos-buffs-debuffs":{aindorPotion:true,potionId:"zele-silnogo-yada"}}
  };
  attacker.effects.push(charge);
  const combatants = [
    {id:"vic", actor:victim, token:{object:victimToken}},
    {id:"att", actor:attacker, token:{object:attackerToken}}
  ];
  const combat = {
    id:"combat", turns:combatants,
    combatants:{get:id=>combatants.find(c=>c.id===id)}
  };
  const context = vm.createContext({
    Hooks:{on:(name,fn)=>hooks.set(name,fn),once:(name,fn)=>hooks.set(name,fn)},
    game:{
      user:{id:"gm",isGM:true},users:{activeGM:{id:"gm",isGM:true}},
      time:{worldTime:200},
      actors:{contents:[attacker,victim]}
    },
    MidiQOL:{DamageOnlyWorkflow:class {
      constructor(sourceActor, sourceToken, total, damageType, targets) {
        damages.push({sourceActor,sourceToken,total,damageType,targets});
      }
    }},
    Roll:class {
      constructor(formula) { this.formula=formula; this.total=5; rolls.push(this); }
      async evaluate() { return this; }
      async toMessage() {}
    },
    ChatMessage:{getSpeaker:({actor})=>({alias:actor?.name}),
      create:async msg=>messages.push(msg)},
    ui:{notifications:{warn:msg=>warnings.push(msg),error:msg=>warnings.push(msg)}},
    console
  });
  vm.runInContext(fs.readFileSync("scripts/strong-poison.mjs", "utf8"), context);
  const flush = async () => {
    for (let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve));
  };
  const workflow = (hit=true, weapon="weapon") => ({
    actor:attacker, token:attackerToken, item:{type:weapon},
    attackRoll:{total:18},hitTargets:hit?new Set([victimToken]):new Set()
  });
  const state = (round,turn,id) => ({round,turn,combatantId:id});
  return {hooks,rolls,damages,messages,warnings,attacker,victim,charge,combat,workflow,state,flush};
}

test("strong poison charge waits for a successful weapon hit, not spell or miss", async () => {
  const t=setup();
  t.hooks.get("midi-qol.hitsChecked")(t.workflow(false));
  t.hooks.get("midi-qol.hitsChecked")(t.workflow(true,"spell"));
  await t.flush();
  assert.equal(t.attacker.effects.length,1);
  assert.equal(t.victim.effects.length,0);
  assert.equal(t.rolls.length,0);
  const ranged = t.workflow(true,"weapon");
  ranged.activity={type:"attack",attack:{type:{value:"ranged"}}};
  t.hooks.get("midi-qol.hitsChecked")(ranged);
  t.hooks.get("midi-qol.hitsChecked")(ranged); // repeated event must not double-apply
  await t.flush();
  assert.equal(t.attacker.effects.length,0); // next-hit buff consumed
  assert.equal(t.rolls.length,1);
  assert.equal(t.rolls[0].formula,"1d8");
  assert.equal(t.damages.length,1);
  assert.equal(t.damages[0].damageType,"poison");
  assert.equal(t.damages[0].total,5);
  assert.equal(t.victim.effects.length,1);
  assert.equal(t.victim.effects[0].name,"Сильный яд — отравление");
  assert.deepEqual(Array.from(t.victim.effects[0].statuses),["poisoned"]);
  assert.equal(t.victim.effects[0].flags["lipatos-buffs-debuffs"].dc,14);
});

test("strong poison ticks once on each start turn and CON 14 cures at end", async () => {
  const t=setup();
  t.hooks.get("midi-qol.hitsChecked")(t.workflow());
  await t.flush();
  const start=t.state(2,0,"vic"), before=t.state(1,1,"att"), after=t.state(2,1,"att");
  t.hooks.get("combatTurnChange")(t.combat,before,start);
  await t.flush();
  assert.equal(t.damages.length,2); // first hit plus start-of-turn DOT
  assert.equal(t.rolls.length,2);
  assert.equal(t.victim.effects.length,1);
  // Duplicate delivery of the same turn never creates another 1d8.
  t.hooks.get("combatTurnChange")(t.combat,before,start);
  await t.flush();
  assert.equal(t.damages.length,2);
  t.hooks.get("combatTurnChange")(t.combat,start,after);
  await t.flush();
  assert.equal(t.victim.saveCount,1); // 9 < 14; poison remains
  assert.equal(t.victim.effects.length,1);
  const nextStart=t.state(3,0,"vic"), nextAfter=t.state(3,1,"att");
  t.hooks.get("combatTurnChange")(t.combat,after,nextStart);
  await t.flush();
  assert.equal(t.damages.length,3);
  t.hooks.get("combatTurnChange")(t.combat,nextStart,nextAfter);
  await t.flush();
  assert.equal(t.victim.saveCount,2); // 17 >= 14; poison removed
  assert.equal(t.victim.effects.length,0);
  t.hooks.get("combatTurnChange")(t.combat,nextAfter,t.state(4,0,"vic"));
  await t.flush();
  assert.equal(t.damages.length,3);
});

test("condition immunity prevents DOT but not one-shot poison damage roll", async () => {
  const t=setup();
  t.victim.system.traits.ci.value.add("poisoned");
  t.hooks.get("midi-qol.hitsChecked")(t.workflow());
  await t.flush();
  assert.equal(t.damages.length,1);
  assert.equal(t.victim.effects.length,0);
});
