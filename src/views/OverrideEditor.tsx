import { IConflict } from '../types/IConflict';

import { setFileOverrideDialog } from '../actions';

import * as path from 'path';
import * as React from 'react';
import { Button, Dropdown, MenuItem, Modal } from 'react-bootstrap';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import * as TreeT from 'react-sortable-tree';
import { } from 'react-sortable-tree-theme-file-explorer';
import { ComponentEx, DNDContainer, Icon, types, util } from 'vortex-api';

interface IFileTree {
  title: string;
  providers: string[];
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
  onClose: () => void;
}

type IProps = IConnectedProps & IActionProps;

interface IComponentState {
  treeState: IFileTree[];
  sortedMods: string[];
}

function nop() {
  return null;
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
          <Button onClick={this.close}>{t('Close')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private getNodeKey = (node: TreeT.TreeNode) => node.node.path;

  private generateNodeProps = (rowInfo: TreeT.ExtendedNodeData) => {
    const { t, mods } = this.props;

    return {
      buttons: rowInfo.node.isDirectory ? [] : [(
        <Dropdown
          id={`provider-select-${rowInfo.path.join('_')}`}
          data-filepath={rowInfo.path.join(path.sep)}
          onSelect={this.changeProvider as any}
        >
          <Dropdown.Toggle>
            <span>{util.renderModName(mods[rowInfo.node.providers[0]])}</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {rowInfo.node.providers.map(provider => (
              <MenuItem key={provider} eventKey={provider}>
                {util.renderModName(mods[provider])}
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
  }

  private toTree(props: IProps): IFileTree[] {
    const { conflicts, modId } = props;

    const makeEmpty = (title: string, filePath: string, prov?: string) => ({
      path: filePath,
      title,
      children: [],
      providers: prov !== undefined ? [prov] : [],
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
    onClose: () => dispatch(setFileOverrideDialog(undefined, undefined)),
  };
}

export default translate(['common', 'dependency-manager'], {wait: false})(
  connect(mapStateToProps, mapDispatchToProps)(
  OverrideEditor)) as React.ComponentClass<{}>;
