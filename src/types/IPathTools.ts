import { types } from 'vortex-api';

export interface IPathTools {
  sep: string;
  join: (...segment: string[]) => string;
  basename(path: string, ext?: string): string;
  dirname(path: string): string;
  relative(lhs: string, rhs: string): string;
  isAbsolute(path: string): boolean;
}

export interface IPathToolsExt extends IPathTools {
  toRelPath?: (mod: types.IMod, filePath: string) => string;
}