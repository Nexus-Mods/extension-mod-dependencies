import { selectors, types } from 'vortex-api';
import { setConflictDialog } from '../actions';
import { IBiDirRule } from '../types/IBiDirRule';
import findRule from './findRule';

function showUnsolvedConflictsDialog(api: types.IExtensionApi, modRules: IBiDirRule[], force?: boolean) {
  const state: types.IState = api.store.getState();
  const gameMode = selectors.activeGameId(state);
  const mods = state.persistent.mods[gameMode]

  const conflicts = (state.session as any).dependencies.conflicts;

  const unsolvedMods = Object.keys(conflicts).filter(modId => conflicts[modId].find(conflict => {
    if (conflict.otherMod === undefined) {
      return false;
    }
    const rule = findRule(modRules, mods[modId], conflict.otherMod);
    return rule === undefined;
  }) !== undefined);
  if ((unsolvedMods.length > 0) || force) {
    api.store.dispatch(setConflictDialog(gameMode, unsolvedMods, modRules));
  }
}

export default showUnsolvedConflictsDialog;
