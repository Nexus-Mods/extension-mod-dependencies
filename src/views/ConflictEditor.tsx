import { IBiDirRule } from '../types/IBiDirRule';
import { IConflict } from '../types/IConflict';

import { setConflictDialog, setFileOverrideDialog } from '../actions';

import { RuleChoice } from '../util/getRuleTypes';

import { NAMESPACE } from '../statics';

import * as React from 'react';
import { Button, FormControl,
         Modal, OverlayTrigger, Popover, Table } from 'react-bootstrap';
import { withTranslation, WithTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import * as semver from 'semver';
import { actions as vortexActions, ComponentEx, EmptyPlaceholder, FlexLayout, FormInput, Spinner,
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

type IProps = IConnectedProps & IActionProps & WithTranslation;

type RuleVersion = 'any' | 'compatible' | 'exact';

interface IRuleSpec {
  type: RuleChoice;
  version: RuleVersion;
}

interface IComponentState {
  showOnlyUnresolved: boolean;
  filterValue: string;
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
        && util.testModReference(conflict.otherMod, rule.reference));

    res[conflict.otherMod.id] = existingRule !== undefined
      ? {
        type: existingRule.type as any,
        version: importVersion(existingRule.reference.versionMatch),
      } : { type: undefined, version: 'any' };
  });
  return res;
}

function nop() {
  // nop
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
      rules: {},
      filterValue: '',
      showOnlyUnresolved: false
    });
  }

  public componentDidMount() {
    this.refreshRules(this.props);
  }

  public UNSAFE_componentWillReceiveProps(nextProps: IProps) {
    if ((this.props.conflicts !== nextProps.conflicts)
        || (this.props.gameId !== nextProps.gameId)
        || (this.props.modIds !== nextProps.modIds)
        || (this.props.modRules !== nextProps.modRules)) {
      // find existing rules for these conflicts
      this.refreshRules(nextProps);
    }
  }

  public render(): JSX.Element {
    const {t, modIds, mods, conflicts} = this.props;
    const { filterValue, showOnlyUnresolved } = this.state;

    let modName = '';

    if (modIds !== undefined) {
      if (modIds.length === 1) {
        modName = util.renderModName(mods[modIds[0]]);
      } else if (modIds.length > 1) {
        modName = t('Multiple');
      }
    }

    const filterInput = ((conflicts !== undefined) && (modIds?.length > 0))
      ? <FormInput
          className='conflict-filter-input'
          value={filterValue}
          placeholder={t('Search for a rule...')}
          onChange={this.onFilterChange}
          debounceTimer={100}
          clearable
        />
      : null;

    const content = (conflicts === undefined)
      ? (
        <div className='conflicts-loading'>
          <Spinner />
          {t('Conflicts haven\'t been calculated yet')}
        </div>
      )
      : (modIds?.length > 0)
        ? ( this.renderConflicts() )
        : ( <EmptyPlaceholder icon='conflict' text={t('You have no file conflicts. Wow!')} /> );

    return (
      <Modal onKeyPress={this.onKeyPress} id='conflict-editor-dialog' show={modIds !== undefined} onHide={nop}>
        <Modal.Header><Modal.Title>{modName}</Modal.Title></Modal.Header>
        <Modal.Body>
          {filterInput}
          {content}
        </Modal.Body>
        <Modal.Footer>
          <FlexLayout.Fixed className='conflict-editor-secondary-actions'>
            <Button onClick={this.clearRules}>{t('Clear Rules')}</Button>
            <Button onClick={this.useSuggested}>{t('Use Suggestions')}</Button>
            <Button
              onClick={this.toggleShowUnresolved}>{showOnlyUnresolved ? t('Show All') : t('Show Unresolved')}
            </Button>
          </FlexLayout.Fixed>
          <FlexLayout.Fixed className='conflict-editor-main-actions'>
            <Button onClick={this.close}>{t('Cancel')}</Button>
            <Button onClick={this.save}>{t('Save')}</Button>
          </FlexLayout.Fixed>
        </Modal.Footer>
      </Modal>
    );
  }

  private refreshRules = (props: IProps) => {
    this.nextState.rules = (props.modIds || []).reduce(
        (prev: { [modId: string]: { [refId: string]: IRuleSpec } }, modId: string) => {
      prev[modId] = getRuleSpec(modId, props.mods, props.conflicts[modId]);
      return prev;
    }, {});
  }

  private clearRules = () => {
    const { t, modIds, conflicts } = this.props;
    this.context.api.showDialog('question', t('Confirm'), {
      text: t('This will clear/remove the existing conflict rules from ALL of your mods, '
            + 'Please be aware that if saved, this action cannot be undone and the mod rules '
            + 'will have to be set again.'),
    }, [
        { label: 'Cancel', default: true },
        {
          label: 'Clear Rules',
          action: () => {
            this.nextState.rules = (modIds || []).reduce(
              (prev: { [modId: string]: { [refId: string]: IRuleSpec } }, modId: string) => {
                const res: { [modId: string]: IRuleSpec } = {};
                (conflicts[modId] || []).forEach(conflict => {
                  res[conflict.otherMod.id] = { type: undefined, version: 'any' };
                });
                prev[modId] = res;
                return prev;
            }, {});
          }
        },
    ]);
  };

  private toggleShowUnresolved = () => {
    this.nextState.showOnlyUnresolved = !this.state.showOnlyUnresolved;
  }

  private useSuggested = () => {
    const { t, mods, modIds, conflicts } = this.props;
    this.context.api.showDialog('question', t('Confirm'), {
      bbcode: t('Vortex can set some of the rules automatically based on the last modified time of each conflicting file. '
              + 'Files that have been modified/created more recently will be loaded after older ones. '
              + 'This may not be the correct choice for all rules, and shouldn\'t be perceived as such.[br][/br][br][/br]'
              + 'Loading mods in the incorrect order can lead to in-game errors such as:[br][/br][br][/br]'
              + '[list][*]Mods not having an effect on the game[*]Incorrect textures or models showing up '
              + '[*]The game crashing[/list][br][/br]If you find that your mods don\'t work correctly ' 
              + 'you can always come here and change their order.[br][/br][br][/br]'
              + 'As a general guideline: patches and options should load after their base mod, mods that depend '
              + 'on another one should load after the dependency. Beyond that you\'re probably best off loading '
              + 'newer mods after older ones, lesser known mods after the very popular ones and then the ones you '
              + 'care most about after the ones you can live without.'),
    }, [
        { label: 'Cancel', default: true },
        {
          label: 'Use Suggested',
          action: () => {
            this.nextState.rules = (modIds || []).reduce(
              (prev: { [modId: string]: { [refId: string]: IRuleSpec } }, modId: string) => {
                const modRules = (mods[modId] !== undefined)
                  ? (mods[modId].rules || [])
                  : [];

                const res: { [modId: string]: IRuleSpec } = {};
                (conflicts[modId] || []).forEach(conflict => {
                  const existingRule = modRules
                    .find(rule => (['before', 'after', 'conflicts'].indexOf(rule.type) !== -1)
                      && util.testModReference(conflict.otherMod, rule.reference));

                  res[conflict.otherMod.id] = (conflict.suggestion !== null)
                    ? {
                        type: conflict.suggestion,
                        version: (existingRule !== undefined)
                          ? importVersion(existingRule.reference.versionMatch)
                          : 'any',
                      }
                    : (existingRule !== undefined)
                      ? {
                          type: existingRule.type as any,
                          version: importVersion(existingRule.reference.versionMatch),
                        }
                      : { type: undefined, version: 'any' };
                });
              prev[modId] = res;
              return prev;
            }, {});
          }
        },
    ]);
  };

  private onFilterChange = (input) => {
    this.nextState.filterValue = input;
  }

  private applyFilter = (conflict: IConflict, modId: string): boolean => {
    const { mods } = this.props;
    const { filterValue, rules, showOnlyUnresolved } = this.state;
    if (!filterValue && !showOnlyUnresolved) {
      return true;
    }

    if (mods[conflict.otherMod.id] === undefined) {
      return false;
    }

    const isUnresolved = (modId, otherModId) => {
      const isRuleSet: boolean = (rules[otherModId]?.[modId] === undefined)
      ? (mods[otherModId].rules || [])
         .find(rule => (['before', 'after', 'conflicts'].indexOf(rule.type) !== -1)
                      && (util as any).testModReference(mods[modId], rule.reference)) !== undefined
      : rules[otherModId][modId].type !== undefined;

      return (showOnlyUnresolved)
        ? (rules[modId][otherModId] === undefined)
          ? !isRuleSet
          : (rules[modId][otherModId].type === undefined) && !isRuleSet
        : true;
    }

    const isMatch = (val: string) => val.toLowerCase().includes(filterValue.toLowerCase());
    const modName: string = util.renderModName(mods[modId]);
    const otherModName: string = util.renderModName(mods[conflict.otherMod.id]);
    const testFilterMatch = () => (filterValue)
      ? (isMatch(modName) || isMatch(otherModName))
      : true;

    return testFilterMatch() && isUnresolved(modId, conflict.otherMod.id);
  }

  private onKeyPress = (evt: React.KeyboardEvent<Modal>) => {
    if (evt.charCode === 13) {
      this.save();
    }
  }

  private renderConflicts = (): JSX.Element => {
    const { t, conflicts, mods, modIds } = this.props;
    const modEntries = (modIds || [])
      .map(modId => ({
        id: modId,
        name: util.renderModName(mods[modId], { version: true }),
      }))
      .sort((lhs, rhs) => lhs.name.localeCompare(rhs.name))

    const renderModEntry = (modId: string, name: string) => {
      const filtered = (conflicts[modId] || [])
        .filter(conflict => this.applyFilter(conflict, modId));
      return (filtered.length > 0) ? (
      <div key={`mod-conflict-element-${modId}`}>
        <div className='mod-conflict-group-header'>
            <label>{util.renderModName(mods[modId])}</label>
            <a data-modid={modId} data-action='before_all' onClick={this.applyGroupRule}>{t('Before All')}</a>
            <a data-modid={modId} data-action='after_all' onClick={this.applyGroupRule}>{t('After All')}</a>
          </div>
        <Table className='mod-conflict-list'>
          <tbody>
            {filtered.map((conf: IConflict) => this.renderConflict(modId, name, conf))}
          </tbody>
        </Table>
      </div>
      ) : null
    };

    return (modEntries.length > 0)
      ? (
        <div>
          {modEntries.map(entry => renderModEntry(entry.id, entry.name))}
        </div>
      )
      : null;
  }

  private applyGroupRule = (evt: React.MouseEvent<any>) => {
    evt.preventDefault();
    const { modIds, conflicts } = this.props;
    const { rules } = this.state;
    const action = evt.currentTarget.getAttribute('data-action');
    const modId = evt.currentTarget.getAttribute('data-modid');
    if (['after_all', 'before_all'].indexOf(action) === -1) {
      return;
    }

    const refIds = Object.keys(rules[modId]);
    this.nextState.rules[modId] = refIds.reduce((accum, iter) => {
      const setRules = {
        version: rules[modId]?.[iter]?.version || 'any',
        type: (action === 'before_all') ? 'before' : 'after',
      };

      accum[iter] = setRules;
      return accum;
    }, {});

    if ((conflicts !== undefined) && (Object.keys(conflicts).length === modIds?.length)) {
      // We're displaying the referenced conflicts in the editor. Need to modify
      //  those as well.
      refIds.forEach(refMod => {
        this.nextState.rules[refMod][modId] = { type: undefined, version: 'any' };
      });
    }
  }

  private renderConflict = (modId: string, name: string, conflict: IConflict) => {
    const {t, modRules, mods} = this.props;
    const {rules} = this.state;

    if ((mods[modId] === undefined)
        || (mods[conflict.otherMod.id] === undefined)) {
      return null;
    }

    const popover = (
      <Popover
        className='conflict-popover'
        id={`conflict-popover-${conflict.otherMod.id}`}
      >
        {conflict.files.slice(0).sort().map(fileName => <p key={fileName}>{fileName}</p>)}
        <Button data-modid={modId} onClick={this.openOverrideDialog}>
          {t('Edit individual files')}
        </Button>
      </Popover>
    );

    const rule = rules[modId][conflict.otherMod.id];

    let reverseRule: IBiDirRule;

    if (rule.type === undefined) {
      // no rule on this to solve the conflict but maybe there is one the other way around?
      const refId = conflict.otherMod.id;

      if (rules[refId] !== undefined) {
        // this path is taken in the case where the dialog shows the rules for both mods.
        // since the rules for the other mod might be changed, we have to use the unsaved state
        const reverseMod =
          (rules[refId]?.[modId] !== undefined)
          && (['before', 'after'].indexOf(rules[refId]?.[modId].type) !== -1);

        if (reverseMod) {
          reverseRule = {
            source: { id: modId },
            reference: { id: refId },
            original: false,
            type: rules[refId][modId].type === 'before' ? 'after' : 'before',
          };
        }
      } else {
        // if the dialog shows only the rules for the one mod, the reverse rules are taken
        // from modRules because rules doesn't contain them and we they can't get changed in
        // this dialog anyway
        reverseRule = modRules
          .find(iter => !iter.original
                    && util.testModReference(conflict.otherMod, iter.reference)
                    && util.testModReference(mods[modId], iter.source));
      }
    }

    return (
      <tr key={JSON.stringify(conflict)}>
        <td style={{ width: '8em' }}>
          {t('Load')}
        </td>
        <td className='conflict-rule-owner'>
          <div>{name}</div>
        </td>
        <td>
          <FormControl
            className='conflict-rule-select'
            componentClass='select'
            value={rule.type || reverseRule?.type || 'norule'}
            onChange={this.setRuleType}
            data-modid={modId}
            data-refid={conflict.otherMod.id}
            disabled={(reverseRule !== undefined)}
          >
            <option value='norule'>???</option>
            <option value='before'>
              {conflict.suggestion === 'before' ? t('before (suggested)') : t('before')}
            </option>
            <option value='after'>
              {conflict.suggestion === 'after' ? t('after (suggested)') : t('after')}
            </option>
            <option value='conflicts'>{t('never together with')}</option>
          </FormControl>
        </td>
        <td className='conflict-rule-description'>
          <div className='conflict-rule-reference'>
            <div className='conflict-rule-name'>
              <div>{util.renderModName(mods[conflict.otherMod.id], { version: true })}</div>
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
            disabled={(reverseRule !== undefined)}
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
        <td style={{ width: '5em' }}>
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
              otherMod: (util as any).renderModReference(rule.reference, mods[rule.reference.id]),
              thisMod: (util as any).renderModReference(rule.source, mods[rule.source.id]) } })}
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
      && util.testModReference(mods[modId], iter.reference);

    const refMod: types.IMod = Object.keys(mods).map(iter => mods[iter])
      .find(iter => util.testModReference(iter, rule.reference)
                 && iter.rules !== undefined
                 && (iter.rules.find(findRule) !== undefined));

    if (refMod === undefined) {
      // paranoia check, this should not be possible. The only way it could happen if, due to a
      // failed update we have the "reverse" rule but the original is gone.
      return;
    }

    const originalRule = refMod.rules.find(findRule);

    this.context.api.showDialog('question', t('Confirm'), {
      text: t('This will remove the existing rule so you can set a new one on this mod.'),
    }, [
        { label: 'Cancel' },
        { label: 'Remove Rule', default: true, action: () => {
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
    const { gameId, onOverrideDialog } = this.props;
    const modId = evt.currentTarget.getAttribute('data-modid');
    onOverrideDialog(gameId, modId);
  }

  private save = () => {
    const { gameId, mods, onAddRule, onRemoveRule } = this.props;
    const { rules } = this.state;

    Object.keys(rules).forEach(modId => {
      if (mods[modId] === undefined) {
        return;
      }
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
      util.getSafe(state, ['session', 'dependencies', 'conflicts'], undefined),
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

export default withTranslation(['common', NAMESPACE])(
  connect(mapStateToProps, mapDispatchToProps)(
  ConflictEditor) as any) as React.ComponentClass<{}>;
