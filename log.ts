export let IS_DEBUG = false;

export const toggleDebug = () => {
  IS_DEBUG = !IS_DEBUG
  return IS_DEBUG
}
