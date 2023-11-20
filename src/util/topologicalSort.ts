/* eslint-disable */
import { types } from 'vortex-api';

export default function topologicalSort(graph: types.IMod[]): string[] {
  const visited = new Set();
  const result: string[] = [];

  function visit(modId: string) {
    if (visited.has(modId)) {
      return;
    }

    visited.add(modId);

    const mod = graph.find(iter => iter.id === modId)!;
    const rules = mod.rules?.filter(rule => ['before'].includes(rule.type)
      && graph.find(mod => mod.id === rule.reference.id)) ?? [];

    rules.forEach((rule: types.IModRule) => {
      visit(rule.reference.id as string);
    });

    result.push(mod.id);
  }

  graph.forEach((mod) => {
    visit(mod.id);
  });

  return result.reverse();
}