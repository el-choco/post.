function createMailState(maxEntries = 500) {
  const accounts = new Map();
  function update(id, states) {
    let entry = accounts.get(id);
    if (!entry || entry.until < Date.now()) {
      if (accounts.size >= maxEntries)
        accounts.delete(accounts.keys().next().value);
      entry = { states: new Map(), until: 0 };
      accounts.set(id, entry);
    }
    let changed = false;
    for (const state of states) {
      if (
        JSON.stringify(entry.states.get(state.folder)) !== JSON.stringify(state)
      )
        changed = true;
      entry.states.set(state.folder, state);
    }
    entry.until = Date.now() + 10 * 60000;
    return changed;
  }
  function folders(id, list) {
    const entry = accounts.get(id);
    return list.map((folder) => {
      const state = entry?.until > Date.now() && entry.states.get(folder.path);
      return state
        ? { ...folder, total: state.total, unseen: state.unseen }
        : folder;
    });
  }
  return { update, folders };
}
module.exports = createMailState();
module.exports.createMailState = createMailState;
