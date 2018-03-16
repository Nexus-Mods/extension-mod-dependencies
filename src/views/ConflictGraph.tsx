import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';
import renderModName from '../util/renderModName';

import { setEditCycle } from '../actions';

import * as d3 from 'd3';
import * as d3Force from 'd3-force';
import * as d3Scale from 'd3-scale';
import { IReference, IRule } from 'modmeta-db';
import * as path from 'path';
import * as React from 'react';
import { Button, Modal } from 'react-bootstrap';
import { withFauxDOM } from 'react-faux-dom';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import { actions, ComponentEx, selectors, tooltip, types, util } from 'vortex-api';

export interface IConflictGraphProps {
  width: number;
  height: number;
  nodeDistance: number;
  nodeRadius: number;
  modRules: IBiDirRule[];
}

interface IConnectedProps {
  gameId: string;
  conflicts: { [modId: string]: IConflict[] };
  mods: { [modId: string]: types.IMod };
  editCycle: string[];
}

interface IActionProps {
  onClose: () => void;
  onAddRule: (gameId: string, modId: string, rule: IRule) => void;
  onRemoveRule: (gameId: string, modId: string, rule: IRule) => void;
}

interface IFauxProps {
  connectFauxDOM: (id: string, name: string) => any;
  animateFauxDOM: (delay: number) => void;
  chart: any;
}

interface IGraphNode {
  id: string;
  idx?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface IGraphLink {
  source: IGraphNode;
  target: IGraphNode;
  idx?: number;
}

interface IGraphLinkSpec {
  source: string;
  target: string;
}

type IProps = IConflictGraphProps & IConnectedProps & IActionProps & IFauxProps;

interface IComponentState {
}

class ConflictGraph extends ComponentEx<IProps, IComponentState> {
  private static defaultProps = {
    chart: 'loading',
  };

  private mSimulation: d3.Simulation<IGraphNode, undefined>;
  private mBaseGroup: d3.Selection<d3.BaseType, {}, null, undefined>;
  private mNodes: IGraphNode[];
  private mLinks: IGraphLink[];
  private mNodesSVG: d3.Selection<d3.BaseType, IGraphNode, d3.BaseType, {}>;
  private mLinksSVG: d3.Selection<d3.BaseType, IGraphLink, d3.BaseType, {}>;

  constructor(props: IProps) {
    super(props);

    this.initState({});
  }

  public componentDidMount() {
    const { connectFauxDOM, mods, nodeDistance, height, width } = this.props;
    const faux = connectFauxDOM('div', 'chart');

    const svg = d3.select(faux).append('svg')
      .attr('width', width)
      .attr('height', height);
    this.genMarker(svg);

    this.mBaseGroup = svg.append('g');

    this.mSimulation = d3.forceSimulation()
      .force('charge', d3.forceManyBody())
      .force('collide', d3.forceCollide(nodeDistance))
      .force('center', d3.forceCenter(width / 2, height / 2)) as any;
  }

  public componentWillReceiveProps(newProps: IProps) {
    if ((this.props.conflicts !== newProps.conflicts)
        || (this.props.mods !== newProps.mods)
        || (this.props.modRules !== newProps.modRules)
        || (this.props.editCycle !== newProps.editCycle)) {
      this.updateGraph(newProps);
    }
  }

  public render(): JSX.Element {
    const { t, editCycle, mods } = this.props;
    return (
      <Modal show={editCycle !== undefined} onHide={this.close}>
        <Modal.Header><Modal.Title>{t('Cycle')}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Button onClick={() => {
            this.mSimulation.restart();
            this.props.animateFauxDOM(2000);
          }}>
            Reset
          </Button>
          {this.renderGraph()}
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Cancel')}</Button>
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
    const { editCycle, modRules, mods } = props;
    if (editCycle === undefined) {
      return;
    }

    this.setNodes(editCycle.map(modId =>
      ({ id: modId, name: renderModName(props.mods[modId]) })));

    const links: IGraphLinkSpec[] = editCycle.reduce((prev: IGraphLinkSpec[], modId: string) => {
      modRules
        .filter(rule => (rule.type === 'after')
                      && util.testModReference(mods[modId], rule.source))
        .forEach(rule => {
          const otherMods: string[] = editCycle.filter(refId =>
            util.testModReference(mods[refId], rule.reference));
          otherMods.forEach(otherMod => {
            prev.push({ source: modId, target: otherMod });
          });
        });
      return prev;
    }, []);

    this.setLinks(links);
    this.mSimulation.restart();
    props.animateFauxDOM(2000);
  }

  private setNodes(nodes: IGraphNode[]) {
    const { nodeRadius, animateFauxDOM } = this.props;
    this.mNodes = nodes.slice(0);
    this.mNodesSVG = this.mBaseGroup.selectAll('g').remove().data(this.mNodes)
      .enter().append('g');
    this.mBaseGroup.selectAll('g')
      .call(d3.drag()
        .on('drag', () => {
          this.mSimulation.restart();
          animateFauxDOM(2000);
        }));
    this.mNodesSVG.append('circle')
      .attr('class', 'mod-node')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', nodeRadius);
    this.mNodesSVG.append('text')
      .attr('class', 'mod-label')
      .attr('x', nodeRadius + 5).attr('y', nodeRadius / 2)
      .text(d => d.id);
    this.mSimulation.nodes(this.mNodes).on('tick', this.tick);
  }

  private setLinks(links: IGraphLinkSpec[]) {
    this.mLinks = links.slice(0) as any;
    this.mLinksSVG =
      this.mBaseGroup.selectAll('line').remove().data(this.mLinks).enter().append('line');
    this.mLinksSVG.attr('marker-end', 'url(#arrow)').on('click', (obj) => {
      const { gameId, mods, modRules, onRemoveRule } = this.props;
      const bidirRule = modRules.find(rule =>
        rule.type === 'after'
        && util.testModReference(mods[obj.source.id], rule.source)
        && util.testModReference(mods[obj.target.id], rule.reference));
      const sourceId = bidirRule.original ? obj.source.id : obj.target.id;
      const remRule: IRule = {
        type: bidirRule.original ? 'after' : 'before',
        reference: bidirRule.original ? bidirRule.reference : bidirRule.source,
      };
      onRemoveRule(gameId, sourceId, remRule);
    });
    this.mSimulation.force('link', d3.forceLink(this.mLinks).id((d: any) => d.id).distance(80));
  }

  private makeReference = (mod: types.IMod): IReference => {
    // return a reference that matches by name but any version.
    // The version-attribute isn't set at all because there is no pattern
    // in semver that actually matches everything (* doesn't match versions
    // with "-something" at the end)
    return (mod.attributes['logicalFileName'] !== undefined)
      ? {
        logicalFileName: mod.attributes['logicalFileName'],
      } : {
        fileExpression: mod.attributes['fileExpression']
                     || path.basename(mod.attributes['fileName'],
                                      path.extname(mod.attributes['fileName']))
                     || mod.attributes['name'],
      };
  }

  private genMarker(svg: d3.Selection<d3.BaseType, {}, null, undefined>) {
    svg.append('marker')
      .attr('id', 'arrow')
      .attr('markerWidth', 4).attr('markerHeight', 4)
      .attr('refX', 4).attr('refY', 2)
      .attr('orient', 'auto')
      .append('path')
        .attr('class', 'marker-arrow')
        .attr('d', 'M0,0 L0,4 L4,2 L0,0');
  }

  private tick = () => {
    if (this.mLinksSVG !== undefined) {
      this.mLinksSVG
        .attr('x1', (d: IGraphLink) => d.source.x)
        .attr('y1', (d: IGraphLink) => d.source.y)
        .attr('x2', (d: IGraphLink) => d.target.x)
        .attr('y2', (d: IGraphLink) => d.target.y);

      this.mNodesSVG.attr('transform', (d: IGraphNode) => `translate(${d.x}, ${d.y})`);
    }
  }
}

const emptyObj = {};
const emptyArr = [];

function mapStateToProps(state): IConnectedProps {
  const gameId = selectors.activeGameId(state);
  return {
    gameId,
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts'], emptyObj),
    mods: gameId !== undefined ? state.persistent.mods[gameId] : emptyObj,
    editCycle: util.getSafe(state, ['session', 'dependencies', 'editCycle'], undefined),
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onClose: () => dispatch(setEditCycle(undefined)),
    onAddRule: (gameId, modId, rule) =>
      dispatch(actions.addModRule(gameId, modId, rule)),
    onRemoveRule: (gameId, modId, rule) =>
      dispatch(actions.removeModRule(gameId, modId, rule)),
  };
}

export default translate(['common', 'dependency-manager'], {wait: false})(
  connect(mapStateToProps, mapDispatchToProps)(
    withFauxDOM(ConflictGraph))) as React.ComponentClass<IConflictGraphProps>;
