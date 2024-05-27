/* eslint-disable */
import { IPathToolsExt } from '../types/IPathTools';
import React, { useContext } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { useTranslation } from 'react-i18next';

import { actions, tooltip, types, selectors, MainContext, util } from 'vortex-api';
import { Checkbox } from 'react-bootstrap';

export interface IFileOverridesWidget {
  mod: types.IMod;
  pathTool: IPathToolsExt;
  allowApply: () => boolean;
  activities: any;
}

interface IFileOverride {
  mod: types.IMod;
  filePath: string;
  relPath: string;
  enabled: boolean;
}

interface IItemProps {
  fileOverride: IFileOverride;
  onChangeFileOverride: (evt: any) => void;
}

function renderItem(props: IItemProps) {
  const { fileOverride, onChangeFileOverride } = props;
  return (
    <Checkbox key={fileOverride.filePath} className='file-override-widget-item'
      checked={fileOverride.enabled}
      onChange={onChangeFileOverride}
      label={fileOverride.relPath}
      data-override={fileOverride.relPath}
    >
      {fileOverride.relPath}
    </Checkbox>
  );
}

function FileOverridesWidget(props: IFileOverridesWidget) {
  const profile = useSelector<types.IState, types.IProfile>(selectors.activeProfile);
  const dispatch = useDispatch();
  const context = useContext(MainContext);
  const { t } = useTranslation();
  const [fileOverrides, setFileOverrides] = React.useState([] as IFileOverride[]);
  const [stateAllowApply, setStateAllowApply] = React.useState(true);
  const { mod, pathTool, allowApply, activities } = props;
  const overrides: IFileOverride[] = React.useMemo(() => {
    return (mod?.fileOverrides || []).reduce((accum, fileOverride) => {
      const relPath = pathTool.toRelPath(mod, fileOverride);
      const override: IFileOverride = {
        mod,
        filePath: fileOverride,
        relPath,
        enabled: true,
      }
      accum.push(override);
      return accum;
    }, []);
  }, [mod?.fileOverrides]);
  const onClick = React.useCallback(() => {
    dispatch(actions.setFileOverride(profile.gameId, mod.id,
      fileOverrides.reduce((accum, f) => f.enabled ? accum.concat(f.filePath) : accum, [])));
    context.api.events.emit('recalculate-modtype-conflicts', [mod.id]);
  }, [context, dispatch, profile, mod, fileOverrides]);

  React.useEffect(() => {
    const suppress: boolean = allowApply();
    if (stateAllowApply !== (!suppress)) {
      setStateAllowApply(!suppress);
    }
    else if (Object.keys(util.objDiff({ overrides }, { overrides: [...fileOverrides] })).length > 0) {
      setFileOverrides(overrides);
    }
    return () => setFileOverrides([]);
  }, [overrides, setFileOverrides, activities]);

  const changeFileOverrides = React.useCallback((evt) => {
    const enabled = evt.target.checked;
    const relPath = evt.target.getAttribute('data-override');
    const newFileOverrides = fileOverrides.map(f => f.relPath === relPath ? { ...f, enabled } : f);
    setFileOverrides(newFileOverrides);
  }, [fileOverrides, setFileOverrides]);

  return (
    <div className='file-override-widget-item-list'>
      {fileOverrides.map(fileOverride => (
        renderItem({
          fileOverride,
          onChangeFileOverride: (override: IFileOverride) => changeFileOverrides(override),
        })
      ))}
      <tooltip.Button
        onClick={onClick}
        tooltip={t('Apply file override changes - will recalculate conflicts (Vortex may Deploy/Purge if required)')}
        disabled={stateAllowApply === false || fileOverrides.length === 0}
      >
        {t('Apply')}
      </tooltip.Button>
    </div>
  );
}

export default FileOverridesWidget;
