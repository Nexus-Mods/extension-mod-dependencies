import { selectors, types } from 'vortex-api';
import { setConflictDialog } from '../actions';
import { IBiDirRule } from '../types/IBiDirRule';
import findRule from './findRule';

function showUnsolvedConflictsDialog(api: types.IExtensionApi, modRules: IBiDirRule[], showAll?: boolean) {
  const state: types.IState = api.store.getState();
  const gameMode = selectors.activeGameId(state);
  const mods = state.persistent.mods[gameMode]

  const conflicts = (state.session as any).dependencies.conflicts;

  let modsToShow = Object.keys(conflicts);
  
  if (!showAll) {
    modsToShow = modsToShow.filter(modId => conflicts[modId].find(conflict => {
      if (conflict.otherMod === undefined) {
        return false;
      }
      const rule = findRule(modRules, mods[modId], conflict.otherMod);
      return rule === undefined;
    }) !== undefined);
  }

  if (modsToShow.length > 0 || showAll) {
    api.store.dispatch(setConflictDialog(gameMode, modsToShow, modRules));
  }
}

export default showUnsolvedConflictsDialog;
