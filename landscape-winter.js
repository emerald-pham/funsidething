/* Finite winter visitors for the living landscape. The module owns only
   visitor geometry and paint calls; seasonal scheduling and the snow-covered
   hills remain with the scene renderer. */
(function (root) {
  'use strict';

  const TYPES = Object.freeze(['snowman', 'skier', 'snowangel']);
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const smooth = (start, end, value) => {
    const amount = clamp((value - start) / (end - start));
    return amount * amount * (3 - 2 * amount);
  };
  const mix = (a, b, amount) => {
    const t = clamp(amount);
    const parse = value => {
      const hex = String(value || '').replace('#', '');
      return /^[0-9a-f]{6}$/i.test(hex) ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] : null;
    };
    const left = parse(a), right = parse(b);
    if (!left || !right) return a;
    return `#${left.map((value, index) => Math.round(value + (right[index] - value) * t).toString(16).padStart(2, '0')).join('')}`;
  };
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function eventValues(event, W) {
    const duration = Math.max(.001, finite(event && event.duration, 1));
    const progress = clamp(finite(event && event.age, 0) / duration);
    const lane = clamp(finite(event && event.lane, .5));
    const seed = clamp(finite(event && event.seed, .5));
    const direction = event && event.reverse ? -1 : 1;
    // Winter visitors share the trail visitor's visual weight. Preserve a
    // readable minimum on phones while keeping desktop people close to 1x.
    const scale = Math.min(1, Math.max(.85, W / 720));
    return { duration, progress, lane, seed, direction, scale };
  }

  function requireGeometry(geometry, W, H) {
    if (!geometry || typeof geometry.middle !== 'function' || typeof geometry.near !== 'function' ||
      typeof geometry.tangent !== 'function') throw new TypeError('Winter geometry required');
    if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
      throw new RangeError('Winter viewport required');
    }
  }

  function lerp(a, b, amount) { return a + (b - a) * amount; }

  function skierX(progress, direction, lane, W) {
    // The middle hill is a sine wave. These two short ranges are selected from
    // its descending slopes; reversing chooses the mirrored downhill run.
    const low = direction > 0 ? W * (.08 + lane * .05) : W * (.60 + lane * .03);
    const high = direction > 0 ? W * (.30 + lane * .05) : W * (.82 + lane * .02);
    // Complete the visit on this one downhill slope. Fade into the trees at
    // its end instead of racing across the next (uphill) section to the edge.
    const run = smooth(0, 1, progress);
    return direction > 0 ? lerp(low, high, run) : lerp(high, low, run);
  }

  function activityAnchor(lane, W) { return W * (.18 + lane * .64); }

  function anchoredActivity(progress, direction, lane, W, departureStart = null) {
    const anchor = activityAnchor(lane, W);
    const arrival = smooth(0, .12, progress);
    const approach = direction > 0 ? -W * .22 : W * 1.22;
    const settled = lerp(approach, anchor, arrival);
    const exit = direction > 0 ? W * 1.22 : -W * .22;
    const departure = departureStart === null ? 0 : smooth(departureStart, 1, progress);
    return { anchor, x: lerp(settled, exit, departure), arrival, departure };
  }

  function pose(type, event, geometry, W, H) {
    if (!TYPES.includes(type)) throw new RangeError('Unknown winter visitor');
    requireGeometry(geometry, W, H);
    const values = eventValues(event || {}, W);
    const { progress, lane, seed, direction, scale } = values;
    const alpha = smooth(0, .06, progress) * (1 - smooth(.94, 1, progress));

    if (type === 'skier') {
      const x = skierX(progress, direction, lane, W);
      const snowOffset = 8 + lane * 2;
      return {
        type, x, y: geometry.middle(x) + snowOffset, groundY: geometry.middle(x) + snowOffset,
        snowOffset, angle: geometry.tangent(geometry.middle, x),
        // The skis use angle alone; lean is reserved for the torso.
        lean: direction * (.08 + seed * .1),
        scale: Math.max(.85, scale * (.98 + lane * .02)), alpha, progress, lane, seed, direction,
        skiing: progress >= .12 && progress <= .88, walking: false,
      };
    }

    const activity = anchoredActivity(progress, direction, lane, W, type === 'snowangel' ? .84 : null);
    const anchor = activity.anchor;

    if (type === 'snowman') {
      const snowOffset = 5 + lane;
      const groundY = geometry.middle(anchor) + snowOffset;
      const build = smooth(.14, .72, progress);
      const finalFadeAlpha = smooth(.94, 1, progress);
      const structureAlpha = 1 - finalFadeAlpha;
      const builderWalk = smooth(.68, .98, progress);
      const builderX = anchor - direction * 13 * scale + direction * W * .24 * builderWalk;
      const builderGroundY = geometry.middle(builderX) + snowOffset;
      const builderAlpha = smooth(.05, .14, progress) * (1 - smooth(.90, .99, progress));
      return {
        type, x: anchor, y: groundY, groundY, snowOffset,
        builderX, builderGroundY, builderScale: scale, structureAlpha, patchAlpha: structureAlpha,
        finalFadeAlpha, angle: geometry.tangent(geometry.middle, anchor), scale, alpha,
        progress, lane, seed, direction, build,
        building: progress >= .08 && progress < .78,
        builderLeaving: progress >= .68 && progress < .99,
        builderVisible: builderAlpha > 0, builderAlpha, walking: progress >= .68,
      };
    }

    const imprintGroundY = geometry.near(anchor) + 9 + lane * 2;
    const bodyGroundY = geometry.near(activity.x) + 9 + lane * 2;
    const bodyMode = smooth(.68, .84, progress);
    const finalFadeAlpha = smooth(.94, 1, progress);
    const imprintAlpha = 1 - finalFadeAlpha;
    const armSweep = smooth(.12, .72, progress);
    const legSweep = clamp(.5 + .5 * Math.sin(armSweep * Math.PI * 2 + seed * 4));
    const walking = progress >= .84;
    return {
      type, x: activity.x, y: bodyGroundY, groundY: bodyGroundY,
      imprintX: anchor, imprintGroundY, imprintAlpha, patchAlpha: imprintAlpha,
      snowOffset: 9 + lane * 2, angle: geometry.tangent(geometry.near, activity.x),
      scale: scale * .96, alpha, progress, lane, seed, direction,
      imprint: armSweep, standing: bodyMode, bodyMode,
      lyingAlpha: 1 - bodyMode, standingAlpha: bodyMode,
      armSweep, legSweep, walking, walkAmount: walking ? smooth(.84, .94, progress) : 0,
    };
  }

  function paint(g, geometry, W, H, event, t, palette, helpers) {
    if (!g || !helpers) return false;
    const type = event && event.type;
    if (!TYPES.includes(type)) return false;
    const poseValue = pose(type, event, geometry, W, H);
    const ellipse = helpers.ellipse;
    const line = helpers.line;
    const color = helpers.color || (() => palette && palette.front || '#8b9f9a');
    const skinColor = helpers.skinColor || (() => '#b27d58');
    const personHead = typeof helpers.personHead === 'function' ? helpers.personHead : null;
    const S = helpers.S || {};
    if (typeof ellipse !== 'function' || typeof line !== 'function') return false;
    const smoothValue = typeof S.smooth === 'function' ? S.smooth : smooth;
    const mixHex = typeof S.mixHex === 'function' ? S.mixHex : mix;
    const front = palette && palette.front || '#8dcca1';
    const hill = palette && palette.hill || '#ace097';
    const sky = palette && palette.sky || ['#8ed4f3', '#d4f5f2', '#f6fbe2'];
    const snow = mixHex(sky[1] || '#d4f5f2', '#ffffff', .7);
    const snowShadow = mixHex(sky[2] || '#f6fbe2', '#9bbcc5', .35);
    const ink = mixHex(palette && palette.city || '#bbdce1', '#4c6870', .3);
    const tValue = Number.isFinite(t) ? t : 0;
    const drawEllipse = (x, y, rx, ry, fill) => ellipse(g, x, y, Math.max(0, rx), Math.max(0, ry), fill);
    const drawLine = (x, y, x2, y2, stroke, width = 1) => line(g, x, y, x2, y2, stroke, width);
    const drawHead = (x, y, rx, ry, seed, skin, hat = false) => {
      if (personHead) return personHead(g, x, y, rx, ry, seed, skin, hat);
      return drawEllipse(x, y, rx, ry, skin);
    };

    g.save();
    const sceneAlpha = clamp(poseValue.alpha);
    const depthScale = poseValue.scale;
    const shadowX = type === 'snowangel' ? poseValue.imprintX : poseValue.x;
    const shadowY = type === 'snowangel' ? poseValue.imprintGroundY : poseValue.groundY;
    g.globalAlpha = sceneAlpha;
    drawEllipse(shadowX, shadowY + depthScale * .7, 14 * depthScale, 2.2 * depthScale, snowShadow);

    if (type === 'snowman') {
      g.globalAlpha = sceneAlpha * clamp(poseValue.structureAlpha);
      const built = poseValue.build;
      const base = 7.4 * depthScale * built;
      const middle = 5.3 * depthScale * smooth(.18, 1, built);
      const head = 3.7 * depthScale * smooth(.52, 1, built);
      if (base > 0) drawEllipse(poseValue.x, poseValue.groundY - base * .55, base, base * .78, snow);
      if (middle > 0) drawEllipse(poseValue.x, poseValue.groundY - base - middle * .45, middle, middle * .82, snow);
      if (head > 0) {
        const headY = poseValue.groundY - base - middle * 1.35 - head * .45;
        drawEllipse(poseValue.x, headY, head, head, snow);
        if (built > .75) {
          drawEllipse(poseValue.x - head * .33, headY - head * .05, .45 * depthScale, .45 * depthScale, ink);
          drawEllipse(poseValue.x + head * .33, headY - head * .05, .45 * depthScale, .45 * depthScale, ink);
          drawEllipse(poseValue.x + poseValue.direction * head * .92, headY + head * .1, .7 * depthScale, .45 * depthScale, '#d89b68');
        }
      }
      if (poseValue.builderVisible) {
        g.save();
        g.globalAlpha = sceneAlpha * clamp(poseValue.builderAlpha);
        const builderX = poseValue.builderX;
        const builderY = poseValue.builderGroundY;
        const s = poseValue.builderScale;
        drawEllipse(builderX, builderY + .5 * s, 3.4 * s, .9 * s, mixHex(front, '#315d55', .35));
        const headY = builderY - 11 * s;
        drawHead(builderX, headY, 2.1 * s, 2.1 * s, poseValue.seed, skinColor(poseValue.seed), false);
        drawLine(builderX, builderY - 8.9 * s, builderX, builderY - 3.7 * s, color(poseValue.seed), 2.2 * s);
        const reach = 5 * s * smoothValue(.14, .72, poseValue.progress);
        drawLine(builderX, builderY - 7.2 * s, builderX + poseValue.direction * reach, builderY - 7.9 * s, skinColor(poseValue.seed), 1.1 * s);
        drawLine(builderX, builderY - 7.1 * s, builderX - poseValue.direction * 3.2 * s, builderY - 6.1 * s, skinColor(poseValue.seed), 1.1 * s);
        // Full body: both legs remain connected to the torso as the builder
        // walks away from the completed snowman.
        const stride = poseValue.builderLeaving ? Math.sin(tValue * 5 + poseValue.seed * 5) * 1.3 * s : 0;
        drawLine(builderX, builderY - 3.7 * s, builderX - 1.8 * s + stride, builderY, color(poseValue.seed), 1.4 * s);
        drawLine(builderX, builderY - 3.7 * s, builderX + 1.8 * s - stride, builderY, color(poseValue.seed), 1.4 * s);
        g.restore();
      }
    } else if (type === 'skier') {
      const dir = poseValue.direction;
      const sx = poseValue.x, sy = poseValue.groundY;
      // Tracks are placed in world coordinates so they remain on the hill even
      // while the skier rotates with the rendered hillside tangent.
      for (let i = 0; i < 2; i++) {
        const from = sx - dir * (5 + i * 5) * depthScale;
        const to = sx - dir * (17 + i * 5) * depthScale;
        drawLine(from, geometry.middle(from) + poseValue.snowOffset + 1, to, geometry.middle(to) + poseValue.snowOffset + 1, snowShadow, .65 * depthScale);
      }
      // The skis follow the terrain exactly. A small lean is applied only to
      // the skier's body so the boards stay level against the snow.
      g.save();
      g.translate(sx, sy);
      g.rotate(poseValue.angle);
      g.scale(dir * depthScale, depthScale);
      drawLine(-7, 1, 7, 1, snowShadow, 1.1);
      drawLine(-7, 2.2, 7, 2.2, ink, .8);
      g.restore();
      g.save();
      g.translate(sx, sy);
      g.rotate(poseValue.angle + poseValue.lean);
      g.scale(dir * depthScale, depthScale);
      drawLine(-1, -1, -4, -7, ink, 1.5);
      drawLine(1, -1, 4, -7, ink, 1.5);
      drawLine(0, -7, -4, -7, ink, 1.5);
      drawLine(0, -7, 4, -7, ink, 1.5);
      drawLine(0, -7, 1, -14, color(poseValue.seed), 2.8);
      drawHead(2, -16, 2, 2, poseValue.seed, skinColor(poseValue.seed), true);
      drawEllipse(2, -17, 2.2, 1.2, color(poseValue.seed));
      drawLine(0, -11, -6, -7, skinColor(poseValue.seed), 1.1);
      drawLine(1, -11, 7, -7, skinColor(poseValue.seed), 1.1);
      drawLine(-6, -7, -10, 1, ink, .7);
      drawLine(7, -7, 11, 1, ink, .7);
      g.restore();
    } else {
      const dir = poseValue.direction, s = depthScale;
      // Leave the imprint behind at its activity anchor while the person
      // transitions from lying to standing and then walks away.
      g.globalAlpha = sceneAlpha * clamp(poseValue.imprintAlpha);
      const imprintWidth = (13 + 8 * poseValue.imprint) * s;
      const imprintHeight = (1.6 + 1.2 * poseValue.imprint) * s;
      drawEllipse(poseValue.imprintX, poseValue.imprintGroundY + .4 * s, imprintWidth, imprintHeight, mixHex(snow, '#9cbac2', .25));

      if (poseValue.lyingAlpha > 0) {
        g.save();
        g.globalAlpha = sceneAlpha * clamp(poseValue.lyingAlpha);
        const bodyY = poseValue.groundY - 2 * s;
        const arm = poseValue.armSweep * 8 * s;
        const leg = (poseValue.legSweep * 5 - 2.5) * s;
        drawEllipse(poseValue.x, bodyY, 7 * s, 2 * s, color(poseValue.seed));
        drawHead(poseValue.x + dir * 8 * s, bodyY - 1 * s, 2 * s, 2 * s, poseValue.seed, skinColor(poseValue.seed), false);
        drawLine(poseValue.x - dir * 3 * s, bodyY, poseValue.x - dir * 8 * s, bodyY - arm, snowShadow, 1.4 * s);
        drawLine(poseValue.x + dir * 3 * s, bodyY, poseValue.x + dir * 8 * s, bodyY - arm * .7, snowShadow, 1.4 * s);
        drawLine(poseValue.x - dir * 3 * s, bodyY + 1 * s, poseValue.x - dir * (7 + leg) * s, bodyY + 3 * s, snowShadow, 1.4 * s);
        drawLine(poseValue.x + dir * 3 * s, bodyY + 1 * s, poseValue.x + dir * (7 - leg) * s, bodyY + 3 * s, snowShadow, 1.4 * s);
        g.restore();
      }
      if (poseValue.standingAlpha > 0) {
        g.save();
        g.globalAlpha = sceneAlpha * clamp(poseValue.standingAlpha);
        g.translate(poseValue.x, poseValue.groundY);
        g.rotate(poseValue.angle);
        g.scale(dir * s, s);
        drawEllipse(0, 1, 4.2, 1.2, mixHex(front, hill, .5));
        drawHead(0, -12, 2, 2, poseValue.seed, skinColor(poseValue.seed), false);
        drawLine(0, -9, 0, -4, color(poseValue.seed), 2.7);
        const stride = 2 + Math.sin(tValue * 4 + poseValue.seed * 5) * 2 * poseValue.walkAmount;
        drawLine(0, -4, -stride, 0, ink, 1.3);
        drawLine(0, -4, 3 + stride, 0, ink, 1.3);
        drawLine(0, -8, 5, -6, skinColor(poseValue.seed), 1.1);
        g.restore();
      }
    }
    g.restore();
    return true;
  }

  root.LandscapeWinter = Object.freeze({ types: TYPES, pose, paint });
})(globalThis);
