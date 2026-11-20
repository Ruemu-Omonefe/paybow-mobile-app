const m = new Map();
module.exports = {
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async (k) => (m.has(k) ? m.get(k) : null),
  setItemAsync: async (k, v) => { m.set(k, v); },
  deleteItemAsync: async (k) => { m.delete(k); },
};
