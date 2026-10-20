/** Stands in for AsyncStorage under test: the theme reads it on mount, a render never waits for it. */
const AsyncStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
export default AsyncStorage;
