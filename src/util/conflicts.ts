import { IConflict, ConflictSuggestion } from '../types/IConflict';
import { IModLookupInfo } from '../types/IModLookupInfo';

import isBlacklisted from './blacklist';

import * as Promise from 'bluebird';
import * as path from 'path';
import turbowalk from 'turbowalk';
import { types, util, log } from 'vortex-api';

interface IFileMap {
  [filePath: string]: Array<{ mod: types.IMod, time: number }>;
}

function toLookupInfo(mod: types.IMod): IModLookupInfo {
  const attributes = mod.attributes || {};
  return {
    id: mod.id,
    fileMD5: attributes['fileMD5'],
    customFileName: attributes['customFileName'],
    fileName: attributes['fileName'],
    fileSizeBytes: attributes['fileSizeBytes'],
    logicalFileName: attributes['logicalFileName'],
    name: attributes['name'],
    version: attributes['version'],
  };
}

function getAllFiles(game: types.IGame, basePath: string, mods: types.IMod[]): Promise<IFileMap> {
  const files: IFileMap = {};

  return Promise.map(mods.filter(mod => mod.installationPath !== undefined), (mod: types.IMod) => {
    const modPath = path.join(basePath, mod.installationPath);
    return turbowalk(modPath, entries => {
      entries.forEach(entry => {
        if (!entry.isDirectory) {
          let relPath = path.relative(modPath, entry.filePath);
          if (game.mergeMods !== true) {
            let modSubDir = game.mergeMods === false
              ? mod.installationPath
              : game.mergeMods(mod);
            relPath = path.join(modSubDir, relPath);
          }
          util.setdefault(files, relPath.toLowerCase(), []).push({ mod, time: entry.mtime });
        }
      });
    }, { })
    .catch({ code: 'ENOTFOUND' }, err => {
      log('error', 'Mod directory not found', { modDirectory: mod.installationPath });
      return {};
    });
  })
    .then(() => files);
}

interface IConflictMap {
  [lhsId: string]: { [rhsId: string]: { files: string[], suggestion: ConflictSuggestion } };
}

function getConflictMap(files: IFileMap): IConflictMap {
  const conflictFiles = Object.keys(files)
    .filter(filePath => (files[filePath].length > 1) && !isBlacklisted(filePath));

  const conflicts: IConflictMap = {};
  conflictFiles.forEach(filePath => {
    const file = files[filePath];
    for (let i = 0; i < file.length; ++i) {
      for (let j = 0; j < file.length; ++j) {
        if (i !== j) {
          let suggestion = file[i].time < file[j].time
            ? 'before'
            : file[i].time > file[j].time
            ? 'after'
            : undefined;
          const entry = util.setdefault(util.setdefault(conflicts, file[i].mod.id, {}),
                          file[j].mod.id, { files: [], suggestion: undefined });
          entry.files.push(filePath);
          if (suggestion !== undefined) {
            if (entry.suggestion === undefined) {
              entry.suggestion = suggestion;
            } else if ((entry.suggestion !== null) && (entry.suggestion !== suggestion)) {
              entry.suggestion = null;
            }
          }
        }
      }
    }
  });
  return conflicts;
}

function findConflicts(game: types.IGame,
                       basePath: string,
                       mods: types.IMod[]): Promise<{ [modId: string]: IConflict[] }> {
  return getAllFiles(game, basePath, mods)
    .then((files: IFileMap) => {
      const conflictMap = getConflictMap(files);
      const conflictsByMod: { [modId: string]: IConflict[] } = {};
      Object.keys(conflictMap).forEach(lhsId => {
        Object.keys(conflictMap[lhsId]).forEach(rhsId => {
          if (conflictsByMod[lhsId] === undefined) {
            conflictsByMod[lhsId] = [];
          }
          const mod = mods.find(mod => mod.id === rhsId);
          if (mod !== undefined) {
            const entry = conflictMap[lhsId][rhsId];
            conflictsByMod[lhsId].push({
              otherMod: toLookupInfo(mod),
              files: entry.files,
              suggestion: entry.suggestion || null,
            });
          }
        });
      });
      return conflictsByMod;
  });
}

export default findConflicts;
