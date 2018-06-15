import { IConflict } from '../types/IConflict';

import { setFileOverrideDialog } from '../actions';

import * as path from 'path';
import * as React from 'react';
import { Button, Dropdown, MenuItem, Modal } from 'react-bootstrap';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import * as TreeT from 'react-sortable-tree';
import { } from 'react-sortable-tree-theme-file-explorer';
import { actions, ComponentEx, DNDContainer, types, util } from 'vortex-api';

interface IFileTree {
  title: string;
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
}

class OverrideEditor extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);
    this.initState({
      treeState: [],
      sortedMods: [],
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
    const { treeState } = this.state;

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
              <Tree
                treeData={treeState}
                onChange={this.onChangeTree}
                theme={FileExplorerTheme}
                canDrag={false}
                getNodeKey={this.getNodeKey}
                generateNodeProps={this.generateNodeProps}
              />
            </div>
          </DNDContainer>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Cancel')}</Button>
          <Button onClick={this.apply}>{t('Apply')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private apply = () => {
    const { onClose, onSetFileOverride, gameId, modId, mods } = this.props;
    const { treeState } = this.state;

    const files: string[] = [];
    const removeFrom: { [provider: string]: string[] } = {};

    const walkState = (children: IFileTree[], parentPath: string) => {
      children.forEach(iter => {
        const filePath = path.join(parentPath, iter.title);
        if (iter.isDirectory) {
          walkState(iter.children, filePath);
        } else if (iter.selected === modId) {
          files.push(filePath);
          iter.providers.forEach(provider =>
            util.setdefault(removeFrom, provider, []).push(filePath));
        }
      });
    };

    walkState(treeState, '');

    // remove the override from all other providers, otherwise there could
    // be confusion about which one wins
    Object.keys(removeFrom).forEach(prov => {
      const fileOverrides = (mods[prov] as any).fileOverrides || [];
      const oldSet = new Set<string>(fileOverrides);
      removeFrom[prov].forEach(file => {
        oldSet.delete(file);
      });
      if (oldSet.size < fileOverrides.length) {
        onSetFileOverride(gameId, prov, Array.from(oldSet));
      }
    });

    onSetFileOverride(gameId, modId, files);
    onClose();
  }

  private getNodeKey = (node: TreeT.TreeNode) => node.node.title;

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
          data-filepath={rowInfo.path.join(path.sep)}
          onSelect={this.changeProvider as any}
          pullRight
        >
          <Dropdown.Toggle>
            <span>{renderName(rowInfo.node.selected, 20)}</span>
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
    filePath.split(path.sep).forEach(comp => {
      const findFunc = iter => iter.title === comp;
      cur = (cur === undefined)
        ? this.nextState.treeState.find(findFunc)
        : cur.children.find(findFunc);
    });
    cur.selected = eventKey;
  }

  private toTree(props: IProps): IFileTree[] {
    const { conflicts, modId } = props;

    const makeEmpty = (title: string, prov?: string) => ({
      title,
      children: [],
      providers: prov !== undefined ? [prov] : [],
      selected: '',
      expanded: true,
      isDirectory: prov === undefined,
    });

    const ensure = (ele: IFileTree[], name: string, filePath: string, prov?: string) => {
      let existing = ele.find(iter => iter.title === name);
      if (existing === undefined) {
        existing = makeEmpty(name, prov);
        ele.push(existing);
      }
      return existing;
    };

    const result = conflicts.reduce((tree: IFileTree[], input: IConflict) => {
      input.files.forEach(file => {
        let cur = tree;

        path.dirname(file).split(path.sep).forEach((comp, idx, segments) => {
          cur = ensure(cur, comp, segments.slice(0, idx + 1).join(path.sep)).children;
        });
        const fileName = path.basename(file);
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
      if (((mods[lhs] as any).fileOverrides || []).indexOf(filePath) !== -1) {
        return 1;
      }
      if (((mods[rhs] as any).fileOverrides || []).indexOf(filePath) !== -1) {
        return -1;
      }
      return sortedMods.indexOf(rhs) - sortedMods.indexOf(lhs);
    };
    files.forEach(file => {
      const filePath = path.join(dirPath, file.title);
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
