/**
 * The share dialog: who can open this document, and how. Drawn to the Share board.
 *
 * Three things, in the order a person reaches for them: add people by name or
 * address, see who already has access, and decide what everyone else gets.
 * "Everyone else" is general access (restricted, the organisation, or anyone
 * with the link) and the link has its own settings: role, expiry, password and
 * whether readers may download.
 *
 * The owner sees all of it. An editor who was added by name can add and remove
 * people and sees the rest as text, because general access and the link are the
 * owner's. The server decides again on every call and its sentence is shown as
 * sent when it refuses.
 *
 * ── The link is shown once ──────────────────────────────────────────────────
 * Only a hash of the link's token is stored, so the URL exists in the response
 * that made it and nowhere after. The dialog keeps that one copy in memory for
 * the life of the page (core/share.ts) and offers "Copy link" while it has it.
 * After a reload there is nothing to copy, and the way to a link you can send is
 * a new one, which retires the old.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DocumentMeta, GeneralAccess, LinkState, Member, ShareRole, SharingState } from '@shared/api';
import { errorText } from '../api';
import { sharing } from '../client';
import { useApp } from '../state';
import { colorFor } from './color';
import { Button, Select, Switch, TextField } from './controls';
import {
  buildingsIcon,
  calendarBlankIcon,
  envelopeSimpleIcon,
  eyeIcon,
  eyeSlashIcon,
  globeSimpleIcon,
  Icon,
  linkIcon,
  lockSimpleIcon,
  userPlusIcon,
  type PhIcon
} from './icons';
import {
  EXPIRY_OPTIONS,
  expiryFor,
  expiryNote,
  forgetLinkUrl,
  localDateString,
  parseInvitee,
  recallLinkUrl,
  rememberLinkUrl,
  ROLE_LABEL,
  SHARE_ROLE_OPTIONS,
  type ExpiryPreset
} from './share';
import { Avatar, Banner, Bone, copyText, Modal, SkeletonRows, useModalClose, useNotify } from './ui';
import './share.css';

const now = (): number => Math.floor(Date.now() / 1000);

const roleOptions = SHARE_ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
const expiryOptions = EXPIRY_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
/** A member's role menu also ends their access, which is one place fewer to look for it. */
const memberRoleOptions = [...roleOptions, { value: 'remove', label: 'Remove access' }];

/** An expiry as a preset and a date, for the controls that edit one. */
function ExpiryField({
  label,
  preset,
  date,
  onPreset,
  onDate,
  disabled
}: {
  label: string;
  preset: ExpiryPreset;
  date: string;
  onPreset: (p: ExpiryPreset) => void;
  onDate: (d: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="oa-share-expiry">
      <Select
        label={label}
        size="sm"
        value={preset}
        disabled={disabled}
        options={expiryOptions}
        onChange={(v) => onPreset(v as ExpiryPreset)}
        style={{ minWidth: 150, flex: 1 }}
      />
      {preset === 'custom' && (
        <TextField
          type="date"
          size="sm"
          aria-label={`${label}, date`}
          value={date}
          disabled={disabled}
          min={localDateString(now() + 86_400)}
          onChange={(e) => onDate(e.target.value)}
        />
      )}
    </div>
  );
}

function Person({
  name,
  suffix,
  sub,
  color,
  pending,
  children
}: {
  name: string;
  /** "(you)", drawn beside the name and not part of it: the avatar's initials are the name's. */
  suffix?: string;
  sub: string;
  color: string;
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="oa-person">
      {pending ? (
        <span className="oa-person-pending" aria-hidden="true">
          <Icon icon={envelopeSimpleIcon} size={15} />
        </span>
      ) : (
        <Avatar name={name} color={color} size={32} />
      )}
      <span className="oa-person-text">
        <span className="oa-person-name oa-ellipsis">
          {name}
          {suffix && <span className="oa-person-you"> {suffix}</span>}
        </span>
        <span className="oa-person-sub oa-ellipsis">{sub}</span>
      </span>
      {children}
    </li>
  );
}

function MemberRow({
  member,
  busy,
  onRole,
  onRemove
}: {
  member: Member;
  busy: boolean;
  onRole: (role: ShareRole) => void;
  onRemove: () => void;
}) {
  const label = member.name ?? member.email ?? 'Someone';
  const sub = member.pending ? 'Joins when they sign in' : member.handle ? `@${member.handle}` : (member.email ?? '');
  return (
    <Person name={label} sub={sub} color={colorFor(member.userId ?? member.email ?? member.id)} pending={member.pending}>
      {member.expiresAt !== null && (
        <span className="oa-pill" data-tone="warn">
          <Icon icon={calendarBlankIcon} size={12} />
          {expiryNote(member.expiresAt, now())}
        </span>
      )}
      {member.pending && (
        <span className="oa-pill" data-tone="app">
          Invite sent
        </span>
      )}
      <Select
        quiet
        size="sm"
        aria-label={`Role for ${label}`}
        value={member.role}
        disabled={busy}
        options={memberRoleOptions}
        onChange={(v) => (v === 'remove' ? onRemove() : onRole(v as ShareRole))}
        style={{ flex: 'none' }}
      />
    </Person>
  );
}

/** One of the three general-access choices. The header is the radio; what is under it
 *  (the link's settings) is ordinary controls, which a radio may not contain. */
function AccessCard({
  icon,
  title,
  note,
  on,
  disabled,
  onPick,
  children
}: {
  icon: PhIcon;
  title: string;
  note: string;
  on: boolean;
  disabled: boolean;
  onPick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="oa-acc" data-on={on ? 'true' : undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        className="oa-acc-head"
        onClick={onPick}
      >
        <span className="oa-acc-icon">
          <Icon icon={icon} size={16} />
        </span>
        <span className="oa-acc-text">
          <span className="oa-acc-title">{title}</span>
          <span className="oa-acc-note">{note}</span>
        </span>
        <span className="oa-acc-dot" aria-hidden="true" />
      </button>
      {on && children && <div className="oa-acc-body">{children}</div>}
    </div>
  );
}

function Footer({ url, onCopy, copied, hasLink, busy, onNewLink }: {
  url: string | undefined;
  onCopy: () => void;
  copied: boolean;
  hasLink: boolean;
  busy: boolean;
  onNewLink: () => void;
}) {
  const close = useModalClose();
  return (
    <>
      {url ? (
        <Button variant="secondary" icon={linkIcon} onClick={onCopy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      ) : hasLink ? (
        <Button variant="secondary" icon={linkIcon} disabled={busy} onClick={onNewLink}>
          New link
        </Button>
      ) : null}
      <span style={{ flex: 1 }} />
      <Button variant="primary" onClick={close}>
        Done
      </Button>
    </>
  );
}

export function ShareDialog({
  meta,
  owner,
  onClose,
  onChanged
}: {
  meta: DocumentMeta;
  /** The owner sees general access and the link; an editor sees them as text. */
  owner: boolean;
  onClose: () => void;
  /** Something that changes what the page shows (who can open it) changed. */
  onChanged: () => void;
}) {
  const notify = useNotify();
  const { me } = useApp();

  const [state, setState] = useState<SharingState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // add
  const [who, setWho] = useState('');
  const [addRole, setAddRole] = useState<ShareRole>('viewer');
  const [addExpiry, setAddExpiry] = useState<ExpiryPreset>('never');
  const [addDate, setAddDate] = useState('');

  // link
  const [url, setUrl] = useState<string | undefined>(() => recallLinkUrl(meta.id));
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [linkExpiry, setLinkExpiry] = useState<ExpiryPreset>('never');
  const [linkDate, setLinkDate] = useState('');
  const [confirmNew, setConfirmNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await sharing.get(meta.id);
      setState(next);
      setLoadError('');
      return next;
    } catch (err) {
      setLoadError(errorText(err, 'Could not load who has access.'));
      return null;
    }
  }, [meta.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // The link's expiry controls start from what is stored.
  const linkExpiresAt = state?.link?.expiresAt ?? null;
  useEffect(() => {
    setLinkExpiry(linkExpiresAt === null ? 'never' : 'custom');
    setLinkDate(linkExpiresAt === null ? '' : localDateString(linkExpiresAt));
  }, [linkExpiresAt]);

  /** One change: busy while it runs, the server's words if it is refused. */
  const run = async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── people ────────────────────────────────────────────────────────────────

  const add = async () => {
    const who2 = parseInvitee(who);
    if (!who2) return setError('Enter a handle or an email address.');
    const expiresAt = expiryFor(addExpiry, now(), addDate);
    if (expiresAt === undefined) return setError('Choose a date in the future.');

    let added: Member | null = null;
    const ok = await run(async () => {
      added = await sharing.addMember(meta.id, { ...who2, role: addRole, expiresAt });
    }, 'Could not add them.');
    if (ok && added) {
      const m = added as Member;
      setWho('');
      notify({ text: m.pending ? `Invited ${m.email ?? 'them'}.` : `Added ${m.name ?? 'them'}.` });
    }
  };

  // ── general access ────────────────────────────────────────────────────────

  const link: LinkState | null = state?.link ?? null;
  const access: GeneralAccess = state?.generalAccess ?? 'restricted';

  const chooseAccess = (next: GeneralAccess) => {
    if (!state || next === access) return;
    void run(async () => {
      if (next === 'link' && !link) {
        const made = await sharing.createLink(meta.id, { role: state.generalRole });
        rememberLinkUrl(meta.id, made.url);
        setUrl(made.url);
      } else {
        await sharing.setGeneral(meta.id, { access: next });
      }
    }, 'Could not change who can open this.');
  };

  const chooseRole = (role: ShareRole) => {
    if (!state) return;
    void run(
      () =>
        access === 'link'
          ? sharing.updateLink(meta.id, { role })
          : sharing.setGeneral(meta.id, { access, role }),
      'Could not change the role.'
    );
  };

  // ── the link ──────────────────────────────────────────────────────────────

  const newLink = () => {
    setConfirmNew(false);
    void run(async () => {
      const made = await sharing.createLink(meta.id, {
        role: state?.generalRole ?? 'viewer',
        allowDownload: link?.allowDownload ?? true
      });
      rememberLinkUrl(meta.id, made.url);
      setUrl(made.url);
      setCopied(false);
    }, 'Could not make a new link.');
  };

  const copy = async () => {
    if (!url) return;
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError('Could not copy. Select the link and copy it.');
    }
  };

  const savePassword = async () => {
    if (!password) return;
    const ok = await run(() => sharing.updateLink(meta.id, { password }), 'Could not set the password.');
    if (ok) {
      setPassword('');
      setEditingPassword(false);
    }
  };

  const setLinkExpiryTo = (preset: ExpiryPreset, date: string) => {
    setLinkExpiry(preset);
    setLinkDate(date);
    const expiresAt = expiryFor(preset, now(), date);
    if (expiresAt === undefined) return; // a date is still to be picked
    void run(() => sharing.updateLink(meta.id, { expiresAt }), 'Could not change the expiry.');
  };

  const turnOffLink = () =>
    void run(async () => {
      await sharing.removeLink(meta.id);
      forgetLinkUrl(meta.id);
      setUrl(undefined);
    }, 'Could not turn off the link.');

  // ── drawing ───────────────────────────────────────────────────────────────

  const passwordOn = (link?.hasPassword ?? false) || editingPassword;

  return (
    <Modal
      title={`Share “${meta.title}”`}
      width={560}
      morph
      onClose={onClose}
      footer={
        state && owner ? (
          <Footer url={url} onCopy={() => void copy()} copied={copied} hasLink={link !== null} busy={busy} onNewLink={() => setConfirmNew(true)} />
        ) : (
          <>
            <span style={{ flex: 1 }} />
            <DoneButton />
          </>
        )
      }
    >
      {!state && !loadError && (
        <div className="oa-share">
          <Bone w="100%" h={40} r={8} />
          <SkeletonRows count={2} avatar />
        </div>
      )}
      {loadError && <Banner tone="danger">{loadError}</Banner>}

      {state && (
        <div className="oa-share">
          {error && <Banner tone="danger">{error}</Banner>}

          <section aria-label="Add people" className="oa-share-add">
            <div className="oa-share-addbox">
              <Icon icon={userPlusIcon} size={16} />
              <input
                aria-label="Handle or email"
                placeholder="Add people by name, handle or email"
                value={who}
                autoComplete="off"
                onChange={(e) => setWho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
              />
              <Select
                quiet
                size="sm"
                aria-label="Role"
                value={addRole}
                options={roleOptions}
                onChange={(v) => setAddRole(v as ShareRole)}
                style={{ flex: 'none' }}
              />
              {who.trim() && (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void add()}>
                  Add
                </Button>
              )}
            </div>
            {who.trim() && (
              <ExpiryField label="Access ends" preset={addExpiry} date={addDate} onPreset={setAddExpiry} onDate={setAddDate} />
            )}
          </section>

          <section aria-label="People with access">
            <h3 className="oa-share-h">People with access</h3>
            <ul className="oa-people">
              <Person
                name={state.owner.name}
                {...(state.owner.userId === me?.id ? { suffix: '(you)' } : {})}
                sub={state.owner.handle ? `@${state.owner.handle}` : state.owner.email}
                color={colorFor(state.owner.userId)}
              >
                <span className="oa-person-role">{ROLE_LABEL.owner}</span>
              </Person>
              {state.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  busy={busy}
                  onRole={(role) => void run(() => sharing.updateMember(meta.id, m.id, { role }), 'Could not change the role.')}
                  onRemove={() => void run(() => sharing.removeMember(meta.id, m.id), 'Could not remove them.')}
                />
              ))}
            </ul>
          </section>

          <section aria-label="General access">
            <h3 className="oa-share-h">General access</h3>
            {owner ? (
              <div role="radiogroup" aria-label="Who can open this" className="oa-acc-group">
                <AccessCard
                  icon={lockSimpleIcon}
                  title="Restricted"
                  note="Only the people above."
                  on={access === 'restricted'}
                  disabled={busy}
                  onPick={() => chooseAccess('restricted')}
                />
                {state.orgName && (
                  <AccessCard
                    icon={buildingsIcon}
                    title={state.orgName}
                    note="Everyone in your organisation."
                    on={access === 'org'}
                    disabled={busy}
                    onPick={() => chooseAccess('org')}
                  >
                    <div className="oa-acc-grid">
                      <Select
                        label="Can"
                        size="sm"
                        aria-label="What they can do"
                        value={state.generalRole}
                        disabled={busy}
                        options={roleOptions}
                        onChange={(v) => chooseRole(v as ShareRole)}
                      />
                    </div>
                  </AccessCard>
                )}
                <AccessCard
                  icon={globeSimpleIcon}
                  title="Anyone with the link"
                  note="No account needed."
                  on={access === 'link'}
                  disabled={busy}
                  onPick={() => chooseAccess('link')}
                >
                  {link && (
                    <>
                      <div className="oa-acc-grid">
                        <Select
                          label="Can"
                          size="sm"
                          aria-label="What they can do"
                          value={state.generalRole}
                          disabled={busy}
                          options={roleOptions}
                          onChange={(v) => chooseRole(v as ShareRole)}
                        />
                        <ExpiryField
                          label="Expires"
                          preset={linkExpiry}
                          date={linkDate}
                          disabled={busy}
                          onPreset={(p) => setLinkExpiryTo(p, linkDate)}
                          onDate={(d) => setLinkExpiryTo('custom', d)}
                        />
                      </div>

                      <div className="oa-acc-password">
                        <Switch
                          label="Require a password"
                          checked={passwordOn}
                          disabled={busy}
                          onChange={(on) => {
                            if (on) setEditingPassword(true);
                            else {
                              setEditingPassword(false);
                              setPassword('');
                              if (link.hasPassword) {
                                void run(() => sharing.updateLink(meta.id, { password: null }), 'Could not remove the password.');
                              }
                            }
                          }}
                        />
                        <span className="oa-acc-label">Password</span>
                        {passwordOn && (
                          <>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <TextField
                                type={showPassword ? 'text' : 'password'}
                                aria-label="Link password"
                                size="sm"
                                placeholder={link.hasPassword ? 'Set a new password' : 'Password'}
                                value={password}
                                autoComplete="new-password"
                                maxLength={128}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void savePassword();
                                }}
                                trailing={
                                  <button
                                    type="button"
                                    className="oa-ib"
                                    data-size="sm"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    onClick={() => setShowPassword((v) => !v)}
                                  >
                                    <Icon icon={showPassword ? eyeSlashIcon : eyeIcon} size={15} />
                                  </button>
                                }
                              />
                            </div>
                            <Button variant="secondary" size="sm" disabled={busy || !password} onClick={() => void savePassword()}>
                              {link.hasPassword ? 'Change' : 'Set password'}
                            </Button>
                          </>
                        )}
                      </div>

                      {url && (
                        <TextField
                          aria-label="Link"
                          size="sm"
                          value={url}
                          readOnly
                          onFocus={(e) => (e.target as HTMLInputElement).select()}
                        />
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {url && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmNew(true)}>
                            New link
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={busy} onClick={turnOffLink}>
                          Turn off link
                        </Button>
                      </div>
                    </>
                  )}
                </AccessCard>
              </div>
            ) : (
              <p className="oa-share-text">
                {access === 'restricted'
                  ? 'Restricted'
                  : `${access === 'org' ? (state.orgName ?? 'Your organisation') : 'Anyone with the link'} · ${ROLE_LABEL[state.generalRole]}`}
              </p>
            )}
          </section>

          {owner && access === 'link' && link && (
            <div className="oa-share-switch">
              <span style={{ flex: 1 }}>Viewers and commenters can download, print and copy</span>
              <Switch
                label="Viewers and commenters can download, print and copy"
                checked={link.allowDownload}
                disabled={busy}
                onChange={(on) =>
                  void run(() => sharing.updateLink(meta.id, { allowDownload: on }), 'Could not change that setting.')
                }
              />
            </div>
          )}
        </div>
      )}

      {confirmNew && (
        <Modal
          title="Make a new link?"
          width={420}
          onClose={() => setConfirmNew(false)}
          footer={
            <>
              <span style={{ flex: 1 }} />
              <CancelButton />
              <Button variant="primary" onClick={newLink}>
                Make new link
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--fg-3)', fontSize: 15 }}>The old link stops working.</p>
        </Modal>
      )}
    </Modal>
  );
}

function DoneButton() {
  const close = useModalClose();
  return (
    <Button variant="primary" onClick={close}>
      Done
    </Button>
  );
}

function CancelButton() {
  const close = useModalClose();
  return (
    <Button variant="secondary" onClick={close}>
      Cancel
    </Button>
  );
}
