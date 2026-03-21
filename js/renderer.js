// renderer.js — SVG rendering for PRISMA flow diagrams

// Layout constants
const MARGIN = 20;
const HEADER_H = 65;        // fallback minimum header height
const HEADER_WRAP = 45;     // wrap width for column header text
const SECTION_LABEL_W = 95;
const BOX_W = 200;
const EXCL_W = 165;
const H_ARROW = 18;
const COL_PAD = 40;
const V_ARROW = 22;
const SECTION_GAP = 24;
const FONT_SIZE = 11;
const LINE_H = 15;
const BOX_VPAD = 10;
const BOX_HPAD = 8;
const WRAP_CHARS = 32;
const EXCL_WRAP = 25;
const CORNER = 4;
const ARROWHEAD_SIZE = 6;

// Section label compact rect sizing
const LABEL_RECT_W = FONT_SIZE + 14;   // ~25px — one line height of rotated text
const LABEL_CHAR_PX = FONT_SIZE * 0.63; // approximate pixel width per character
const LABEL_V_PAD = 10;                 // padding above/below text in label rect

// Derived
const COL_UNIT = BOX_W + H_ARROW + EXCL_W + COL_PAD; // 423

// Colors
const COLOR_ORANGE      = '#E8945A';
const COLOR_GREY_HEADER = '#B0B0B0';
const COLOR_SECTION_BG  = '#AED6F1'; // light blue
const COLOR_SECTION_STR = '#7FB3D3'; // border for section label
const COLOR_SECTION_TXT = '#1a1a1a'; // black text
const COLOR_BOX_STROKE  = '#2E4FA3';
const COLOR_EXCL_FILL   = '#F5F5F5';
const COLOR_EXCL_STROKE = '#888888';
const COLOR_ERROR_STROKE = '#E74C3C';
const COLOR_MERGED_FILL = '#EEF2FF';
const COLOR_ARROW       = '#555555';

const SVG_NS = 'http://www.w3.org/2000/svg';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function svgEl(tag, attrs, children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
  }
  if (children) {
    for (const child of children) {
      if (child) el.appendChild(child);
    }
  }
  return el;
}

function calcBoxLines(title, contents, wrapW) {
  let lines = wrapText(title, wrapW).length;
  for (const c of contents) {
    lines += wrapText('\u2022 ' + c, wrapW).length;
  }
  return lines;
}

function calcBoxHeight(title, contents, wrapW) {
  const lines = calcBoxLines(title, contents, wrapW);
  return Math.max(36, BOX_VPAD * 2 + lines * LINE_H);
}

function renderBoxText(boxTitle, boxContents, boxX, boxY, wrapW, titleBold) {
  if (titleBold === undefined) titleBold = true;
  const group = svgEl('g');
  let dy = BOX_VPAD + LINE_H;

  const titleLines = wrapText(boxTitle, wrapW);
  for (const line of titleLines) {
    const t = svgEl('text', {
      x: boxX + BOX_HPAD,
      y: boxY + dy,
      'font-family': 'Arial, sans-serif',
      'font-size': FONT_SIZE,
      'font-weight': titleBold ? 'bold' : 'normal',
      'fill': '#1a1a1a'
    });
    t.textContent = line;
    group.appendChild(t);
    dy += LINE_H;
  }

  for (const c of boxContents) {
    const contentLines = wrapText('\u2022 ' + c, wrapW);
    for (const line of contentLines) {
      const t = svgEl('text', {
        x: boxX + BOX_HPAD,
        y: boxY + dy,
        'font-family': 'Arial, sans-serif',
        'font-size': FONT_SIZE - 1,
        'font-weight': 'normal',
        'fill': '#333333'
      });
      t.textContent = line;
      group.appendChild(t);
      dy += LINE_H;
    }
  }

  return group;
}

function makeArrowMarker() {
  const marker = svgEl('marker', {
    id: 'arrowhead',
    markerWidth: ARROWHEAD_SIZE,
    markerHeight: ARROWHEAD_SIZE,
    refX: ARROWHEAD_SIZE,
    refY: ARROWHEAD_SIZE / 2,
    orient: 'auto'
  });
  marker.appendChild(svgEl('polygon', {
    points: `0 0, ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE / 2}, 0 ${ARROWHEAD_SIZE}`,
    fill: COLOR_ARROW
  }));
  return marker;
}

function makeArrowMarkerRed() {
  const marker = svgEl('marker', {
    id: 'arrowhead-red',
    markerWidth: ARROWHEAD_SIZE,
    markerHeight: ARROWHEAD_SIZE,
    refX: ARROWHEAD_SIZE,
    refY: ARROWHEAD_SIZE / 2,
    orient: 'auto'
  });
  marker.appendChild(svgEl('polygon', {
    points: `0 0, ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE / 2}, 0 ${ARROWHEAD_SIZE}`,
    fill: COLOR_ERROR_STROKE
  }));
  return marker;
}

function drawDownArrow(x, y1, y2, color) {
  color = color || COLOR_ARROW;
  const markerId = color === COLOR_ERROR_STROKE ? 'arrowhead-red' : 'arrowhead';
  return svgEl('line', {
    x1: x, y1: y1,
    x2: x, y2: y2,
    stroke: color,
    'stroke-width': 1.5,
    'marker-end': 'url(#' + markerId + ')'
  });
}

function drawRightArrow(x1, y, x2) {
  return svgEl('line', {
    x1: x1, y1: y,
    x2: x2, y2: y,
    stroke: COLOR_ARROW,
    'stroke-width': 1.5,
    'marker-end': 'url(#arrowhead)'
  });
}

/**
 * Find a Y coordinate for the horizontal segment of a cross-column arrow
 * that avoids passing through any intermediate boxes.
 * Excludes the source box (fromY is its bottom) and the destination box (toY is its top).
 */
function findSafeRouteY(sx, tx, fromY, toY, boxPositions) {
  const xMin = Math.min(sx, tx);
  const xMax = Math.max(sx, tx);
  const margin = 3;

  // Collect boxes whose X range overlaps the horizontal path and whose Y is in [fromY, toY]
  let maxBottom = fromY;
  for (const [, pos] of boxPositions) {
    if (pos.x + pos.w <= xMin || pos.x >= xMax) continue;
    if (pos.y + pos.h <= fromY || pos.y >= toY) continue;
    if (pos.y + pos.h > maxBottom) maxBottom = pos.y + pos.h;
  }

  const clearY = maxBottom + margin;
  // If routing below all blockers still lands before the destination, use it
  if (clearY < toY - margin) return clearY;
  // Fall back: just above the destination
  return toY - margin * 2;
}

// -------------------------------------------------------------------
// Layout helpers
// -------------------------------------------------------------------

function computeRowHeights(sec) {
  return (sec ? sec.boxes : []).map(box => {
    const bh = calcBoxHeight(box.title, box.contents, WRAP_CHARS);
    const exclH = box.exclusion
      ? calcBoxHeight(box.exclusion.title, box.exclusion.contents, EXCL_WRAP)
      : 0;
    const rowH = Math.max(bh, exclH);
    return { bh, exclH, rowH };
  });
}

function colSectionHeight(rows) {
  if (rows.length === 0) return 0;
  let h = 0;
  for (let i = 0; i < rows.length; i++) {
    h += rows[i].rowH;
    if (i < rows.length - 1) h += V_ARROW;
  }
  return h;
}

/**
 * Draw section label: light blue background, sized to text, centered in full section height.
 */
function drawSectionLabel(svg, label, sectionY, sectionH) {
  const rectH = sectionH;
  const rectW = LABEL_RECT_W;

  const areaW = SECTION_LABEL_W - 8;
  const rectX = MARGIN + Math.floor((areaW - rectW) / 2);
  const rectY = sectionY;

  svg.appendChild(svgEl('rect', {
    x: rectX, y: rectY,
    width: rectW, height: rectH,
    fill: COLOR_SECTION_BG,
    stroke: COLOR_SECTION_STR,
    'stroke-width': 1,
    rx: CORNER, ry: CORNER
  }));

  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const t = svgEl('text', {
    x: cx, y: cy,
    'font-family': 'Arial, sans-serif',
    'font-size': FONT_SIZE,
    'font-weight': 'bold',
    fill: COLOR_SECTION_TXT,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    transform: `rotate(-90, ${cx}, ${cy})`
  });
  t.textContent = label;
  svg.appendChild(t);
}

// -------------------------------------------------------------------
// Main render function
// -------------------------------------------------------------------

/**
 * @param {object} parsed      — output of parseMarkdown()
 * @param {Set}    boxErrors   — set of box objects to highlight red
 * @param {Set}    exclErrors  — set of exclusion objects to highlight red
 * @param {Array}  arrowErrors — array of {from, to} box pairs for red arrows
 * @returns {SVGElement}
 */
function renderSVG(parsed, boxErrors, exclErrors, arrowErrors) {
  boxErrors  = boxErrors  || new Set();
  exclErrors = exclErrors || new Set();
  arrowErrors = arrowErrors || [];

  // Build arrow error map: fromBox -> Set<toBox>
  const arrowErrorMap = new Map();
  for (const {from, to} of arrowErrors) {
    if (!arrowErrorMap.has(from)) arrowErrorMap.set(from, new Set());
    arrowErrorMap.get(from).add(to);
  }
  function isErrorArrow(from, to) {
    return arrowErrorMap.has(from) && arrowErrorMap.get(from).has(to);
  }

  const nCols = parsed.columns.length;
  const hasMerged = parsed.merged && parsed.merged.length > 0;

  // Collect ordered section labels from all columns
  const allSectionLabels = [];
  const seenLabels = new Set();
  for (const col of parsed.columns) {
    for (const sec of col.sections) {
      if (sec.label && !seenLabels.has(sec.label)) {
        seenLabels.add(sec.label);
        allSectionLabels.push(sec.label);
      }
    }
  }

  // Pre-compute row heights for every col x section
  const rowData = parsed.columns.map(col => {
    const map = {};
    for (const sec of col.sections) {
      map[sec.label] = computeRowHeights(sec);
    }
    return map;
  });

  // Section heights: max across all columns
  const sectionHeights = {};
  for (const label of allSectionLabels) {
    let maxH = 0;
    for (let ci = 0; ci < nCols; ci++) {
      const rows = rowData[ci][label] || [];
      maxH = Math.max(maxH, colSectionHeight(rows));
    }
    sectionHeights[label] = Math.max(maxH, 40);
  }

  // Merged section heights
  const mergedSectionHeights = [];
  for (const sec of (parsed.merged || [])) {
    let h = 0;
    for (let bi = 0; bi < sec.boxes.length; bi++) {
      h += calcBoxHeight(sec.boxes[bi].title, sec.boxes[bi].contents, WRAP_CHARS);
      if (bi < sec.boxes.length - 1) h += V_ARROW;
    }
    mergedSectionHeights.push(Math.max(h, 40));
  }

  // Dynamic header height: fit to actual line count across all columns
  let dynHeaderH = 36; // minimum fallback
  for (const col of parsed.columns) {
    const lines = wrapText(col.label, HEADER_WRAP);
    const h = BOX_VPAD * 2 + lines.length * LINE_H;
    dynHeaderH = Math.max(dynHeaderH, h);
  }

  const svgW = MARGIN + SECTION_LABEL_W + Math.max(nCols, 1) * COL_UNIT - COL_PAD + MARGIN;

  const svg = svgEl('svg', {
    width: svgW,
    height: 100, // placeholder; updated at end
    xmlns: SVG_NS
  });

  const defs = svgEl('defs');
  defs.appendChild(makeArrowMarker());
  defs.appendChild(makeArrowMarkerRed());
  svg.appendChild(defs);

  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: svgW, height: 9999, fill: 'white' }));

  // --- Column headers ---
  for (let ci = 0; ci < nCols; ci++) {
    const col = parsed.columns[ci];
    const colX = MARGIN + SECTION_LABEL_W + ci * COL_UNIT;
    const headerW = BOX_W + H_ARROW + EXCL_W;
    const fill = col.colorGrey ? COLOR_GREY_HEADER : COLOR_ORANGE;

    svg.appendChild(svgEl('rect', {
      x: colX, y: MARGIN,
      width: headerW, height: dynHeaderH,
      fill: fill, rx: CORNER, ry: CORNER
    }));

    const headerLines = wrapText(col.label, HEADER_WRAP);
    const lc = headerLines.length;
    const firstLineY = MARGIN + dynHeaderH / 2 - ((lc - 1) * LINE_H) / 2 + LINE_H / 2 - 2;
    for (let li = 0; li < headerLines.length; li++) {
      const t = svgEl('text', {
        x: colX + headerW / 2,
        y: firstLineY + li * LINE_H,
        'font-family': 'Arial, sans-serif',
        'font-size': FONT_SIZE,
        'font-weight': 'bold',
        fill: 'white',
        'text-anchor': 'middle'
      });
      t.textContent = headerLines[li];
      svg.appendChild(t);
    }
  }

  // boxPositions: Map<boxObj, {x,y,w,h}> — for to:/from: arrows
  const boxPositions = new Map();

  // lastBoxPerCol[ci]: { bottomY, centerX, box } — for inter-section arrows
  const lastBoxPerCol = {};

  let currentY = MARGIN + dynHeaderH + SECTION_GAP;

  // --- Draw sections ---
  for (const label of allSectionLabels) {
    const secH = sectionHeights[label];

    drawSectionLabel(svg, label, currentY, secH);

    for (let ci = 0; ci < nCols; ci++) {
      const col = parsed.columns[ci];
      const sec = col.sections.find(s => s.label === label);
      if (!sec || sec.boxes.length === 0) continue;

      const rows = rowData[ci][label] || [];
      const boxX = MARGIN + SECTION_LABEL_W + ci * COL_UNIT;
      const exclX = boxX + BOX_W + H_ARROW;

      // First box Y: top-aligned within its row
      const firstActualBoxY = currentY;
      const firstBox = sec.boxes[0];

      // Inter-section arrow: connect last box of previous section to first box of this section
      if (lastBoxPerCol[ci]) {
        const arrowColor = isErrorArrow(lastBoxPerCol[ci].box, firstBox)
          ? COLOR_ERROR_STROKE : COLOR_ARROW;
        svg.appendChild(drawDownArrow(
          boxX + BOX_W / 2,
          lastBoxPerCol[ci].bottomY,
          firstActualBoxY,
          arrowColor
        ));
      }

      let rowTopY = currentY;

      for (let bi = 0; bi < sec.boxes.length; bi++) {
        const box = sec.boxes[bi];
        const { bh, exclH, rowH } = rows[bi];

        const actualBoxY = rowTopY;

        // Main box
        const hasError = boxErrors.has(box);
        svg.appendChild(svgEl('rect', {
          x: boxX, y: actualBoxY,
          width: BOX_W, height: bh,
          fill: 'white',
          stroke: hasError ? COLOR_ERROR_STROKE : COLOR_BOX_STROKE,
          'stroke-width': hasError ? 2.5 : 1.5,
          rx: CORNER, ry: CORNER
        }));
        svg.appendChild(renderBoxText(box.title, box.contents, boxX, actualBoxY, WRAP_CHARS, true));

        boxPositions.set(box, { x: boxX, y: actualBoxY, w: BOX_W, h: bh });

        // Exclusion box
        if (box.exclusion) {
          const exclY = rowTopY;
          const mainCenterY = actualBoxY + bh / 2;

          const exclHasError = (exclErrors || new Set()).has(box.exclusion);
          svg.appendChild(svgEl('rect', {
            x: exclX, y: exclY,
            width: EXCL_W, height: exclH,
            fill: COLOR_EXCL_FILL,
            stroke: exclHasError ? COLOR_ERROR_STROKE : COLOR_EXCL_STROKE,
            'stroke-width': exclHasError ? 2.5 : 1.2,
            rx: CORNER, ry: CORNER
          }));
          svg.appendChild(renderBoxText(
            box.exclusion.title, box.exclusion.contents,
            exclX, exclY, EXCL_WRAP, false
          ));
          svg.appendChild(drawRightArrow(boxX + BOX_W, mainCenterY, exclX));
        }

        // Down arrow to next box within same section
        if (bi < sec.boxes.length - 1) {
          const { bh: nextBH, rowH: nextRowH } = rows[bi + 1];
          const nextRowTopY = rowTopY + rowH + V_ARROW;
          const nextActualBoxY = nextRowTopY + Math.floor((nextRowH - nextBH) / 2);
          const fromBox = sec.boxes[bi];
          const toBox = sec.boxes[bi + 1];
          const arrowColor = isErrorArrow(fromBox, toBox) ? COLOR_ERROR_STROKE : COLOR_ARROW;
          svg.appendChild(drawDownArrow(
            boxX + BOX_W / 2,
            actualBoxY + bh,
            nextActualBoxY,
            arrowColor
          ));
        }

        rowTopY += rowH + V_ARROW;
      }

      // Track bottom of last box in this column (for next section's inter-section arrow)
      let lastRowTopY = currentY;
      for (let bi = 0; bi < rows.length - 1; bi++) {
        lastRowTopY += rows[bi].rowH + V_ARROW;
      }
      const lastRow = rows[rows.length - 1];
      const lastBoxObj = sec.boxes[sec.boxes.length - 1];
      lastBoxPerCol[ci] = {
        bottomY: lastRowTopY + lastRow.bh,
        centerX: boxX + BOX_W / 2,
        box: lastBoxObj
      };
    }

    currentY += secH + SECTION_GAP;
  }

  // --- Draw to: arrows (cross-column, after all box positions are known) ---
  for (const col of parsed.columns) {
    for (const sec of col.sections) {
      for (const box of sec.boxes) {
        if (!box.to) continue;
        const destBox = parsed._boxById[box.to];
        if (!destBox) continue;
        const srcPos = boxPositions.get(box);
        const destPos = boxPositions.get(destBox);
        if (!srcPos || !destPos) continue;

        const sx = srcPos.x + srcPos.w / 2;
        const sy = srcPos.y + srcPos.h;
        const tx = destPos.x + destPos.w / 2;
        const ty = destPos.y;

        const routeY = findSafeRouteY(sx, tx, sy, ty, boxPositions);
        const pathColor = isErrorArrow(box, destBox) ? COLOR_ERROR_STROKE : COLOR_ARROW;
        const markerId = pathColor === COLOR_ERROR_STROKE ? 'arrowhead-red' : 'arrowhead';
        // Route: down from source → horizontal at routeY → down into destination from above
        svg.appendChild(svgEl('path', {
          d: `M ${sx} ${sy} L ${sx} ${routeY} L ${tx} ${routeY} L ${tx} ${ty}`,
          stroke: pathColor,
          'stroke-width': 1.5,
          fill: 'none',
          'marker-end': 'url(#' + markerId + ')'
        }));
      }
    }
  }

  // --- Draw merged section ---
  if (hasMerged) {
    svg.appendChild(svgEl('line', {
      x1: MARGIN, y1: currentY,
      x2: svgW - MARGIN, y2: currentY,
      stroke: '#CCCCCC',
      'stroke-width': 1,
      'stroke-dasharray': '5 4'
    }));
    currentY += SECTION_GAP;

    const mergedAreaX = MARGIN + SECTION_LABEL_W;
    const mergedAreaW = svgW - mergedAreaX - MARGIN;

    for (let si = 0; si < parsed.merged.length; si++) {
      const sec = parsed.merged[si];
      const secH = mergedSectionHeights[si];

      if (sec.label) {
        drawSectionLabel(svg, sec.label, currentY, secH);
      }

      let boxY = currentY;
      for (let bi = 0; bi < sec.boxes.length; bi++) {
        const box = sec.boxes[bi];
        const bh = calcBoxHeight(box.title, box.contents, WRAP_CHARS);
        const boxX = mergedAreaX + Math.floor((mergedAreaW - BOX_W) / 2);

        const hasError = boxErrors.has(box);
        svg.appendChild(svgEl('rect', {
          x: boxX, y: boxY,
          width: BOX_W, height: bh,
          fill: COLOR_MERGED_FILL,
          stroke: hasError ? COLOR_ERROR_STROKE : COLOR_BOX_STROKE,
          'stroke-width': hasError ? 2.5 : 1.5,
          rx: CORNER, ry: CORNER
        }));
        svg.appendChild(renderBoxText(box.title, box.contents, boxX, boxY, WRAP_CHARS, true));

        boxPositions.set(box, { x: boxX, y: boxY, w: BOX_W, h: bh });

        // from: arrows (legacy: source IDs listed on destination box)
        if (box.from && box.from.length > 0 && parsed._boxById) {
          const targetCX = boxX + BOX_W / 2;
          const targetY = boxY;
          for (const srcId of box.from) {
            const srcBox = parsed._boxById[srcId];
            if (!srcBox) continue;
            const srcPos = boxPositions.get(srcBox);
            if (!srcPos) continue;

            const sx = srcPos.x + srcPos.w / 2;
            const sy = srcPos.y + srcPos.h;
            const midY = findSafeRouteY(sx, targetCX, sy, targetY, boxPositions);

            const pathColor = isErrorArrow(srcBox, box) ? COLOR_ERROR_STROKE : COLOR_ARROW;
            const markerId = pathColor === COLOR_ERROR_STROKE ? 'arrowhead-red' : 'arrowhead';
            svg.appendChild(svgEl('path', {
              d: `M ${sx} ${sy} L ${sx} ${midY} L ${targetCX} ${midY} L ${targetCX} ${targetY}`,
              stroke: pathColor,
              'stroke-width': 1.5,
              fill: 'none',
              'marker-end': 'url(#' + markerId + ')'
            }));
          }
        }

        if (bi < sec.boxes.length - 1) {
          const nextBox = sec.boxes[bi + 1];
          const nextBH = calcBoxHeight(nextBox.title, nextBox.contents, WRAP_CHARS);
          const nextBoxY = boxY + bh + V_ARROW;
          const arrowColor = isErrorArrow(box, nextBox) ? COLOR_ERROR_STROKE : COLOR_ARROW;
          svg.appendChild(drawDownArrow(boxX + BOX_W / 2, boxY + bh, nextBoxY, arrowColor));
          boxY = nextBoxY;
        } else {
          boxY += bh;
        }
      }

      currentY += secH + SECTION_GAP;
    }
  }

  // Set final height
  const finalH = currentY + MARGIN;
  svg.setAttribute('height', finalH);
  svg.querySelector('rect').setAttribute('height', finalH);

  return svg;
}
