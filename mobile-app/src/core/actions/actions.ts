// One shared handler map so a hardware button gesture and a spoken voice
// command reach exactly the same app behavior - ported from the web-app's
// actions.js. `sos` is extended (not replaced): it still speaks + buzzes the
// wearable, and now also sends a real SMS with a location link since a phone
// can actually do that (the web version explicitly couldn't).

import * as finder from '../finder/finder';
import { sendSosMessage } from '../safety/sos';
import type { Ctx } from '../state/types';

function repeatLast(ctx: Ctx) {
  ctx.voice.repeatLast();
}

function toggleMute(ctx: Ctx) {
  ctx.state.muted = !ctx.state.muted;
  ctx.voice.setMuted(ctx.state.muted);
  const text = ctx.i18n.t(ctx.state.muted ? 'voice.muteOn' : 'voice.muteOff');
  ctx.log.add(text);
  // Force DANGER priority so this confirmation is actually heard even though
  // it's spoken at the exact moment mute just turned on (INFO would be
  // silently swallowed by the mute state it just set).
  ctx.voice.enqueue(text, { priority: ctx.voice.PRIORITY.DANGER });
}

async function whereAmI(ctx: Ctx) {
  let frame: string;
  try {
    frame = await ctx.camera.captureFrame();
  } catch (err) {
    ctx.voice.enqueue(ctx.i18n.t('camera.permissionDenied'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }
  const loc = await ctx.backend.localize(frame).catch(() => ({ status: 'no_match' as const, similarity: 0 }));
  if (loc.status !== 'match' || !loc.node) {
    ctx.voice.enqueue(ctx.i18n.t('loc.noMatch'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }
  ctx.voice.enqueue(ctx.i18n.t('loc.match', { name: loc.node.name || loc.node.id }), {
    priority: ctx.voice.PRIORITY.INFO,
  });

  if (ctx.state.destinationNodeId) {
    const path = await ctx.backend
      .getPath(loc.node.id, ctx.state.destinationNodeId, ctx.state.blockedEdges ?? [])
      .catch(() => ({ status: 'error' as const, detail: 'network' }));
    if (path.status === 'ok' && path.steps.length) {
      const next = path.steps[0];
      if (next.instruction) {
        ctx.voice.enqueue(next.instruction, { priority: ctx.voice.PRIORITY.INFO });
      } else {
        ctx.voice.enqueue(ctx.i18n.t('loc.arrived'), { priority: ctx.voice.PRIORITY.INFO });
      }
    }
  }
}

async function sos(ctx: Ctx) {
  ctx.voice.enqueue(ctx.i18n.t('sos.activated'), { priority: ctx.voice.PRIORITY.SOS });
  ctx.ble.sendCommand(ctx.ble.CMD_BUZZ_ALL).catch(() => {});
  ctx.log.addSOS(`Triggered at ${new Date().toLocaleTimeString()}`);
  ctx.onSOS?.();

  const result = await sendSosMessage().catch(() => ({ status: 'unavailable' as const }));
  if (result.status === 'sent' || result.status === 'unknown') {
    ctx.log.add(ctx.i18n.t('sos.smsSent'));
  } else if (result.status === 'no_contact') {
    ctx.voice.enqueue(ctx.i18n.t('sos.noContact'), { priority: ctx.voice.PRIORITY.INFO });
  } else if (result.status !== 'cancelled') {
    ctx.log.add(ctx.i18n.t('sos.smsFailed'));
  }
}

function recalibrate(ctx: Ctx) {
  ctx.ble.sendCommand(ctx.ble.CMD_RECALIBRATE).catch(() => {});
  ctx.voice.enqueue(ctx.i18n.t('voice.recalibrateSent'), { priority: ctx.voice.PRIORITY.INFO });
  ctx.log.add('Recalibrate sent');
}

function find(ctx: Ctx, extra?: { target?: string }) {
  return finder.find(extra?.target, ctx);
}

function guide(ctx: Ctx) {
  return finder.guide(ctx);
}

function cancelFind(ctx: Ctx) {
  return finder.cancel(ctx);
}

export const ACTION_HANDLERS = {
  repeatLast,
  toggleMute,
  whereAmI,
  sos,
  recalibrate,
  find,
  guide,
  cancelFind,
} as const;

export type ActionName = keyof typeof ACTION_HANDLERS;

export async function dispatch(name: string, ctx: Ctx, extra?: { target?: string }) {
  const handler = (ACTION_HANDLERS as Record<string, (ctx: Ctx, extra?: { target?: string }) => unknown>)[name];
  if (!handler) return;
  return handler(ctx, extra);
}
