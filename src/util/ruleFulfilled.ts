import { IModLookupInfo } from '../types/IModLookupInfo';

import { IReference, IRule } from 'modmeta-db';
import { util } from 'vortex-api';

function findReference(reference: IReference, mods: IModLookupInfo[]): IModLookupInfo {
  return mods.find(mod => (util as any).testModReference(mod, reference));
}

function ruleFulfilled(enabledMods: IModLookupInfo[], rule: IRule) {
  if (rule.type === 'conflicts') {
    if (findReference(rule.reference, enabledMods) !== undefined) {
      return false;
    } else {
      return true;
    }
  } else if (rule.type === 'requires') {
    if (findReference(rule.reference, enabledMods) === undefined) {
      return false;
    } else {
      return true;
    }
  } else {
    return null;
  }
}

export default ruleFulfilled;
