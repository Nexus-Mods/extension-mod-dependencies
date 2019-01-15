import * as Promise from 'bluebird';
import { selectors, types, util } from 'vortex-api';
import { IConflict } from './types/IConflict';
import { IModLookupInfo } from './types/IModLookupInfo';
import { IBiDirRule } from './types/IBiDirRule';
import showUnsolvedConflictsDialog from './util/showUnsolvedConflicts';

function unsolvedConflictsCheck(api: types.IExtensionApi, modRules: IBiDirRule[], input: types.IRunParameters): Promise<types.IRunParameters> {
  const state = api.store.getState();
  const t = api.translate;

  const findRule = (source: types.IMod, ref: IModLookupInfo): IBiDirRule => {
    return modRules.find(rule =>
      util.testModReference(source, rule.source)
      && util.testModReference(ref, rule.reference));
  }

  const mods = util.getSafe(state, ['persistent', 'mods', selectors.activeGameId(state)], {});
  const conflicts: { [modId: string]: IConflict[] } = util.getSafe(api.store.getState(), ['session', 'dependencies', 'conflicts'], {});

  // find the first conflict that has no rule associated
  const firstConflict = Object.keys(conflicts).find(modId =>
    conflicts[modId].find(conflict => findRule(mods[modId], conflict.otherMod) === undefined) !== undefined);
  if (firstConflict !== undefined) {
    return api.showDialog('error', t('Unsolved Conflict'), {
      bbcode: t('You have unsolved file conflicts {{more}}. In some cases this can lead to incompatible files being used which can cause all '
            + 'kind of problems inside the game.\n'
            + 'Please address all file conflicts before running the game.', {
              replace: { more: `[More id='more-conflict' wikiId='file-conflicts' name='${t('Conflicts')}']${util.getText('mod', 'conflicts', t)}[/More]` }
            }),
    },
      [
        { label: 'Cancel' },
        { label: 'Show' }
      ]
    )
    .then((result: types.IDialogResult) => {
      if (result.action === 'Show') {
        showUnsolvedConflictsDialog(api, modRules);
      }
      return Promise.reject(new util.ProcessCanceled('Unsolved File conflicts'));
    });
  } else { 
    return Promise.resolve(input);
  }
}

export default unsolvedConflictsCheck;
