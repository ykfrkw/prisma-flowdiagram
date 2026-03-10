// parser.js — parses the custom Markdown notation into the data structure

/**
 * Extract n value from a string like "Records screened (n = 2143)"
 * Returns a number or null.
 */
function parseN(text) {
  const m = text.match(/\(n\s*=\s*([\d,]+)\)/i);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, ''), 10);
}

/**
 * Wrap text to lines of at most maxChars characters.
 * Treats "(n = XXX)" as a single atomic token — never split mid-pattern.
 * If the token doesn't fit at the end of the current line, it starts a new line.
 */
function wrapText(text, maxChars) {
  if (!text) return [''];

  // Split into word tokens, treating (n = XXX) as one atomic unit
  const atomicRe = /\(n\s*=\s*[\d,]+\)/gi;
  const parts = [];
  let lastIdx = 0;
  let m;

  while ((m = atomicRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      const before = text.slice(lastIdx, m.index).split(/\s+/).filter(s => s.length > 0);
      parts.push(...before);
    }
    parts.push(m[0]); // atomic token, never broken
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    const after = text.slice(lastIdx).split(/\s+/).filter(s => s.length > 0);
    parts.push(...after);
  }

  const lines = [];
  let current = '';

  for (const word of parts) {
    if (!word) continue;
    const test = current ? current + ' ' + word : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  return lines.length > 0 ? lines : [''];
}

/**
 * Parse the full markdown input into the data structure.
 */
function parseMarkdown(input) {
  const result = {
    columns: [],
    merged: [],
    _boxById: {}
  };

  // Split by --- into column blocks
  const rawBlocks = input.split(/^---\s*$/m);

  const columnBlocks = [];
  const mergedBlock = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i].trim();
    if (!block) continue;
    if (/^#(?!#)/.test(block)) {
      columnBlocks.push(block);
    } else {
      mergedBlock.push(block);
    }
  }

  for (const block of columnBlocks) {
    const col = parseColumnBlock(block);
    result.columns.push(col);
  }

  if (mergedBlock.length > 0) {
    const merged = parseMergedBlock(mergedBlock.join('\n'));
    result.merged = merged;
  }

  // Build _boxById index
  for (const col of result.columns) {
    for (const section of col.sections) {
      for (const box of section.boxes) {
        if (box.id) result._boxById[box.id] = box;
      }
    }
  }
  for (const section of result.merged) {
    for (const box of section.boxes) {
      if (box.id) result._boxById[box.id] = box;
    }
  }

  return result;
}

/**
 * Parse a single column block (text starting with # heading).
 */
function parseColumnBlock(text) {
  const lines = text.split('\n');
  const col = {
    label: '',
    colorGrey: false,
    checkAuto: false,
    sections: []
  };

  let i = 0;

  if (lines[i] && /^#(?!#)/.test(lines[i])) {
    col.label = lines[i].replace(/^#+\s*/, '').trim();
    i++;
  }

  // Column-level directives (before any ## section)
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^\/\//.test(line)) { i++; continue; }
    if (/^##/.test(line)) break;
    if (/^color_grey\s*:\s*true/i.test(line)) { col.colorGrey = true; i++; continue; }
    if (/^!check\s*:\s*auto/i.test(line)) { col.checkAuto = true; i++; continue; }
    i++;
  }

  let currentSection = null;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Skip comment lines
    if (/^\/\//.test(trimmed)) { i++; continue; }

    // ## Section heading
    if (/^##(?!#)/.test(trimmed)) {
      const label = trimmed.replace(/^##\s*/, '').trim();
      currentSection = { label, boxes: [] };
      col.sections.push(currentSection);
      i++;
      continue;
    }

    // ### Box heading
    if (/^###(?!#)/.test(trimmed)) {
      if (!currentSection) {
        currentSection = { label: '', boxes: [] };
        col.sections.push(currentSection);
      }
      const title = trimmed.replace(/^###\s*/, '').trim();
      const box = {
        title,
        n: parseN(title),
        contents: [],
        id: null,
        to: null,
        checkAuto: col.checkAuto,
        exclusion: null
      };
      i++;
      i = readBoxBody(lines, i, box, col.checkAuto);
      currentSection.boxes.push(box);
      continue;
    }

    i++;
  }

  return col;
}

/**
 * Read box body: directives (id:, to:, from:, !check:) and bullet lines.
 * Also handles #### exclusion box.
 */
function readBoxBody(lines, i, box, colCheckAuto) {
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Skip comment lines
    if (/^\/\//.test(trimmed)) { i++; continue; }

    if (/^##(?!#)/.test(trimmed) || /^###(?!#)/.test(trimmed)) break;
    if (/^#(?!#)/.test(trimmed)) break;

    // #### exclusion box
    if (/^####/.test(trimmed)) {
      const exclTitle = trimmed.replace(/^####\s*/, '').trim();
      const excl = {
        title: exclTitle,
        n: parseN(exclTitle),
        contents: []
      };
      i++;
      i = readExclusionBody(lines, i, excl);
      box.exclusion = excl;
      continue;
    }

    // Directives
    if (/^id\s*:/.test(trimmed)) {
      box.id = trimmed.replace(/^id\s*:\s*/, '').trim();
      i++; continue;
    }
    if (/^to\s*:/.test(trimmed)) {
      box.to = trimmed.replace(/^to\s*:\s*/, '').trim();
      i++; continue;
    }
    if (/^from\s*:/.test(trimmed)) {
      box.from = trimmed.replace(/^from\s*:\s*/, '').split(',').map(s => s.trim()).filter(Boolean);
      i++; continue;
    }
    if (/^!check\s*:\s*auto/i.test(trimmed)) {
      box.checkAuto = true;
      i++; continue;
    }

    // Bullet line
    if (/^-\s/.test(trimmed)) {
      box.contents.push(trimmed.replace(/^-\s*/, '').trim());
      i++; continue;
    }

    i++;
  }
  return i;
}

/**
 * Read exclusion box body: only bullet lines.
 */
function readExclusionBody(lines, i, excl) {
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Skip comment lines
    if (/^\/\//.test(trimmed)) { i++; continue; }

    if (/^#{1,4}/.test(trimmed)) break;
    if (/^(id|to|from|!check|color_grey)\s*:/i.test(trimmed)) break;

    if (/^-\s/.test(trimmed)) {
      excl.contents.push(trimmed.replace(/^-\s*/, '').trim());
      i++; continue;
    }

    break;
  }
  return i;
}

/**
 * Parse the merged section block (no # column heading).
 */
function parseMergedBlock(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Skip comment lines
    if (/^\/\//.test(trimmed)) { i++; continue; }

    if (/^##(?!#)/.test(trimmed)) {
      const label = trimmed.replace(/^##\s*/, '').trim();
      currentSection = { label, boxes: [] };
      sections.push(currentSection);
      i++;
      continue;
    }

    if (/^###(?!#)/.test(trimmed)) {
      if (!currentSection) {
        currentSection = { label: '', boxes: [] };
        sections.push(currentSection);
      }
      const title = trimmed.replace(/^###\s*/, '').trim();
      const box = {
        title,
        n: parseN(title),
        contents: [],
        id: null,
        to: null,
        from: null,
        checkAuto: false,
        exclusion: null
      };
      i++;
      i = readBoxBody(lines, i, box, false);
      currentSection.boxes.push(box);
      continue;
    }

    i++;
  }

  return sections;
}
