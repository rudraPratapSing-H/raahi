// "Find X": the camera-driven target-search feature. Two paths:
//  - Known graph node -> reuse the existing, deterministic /api/localize +
//    /api/path (no Gemini vision call at all, human-authored instructions).
//  - Unknown target -> one-shot /api/vision/find, then an optional slow
//    (~5s) polling "guide" loop that only speaks when the answer changes.
// ctx = { voice, ble, camera, backend, log, i18n, state } (see app.js).
// ctx.state.activeRoute = { steps, index, targetLabel } | null
// ctx.state.activeFind   = { target, lastDirection, lastDistance } | null

const FIND_POLL_MS = 5000;
const HEARTBEAT_EVERY_N_POLLS = 4; // ~20s between "still looking" heartbeats
const ARRIVED_STREAK_NEEDED = 2;

let inFlight = false;
let guideTimer = null;
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

function matchesTarget(node, normalized) {
  const name = (node.name || '').toLowerCase();
  const id = (node.id || '').toLowerCase();
  return (!!name && (name.includes(normalized) || normalized.includes(name)))
      || (!!id && (id.includes(normalized) || normalized.includes(id)));
}

function directionText(ctx, direction) {
  return ctx.i18n.t(`direction.${direction}`) || ctx.i18n.t('direction.unknown');
}

function distanceSuffixText(ctx, distanceHint) {
  if (distanceHint === 'near') return ctx.i18n.t('distance.near');
  if (distanceHint === 'far') return ctx.i18n.t('distance.far');
  return '';
}

function speakFindResult(target, result, ctx) {
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

function speakCurrentStep(ctx) {
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

function advanceRoute(ctx) {
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

async function findKnownNode(node, targetLabel, ctx) {
  ctx.log.add(`Finding "${targetLabel}" via mapped location ${node.name || node.id}`);
  let frame;
  try {
    frame = await ctx.camera.captureFrame();
  } catch (err) {
    ctx.voice.enqueue(ctx.i18n.t('camera.permissionDenied'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  const loc = await ctx.backend.localize(frame).catch(() => ({ status: 'no_match' }));
  if (loc.status !== 'match') {
    ctx.voice.enqueue(ctx.i18n.t('loc.needLocateFirst'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  const path = await ctx.backend
    .getPath(loc.node.id, node.id, ctx.state.blockedEdges || [])
    .catch(() => ({ status: 'error' }));
  if (path.status !== 'ok' || !path.steps || path.steps.length === 0) {
    ctx.voice.enqueue(ctx.i18n.t('loc.noMatch'), { priority: ctx.voice.PRIORITY.INFO });
    return;
  }

  ctx.state.activeRoute = { steps: path.steps, index: 0, targetLabel };
  ctx.state.activeFind = null;
  speakCurrentStep(ctx);
}

async function runVisualSearch(target, ctx) {
  ctx.log.add(`Looking for "${target}" with camera`);
  let frame;
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

export async function find(target, ctx) {
  if (inFlight || !target) return;
  stopGuideTimer();
  inFlight = true;
  try {
    const normalized = target.trim().toLowerCase();
    const graph = await ctx.backend.getGraph().catch(() => null);
    const matched = graph && graph.nodes ? graph.nodes.find((n) => matchesTarget(n, normalized)) : null;

    if (matched) {
      await findKnownNode(matched, target, ctx);
    } else {
      await runVisualSearch(target, ctx);
    }
  } finally {
    inFlight = false;
  }
}

async function pollVisualGuide(ctx) {
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

export async function guide(ctx) {
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

  ctx.voice.enqueue(ctx.i18n.t('finder.needTargetFirst'), { priority: ctx.voice.PRIORITY.INFO });
}

export function cancel(ctx) {
  stopGuideTimer();
  const hadActive = !!(ctx.state.activeRoute || ctx.state.activeFind);
  ctx.state.activeRoute = null;
  ctx.state.activeFind = null;
  if (hadActive) {
    ctx.voice.enqueue(ctx.i18n.t('finder.cancelled'), { priority: ctx.voice.PRIORITY.INFO });
  }
}
