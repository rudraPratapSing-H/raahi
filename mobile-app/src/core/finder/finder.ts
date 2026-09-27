// "Find X": ported from the web-app's finder.js almost unchanged - same two
// paths (known graph node -> reuse localize+getPath, no vision call at all;
// unknown target -> one-shot findVisually, then an optional slow ~5s polling
// "guide" loop that only speaks when the answer changes).

import type { Ctx } from '../state/types';
import { findWaypointByFuzzyName } from '../outdoor/waypointStore';
import { startOutdoorGuidance, stopOutdoorGuidance, isGuiding as isOutdoorGuiding } from '../outdoor/outdoorNav';

const FIND_POLL_MS = 5000;
const HEARTBEAT_EVERY_N_POLLS = 4; // ~20s between "still looking" heartbeats
const ARRIVED_STREAK_NEEDED = 2;

let inFlight = false;
let guideTimer: ReturnType<typeof setInterval> | null = null;
let guidePollCount = 0;
let guideArrivedStreak = 0;

function stopGuideTimer() {
  if (guideTimer) {
    clearInterval(guideTimer);
    guideTimer = null;
  }
  guidePollCount = 0;
  guideArrivedStreak = 0;
}

function directionText(ctx: Ctx, direction: string): string {
  return ctx.i18n.t(`direction.${direction}`) || ctx.i18n.t('direction.unknown');
}

function distanceSuffixText(ctx: Ctx, distanceHint: string | null): string {
  if (distanceHint === 'near') return ctx.i18n.t('distance.near');
  if (distanceHint === 'far') return ctx.i18n.t('distance.far');
  return '';
}

function speakFindResult(target: string, result: { visible: boolean; direction: string; distance_hint: string | null }, ctx: Ctx) {
  if (!result.visible) {
    ctx.voice.enqueue(ctx.i18n.t('finder.notVisible', { target }), {
      priority: ctx.voice.PRIORITY.INFO,
      key: `find:${target}`,
    });
    return;
  }
  ctx.voice.enqueue(
    ctx.i18n.t('finder.result', {
      target,
      direction: directionText(ctx, result.direction),
      distanceSuffix: distanceSuffixText(ctx, result.distance_hint),
    }),
    { priority: ctx.voice.PRIORITY.INFO, key: `find:${target}` }
  );
}

function speakCurrentStep(ctx: Ctx) {
  const route = ctx.state.activeRoute;
  if (!route) return;
  const step = route.steps[route.index];
  if (!step) return;
  if (step.instruction) {
    ctx.voice.enqueue(step.instruction, { priority: ctx.voice.PRIORITY.INFO });
  } else if (route.index === route.steps.length - 1) {
    ctx.voice.enqueue(ctx.i18n.t('loc.arrived'), { priority: ctx.voice.PRIORITY.INFO });
  }
}

function advanceRoute(ctx: Ctx): boolean {
  const route = ctx.state.activeRoute;
  if (!route) return false;
  if (route.index >= route.steps.length - 1) {
    ctx.voice.enqueue(ctx.i18n.t('loc.arrived'), { priority: ctx.voice.PRIORITY.INFO });
    ctx.state.activeRoute = null;
    return true;
  }
  route.index += 1;
  speakCurrentStep(ctx);
  return true;
}

async function findKnownNode(nodeId: string, nodeName: string, targetLabel: string, ctx: Ctx) {
  ctx.log.add(`Finding "${targetLabel}" via mapped location ${nodeName}`);
  let frame: string;
  try {
    frame = await ctx.camera.captureFrame();
  } catch (err) {
    ctx.voice.enqueue(ctx.i18n.t('camera.permissionDenied'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  const loc = await ctx.backend.localize(frame).catch(() => ({ status: 'no_match' as const, similarity: 0 }));
  if (loc.status !== 'match' || !loc.node) {
    ctx.voice.enqueue(ctx.i18n.t('loc.needLocateFirst'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  const path = await ctx.backend
    .getPath(loc.node.id, nodeId, ctx.state.blockedEdges ?? [])
    .catch(() => ({ status: 'error' as const, detail: 'network' }));
  if (path.status !== 'ok' || !path.steps || path.steps.length === 0) {
    ctx.voice.enqueue(ctx.i18n.t('loc.noMatch'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  ctx.state.activeRoute = { steps: path.steps, index: 0, targetLabel };
  ctx.state.activeFind = null;
  speakCurrentStep(ctx);
}

async function runVisualSearch(target: string, ctx: Ctx) {
  ctx.log.add(`Looking for "${target}" with camera`);
  let frame: string;
  try {
    frame = await ctx.camera.captureFrame();
  } catch (err) {
    ctx.voice.enqueue(ctx.i18n.t('camera.permissionDenied'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  const result = await ctx.backend.findVisually(frame, target, ctx.i18n.getLang()).catch(() => null);
  if (!result) {
    ctx.voice.enqueue(ctx.i18n.t('finder.notVisible', { target }), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  ctx.state.activeRoute = null;
  ctx.state.activeFind = { target, lastDirection: result.direction, lastDistance: result.distance_hint };
  speakFindResult(target, result, ctx);
}

export async function find(target: string | undefined, ctx: Ctx) {
  if (inFlight || !target) return;
  stopGuideTimer();
  stopOutdoorGuidance();
  inFlight = true;
  try {
    const matched = ctx.backend.findNodeByFuzzyName(target);
    if (matched) {
      await findKnownNode(matched.id, matched.name, target, ctx);
      return;
    }

    const waypoint = await findWaypointByFuzzyName(target);
    if (waypoint) {
      ctx.state.activeRoute = null;
      ctx.state.activeFind = null;
      ctx.log.add(`Guiding outdoors to "${waypoint.name}"`);
      const started = await startOutdoorGuidance(waypoint);
      if (!started) {
        ctx.voice.enqueue(ctx.i18n.t('outdoor.needLocationPermission'), { priority: ctx.voice.PRIORITY.INFO });
      }
      return;
    }

    await runVisualSearch(target, ctx);
  } finally {
    inFlight = false;
  }
}

async function pollVisualGuide(ctx: Ctx) {
  if (inFlight) return;
  const activeFind = ctx.state.activeFind;
  if (!activeFind) {
    stopGuideTimer();
    return;
  }
  inFlight = true;
  guidePollCount += 1;
  try {
    const frame = await ctx.camera.captureFrame();
    const result = await ctx.backend.findVisually(frame, activeFind.target, ctx.i18n.getLang());

    const arrived = result.visible && result.direction === 'ahead' && result.distance_hint === 'near';
    guideArrivedStreak = arrived ? guideArrivedStreak + 1 : 0;

    if (guideArrivedStreak >= ARRIVED_STREAK_NEEDED) {
      stopGuideTimer();
      ctx.state.activeFind = null;
      ctx.voice.enqueue(ctx.i18n.t('finder.arrived', { target: activeFind.target }), {
        priority: ctx.voice.PRIORITY.INFO,
      });
      return;
    }

    const changed = result.direction !== activeFind.lastDirection || result.distance_hint !== activeFind.lastDistance;
    activeFind.lastDirection = result.direction;
    activeFind.lastDistance = result.distance_hint;

    if (changed) {
      speakFindResult(activeFind.target, result, ctx);
    } else if (guidePollCount % HEARTBEAT_EVERY_N_POLLS === 0) {
      ctx.voice.enqueue(ctx.i18n.t('finder.stillLooking', { target: activeFind.target }), {
        priority: ctx.voice.PRIORITY.AWARE,
        key: 'find:heartbeat',
      });
    }
  } catch (err) {
    console.error('guide poll failed', err);
  } finally {
    inFlight = false;
  }
}

export async function guide(ctx: Ctx) {
  if (ctx.state.activeRoute) {
    advanceRoute(ctx);
    return;
  }

  if (ctx.state.activeFind) {
    if (guideTimer) return; // already guiding
    guidePollCount = 0;
    guideArrivedStreak = 0;
    guideTimer = setInterval(() => pollVisualGuide(ctx), FIND_POLL_MS);
    return;
  }

  if (isOutdoorGuiding()) {
    ctx.voice.repeatLast(); // already continuously guiding outdoors - "guide me" again just repeats
    return;
  }

  ctx.voice.enqueue(ctx.i18n.t('finder.needTargetFirst'), { priority: ctx.voice.PRIORITY.INFO });
}

export function cancel(ctx: Ctx) {
  const hadActive = !!(ctx.state.activeRoute || ctx.state.activeFind || isOutdoorGuiding());
  stopGuideTimer();
  stopOutdoorGuidance();
  ctx.state.activeRoute = null;
  ctx.state.activeFind = null;
  if (hadActive) {
    ctx.voice.enqueue(ctx.i18n.t('finder.cancelled'), { priority: ctx.voice.PRIORITY.INFO });
  }
}
