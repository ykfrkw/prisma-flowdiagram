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

  // Rule 3: flow check A→B — highlight BOTH boxes and the arrow between them
  function checkFlowInSection(boxes) {
    for (let i = 0; i < boxes.length - 1; i++) {
      const A = boxes[i], B = boxes[i + 1];
      if (!A.checkAuto && !B.checkAuto) continue;
      if (A.exclusion && A.n !== null && A.exclusion.n !== null && B.n !== null) {
        const expected = A.n - A.exclusion.n;
        if (expected !== B.n) {
          boxErrors.add(A);
          boxErrors.add(B);
          arrowErrors.push({ from: A, to: B });
          messages.push({
            type: 'flow', box: B, boxA: A, boxB: B,
            message: `Flow: "${A.title}" (${A.n}) \u2212 excl (${A.exclusion.n}) = ${expected}, but next box n = ${B.n}`
          });
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

  // to: merge check
  const destToSources = {};
  for (const col of parsed.columns) {
    for (const section of col.sections) {
      for (const box of section.boxes) {
        if (!box.to || !box.checkAuto) continue;
        if (!destToSources[box.to]) destToSources[box.to] = [];
        destToSources[box.to].push(box);
      }
    }
  }
  for (const [destId, srcBoxes] of Object.entries(destToSources)) {
    const destBox = parsed._boxById[destId];
    if (!destBox || destBox.n === null) continue;
    const srcNs = srcBoxes.map(b => b.n);
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
