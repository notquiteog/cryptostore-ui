import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import {
  num, money, count as fmtCount, relTime, fullDate, shortDate, initials, stagger,
} from '../../utils/adminFormat';
import PermissionEditor from '../../components/PermissionEditor';
import RedactionPreview from '../../components/RedactionPreview';
import PageHeader from '../../components/admin/PageHeader';
import StatTiles from '../../components/admin/StatTiles';
import Pager from '../../components/admin/Pager';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import toast from 'react-hot-toast';
import {
  Trash2, Edit2, Save, X, KeyRound, Mail, EyeOff, Users as UsersIcon, UserPlus,
  Landmark, Search, ChevronDown, ShieldCheck, ShieldAlert, Ban, RotateCcw,
  ShoppingBag, Wallet, Crown, FilterX, AlertCircle, RefreshCw,
  Clock, UserCheck, Send, Plus, Smartphone, ShieldOff, LogOut, StickyNote,
} from 'lucide-react';

/**
 * The account list.
 *
 * The endpoint behind this has always supported `search`, `role`, `page` and
 * `limit`; the page sent none of them and rendered every account in the store
 * as one unbounded column of rows. It also bound the VIP tier picker to a
 * `tier_id` the endpoint never returned, so a pinned account read back as
 * "Automatic" and saving quietly unpinned it.
 *
 * What is new on the card — orders placed, lifetime spend, rolling 30-day
 * spend, store credit — comes from the list query rather than a request per
 * card, and the money half of it is gated on the same permission that unhides
 * an order total anywhere else. A manager who cannot see what an order was
 * worth cannot see it summed here either.
 */

const ROLE_TONE = {
  admin: 'var(--danger)',
  manager: 'var(--warning)',
  user: 'var(--info)',
};

const ROLE_ICON = {
  admin: ShieldAlert,
  manager: ShieldCheck,
  user: UserCheck,
};

const ROLE_FILTERS = [
  { key: '', label: 'Everyone' },
  { key: 'admin', label: 'Admins' },
  { key: 'manager', label: 'Managers' },
  { key: 'user', label: 'Customers' },
];

const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'orders', label: 'Most orders' },
  { key: 'recent_order', label: 'Recently ordered' },
  { key: 'spend', label: 'Highest spend', money: true },
];

/** The minimum the create endpoint accepts. Enforced here so the form can say so. */
const MIN_PASSWORD = 8;

/**
 * How a second factor is drawn on a card.
 *
 * The endpoint sends the DERIVED method — what the account can actually
 * present, not what its column says — because a card staff use to decide a
 * dispute has to be right about whether there is a second factor at all.
 */
const TWO_FACTOR_CHIP = {
  totp: { label: 'Authenticator', icon: Smartphone, title: 'Second factor: an authenticator app (TOTP)' },
  pgp: { label: 'PGP 2FA', icon: KeyRound, title: 'Second factor: a PGP challenge answered with their key' },
};

/** The account's second factor: 'disabled', 'pgp' or 'totp'. */
function twoFactorOf(user) {
  return user?.two_factor_method || 'disabled';
}

function Hidden({ what = 'this value' }) {
  return (
    <span className="acard-hidden" title={`Hidden — you do not have permission to see ${what}`}>
      Hidden
    </span>
  );
}

/**
 * The line-item columns, declared once so the heading row and every record are
 * laid out by the same string.
 *
 * Set on `.lrows` rather than on each `.lrow`, so `--lrow-cols` is inherited by
 * the head and the rows together: two copies of a track list is how a column of
 * money ends up half a character off its own heading.
 *
 * Sized against the longest realistic value rather than the average one — a
 * 64-character username (the column's own maximum) next to `manager` and a
 * permission count. The account track gets the room because that is the field
 * being searched for; the figure tracks are fixed so store credit and order
 * counts stay in the same place from row to row, which is the entire reason
 * for putting them in `--font-mono`.
 *
 * The action track is a fixed width and not `auto`, which was a real bug and
 * not a preference: `.lrows-head` and every `.lrow` are separate grid
 * containers that merely share a template, so an `auto` track is resolved
 * against each container's own content. The heading row's action cell holds
 * only an `.sr-only` word and resolved to 0px, and a row for a customer with
 * orders resolved 92px wider than a row for one without — so the fr tracks
 * came out a different width on the head and on every row, and a column of
 * money sat 150px left of the heading naming it. Every track here has to be
 * decidable without looking at the content.
 */
const ROW_COLS = 'minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 2fr) 60px 100px 92px 88px 200px';

/**
 * What the role column says underneath the role itself.
 *
 * A manager's grants are the difference between two accounts that both read
 * "manager" — one may hold the whole console and the other one queue — so the
 * count is the second half of the field, not decoration. Admins hold
 * everything by construction (`grantPermissions` is `role === 'admin'`), and a
 * customer holds nothing, so neither has a number to print.
 */
function roleNote(user) {
  if (user.role === 'admin') return 'full access';
  if (user.role !== 'manager') return 'customer';
  const granted = Array.isArray(user.permissions) ? user.permissions.length : 0;
  return granted === 0 ? 'no permissions yet' : `${granted} permission${granted === 1 ? '' : 's'}`;
}

/**
 * Which tier to show, and why.
 *
 * The list query can only report the *pinned* tier, because that is the only
 * one stored on the row — an automatic tier is recomputed from a rolling spend
 * window on every price calculation. Deriving it here from the ladder the page
 * already loaded means an unpinned customer still shows the tier they are
 * actually getting, rather than nothing at all, and without a request per
 * record.
 *
 * A plain function shared by both views rather than a hook inside the card:
 * the card and the line item have to agree about what tier somebody is on, and
 * the surest way to make them disagree was to let each derive it.
 */
function tierBadgeOf(user, tiers, visibility) {
  if (user.tier_locked && user.tier_name) return { name: user.tier_name, pinned: true };
  if (!visibility.spend || user.spend_30d == null || tiers.length === 0) return null;
  const spend = num(user.spend_30d);
  const earned = tiers
    .filter((t) => spend >= num(t.min_spend_30d))
    .sort((a, b) => num(b.min_spend_30d) - num(a.min_spend_30d))[0];
  return earned ? { name: earned.name, pinned: false } : null;
}

export default function AdminUsers() {
  const { user: me, refreshUser } = useAuth();
  const can = useMemo(() => adminCapabilities(me), [me]);
  const [searchParams, setSearchParams] = useSearchParams();

  // The store-credit ledger deep-links here as `/admin/users?id=N`.
  const focusId = searchParams.get('id');

  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({
    total: 0, totalPages: 1, limit: 24, counts: {}, visibility: { spend: false, credit: false },
  });
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [sort, setSort] = useState('newest');
  const [limit, setLimit] = useState(24);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  // Comfortable cards or compact lines, remembered per operator. See the §6
  // answer above the list below for why this queue is a toggle at all.
  const [view, setView] = useViewMode('admin-users');

  const [editing, setEditing] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const seqRef = useRef(0);

  const fetchUsers = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++seqRef.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
      if (role) params.set('role', role);
      if (active) params.set('active', active);
      if (query) params.set('search', query);
      if (focusId) params.set('id', focusId);

      const data = await api.get(`/admin/users?${params}`);
      if (seq !== seqRef.current) return;

      setUsers(data.users || []);
      setMeta({
        total: Number(data.total || 0),
        totalPages: Math.max(1, Number(data.totalPages || 1)),
        limit: Number(data.limit || limit),
        counts: data.counts || {},
        visibility: data.visibility || { spend: false, credit: false },
      });
      if (data.sort && data.sort !== sort) setSort(data.sort);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err.message || 'Failed to load accounts');
      toast.error(err.message || 'Failed to load accounts');
    } finally {
      if (seq === seqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [page, limit, sort, role, active, query, focusId]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    // Tiers are also what the picker on every card is built from, so a viewer
    // without the grant simply gets no picker rather than an error toast.
    if (!can.has('users.tiers') && !can.has('users.view')) return;
    api.get('/tiers')
      .then((data) => setTiers(data?.tiers || data || []))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    if (!loading && users.length === 0 && page > meta.totalPages) setPage(meta.totalPages);
  }, [loading, users.length, page, meta.totalPages]);

  const resetTo = (fn) => { fn(); setPage(1); };

  const clearFocus = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('id');
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const clearFilters = () => resetTo(() => {
    setRole(''); setActive(''); setSearchInput(''); setQuery('');
  });

  const isFiltered = role !== '' || active !== '' || query !== '' || !!focusId;

  const counts = meta.counts;
  const staff = Number(counts.admin || 0) + Number(counts.manager || 0);

  const stats = [
    {
      key: 'total',
      label: isFiltered ? 'Matching' : 'Accounts',
      value: fmtCount(meta.total),
      icon: UsersIcon,
      tone: 'var(--primary)',
      hint: isFiltered ? 'under current filters' : undefined,
    },
    {
      key: 'staff',
      label: 'Staff',
      value: fmtCount(staff),
      icon: ShieldCheck,
      tone: 'var(--warning)',
      title: 'Admins and managers',
    },
    {
      key: 'customers',
      label: 'Customers',
      value: fmtCount(counts.user || 0),
      icon: UserCheck,
      tone: 'var(--info)',
      active: role === 'user',
      onClick: () => resetTo(() => setRole(role === 'user' ? '' : 'user')),
    },
    {
      key: 'banned',
      label: 'Banned',
      value: fmtCount(counts.banned || 0),
      icon: Ban,
      tone: 'var(--danger)',
      urgent: Number(counts.banned || 0) > 0,
      active: active === 'false',
      onClick: () => resetTo(() => setActive(active === 'false' ? '' : 'false')),
    },
  ];

  const markBusy = (id, busy) => setBusyIds((prev) => {
    const next = new Set(prev);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  /**
   * Save an edit.
   *
   * Only changed keys are sent, for two reasons that both bite. The endpoint
   * checks `users.edit` whenever `cash_in_mail_enabled` or `zelle_enabled` is
   * merely *present*, so a manager who only holds `users.ban` gets a 403 for an
   * unrelated save; and sending `permissions` at all — even an identical array
   * — is an instant 403 for anyone who is not an admin.
   */
  const saveUser = async (target, draft) => {
    const payload = {};
    if (can.editUser) {
      // Trimmed here so a stray space is not a "change"; the server trims
      // again and is the one whose answer counts.
      const username = String(draft.username ?? target.username).trim();
      if (username !== target.username) payload.username = username;
      if (draft.cash_in_mail_enabled !== !!target.cash_in_mail_enabled) {
        payload.cash_in_mail_enabled = !!draft.cash_in_mail_enabled;
      }
      if (draft.zelle_enabled !== !!target.zelle_enabled) {
        payload.zelle_enabled = !!draft.zelle_enabled;
      }
      // The staff note, compared against WHAT THE DRAWER LOADED rather than
      // against the list row.
      //
      // The list payload carries only `has_staff_note`, never the text, so
      // `target.staff_note` is always undefined here. Diffing against it would
      // make every save of an unrelated field look like a note edit — which
      // restamps the date and re-attributes somebody else's sentence to
      // whoever last pressed Save. `staff_note_loaded` is what the drawer's
      // own fetch put there; `undefined` means that fetch has not landed, and
      // then the note is not in play at all.
      if (draft.staff_note_loaded !== undefined) {
        const note = String(draft.staff_note ?? '').replace(/\s+/g, ' ').trim();
        if (note !== String(draft.staff_note_loaded ?? '')) payload.staff_note = note;
      }
    }
    if (can.banUser && draft.active !== (target.active !== false)) {
      payload.active = !!draft.active;
    }
    if (can.grantPermissions) {
      if (draft.role !== target.role) payload.role = draft.role;
      if (draft.role === 'manager') {
        const before = [...(target.permissions || [])].sort().join(',');
        const after = [...(draft.permissions || [])].sort().join(',');
        if (after !== before || draft.role !== target.role) payload.permissions = draft.permissions || [];
      }
    }

    if (Object.keys(payload).length === 0) {
      setEditing(null);
      return toast.success('Nothing to change');
    }

    // The server has no self-guard: an admin can demote or deactivate their own
    // account here, and the same request then revokes their sessions.
    if (target.id === me?.id && (payload.role !== undefined || payload.active === false)) {
      if (!confirm(
        'This is your own account.\n\n'
        + 'Changing your own role or deactivating yourself logs you out immediately '
        + 'and you may not be able to get back in. Continue?',
      )) return;
    }

    markBusy(target.id, true);
    try {
      const result = await api.put(`/admin/users/${target.id}`, payload);
      const renamedTo = result?.username && result.username !== target.username ? result.username : null;
      toast.success(renamedTo
        ? `${target.username} is now ${renamedTo} — they sign in with the new name from now on`
        : `${target.username} updated`);
      setEditing(null);
      fetchUsers({ quiet: true });
      // Renaming yourself is allowed and does not sign you out, but the
      // navbar and the "· you" markers are drawn from the account payload,
      // which still carries the old name until it is re-read.
      if (renamedTo && target.id === me?.id) await refreshUser();
    } catch (err) {
      toast.error(err.message || 'Could not update the account');
    } finally {
      markBusy(target.id, false);
    }
  };

  /**
   * The shortest reason the server will take.
   *
   * Mirrored from `BAN_REASON_MIN` in adminController rather than imported,
   * because there is no shared module between the two and inventing one for a
   * number is worse than the duplication. The server refuses anyway — this
   * only decides whether the browser is allowed to ask again before spending
   * the round trip.
   */
  const BAN_REASON_MIN = 10;

  const toggleBan = async (target) => {
    const banning = target.active !== false;

    if (target.id === me?.id && banning) {
      return toast.error('You cannot ban your own account from here.');
    }

    // ── Banning asks why; unbanning asks whether ──
    //
    // Two different questions, so two different prompts. The reason is the
    // whole point of the ban half: `users.active` was a boolean, and the cost
    // of that landed weeks later on whoever met the account in a dispute
    // holding a flag and no way to tell fraud from a mis-tap.
    //
    // `prompt` rather than a modal, matching every other confirmation on this
    // page. A cancelled prompt returns null and a reason typed as spaces is
    // caught below, so there is no path from here that bans without saying
    // why — and the server refuses one anyway.
    let reason = null;
    if (banning) {
      reason = window.prompt(
        `Ban "${target.username}" — why?\n\n`
        + 'Whoever meets this account next in a dispute or a ticket sees this. '
        + 'It is cleared if the ban is lifted; the audit log keeps it either way.\n\n'
        + 'Every session is revoked immediately, and any linked Telegram or Potato '
        + 'account is unlinked — those cannot be restored by unbanning.',
        '',
      );
      if (reason === null) return;
      if (reason.trim().length < BAN_REASON_MIN) {
        return toast.error('Give a reason the next person can act on — a few words at least.');
      }
    } else if (!confirm(`Unban "${target.username}"? They will be able to sign in again.\n\n`
      + 'The reason recorded against the ban is cleared. The audit log keeps it.')) {
      return;
    }

    markBusy(target.id, true);
    try {
      await api.put(`/admin/users/${target.id}`, banning
        ? { active: false, ban_reason: reason.trim() }
        : { active: true });
      toast.success(banning ? `${target.username} banned` : `${target.username} unbanned`);
      fetchUsers({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not change the account');
    } finally {
      markBusy(target.id, false);
    }
  };

  const deleteUser = async (target) => {
    const orders = num(target.order_count);
    if (!confirm(
      `Permanently delete "${target.username}"?\n\n`
      + (orders > 0
        ? `This destroys ${orders} order${orders === 1 ? '' : 's'} and their entire history, `
        : 'This destroys ')
      + 'along with the cart, wishlist, store credit, coupon redemptions, support tickets '
      + 'and sessions belonging to this account.\n\n'
      + 'Banning the account keeps all of it and stops them signing in. '
      + 'Deleting cannot be undone.',
    )) return;

    markBusy(target.id, true);
    try {
      // `purge: true` is the server-side half of the confirmation above: an
      // account with orders or ledger history now refuses a bare DELETE, so
      // the destruction the dialog described is asserted rather than implied.
      await api.delete(`/admin/users/${target.id}`, { purge: true });
      toast.success(`${target.username} deleted`);
      fetchUsers({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not delete the account');
    } finally {
      markBusy(target.id, false);
    }
  };

  const setPassword = async (target, password) => {
    if (!password || password.length < MIN_PASSWORD) {
      return toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (!confirm(
      `Set a new password for "${target.username}"?\n\n`
      + 'Every session on the account is signed out immediately. '
      + 'You are responsible for getting the new password to them safely.',
    )) return false;

    markBusy(target.id, true);
    try {
      await api.put(`/admin/users/${target.id}`, { password });
      toast.success(`Password set for ${target.username}`);
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not set the password');
      return false;
    } finally {
      markBusy(target.id, false);
    }
  };

  /**
   * Clear an account's second factor.
   *
   * The recovery route for the failure this control exists for: a second factor
   * enrolled by somebody who was not the owner. The owner's password then
   * reaches a code prompt they cannot answer and they hold no recovery codes,
   * so before this existed the only way back was psql on the production box.
   *
   * Clearing only, never setting — an admin cannot hand an account a factor,
   * because enrolling one needs a code from a device only its owner holds.
   */
  const clearTwoFactor = async (target) => {
    const method = twoFactorOf(target);
    if (!confirm(
      `Clear the second factor on "${target.username}"?\n\n`
      + `Their ${method === 'totp' ? 'authenticator app' : 'PGP challenge'} and any recovery codes stop being `
      + 'required, and every session on the account is signed out — including whoever set the factor up, '
      + 'which is the point if it was not the owner.\n\n'
      + 'Their password (or key) is unchanged. Tell them to set two-factor up again once they are back in.',
    )) return;

    if (target.id === me?.id && !confirm(
      'This is your own account.\n\n'
      + 'Clearing your own second factor signs you out of every session, this one included. Continue?',
    )) return;

    markBusy(target.id, true);
    try {
      // `two_factor_method` is the column's own name and 'disabled' is the only
      // value the endpoint accepts here; it answers 400 for anything else
      // rather than the silent 200 it used to give every 2FA field.
      await api.put(`/admin/users/${target.id}`, { two_factor_method: 'disabled' });
      toast.success(`Second factor cleared for ${target.username} — their sessions were revoked`);
      fetchUsers({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not clear the second factor');
    } finally {
      markBusy(target.id, false);
    }
  };

  /**
   * Kick every device off the account without touching its credentials — the
   * first response to "someone else is in my account". The server invalidates
   * every issued JWT immediately; the owner signs back in with their
   * unchanged password (and factor, if any). Separate from the 2FA and
   * password tools on purpose: bundling them is how a support action becomes
   * an accidental account reset.
   */
  const revokeSessions = async (target) => {
    if (!confirm(
      `Sign "${target.username}" out of every device?\n\n`
      + 'Their password and second factor are unchanged — they just have to sign in again.',
    )) return;
    if (target.id === me?.id && !confirm(
      'This is your own account — you will be signed out of this session too. Continue?',
    )) return;
    markBusy(target.id, true);
    try {
      await api.post(`/admin/users/${target.id}/revoke-sessions`);
      toast.success(`${target.username} signed out everywhere`);
    } catch (err) {
      toast.error(err.message || 'Could not revoke sessions');
    } finally {
      markBusy(target.id, false);
    }
  };

  const setUserTier = async (target, tierId) => {
    markBusy(target.id, true);
    try {
      // The tier endpoint answers with the resolved state, so the row is
      // patched in place rather than refetching the whole page for one select.
      const result = await api.put(`/tiers/users/${target.id}/tier`, { tier_id: tierId });
      // `tier_name` on a row is the *pinned* tier — the list query reads it
      // through `users.tier_id`, which unpinning sets to null. Carrying the
      // resolved tier from this response into it instead would show a name
      // here that a reload then removes; the earned tier is derived separately
      // below, from spend.
      setUsers((prev) => prev.map((u) => (
        u.id === target.id
          ? {
            ...u,
            tier_id: tierId,
            tier_locked: !!result?.locked,
            tier_name: tierId ? (result?.tier?.name || null) : null,
            tier_color: tierId ? (result?.tier?.color || null) : null,
          }
          : u
      )));
      toast.success(tierId ? `${target.username} pinned to ${result?.tier?.name || 'tier'}` : `${target.username} back to automatic tier`);
    } catch (err) {
      toast.error(err.message || 'Could not change the tier');
      fetchUsers({ quiet: true });
    } finally {
      markBusy(target.id, false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim()) return toast.error('Username is required');
    if (newUser.password.length < MIN_PASSWORD) {
      return toast.error(`Password must be at least ${MIN_PASSWORD} characters`);
    }
    setCreating(true);
    try {
      await api.post('/admin/users', {
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role,
      });
      toast.success(`${newUser.username.trim()} created`);
      setShowCreate(false);
      setNewUser({ username: '', password: '', role: 'user' });
      fetchUsers({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not create the account');
    } finally {
      setCreating(false);
    }
  };

  const subtitle = loading
    ? 'Loading accounts…'
    : error
      ? 'The account list could not be loaded.'
      : meta.total === 0
        ? (isFiltered ? 'No accounts match these filters.' : 'No accounts yet.')
        : `${fmtCount(meta.total)} account${meta.total === 1 ? '' : 's'} · ${fmtCount(staff)} staff · ${fmtCount(counts.banned || 0)} banned`;

  /**
   * Everything a record needs, whichever shape it is drawn in.
   *
   * Built in one place and spread into both views deliberately. This
   * repository's recurring failure is a fix that lands on one path and quietly
   * misses the other — the order queue kept a table and a duplicate set of
   * mobile cards until only one of them had the bulk checkbox. A handler added
   * here reaches the card and the line item together; adding it to one call
   * site and not the other is the mistake this shape refuses to express.
   */
  const listProps = (u) => ({
    now,
    can,
    isSelf: u.id === me?.id,
    tiers,
    visibility: meta.visibility,
    busy: busyIds.has(u.id),
    editing: editing === u.id,
    onEdit: () => setEditing(editing === u.id ? null : u.id),
    onCancelEdit: () => setEditing(null),
    onSave: saveUser,
    onToggleBan: toggleBan,
    onDelete: deleteUser,
    onSetPassword: setPassword,
    onClearTwoFactor: clearTwoFactor,
    onRevokeSessions: revokeSessions,
    onSetTier: setUserTier,
  });

  return (
    <div className="admin-page">
      <PageHeader icon={UsersIcon} title="Users" subtitle={subtitle}>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => fetchUsers({ quiet: true })}
          disabled={refreshing}
        >
          {refreshing ? <span className="spinner spinner-inline" /> : <RefreshCw size={14} aria-hidden="true" />}
          Refresh
        </button>
        {can.createUser && (
          <button
            type="button"
            className="glass-btn glass-btn-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate
              ? <><X size={15} aria-hidden="true" /> Cancel</>
              : <><UserPlus size={15} aria-hidden="true" /> Create user</>}
          </button>
        )}
      </PageHeader>

      {showCreate && can.createUser && (
        <div className="glass-card admin-panel-in" style={{ marginBottom: 'var(--sp-6)' }}>
          <h3 className="admin-card-title">New account</h3>
          <form onSubmit={handleCreate}>
            <div className="admin-form-grid">
              <div className="form-group">
                <label htmlFor="new-username">Username</label>
                <input
                  id="new-username"
                  className="glass-input"
                  value={newUser.username}
                  onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_\-]+"
                  title="Letters, numbers, underscores and hyphens only"
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-password">Password</label>
                <input
                  id="new-password"
                  className="glass-input"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  className="glass-input"
                  value={newUser.role}
                  onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                  disabled={!can.isAdmin}
                >
                  <option value="user">Customer</option>
                  {can.isAdmin && <option value="manager">Manager</option>}
                  {can.isAdmin && <option value="admin">Admin</option>}
                </select>
                {!can.isAdmin && <p className="admin-hint" style={{ marginTop: 'var(--sp-15)' }}>Only admins can create staff accounts.</p>}
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                {creating ? <span className="spinner spinner-inline" /> : <Plus size={14} aria-hidden="true" />} Create
              </button>
              <button type="button" className="glass-btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <StatTiles stats={stats} />

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter accounts by role">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              className={`status-filter-pill${role === f.key ? ' active' : ''}`}
              onClick={() => resetTo(() => setRole(f.key))}
              aria-pressed={role === f.key}
            >
              {f.label}
              <span className="status-filter-count">
                {fmtCount(f.key === ''
                  ? Number(counts.admin || 0) + Number(counts.manager || 0) + Number(counts.user || 0)
                  : counts[f.key] || 0)}
              </span>
            </button>
          ))}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Search usernames…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search accounts by username"
          />
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-toolbar-group">
          <label className="admin-toolbar-label" htmlFor="users-status">Status</label>
          <select
            id="users-status"
            className="glass-input"
            value={active}
            onChange={(e) => resetTo(() => setActive(e.target.value))}
            aria-label="Filter by account status"
          >
            <option value="">Any status</option>
            <option value="true">Active only</option>
            <option value="false">Banned only</option>
          </select>

          <label className="admin-toolbar-label" htmlFor="users-sort">Sort</label>
          <select
            id="users-sort"
            className="glass-input"
            value={sort}
            onChange={(e) => resetTo(() => setSort(e.target.value))}
            aria-label="Sort accounts"
          >
            {SORTS.filter((s) => !s.money || meta.visibility.spend).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <span className="admin-toolbar-spacer" />

        <div className="admin-toolbar-group">
          <ViewToggle value={view} onChange={setView} label="Account layout" />
        </div>
      </div>

      {focusId && (
        <div className="admin-filter-note">
          <span>Showing the single account linked from another page.</span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFocus}>
            <FilterX size={13} aria-hidden="true" /> Show all accounts
          </button>
        </div>
      )}

      {isFiltered && !focusId && !loading && (
        <div className="admin-filter-note">
          <span>{fmtCount(meta.total)} account{meta.total === 1 ? '' : 's'} match the current filters.</span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
            <FilterX size={13} aria-hidden="true" /> Clear
          </button>
        </div>
      )}

      {/* DESIGN §6, answered for this list: **a toggle**, not one responsive
          table and not two fixed views.

          Two jobs happen here and they want opposite shapes. Handing an account
          back — a buyer locked out by a second factor somebody else enrolled —
          is one account at a time, and wants the card: the monogram, every flag,
          the tier, and an editor that opens in place with room for the three
          controls that end sessions. Auditing is the other job: who is staff,
          who is banned, who is holding store credit the store still owes. That
          is forty accounts read down a single axis with the figures in
          `--font-mono` so a column of balances actually lines up, and a card
          grid is the wrong instrument for it — six accounts to a screen where
          the line item fits thirty.

          Not the responsive table (`.admin-rtable`): the card is not a table row
          with its headings printed beside it. It carries a monogram, a chip row
          and a drawer that opens in place, and flattening that into labelled
          cells produces neither of the two things above. Both views are real, so
          the operator picks and `useViewMode` remembers the choice. */}
      {loading ? (
        view === 'rows' ? (
          <div className="lrows ausr-rows" style={{ '--lrow-cols': ROW_COLS }} aria-busy="true" aria-label="Loading accounts">
            {/* The head is drawn while loading too, so the list does not shift
                sideways under the cursor when the rows land. */}
            <RowsHead />
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton lrow-skel" />
            ))}
          </div>
        ) : (
          <div className="acard-grid" aria-busy="true" aria-label="Loading accounts">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton acard-skel" style={{ '--i': i }} />
            ))}
          </div>
        )
      ) : error ? (
        <div className="glass-card empty-state is-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h3>The account list could not be loaded</h3>
          <p>{error}</p>
          <button type="button" className="glass-btn" onClick={() => fetchUsers()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : users.length === 0 ? (
        view === 'rows' ? (
          // The frame stays. A list that vanishes entirely reads as a page that
          // failed rather than a filter that matched nothing.
          <div className="lrows ausr-rows" style={{ '--lrow-cols': ROW_COLS }}>
            <RowsHead />
            <div className="lrows-empty">
              <strong>{isFiltered ? 'No accounts match' : 'No accounts yet'}</strong>
              <NoAccounts
                isFiltered={isFiltered}
                focusId={focusId}
                can={can}
                onClear={focusId ? clearFocus : clearFilters}
                onCreate={() => setShowCreate(true)}
              />
            </div>
          </div>
        ) : (
          <div className="glass-card empty-state">
            {isFiltered ? <FilterX size={34} aria-hidden="true" /> : <UsersIcon size={34} aria-hidden="true" />}
            <h3>{isFiltered ? 'No accounts match' : 'No accounts yet'}</h3>
            <NoAccounts
              isFiltered={isFiltered}
              focusId={focusId}
              can={can}
              onClear={focusId ? clearFocus : clearFilters}
              onCreate={() => setShowCreate(true)}
            />
          </div>
        )
      ) : (
        <>
          {view === 'rows' ? (
            <div className="lrows ausr-rows" style={{ '--lrow-cols': ROW_COLS }}>
              <RowsHead />
              {users.map((u) => (
                <UserRow key={u.id} user={u} {...listProps(u)} />
              ))}
            </div>
          ) : (
            <div className="acard-grid">
              {users.map((u, i) => (
                <UserCard key={u.id} user={u} index={i} {...listProps(u)} />
              ))}
            </div>
          )}

          <Pager
            page={page}
            totalPages={meta.totalPages}
            total={meta.total}
            noun="account"
            label="Account pages"
            onChange={setPage}
          >
            <label className="admin-toolbar-label" htmlFor="users-per-page">Per page</label>
            <select
              id="users-per-page"
              className="glass-input"
              value={limit}
              onChange={(e) => resetTo(() => setLimit(Number(e.target.value)))}
              aria-label="Accounts per page"
            >
              {[12, 24, 48, 96].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Pager>
        </>
      )}
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────── */

function UserCard({
  user, index, now, can, isSelf, tiers, visibility, busy, editing,
  onEdit, onCancelEdit, onSave, onToggleBan, onDelete, onSetPassword,
  onClearTwoFactor, onRevokeSessions, onSetTier,
}) {
  const tone = ROLE_TONE[user.role] || 'var(--primary)';
  const RoleIcon = ROLE_ICON[user.role] || UserCheck;
  const banned = user.active === false;
  const canEditAnything = can.editUser || can.banUser || can.grantPermissions || can.setPassword;
  const tierBadge = useMemo(
    () => tierBadgeOf(user, tiers, visibility),
    [user, tiers, visibility],
  );

  return (
    <article
      className={[
        'glass-card acard',
        banned ? 'ausr-banned' : '',
        busy ? 'is-busy' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--acard-tone': banned ? 'var(--danger)' : tone, '--ausr-tone': tone, '--i': stagger(index) }}
      aria-busy={busy || undefined}
    >
      <span className="acard-rail" aria-hidden="true" />

      <header className="acard-head">
        <div className="acard-head-main">
          <span className={`ausr-avatar${banned ? ' is-banned' : ''}`} aria-hidden="true">
            {initials(user.username)}
          </span>
          <div style={{ minWidth: 0 }}>
            <span className="acard-title" title={user.username}>{user.username}</span>
            <div className="acard-sub">
              <span>#{user.id}</span>
              <span aria-hidden="true">·</span>
              <span title={fullDate(user.created_at)}>joined {shortDate(user.created_at)}</span>
              {isSelf && <><span aria-hidden="true">·</span><span>you</span></>}
            </div>
          </div>
        </div>
        <span className="acard-chip" style={{ '--acard-chip-tone': tone }}>
          <RoleIcon size={10} aria-hidden="true" />
          {user.role}
        </span>
      </header>

      <div className="acard-body">
        <div className="acard-fields">
          <div className="acard-field">
            <span className="acard-field-label">Orders</span>
            <span className="acard-field-value is-strong">
              <ShoppingBag size={12} aria-hidden="true" />
              {fmtCount(user.order_count)}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Lifetime spend</span>
            <span className="acard-field-value is-strong">
              {visibility.spend ? money(user.total_spent) : <Hidden what="customer spend" />}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Last order</span>
            <span className="acard-field-value" title={fullDate(user.last_order_at)}>
              <Clock size={12} aria-hidden="true" />
              {user.last_order_at ? relTime(user.last_order_at, now) : 'never'}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Store credit</span>
            <span className="acard-field-value">
              {visibility.credit
                ? <><Wallet size={12} aria-hidden="true" />{money(user.store_credit_balance)}</>
                : <Hidden what="store credit balances" />}
            </span>
          </div>
        </div>

        <div className="ausr-flags">
          <UserFlags user={user} tierBadge={tierBadge} />
        </div>

        {/* Said in full on the card, not only in a tooltip.
            This is the line the whole feature exists for: somebody meeting
            this account in a dispute six weeks from now reads it without
            having to open the audit log, which most staff cannot. Absent
            entirely on an account that is not banned — the column is cleared
            when a ban is lifted, so there is nothing here to go stale. */}
        {user.active === false && user.ban_reason && (
          <p className="ausr-ban-reason">
            <Ban size={12} aria-hidden="true" />
            <span>
              <strong>Banned</strong>
              {user.banned_at ? ` ${new Date(user.banned_at).toLocaleDateString()}` : ''}
              {' — '}
              {user.ban_reason}
            </span>
          </p>
        )}

        <TierPicker
          user={user}
          tiers={tiers}
          can={can}
          visibility={visibility}
          busy={busy}
          onSetTier={onSetTier}
        />
      </div>

      <footer className="acard-foot">
        <div className="acard-actions">
          {canEditAnything && (
            <button
              type="button"
              className="glass-btn glass-btn-sm acard-disclose"
              onClick={onEdit}
              aria-expanded={editing}
              // The visible word has to appear in the accessible name, or a
              // voice-control user saying "click Edit" matches nothing.
              aria-label={`Edit ${user.username}`}
              disabled={busy}
            >
              <Edit2 size={13} aria-hidden="true" /> Edit <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
          {can.banUser && (
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              style={{ color: banned ? 'var(--success)' : 'var(--danger)' }}
              onClick={() => onToggleBan(user)}
              disabled={busy}
              aria-label={`${banned ? 'Unban' : 'Ban'} ${user.username}`}
            >
              {banned ? <RotateCcw size={13} aria-hidden="true" /> : <Ban size={13} aria-hidden="true" />}
              {banned ? 'Unban' : 'Ban'}
            </button>
          )}
          {can.deleteUser && !isSelf && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-danger"
              onClick={() => onDelete(user)}
              disabled={busy}
              aria-label={`Delete ${user.username}`}
              title="Delete this account and everything attached to it"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        {/* The order queue is its own permission. Without this gate the card
            offered a link to a page the viewer's grants do not open, which
            lands them on an access-denied redirect instead of the customer's
            orders. */}
        {num(user.order_count) > 0 && can.viewOrders && (
          <Link
            to={`/admin/orders?search=${encodeURIComponent(user.username)}`}
            className="glass-btn glass-btn-sm"
            aria-label={`See orders from ${user.username}`}
          >
            <ShoppingBag size={13} aria-hidden="true" /> Orders
          </Link>
        )}
      </footer>

      <div className={`acard-drawer${editing ? ' is-open' : ''}`}>
        <div className="acard-drawer-clip">
          <div className="acard-drawer-inner" inert={editing ? undefined : true}>
            <UserEditor
              user={user}
              can={can}
              editing={editing}
              busy={busy}
              isSelf={isSelf}
              onCancelEdit={onCancelEdit}
              onSave={onSave}
              onSetPassword={onSetPassword}
              onClearTwoFactor={onClearTwoFactor}
              onRevokeSessions={onRevokeSessions}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── Pieces both views are built from ──────────────────────────── */

/**
 * The account-flag chips: status, payment rails, second factor, bot link, tier.
 *
 * One component for the card and the line item on purpose. These chips are how
 * staff answer "can this person pay by Zelle" and "is this account locked down"
 * without opening anything, and a second copy written for the compact view is
 * the copy that would go on reading the wrong field — which is what
 * `twoFactorOf` exists to answer in one place.
 *
 * `compact` drops the *words* and keeps the icons, because the line item has
 * about 170px for this cell and six worded chips wrap it onto three lines. The
 * word does not disappear: it moves into `.sr-only` and stays in the `title`,
 * so nothing here is icon-only to somebody using a screen reader. DESIGN §5 —
 * re-flow, never delete.
 */
function UserFlags({ user, tierBadge, compact = false }) {
  const banned = user.active === false;
  const twoFactor = twoFactorOf(user);
  const factor = twoFactor !== 'disabled' ? TWO_FACTOR_CHIP[twoFactor] : null;
  const FactorIcon = factor?.icon;
  // A word, or the same word where only assistive tech reads it.
  const word = (text) => (compact ? <span className="sr-only">{text}</span> : <>{' '}{text}</>);

  return (
    <>
      {/* Never compacted. Whether an account can sign in is the headline fact
          about it, and a dot with no word beside it is a decoration. */}
      <span
        className="acard-chip"
        style={{ '--acard-chip-tone': banned ? 'var(--danger)' : 'var(--success)' }}
        // The reason, wherever the chip appears — including the compact row,
        // which has no room for a line of prose but every reason to carry it.
        title={banned && user.ban_reason ? `Banned: ${user.ban_reason}` : undefined}
      >
        <span className="acard-chip-dot" />{banned ? 'banned' : 'active'}
      </span>
      {/* A note exists. The TEXT is deliberately not in the list payload — the
          list renders dozens of accounts at once, and putting one staff
          member's prose about every buyer into a scrollable page is the shape
          that turns a note field into a dossier. `has_staff_note` is a
          boolean; the sentence is on the account. */}
      {(user.has_staff_note || user.staff_note) && (
        <span
          className="acard-chip"
          style={{ '--acard-chip-tone': 'var(--accent, var(--primary))' }}
          title={user.staff_note || 'A staff note is on this account — open it to read'}
        >
          <StickyNote size={10} aria-hidden="true" />{word('note')}
        </span>
      )}
      {user.cash_in_mail_enabled && (
        <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--warning)' }} title="Cash in mail is enabled for this account">
          <Mail size={10} aria-hidden="true" />{word('CIM')}
        </span>
      )}
      {user.zelle_enabled && (
        <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--info)' }} title="Zelle is enabled for this account">
          <Landmark size={10} aria-hidden="true" />{word('Zelle')}
        </span>
      )}
      {factor && (
        <span
          className="acard-chip"
          style={{ '--acard-chip-tone': 'var(--info)' }}
          title={factor.title}
        >
          <FactorIcon size={10} aria-hidden="true" />{word(factor.label)}
        </span>
      )}
      {/* A redacted contact is masked to the string '[hidden]', not null, so
          a plain truthiness test would claim every account has a bot link. */}
      {user.telegram_chat_id && user.telegram_chat_id !== '[hidden]' && (
        <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--info)' }} title="Telegram bot linked">
          <Send size={10} aria-hidden="true" />{word('Telegram')}
        </span>
      )}
      {user.contacts_redacted && (
        <span className="acard-chip" title="Linked accounts and PGP keys are hidden from you">
          <EyeOff size={10} aria-hidden="true" />{word('contacts hidden')}
        </span>
      )}
      {tierBadge && (
        <span
          className="acard-chip"
          style={{ '--acard-chip-tone': 'var(--warning)' }}
          title={tierBadge.pinned
            ? 'Pinned to this tier by staff, regardless of spend'
            : `Earned from ${money(user.spend_30d)} of spend in the last 30 days`}
        >
          {/* The tier name survives compaction — it is already one short word,
              and a crown with no name says an account is special without saying
              which discount it is getting. */}
          <Crown size={10} aria-hidden="true" /> {tierBadge.name}
          {tierBadge.pinned ? (compact ? <span className="sr-only"> pinned</span> : ' · pinned') : ''}
        </span>
      )}
    </>
  );
}

/**
 * The VIP tier control.
 *
 * On the card it sits in the body rather than in the edit drawer: it is a
 * one-control decision, and hiding it behind an edit mode was why nobody used
 * it. A line item has no body to put it in — a `<select>` is three times the
 * height of the row it would sit in — so the line item shows the tier as a chip
 * and carries this same control in its drawer. Same component either way, so
 * the option list and the "automatic vs pinned" wording cannot drift apart.
 */
function TierPicker({ user, tiers, can, visibility, busy, onSetTier }) {
  if (tiers.length === 0 || !can.has('users.tiers')) return null;
  const tierValue = user.tier_locked && user.tier_id ? String(user.tier_id) : '';

  return (
    <div className="ausr-tier">
      {user.tier_color && (
        <span
          className="ausr-tier-swatch"
          style={{ '--ausr-tier-color': user.tier_color }}
          aria-hidden="true"
        />
      )}
      <select
        className="glass-input"
        value={tierValue}
        disabled={busy}
        onChange={(e) => onSetTier(user, e.target.value ? parseInt(e.target.value, 10) : null)}
        aria-label={`VIP tier for ${user.username}`}
        title="Automatic follows the customer's rolling 30-day spend. Picking a tier pins them there regardless of spend."
      >
        <option value="">Automatic (by spend)</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>Pin: {t.name} (−{num(t.discount_pct)}%)</option>
        ))}
      </select>
      {visibility.spend && user.spend_30d != null && (
        <span className="acard-foot-note" style={{ fontStyle: 'normal' }}>
          {money(user.spend_30d)} in 30 days
        </span>
      )}
    </div>
  );
}

/**
 * Everything behind the Edit disclosure: role, the account toggles, the
 * permission grid, and the three controls that end sessions.
 *
 * Lifted out of the card whole when the line-item view arrived. Two copies of
 * this would be two copies of the rules about which grant reveals which
 * control — and the one that matters most (an admin's second factor is
 * clearable only by its owner) is the one a second copy would forget, because
 * it is a negative condition nobody notices missing.
 */
function UserEditor({
  user, can, editing, busy, isSelf = false, tierPicker = null,
  onCancelEdit, onSave, onSetPassword, onClearTwoFactor, onRevokeSessions,
}) {
  const twoFactor = twoFactorOf(user);

  /**
   * The draft is created when the drawer opens and thrown away when it closes,
   * so it is read from the record exactly once and cannot go stale against a
   * background refetch that lands while the form is open.
   */
  const [draft, setDraft] = useState(null);
  const [password, setPasswordValue] = useState('');
  // The full account record, fetched when the drawer opens. The list payload
  // deliberately omits the staff note's text — see the effect below.
  const [detail, setDetail] = useState(null);

  // Keyed on the account, not on the record object. `user` is a fresh object
  // after every refetch and after the in-place tier patch, so depending on it
  // meant pinning a tier while the drawer was open silently reset half-made
  // edits back to what the server last said.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing) { setDraft(null); setPasswordValue(''); setDetail(null); return; }
    setDraft({
      username: user.username,
      role: user.role,
      active: user.active !== false,
      cash_in_mail_enabled: !!user.cash_in_mail_enabled,
      zelle_enabled: !!user.zelle_enabled,
      permissions: user.permissions || [],
      // Seeded empty and filled by the fetch below — see why.
      staff_note: '',
    });

    // ── Why the note needs a second request ──────────────────────────────
    //
    // The list endpoint sends `has_staff_note` (a boolean) and never the text,
    // deliberately: dozens of accounts render at once, and putting one staff
    // member's prose about every buyer into a scrollable list is the shape
    // that turns a note field into a dossier.
    //
    // Which means the drawer cannot seed the textarea from the row it was
    // opened from. Without this fetch it would render EMPTY for an account
    // that has a note, and pressing Save would send an empty string and
    // silently delete it — a data-losing bug that looks like nothing at all.
    let alive = true;
    api.get(`/admin/users/${user.id}`)
      .then((full) => {
        if (!alive) return;
        setDetail(full);
        // Patched in rather than replacing the draft: somebody may already be
        // typing in another field while this lands.
        setDraft((d) => (d
          ? { ...d, staff_note: full.staff_note || '', staff_note_loaded: full.staff_note || '' }
          : d));
      })
      // A failed read leaves the box empty and disabled rather than editable,
      // so the save path cannot mistake "could not load" for "cleared".
      .catch(() => { if (alive) setDetail({ unavailable: true }); });
    return () => { alive = false; };
  }, [editing, user.id]);

  if (!draft) return null;

  return (
    <>
      {/* The sign-in name. Same grant as the payment flags — it is editing the
          account, not banning or recovering it — and the one field in this
          drawer whose new value has to be handed to the person: the store has
          no channel of its own to tell them, so the hint says so. Renaming
          does not end sessions, including your own; the server re-reads the
          current name on every request. */}
      {can.editUser && (
        <div className="form-group ausr-rename">
          <label htmlFor={`username-${user.id}`}>Username</label>
          <input
            id={`username-${user.id}`}
            className="glass-input"
            type="text"
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            minLength={3}
            maxLength={64}
            pattern="[A-Za-z0-9_-]+"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`username-hint-${user.id}`}
          />
          <p id={`username-hint-${user.id}`} className="admin-hint" style={{ margin: '0.25rem 0 0' }}>
            3–64 letters, numbers, underscores or hyphens. This is what they type to sign in,
            so if you change it, tell them{isSelf ? '' : ' — nothing here will'}.
          </p>
        </div>
      )}

      {/* The note you write INSTEAD of banning somebody.
          Until this existed the only way to record anything about an account
          was to turn it off, so "opens a dispute on every order" lived with
          whichever staff member remembered it and left when they did.

          Capped at 500 by the column's own CHECK as well as here, and that
          cap is the feature rather than a limit on it: this is the one field
          in the schema staff can type free prose about a buyer into, and what
          stops it becoming a case file is that there is no room for one. Every
          write is audited (`user.note_updated`), and it dies with the account
          because it lives on the row. */}
      {can.editUser && (
        <div className="form-group ausr-note">
          <label htmlFor={`note-${user.id}`}>Staff note</label>
          <textarea
            id={`note-${user.id}`}
            className="glass-input"
            rows={2}
            maxLength={500}
            value={draft.staff_note}
            onChange={(e) => setDraft({ ...draft, staff_note: e.target.value })}
            placeholder={detail ? 'e.g. always asks for parcels to go next door' : 'Loading…'}
            // Locked until the existing note has actually arrived. An editable
            // empty box over an account that has a note is a delete waiting to
            // be saved by somebody who was editing a different field.
            disabled={busy || !detail || detail.unavailable}
            aria-describedby={`note-hint-${user.id}`}
          />
          <p id={`note-hint-${user.id}`} className="admin-hint" style={{ margin: '0.25rem 0 0' }}>
            {detail?.unavailable
              ? 'The note could not be loaded, so it cannot be edited from here right now.'
              : 'What the next person needs to know, short of banning. The customer never sees it.'}
            {detail?.staff_note_at && (
              <>
                {' '}Last written {new Date(detail.staff_note_at).toLocaleDateString()}
                {detail.staff_note_by_username ? ` by ${detail.staff_note_by_username}` : ''}.
              </>
            )}
            {detail && !detail.unavailable && ' Clear the box to remove it.'}
          </p>
        </div>
      )}

      <div className="ausr-toggles">
        {can.grantPermissions && (
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label htmlFor={`role-${user.id}`}>Role</label>
            <select
              id={`role-${user.id}`}
              className="glass-input"
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            >
              {['user', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {can.banUser && (
          <Toggle
            label="Account active"
            checked={draft.active}
            onChange={(v) => setDraft({ ...draft, active: v })}
            tone="var(--success)"
          />
        )}
        {can.editUser && (
          <Toggle
            label="Cash in mail"
            checked={draft.cash_in_mail_enabled}
            onChange={(v) => setDraft({ ...draft, cash_in_mail_enabled: v })}
            tone="var(--warning)"
          />
        )}
        {can.editUser && (
          <Toggle
            label="Zelle"
            checked={draft.zelle_enabled}
            onChange={(v) => setDraft({ ...draft, zelle_enabled: v })}
            tone="var(--info)"
          />
        )}
      </div>

      {/* The line item's home for the tier control the card keeps on its face.
          Rendered by the caller so this component does not have to know which
          view it is inside. */}
      {tierPicker}

      {draft.role === 'manager' && can.grantPermissions && (
        <div className="ausr-perms">
          <PermissionEditor
            value={draft.permissions || []}
            onChange={(permissions) => setDraft({ ...draft, permissions })}
          />
          {/* What the set being built would see on an order, from the real
              redaction — see components/RedactionPreview. Under the editor
              rather than in it, because the editor is shared with the profile
              screens and the sentence is about THIS account's draft. */}
          <RedactionPreview permissions={draft.permissions || []} />
        </div>
      )}

      {can.setPassword && (
        <div className="ausr-danger">
          <span className="ausr-danger-title">Set a new password</span>
          <p>
            Signs every session on this account out immediately. The store never
            shows you the existing password — this replaces it.
          </p>
          <div className="ausr-danger-row">
            <input
              className="glass-input"
              type="password"
              value={password}
              onChange={(e) => setPasswordValue(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              aria-label={`New password for ${user.username}`}
            />
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              disabled={busy || password.length < MIN_PASSWORD}
              onClick={async () => {
                const ok = await onSetPassword(user, password);
                if (ok) setPasswordValue('');
              }}
            >
              <KeyRound size={13} aria-hidden="true" /> Set password
            </button>
          </div>
        </div>
      )}

      {/* Gated on the same grant as the password reset: both hand an
          account back to whoever asks, and a second factor is the
          only thing standing between a password reset and a full
          takeover, so treating them as different trust levels would
          be theatre. Offered only when there is a factor to clear —
          and never for an admin account: every admin can set
          passwords, so a peer-clearable factor would let one stolen
          admin session walk into every admin account. The server
          refuses it too; hiding the button just keeps the page from
          offering a click that can only 403. */}
      {/* Enforcement without a reset: ends every session at once,
          leaving password and factor untouched. Ban-grade power
          (users.ban) because it is the enforcement half of a ban. */}
      {can.banUser && (
        <div className="ausr-danger">
          <span className="ausr-danger-title">Sign out everywhere</span>
          <p>
            Ends every session on this account at once — the first move when a buyer
            reports someone else is inside it. Their password and second factor stay
            as they are; they just sign in again.
          </p>
          <div className="ausr-danger-row">
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              disabled={busy}
              onClick={() => onRevokeSessions(user)}
              aria-label={`Sign ${user.username} out of every device`}
            >
              <LogOut size={13} aria-hidden="true" /> Sign out everywhere
            </button>
          </div>
        </div>
      )}

      {can.setPassword && twoFactor !== 'disabled' && user.role === 'admin' && (
        <p className="admin-hint" style={{ marginTop: 'var(--sp-3)' }}>
          <ShieldOff size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} />{' '}
          An admin&apos;s second factor can only be removed by its owner, from their own
          profile — never from this page.
        </p>
      )}
      {can.setPassword && twoFactor !== 'disabled' && user.role !== 'admin' && (
        <div className="ausr-danger">
          <span className="ausr-danger-title">Clear the second factor</span>
          <p>
            This account signs in with{' '}
            {twoFactor === 'totp' ? 'an authenticator app' : 'a PGP challenge'} after its
            password. Clearing it drops the requirement and any recovery codes, and signs
            every session out — including one that enrolled the factor without the owner.
            It does not change their password or their key.
          </p>
          <div className="ausr-danger-row">
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              style={{ color: 'var(--danger)' }}
              disabled={busy}
              onClick={() => onClearTwoFactor(user)}
              aria-label={`Clear the second factor for ${user.username}`}
            >
              <ShieldOff size={13} aria-hidden="true" /> Clear second factor
            </button>
          </div>
        </div>
      )}

      <div className="admin-form-actions">
        <button
          type="button"
          className="glass-btn glass-btn-primary glass-btn-sm"
          onClick={() => onSave(user, draft)}
          disabled={busy}
        >
          <Save size={13} aria-hidden="true" /> Save changes
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancelEdit}>
          <X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </>
  );
}

/* ── Line item ─────────────────────────────────────────────────── */

/**
 * One figure in a line: the value, the column heading it needs once the heading
 * row is gone, and an optional second line under it.
 *
 * The label is drawn and hidden rather than left out. `.lrows-head` disappears
 * in the phone shape, and without this the last four cells of a narrow row are
 * four bare numbers with nothing saying which is spend and which is credit —
 * the exact failure DESIGN §5 names when it says the mobile view is not the
 * desktop view with the columns taken away.
 */
function Figure({ label, children, sub = null, mono = true, title }) {
  return (
    <div className={`ausr-fig${mono ? ' lrow-num' : ''}`} title={title}>
      <span className="ausr-fig-label">{label}</span>
      <span>{children}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

/**
 * The column headings.
 *
 * Its own component so the loading frame and the loaded list are laid out by
 * one piece of markup: a skeleton under a different set of headings makes the
 * whole list jump sideways the moment the rows arrive.
 */
function RowsHead() {
  return (
    <div className="lrows-head">
      <span>Account</span>
      <span>Role</span>
      <span>Status</span>
      <span className="ausr-head-num">Orders</span>
      <span className="ausr-head-num">Spend</span>
      <span className="ausr-head-num">Credit</span>
      <span className="ausr-head-num">Last order</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

/**
 * One account as a compact line.
 *
 * Not the card with fields deleted. Everything the card prints is on this row:
 * the monogram and username, the id and join date under it, the role with its
 * granted-permission count, every flag chip, the order count, lifetime and
 * 30-day spend, store credit, and the age of the last order — and the same edit
 * drawer opens in place beneath it, so the compact view is not a read-only
 * consolation prize.
 *
 * "Last order" is where a person looks for "last seen", and it is deliberately
 * as close as this schema gets: there is no last-login column on `users`, and
 * there should not be one. CLAUDE.md's posture is that capability the server
 * does not have cannot be taken from it, and a per-account record of when
 * somebody was last online is retained identity on a store that already refuses
 * to log IPs by default. The newest order is evidence the store had to keep
 * anyway.
 */
function UserRow({
  user, now, can, isSelf, tiers, visibility, busy, editing,
  onEdit, onCancelEdit, onSave, onToggleBan, onDelete, onSetPassword,
  onClearTwoFactor, onRevokeSessions, onSetTier,
}) {
  const tone = ROLE_TONE[user.role] || 'var(--primary)';
  const RoleIcon = ROLE_ICON[user.role] || UserCheck;
  const banned = user.active === false;
  const canEditAnything = can.editUser || can.banUser || can.grantPermissions || can.setPassword;
  const tierBadge = useMemo(
    () => tierBadgeOf(user, tiers, visibility),
    [user, tiers, visibility],
  );

  return (
    <div
      className={[
        'lrow ausr-row',
        banned ? 'is-banned' : '',
        busy ? 'is-busy' : '',
        editing ? 'is-editing' : '',
      ].filter(Boolean).join(' ')}
      // The row's accent follows the role, and turns to danger for a banned
      // account: `--lrow-tone` paints the hover and focus rule, so the marker
      // an operator gets for touching a row already says which kind it is.
      style={{ '--lrow-tone': banned ? 'var(--danger)' : tone }}
      aria-busy={busy || undefined}
    >
      <div className="ausr-row-who">
        <span className={`ausr-avatar${banned ? ' is-banned' : ''}`} aria-hidden="true">
          {initials(user.username)}
        </span>
        <span className="lrow-stack">
          <span className="lrow-text ausr-row-name" title={user.username}>
            {user.username}{isSelf ? ' · you' : ''}
          </span>
          <small title={fullDate(user.created_at)}>
            #{user.id} · joined {shortDate(user.created_at)}
          </small>
        </span>
      </div>

      <div className="lrow-stack">
        <span className="acard-chip" style={{ '--acard-chip-tone': tone }}>
          <RoleIcon size={10} aria-hidden="true" />{user.role}
        </span>
        {/* Titled as well as printed: at a laptop width this track is under
            80px and "12 permissions" truncates, and a truncated field with no
            way to read it in full is a field that has been deleted. */}
        <small title={roleNote(user)}>{roleNote(user)}</small>
      </div>

      <div className="ausr-row-flags lrow-wrap">
        <UserFlags user={user} tierBadge={tierBadge} compact />
      </div>

      <Figure label="Orders">{fmtCount(user.order_count)}</Figure>
      <Figure
        label="Spend"
        sub={visibility.spend && user.spend_30d != null ? `${money(user.spend_30d)} · 30d` : null}
      >
        {visibility.spend ? money(user.total_spent) : <Hidden what="customer spend" />}
      </Figure>
      <Figure label="Credit">
        {visibility.credit ? money(user.store_credit_balance) : <Hidden what="store credit balances" />}
      </Figure>
      {/* Not mono: this cell holds "3d ago", not a figure to line up under the
          one above it. The exact timestamp is on hover — DESIGN §4, disclosure
          rather than a second column. */}
      <Figure
        label="Last order"
        mono={false}
        title={user.last_order_at ? fullDate(user.last_order_at) : 'This account has never placed an order'}
      >
        {user.last_order_at ? relTime(user.last_order_at, now) : 'never'}
      </Figure>

      <div className="lrow-actions">
        {/* §9: the row reaches the thing an operator opens next. Gated on the
            order permission, because without it the link lands on an
            access-denied redirect instead of the customer's orders. */}
        {num(user.order_count) > 0 && can.viewOrders && (
          <Link
            to={`/admin/orders?search=${encodeURIComponent(user.username)}`}
            className="glass-btn glass-btn-sm"
            aria-label={`See orders from ${user.username}`}
            title={`Every order ${user.username} has placed`}
          >
            <ShoppingBag size={13} aria-hidden="true" />
          </Link>
        )}
        {canEditAnything && (
          <button
            type="button"
            className="glass-btn glass-btn-sm acard-disclose"
            onClick={onEdit}
            aria-expanded={editing}
            // The visible word has to appear in the accessible name, or a
            // voice-control user saying "click Edit" matches nothing.
            aria-label={`Edit ${user.username}`}
            disabled={busy}
          >
            <Edit2 size={13} aria-hidden="true" /> Edit <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
        {/* Only Edit keeps its word. Four worded buttons on one line is both
            the wall of chrome §4 is about and 268px of track that every other
            column then has to be squeezed out of — and the track has to be a
            fixed width for the columns to line up at all. The words survive in
            the accessible names and the tooltips, and all three of these
            confirm before they do anything. */}
        {can.banUser && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            style={{ color: banned ? 'var(--success)' : 'var(--danger)' }}
            onClick={() => onToggleBan(user)}
            disabled={busy}
            aria-label={`${banned ? 'Unban' : 'Ban'} ${user.username}`}
            title={banned ? 'Let this account sign in again' : 'Revoke every session and stop this account signing in'}
          >
            {banned ? <RotateCcw size={13} aria-hidden="true" /> : <Ban size={13} aria-hidden="true" />}
          </button>
        )}
        {can.deleteUser && !isSelf && (
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-danger"
            onClick={() => onDelete(user)}
            disabled={busy}
            aria-label={`Delete ${user.username}`}
            title="Delete this account and everything attached to it"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* The editor is a cell of the row spanning every track, not a sibling of
          it: as a sibling it would land between two `.lrow`s and break both the
          zebra and the hairline the list is separated by. */}
      <div className={`acard-drawer ausr-row-editor${editing ? ' is-open' : ''}`}>
        <div className="acard-drawer-clip">
          <div className="acard-drawer-inner" inert={editing ? undefined : true}>
            <UserEditor
              user={user}
              can={can}
              editing={editing}
              busy={busy}
              isSelf={isSelf}
              tierPicker={(
                <TierPicker
                  user={user}
                  tiers={tiers}
                  can={can}
                  visibility={visibility}
                  busy={busy}
                  onSetTier={onSetTier}
                />
              )}
              onCancelEdit={onCancelEdit}
              onSave={onSave}
              onSetPassword={onSetPassword}
              onClearTwoFactor={onClearTwoFactor}
              onRevokeSessions={onRevokeSessions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * What an empty account list says, and where it sends the operator.
 *
 * DESIGN §9: an empty state is navigation, not an apology. This page owns who
 * exists in the store, so the ways out of an empty one are creating an account,
 * widening the filter that hid the account somebody came here looking for, or
 * the two places accounts arrive from and are spent from — invite links and the
 * store-credit ledger. Every link is gated on the grant that opens the page it
 * points at, so nobody is offered a door that answers "access denied".
 */
function NoAccounts({ isFiltered, focusId, can, onClear, onCreate }) {
  return (
    <>
      <p>
        {/* Three different nothings, and the operator can only act on the one
            they are actually in. Arriving from the store-credit ledger on a
            `?id=` link that matches no row is not the same problem as a search
            term with no hits, and telling somebody to widen their search when
            they never typed one is how a screen loses their trust. */}
        {focusId
          ? 'That link points at a single account by id. Nothing matched it — the account may have been deleted, or the role and status filters above may be excluding it.'
          : isFiltered
            ? 'The search matches usernames only, and the status filter hides the other half of the list entirely — a banned account is invisible while it reads "Active only".'
            : 'Accounts appear here the moment somebody registers, is created from this page, or signs up through an invite link.'}
      </p>
      <div className="ausr-empty-links">
        {isFiltered && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={onClear}>
            <FilterX size={14} aria-hidden="true" /> {focusId ? 'Show all accounts' : 'Clear filters'}
          </button>
        )}
        {can.createUser && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={onCreate}>
            <UserPlus size={14} aria-hidden="true" /> Create an account
          </button>
        )}
        {can.has('users.invite_links') && (
          <Link to="/admin/invite-links" className="glass-btn glass-btn-sm">
            <Send size={14} aria-hidden="true" /> Invite links
          </Link>
        )}
        {can.has('analytics.store_credit') && (
          <Link to="/admin/store-credit" className="glass-btn glass-btn-sm">
            <Wallet size={14} aria-hidden="true" /> Store credit ledger
          </Link>
        )}
        {can.viewOrders && (
          <Link to="/admin/orders" className="glass-btn glass-btn-sm">
            <ShoppingBag size={14} aria-hidden="true" /> Order queue
          </Link>
        )}
      </div>
    </>
  );
}

/**
 * A labelled on/off switch.
 *
 * Built on a real `<input type="checkbox">` nested inside the text-bearing
 * `<label>`, which is what gives it an accessible name and makes it reachable
 * and operable from the keyboard. `tone` is passed as `--switch-on`, prefixed
 * so it cannot collide with a theme token.
 */
function Toggle({ label, checked, onChange, tone = 'var(--primary)' }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', cursor: 'pointer', userSelect: 'none' }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <span className="switch" style={{ '--switch-on': tone }}>
          <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch-track" />
        </span>
        <span style={{ fontSize: 'var(--fs-sm)', color: checked ? tone : 'var(--text-muted)', fontWeight: 500 }}>
          {checked ? 'Yes' : 'No'}
        </span>
      </span>
    </label>
  );
}
