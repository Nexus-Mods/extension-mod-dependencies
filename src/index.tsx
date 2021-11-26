/**
 * Extension for editing and visualising mod dependencies
 */

import { IBiDirRule } from './types/IBiDirRule';
import { IConflict } from './types/IConflict';
import { IModLookupInfo } from './types/IModLookupInfo';
import determineConflicts from './util/conflicts';
import DependenciesFilter from './util/DependenciesFilter';
import findRule from './util/findRule';
import renderModLookup from './util/renderModLookup';
import ruleFulfilled from './util/ruleFulfilled';
import showUnsolvedConflictsDialog from './util/showUnsolvedConflicts';
import ConflictEditor from './views/ConflictEditor';
import ConflictGraph from './views/ConflictGraph';
import Connector from './views/Connector';
import DependencyIcon, { ILocalState } from './views/DependencyIcon';
import Editor from './views/Editor';
import ModNameWrapper from './views/ModNameWrapper';
import OverrideEditor from './views/OverrideEditor';

import { setConflictDialog, setConflictInfo, setEditCycle,
         setFileOverrideDialog } from './actions';
import connectionReducer from './reducers';
import { enabledModKeys } from './selectors';
import unsolvedConflictsCheck from './unsolvedConflictsCheck';

import Promise from 'bluebird';
import I18next, { TFunction, WithT } from 'i18next';
import * as _ from 'lodash';
import { ILookupResult, IModInfo, IReference, IRule, RuleType } from 'modmeta-db';
import * as path from 'path';
import * as React from 'react';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import * as Redux from 'redux';
import {} from 'redux-thunk';
import shortid = require('shortid');
import { actions, Icon, log, PureComponentEx, selectors, ToolbarIcon, tooltip, types, util } from 'vortex-api';

const CONFLICT_NOTIFICATION_ID = 'mod-file-conflict';
const UNFULFILLED_NOTIFICATION_ID = 'mod-rule-unfulfilled';

function makeReference(mod: IModInfo): IReference {
  return {
    fileExpression: mod.fileName !== undefined
      ? path.basename(mod.fileName, path.extname(mod.fileName))
      : undefined,
    fileMD5: mod.fileMD5,
    versionMatch: mod.fileVersion,
    logicalFileName: mod.logicalFileName,
  };
}

function inverseRule(ruleType: RuleType): RuleType {
  switch (ruleType) {
    case 'before': return 'after';
    case 'after': return 'before';
    case 'conflicts': return 'conflicts';
    default: throw new Error('unsupported rule ' + ruleType);
  }
}

function mapRules(source: IReference, rules: IRule[]): IBiDirRule[] {
  const res: IBiDirRule[] = [];
  if (rules === undefined) {
    return res;
  }
  rules.forEach(rule => {
    if (['requires', 'recommends', 'provides'].indexOf(rule.type) !== -1) {
      return;
    }
    res.push({
      source,
      type: rule.type,
      reference: rule.reference,
      original: true,
    });
    res.push({
      source: rule.reference,
      type: inverseRule(rule.type),
      reference: source,
      original: false,
    });
  });
  return res;
}

function updateMetaRules(api: types.IExtensionApi,
                         gameId: string,
                         mods: { [modId: string]: types.IMod }): Promise<IBiDirRule[]> {
  let rules: IBiDirRule[] = [];
  return Promise.map(Object.keys(mods || {}), modId => {
    const mod = mods[modId];
    if (mod.attributes === undefined) {
      return;
    }
    const ref = (util as any).makeModReference(mod);
    if ((ref.fileExpression === undefined)
       && (ref.fileMD5 === undefined)
       && (ref.logicalFileName === undefined)) {
      return;
    }
    rules = rules.concat(mapRules(ref, mod.rules));
    let downloadGame = mod.attributes['downloadGame'] || gameId;
    if (Array.isArray(downloadGame)) {
      downloadGame = downloadGame[0];
    }

    const state = api.store.getState();
    const downloadPath = selectors.downloadPathForGame(state, downloadGame);
    const fileName = mod.attributes?.fileName;
    const filePath = fileName !== undefined ? path.join(downloadPath, fileName) : undefined;

    return api.lookupModMeta({
      fileMD5: mod.attributes?.fileMD5,
      fileSize: mod.attributes?.fileSize,
      filePath,
      gameId: downloadGame,
    })
      .then((meta: ILookupResult[]) => {
        if ((meta.length > 0) && (meta[0].value !== undefined)) {
          rules = rules.concat(mapRules(makeReference(meta[0].value), meta[0].value.rules));
          if (mod.attributes?.fileMD5 === undefined) {
            api.store.dispatch(
              actions.setModAttribute(gameId, mod.id, 'fileMD5', meta[0].value.fileMD5));
          }
        }
      })
      .catch((err: Error) => {
        log('warn', 'failed to look up mod', { err: err.message, stack: err.stack });
      });
  })
  .then(() => rules);
}

const dependencyState = util.makeReactive<ILocalState>({
  modRules: [],
});

interface ILoadOrderState {
  [id: string]: number;
}

let loadOrder: ILoadOrderState = {};
let loadOrderChanged: () => void = () => undefined;
let dependenciesChanged: () => void = () => undefined;

function updateConflictInfo(api: types.IExtensionApi, gameId: string,
                            conflicts: { [modId: string]: IConflict[] }) {
  const t: typeof I18next.t = api.translate;
  const store: any = api.store;

  const mods = store.getState().persistent.mods[gameId];
  const unsolved: { [modId: string]: IConflict[] } = {};

  if (mods === undefined) {
    // normal before the first mod for a game is installed
    store.dispatch(actions.dismissNotification(CONFLICT_NOTIFICATION_ID));
    return;
  }

  const encountered = new Set<string>();

  const mapEnc = (lhs: string, rhs: string) => [lhs, rhs].sort().join(':');

  // see if there is a mod that has conflicts for which there are no rules
  Object.keys(conflicts).forEach(modId => {
    const filtered = conflicts[modId].filter(conflict =>
      (findRule(dependencyState.modRules, mods[modId], conflict.otherMod) === undefined)
      && !encountered.has(mapEnc(modId, conflict.otherMod.id)));

    if (filtered.length !== 0) {
      unsolved[modId] = filtered;
      filtered.forEach(conflict => {
        encountered.add(mapEnc(modId, conflict.otherMod.id));
      });
    }
  });

  if (Object.keys(unsolved).length === 0) {
    store.dispatch(actions.dismissNotification(CONFLICT_NOTIFICATION_ID));
  } else {
    const message: string[] = [
      t('There are unresolved file conflicts. This just means that two or more mods contain the '
        + 'same files and you need to decide which of them loads last and thus provides '
        + 'the files.\n'),
      '[table][tbody]',
    ].concat(Object.keys(unsolved).map(modId =>
      '[tr]' + t('[td]{{modName}}[/td]'
                + '[td][color="red"][svg]conflict[/svg][/color][/td]'
                + '[td][list]{{conflicts}}[/list][/td][/tr]', {
          replace: {
            modName: util.renderModName(mods[modId]),
            conflicts: unsolved[modId].map(
              conflict => '[*] ' + renderModLookup(conflict.otherMod)),
      }})), '[/tbody][/table]');
    const showDetails = () => {
      store.dispatch(actions.showDialog(
        'info',
        t('Unresolved file conflicts'), {
          bbcode: message.join('\n'),
          options: { translated: true, wrap: true },
        }, [
          { label: 'Close' },
          { label: 'Show', action: () => {
            showUnsolvedConflictsDialog(api, dependencyState.modRules, undefined, gameId);
           } },
      ]));
    };

    store.dispatch(actions.addNotification({
      type: 'warning',
      message: 'There are unresolved file conflicts',
      id: CONFLICT_NOTIFICATION_ID,
      noDismiss: true,
      actions: [{
        title: 'More',
        action: showDetails,
      }],
    }));
  }
}

function renderRuleType(t: typeof I18next.t, type: RuleType): string {
  switch (type) {
    case 'conflicts': return t('conflicts with');
    case 'requires': return t('requires');
    default: return 'unknown';
  }
}

function checkRulesFulfilled(api: types.IExtensionApi): Promise<void> {
  const t = api.translate;
  const store: any = api.store;
  const state = store.getState();
  const enabledMods: IModLookupInfo[] = enabledModKeys(state);
  const activeProfile = selectors.activeProfile(state);
  const gameMode = activeProfile.gameId;
  const mods = state.persistent.mods[gameMode];

  return Promise.map(enabledMods, modLookup => {
    const mod: types.IMod = mods[modLookup.id];

    let downloadGame = util.getSafe(mod.attributes, ['downloadGame'], gameMode);
    if (Array.isArray(downloadGame)) {
      downloadGame = downloadGame[0];
    }

    const downloadPath = selectors.downloadPathForGame(state, downloadGame);
    const fileName = mod.attributes?.fileName;
    const filePath = fileName !== undefined ? path.join(downloadPath, fileName) : undefined;

    return api.lookupModMeta({
      fileMD5: mod.attributes?.fileMD5,
      fileSize: mod.attributes?.fileSize,
      filePath,
      gameId: downloadGame,
    })
      .then((meta: ILookupResult[]) => {
        if ((meta.length > 0) && (mod.attributes?.fileMD5 === undefined)) {
          api.store.dispatch(
            actions.setModAttribute(gameMode, mod.id, 'fileMD5', meta[0].value.fileMD5));
        }
        // get both the rules from the meta server and the ones stored with the mod
        const rules: IRule[] = [].concat(
          ((meta.length > 0) && (meta[0].value !== undefined)) ? meta[0].value.rules || [] : [],
          util.getSafe(mods[modLookup.id], ['rules'], []),
        );
        const rulesUnfulfilled = rules.filter(rule =>
          ruleFulfilled(enabledMods, rule, { gameId: gameMode, modId: mod.id }) === false);
        const res: { modId: string, rules: IRule[] } = (rulesUnfulfilled.length === 0)
          ? null : {
            modId: mod.id,
            rules: rulesUnfulfilled,
          };

        if ((mod.attributes?.fileMD5 === undefined) && (meta?.[0]?.value !== undefined)) {
          store.dispatch(
            actions.setModAttribute(gameMode, mod.id, 'fileMD5', meta[0].value.fileMD5));
        }

        return Promise.resolve(res);
      });
  })
    .then((unfulfilled: Array<{ modId: string, rules: types.IModRule[] }>) => {
      // allow anyone else handle this to give more specific notifications, e.g.
      // based on mod type
      return Promise.map(unfulfilled.filter(iter => iter !== null), iter =>
        api.emitAndAwait('unfulfilled-rules', activeProfile.id, iter.modId, iter.rules)
          .then((result: boolean) => Promise.resolve(result
            ? undefined
            : iter)))
        .filter(iter => iter !== undefined);
    })
    .then((unfulfilled: Array<{ modId: string, rules: types.IModRule[] }>) => {
      const modsUnfulfilled = unfulfilled.filter(iter => iter !== null);

      if (modsUnfulfilled.length === 0) {
        store.dispatch(actions.dismissNotification(UNFULFILLED_NOTIFICATION_ID));
      } else {
        const hasRequired: Set<string> = new Set([]);

        const message: string[] = [
          t('There are mod dependency rules that aren\'t fulfilled.'),
          '[list]',
        ].concat(modsUnfulfilled.map(iter =>
          iter.rules.map((rule: types.IModRule) => {
            const modName = util.renderModName(mods[iter.modId]);
            if (rule.type === 'requires') {
              hasRequired.add(iter.modId);
            }
            const type = renderRuleType(t, rule.type);
            const other = (util as any).renderModReference(rule.reference, mods[rule.reference.id]);
            return `[*] "${modName}" ${type} "${other}"`;
          }).join('<br/>')))
          .concat(['[/list]']);

        const showDetails = () => {
          const dialogActions: types.IDialogAction[] = [ { label: 'Close' } ];

          if (hasRequired.size > 0) {
            dialogActions.push({
              label: 'Install Dependencies',
              action: () => {
                api.events.emit('install-dependencies', activeProfile.id, Array.from(hasRequired));
              },
            });
          }

          store.dispatch(actions.showDialog(
            'info',
            t('Unresolved file conflicts'), {
              bbcode: message.join('<br/>'),
              options: { translated: true, wrap: true },
            }, dialogActions));
        };

        store.dispatch(actions.addNotification({
          type: 'warning',
          message: 'Some mod dependencies are not fulfilled',
          id: UNFULFILLED_NOTIFICATION_ID,
          noDismiss: true,
          actions: [{
            title: 'More',
            action: showDetails,
          }],
        }));
      }
    });
}

// determine all conflicts and check if they are fulfilled or not
function checkConflictsAndRules(api: types.IExtensionApi): Promise<void> {
  const state = api.getState();
  const stagingPath = selectors.installPath(state);
  const gameMode = selectors.activeGameId(state);
  log('debug', 'check conflicts and rules', { gameMode });
  if (gameMode === undefined) {
    return Promise.resolve();
  }

  if ((state.session.base.activity?.installing_dependencies ?? []).length > 0) {
    log('info', 'skipping conflict check during dependency installation');
    return Promise.resolve();
  }

  const game = util.getGame(gameMode);
  if ((game === undefined) || (game.mergeMods === false)) {
    // in the case mergeMods === false, conflicts aren't possible because
    // each mod is deployed into a unique subdirectory.
    // we did *not* forget the case where mergeMods is a function!
    // If mergeMods is a function we don't expect conflicts but they are
    // technically possible if the name generated by mergeMods isn't unique.
    return Promise.resolve();
  }

  const discovery = selectors.currentGameDiscovery(state);
  if ((discovery === undefined) || (discovery.path === undefined)) {
    return Promise.resolve();
  }

  const modState = selectors.activeProfile(state).modState;
  const gameMods = state.persistent.mods[gameMode] ?? {};
  const mods = Object.keys(gameMods)
    .filter(modId => util.getSafe(modState, [modId, 'enabled'], false))
    .filter(modId => util.getModType(gameMods[modId].type)?.options?.['noConflicts'] !== true)
    .map(modId => state.persistent.mods[gameMode][modId]);
  const activator = util.getCurrentActivator(state, gameMode, true);

  api.store.dispatch(actions.startActivity('mods', 'conflicts'));
  return determineConflicts(api, game, stagingPath, mods, activator)
    .then(conflictMap => {
      if (!_.isEqual(conflictMap, state.session['dependencies'].conflicts)) {
        api.store.dispatch(setConflictInfo(conflictMap));
      }
      updateConflictInfo(api, gameMode, conflictMap);
      return checkRulesFulfilled(api);
    })
    .catch(err => {
      // 1392 means that the file/folder is corrupt/unreadable
      // 433 means that the storage device is not connected
      // Each are user hardware/environment issues which we can
      //  do nothing about.
      const allowReport = ![1392, 433].includes(err?.systemCode);
      api.showErrorNotification('Failed to determine conflicts', err, { allowReport });
    })
    .finally(() => {
      api.store.dispatch(actions.stopActivity('mods', 'conflicts'));
    });
}

function showCycles(api: types.IExtensionApi, cycles: string[][], gameId: string) {
  const state: types.IState = api.store.getState();
  const mods = state.persistent.mods[gameId];
  const id = shortid();
  api.showDialog('error', 'Cycles', {
    text: 'Dependency rules between your mods contain cycles, '
      + 'like "A after B" and "B after A". You need to remove one of the '
      + 'rules causing the cycle, otherwise your mods can\'t be '
      + 'applied in the right order.',
    links: cycles.map((cycle, idx) => (
      {
        label: cycle
          .map(modId => mods[modId] !== undefined ? util.renderModName(mods[modId]) : modId)
          .map(name => `[${name}]`)
          .join(' --> '),
        action: () => {
          api.closeDialog(id);
          api.store.dispatch(setEditCycle(gameId, cycle));
        },
      }
    )),
  }, [
    { label: 'Close' },
  ], id);
}

function updateCycles(api: types.IExtensionApi, cycles: string[][]) {
  const state = api.store.getState();
  if (state.session.dependencies.editCycle !== undefined) {
    // if we're already showing a cycle, update it if necessary
    const displayed = new Set<string>(state.session.dependencies.editCycle.modIds);
    // there could be multiple clusters so we have to find the one that corresponds
    // to the one being shown currently, it should be sufficient to find the cycle that
    // has one mod in common with the one being displayed.
    const update = cycles.find(cycle => cycle.find(modId => displayed.has(modId)) !== undefined);
    const gameId = selectors.activeGameId(state);
    api.store.dispatch(setEditCycle(update !== undefined ? gameId : undefined, update));
  }
}

function generateLoadOrder(api: types.IExtensionApi): Promise<void> {
  const store = api.store;
  const gameMode = selectors.activeGameId(store.getState());
  const state: types.IState = store.getState();
  const gameMods = state.persistent.mods[gameMode] || {};
  const profile = selectors.activeProfile(state);
  const mods = Object.keys(gameMods)
    .filter(key => util.getSafe(profile, ['modState', key, 'enabled'], false))
    .map(key => gameMods[key]);
  return util.sortMods(gameMode, mods, api)
    .then(sorted => {
      // no error in sorting? Close cycle editor if it's open
      const newState = api.store.getState();
      if (newState.session.dependencies.editCycle !== undefined) {
        api.store.dispatch(setEditCycle(undefined, undefined));
      }
      return Promise.resolve(sorted);
    })
    .catch(util.CycleError, err => {
      updateCycles(api, err.cycles);
      api.sendNotification({
        id: 'mod-cycle-warning',
        type: 'warning',
        message: 'Mod rules contain cycles',
        noDismiss: true,
        actions: [
          {
            title: 'Show', action: () => {
              showCycles(api, err.cycles, gameMode);
            },
          },
        ],
      });
      // return unsorted
      return Promise.resolve(mods);
    })
    .then((sortedMods: types.IMod[]) => {
      loadOrder = sortedMods
        .filter((mod: types.IMod) => util.getSafe(profile.modState, [mod.id, 'enabled'], false))
        .reduce(
          (prev: { [id: string]: number }, mod: types.IMod, idx: number) => {
            prev[mod.id] = idx;
            return prev;
          }, {});
      loadOrderChanged();
    })
    .catch(util.CycleError, () => {
      api.sendNotification({
        id: 'sorting-mods-failed',
        type: 'warning',
        title: 'Sorting mods failed',
        message: 'Rules contain cycles',
        displayMS: 5000,
      });
    });
}

function changeMayAffectRules(before: types.IMod, after: types.IMod): boolean {
  // if the mod is new or if it previously had no attributes and now has them,
  // this could affect the rules, if it had no rules before and now has them,
  // that most definitively affects rules
  if ((before === undefined)
    || ((before.attributes !== undefined) !== (after.attributes !== undefined))
    || ((before.rules !== undefined) !== (after.rules !== undefined))) {
    return true;
  }

  if (after.attributes === undefined) {
    return false;
  }

  return (before.rules !== after.rules)
      || (before.attributes['version'] !== after.attributes['version']);
}

function makeLoadOrderAttribute(api: types.IExtensionApi): types.ITableAttribute<types.IMod> {
  return {
    id: 'loadOrder',
    name: 'Deploy Order',
    description: 'Deploy order derived from mod dependencies',
    icon: 'order',
    placement: 'table',
    isToggleable: true,
    isSortable: true,
    isDefaultVisible: false,
    calc: (mod: types.IMod) => loadOrder[mod.id],
    condition: () => {
      const gameMode = selectors.activeGameId(api.store.getState());
      // if mergeMods is a function we could still actually get file conflicts, because
      // it's then not guaranteed that the mod path is unique
      return util.getGame(gameMode).mergeMods !== false;
    },
    edit: {},
    externalData: (onChange: () => void) => {
      loadOrderChanged = onChange;
    },
  };
}

function makeDependenciesAttribute(api: types.IExtensionApi): types.ITableAttribute<types.IMod> {
  const res: types.ITableAttribute<types.IMod> = {
    id: 'dependencies',
    name: 'Dependencies',
    description: 'Relations to other mods',
    icon: 'plug',
    placement: 'table',
    customRenderer: (mod, detailCell, t, props) => (
      <DependencyIcon
        mod={Array.isArray(mod) ? mod[0] : mod}
        t={t}
        localState={dependencyState}
        onHighlight={props.onHighlight}
      />
    ),
    condition: () => {
      const gameMode = selectors.activeGameId(api.store.getState());
      return util.getGame(gameMode).mergeMods !== false;
    },
    calc: (mod: types.IMod) => mod,
    isToggleable: true,
    isDefaultVisible: false,
    externalData: (onChange: () => void) => {
      dependenciesChanged = onChange;
    },
    edit: {},
    isSortable: true,
    isVolatile: true,
    sortFuncRaw: (lhs, rhs, locale) => {
      const filter = api.getState().settings.tables['mods'].filter?.['dependencies'] ?? [];

      if ((filter.length >= 2) && (filter[0] === 'depends')) {
        if (filter[1] === lhs.id) {
          return -1;
        } else if (filter[1] === rhs.id) {
          return 1;
        }
      }

      return util.renderModName(lhs).localeCompare(util.renderModName(rhs));
    },
    filter: new DependenciesFilter(dependencyState,
      () => {
        const state = api.store.getState();
        return util.getSafe(state, ['persistent', 'mods', selectors.activeGameId(state)], {});
      },
      () => util.getSafe(api.store.getState(), ['session', 'dependencies', 'conflicts'], {})),
  };

  return res;
}

function nothingNeeds(mod: types.IMod, among: types.IMod[], except: types.IMod) {
  const matchesMod = rule =>
    ['requires', 'recommends'].includes(rule.type)
    && util.testModReference(mod, rule.reference);

  return among.find(dependent => {
    return (dependent.id !== except.id)
        && (dependent.rules.find(matchesMod) !== undefined);
  }) === undefined;
}

function setDependenciesEnabled(profileId: string,
                                dependent: types.IMod,
                                mods: { [modId: string]: types.IMod },
                                recommendations: boolean,
                                enabled: boolean,
                                allDependents: types.IMod[]): Redux.Action[] {
  const filter = recommendations ? ['requires', 'recommends'] : ['requires'];

  return dependent.rules
    .filter(rule => filter.includes(rule.type))
    .map(rule => {
      const mod = util.findModByRef(rule.reference, mods);
      if ((mod !== undefined)
          && (enabled || nothingNeeds(mod, allDependents, dependent))) {
        return actions.setModEnabled(profileId, mod.id, enabled);
      } else {
        return undefined;
      }
    })
    .filter(act => act !== undefined)
    ;
}

function queryEnableDependencies(api: types.IExtensionApi,
                                 modIds: string[],
                                 gameMode: string,
                                 enabled: boolean)
                                 : Promise<void> {
  const t = api.translate;
  const state = api.getState();
  const mods = state.persistent.mods[gameMode];

  const profile = selectors.lastActiveProfileForGame(state, gameMode);

  const dependents = modIds.filter(id => ((mods[id]?.rules ?? []).find(rule =>
    ['requires', 'recommends'].includes(rule.type)) !== undefined));
  if (dependents.length > 0) {
    const dialogActions = [
      { label: 'Close' },
      { label: enabled ? 'Enable' : 'Disable' },
    ];
    // review option only available if it's a single mod with dependencies
    if (dependents.length === 1) {
      dialogActions.splice(1, 0, { label: 'Review' });
    }
    let text = 'The mod you {{enabled}} depends on other mods, do you want to {{enable}} those '
      + 'as well?';
    if (!enabled) {
      text += '\nThis will only disable mods not required by something else but it may disable '
        + 'ones you had already enabled manually.';
    }
    return api.showDialog('question', 'Mod has dependencies', {
      text,
      checkboxes: [
        { id: 'recommendations', text: 'Apply to Recommended Mods', value: false },
      ],
      parameters: {
        enabled: enabled ? t('enabled') : t('disabled'),
        enable: enabled ? t('enable') : t('disable'),
      },
    }, dialogActions)
      .then(result => {
        if (result.action === 'Review') {
          const batch = [];
          batch.push(actions.setAttributeFilter('mods', 'dependencies',
            ['depends', dependents[0], util.renderModName(mods[dependents[0]])]));
          batch.push(actions.setAttributeSort('mods', 'dependencies', 'asc'));
          util.batchDispatch(api.store, batch);
          api.events.emit('show-main-page', 'Mods');
        } else if (['Enable', 'Disable'].includes(result.action)) {
          const recommendationsToo = result.input['recommendations'];

          // all mods that have any dependencies
          const allDependents = Object.values(mods)
            .filter(mod => (mod.rules ?? [])
              .find(rule => ['requires', 'recommends'].includes(rule.type)));

          const batch: Redux.Action[] = dependents.reduce((prev, modId) => {
            return [].concat(prev, ...setDependenciesEnabled(profile, mods[modId], mods,
              recommendationsToo, enabled, allDependents));
          }, []);
          util.batchDispatch(api.store, batch);
        }
      });
  } else {
    return Promise.resolve();
  }
}

function once(api: types.IExtensionApi) {
  const store = api.store;

  const updateRulesDebouncer = new util.Debouncer((gameMode: string) => {
    const state = store.getState();
    return generateLoadOrder(api)
      .then(() => updateMetaRules(api, gameMode, state.persistent.mods[gameMode]))
      .then(rules => {
        dependencyState.modRules = rules;
        // need to manually update any open conflict dialog - that's not pretty...
        const { conflictDialog } = store.getState().session.dependencies;
        if (!!conflictDialog) {
          store.dispatch(setConflictDialog(conflictDialog.gameId, conflictDialog.modIds, rules));
        }
        dependenciesChanged();
        return null;
      })
      .catch(err => {
        api.showErrorNotification('Failed to refresh mod rules', err);
      });
  }, 200);

  const updateConflictDebouncer = new util.Debouncer(() =>
    checkConflictsAndRules(api)
      .catch(err => {
        api.showErrorNotification('Failed to determine mod conflicts', err);
      }), 2000);

  api.setStylesheet('dependency-manager',
    path.join(__dirname, 'dependency-manager.scss'));

  api.events.on('profile-did-change', () => {
    const gameMode = selectors.activeGameId(store.getState());
    updateMetaRules(api, gameMode, store.getState().persistent.mods[gameMode])
      .then(rules => {
        dependencyState.modRules = rules;
        dependenciesChanged();
        updateConflictDebouncer.schedule(undefined);
      })
      .catch(err => {
        api.showErrorNotification('failed to update mod rule cache', err);
      });
  });

  api.events.on('gamemode-activated', (gameMode: string) => {
    // We just changed gamemodes - we should clear up any
    //  existing conflict information.
    log('debug', 'game mode activated, updating conflict info', { gameMode });
    store.dispatch(setConflictInfo(undefined));
    updateConflictInfo(api, gameMode, {});
    updateRulesDebouncer.schedule(() => {
      updateConflictDebouncer.schedule(undefined);
    }, gameMode);
  });

  api.events.on('edit-mod-cycle', (gameId: string, cycle: string[]) => {
    store.dispatch(setEditCycle(gameId, cycle));
  });

  api.onAsync('did-remove-mod',
    (gameMode: string,
     removedId: string,
     options: { willBeReplaced?: boolean, modData?: types.IMod }) => {
      if ((options?.willBeReplaced) || (options?.modData === undefined)) {
        // The mod is being re-installed or replaced by an update;
        //  don't remove any rules.
        return Promise.resolve();
      }
      const state = api.getState();
      const mods: { [modId: string]: types.IMod } = state.persistent.mods[gameMode] ?? {};
      Object.keys(mods).forEach(id => {
        // remove all locally defined rules referring to that mod
        const rulesToRemove = (mods[id].rules ?? []).filter((rule: types.IModRule) =>
          ['before', 'after'].includes(rule.type)
          && util.testModReference(options.modData, rule.reference));

        rulesToRemove.forEach(rule => {
          api.store.dispatch(actions.removeModRule(gameMode, id, rule));
        });
      });

      return Promise.resolve();
  });

  api.onStateChange(['persistent', 'mods'], (oldState, newState) => {
    const gameMode = selectors.activeGameId(store.getState());
    if (oldState[gameMode] !== newState[gameMode]) {
      const relevantChange = Object.keys(newState[gameMode])
        .find(modId =>
          (util.getSafe(oldState, [gameMode, modId], undefined) !== newState[gameMode][modId])
          && (changeMayAffectRules(util.getSafe(oldState, [gameMode, modId], undefined),
                                   newState[gameMode][modId])));

      if (relevantChange !== undefined) {
        updateRulesDebouncer.schedule(() => {
          updateConflictDebouncer.schedule(undefined);
        }, gameMode);
      }
    }
  });

  api.onAsync('will-enable-mods', (profileId: string, modIds: string[],
                                   enabled: boolean, options) => {
    if (options?.installed) {
      return Promise.resolve();
    }
    const profile = selectors.profileById(api.getState(), profileId);
    return queryEnableDependencies(api, modIds, profile.gameId, enabled)
      .catch(err => {
        api.showErrorNotification('Failed to test for dependencies', err);
      });
  });

  api.events.on('mods-enabled', (modIds: string[], enabled: boolean, gameMode: string,
                                 options?: { silent: boolean, installed: boolean }) => {
    if (gameMode === selectors.activeGameId(store.getState())) {
      updateRulesDebouncer.schedule(() => {
        updateConflictDebouncer.schedule(undefined);
      }, gameMode);
    }
  });
}

interface IManageRuleButtonProps {
  notifications: types.INotification[];
  onClick: () => void;
}

class ManageRuleButtonImpl extends PureComponentEx<IManageRuleButtonProps & WithT, {}> {
  public render() {
    const { t, onClick, notifications } = this.props;
    const hasConflicts = notifications.find(iter => iter.id === CONFLICT_NOTIFICATION_ID);
    return (
      <ToolbarIcon
        id='manage-mod-rules-button'
        icon='connection'
        text={t('Manage Rules')}
        className={hasConflicts ? 'toolbar-flash-button' : undefined}
        onClick={onClick}
      />
    );
  }
}
function mapStateToProps(state: types.IState) {
  return {
    notifications: state.session.notifications.notifications,
  };
}

const ManageRuleButton = withTranslation(['common'])(
  connect(mapStateToProps)(ManageRuleButtonImpl) as any);

function main(context: types.IExtensionContext) {
  context.registerReducer(['session', 'dependencies'], connectionReducer);
  context.registerTableAttribute('mods', makeLoadOrderAttribute(context.api));
  context.registerTableAttribute('mods', makeDependenciesAttribute(context.api));
  context.registerAction('mod-icons', 90, ManageRuleButton, {}, () => {
    const state: types.IState = context.api.store.getState();
    return {
      notifications: state.session.notifications.notifications,
      onClick: () => showUnsolvedConflictsDialog(context.api, dependencyState.modRules, true),
    };
  });
  context.registerDialog('mod-dependencies-connector', Connector);
  context.registerDialog('mod-dependencies-editor', Editor);
  context.registerDialog('mod-conflict-editor', ConflictEditor);
  context.registerDialog('mod-cycle-graph', () => (
    <ConflictGraph
      width={500}
      height={500}
      nodeDistance={80}
      nodeRadius={10}
      localState={dependencyState}
    />
  ));
  context.registerDialog('mod-fileoverride-editor', OverrideEditor, () => ({
    localState: dependencyState,
  }));
  context.registerAction('mods-action-icons', 100, 'groups', {}, 'Manage File Conflicts',
    instanceIds => {
      const { store } = context.api;
      const gameMode = selectors.activeGameId(store.getState());
      store.dispatch(setFileOverrideDialog(gameMode, instanceIds[0]));
    }, instanceIds => {
      const { store, translate } = context.api;
      return (util.getSafe(store.getState(),
                           ['session', 'dependencies', 'conflicts', instanceIds[0]],
                           [])
        .length > 0) ? true : 'No file conflicts';
    });

  context.registerControlWrapper('mods-name', 100, ModNameWrapper);

  context.registerStartHook(50, 'check-unsolved-conflicts',
    (input: types.IRunParameters) => (input.options.suggestDeploy !== false)
        ? unsolvedConflictsCheck(context.api, dependencyState.modRules, input)
        : Promise.resolve(input));

  context.once(() => once(context.api));

  return true;
}

export default main;
