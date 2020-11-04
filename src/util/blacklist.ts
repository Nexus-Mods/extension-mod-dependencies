import minimatch = require('minimatch');
import { types } from 'vortex-api';

const blacklist = [
  '**\\fomod\\*',
  '**\\readme*',
  '**\\meta.ini',       // Mod Organizer
  '**\\mod.manifest',   // Kingdom Come: Deliverance
];

const getBlacklist = (() => {
  let lastGameId: string;
  let lastBlacklist: string[];
  return (game: types.IGame) => {
    if (game.id !== lastGameId) {
      lastGameId = game.id;
      const customBlacklist = ((game.details?.ignoreConflicts !== undefined)
        && Array.isArray(game.details.ignoreConflicts));
      lastBlacklist = customBlacklist
        ? [].concat(blacklist, game.details.ignoreConflicts)
        : blacklist;
    }

    return lastBlacklist;
  };
})();

function isBlacklisted(filePath: string, game: types.IGame): boolean {
  // TODO: this could become reaaaaly slow as the blacklist gets larger...
  return getBlacklist(game).find(pattern => minimatch(filePath, pattern)) !== undefined;
}

export default isBlacklisted;
