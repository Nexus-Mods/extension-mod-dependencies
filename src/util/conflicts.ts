import { IConflict } from '../types/IConflict';
import { IModLookupInfo } from '../types/IModLookupInfo';

import isBlacklisted from './blacklist';

import * as Promise from 'bluebird';
import * as path from 'path';
import { fs, types, util } from 'vortex-api';

interface IFileMap {
  [filePath: string]: types.IMod[];
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

function getAllFiles(basePath: string, mods: types.IMod[]): Promise<IFileMap> {
  const files: IFileMap = {};
  return Promise.map(mods.filter(mod => mod.installationPath !== undefined), (mod: types.IMod) => {
    const modPath = path.join(basePath, mod.installationPath);
    return util.walk(modPath, (iterPath: string, stat: fs.Stats) => {
      if (stat.isFile()) {
        const relPath = path.relative(modPath, iterPath);
        util.setdefault(files, relPath.toLowerCase(), []).push(mod);
      }
      return Promise.resolve();
    }, { ignoreErrors: ['EPERM'] });
  })
    .then(() => files);
}

interface IConflictMap {
  [lhsId: string]: { [rhsId: string]: string[] };
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
          util.setdefault(util.setdefault(conflicts, file[i].id, {}), file[j].id, [])
            .push(filePath);
        }
      }
    }
  });
  return conflicts;
}

function findConflicts(basePath: string,
                       mods: types.IMod[]): Promise<{ [modId: string]: IConflict[] }> {
  return getAllFiles(basePath, mods)
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
            conflictsByMod[lhsId].push({
              otherMod: toLookupInfo(mod),
              files: conflictMap[lhsId][rhsId],
            });
          }
        });
      });
      return conflictsByMod;
  });
}

export default findConflicts;
