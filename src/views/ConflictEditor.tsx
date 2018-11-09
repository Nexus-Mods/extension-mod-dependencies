import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';
import renderReference from '../util/renderReference';

import { setConflictDialog, setFileOverrideDialog } from '../actions';

import { RuleChoice } from '../util/getRuleTypes';

import * as React from 'react';
import { Button, FormControl,
         Modal, OverlayTrigger, Popover, Table } from 'react-bootstrap';
import { translate } from 'react-i18next';
import { connect } from 'react-redux';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import * as semver from 'semver';
import { actions as vortexActions, ComponentEx,
         tooltip, types, util } from 'vortex-api';

interface IConnectedProps {
  gameId: string;
  modId: string;
  conflicts: IConflict[];
  modRules: IBiDirRule[];
  mods: { [modId: string]: types.IMod };
}

interface IActionProps {
  onClose: () => void;
  onAddRule: (gameId: string, modId: string, rule: any) => void;
  onRemoveRule: (gameId: string, modId: string, rule: any) => void;
  onOverrideDialog: (gameId: string, modId: string) => void;
}

type IProps = IConnectedProps & IActionProps;

type RuleVersion = 'any' | 'compatible' | 'exact';

interface IRuleSpec {
  type: RuleChoice;
  version: RuleVersion;
}

interface IComponentState {
  rules: { [modId: string]: IRuleSpec };
}

function importVersion(match: string): RuleVersion {
  if ((match === undefined) || (match === '*')) {
    return 'any';
  } else if (match[0] === '^') {
    return 'compatible';
  } else {
    return 'exact';
  }
}

function getRuleSpec(modId: string,
                     mods: { [modId: string]: types.IMod },
                     conflicts: IConflict[]): { [modId: string]: IRuleSpec } {
  const res: { [modId: string]: IRuleSpec } = {};

  // paranoia check, mods[modId] should never be undefined
  const modRules = (mods[modId] !== undefined)
    ? (mods[modId].rules || [])
    : [];

  conflicts.forEach(conflict => {
    const existingRule = modRules
      .find(rule => (['before', 'after', 'conflicts'].indexOf(rule.type) !== -1)
        && (util as any).testModReference(conflict.otherMod, rule.reference));

    res[conflict.otherMod.id] = existingRule !== undefined
      ? {
        type: existingRule.type as any,
        version: importVersion(existingRule.reference.versionMatch),
      } : { type: undefined, version: 'any' };
  });
  return res;
}

/**
 * editor displaying mods that conflict with the selected one
 * and offering a quick way to set up rules between them
 *
 * @class ConflictEditor
 * @extends {ComponentEx<IProps, {}>}
 */
class ConflictEditor extends ComponentEx<IProps, IComponentState> {
  constructor(props: IProps) {
    super(props);
    this.initState({
      rules: getRuleSpec(props.modId, props.mods, props.conflicts),
    });
  }

  public componentWillReceiveProps(nextProps: IProps) {
    // find existing rules for these conflicts
    this.nextState.rules =
      getRuleSpec(nextProps.modId, nextProps.mods, nextProps.conflicts);
  }

  public render(): JSX.Element {
    const {t, modId, mods, conflicts} = this.props;

    const modName = mods[modId] !== undefined
      ? util.renderModName(mods[modId])
      : '';

    return (
      <Modal id='conflict-editor-dialog' show={modId !== undefined} onHide={this.close}>
        <Modal.Header><Modal.Title>{modName}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Table className='mod-conflict-list'>
            <tbody>
              {conflicts.map(this.renderConflict)}
            </tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={this.close}>{t('Cancel')}</Button>
          <Button onClick={this.save}>{t('Save')}</Button>
        </Modal.Footer>
      </Modal>
    );
  }

  private renderConflict = (conflict: IConflict) => {
    const {t, modId, modRules, mods} = this.props;
    const {rules} = this.state;
    const popover = (
      <Popover
        className='conflict-popover'
        id={`conflict-popover-${conflict.otherMod}`}
      >
        {conflict.files.slice(0).sort().map(fileName => <p key={fileName}>{fileName}</p>)}
        <Button onClick={this.openOverrideDialog}>
          {t('Edit individual files')}
        </Button>
      </Popover>
    );

    const rule = rules[conflict.otherMod.id];

    let reverseRule: IBiDirRule;

    if (rule.type === undefined) {
      reverseRule = modRules
        .find(iter => !iter.original
                   && util.testModReference(conflict.otherMod, iter.reference)
                   && util.testModReference(mods[modId], iter.source));
    }

    return (
      <tr>
        <td>
          {t('Load')}
        </td>
        <td className='conflict-rule-owner'>
          <div>{util.renderModName(mods[modId])}</div>
        </td>
        <td>
          <FormControl
            className='conflict-rule-select'
            componentClass='select'
            value={rule.type || (reverseRule !== undefined ? reverseRule.type : undefined) || 'norule'}
            onChange={this.setRuleType}
            id={conflict.otherMod.id}
            disabled={reverseRule !== undefined}
          >
            <option value='norule'>???</option>
            <option value='before'>{conflict.suggestion === 'before' ? t('before (suggested)') : t('before')}</option>
            <option value='after'>{conflict.suggestion === 'after' ? t('after (suggested)') : t('after')}</option>
            <option value='conflicts'>{t('never together with')}</option>
          </FormControl>
        </td>
        <td className='conflict-rule-description'>
          <div className='conflict-rule-reference'>
            <div className='conflict-rule-name'>
              <div>{util.renderModName(mods[conflict.otherMod.id])}</div>
              <OverlayTrigger trigger='click' rootClose placement='right' overlay={popover}>
                <a>{
                  t('{{ count }} conflicting file', {
                    count: conflict.files.length,
                    ns: 'dependency-manager',
                  })}</a>
              </OverlayTrigger>
            </div>
          </div>
        </td>
        <td>
          <FormControl
            componentClass='select'
            value={rule.version}
            onChange={this.setRuleVersion}
            id={conflict.otherMod.id}
            className='conflict-rule-version'
            disabled={reverseRule !== undefined}
          >
            <option value='any'>{t('Any version')}</option>
            {(conflict.otherMod.version && semver.valid(conflict.otherMod.version))
              ? <option value='compatible'>{t('Compatible version')}</option>
              : null}
            {conflict.otherMod.version
              ? <option value='exact'>{t('Only this version')}</option>
              : null}
          </FormControl>
        </td>
        <td>
          {this.renderReverseRule(reverseRule)}
        </td>
      </tr>
    );
  }

  private renderReverseRule(rule: IBiDirRule) {
    const { t, mods } = this.props;
    if (rule === undefined) {
      return null;
    }

    const tip = (
      <div>
        {t('{{ otherMod }} has a rule referencing {{ thisMod }}',
          { replace: {
              otherMod: renderReference(rule.reference, mods[rule.reference.id]),
              thisMod: renderReference(rule.source, mods[rule.source.id]) } })}
      </div>);

    return (
      <tooltip.IconButton
        id={`conflict-editor-${rule.reference.fileMD5}`}
        className='conflict-editor-reverserule pull-right'
        icon='locked'
        tooltip={tip}
        data-rule={JSON.stringify(rule)}
        onClick={this.unlock}
        disabled={rule.source.id === undefined}
      />
    );
  }

  private unlock = (evt: React.MouseEvent<HTMLDivElement>) => {
    const { t, gameId, modId, mods, onRemoveRule } = this.props;
    const rule = JSON.parse(evt.currentTarget.getAttribute('data-rule'));
    // rule is the "reverse" rule, we need the original.

    const reverseType = rule.type === 'before' ? 'after' : 'before';

    const findRule = iter =>
      (iter.type === reverseType)
      && util.testModReference(mods[modId], iter.reference)

    const refMod: types.IMod = Object.keys(mods).map(modId => mods[modId])
      .find(iter => util.testModReference(iter, rule.reference)
                 && iter.rules !== undefined
                 && (iter.rules.find(findRule) !== undefined));

    const originalRule = refMod.rules.find(findRule);

    this.context.api.showDialog('question', t('Confirm'), {
      text: t('This will remove the existing rule so you can set a new one on this mod.'),
    }, [
        { label: 'Cancel' },
        { label: 'Remove Rule', action: () => {
          onRemoveRule(gameId, refMod.id, {
            type: originalRule.type,
            reference: originalRule.reference,
          });
        } },
    ]);
  }

  private close = () => {
    const { onClose } = this.props;
    onClose();
  }

  private setRuleType = (event) => {
    this.nextState.rules[event.currentTarget.id].type = (event.currentTarget.value === 'norule')
      ? undefined
      : event.currentTarget.value;
  }

  private setRuleVersion = (event) => {
    this.nextState.rules[event.currentTarget.id].version = event.currentTarget.value;
  }

  private translateModVersion(mod: types.IMod, spe: RuleVersion) {
    if ((spe === 'any') || (mod.attributes === undefined)) {
      return '*';
    } else if (spe === 'compatible') {
      return '^' + mod.attributes.version;
    } else {
      return mod.attributes.version;
    }
  }

  private openOverrideDialog = () => {
    const { gameId, modId, onClose, onOverrideDialog } = this.props;
    onOverrideDialog(gameId, modId);
    onClose();
  }

  private save = () => {
    const { gameId, modId, mods, onAddRule, onRemoveRule } = this.props;
    const { rules } = this.state;
    Object.keys(rules).forEach(otherId => {
      if (mods[otherId] === undefined) {
        return;
      }
      const origRule = (mods[modId].rules || [])
        .find(rule => (['before', 'after', 'conflicts'].indexOf(rule.type) !== -1)
                      && (util as any).testModReference(mods[otherId], rule.reference));

      if (origRule !== undefined) {
        onRemoveRule(gameId, modId, origRule);
      }

      if (rules[otherId].type !== undefined) {
        onAddRule(gameId, modId, {
          reference: {
            id: otherId,
            versionMatch: this.translateModVersion(mods[otherId], rules[otherId].version),
          },
          type: rules[otherId].type,
        });
      }
    });

    this.close();
  }
}

const emptyObj = {};
const emptyArr = [];

function mapStateToProps(state): IConnectedProps {
  const dialog = state.session.dependencies.conflictDialog || emptyObj;
  return {
    gameId: dialog.gameId,
    modId: dialog.modId,
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts', dialog.modId], emptyArr),
    mods: dialog.gameId !== undefined ? state.persistent.mods[dialog.gameId] : emptyObj,
    modRules: dialog.modRules,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onClose: () => dispatch(setConflictDialog(undefined, undefined, undefined)),
    onAddRule: (gameId, modId, rule) =>
      dispatch(vortexActions.addModRule(gameId, modId, rule)),
    onRemoveRule: (gameId, modId, rule) =>
      dispatch(vortexActions.removeModRule(gameId, modId, rule)),
    onOverrideDialog: (gameId: string, modId: string) =>
      dispatch(setFileOverrideDialog(gameId, modId)),
  };
}

export default translate(['common', 'dependency-manager'], {wait: false})(
  connect(mapStateToProps, mapDispatchToProps)(
  ConflictEditor)) as React.ComponentClass<{}>;
