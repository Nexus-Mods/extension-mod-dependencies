import * as React from 'react';
import Select from 'react-select';
import { types, util } from 'vortex-api';
import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';
import { IModLookupInfo } from '../types/IModLookupInfo';
import { ILocalState } from '../views/DependencyIcon';

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
  public raw = false;

  private mGetStore: () => Redux.Store<types.IState>;
  private mLocalState: ILocalState;

  constructor(store: () => Redux.Store<types.IState>, state: ILocalState) {
    this.mGetStore = store;
    this.mLocalState = state;
  }

  public matches(filter: string, value: types.IMod): boolean {
    const state = this.mGetStore().getState();
    const conflicts: { [modId: string]: IConflict[] } =
      (state.session as any).dependencies.conflicts;

    // TODO: not trivial to implement, because the value doesn't contain
    //   any information about file conflicts
    if (filter === 'has-conflict') {
      return conflicts[value.id] !== undefined;
    } else if (filter === 'has-unsolved') {
      return (conflicts[value.id] !== undefined)
        && (conflicts[value.id].find(conflict => {
          const rule = this.findRule(conflict.otherMod);
          return rule === undefined;
        }) !== undefined);
    } else {
      return true;
    }
  }

  private findRule(ref: IModLookupInfo): IBiDirRule {
    return this.mLocalState.modRules.find(rule => util.testModReference(ref, rule.reference));
  }
}

export default DependenciesFilter;
