/* eslint-disable */
import { IModLookupInfo } from './types/IModLookupInfo';

import * as _ from 'lodash';
import { createSelector } from 'reselect';
import { selectors, types, util } from 'vortex-api';

const allMods = (state: types.IState) => state.persistent.mods;

const currentGameMods = createSelector(allMods, selectors.activeGameId, (inMods, gameId) =>
  inMods[gameId]);

const modState = createSelector(selectors.activeProfile, (profile) =>
  profile ? profile.modState : {});

let lastLookupInfo: IModLookupInfo[];

export const enabledModKeys = createSelector(currentGameMods, modState, (mods, modStateIn) => {
  const res: IModLookupInfo[] = [];

  Object.keys(mods || {}).forEach(modId => {
    const attributes = mods[modId].attributes || {};
    if (util.getSafe(modStateIn, [modId, 'enabled'], false)
        && (attributes['fileMD5'] || attributes['fileName']
            || attributes['logicalFileName'] || attributes['name'])) {
      res.push({
        ...attributes,
        id: modId,
      } as any);
    }
  });

  // avoid changing the object if content didn't change. reselect avoids recalculating unless input
  // changes but it's very possible mods/modState changes without causing the enabled-keys to change
  if (!_.isEqual(res, lastLookupInfo)) {
    lastLookupInfo = res;
  }

  return lastLookupInfo;
});

let lastOverrideLookup: types.IMod[];
export const modsWithOverrides = createSelector(currentGameMods, modState, (mods, modStateIn) => {
  const res: types.IMod[] = [];

  Object.keys(mods || {}).forEach(modId => {
    if (util.getSafe(modStateIn, [modId, 'enabled'], false) && (mods?.[modId].fileOverrides ?? []).length > 0) {
      res.push(mods[modId]);
    }
  });
  if (!_.isEqual(res, lastLookupInfo)) {
    lastOverrideLookup = res;
  }

  return lastOverrideLookup;
});
