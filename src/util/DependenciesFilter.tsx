import { ILocalState } from '../views/DependencyIcon';

import * as React from 'react';
import Select from 'react-select';
import { types, util } from 'vortex-api';
import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';
import { IModLookupInfo } from '../types/IModLookupInfo';

export class DependenciesFilterComponent extends React.Component<types.IFilterProps, {}> {
  public render(): JSX.Element {
    const { filter } = this.props;

    const options = [
      { value: 'has-conflict', label: 'Conflict' },
      { value: 'has-unsolved', label: 'Unsolved' },
    ];
    return (
      <Select
        className='select-compact'
        options={options}
        value={filter}
        onChange={this.changeFilter}
        searchable={false}
        onInputChange={() => null}
      />
    );
  }

  private changeFilter = (filter: { value: string, label: string }) => {
    const { attributeId, onSetFilter } = this.props;
    onSetFilter(attributeId, filter ? filter.value : undefined);
  }
}

class DependenciesFilter implements types.ITableFilter {
  public component = DependenciesFilterComponent;
  public raw = true;
  public dataId = 'id';

  private mLocalState: ILocalState;
  private mGetMods: () => { [modId: string]: types.IMod };
  private mGetConflicts: () => { [modId: string]: IConflict[] };

  constructor(localState: ILocalState,
              getMods: () => { [modId: string]: types.IMod },
              getConflicts: () => { [modId: string]: IConflict[] }) {
    this.mLocalState = localState;
    this.mGetMods = getMods;
    this.mGetConflicts = getConflicts;
  }

  public matches(filter: string, value: string): boolean {
    // TODO: not trivial to implement, because the value doesn't contain
    //   any information about file conflicts
    if (filter === 'has-conflict') {
      const conflicts = this.mGetConflicts();
      
      if (conflicts === undefined) {
        return false;
      }

      return (conflicts[value] !== undefined) && (conflicts[value].length > 0);
    } else if (filter === 'has-unsolved') {
      const conflicts = this.mGetConflicts();
      const mods = this.mGetMods();

      if ((mods === undefined) || (mods[value] === undefined)) {
        return false;
      }

      const unsolvedConflict = (conflicts[value] || []).find(conflict => {
        if (conflict.otherMod === undefined) {
          return false;
        }
        const rule = this.findRule(mods[value], conflict.otherMod);
        return rule === undefined;
      });

      return unsolvedConflict !== undefined;
    } else {
      return true;
    }
  }

  private findRule(source: types.IMod, ref: IModLookupInfo): IBiDirRule {
    return this.mLocalState.modRules.find(rule =>
      util.testModReference(source, rule.source)
      && util.testModReference(ref, rule.reference));
  }
}

export default DependenciesFilter;
