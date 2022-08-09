import path from 'path';
import { IModLookupInfo } from '../types/IModLookupInfo';

import { IReference, IRule } from 'modmeta-db';
import { selectors, types, util } from 'vortex-api';
import _ from 'lodash';
import turbowalk from 'turbowalk';

function findReference(reference: IReference, mods: IModLookupInfo[],
                       source: { gameId: string, modId: string }): IModLookupInfo {
  if (reference['idHint'] !== undefined) {
    const refMod = mods.find(mod => mod.id === reference['idHint']);
    if (util.testModReference(refMod, reference)) {
      return refMod;
    }
  }
  if (reference['md5Hint'] !== undefined) {
    const refMod = mods.find(mod => mod.fileMD5 === reference['md5Hint']);
    if (refMod !== undefined) {
      return refMod;
    }
  }
  return mods.find(mod => (util as any).testModReference(mod, reference, source));
}

export async function ruleFileListFulfilled(api: types.IExtensionApi,
  enabledMods: IModLookupInfo[], rule: IRule, source: { gameId: string, modId: string }) {
  if ((rule['ignored'] === true) || (rule?.['fileList']?.length ?? 0 === 0)) {
    return true;
  }
  const state = api.getState();
  const mods = state.persistent.mods[source.gameId];
  const ref = findReference(rule.reference, enabledMods, source);
  const mod = ref !== undefined ? mods[ref.id] : undefined;
  if (mod === undefined) {
    return false;
  }
  const stagingPath = selectors.installPathForGame(state, source.gameId);
  const modPath = path.join(stagingPath, mod.installationPath);
  const presentFiles = [];
  await turbowalk(modPath, entries => {
    for (const entry of entries) {
      if (!entry.isDirectory) {
        presentFiles.push(path.relative(modPath, entry.filePath));
      }
    }
  });
  return _.isEqual(presentFiles, rule['fileList']);
}

export function ruleInstallerChoicesFulfilled(mods: { [modId: string]: types.IMod },
  enabledMods: IModLookupInfo[], rule: IRule, source: { gameId: string, modId: string }) {
  if ((rule['ignored'] === true) || (rule?.['installerChoices']?.type !== 'fomod')) {
    return true;
  }

  if (['requires', 'recommends'].includes(rule.type)) {
    const ref = findReference(rule.reference, enabledMods, source);
    if (ref) {
      const modInstallerChoices = mods[ref.id]?.attributes?.installerChoices?.options;
      const ruleInstallerChoices = rule?.['installerChoices']?.options;
      const match = _.isEqual(modInstallerChoices, ruleInstallerChoices);
      return match;
    }
  }

  return null;
}

function ruleFulfilled(enabledMods: IModLookupInfo[], rule: IRule,
                       source: { gameId: string, modId: string }) {
  if (rule['ignored'] === true) {
    return true;
  }

  if (rule.type === 'conflicts') {
    enabledMods = enabledMods.filter(mod => mod.id !== source.modId);
    if (findReference(rule.reference, enabledMods, source) !== undefined) {
      return false;
    } else {
      return true;
    }
  } else if (rule.type === 'requires') {
    if (findReference(rule.reference, enabledMods, source) === undefined) {
      return false;
    } else {
      return true
    }
  } else {
    return null;
  }
}

export default ruleFulfilled;
