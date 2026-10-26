import {decoratePips,getHunger,STEP} from './hunger.mjs';
import {keepBarAnchored} from './panel-position.mjs';
// No roll guard: the D&D5e exhaustion condition already applies 2014 penalties.
const ID='lipatos-buffs-debuffs', ENC='lipatos-encumbrance',SIZE=32;

function actualElement(html,app){if(html instanceof HTMLElement)return html;if(html?.[0] instanceof HTMLElement)return html[0];
 if(app?.element instanceof HTMLElement)return app.element;if(app?.element?.[0] instanceof HTMLElement)return app.element[0];return null;}
function actorOf(app){const actor=app?.actor??app?.document;return actor?.documentName==='Actor'?actor:null;}
function plain(value){const el=document.createElement('div');el.innerHTML=String(value??'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6])>/gi,'\n');return (el.textContent??'').replace(/\n{3,}/g,'\n\n').trim();}
function storedDescription(d){if(!d)return '';return [d.description,d.system?.description?.value,d.system?.description,d.system?.details?.description,d.flags?.dnd5e?.description]
 .find(x=>typeof x==='string'&&x.trim())??'';}
async function effectDescription(effect,actor){let raw=storedDescription(effect),source=effect;
 if(!raw){const origins=[effect.item,effect.parent?.documentName==='Item'?effect.parent:null];
 for(const uuid of [effect.system?.origin?.item,effect.system?.origin?.activity,effect.system?.origin?.effect,effect.origin]){
 if(typeof uuid==='string')try{const doc=fromUuidSync(uuid,{strict:false});if(doc)origins.push(doc)}catch{}}
 if(typeof effect.getSource==='function')try{origins.push(await effect.getSource())}catch{}
 const name=String(effect.name??'').trim().toLowerCase(),sourceName=String(effect.sourceName??'').trim().toLowerCase();
 for(const item of actor?.items??[]){const n=String(item.name??'').trim().toLowerCase();if(n===name||(sourceName&&n===sourceName))origins.push(item);}
 for(const candidate of origins){if(!candidate)continue;const doc=candidate.documentName==='ActiveEffect'?(candidate.item??(candidate.parent?.documentName==='Item'?candidate.parent:null)):candidate;
 raw=storedDescription(doc);if(raw){source=doc;break;}}
 }
 if(!raw){const sid=effect.system?.type??(effect.statuses?[...effect.statuses][0]:null);
 const entry=(CONFIG.statusEffects??[]).find(x=>x.id===sid||x._id===effect.id||x.name===effect.name||x.label===effect.name);
 raw=entry?.description??'';if(typeof raw==='string'&&game.i18n?.has?.(raw))raw=game.i18n.localize(raw);}
 if(!raw)return '';try{const enriched=await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw,{async:true,relativeTo:source??actor,secrets:Boolean(actor?.isOwner),rollData:actor?.getRollData?.()??{}});
 if(plain(enriched))return plain(enriched)}catch{}return plain(raw);
}
function collect(actor) {
  let list = [];
  try { list = Array.from(actor.allApplicableEffects?.() ?? actor.effects ?? []); }
  catch { list = Array.from(actor.effects ?? []); }
  const seen = new Set();
  return list.filter(effect => {
    if (!effect || effect.disabled || effect.isSuppressed || seen.has(effect.uuid)) return false;
    if (effect.system?.type === 'exhaustion' || effect.statuses?.has?.('exhaustion')
        || effect.getFlag?.(ID, 'hungerZero') === true || effect.getFlag?.(ID, 'hunger') === true) return false;
    seen.add(effect.uuid);
    return true;
  });
}
function hungerEffect(level) {
  return {
    hungerLevel: level, name: `Голод: истощение ${level}`,
    img: `modules/${ID}/icons/hunger-${level}.webp`,
    description: level === 0 ? STEP[0] : 'Истощение (все штрафы действуют одновременно):\n' +
      STEP.slice(1, level + 1).map((entry, index) => `${index + 1}. ${entry}`).join('\n')
  };
}
function makeIcon(effect, actor) {
  const holder = document.createElement('div'); holder.className = 'lipatos-bd-icon';
  if (Number.isInteger(effect.hungerLevel)) holder.dataset.hungerLevel = String(effect.hungerLevel);
  holder.tabIndex = 0; holder.setAttribute('role', 'img');
  holder.setAttribute('aria-label', effect.name ?? 'Эффект');
  const image = document.createElement('img'); image.src = effect.img || effect.icon || 'icons/svg/aura.svg';
  image.width = SIZE; image.height = SIZE; image.draggable = false; holder.append(image);
  const tooltip = document.createElement('div'); tooltip.className = 'lipatos-bd-tooltip';
  const heading = document.createElement('div'); heading.className = 'lipatos-bd-tooltip-title';
  heading.textContent = effect.name ?? 'Эффект';
  const details = document.createElement('div'); details.className = 'lipatos-bd-tooltip-body';
  details.textContent = typeof effect.hungerLevel === 'number' ? effect.description : 'Загрузка описания…';
  if (typeof effect.hungerLevel !== 'number') {
    effectDescription(effect, actor).then(text => {
      if (holder.isConnected) details.textContent = text || 'Описание отсутствует в источнике эффекта.';
    }).catch(() => { if (holder.isConnected) details.textContent = 'Описание недоступно.'; });
  }
  tooltip.append(heading, details);
  const show = () => {
    const rect = holder.getBoundingClientRect();
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - 125, rect.bottom + 8))}px`;
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - 355, rect.left))}px`;
    tooltip.dataset.lipatosOwner = actor.uuid;
    document.body.append(tooltip); tooltip.classList.add('lipatos-bd-portal');
  };
  const hide = () => tooltip.remove();
  holder.addEventListener('mouseenter', show); holder.addEventListener('mouseleave', hide);
  holder.addEventListener('focus', show); holder.addEventListener('blur', hide);
  return holder;
}
function currentTurn(actor) {
  const combat = game.combat, current = combat?.combatant;
  if (!combat?.started || !current) return null;
  return canvas?.tokens?.controlled?.find(token => token.actor?.id === actor.id
    && token.document.combatant?.id === current.id)?.document ?? null;
}
// The actor sheet's portrait can briefly move outside the viewport while an
// effect is created/deleted and the sheet is re-rendered. Never derive our
// panel position from its transient boundingClientRect or scrollTop.
function position(entry, bar) { keepBarAnchored(bar); }
const roots = new Map();
function disposePortals(actor) {
  for (const tooltip of document.querySelectorAll('.lipatos-bd-portal')) {
    if (tooltip.dataset.lipatosOwner === actor.uuid) tooltip.remove();
  }
}
function render(entry) {
  if (!entry.host?.isConnected) return;
  const root = entry.host.querySelector('.window-content') ?? entry.host;
  if (root !== entry.root) {
    entry.root = root;
    entry.fingerprint = null;
  }
  const actor = entry.actor;
  root.classList.add('lipatos-bd-parent'); root.dataset.lipatosActorUuid = actor.uuid;
  decoratePips(root, actor);
  let bar = root.querySelector(':scope > .lipatos-bd-bar');
  if (!bar) {
    bar = document.createElement('div'); bar.className = 'lipatos-bd-bar';
    bar.dataset.actorId = actor.id; bar.dataset.actorUuid = actor.uuid;
    root.append(bar); entry.fingerprint = null;
  }
  const effects = collect(actor), hunger = getHunger(actor);
  const candidate = game.modules.get(ENC)?.active ? game.modules.get(ENC)?.api : null;
  const enc = candidate && ['getSpeed', 'dashUsed', 'canDash', 'useDash']
    .every(key => typeof candidate[key] === 'function') ? candidate : null;
  const token = enc ? currentTurn(actor) : null;
  const dashVisible = Boolean(token && !game.user.isGM && token.isOwner);
  const fingerprint = JSON.stringify([
    hunger, effects.map(effect => [effect.uuid, effect.name, effect.img, effect.disabled,
      effect.description, effect.system?.description?.value]),
    dashVisible, dashVisible ? [enc.getSpeed(actor), enc.dashUsed(token), enc.canDash(token)] : []
  ]);
  if (fingerprint === entry.fingerprint && bar.isConnected) { position(entry, bar); return; }
  entry.fingerprint = fingerprint;
  disposePortals(actor);
  const badges = document.createElement('div'); badges.className = 'lipatos-bd-icons';
  for (const effect of effects) badges.append(makeIcon(effect, actor));
  if (hunger !== null) badges.append(makeIcon(hungerEffect(hunger), actor));
  const parts = [badges];
  if (dashVisible) {
    const panel = document.createElement('div'); panel.className = 'lipatos-bd-movement';
    panel.textContent = `Скорость: ${enc.getSpeed(actor)} | ${enc.dashUsed(token) ? 'Рывок использован' : 'Действие свободно'}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'lipatos-bd-dash';
    button.textContent = 'Рывок'; button.disabled = !enc.canDash(token);
    button.title = button.disabled ? 'Рывок уже использован или скорость равна 0' : 'Потратить действие на рывок';
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      try { await enc.useDash(token); }
      catch (error) { ui.notifications.error('Не удалось выполнить «Рывок».'); console.error(error); }
      schedule(entry);
    });
    panel.append(button); parts.push(panel);
  }
  bar.replaceChildren(...parts);
  // Keep a stable, initially invisible bar even when the actor has no effects:
  // a refresh must never delete the panel just before a Foundry sheet redraw.
  bar.style.display = effects.length || hunger !== null || dashVisible ? 'flex' : 'none';
  position(entry, bar);
}
function schedule(entry) {
  if (!entry?.host?.isConnected || entry.pending) return;
  entry.pending = true;
  requestAnimationFrame(() => {
    entry.pending = false;
    if (!entry.host.isConnected) return;
    try { render(entry); }
    catch (error) { console.error(ID + ' | buff panel refresh', error); }
  });
}
function watchHost(entry) {
  if (typeof MutationObserver === 'undefined') return;
  // ONLY the relevant actor sheet, not document.body; one throttled observer.
  entry.observer?.disconnect();
  entry.observer = new MutationObserver(() => {
    if (!entry.host.isConnected) return;
    const latest = entry.host.querySelector('.window-content') ?? entry.host;
    if (latest !== entry.root || !latest.querySelector(':scope > .lipatos-bd-bar')) schedule(entry);
  });
  entry.observer.observe(entry.host, {childList: true, subtree: true});
}
function elementOf(html, app) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  return null;
}
function sheet(app, html) {
  if (game.system?.id !== 'dnd5e') return;
  const actor = app?.actor ?? app?.document;
  if (actor?.documentName !== 'Actor' || actor.type !== 'character') return;
  const el = elementOf(html, app); if (!el) return;
  const host = el.matches('.dnd5e2.sheet.actor') ? el :
    el.closest('.dnd5e2.sheet.actor') ?? el.querySelector('.dnd5e2.sheet.actor');
  if (!host) return;
  const existing = roots.get(actor.uuid);
  if (existing && existing.host !== host) {
    existing.observer?.disconnect();
  }
  const entry = existing?.host === host ? existing :
    { actor, host, root: host.querySelector('.window-content') ?? host, fingerprint: null, pending: false };
  entry.actor = actor; entry.host = host; roots.set(actor.uuid, entry);
  if (!entry.observer) watchHost(entry);
  schedule(entry);
}
function refresh(actor) {
  if (!actor) return;
  for (const [id, entry] of roots) {
    if (!entry.host?.isConnected) {
      entry.observer?.disconnect(); roots.delete(id);
    } else if (entry.actor.id === actor.id) {
      entry.actor = actor; schedule(entry);
    }
  }
}
Hooks.on('renderApplicationV2', sheet);
Hooks.on('renderActorSheet', sheet);
for (const event of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
  Hooks.on(event, effect => refresh(effect.parent));
}
Hooks.on('updateActor', refresh);
for (const event of ['createItem','updateItem','deleteItem']) {
  Hooks.on(event, item => { if (item.parent?.documentName === 'Actor') refresh(item.parent); });
}
Hooks.on('controlToken', token => { if (token?.actor) refresh(token.actor); });
for (const event of ['updateCombat', 'updateCombatant']) {
  Hooks.on(event, () => { for (const entry of roots.values()) schedule(entry); });
}
Hooks.on('closeApplicationV2', app => {
  for (const [id, entry] of roots) if (app?.element === entry.host || app?.actor?.uuid === id) {
    entry.observer?.disconnect(); roots.delete(id);
  }
});
Hooks.once('ready', () => console.info('LipatoS — buffs: native exhaustion, stable actor panel active'));
