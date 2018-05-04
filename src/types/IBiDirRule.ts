import { RuleType } from 'modmeta-db';
import { types } from 'vortex-api';

export interface IBiDirRule {
  source: any;
  type: RuleType;
  reference: any;
  original: boolean;
}
