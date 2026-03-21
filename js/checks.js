// checks.js — validation logic for parsed PRISMA diagrams

/**
 * Run all checks and return { messages, boxErrors, exclErrors, arrowErrors }.
 *
 * Each message object:
 *   { type, box, message, ...extra }
 *   type: 'box'   — main box contents sum error         (extra: none)
 *   type: 'excl'  — exclusion box contents sum error    (extra: excl)
 *   type: 'flow'  — flow check error between A and B   (extra: boxA, boxB)
 *   type: 'merge' — merge sum error                    (extra: none)
 *
 * The type+extra fields allow app.js to reconstruct error sets
 * after the user ignores specific messages.
 */
function runChecks(parsed) {
  const boxErrors  = new Set();
  const exclErrors = new Set();
  const arrowErrors = [];
  const messages   = [];

  function allHaveN(items) {
    return items.length > 0 && items.every(item => parseN(item) !== null);
  }
  function sumN(items) {
    return items.reduce((acc, item) => acc + (parseN(item) || 0), 0);
  }

  // Build cross-column source map early: boxId -> all boxes that point to it via to:
  // (used in flow checks to account for merges at B from other columns)
  const toSourcesAll = {};
  for (const col of parsed.columns) {
    for (const section of col.sections) {
      for (const box of section.boxes) {
        if (!box.to) continue;
        if (!toSourcesAll[box.to]) toSourcesAll[box.to] = [];
        toSourcesAll[box.to].push(box);
      }
    }
  }

  // Rule 1: main box contents sum
  function checkContentsSum(box) {
    if (!box.checkAuto || box.n === null || box.contents.length === 0) return;
    if (!allHaveN(box.contents)) return;
    const s = sumN(box.contents);
    if (s !== box.n) {
      boxErrors.add(box);
      messages.push({
        type: 'box', box,
        message: `"${box.title}": contents sum (${s}) \u2260 box n (${box.n})`
      });
    }
  }

  // Rule 2: exclusion box contents sum — highlight the EXCLUSION box
  function checkExclusionSum(box) {
    if (!box.checkAuto || !box.exclusion) return;
    const excl = box.exclusion;
    if (excl.n === null || excl.contents.length === 0) return;
    if (!allHaveN(excl.contents)) return;
    const s = sumN(excl.contents);
    if (s !== excl.n) {
      exclErrors.add(excl);
      messages.push({
        type: 'excl', box, excl,
        message: `Exclusion "${excl.title}": contents sum (${s}) \u2260 n (${excl.n})`
      });
    }
  }

  // Rule 3: flow check A→B — considers cross-column merges at B via to:
  function checkFlowInSection(boxes) {
    for (let i = 0; i < boxes.length - 1; i++) {
      const A = boxes[i], B = boxes[i + 1];
      if (!A.checkAuto && !B.checkAuto) continue;
      if (A.exclusion && A.n !== null && A.exclusion.n !== null && B.n !== null) {
        // Start with A.n; add any cross-column sources pointing to B via to:
        let totalInput = A.n;
        let allSourcesKnown = true;
        const crossSrcs = (B.id && toSourcesAll[B.id]) ? toSourcesAll[B.id] : [];
        for (const src of crossSrcs) {
          if (src.n === null) { allSourcesKnown = false; break; }
          totalInput += src.n;
        }
        if (!allSourcesKnown) continue;

        const expected = totalInput - A.exclusion.n;
        if (expected !== B.n) {
          boxErrors.add(A);
          boxErrors.add(B);
          arrowErrors.push({ from: A, to: B });
          let msg;
          if (crossSrcs.length > 0) {
            const parts = [`"${A.title}" (${A.n})`];
            for (const src of crossSrcs) parts.push(`"${src.title}" (${src.n})`);
            msg = `Flow: (${parts.join(' + ')}) \u2212 excl (${A.exclusion.n}) = ${expected}, but next box n = ${B.n}`;
          } else {
            msg = `Flow: "${A.title}" (${A.n}) \u2212 excl (${A.exclusion.n}) = ${expected}, but next box n = ${B.n}`;
          }
          messages.push({ type: 'flow', box: B, boxA: A, boxB: B, message: msg });
        }
      }
    }
  }

  // Process all columns
  for (const col of parsed.columns) {
    for (const section of col.sections) {
      checkFlowInSection(section.boxes);
      for (const box of section.boxes) {
        checkContentsSum(box);
        checkExclusionSum(box);
      }
    }
  }

  // Process merged sections
  for (const section of parsed.merged) {
    for (const box of section.boxes) {
      checkContentsSum(box);
      checkExclusionSum(box);

      // from: merge check
      if (!box.checkAuto || !box.from || box.from.length === 0 || box.n === null) continue;
      let allOk = true, sourceSum = 0;
      for (const id of box.from) {
        const src = parsed._boxById[id];
        if (!src || src.n === null) { allOk = false; break; }
        sourceSum += src.n;
      }
      if (allOk && sourceSum !== box.n) {
        boxErrors.add(box);
        messages.push({
          type: 'merge', box,
          message: `Merge: sources sum (${sourceSum}) \u2260 merged box n (${box.n})`
        });
      }
    }
  }

  // Build set of boxes that have a sequential in-column predecessor.
  // For these, the flow check already incorporates cross-column to: sources,
  // so a standalone to: merge check would be a false positive.
  const hasSeqPredecessor = new Set();
  for (const col of parsed.columns) {
    for (const section of col.sections) {
      for (let i = 1; i < section.boxes.length; i++) {
        hasSeqPredecessor.add(section.boxes[i]);
      }
    }
  }

  // to: merge check (only checkAuto sources, skip boxes with sequential predecessor)
  for (const [destId, srcBoxes] of Object.entries(toSourcesAll)) {
    const checkAutoSrcs = srcBoxes.filter(b => b.checkAuto);
    if (checkAutoSrcs.length === 0) continue;
    const destBox = parsed._boxById[destId];
    if (!destBox || destBox.n === null) continue;
    // Destination has a sequential predecessor: handled by flow check, skip here
    if (hasSeqPredecessor.has(destBox)) continue;
    const srcNs = checkAutoSrcs.map(b => b.n);
    if (srcNs.some(n => n === null)) continue;
    const sum = srcNs.reduce((a, b) => a + b, 0);
    if (sum !== destBox.n) {
      boxErrors.add(destBox);
      messages.push({
        type: 'merge', box: destBox,
        message: `Merge (to:): sources sum (${sum}) \u2260 "${destBox.title}" n (${destBox.n})`
      });
    }
  }

  return { messages, boxErrors, exclErrors, arrowErrors };
}
