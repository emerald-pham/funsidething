#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { resolveExpectedFirstRunHelp } from '../browser-fixture-setup.mjs';

const SURFACES = [
  { name: 'faq-title', selector: '#modalRoot #faqsTitle' },
  { name: 'faq-section', selector: '#modalRoot details.help-faq > summary' },
  { name: 'faq-question', selector: '#modalRoot details.help-faq dt' },
  { name: 'faq-answer', selector: '#modalRoot details.help-faq dd' },
  { name: 'faq-list-item', selector: '#modalRoot .help li' },
  { name: 'faq-paragraph', selector: '#modalRoot .help p' },
  { name: 'faq-subheading', selector: '#modalRoot .help details:not([data-help-changelog]) > h3, #modalRoot .help [data-changelog-notes] h3, #modalRoot .help [data-changelog-notes] h4' },
];

const MECHANISMS = ['diagnostic-css', 'native-page-zoom', 'pinch-zoom'];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const renderedEvidenceSurfaces = Object.freeze(SURFACES.map((surface) => Object.freeze({ ...surface })));

function usage() {
  return `Usage: node scripts/agent-tools/rendered-evidence.mjs \\
  --url <local-app-url> --output <new-case-directory> \\
  --playwright-module <absolute-module-path> --source-id <commit-or-artifact-id> \\
  --mechanism diagnostic-css|native-page-zoom|pinch-zoom \\
  --theme light|dark [--width css-pixels] [--height css-pixels] [--scale factor] \\
  [--timeout-ms milliseconds] [--headless true|false] [--browser-executable <path>]`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (Object.hasOwn(options, key)) throw new Error(`Option --${key} was provided more than once.`);
    options[key] = value;
    index += 1;
  }
  const allowed = new Set(['url', 'output', 'playwright-module', 'source-id', 'mechanism', 'theme', 'width', 'height', 'scale', 'timeout-ms', 'headless', 'browser-executable']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`Unknown option --${key}`);
  for (const key of ['url', 'output', 'playwright-module', 'source-id', 'mechanism', 'theme']) {
    if (!options[key]?.trim()) throw new Error(`Missing required option --${key}`);
  }
  return options;
}

function parseOptions(options) {
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--url must use HTTP or HTTPS.');
  if (url.username || url.password) throw new Error('--url must not contain credentials.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('--url must point to a local loopback app so the capture cannot touch a live account or production service.');
  if (!MECHANISMS.includes(options.mechanism)) throw new Error(`--mechanism must be one of ${MECHANISMS.join(', ')}.`);
  if (!['light', 'dark'].includes(options.theme)) throw new Error('--theme must be light or dark.');
  const width = Number(options.width ?? 390);
  const height = Number(options.height ?? 844);
  const scale = Number(options.scale ?? 1.5);
  const timeoutMs = Number(options['timeout-ms'] ?? 15000);
  if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error('--width must be an integer from 320 to 3840 CSS pixels.');
  if (!Number.isInteger(height) || height < 320 || height > 3840) throw new Error('--height must be an integer from 320 to 3840 CSS pixels.');
  if (!Number.isFinite(scale) || scale <= 1 || scale > 4) throw new Error('--scale must be greater than 1 and no greater than 4.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('--timeout-ms must be an integer from 1000 to 120000.');
  if (options.headless !== undefined && !['true', 'false'].includes(options.headless)) throw new Error('--headless must be true or false.');
  return {
    url,
    outputDirectory: resolve(options.output),
    playwrightModule: resolve(options['playwright-module']),
    sourceIdentity: options['source-id'].trim(),
    mechanism: options.mechanism,
    theme: options.theme,
    width,
    height,
    scale,
    timeoutMs,
    headless: options.headless !== 'false',
    browserExecutable: options['browser-executable'] ? resolve(options['browser-executable']) : undefined,
  };
}

function caseIdentifier(options) {
  return `${options.mechanism}-${options.theme}-${options.width}x${options.height}`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function verifyRenderedScreenshotBytes(screenshot, bytes) {
  if (!screenshot || typeof screenshot.sha256 !== 'string' || !Buffer.isBuffer(bytes)) {
    return { status: 'unverified', matches: false, expectedSha256: screenshot?.sha256 ?? null, actualSha256: null, reason: 'A screenshot SHA-256 and actual PNG bytes are required.' };
  }
  const actualSha256 = sha256(bytes);
  return {
    status: actualSha256 === screenshot.sha256 ? 'pass' : 'fail',
    matches: actualSha256 === screenshot.sha256,
    expectedSha256: screenshot.sha256,
    actualSha256,
    reason: actualSha256 === screenshot.sha256 ? null : 'PNG bytes do not match the screenshot captured for this report.',
  };
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return String(value).slice(0, 500);
  }
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Screenshot is not a complete PNG image.');
  let offset = 8;
  let header;
  let ended = false;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error('Screenshot PNG has a truncated chunk.');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const recordedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (pngCrc32(Buffer.concat([buffer.subarray(offset + 4, offset + 8), data])) !== recordedCrc) throw new Error(`Screenshot PNG has a bad ${type} chunk checksum.`);
    if (offset === 8 && type !== 'IHDR') throw new Error('Screenshot PNG does not start with its required image header.');
    if (type === 'IHDR') {
      if (header) throw new Error('Screenshot PNG has duplicate image headers.');
      header = data;
    }
    if (type === 'IDAT') imageData.push(data);
    offset = end;
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Screenshot PNG has an invalid image terminator.');
      ended = true;
      break;
    }
  }
  if (!ended || offset !== buffer.length) throw new Error('Screenshot PNG is missing a clean image terminator.');
  if (!header || header.length !== 13 || !imageData.length) throw new Error('Screenshot PNG has no image header or pixel data.');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const compression = header[10];
  const filterMethod = header[11];
  const interlace = header[12];
  if (!width || !height || width * height > 20000000) throw new Error('Screenshot PNG dimensions are empty or exceed the 20-megapixel inspection limit.');
  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (bitDepth !== 8 || !channels || compression !== 0 || filterMethod !== 0 || interlace !== 0) return { width, height, supported: false, nonBlank: null, uniqueColorCount: null, opaquePixelCount: null };

  const packed = inflateSync(Buffer.concat(imageData));
  const rowBytes = width * channels;
  if (packed.length !== height * (rowBytes + 1)) throw new Error('Screenshot PNG pixel data does not match its declared dimensions.');
  const pixels = new Uint8Array(height * rowBytes);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = packed[inputOffset];
    inputOffset += 1;
    const rowOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = packed[inputOffset + x];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[rowOffset - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset - rowBytes + x - channels] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else throw new Error(`Screenshot PNG uses unknown row filter ${filter}.`);
      pixels[rowOffset + x] = (raw + predictor) & 255;
    }
    inputOffset += rowBytes;
  }

  let opaquePixelCount = 0;
  const colors = new Set();
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + x * channels;
      let red;
      let green;
      let blue;
      let alpha = 255;
      if (colorType === 0) [red, green, blue] = [pixels[pixelOffset], pixels[pixelOffset], pixels[pixelOffset]];
      else if (colorType === 2) [red, green, blue] = [pixels[pixelOffset], pixels[pixelOffset + 1], pixels[pixelOffset + 2]];
      else if (colorType === 4) {
        [red, green, blue] = [pixels[pixelOffset], pixels[pixelOffset], pixels[pixelOffset]];
        alpha = pixels[pixelOffset + 1];
      } else {
        [red, green, blue, alpha] = [pixels[pixelOffset], pixels[pixelOffset + 1], pixels[pixelOffset + 2], pixels[pixelOffset + 3]];
      }
      if (alpha > 0) opaquePixelCount += 1;
      if (colors.size <= 8) colors.add(`${red},${green},${blue},${alpha}`);
    }
  }
  return { width, height, supported: true, nonBlank: opaquePixelCount > 0 && colors.size > 1, uniqueColorCount: colors.size, opaquePixelCount };
}

function validateSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) throw new TypeError('At least one named rendered surface is required.');
  const names = new Set();
  return surfaces.map((surface) => {
    if (!surface || typeof surface.name !== 'string' || !surface.name.trim() || typeof surface.selector !== 'string' || !surface.selector.trim()) {
      throw new TypeError('Every rendered surface needs a non-empty name and selector.');
    }
    if (names.has(surface.name)) throw new TypeError(`Rendered surface name ${surface.name} was supplied more than once.`);
    names.add(surface.name);
    return {
      name: surface.name,
      selector: surface.selector,
      role: typeof surface.role === 'string' && surface.role.trim() ? surface.role : 'text-surface',
      relationship: typeof surface.relationship === 'string' && surface.relationship.trim() ? surface.relationship : null,
    };
  });
}

async function observePage(page, surfaces = SURFACES) {
  return page.evaluate((surfaces) => {
    const root = document.documentElement;
    const body = document.body;
    const modal = document.querySelector('#modalRoot .modal');
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(body);
    const modalStyle = modal ? getComputedStyle(modal) : null;
    return {
      viewportCss: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
      devicePixelRatio: window.devicePixelRatio,
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
      } : null,
      theme: {
        attribute: root.getAttribute('data-theme'),
        colorScheme: rootStyle.colorScheme,
        documentBackground: rootStyle.backgroundColor,
        documentColor: rootStyle.color,
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        modalBackground: modalStyle?.backgroundColor ?? null,
        modalColor: modalStyle?.color ?? null,
      },
      documentFontsStatus: document.fonts?.status ?? 'unsupported',
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content ?? null,
      surfaces: surfaces.map(({ name, selector }) => {
        const elements = [...document.querySelectorAll(selector)];
        const uniquePathFor = (element) => {
          const path = [];
          let current = element;
          while (current?.nodeType === 1) {
            if (current.id) {
              path.unshift(`#${CSS.escape(current.id)}`);
              break;
            }
            const parent = current.parentElement;
            if (!parent) {
              path.unshift(current.localName);
              break;
            }
            const sameTagSiblings = [...parent.children].filter((sibling) => sibling.localName === current.localName);
            path.unshift(`${current.localName}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
            current = parent;
          }
          return path.join(' > ');
        };
        return {
          name,
          selector,
          count: elements.length,
          elements: elements.map((element, index) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const lineHeight = Number.parseFloat(style.lineHeight);
            return {
              index,
              selectorPath: uniquePathFor(element),
              fontSizePx: Number.parseFloat(style.fontSize),
              lineHeightPx: Number.isFinite(lineHeight) ? lineHeight : null,
              fontFamilyCss: style.fontFamily,
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              documentFontAvailable: document.fonts?.check(`${style.fontSize} ${style.fontFamily}`) ?? null,
            };
          }),
        };
      }),
    };
  }, surfaces);
}

async function waitForDocumentFonts(page, timeoutMs) {
  const boundedTimeout = Math.min(timeoutMs, 5000);
  return page.evaluate((timeout) => new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(false), timeout);
    Promise.resolve(document.fonts?.ready).then(() => {
      window.clearTimeout(timeoutId);
      resolve(true);
    });
  }), boundedTimeout);
}

async function captureResolvedFonts(page, surfaces = SURFACES) {
  const result = { status: 'unavailable', bySurface: [], reason: null };
  let session;
  try {
    session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: -1 });
    for (const surface of surfaces) {
      const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: surface.selector });
      if (!nodeIds?.length) {
        result.bySurface.push({ name: surface.name, elementCount: 0, sampledElementCount: 0, truncated: false, elements: [] });
        continue;
      }
      const elements = [];
      for (const [index, nodeId] of nodeIds.slice(0, 20).entries()) {
        const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
        elements.push({
          index,
          fonts: (fonts ?? []).map((font) => ({
            familyName: font.familyName,
            postScriptName: font.postScriptName,
            isCustomFont: font.isCustomFont,
            glyphCount: font.glyphCount,
          })),
        });
      }
      result.bySurface.push({ name: surface.name, elementCount: nodeIds.length, sampledElementCount: elements.length, truncated: nodeIds.length > elements.length, elements });
    }
    result.status = 'captured';
  } catch (error) {
    result.reason = error instanceof Error ? error.message : String(error);
  } finally {
    await session?.detach().catch(() => undefined);
  }
  return result;
}

export function compareRenderedSurfaces(before, after, mechanism, surfaces = SURFACES) {
  const namedSurfaces = validateSurfaces(surfaces);
  return namedSurfaces.map(({ name, selector, role, relationship }) => {
    const reference = before?.surfaces?.find((surface) => surface.name === name);
    const capture = after?.surfaces?.find((surface) => surface.name === name);
    const beforeElements = reference?.elements ?? [];
    const afterElements = capture?.elements ?? [];
    const matched = beforeElements.length > 0 && beforeElements.length === afterElements.length;
    const measurementsPresent = matched
      && beforeElements.every((metric) => Number.isFinite(metric.fontSizePx) && (Number.isFinite(metric.lineHeightPx) || Number.isFinite(metric.bounds?.height)))
      && afterElements.every((metric) => Number.isFinite(metric.fontSizePx) && (Number.isFinite(metric.lineHeightPx) || Number.isFinite(metric.bounds?.height)));
    const elements = beforeElements.map((metric, index) => {
      const observed = afterElements[index] ?? null;
      const fontIncreased = Number.isFinite(metric.fontSizePx) && Number.isFinite(observed?.fontSizePx) && observed.fontSizePx > metric.fontSizePx + 0.01;
      const lineHeightIncreased = Number.isFinite(metric.lineHeightPx) && Number.isFinite(observed?.lineHeightPx) && observed.lineHeightPx > metric.lineHeightPx + 0.01;
      const boundsIncreased = Number.isFinite(metric.bounds?.height) && Number.isFinite(observed?.bounds?.height) && observed.bounds.height > metric.bounds.height + 0.01;
      return {
        before: metric,
        after: observed,
        changes: { fontSizeIncreased: fontIncreased, lineHeightIncreased, boundsHeightIncreased: boundsIncreased },
        metricsStatus: mechanism !== 'diagnostic-css' ? 'observed-only' : fontIncreased && (lineHeightIncreased || boundsIncreased) ? 'pass' : 'fail',
      };
    });
    const passed = measurementsPresent && elements.length === beforeElements.length && (mechanism !== 'diagnostic-css' || elements.every((element) => element.metricsStatus === 'pass'));
    return {
      name,
      selector,
      role,
      relationship,
      beforeCount: beforeElements.length,
      afterCount: afterElements.length,
      elements,
      metricsStatus: !measurementsPresent ? 'fail' : mechanism === 'diagnostic-css' ? passed ? 'pass' : 'fail' : 'observed-only',
      reason: !matched ? 'Surface was missing or its element count changed between the reference and capture.' : !measurementsPresent ? 'At least one surface element is missing a finite font-size, line-height or box-height measurement.' : mechanism === 'diagnostic-css' && !passed ? 'At least one text element did not increase both font size and a measured line or box metric.' : null,
    };
  });
}

function startCaptureObservation({ surfaces, maximumDurationMs, maximumSamples }) {
  const root = document.documentElement;
  const existing = window.__renderedEvidenceCaptureObservation;
  if (existing) return { started: false, reason: 'A rendered capture observation is already active.' };

  const startedAt = performance.now();
  const samples = [];
  const mutations = [];
  const paintTransitions = [];
  const observers = [];
  let frameId = null;
  let stopTimer = null;
  let stopped = false;
  let complete = true;
  let overflow = false;
  let previousPaint = null;
  let previousSample = null;
  let frameSamples = 0;

  const paintSnapshot = () => {
    const body = document.body;
    const modal = document.querySelector('#modalRoot .modal');
    const styleFor = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
      };
    };
    return {
      theme: {
        attribute: root.getAttribute('data-theme'),
        colorScheme: getComputedStyle(root).colorScheme,
        document: styleFor(root),
        body: styleFor(body),
        modal: styleFor(modal),
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? null,
      },
      surfaces: surfaces.map(({ name, selector }) => {
        let elements = [];
        try { elements = [...document.querySelectorAll(selector)]; } catch { /* selector validation is reported by the main observation */ }
        return {
          name,
          count: elements.length,
          paints: elements.map((element) => {
            const style = getComputedStyle(element);
            return {
              color: style.color,
              backgroundColor: style.backgroundColor,
              borderColor: style.borderColor,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
            };
          }),
        };
      }),
    };
  };

  const record = (source, details = null) => {
    if (samples.length >= maximumSamples) {
      overflow = true;
      complete = false;
      stopped = true;
      return;
    }
    const now = performance.now();
    if (now - startedAt > maximumDurationMs) {
      complete = false;
      stopped = true;
      return;
    }
    const paint = paintSnapshot();
    const signature = JSON.stringify(paint);
    if (previousPaint !== null && previousPaint !== signature) {
      paintTransitions.push({ sampleIndex: samples.length, source, before: JSON.parse(previousPaint), after: paint });
    }
    previousPaint = signature;
    previousSample = paint;
    samples.push({ elapsedMs: Number((now - startedAt).toFixed(2)), source, paint, details });
  };

  record('capture-start');
  const onRelevantMutations = (records) => {
    const relevant = records.map((item) => ({
      type: item.type,
      attributeName: item.attributeName ?? null,
      oldValue: item.oldValue ?? null,
      target: item.target?.id ? `#${item.target.id}` : item.target?.nodeName ?? null,
      currentValue: item.attributeName && item.target?.getAttribute ? item.target.getAttribute(item.attributeName) : null,
    }));
    const remainingMutations = Math.max(0, maximumSamples - mutations.length);
    mutations.push(...relevant.slice(0, remainingMutations));
    if (relevant.length > remainingMutations) {
      overflow = true;
      complete = false;
      stopped = true;
    }
    record('mutation', relevant);
    if (mutations.length >= maximumSamples) {
      overflow = true;
      complete = false;
      stopped = true;
    }
  };
  const nodeOptions = new Map();
  const markNode = (node, options) => {
    if (!node) return;
    const current = nodeOptions.get(node) ?? { attributes: false, childList: false, characterData: false, subtree: false, attributeOldValue: false, attributeFilter: new Set() };
    current.attributes ||= options.attributes === true;
    current.childList ||= options.childList === true;
    current.characterData ||= options.characterData === true;
    current.subtree ||= options.subtree === true;
    current.attributeOldValue ||= options.attributeOldValue === true;
    for (const name of options.attributeFilter ?? []) current.attributeFilter.add(name);
    nodeOptions.set(node, current);
  };
  const themeAttributes = ['data-theme', 'style', 'class'];
  const surfaceAttributes = ['data-theme', 'style', 'class', 'hidden', 'aria-hidden', 'open', 'src', 'srcset', 'href'];
  markNode(root, { attributes: true, attributeOldValue: true, attributeFilter: themeAttributes });
  markNode(document.body, { attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
  markNode(document.head, { attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'href', 'rel', 'disabled', 'media'], childList: true, characterData: true, subtree: true });
  for (const { selector } of surfaces) {
    let elements = [];
    try { elements = [...document.querySelectorAll(selector)]; } catch { /* the main observation reports invalid or missing target selectors */ }
    for (const element of elements) {
      let ancestor = element;
      while (ancestor?.nodeType === 1) {
        markNode(ancestor, { attributes: true, attributeOldValue: true, attributeFilter: surfaceAttributes });
        ancestor = ancestor.parentElement;
      }
      markNode(element, { attributes: true, attributeOldValue: true, attributeFilter: surfaceAttributes, childList: true, characterData: true, subtree: true });
      markNode(element.parentElement, { childList: true });
    }
  }
  for (const [node, options] of nodeOptions) {
    const observer = new MutationObserver(onRelevantMutations);
    const { attributeFilter, ...observeOptions } = options;
    if (attributeFilter.size > 0) observeOptions.attributeFilter = [...attributeFilter];
    observer.observe(node, observeOptions);
    observers.push(observer);
  }
  const frame = () => {
    if (stopped) return;
    frameSamples += 1;
    record('animation-frame');
    if (!stopped) frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);
  stopTimer = window.setTimeout(() => {
    complete = false;
    stopped = true;
  }, maximumDurationMs);

  window.__renderedEvidenceCaptureObservation = {
    stop() {
      for (const observer of observers) {
        const pendingMutations = observer.takeRecords();
        if (pendingMutations.length > 0) onRelevantMutations(pendingMutations);
        observer.disconnect();
      }
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (stopTimer !== null) clearTimeout(stopTimer);
      stopped = true;
      const endedAt = performance.now();
      const finalPaint = paintSnapshot();
      const finalSignature = JSON.stringify(finalPaint);
      if (previousPaint !== null && previousPaint !== finalSignature) paintTransitions.push({ sampleIndex: samples.length, source: 'capture-stop', before: previousSample, after: finalPaint });
      const samplingPresent = frameSamples > 0;
      return {
        complete,
        stable: complete && samplingPresent && !overflow && mutations.length === 0 && paintTransitions.length === 0,
        overflow,
        samplingPresent,
        durationMs: Number((endedAt - startedAt).toFixed(2)),
        frameSamples,
        samples,
        mutations,
        paintTransitions,
        finalPaint,
        observationLimit: 'The monitor records DOM mutations and animation-frame computed paint. It cannot attest that compositor or native screenshot bytes are an atomic rendering of one sampled frame, and it cannot cryptographically attest browser-provider honesty.',
      };
    },
  };
  return { started: true, initialPaint: previousSample };
}

function stopCaptureObservation() {
  const active = window.__renderedEvidenceCaptureObservation;
  if (!active) return { complete: false, stable: false, reason: 'The capture observation did not start.' };
  const result = active.stop();
  delete window.__renderedEvidenceCaptureObservation;
  return result;
}

function makeDiagnosticCss(reference, scale) {
  const rules = [];
  const rulesBySurface = {};
  for (const surface of reference?.surfaces ?? []) {
    rulesBySurface[surface.name] = 0;
    for (const metric of surface.elements ?? []) {
      if (!Number.isFinite(metric.fontSizePx) || metric.fontSizePx <= 0 || typeof metric.selectorPath !== 'string' || !metric.selectorPath) continue;
      const targetSizePx = metric.fontSizePx * scale;
      rules.push(`/* rendered-evidence surface=${surface.name} index=${metric.index} baseline=${metric.fontSizePx} target=${targetSizePx} */\n${metric.selectorPath} { font-size: ${targetSizePx.toFixed(4)}px !important; }`);
      rulesBySurface[surface.name] += 1;
    }
  }
  return { content: rules.join('\n'), rulesBySurface, ruleCount: rules.length };
}

async function prepareApp(page, options) {
  await page.waitForSelector('#addButton', { state: 'visible' });
  const motionChoice = page.locator('#motionDialog [data-landscape-motion="normal"]');
  if (await motionChoice.isVisible()) await motionChoice.click();
  await resolveExpectedFirstRunHelp(page);

  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const taskLabels = [`Rendered evidence ${nonce} alpha`, `Rendered evidence ${nonce} beta`];
  const titleInput = page.locator('#addInput');
  const addButton = page.locator('#addButton');
  for (const label of taskLabels) {
    await titleInput.fill(label);
    await addButton.click();
    const acknowledgementDeadline = Date.now() + options.timeoutMs;
    // The native Add form clears only after its durable save acknowledges.
    while ((await titleInput.inputValue()) !== '' && Date.now() < acknowledgementDeadline) {
      await page.waitForTimeout(25);
    }
    if ((await titleInput.inputValue()) !== '') throw new Error('The app did not clear the synthetic task title after its native Add control was used.');
  }

  const themeButton = page.locator('#themeBtn');
  await themeButton.scrollIntoViewIfNeeded();
  let themeControlActions = 0;
  const inspectTheme = () => observePage(page);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const themeSnapshot = await inspectTheme();
    if (themeSchemeMatches(themeSnapshot, options.theme)) break;
    await themeButton.click();
    themeControlActions += 1;
    await page.waitForTimeout(50);
  }
  const requestedThemeSnapshot = await inspectTheme();
  const alternateTheme = options.theme === 'light' ? 'dark' : 'light';
  let alternateThemeSnapshot = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await themeButton.click();
    themeControlActions += 1;
    await page.waitForTimeout(80);
    const candidate = await inspectTheme();
    if (themeSchemeMatches(candidate, alternateTheme)) {
      alternateThemeSnapshot = candidate;
      break;
    }
  }
  let restoredThemeSnapshot = await inspectTheme();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (themeSchemeMatches(restoredThemeSnapshot, options.theme)) break;
    await themeButton.click();
    themeControlActions += 1;
    await page.waitForTimeout(80);
    restoredThemeSnapshot = await inspectTheme();
  }
  const themePaintAudit = {
    requested: requestedThemeSnapshot.theme,
    alternate: alternateThemeSnapshot?.theme ?? null,
    restored: restoredThemeSnapshot.theme,
    alternateColorSchemeObserved: alternateThemeSnapshot?.theme?.colorScheme ?? null,
    paintChanged: alternateThemeSnapshot !== null && ['documentBackground', 'documentColor', 'bodyBackground', 'bodyColor'].some((key) => requestedThemeSnapshot.theme[key] !== alternateThemeSnapshot.theme[key]),
    requestedPaintRestored: ['documentBackground', 'documentColor', 'bodyBackground', 'bodyColor'].every((key) => requestedThemeSnapshot.theme[key] === restoredThemeSnapshot.theme[key]),
  };
  await page.evaluate(() => window.scrollTo(0, 0));

  const helpButton = page.locator('button[aria-label="FAQs / Changelog"]');
  if (await helpButton.count() !== 1) throw new Error('The native FAQs / Changelog control was not uniquely available.');
  await helpButton.click();
  await page.waitForSelector('#modalRoot #faqsTitle', { state: 'visible' });
  const title = (await page.locator('#modalRoot #faqsTitle').innerText()).trim();
  if (title !== 'FAQs / Changelog') throw new Error(`Unexpected help panel title: ${title || 'empty'}`);
  for (let count = 0; count < 100; count += 1) {
    const closedSections = page.locator('#modalRoot details.help-faq:not([open]) > summary');
    if (await closedSections.count() === 0) break;
    await closedSections.first().click();
  }
  if (await page.locator('#modalRoot details.help-faq:not([open]) > summary').count() !== 0) throw new Error('Could not expand every FAQ reference through its native summary controls.');
  const themeSnapshot = await observePage(page);

  return {
    syntheticBoard: { kind: 'fresh in-memory profile', taskCount: taskLabels.length, taskLabels },
    uiActions: { motionChoice: 'normal', taskAdditions: taskLabels.length, theme: options.theme, themeControlActions, help: 'opened through the FAQs / Changelog control', expandedFaqSections: true },
    themePaintAudit,
    themeMatched: themeMatches(themeSnapshot, options.theme)
      && themeSchemeMatches(requestedThemeSnapshot, options.theme)
      && themeSchemeMatches(restoredThemeSnapshot, options.theme)
      && alternateThemeSnapshot !== null
      && themeSchemeMatches(alternateThemeSnapshot, alternateTheme)
      && themePaintAudit.paintChanged
      && themePaintAudit.requestedPaintRestored,
  };
}

async function performMechanism(page, context, options, before, result) {
  if (options.mechanism === 'diagnostic-css') {
    const diagnosticCss = makeDiagnosticCss(before, options.scale);
    await page.addStyleTag({ content: diagnosticCss.content });
    result.operations.push({ type: 'diagnostic-css', requestedScale: options.scale, target: 'every named FAQ text element', rulesBySurface: diagnosticCss.rulesBySurface, ruleCount: diagnosticCss.ruleCount });
    return;
  }
  if (options.mechanism === 'native-page-zoom') {
    const key = process.platform === 'darwin' ? 'Meta+Shift+Equal' : 'Control+Shift+Equal';
    let steps = 0;
    let noChangeCount = 0;
    let current = before;
    while (steps < 8 && current.devicePixelRatio / before.devicePixelRatio < options.scale) {
      await page.keyboard.press(key);
      steps += 1;
      await page.waitForTimeout(120);
      current = await observePage(page);
      const changed = current.devicePixelRatio !== before.devicePixelRatio || current.viewportCss.innerWidth !== before.viewportCss.innerWidth || current.viewportCss.innerHeight !== before.viewportCss.innerHeight;
      noChangeCount = changed ? 0 : noChangeCount + 1;
      if (noChangeCount >= 2) break;
    }
    result.operations.push({ type: 'native browser page zoom keyboard shortcut', key, attemptedSteps: steps, requestedScale: options.scale });
    return;
  }
  if (options.mechanism === 'pinch-zoom') {
    let session;
    try {
      session = await context.newCDPSession(page);
      await session.send('Input.synthesizePinchGesture', {
        x: Math.round(options.width / 2),
        y: Math.round(options.height / 2),
        scaleFactor: options.scale,
        speed: 500,
        gestureSourceType: 'touch',
      });
      await page.waitForTimeout(150);
      result.operations.push({ type: 'Chromium Input.synthesizePinchGesture', requestedScale: options.scale, gestureSourceType: 'touch' });
    } catch (error) {
      result.operations.push({ type: 'Chromium Input.synthesizePinchGesture', requestedScale: options.scale, supported: false, error: error instanceof Error ? error.message : String(error) });
      result.coverageLimits.push('This browser runtime could not execute a pinch gesture; the mechanism remains unverified.');
    } finally {
      await session?.detach().catch(() => undefined);
    }
  }
}

async function pngScreenshot(page, outputDirectory, fileName, expectedDimensions, timeoutMs) {
  const path = resolve(outputDirectory, fileName);
  const bytes = Buffer.from(await page.screenshot({ fullPage: false, scale: 'css', animations: 'disabled', timeout: timeoutMs }));
  let info;
  let integrityStatus = 'pass';
  let failure = null;
  try {
    info = inspectPng(bytes);
    if (!info.supported) {
      integrityStatus = 'unverified';
      failure = 'PNG pixel format is unsupported for blank-capture inspection.';
    } else if (!info.nonBlank) {
      integrityStatus = 'fail';
      failure = 'Screenshot is blank or fully transparent.';
    }
  } catch (error) {
    integrityStatus = 'fail';
    failure = error instanceof Error ? error.message : String(error);
  }
  if (info && !expectedDimensions.includes(`${info.width}x${info.height}`)) {
    integrityStatus = 'fail';
    failure = `Screenshot dimensions ${info.width}x${info.height} do not match any measured viewport for this capture: ${expectedDimensions.join(', ')}.`;
  }
  await writeAtomicallyWithoutOverwrite(path, bytes);
  const savedBytes = await readFile(path);
  const savedBinding = verifyRenderedScreenshotBytes({ sha256: sha256(bytes) }, savedBytes);
  const savedSha256 = savedBinding.actualSha256;
  const fileBindingMatches = savedBinding.matches;
  if (!fileBindingMatches) {
    integrityStatus = 'fail';
    failure = 'Saved screenshot bytes do not match the bytes returned by the browser capture.';
  }
  return {
    path: fileName,
    sha256: sha256(bytes),
    savedSha256,
    fileBindingMatches,
    width: info?.width ?? null,
    height: info?.height ?? null,
    nonBlank: info?.nonBlank ?? null,
    uniqueColorCount: info?.uniqueColorCount ?? null,
    opaquePixelCount: info?.opaquePixelCount ?? null,
    integrityStatus,
    failure,
  };
}

export async function captureRenderedState(page, {
  lifecycleState,
  expectedTheme,
  expectedViewport = null,
  mechanism = 'diagnostic-css',
  baseViewport = expectedViewport,
  scale = 1,
  surfaces = SURFACES,
  outputDirectory,
  fileName,
  timeoutMs = 5000,
}) {
  if (typeof lifecycleState !== 'string' || !lifecycleState.trim()) throw new TypeError('A capture lifecycleState is required.');
  if (!['light', 'dark'].includes(expectedTheme)) throw new TypeError('A capture expectedTheme must be light or dark.');
  if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('A capture scale must be a positive number.');
  if (!outputDirectory || !fileName) throw new TypeError('A capture outputDirectory and fileName are required.');
  const namedSurfaces = validateSurfaces(surfaces);

  const documentFontsReady = await waitForDocumentFonts(page, timeoutMs);
  const beforeScreenshot = await observePage(page, namedSurfaces);
  const acceptedScreenshotDimensions = new Set();
  if (baseViewport?.width && baseViewport?.height) acceptedScreenshotDimensions.add(`${baseViewport.width}x${baseViewport.height}`);
  if (mechanism === 'native-page-zoom') acceptedScreenshotDimensions.add(`${beforeScreenshot.viewportCss.innerWidth}x${beforeScreenshot.viewportCss.innerHeight}`);
  else if (!expectedViewport) acceptedScreenshotDimensions.add(`${beforeScreenshot.viewportCss.innerWidth}x${beforeScreenshot.viewportCss.innerHeight}`);
  const observationWindowMs = Math.max(500, Math.min(timeoutMs, 5000));
  const observerStart = await page.evaluate(startCaptureObservation, {
    surfaces: namedSurfaces.map(({ name, selector }) => ({ name, selector })),
    maximumDurationMs: observationWindowMs,
    maximumSamples: 240,
  });
  let screenshot;
  let captureObservation;
  try {
    if (!observerStart?.started) throw new Error(observerStart?.reason ?? 'The bounded capture observation could not start.');
    screenshot = await pngScreenshot(page, outputDirectory, fileName, [...acceptedScreenshotDimensions], observationWindowMs);
  } finally {
    captureObservation = await page.evaluate(stopCaptureObservation);
  }
  const afterScreenshot = await observePage(page, namedSurfaces);
  const resolvedFonts = await captureResolvedFonts(page, namedSurfaces);
  const paintSnapshots = [
    observerStart?.initialPaint,
    ...(captureObservation?.samples ?? []).map((sample) => sample.paint),
    captureObservation?.finalPaint,
  ].filter(Boolean);
  const themeStable = captureObservation?.stable === true
    && (captureObservation?.paintTransitions?.length ?? 0) === 0
    && (captureObservation?.mutations ?? []).every((mutation) => !['data-theme', 'style', 'class', 'color-scheme'].includes(mutation.attributeName));
  const mutationThemeMatched = (captureObservation?.mutations ?? []).every((mutation) =>
    mutation.attributeName !== 'data-theme' || [mutation.oldValue, mutation.currentValue].every((value) => value === expectedTheme));
  const themeMatched = mutationThemeMatched
    && [beforeScreenshot, afterScreenshot].every((snapshot) => themeMatches(snapshot, expectedTheme))
    && paintSnapshots.every((snapshot) => snapshot.theme.attribute === expectedTheme && snapshot.theme.colorScheme === expectedTheme);
  const observedViewports = [beforeScreenshot, afterScreenshot].map((snapshot) => snapshot.viewportCss)
    .concat(paintSnapshots.map((snapshot) => ({ innerWidth: snapshot.viewport.width, innerHeight: snapshot.viewport.height })));
  const viewportMatched = !expectedViewport || observedViewports.every((viewport) =>
    viewport.innerWidth === expectedViewport.width && viewport.innerHeight === expectedViewport.height);
  const stateHasEverySurface = (snapshot) => snapshot.surfaces.length === namedSurfaces.length && snapshot.surfaces.every((surface) =>
    surface.count > 0 && surface.elements.every((element) => Number.isFinite(element.fontSizePx)));
  const surfacesPresent = stateHasEverySurface(beforeScreenshot) && stateHasEverySurface(afterScreenshot);
  const metricsStatus = themeStable && themeMatched && viewportMatched && surfacesPresent ? 'pass' : 'fail';
  const captureIntegrity = screenshot.integrityStatus;
  const coverageLimits = [];
  if (!documentFontsReady) coverageLimits.push('Document fonts did not finish loading within the bounded wait before this capture.');
  if (resolvedFonts.status !== 'captured') coverageLimits.push(`Actual platform font names were unavailable: ${resolvedFonts.reason ?? 'unsupported browser protocol'}.`);
  if (!captureObservation?.samplingPresent) coverageLimits.push('No animation-frame sample was observed during the bounded screenshot interval; capture stability is unverified and metrics fail closed.');
  if ((captureObservation?.mutations?.length ?? 0) > 0) coverageLimits.push('Relevant DOM mutation occurred during capture; the image is retained but capture metrics fail closed.');
  if ((captureObservation?.paintTransitions?.length ?? 0) > 0) coverageLimits.push('Computed theme or named-surface paint changed during capture; the image is retained but capture metrics fail closed.');
  if (!captureObservation?.complete || captureObservation?.overflow) coverageLimits.push('The bounded capture observation timed out or reached its sample limit; capture metrics fail closed.');
  coverageLimits.push(captureObservation?.observationLimit ?? 'DOM/frame observations cannot attest compositor/native screenshot atomicity or browser-provider honesty.');
  return {
    lifecycleState,
    expectedTheme,
    expectedViewport,
    scale,
    surfaces: namedSurfaces,
    observed: { beforeScreenshot, duringScreenshot: captureObservation, afterScreenshot, documentFontsReady },
    resolvedFonts,
    screenshot,
    checks: { themeStable, themeMatched, viewportMatched, surfacesPresent, screenshotFileBound: screenshot.fileBindingMatches },
    metricsStatus,
    captureIntegrity,
    visualStatus: captureIntegrity === 'fail' ? 'fail' : 'unverified',
    overallStatus: metricsStatus === 'fail' || captureIntegrity === 'fail' ? 'fail' : 'unverified',
    coverageLimits,
  };
}

function themeSchemeMatches(snapshot, expectedTheme) {
  return snapshot?.theme?.attribute === expectedTheme && snapshot?.theme?.colorScheme === expectedTheme;
}

function themeMatches(snapshot, expectedTheme) {
  const theme = snapshot?.theme;
  return themeSchemeMatches(snapshot, expectedTheme)
    && [theme.documentBackground, theme.documentColor, theme.bodyBackground, theme.bodyColor, theme.modalBackground, theme.modalColor].every((paint) => typeof paint === 'string' && paint.trim() !== '');
}

function metricStatus(options, before, after, surfaces, themeMatched, operations, runtimeErrors) {
  const requestedLayout = snapshot => snapshot?.viewportCss?.innerWidth === options.width && snapshot?.viewportCss?.innerHeight === options.height;
  if (!requestedLayout(before) || (options.mechanism === 'diagnostic-css' && !requestedLayout(after))) return 'fail';
  if (surfaces.some((surface) => surface.metricsStatus === 'fail')) return 'fail';
  if (!themeMatched || !themeMatches(before, options.theme) || !themeMatches(after, options.theme)) return 'fail';
  if (runtimeErrors.some((error) => ['pageerror', 'requestfailed', 'theme-mismatch'].includes(error.type))) return 'fail';
  if (options.mechanism === 'diagnostic-css') return surfaces.every((surface) => surface.metricsStatus === 'pass') ? 'pass' : 'fail';
  if (options.mechanism === 'native-page-zoom') {
    const viewportChanged = after.viewportCss.innerWidth < before.viewportCss.innerWidth || after.viewportCss.innerHeight < before.viewportCss.innerHeight;
    const devicePixelScale = after.devicePixelRatio / before.devicePixelRatio;
    const operation = operations.findLast((entry) => entry.type === 'native browser page zoom keyboard shortcut');
    return viewportChanged && devicePixelScale >= options.scale - 0.02 && operation?.attemptedSteps > 0 ? 'pass' : 'unverified';
  }
  if (options.mechanism === 'pinch-zoom') {
    const beforeScale = before.visualViewport?.scale;
    const afterScale = after.visualViewport?.scale;
    const operation = operations.findLast((entry) => entry.type === 'Chromium Input.synthesizePinchGesture');
    return operation?.supported !== false
      && Number.isFinite(beforeScale)
      && Number.isFinite(afterScale)
      && afterScale / beforeScale >= options.scale - 0.02
      && (after.visualViewport.width < before.visualViewport.width || after.visualViewport.height < before.visualViewport.height)
      ? 'pass'
      : 'unverified';
  }
  return 'unverified';
}

function initialResult(options) {
  const caseId = caseIdentifier(options);
  return {
    schemaVersion: 1,
    caseId,
    sourceIdentity: options.sourceIdentity,
    artifact: { requestedUrl: safeUrl(options.url.href), documentStatus: null, documentSha256: null, loadedResources: [] },
    requested: {
      mechanism: options.mechanism,
      theme: options.theme,
      viewportCss: { width: options.width, height: options.height },
      scale: options.scale,
      browserContext: {
        deviceScaleFactor: 1,
        hasTouch: options.mechanism === 'pinch-zoom',
        isMobile: options.mechanism === 'pinch-zoom',
        colorScheme: options.theme,
        locale: 'en-US',
        timezoneId: 'UTC',
        serviceWorkers: 'block',
      },
      surfaces: SURFACES.map(({ name, selector }) => ({ name, selector })),
    },
    browserRuntime: { engine: null, version: null, nodeVersion: process.version, platform: process.platform, architecture: process.arch, headless: options.headless, customExecutable: Boolean(options.browserExecutable) },
    observed: { reference: null, capture: null, resolvedFonts: { status: 'unavailable', bySurface: [], reason: null } },
    captureAudits: { reference: null, capture: null },
    references: [{ name: 'same-session ordinary-size FAQ view', screenshot: `${caseId}-reference.png` }],
    screenshots: { reference: null, capture: null },
    surfaces: [],
    operations: [],
    isolation: { browserContext: 'fresh in-memory context', storageStateProvided: false, syntheticBoard: null },
    metricsStatus: 'unverified',
    captureIntegrity: 'unverified',
    visualStatus: 'unverified',
    overallStatus: 'unverified',
    runtimeErrors: [],
    blockedExternalRequests: [],
    coverageLimits: [
      'The URL is local and unauthenticated; this does not establish deployed, authenticated-production or physical-device behavior.',
      'Automated capture integrity does not replace independent visual readability and typography judgment.',
      'The caller-provided source identity is recorded as supplied; served document and local resources are hashed separately.',
    ],
  };
}

async function producerFingerprints() {
  const helperPath = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(helperPath), '../..');
  const inputs = [
    ['rendererModule', helperPath],
    ['rendererTest', resolve(dirname(helperPath), 'rendered-evidence.test.mjs')],
    ['packageConfig', resolve(repoRoot, 'package.json')],
    ['lockfile', resolve(repoRoot, 'package-lock.json')],
  ];
  const fingerprints = {};
  for (const [name, path] of inputs) {
    try {
      const bytes = await readFile(path);
      fingerprints[name] = { path: name === 'rendererModule' || name === 'rendererTest' ? `scripts/agent-tools/${name === 'rendererModule' ? 'rendered-evidence.mjs' : 'rendered-evidence.test.mjs'}` : name === 'packageConfig' ? 'package.json' : 'package-lock.json', sha256: sha256(bytes), bytes: bytes.length };
    } catch (error) {
      fingerprints[name] = { path: null, sha256: null, status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return fingerprints;
}

async function saveResult(result, outputDirectory) {
  const path = resolve(outputDirectory, 'case.json');
  await writeAtomicallyWithoutOverwrite(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function writeAtomicallyWithoutOverwrite(path, contents, encoding) {
  const temporaryPath = `${path}.partial-${process.pid}`;
  await writeFile(temporaryPath, contents, { flag: 'wx', ...(encoding ? { encoding } : {}) });
  try {
    await link(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function expectedScreenshotDimensions(options, observed, mechanism) {
  const accepted = new Set([`${options.width}x${options.height}`]);
  if (mechanism === 'native-page-zoom' && observed?.viewportCss?.innerWidth > 0 && observed?.viewportCss?.innerHeight > 0) {
    accepted.add(`${observed.viewportCss.innerWidth}x${observed.viewportCss.innerHeight}`);
  }
  return [...accepted];
}

async function runCase(options) {
  await mkdir(options.outputDirectory, { recursive: true });
  const casePath = resolve(options.outputDirectory, 'case.json');
  try {
    await access(casePath);
    throw new Error(`Refusing to overwrite existing case evidence: ${casePath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const reservedFiles = [`${caseIdentifier(options)}-reference.png`, `${caseIdentifier(options)}-capture.png`];
  const existingFiles = new Set(await readdir(options.outputDirectory));
  const collision = reservedFiles.find((fileName) => existingFiles.has(fileName));
  if (collision) throw new Error(`Refusing to overwrite existing rendered evidence: ${resolve(options.outputDirectory, collision)}`);

  const result = initialResult(options);
  result.artifact.producerFingerprints = await producerFingerprints();
  let browser;
  let context;
  let page;
  let before;
  let after;
  const pendingResourceHashes = [];
  try {
    const playwright = await import(pathToFileURL(options.playwrightModule).href);
    if (!playwright.chromium?.launch) throw new Error('The supplied Playwright module does not export chromium.launch().');
    const launchOptions = { headless: options.headless };
    if (options.browserExecutable) launchOptions.executablePath = options.browserExecutable;
    browser = await playwright.chromium.launch(launchOptions);
    result.browserRuntime.engine = browser.browserType?.().name?.() ?? 'unavailable';
    result.browserRuntime.version = browser.version?.() ?? null;
    const mobile = options.mechanism === 'pinch-zoom';
    context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      hasTouch: mobile,
      isMobile: mobile,
      colorScheme: options.theme,
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    });
    page = await context.newPage();
    page.setDefaultTimeout?.(options.timeoutMs);
    page.on('pageerror', (error) => result.runtimeErrors.push({ type: 'pageerror', message: String(error?.message ?? error).slice(0, 1000) }));
    page.on('console', (message) => {
      if (message.type() === 'error') result.runtimeErrors.push({ type: 'console', message: String(message.text()).slice(0, 1000) });
    });
    page.on('requestfailed', (request) => {
      const rawUrl = request.url();
      let local = false;
      try { local = new URL(rawUrl).origin === options.url.origin; } catch { /* keep the failure visible */ }
      if (!local) {
        if (!result.blockedExternalRequests.includes(safeUrl(rawUrl))) result.blockedExternalRequests.push(safeUrl(rawUrl));
      } else result.runtimeErrors.push({ type: 'requestfailed', url: safeUrl(rawUrl), message: String(request.failure()?.errorText ?? 'request failed').slice(0, 500) });
    });
    page.on('response', (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      if (!['document', 'script', 'stylesheet', 'font', 'image'].includes(resourceType)) return;
      const rawUrl = response.url();
      let local = false;
      try { local = new URL(rawUrl).origin === options.url.origin; } catch { /* ignore malformed resource URL */ }
      if (!local) return;
      pendingResourceHashes.push((async () => {
        try {
          const body = await response.body();
          result.artifact.loadedResources.push({ url: safeUrl(rawUrl), resourceType, status: response.status(), sha256: sha256(body), bytes: body.length });
        } catch (error) {
          result.runtimeErrors.push({ type: 'resource-hash', url: safeUrl(rawUrl), message: String(error?.message ?? error).slice(0, 500) });
        }
      })());
    });
    await context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === options.url.origin) await route.continue();
      else {
        if (!result.blockedExternalRequests.includes(safeUrl(requestUrl.href))) result.blockedExternalRequests.push(safeUrl(requestUrl.href));
        await route.abort();
      }
    });

    const response = await page.goto(options.url.href, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    result.artifact.documentStatus = response?.status?.() ?? null;
    if (response?.body) {
      try { result.artifact.documentSha256 = sha256(await response.body()); } catch (error) {
        result.runtimeErrors.push({ type: 'document-hash', message: String(error?.message ?? error).slice(0, 500) });
      }
    }
    if (!response || result.artifact.documentStatus < 200 || result.artifact.documentStatus >= 400) throw new Error(`Local app navigation failed with HTTP ${result.artifact.documentStatus ?? 'no response'}.`);

    const appSetup = await prepareApp(page, options);
    result.isolation.syntheticBoard = appSetup.syntheticBoard;
    result.uiActions = appSetup.uiActions;
    if (!appSetup.themeMatched) result.runtimeErrors.push({ type: 'theme-mismatch', message: `The native theme control did not apply requested ${options.theme} paint.` });
    result.themePaintAudit = appSetup.themePaintAudit;
    result.observed.documentFontsReady = await waitForDocumentFonts(page, options.timeoutMs);
    if (!result.observed.documentFontsReady) result.coverageLimits.push('Document fonts did not finish loading within the bounded wait; screenshots and measurements record the resulting fallback or loading state.');
    await page.waitForTimeout(100);
    const referenceCapture = await captureRenderedState(page, {
      lifecycleState: 'ordinary-reference',
      expectedTheme: options.theme,
      expectedViewport: { width: options.width, height: options.height },
      mechanism: 'diagnostic-css',
      baseViewport: { width: options.width, height: options.height },
      outputDirectory: options.outputDirectory,
      fileName: `${result.caseId}-reference.png`,
      timeoutMs: options.timeoutMs,
    });
    before = referenceCapture.observed.beforeScreenshot;
    result.observed.reference = before;
    result.observed.resolvedFonts = referenceCapture.resolvedFonts;
    result.captureAudits.reference = {
      lifecycleState: referenceCapture.lifecycleState,
      scale: referenceCapture.scale,
      expectedTheme: referenceCapture.expectedTheme,
      expectedViewport: referenceCapture.expectedViewport,
      surfaces: referenceCapture.surfaces,
      observed: {
        beforeScreenshot: { theme: referenceCapture.observed.beforeScreenshot.theme, viewportCss: referenceCapture.observed.beforeScreenshot.viewportCss },
        duringScreenshot: referenceCapture.observed.duringScreenshot,
        afterScreenshot: { theme: referenceCapture.observed.afterScreenshot.theme, viewportCss: referenceCapture.observed.afterScreenshot.viewportCss },
      },
      checks: referenceCapture.checks,
      metricsStatus: referenceCapture.metricsStatus,
      captureIntegrity: referenceCapture.captureIntegrity,
    };
    if (result.observed.resolvedFonts.status !== 'captured') result.coverageLimits.push(`Actual platform font names were unavailable: ${result.observed.resolvedFonts.reason ?? 'unsupported browser protocol'}.`);
    if (result.observed.resolvedFonts.bySurface.some((surface) => surface.truncated)) result.coverageLimits.push('Resolved platform font sampling is capped at 20 elements per surface; the font list may not cover every repeated FAQ entry.');
    result.screenshots.reference = referenceCapture.screenshot;
    result.coverageLimits.push(...referenceCapture.coverageLimits);
    await performMechanism(page, context, options, before, result);
    await page.waitForTimeout(100);
    const captureState = await captureRenderedState(page, {
      lifecycleState: `${options.mechanism}-capture`,
      expectedTheme: options.theme,
      expectedViewport: options.mechanism === 'diagnostic-css' ? { width: options.width, height: options.height } : null,
      mechanism: options.mechanism,
      baseViewport: { width: options.width, height: options.height },
      outputDirectory: options.outputDirectory,
      fileName: `${result.caseId}-capture.png`,
      timeoutMs: options.timeoutMs,
    });
    after = captureState.observed.afterScreenshot;
    result.observed.capture = after;
    result.surfaces = compareRenderedSurfaces(before, after, options.mechanism);
    result.observed.resolvedFontsAfter = captureState.resolvedFonts;
    result.screenshots.capture = captureState.screenshot;
    result.captureAudits.capture = {
      lifecycleState: captureState.lifecycleState,
      scale: captureState.scale,
      expectedTheme: captureState.expectedTheme,
      expectedViewport: captureState.expectedViewport,
      surfaces: captureState.surfaces,
      observed: {
        beforeScreenshot: { theme: captureState.observed.beforeScreenshot.theme, viewportCss: captureState.observed.beforeScreenshot.viewportCss },
        duringScreenshot: captureState.observed.duringScreenshot,
        afterScreenshot: { theme: captureState.observed.afterScreenshot.theme, viewportCss: captureState.observed.afterScreenshot.viewportCss },
      },
      checks: captureState.checks,
      metricsStatus: captureState.metricsStatus,
      captureIntegrity: captureState.captureIntegrity,
    };
    result.coverageLimits.push(...captureState.coverageLimits);
    await Promise.allSettled(pendingResourceHashes);
    result.artifact.loadedResources.sort((a, b) => a.url.localeCompare(b.url));
    result.metricsStatus = [result.captureAudits.reference, result.captureAudits.capture].some((capture) => capture.metricsStatus === 'fail')
      ? 'fail'
      : metricStatus(options, before, after, result.surfaces, appSetup.themeMatched, result.operations, result.runtimeErrors);
    result.captureIntegrity = [result.screenshots.reference, result.screenshots.capture].some((shot) => shot?.integrityStatus === 'fail')
      ? 'fail'
      : [result.screenshots.reference, result.screenshots.capture].every((shot) => shot?.integrityStatus === 'pass')
        ? 'pass'
        : 'unverified';
    result.visualStatus = result.captureIntegrity === 'fail' ? 'fail' : 'unverified';
    if (result.captureIntegrity !== 'pass') result.coverageLimits.push('Screenshot capture integrity did not pass, so visual evidence is failed or unverified.');
    result.overallStatus = result.metricsStatus === 'fail' || result.captureIntegrity === 'fail' ? 'fail' : 'unverified';
  } catch (error) {
    result.runtimeErrors.push({ type: 'capture', message: String(error?.message ?? error).slice(0, 1000) });
    result.metricsStatus = 'fail';
    result.captureIntegrity = 'fail';
    result.visualStatus = 'fail';
    result.overallStatus = 'fail';
    result.coverageLimits.push('The capture operation failed before a complete rendered-evidence case could be collected.');
    await Promise.allSettled(pendingResourceHashes);
  } finally {
    await context?.close().catch((error) => result.runtimeErrors.push({ type: 'cleanup', message: String(error?.message ?? error).slice(0, 500) }));
    await browser?.close().catch((error) => result.runtimeErrors.push({ type: 'cleanup', message: String(error?.message ?? error).slice(0, 500) }));
  }

  await saveResult(result, options.outputDirectory);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.metricsStatus === 'fail' || result.captureIntegrity === 'fail') return 1;
  if (result.metricsStatus === 'unverified' || result.captureIntegrity === 'unverified') return 2;
  return 0;
}

async function main() {
  const rawOptions = parseArguments(process.argv.slice(2));
  if (rawOptions.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  return runCase(parseOptions(rawOptions));
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
