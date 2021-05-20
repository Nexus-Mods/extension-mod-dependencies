import { IModLookupInfo } from '../types/IModLookupInfo';

import { IReference, IRule } from 'modmeta-db';
import { util } from 'vortex-api';

function findReference(reference: IReference, mods: IModLookupInfo[],
                       source: { gameId: string, modId: string }): IModLookupInfo {
  if (reference['idHint'] !== undefined) {
    const refMod = mods.find(mod => mod.id === reference['idHint']);
    if (util.testModReference(refMod, reference)) {
      return refMod;
    }
  }
  return mods.find(mod => (util as any).testModReference(mod, reference, source));
}

function ruleFulfilled(enabledMods: IModLookupInfo[], rule: IRule,
                       source: { gameId: string, modId: string }) {
  if (rule.type === 'conflicts') {
    if (findReference(rule.reference, enabledMods, source) !== undefined) {
      return false;
    } else {
      return true;
    }
  } else if (rule.type === 'requires') {
    if (findReference(rule.reference, enabledMods, source) === undefined) {
      return false;
    } else {
      return true;
    }
  } else {
    return null;
  }
}

export default ruleFulfilled;
