/* eslint-disable */
import { actions, selectors, types, util } from 'vortex-api';
import { setModTypeConflictsSetting } from '../actions';

const getNonDefaultModTypes = (mod: types.IMod) => {
  return mod?.type !== '';
}

const allRules = (graph: types.IMod[]): { [sourceId: string]: types.IModRule[] } => {
  return graph.reduce((accum, val) => {
    if (val.rules !== undefined && val.rules.length > 0) {
      accum[val.id] = val.rules;
    }
    return accum;
  }, {})
}

const findModsByRules = (mod, modsMap) => {
  const mods = (mod.rules ?? []).reduce((accum, iter) => {
    const modByRef = modsMap[iter.reference.id];
    if (modByRef !== undefined && util.testModReference(modByRef, iter.reference)) {
      accum.push(iter);
    }
    return accum
  }, []);
  return mods;
}

async function findAffectedMods(api: types.IExtensionApi, gameId: string) {
  const state = api.getState();
  const mods: { [modId: string]: types.IMod } = util.getSafe(state, ['persistent', 'mods', gameId], {});
  const graph: types.IMod[] = Object.values(mods).map(m => m);
  const graphRules = allRules(graph);
  const nonDefaultMods = graph.filter(getNonDefaultModTypes);
  const affectedMods = nonDefaultMods.reduce((accum, mod) => {
    for (const [sourceId, rules] of Object.entries(graphRules)) {
      const matchingRules = rules.filter(rule => mods[sourceId].type !== mod.type && util.testModReference(mod, rule.reference));
      if (matchingRules.length > 0) {
        if ((mod.fileOverrides ?? []).length > 0) {
          accum[mod.id] = util.renderModName(mod);
        }
        if (sourceId !== mod.id && (mods[sourceId]?.fileOverrides ?? []).length > 0) {
          accum[sourceId] = util.renderModName(mod);
        }
      }
    }
    return accum;
  }, {});

  return affectedMods;
}

export async function disableModTypeConflictsDialog(api: types.IExtensionApi) {
  const t = api.translate;
  const gameId = selectors.activeGameId(api.getState());
  const relevant = await findAffectedMods(api, gameId);
  const checkboxes = Object.keys(relevant).length > 0
    ? [{ id: 'remove_file_overrides', text: t('Remove file overrides'), value: true }]
    : undefined;
  const message = Object.keys(relevant).length > 0
    ? t('You have {{total}} mod\\s with file overrides that is\\are involved in a modType conflict:\n',
      { replace: { total: Object.keys(relevant).length } }) + Object.values(relevant).join('\n')
    : undefined;
  const res: types.IDialogResult | undefined = await api?.showDialog?.('question', 'Disabling Cross-ModType Conflicts', {
    bbcode: t('You are about to disable mod type conflicts - this is not recommended as Cross-ModType conflicts '
      + 'do not adhere to regular deployment rules, and are guaranteed to break your modding environment when present.[br][/br][br][/br]'
      + 'Please note that if you proceed, and you have such conflicts, the external changes dialog '
      + 'will be raised constantly after each deployment/purge event until you have manually removed the conflicting files (or disabled '
      + 'the mod/s that is/are causing the conflict).[br][/br][br][/br]'
      + 'Vortex will remove any file overrides that had been created to mitigate Cross-ModType Conflicts by default, but please be aware '
      + 'that ALL file overrides will be removed from the mods mentioned below (including those you may have added manually). '
      + 'Uncheck the box if you would rather do this manually.'),
    message,
    checkboxes,
    options: { order: ['bbcode', 'checkboxes', 'message'] },
  }, [
    { label: 'Cancel' },
    { label: 'Proceed' },
  ],
    'dependency-manager-disable-modtype-conflicts-dialog');
  if (res === undefined || res?.action === 'Cancel') {
    throw new util.UserCanceled();
  }

  let batchedActions = [setModTypeConflictsSetting(false)];
  const removeOverrides = res.input?.remove_file_overrides;
  if (removeOverrides) {
    const overrideActions: any[] = Object.keys(relevant).map(id => actions.setFileOverride(gameId, id, []));
    batchedActions = batchedActions.concat(overrideActions);
  }
  util.batchDispatch(api.store, batchedActions);
}