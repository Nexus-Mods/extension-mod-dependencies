import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';
import Graph, { IGraphLinkSpec } from '../util/graph';

import { setEditCycle } from '../actions';

import { IRule } from 'modmeta-db';
import * as React from 'react';
import { Button, Modal } from 'react-bootstrap';
import { withFauxDOM } from 'react-faux-dom';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { actions, ComponentEx, selectors, types, util } from 'vortex-api';

interface ILocalState {
  modRules: IBiDirRule[];
}

export interface IConflictGraphProps {
  width: number;
  height: number;
  nodeDistance: number;
  nodeRadius: number;
  localState: ILocalState;
}

interface IConnectedProps {
  conflicts: { [modId: string]: IConflict[] };
  mods: { [modId: string]: types.IMod };
  editCycle: { gameId: string, modIds: string[] };
}

interface IActionProps {
  onClose: () => void;
  onAddRule: (gameId: string, modId: string, rule: IRule) => void;
  onRemoveRule: (gameId: string, modId: string, rule: IRule) => void;
}

interface IFauxProps {
  connectFauxDOM: (id: string, name: string) => any;
  animateFauxDOM: (delay: number) => void;
  stopAnimatingFauxDOM: () => void;
  drawFauxDOM: () => void;
  chart: any;
}

type IProps = IConflictGraphProps & IConnectedProps & IActionProps & IFauxProps;

interface IComponentState {
  highlighted: { source: string, target: string };
  counter: number;
}

class ConflictGraph extends ComponentEx<IProps, IComponentState> {
  private mCycle: { gameId: string, modIds: string[] };
  private mRules: IBiDirRule[];
  private mGraph: Graph;
  private mHighlighted: { source: string, target: string };
  private mProxy: any;

  constructor(props: IProps) {
    super(props);
    this.initState({ highlighted: undefined, counter: 0 });
    // TODO: horrible hack, just to get this to update when mod rules change
    this.mProxy = {
      setState: () => {
        this.nextState.counter++;
      },
    };
  }

  public componentDidMount() {
    const { width, height, nodeDistance, nodeRadius, connectFauxDOM } = this.props;
    this.mGraph = new Graph(width, height, nodeDistance, nodeRadius, connectFauxDOM);
    this.nextState.highlighted = undefined;
    (this.props.localState as any).attach(this.mProxy);
  }

  public componentWillUnmount() {
    (this.props.localState as any).detach(this.mProxy);
  }

  public componentWillReceiveProps(newProps: IProps) {
    if ((this.props.conflicts !== newProps.conflicts)
        || (this.props.mods !== newProps.mods)
        || (this.props.localState.modRules !== newProps.localState.modRules)
        || (this.props.editCycle !== newProps.editCycle)) {
      this.props.animateFauxDOM(60000);
      this.mGraph.reposition(() => {
        this.props.stopAnimatingFauxDOM();
      });
    }
  }

  public render(): JSX.Element {
    const { t, editCycle, mods } = this.props;
    if  (this.mGraph === undefined) {
      return null;
    }
    this.updateGraph(this.props);
    return (
      <Modal show={editCycle !== undefined} onHide={this.close}>
        <Modal.Header><Modal.Title>{t('Cycle')}</Modal.Title></Modal.Header>
        <Modal.Body>
          {t('Click a connection to remove the rule')}
          {this.renderGraph()}
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Close')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private renderGraph(): JSX.Element {
    return (
      <div>
        <div className='mod-conflict-graph'>
          {this.props.chart}
        </div>
      </div>
    );
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private updateGraph(props: IProps) {
    const { editCycle, localState, mods, onRemoveRule } = props;
    const { highlighted } = this.state;
    if (editCycle === undefined) {
      return;
    }

    let change: boolean = false;
    if (this.mCycle !== editCycle) {
      const nodes = editCycle.modIds.map(modId =>
        ({ id: modId, name: util.renderModName(props.mods[modId]) }));
      this.mGraph.setNodes(nodes);
      this.mCycle = editCycle;
      change = true;
    }

    if ((this.mRules !== localState.modRules)
      || (this.mHighlighted !== highlighted)) {
      const links: IGraphLinkSpec[] = editCycle.modIds.reduce((prev: IGraphLinkSpec[], modId: string) => {
        localState.modRules
          .filter(rule => (rule.type === 'after')
            && util.testModReference(mods[modId], rule.source))
          .forEach(rule => {
            const otherMods: string[] = editCycle.modIds.filter(refId =>
              util.testModReference(mods[refId], rule.reference));
            otherMods.forEach(otherMod => {
              prev.push({
                source: modId,
                target: otherMod,
                highlight: (highlighted !== undefined)
                  && (highlighted.source === modId) && (highlighted.target === otherMod),
              });
            });
          });
        return prev;
      }, []);

      this.mGraph.setLinks(links, (source: string, target: string) => {
        const bidirRule = localState.modRules.find(rule =>
          rule.type === 'after'
          && util.testModReference(mods[source], rule.source)
          && util.testModReference(mods[target], rule.reference));
        if (bidirRule === undefined) {
          return;
        }
        const sourceId = bidirRule.original ? source : target;
        const remRule: IRule = {
          type: bidirRule.original ? 'after' : 'before',
          reference: bidirRule.original ? bidirRule.reference : bidirRule.source,
        };
        onRemoveRule(editCycle.gameId, sourceId, remRule);
      }, (source: string, target: string, highlight: boolean) => {
        this.nextState.highlighted = highlight
          ? { source, target }
          : undefined;
      });

      this.mRules = localState.modRules;
      this.mHighlighted = highlighted;
      change = true;
    }

    if (change) {
      props.animateFauxDOM(60000);
      this.mGraph.reposition(() => {
        props.stopAnimatingFauxDOM();
      });
    }
  }
}

const emptyObj = {};

function mapStateToProps(state: types.IState, props: IProps): IConnectedProps {
  let editCycle = util.getSafe(state, ['session', 'dependencies', 'editCycle'], undefined);
  const gameMode = selectors.activeGameId(state);
  let gameId = editCycle !== undefined ? editCycle.gameId : undefined;
  if (gameMode !== gameId) {
    editCycle = undefined;
    gameId = undefined;
  }
  return {
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts'], emptyObj),
    mods: (gameId !== undefined) ? state.persistent.mods[gameId] : emptyObj,
    editCycle,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onClose: () => dispatch(setEditCycle(undefined, undefined)),
    onAddRule: (gameId, modId, rule) =>
      dispatch(actions.addModRule(gameId, modId, rule)),
    onRemoveRule: (gameId, modId, rule) =>
      dispatch(actions.removeModRule(gameId, modId, rule)),
  };
}

export default translate(['common', 'dependency-manager'], {wait: false})(
  connect(mapStateToProps, mapDispatchToProps)(
    withFauxDOM(ConflictGraph))) as React.ComponentClass<IConflictGraphProps>;
