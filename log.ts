export let IS_DEBUG = true;

export const toggleDebug = () => {
  IS_DEBUG = !IS_DEBUG
  return IS_DEBUG
}
