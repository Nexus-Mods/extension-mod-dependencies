import { highlightConflictIcon } from '../actions';

import { actions, types } from 'vortex-api';

function showConflicts(api: types.IExtensionApi) {
  const store = api.store;
  store.dispatch(actions.setAttributeVisible('mods', 'dependencies', true));
  store.dispatch(actions.setAttributeFilter('mods', undefined, undefined));
  store.dispatch(actions.setAttributeFilter('mods', 'dependencies', 'has-unsolved'));
  api.events.emit('show-main-page', 'Mods');
  setTimeout(() => {
    store.dispatch(highlightConflictIcon(true));
  }, 1000);
  setTimeout(() => {
    store.dispatch(highlightConflictIcon(false));
  }, 3000);
}

export default showConflicts;