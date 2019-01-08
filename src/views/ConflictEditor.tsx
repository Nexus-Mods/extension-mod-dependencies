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
  modIds: string[];
  conflicts: { [modId: string]: IConflict[] };
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
  rules: { [modId: string]: { [refId: string]: IRuleSpec } };
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

  (conflicts || []).forEach(conflict => {
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
      rules: (props.modIds || []).reduce((prev: { [modId: string]: { [refId: string]: IRuleSpec } }, modId: string) => {
        prev[modId] = getRuleSpec(modId, props.mods, props.conflicts[modId]);
        return prev;
      }, {}),
    });
  }

  public componentWillReceiveProps(nextProps: IProps) {
    // find existing rules for these conflicts
    this.nextState.rules = (nextProps.modIds || []).reduce((prev: { [modId: string]: { [refId: string]: IRuleSpec } }, modId: string) => {
      prev[modId] = getRuleSpec(modId, nextProps.mods, nextProps.conflicts[modId]);
      return prev;
    }, {});
  }

  public render(): JSX.Element {
    const {t, modIds, mods, conflicts} = this.props;

    let modName = '';
    
    if (modIds !== undefined) {
      if (modIds.length === 1) {
        modName = util.renderModName(mods[modIds[0]]);
      } else if (modIds.length > 1) {
        modName = t('Multiple');
      }
    }

    return (
      <Modal id='conflict-editor-dialog' show={modIds !== undefined} onHide={this.close}>
        <Modal.Header><Modal.Title>{modName}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Table className='mod-conflict-list'>
            <tbody>
              {(modIds || []).map(modId => (conflicts[modId] || []).map(conflict => this.renderConflict(modId, conflict)))}
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

  private renderConflict = (modId: string, conflict: IConflict) => {
    const {t, modRules, mods} = this.props;
    const {rules} = this.state;
    const popover = (
      <Popover
        className='conflict-popover'
        id={`conflict-popover-${conflict.otherMod}`}
      >
        {conflict.files.slice(0).sort().map(fileName => <p key={fileName}>{fileName}</p>)}
        <Button data-modid={modId} onClick={this.openOverrideDialog}>
          {t('Edit individual files')}
        </Button>
      </Popover>
    );

    const rule = rules[modId][conflict.otherMod.id];

    let reverseMod: string;
    let reverseRule: IBiDirRule;
    let reverseType: string;

    if (rule.type === undefined) {
      reverseRule = modRules
        .find(iter => !iter.original
                   && util.testModReference(conflict.otherMod, iter.reference)
                   && util.testModReference(mods[modId], iter.source));
      if (reverseRule !== undefined) {
        reverseType = reverseRule.type;
      } else {
        reverseMod = Object.keys(rules).find(refId =>
          (rules[refId][modId] !== undefined) && (['before', 'after'].indexOf(rules[refId][modId].type) !== -1)
        );
        if (reverseMod !== undefined) {
          reverseType = rules[reverseMod][modId].type === 'before' ? 'after' : 'before';
        }
      }
    }

    return (
      <tr key={JSON.stringify(conflict)}>
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
            value={rule.type || reverseType || 'norule'}
            onChange={this.setRuleType}
            data-modid={modId}
            data-refid={conflict.otherMod.id}
            disabled={(reverseRule !== undefined) || (reverseMod !== undefined)}
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
            data-modid={modId}
            data-refid={conflict.otherMod.id}
            className='conflict-rule-version'
            disabled={(reverseRule !== undefined) || (reverseMod !== undefined)}
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
          {this.renderReverseRule(modId, reverseRule)}
        </td>
      </tr>
    );
  }

  private renderReverseRule(modId: string, rule: IBiDirRule) {
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
        data-modid={modId}
        data-rule={JSON.stringify(rule)}
        onClick={this.unlock}
        disabled={rule.source.id === undefined}
      />
    );
  }

  private unlock = (evt: React.MouseEvent<HTMLDivElement>) => {
    const { t, gameId, mods, onRemoveRule } = this.props;
    const modId = evt.currentTarget.getAttribute('data-modid');
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

  private setRuleType = (evt: React.MouseEvent<any>) => {
    const modId = evt.currentTarget.getAttribute('data-modid');
    const refId = evt.currentTarget.getAttribute('data-refid');
    this.nextState.rules[modId][refId].type = (evt.currentTarget.value === 'norule')
      ? undefined
      : evt.currentTarget.value;
  }

  private setRuleVersion = (evt: React.MouseEvent<any>) => {
    const modId = evt.currentTarget.getAttribute('data-modid');
    const refId = evt.currentTarget.getAttribute('data-refid');
    this.nextState.rules[modId][refId].version = evt.currentTarget.value;
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

  private openOverrideDialog = (evt: React.MouseEvent<any>) => {
    const { gameId, onClose, onOverrideDialog } = this.props;
    const modId = evt.currentTarget.getAttribute('data-modid');
    onOverrideDialog(gameId, modId);
    onClose();
  }

  private save = () => {
    const { gameId, mods, onAddRule, onRemoveRule } = this.props;
    const { rules } = this.state;

    Object.keys(rules).forEach(modId => {
      Object.keys(rules[modId]).forEach(otherId => {
        if (mods[otherId] === undefined) {
          return;
        }
        const origRule = (mods[modId].rules || [])
          .find(rule => (['before', 'after', 'conflicts'].indexOf(rule.type) !== -1)
                        && (util as any).testModReference(mods[otherId], rule.reference));

        if (origRule !== undefined) {
          onRemoveRule(gameId, modId, origRule);
        }

        if (rules[modId][otherId].type !== undefined) {
          onAddRule(gameId, modId, {
            reference: {
              id: otherId,
              versionMatch: this.translateModVersion(mods[otherId], rules[modId][otherId].version),
            },
            type: rules[modId][otherId].type,
          });
        }
      });
    });

    this.close();
  }
}

const emptyObj = {};

function mapStateToProps(state): IConnectedProps {
  const dialog = state.session.dependencies.conflictDialog || emptyObj;
  return {
    gameId: dialog.gameId,
    modIds: dialog.modIds,
    conflicts:
      util.getSafe(state, ['session', 'dependencies', 'conflicts'], emptyObj),
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
