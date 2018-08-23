import { IConflict } from '../types/IConflict';

import { setFileOverrideDialog } from '../actions';

import SearchBox, { ISearchMatch } from './SearchBox';

import * as nodePath from 'path';
import * as React from 'react';
import { Button, Dropdown, MenuItem, Modal } from 'react-bootstrap';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import * as TreeT from 'react-sortable-tree';
import { } from 'react-sortable-tree-theme-file-explorer';
import * as Redux from 'redux';
import { actions, ComponentEx, DNDContainer, types, util } from 'vortex-api';

interface IFileTree {
  title: string;
  path: string;
  providers: string[];
  selected: string;
  children: IFileTree[];
  isDirectory: boolean;
  expanded: boolean;
}

interface IConnectedProps {
  gameId: string;
  modId: string;
  conflicts: IConflict[];
  mods: { [modId: string]: types.IMod };
}

interface IActionProps {
  onSetFileOverride: (gameId: string, modId: string, files: string[]) => void;
  onClose: () => void;
}

type IProps = IConnectedProps & IActionProps;

interface IComponentState {
  treeState: IFileTree[];
  sortedMods: string[];
  searchString: string;
  searchIndex: number;
  searchMatches: ISearchMatch[];
}

class OverrideEditor extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);
    this.initState({
      treeState: [],
      sortedMods: [],
      searchString: '',
      searchIndex: 0,
      searchMatches: [],
    });
  }

  public componentWillMount() {
    this.sortedMods(this.props)
      .then(sorted => {
        this.nextState.sortedMods = sorted;
      });
  }

  public componentWillReceiveProps(newProps: IProps) {
    if ((newProps.modId !== this.props.modId)
        || (newProps.gameId !== this.props.gameId)
        || (newProps.conflicts !== this.props.conflicts)) {
      this.nextState.treeState = this.toTree(newProps);
    }

    if (newProps.mods !== this.props.mods) {
      this.sortedMods(newProps).then(sorted => {
        this.nextState.sortedMods = sorted;
        this.nextState.treeState = this.toTree(newProps);
      });
    }
  }

  public render(): JSX.Element {
    const { t, modId, mods } = this.props;
    const { searchString, searchIndex, searchMatches, treeState } = this.state;

    const modName = mods[modId] !== undefined
      ? util.renderModName(mods[modId])
      : '';

    const Tree: typeof TreeT.SortableTreeWithoutDndContext =
      require('react-sortable-tree').SortableTreeWithoutDndContext;
    const FileExplorerTheme = require('react-sortable-tree-theme-file-explorer');

    return (
      <Modal id='file-override-dialog' show={modId !== undefined} onHide={this.close}>
        <Modal.Header><Modal.Title>{modName}</Modal.Title></Modal.Header>
        <Modal.Body>
          <DNDContainer>
            <div className='file-override-container'>
              <SearchBox
                t={t}
                searchFocusIndex={searchIndex}
                searchString={searchString}
                matches={searchMatches}
                onSetSearch={this.setSearch}
                onSetSearchFocus={this.setSearchFocus}
              />
              <Tree
                treeData={treeState}
                onChange={this.onChangeTree}
                theme={FileExplorerTheme}
                canDrag={false}
                getNodeKey={this.getNodeKey}
                generateNodeProps={this.generateNodeProps}
                searchMethod={this.searchMethod}
                searchQuery={searchString}
                searchFocusOffset={searchIndex}
                searchFinishCallback={this.searchFinishCallback}
              />
              <div className='override-editor-usage'>
                <div>{t('Use this dialog to select which mod should provide a file.')}</div>
                <div>{t('The mod marked as "Default" is the one that will provide the '
                      + 'file based on current mod rules, if you make no change.')}</div>
                <div>{t('Please try to minimize the number of overrides you set up here. '
                      + 'Use mod rules to order entire mods.')}</div>
                <div>{t('This lists only the files in the selected mod that aren\'t exclusive '
                      + 'to it.')}</div>
              </div>

            </div>
          </DNDContainer>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Cancel')}</Button>
          <Button onClick={this.apply}>{t('Save')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private apply = () => {
    const { onClose, onSetFileOverride, gameId, mods } = this.props;
    const { treeState } = this.state;

    const files: { [provider: string]: string[] } = {};

    const initProvider = (provId: string) => {
      if (files[provId] === undefined) {
        files[provId] = ((mods[provId] as any).fileOverrides || []);
      }
    };

    const walkState = (children: IFileTree[], parentPath: string) => {
      children.forEach(iter => {
        const filePath = nodePath.join(parentPath, iter.title);
        if (iter.isDirectory) {
          walkState(iter.children, filePath);
        } else {
          iter.providers.forEach(initProvider);
          if (iter.selected !== iter.providers[0]) {
            files[iter.selected] = util.addUniqueSafe(files[iter.selected], [], filePath);
          }
          iter.providers.forEach(provider => {
            if ((provider !== iter.selected)
                || (iter.selected === iter.providers[0])) {
              files[provider] = util.removeValue(files[provider], [], filePath);
            }
          });
        }
      });
    };

    walkState(treeState, '');

    Object.keys(files).forEach(provId => {
      if (files[provId] !== (mods[provId] as any).fileOverrides) {
        onSetFileOverride(gameId, provId, files[provId]);
      }
    });
    onClose();
  }

  private searchMethod = ({ node, path, treeIndex, searchQuery }:
    { node: IFileTree, path: number[] | string[],
      treeIndex: number, searchQuery: any }) => {
    return (searchQuery.length > 0) &&
      (node.title.toLowerCase().indexOf(searchQuery.toLowerCase()) !== -1);
  }

  private searchFinishCallback = (matches: ISearchMatch[]) => {
    this.nextState.searchMatches = matches;
  }

  private setSearch = (search: string) => {
    this.nextState.searchString = search;
  }

  private setSearchFocus = (index: number) => {
    this.nextState.searchIndex = index;
  }

  private getNodeKey = (node: TreeT.TreeNode) => node.node.path;

  private generateNodeProps = (rowInfo: TreeT.ExtendedNodeData) => {
    const { t, mods } = this.props;

    const renderName = (id: string, clip?: number) => {
      let name: string = util.renderModName(mods[id]);
      if (clip && name.length > clip) {
        name = name.substr(0, clip - 3) + '...';
      }
      if (id === rowInfo.node.providers[0]) {
        name += ` (${t('Default')})`;
      }
      return name;
    };

    return {
      buttons: rowInfo.node.isDirectory ? [] : [(
        <Dropdown
          id={`provider-select-${rowInfo.path.join('_')}`}
          data-filepath={rowInfo.node.path}
          onSelect={this.changeProvider as any}
          pullRight
        >
          <Dropdown.Toggle>
            <span>{renderName(rowInfo.node.selected, 30)}</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {rowInfo.node.providers.map(provider => (
              <MenuItem key={provider} eventKey={provider}>
                {renderName(provider)}
              </MenuItem>))}
          </Dropdown.Menu>
        </Dropdown>
      )],
    };
  }

  private onChangeTree = (newTreeState: IFileTree[]) => {
    this.nextState.treeState = newTreeState;
  }

  private changeProvider = (eventKey: any, evt: any) => {
    // why exactly is the target of the event the <a> of the menu item? This handler
    // was attached to the Dropdown not to the menu item.
    const filePath =
      evt.currentTarget.parentNode.parentNode.parentNode.getAttribute('data-filepath');
    let cur: IFileTree;
    filePath.split(nodePath.sep).forEach(comp => {
      const findFunc = iter => iter.title === comp;
      cur = (cur === undefined)
        ? this.nextState.treeState.find(findFunc)
        : cur.children.find(findFunc);
    });
    if (cur !== undefined) {
      cur.selected = eventKey;
    }
  }

  private toTree(props: IProps): IFileTree[] {
    const { conflicts, modId } = props;

    const makeEmpty = (title: string, filePath: string, prov?: string) => ({
      title,
      path: filePath,
      children: [],
      providers: prov !== undefined ? [prov] : [],
      selected: '',
      expanded: true,
      isDirectory: prov === undefined,
    });

    const ensure = (ele: IFileTree[], name: string, filePath: string, prov?: string) => {
      let existing = ele.find(iter => iter.title === name);
      if (existing === undefined) {
        existing = makeEmpty(name, filePath, prov);
        ele.push(existing);
      }
      return existing;
    };

    const result = conflicts.reduce((tree: IFileTree[], input: IConflict) => {
      input.files.forEach(file => {
        let cur = tree;

        nodePath.dirname(file).split(nodePath.sep).forEach((comp, idx, segments) => {
          cur = ensure(cur, comp, segments.slice(0, idx + 1).join(nodePath.sep)).children;
        });
        const fileName = nodePath.basename(file);
        ensure(cur, fileName, file, modId).providers.push(input.otherMod.id);
      });
      return tree;
    }, []);

    this.sortProviders(result, props);

    return result;
  }

  private sortProviders(files: IFileTree[], props: IProps, dirPath: string = ''): void {
    const { mods } = props;
    const { sortedMods } = this.nextState;
    const sortFunc = (lhs: string, rhs: string, filePath: string) => {
      if ((mods[lhs] === undefined) || (mods[rhs] === undefined)) {
        return 0;
      }
      return sortedMods.indexOf(rhs) - sortedMods.indexOf(lhs);
    };
    files.forEach(file => {
      const filePath = nodePath.join(dirPath, file.title);
      file.providers = file.providers.sort((lhs, rhs) => sortFunc(lhs, rhs, filePath));
      file.selected = file.providers[0];
      const overrider = file.providers.find(
        modId => ((mods[modId] as any).fileOverrides || []).indexOf(filePath) !== -1);
      if (overrider !== undefined) {
        file.selected = overrider;
      }
      this.sortProviders(file.children, props, filePath);
    });
  }

  private sortedMods = (newProps: IProps) => {
    const { gameId, mods } = newProps;
    return util.sortMods(gameId, Object.keys(mods).map(key => mods[key]), this.context.api);
  }
}

const emptyArr = [];
const emptyObj = {};

function mapStateToProps(state: types.IState): IConnectedProps {
  const dialog = (state.session as any).dependencies.overrideDialog || emptyObj;
  return {
    gameId: dialog.gameId,
    modId: dialog.modId,
    mods: dialog.gameId !== undefined ? state.persistent.mods[dialog.gameId] : emptyObj,
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts', dialog.modId], emptyArr),
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onSetFileOverride: (gameId: string, modId: string, files: string[]) =>
      dispatch((actions as any).setFileOverride(gameId, modId, files)),
    onClose: () => dispatch(setFileOverrideDialog(undefined, undefined)),
  };
}

export default translate(['common', 'dependency-manager'], {wait: false})(
  connect(mapStateToProps, mapDispatchToProps)(
  OverrideEditor)) as React.ComponentClass<{}>;
