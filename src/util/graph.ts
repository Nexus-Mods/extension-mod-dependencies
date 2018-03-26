import * as d3 from 'd3';
import * as d3Force from 'd3-force';
import * as d3Scale from 'd3-scale';
import { IReference, IRule } from 'modmeta-db';
import { util } from 'vortex-api';
import { IBiDirRule } from '../types/IBiDirRule';

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
  highlight: boolean;
  idx?: number;
}

export interface IGraphLinkSpec {
  source: string;
  target: string;
  highlight: boolean;
}

class Graph {
  private mSimulation: d3.Simulation<IGraphNode, undefined>;
  private mBaseGroup: d3.Selection<d3.BaseType, {}, null, undefined>;
  private mNodesSVG: d3.Selection<d3.BaseType, IGraphNode, d3.BaseType, {}>;
  private mLinksSVG: d3.Selection<d3.BaseType, IGraphLink, d3.BaseType, {}>;
  private mRadius: number;
  private mNode: HTMLDivElement;
  private mLinks: IGraphLinkSpec[];
  private mWidth: number;
  private mHeight: number;
  private mTickUntil: number;

  constructor(width: number, height: number, nodeDistance: number, nodeRadius: number,
              connectFauxDOM: (id: string, name: string) => any) {
    this.mRadius = nodeRadius;
    this.mWidth = width;
    this.mHeight = height;
    this.mNode = connectFauxDOM('div', 'chart');

    const svg = d3.select(this.mNode).append('svg')
      .attr('width', width)
      .attr('height', height);
    this.genMarker(svg);

    this.mBaseGroup = svg.append('g');

    this.mSimulation = d3.forceSimulation()
      .force('charge', d3.forceManyBody())
      .force('collide', d3.forceCollide(nodeDistance))
      .force('center', d3.forceCenter(width / 2, height / 2)) as any;
  }

  public get node() {
    return this.mNode;
  }

  public reposition(onFinish: () => void) {
    setTimeout(() => {
      this.tickRepeat(onFinish, 1000);
    }, 500);
    this.mSimulation.restart();
  }

  public tickRepeat = (onFinish: () => void, duration?: number) => {
    if (duration !== undefined) {
      this.mTickUntil = Date.now() + duration;
    }
    window.requestAnimationFrame(() => {
      this.mSimulation.tick();
      this.tick();
      if (Date.now() < this.mTickUntil) {
        this.tickRepeat(onFinish);
      } else {
        onFinish();
      }
    });
  }

  public setNodes(nodes: IGraphNode[]) {
    this.mBaseGroup.selectAll('g').remove();
    this.mNodesSVG = this.mBaseGroup.selectAll('g').data(nodes).enter().append('g')
      .attr('x', this.mWidth / 2).attr('y', this.mHeight / 2);

    this.mNodesSVG.append('circle')
      .attr('class', 'mod-node')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.mRadius);
    this.mNodesSVG.append('text')
      .attr('class', 'mod-label')
      .attr('x', this.mRadius + 5).attr('y', this.mRadius / 2)
      .text(d => d.id);
    this.mSimulation.nodes(nodes).on('tick', this.tick);

    this.mNodesSVG.selectAll('circle')
      .call(d3.drag());
  }

  public setLinks(links: IGraphLinkSpec[],
                  onClick: (source: string, target: string) => void,
                  onHighlight: (source: string, target: string, highlight: boolean) => void) {
    this.mBaseGroup.selectAll('line').remove();
    this.mLinksSVG = this.mBaseGroup.selectAll('line')
      .data(links as any as IGraphLink[]).enter().append('line');
    this.mLinksSVG
      .attr('class', (d: IGraphLink) => d.highlight ? 'cycle-link-highlighted' : 'cycle-link')
      .attr('id', (d: IGraphLink) => `connector-${d.source.id}-${d.target.id}`)
      .attr('marker-end', 'url(#arrow)')
      .on('click', (obj) => {
        onClick(obj.source.id, obj.target.id);
      })
      .on('mouseover', (obj) => {
        onHighlight(obj.source.id, obj.target.id, true);
      })
      .on('mouseout', (obj) => {
        onHighlight(obj.source.id, obj.target.id, false);
      });
    this.mSimulation.force('link', d3.forceLink(links).id((d: any) => d.id));
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
}

export default Graph;
