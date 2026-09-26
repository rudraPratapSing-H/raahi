// One shared handler map so a hardware button gesture and a spoken voice
// command reach exactly the same app behavior - no duplicated logic between
// buttons.js and voiceCommands.js.
// ctx = { voice, ble, zones, camera, backend, finder, log, i18n, state }

import * as finder from './finder.js';

function repeatLast(ctx) {
  ctx.voice.repeatLast();
}

function toggleMute(ctx) {
  ctx.state.muted = !ctx.state.muted;
  ctx.voice.setMuted(ctx.state.muted);
  const text = ctx.i18n.t(ctx.state.muted ? 'voice.muteOn' : 'voice.muteOff');
  ctx.log.add(text);
  // Force DANGER priority so this confirmation is actually heard even though
  // it's spoken at the exact moment mute just turned on (INFO would be
  // silently swallowed by the mute state it just set, leaving the user with
  // no confirmation that the press registered at all).
  ctx.voice.enqueue(text, { priority: ctx.voice.PRIORITY.DANGER });
}

async function whereAmI(ctx) {
  let frame;
  try {
    frame = await ctx.camera.captureFrame();
  } catch (err) {
    ctx.voice.enqueue(ctx.i18n.t('camera.permissionDenied'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }
  const loc = await ctx.backend.localize(frame).catch(() => ({ status: 'no_match' }));
  if (loc.status !== 'match') {
    ctx.voice.enqueue(ctx.i18n.t('loc.noMatch'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }
  ctx.voice.enqueue(ctx.i18n.t('loc.match', { name: loc.node.name || loc.node.id }), {
    priority: ctx.voice.PRIORITY.INFO,
  });

  if (ctx.state.destinationNodeId) {
    const path = await ctx.backend
      .getPath(loc.node.id, ctx.state.destinationNodeId, ctx.state.blockedEdges || [])
      .catch(() => ({ status: 'error' }));
    if (path.status === 'ok' && path.steps && path.steps.length) {
      const next = path.steps[0];
      if (next.instruction) {
        ctx.voice.enqueue(next.instruction, { priority: ctx.voice.PRIORITY.INFO });
      } else {
        ctx.voice.enqueue(ctx.i18n.t('loc.arrived'), { priority: ctx.voice.PRIORITY.INFO });
      }
    }
  }
}

function sos(ctx) {
  ctx.voice.enqueue(ctx.i18n.t('sos.activated'), { priority: ctx.voice.PRIORITY.SOS });
  ctx.ble.sendCommand(ctx.ble.CMD_BUZZ_ALL).catch(() => {});
  ctx.log.addSOS(`Triggered at ${new Date().toLocaleTimeString()}`);
  ctx.onSOS && ctx.onSOS();
  // No emergency-contact/SMS integration - explicitly out of scope for now.
}

function recalibrate(ctx) {
  ctx.ble.sendCommand(ctx.ble.CMD_RECALIBRATE).catch(() => {});
  ctx.voice.enqueue(ctx.i18n.t('voice.recalibrateSent'), { priority: ctx.voice.PRIORITY.INFO });
  ctx.log.add('Recalibrate sent');
}

function find(ctx, extra) {
  return finder.find(extra && extra.target, ctx);
}

function guide(ctx) {
  return finder.guide(ctx);
}

function cancelFind(ctx) {
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
};

export async function dispatch(name, ctx, extra) {
  const handler = ACTION_HANDLERS[name];
  if (!handler) return;
  return handler(ctx, extra);
}
