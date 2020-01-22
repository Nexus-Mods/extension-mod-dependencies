import { IReference } from 'modmeta-db';
import { types, util } from 'vortex-api';

function renderReference(ref: any, mod: types.IMod) {
  if ((ref.id !== undefined) && (mod !== undefined)) {
    return util.renderModName(mod, { version: true });
  }

  if ((ref.logicalFileName === undefined) && (ref.fileExpression === undefined)) {
    return ref.fileMD5;
  }

  let name = ref.logicalFileName || ref.fileExpression;
  if (ref.versionMatch !== undefined) {
    name += ' v' + ref.versionMatch;
  }

  if (!name && (ref.id !== undefined)) {
    name = ref.id;
  }

  return name;
}

export default renderReference;
