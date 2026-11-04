/**
 * Per-activation idempotence for D&D5e 6.x.
 * Prevent updateItem, postActivityConsumption and postUseActivity from
 * granting several buffs for one use, without time-throttling real repeated uses.
 */
export class FoodUseTracker {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.byItem = new Map();
    this.byUsage = new WeakMap();
    this.byResult = new WeakSet();
  }
  _queue(key) {
    let queue = this.byItem.get(key);
    if (!queue) { queue = []; this.byItem.set(key, queue); }
    const cutoff = this.now() - 60000;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].at < cutoff) queue.splice(i, 1);
    }
    return queue;
  }
  _link(ticket, usage) {
    if (usage && typeof usage === "object") this.byUsage.set(usage, ticket);
    return ticket;
  }
  _new(key, usage) {
    const ticket = { key, at: this.now(), handled: false, updateSeen: false,
      consumedSeen: false, postSeen: false };
    this._queue(key).push(ticket);
    return this._link(ticket, usage);
  }
  _find(key, usage, allowCreate = false) {
    if (!key) return null;
    const linked = usage && typeof usage === "object" ? this.byUsage.get(usage) : null;
    if (linked?.key === key) return linked;
    const queue = this._queue(key);
    // Distinct calls can arrive before a prior use's final postUse hook.
    const ticket = queue.find(t => !t.postSeen && !t.handled)
      ?? queue.find(t => !t.postSeen)
      ?? (allowCreate ? this._new(key, usage) : null);
    return ticket ? this._link(ticket, usage) : null;
  }
  begin(key, usage) {
    if (!key) return null;
    // D&D5e preUseActivity marks the start of a *new* item use.
    return this._new(key, usage);
  }
  preConsumption(key, usage) { return this._find(key, usage, true); }
  _claim(ticket) {
    if (!ticket || ticket.handled) return false;
    ticket.handled = true;
    return true;
  }
  /** Called only after dnd5e confirms that resource consumption was applied. */
  consumed(key, usage) {
    const ticket = this._find(key, usage, true);
    if (!ticket) return false;
    ticket.consumedSeen = true;
    return this._claim(ticket);
  }
  /** A real observed item charge/quantity reduction is a fallback. */
  itemUpdated(key, { acceptUnprimed = false } = {}) {
    if (!key) return false;
    // The item's normal Use button can spend an item charge WITHOUT calling
    // dnd5e.preUseActivity. Heather mead handles this native update directly.
    // Here a confirmed item-use spend is independent evidence of consumption.
    const ticket = this._queue(key).find(t => !t.updateSeen)
      ?? (acceptUnprimed ? this._new(key, null) : null);
    if (!ticket) return false;
    ticket.updateSeen = true;
    return this._claim(ticket);
  }
  /** Result fallback for flows that do not emit the consumption hook. */
  postUse(key, usage, result, confirmed) {
    if (!result || typeof result !== "object" || this.byResult.has(result)) return false;
    this.byResult.add(result);
    const ticket = this._find(key, usage, Boolean(confirmed));
    if (!ticket) return false;
    ticket.postSeen = true;
    return confirmed ? this._claim(ticket) : false;
  }
}
