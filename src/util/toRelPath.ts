import { types, selectors, util } from 'vortex-api';
import path from 'path';

export const toRelPath = (api: types.IExtensionApi, mod: types.IMod, filePath: string) => {
  const state = api.getState();
  const gameId = selectors.activeGameId(state);
  const discovery = selectors.discoveryByGame(state, gameId);
  if (discovery?.path === undefined) {
    return null;
  }
  const game: types.IGame = util.getGame(gameId);
  if (game === undefined) {
    return null;
  }
  const modPaths = game?.getModPaths?.(discovery.path);
  const modPath = modPaths?.[mod.type];
  if (modPath === undefined) {
    return null;
  }
  return path.relative(modPath, filePath);
}

export default toRelPath;