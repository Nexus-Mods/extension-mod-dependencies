import type { IBiDirRule } from '../types/IBiDirRule';
import type { IConflict } from '../types/IConflict';
import type { IModLookupInfo } from '../types/IModLookupInfo';

import { setConflictDialog, setFileOverrideDialog } from '../actions';
import { NAMESPACE } from '../statics';

import type { ILocalState } from './DependencyIcon';
import SearchBox, { ISearchMatch } from './SearchBox';

import * as React from 'react';
import { Button, Dropdown, MenuItem, Modal } from 'react-bootstrap';
import { Trans, withTranslation, WithTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import { Action } from 'redux-act';
import * as TreeT from 'react-sortable-tree';
import { } from 'react-sortable-tree-theme-file-explorer';
import { actions, ComponentEx, DNDContainer, Icon, selectors,
         Spinner, types, Usage, util } from 'vortex-api';

interface IFileTree {
  title: string;
  path: string;
  providers: string[];
  selected: string;
  children: IFileTree[];
  isDirectory: boolean;
  expanded: boolean;
}

export interface IPathTools {
  sep: string;
  join: (...segment: string[]) => string;
  basename(path: string, ext?: string): string;
  dirname(path: string): string;
  relative(lhs: string, rhs: string): string;
  isAbsolute(path: string): boolean;
}

export interface IOverrideEditorProps {
  localState: ILocalState;
  pathTool: IPathTools;
}

interface IConnectedProps {
  gameId: string;
  modId: string;
  conflicts: IConflict[];
  mods: { [modId: string]: types.IMod };
  profile: types.IProfile;
  installPath: string;
  discovery: types.IDiscoveryResult;
}

interface IActionProps {
  onSetFileOverrides: (batchedActions: Action<any>[]) => void;
  onSetFileOverride: (gameId: string, modId: string, files: string[]) => void;
  onClose: () => void;
  onConflictDialog: (gameId: string, modIds: string[], modRules: IBiDirRule[]) => void;
}

type IProps = IOverrideEditorProps & IConnectedProps & IActionProps & Partial<WithTranslation>;

interface IComponentState {
  treeState: IFileTree[];
  sortedMods: string[];
  searchString: string;
  searchIndex: number;
  searchMatches: ISearchMatch[];
  hasUnsolved: boolean;
  modRules: IBiDirRule[];
  sorting: boolean;
  sortError: boolean;
}

function nop() {
  // nop
}

class OverrideEditor extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);

    const modRules = props.localState.modRules.filter(
      rule => util.testModReference(props.mods[props.modId], rule.source));

    this.initState({
      treeState: [],
      sortedMods: [],
      searchString: '',
      searchIndex: 0,
      searchMatches: [],
      modRules,
      hasUnsolved: this.hasUnsolved(props, modRules),
      sorting: false,
      sortError: false,
    });
  }

  public componentDidMount() {
    this.sortedMods(this.props)
      .then(sorted => {
        this.nextState.sortedMods = sorted;
      })
      .catch(() => {
        this.nextState.sortedMods = [];
      });
  }

  public UNSAFE_componentWillReceiveProps(newProps: IProps) {
    if ((newProps.modId !== this.props.modId)
        || (newProps.gameId !== this.props.gameId)
        || (newProps.conflicts !== this.props.conflicts)
        || (newProps.localState.modRules !== this.props.localState.modRules)) {
      this.nextState.treeState = this.toTree(newProps);

      const newModRules = newProps.localState.modRules.filter(rule =>
        util.testModReference(newProps.mods[newProps.modId], rule.source));
      this.nextState.modRules = newModRules;

      this.nextState.hasUnsolved = this.hasUnsolved(newProps, newModRules);
    }

    if (newProps.mods !== this.props.mods) {
      this.sortedMods(newProps)
        .then(sorted => {
          this.nextState.sortedMods = sorted;
          this.nextState.treeState = this.toTree(newProps);
        })
        .catch(() => {
          this.nextState.sortedMods = [];
        });
    }
  }

  public render(): JSX.Element {
    const { t, modId, mods } = this.props;
    const { hasUnsolved, searchString, searchIndex, searchMatches,
      sorting, sortError, treeState } = this.state;

    const modName = mods[modId] !== undefined
      ? util.renderModName(mods[modId])
      : '';

    let content: JSX.Element;
    if (hasUnsolved) {
      content = (
        <div className='file-override-unsolved'>
          <div>
            <Trans i18nKey='unsolved-conflicts-first'>
              This mod has unresolved conflicts.
              Please <a onClick={this.openConflictEditor}>create mod rules</a> to
              establish a default load order and only use this screen to make exceptions.
            </Trans>
          </div>
        </div>
      );
    } else if (sorting) {
      content = (
        <div className='file-override-sorting'>
          <div>
            <Spinner />
            <div style={{ marginLeft: 8, display: 'inline' }}>{t('Sorting mods')}</div>
          </div>
        </div>
      );
    } else if (sortError) {
      content = (
        <div className='file-override-sorting'>
          <div>
            <Icon name='feedback-error' />
            <div style={{ marginLeft: 8, display: 'inline' }}>
              {t('Mods were not sorted. You need to fix that before setting file overrides.')}
            </div>
          </div>
        </div>
      );
    } else {
      const Tree: typeof TreeT.SortableTreeWithoutDndContext =
        require('react-sortable-tree').SortableTreeWithoutDndContext;
      const FileExplorerTheme = require('react-sortable-tree-theme-file-explorer');

      content = (
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
            <Usage persistent infoId='override-editor'>
              <div>{t('Use this dialog to select which mod should provide a file.')}</div>
              <div>{t('The mod marked as "Default" is the one that will provide the '
                + 'file based on current mod rules, if you make no change.')}</div>
              <div>{t('Please try to minimize the number of overrides you set up here. '
                + 'Use mod rules to order entire mods.')}</div>
              <div>{t('This lists only the files in the selected mod that aren\'t exclusive '
                + 'to it.')}</div>
            </Usage>
          </div>
        </DNDContainer>
      );
    }

    return (
      <Modal id='file-override-dialog' show={modId !== undefined} onHide={nop}>
        <Modal.Header><Modal.Title>{modName}</Modal.Title></Modal.Header>
        <Modal.Body>
          {content}
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Cancel')}</Button>
          <Button disabled={hasUnsolved || sorting || sortError} onClick={this.apply}>
            {t('Save')}
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private openConflictEditor = () => {
    const { gameId, modId, onConflictDialog } = this.props;
    const { modRules } = this.state;

    onConflictDialog(gameId, [modId], modRules);
  }

  private apply = () => {
    const { onClose, onSetFileOverrides, pathTool, gameId, mods, discovery } = this.props;
    const { treeState } = this.state;

    const files: { [provider: string]: string[] } = {};

    const initProvider = (provId: string) => {
      if (files[provId] === undefined) {
        files[provId] = ((mods[provId] as any).fileOverrides || []);
      }
    };

    const walkState = (children: IFileTree[], parentPath: string) => {
      children.forEach(iter => {
        const filePath = pathTool.join(parentPath, iter.title);
        if (iter.isDirectory) {
          walkState(iter.children, filePath);
        } else {
          iter.providers.forEach(initProvider);
          iter.providers.forEach(provider => {
            const fullPath = pathTool.join(discovery.path, filePath);
            files[provider] = util.addUniqueSafe(files[provider], [], fullPath);
            if ((provider === iter.selected)) {
              files[provider] = util.removeValue(files[provider], [], fullPath);
            }
          });
        }
      });
    };

    walkState(treeState, '');
    const batched = Object.keys(files).reduce((accum, provId) => {
      if (files[provId] !== (mods[provId] as any).fileOverrides) {
        accum.push(actions.setFileOverride(gameId, provId, files[provId]));
      }
      return accum;
    }, []);
    onSetFileOverrides(batched);
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

  private findRule(ref: IModLookupInfo, modRules: IBiDirRule[]): IBiDirRule {
    return modRules.find(rule => util.testModReference(ref, rule.reference));
  }

  private hasUnsolved(props: IProps, modRules: IBiDirRule[]): boolean {
    const { conflicts, modId } = props;
    if (modId === undefined) {
      return false;
    }
    return conflicts.find(conflict => {
      const rule = this.findRule(conflict.otherMod, modRules);
      return rule === undefined;
    }) !== undefined;
  }

  private getNodeKey = (node: TreeT.TreeNode) => node.node.path;

  private generateNodeProps = (rowInfo: TreeT.ExtendedNodeData) => {
    const { t, mods } = this.props;

    const renderName = (id: string, clip?: number) => {
      let name: string = mods[id] !== undefined ? util.renderModName(mods[id], { version: true }) : '';
      if (clip && name.length > clip) {
        name = name.substr(0, clip - 3) + '...';
      }
      if (id === rowInfo.node.providers[0]) {
        name += ` (${t('Default')})`;
      }
      return name;
    };

    const key = `provider-select-${rowInfo.path.join('_')}`;
    return {
      buttons: rowInfo.node.isDirectory ? [] : [(
        <a key='preview' data-row={rowInfo.path} onClick={this.preview}>{t('Preview')}</a>
      ), (
        <Dropdown
          id={key}
          key={key}
          data-filepath={rowInfo.node.path}
          onSelect={this.changeProvider as any}
          title={renderName(rowInfo.node.selected)}
          pullRight
        >
          <Dropdown.Toggle>
            <span>{renderName(rowInfo.node.selected, 30)}</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {rowInfo.node.providers.map(provider => (
              <MenuItem key={provider} eventKey={provider}>
                {renderName(provider)}
              </MenuItem>
            ))}
          </Dropdown.Menu>
        </Dropdown>
      )],
    };
  }

  private findByPath(nodes: IFileTree[], path: string[]): IFileTree {
    const temp = nodes.find(tree => tree.path === path[0]);
    if ((path.length === 1) || (temp === undefined)) {
      return temp;
    }

    return this.findByPath(temp.children, path.slice(1));
  }

  private preview = (evt: React.MouseEvent<any>) => {
    const { installPath, mods, pathTool } = this.props;
    const { treeState } = this.state;
    const pathStr = evt.currentTarget.getAttribute('data-row');
    const path = pathStr.split(',');
    const node = this.findByPath(treeState, path);

    if (node !== undefined) {
      // selected provider first, default second, everything else after
      const sortIdx = modId =>
        modId === node.selected ? 0
        : modId === node.providers[0] ? 1
        : 2;

      const filePath = path[path.length - 1];
      const options = node.providers.sort((lhs, rhs) => sortIdx(lhs) - sortIdx(rhs))
        .map(modId => {
          const mod = mods[modId];
          return {
            label: util.renderModName(mod),
            filePath: pathTool.join(installPath, mod.installationPath, filePath),
          };
        });
      this.context.api.events.emit('preview-files', options);
    }
  }

  private onChangeTree = (newTreeState: IFileTree[]) => {
    this.nextState.treeState = newTreeState;
  }

  private changeProvider = (eventKey: any, evt: any) => {
    const { pathTool } = this.props;

    // why exactly is the target of the event the <a> of the menu item? This handler
    // was attached to the Dropdown not to the menu item.
    const filePath =
      evt.currentTarget.parentNode.parentNode.parentNode.getAttribute('data-filepath');
    let cur: IFileTree;

    // skip the top level "." directory
    const searchPos: IFileTree[] = this.nextState.treeState;
    if ((searchPos.length === 1) && (searchPos[0].title === '.')) {
      cur = searchPos[0];
    }

    const components = filePath.split(pathTool.sep);
    if ((cur === undefined) && (components.length === 1)) {
      // Only add the top level "." directory if we were not able
      //  to skip it.
      components.unshift('.');
    }

    components.forEach(comp => {
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
    const { conflicts, modId, pathTool, discovery } = props;
    if (discovery?.path === undefined) {
      // Game undiscovered? bye.
      return [];
    }

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

        pathTool.dirname(pathTool.relative(discovery.path, file)).split(pathTool.sep).forEach((comp, idx, segments) => {
          cur = ensure(cur, comp, segments.slice(0, idx + 1).join(pathTool.sep)).children;
        });
        const fileName = pathTool.basename(file);
        ensure(cur, fileName, file, modId).providers.push(input.otherMod.id);
      });
      return tree;
    }, []);

    this.sortProviders(result, props);

    return result;
  }

  private sortProviders(files: IFileTree[], props: IProps, dirPath: string = ''): void {
    const { mods, pathTool } = props;
    const { sortedMods } = this.nextState;
    const sortFunc = (lhs: string, rhs: string) => {
      if ((mods[lhs] === undefined) || (mods[rhs] === undefined)) {
        return 0;
      }
      return sortedMods.indexOf(rhs) - sortedMods.indexOf(lhs);
    };
    files.forEach(file => {
      const filePath = pathTool.join(dirPath, file.title);
      file.providers = file.providers
        .filter(modId => mods[modId] !== undefined)
        .sort(sortFunc);
      file.selected = file.providers[0];
      if (pathTool.isAbsolute(file.path)) {
        const overrider = file.providers.find(
          modId => ((mods[modId] as any).fileOverrides || []).indexOf(file.path) === -1);
        if (overrider !== undefined) {
          file.selected = overrider;
        }
      }
      this.sortProviders(file.children, props, filePath);
    });
  }

  private sortedMods = (newProps: IProps) => {
    const { gameId, mods, profile } = newProps;
    this.nextState.sorting = true;
    const enabled = Object.keys(mods)
      .filter(key => util.getSafe(profile, ['modState', key, 'enabled'], false))
      .map(key => mods[key]);
    return util.sortMods(gameId, enabled, this.context.api)
      .map(mod => (mod as any).id)
      .tap(() => this.nextState.sortError = false)
      .catch(() => {
        this.nextState.sortError = true;
        return [];
      })
      .finally(() => {
        this.nextState.sorting = false;
      });
  }
}

const emptyArr = [];
const emptyObj = {};

function mapStateToProps(state: types.IState): IConnectedProps {
  const dialog = (state.session as any).dependencies.overrideDialog || emptyObj;
  const discovery = (!!dialog?.gameId) ? selectors.discoveryByGame(state, dialog.gameId) : emptyObj;
  return {
    gameId: dialog.gameId,
    modId: dialog.modId,
    mods: dialog.gameId !== undefined ? state.persistent.mods[dialog.gameId] : emptyObj,
    profile: selectors.activeProfile(state),
    installPath:
      dialog.gameId !== undefined ? selectors.installPathForGame(state, dialog.gameId) : undefined,
    discovery,
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts', dialog.modId], emptyArr),
  };
}

function mapDispatchToProps(dispatch: any): IActionProps {
  return {
    onSetFileOverrides: (batchedActions: Action<any>[]) =>
      util.batchDispatch(dispatch, batchedActions),
    onSetFileOverride: (gameId: string, modId: string, files: string[]) =>
      dispatch((actions as any).setFileOverride(gameId, modId, files)),
    onClose: () => dispatch(setFileOverrideDialog(undefined, undefined)),
    onConflictDialog: (gameId, modIds, modRules) =>
      dispatch(setConflictDialog(gameId, modIds, modRules)),
  };
}

export default withTranslation(['common', NAMESPACE])(
  connect(mapStateToProps, mapDispatchToProps)(
    OverrideEditor) as any) as React.ComponentClass<IOverrideEditorProps>;
