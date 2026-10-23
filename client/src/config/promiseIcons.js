import {
  ShieldCheck, BadgeCheck, FlaskConical, Microscope, Atom, ClipboardCheck,
  FileCheck, ScanLine, Stamp, Award, Scale, Ruler,
  Lock, LockKeyhole, KeyRound, Fingerprint, EyeOff, Server, WifiOff, Bitcoin,
  Leaf, Sprout, Factory, Hammer, Anvil, Recycle, Thermometer, Snowflake,
  Truck, Package, PackageCheck, Box, MapPin, Globe, Timer, Archive,
  Coins, Banknote, Wallet, Receipt, Percent, Tag, HandCoins,
  Users, HeartHandshake, Handshake, HandHelping, LifeBuoy, MessageCircle,
  Star, Sparkles, Zap, Gauge, RotateCcw, CircleCheckBig,
} from 'lucide-react';

/**
 * The icons an operator may put on a home-page promise.
 *
 * Every one is vendored with the client. There is no icon-font CDN and no
 * remote SVG here on purpose: a buyer on a filtered network has to be able to
 * read what this store promises them, and an icon fetched from somebody
 * else's host is both a broken picture on that network and a log line handed
 * to whoever serves it.
 *
 * `server/config/homeKeys.js` holds the same ids in the same order and
 * refuses to store one that is not on the list. The two files are kept in
 * step by hand — the API cannot require React, which is the same arrangement
 * config/storePages.js has with config/pageKeys.js — and
 * `test/promiseIcons.test.mjs` asserts they still match, because the failure
 * otherwise is silent in one direction (an id the operator can pick and the
 * server then rejects) and invisible in the other (an id the server accepts
 * that draws nothing).
 *
 * Grouped by what the operator is trying to say, because that is how someone
 * shops for an icon — "I need the one about testing" — and a flat wall of
 * fifty-five glyphs is a wall nobody reads to the end of.
 */
export const PROMISE_ICON_GROUPS = [
  {
    label: 'Proof & testing',
    icons: {
      'shield-check': ShieldCheck,
      'badge-check': BadgeCheck,
      'flask-conical': FlaskConical,
      microscope: Microscope,
      atom: Atom,
      'clipboard-check': ClipboardCheck,
      'file-check': FileCheck,
      'scan-line': ScanLine,
      stamp: Stamp,
      award: Award,
      scale: Scale,
      ruler: Ruler,
    },
  },
  {
    label: 'Privacy & infrastructure',
    icons: {
      lock: Lock,
      'lock-keyhole': LockKeyhole,
      'key-round': KeyRound,
      fingerprint: Fingerprint,
      'eye-off': EyeOff,
      server: Server,
      'wifi-off': WifiOff,
      bitcoin: Bitcoin,
    },
  },
  {
    label: 'Sourcing & making',
    icons: {
      leaf: Leaf,
      sprout: Sprout,
      factory: Factory,
      hammer: Hammer,
      anvil: Anvil,
      recycle: Recycle,
      thermometer: Thermometer,
      snowflake: Snowflake,
    },
  },
  {
    label: 'Shipping',
    icons: {
      truck: Truck,
      package: Package,
      'package-check': PackageCheck,
      box: Box,
      'map-pin': MapPin,
      globe: Globe,
      timer: Timer,
      archive: Archive,
    },
  },
  {
    label: 'Money',
    icons: {
      coins: Coins,
      banknote: Banknote,
      wallet: Wallet,
      receipt: Receipt,
      percent: Percent,
      tag: Tag,
      'hand-coins': HandCoins,
    },
  },
  {
    label: 'People & service',
    icons: {
      users: Users,
      'heart-handshake': HeartHandshake,
      handshake: Handshake,
      'hand-helping': HandHelping,
      'life-buoy': LifeBuoy,
      'message-circle': MessageCircle,
      star: Star,
      sparkles: Sparkles,
      zap: Zap,
      gauge: Gauge,
      'rotate-ccw': RotateCcw,
      'circle-check-big': CircleCheckBig,
    },
  },
];

/** Flat id → component, for rendering. */
export const PROMISE_ICONS = Object.assign(
  {},
  ...PROMISE_ICON_GROUPS.map((g) => g.icons),
);

/** Every id, in roster order — the order the server's list is written in. */
export const PROMISE_ICON_IDS = PROMISE_ICON_GROUPS.flatMap((g) => Object.keys(g.icons));

/**
 * The fallback, matching `DEFAULT_ICON` server-side.
 *
 * Used only for a blob written by something other than this editor — the save
 * path rejects an unknown id rather than substituting one, so a promise that
 * reaches the storefront with an icon this build does not have came from a
 * client newer than this one. Drawing a tick beats drawing a hole in the
 * spine.
 */
export const promiseIcon = (id) => PROMISE_ICONS[id] || CircleCheckBig;
