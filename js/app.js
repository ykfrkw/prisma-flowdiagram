// app.js — UI wiring: editor, preview, export, divider drag

const EXAMPLE_SINGLE = `// Single-Column PRISMA 2020 Flow Diagram
// Use for systematic reviews that search databases and registers only.
---
# Identification of studies via databases and registers
!check: auto

## Identification

### Records identified (n = 2143)
- MEDLINE (n = 1205)
- Embase (n = 938)

#### Records removed before screening (n = 312)
- Duplicate records (n = 285)
- Records marked ineligible by automation tools (n = 27)

## Screening

### Records screened (n = 1831)

#### Records excluded (n = 1412)

### Reports sought for retrieval (n = 419)

#### Reports not retrieved (n = 24)

### Reports assessed for eligibility (n = 395)

#### Reports excluded (n = 348)
- Wrong study design (n = 118)
- Wrong population (n = 94)
- Wrong intervention (n = 76)
- Wrong outcomes (n = 60)

## Included

### Studies included in review (n = 47)
`;

const EXAMPLE_DOUBLE = `// Two-Column PRISMA 2020 Flow Diagram
// Use when including both database searches and other sources (grey literature, etc.).
// The "to:" directive connects source boxes to a single merged box.
---
# Identification of studies via databases and registers
!check: auto

## Identification

### Records identified (n = 2357)
- MEDLINE (n = 1450)
- Embase (n = 907)

#### Records removed before screening (n = 214)
- Duplicate records (n = 166)
- Records marked ineligible (n = 48)

## Screening

### Records screened (n = 2143)

#### Records excluded (n = 1420)

### Reports sought for retrieval (n = 723)

#### Reports not retrieved (n = 17)

### Reports assessed for eligibility (n = 706)

#### Reports excluded (n = 373)
- Wrong study design (n = 127)
- Wrong outcomes (n = 154)
- Wrong comparator (n = 92)

## Included

### Studies included in review (n = 333)
id: included_db
to: total_included
!check: auto

### Studies included in review (n = 346)
id: total_included

---

# Identification of studies via other methods
color_grey: true
!check: auto

## Identification

### Records identified (n = 177)
- Websites (n = 145)
- Organisations (n = 32)

## Screening

### Reports sought for retrieval (n = 23)

#### Reports not retrieved (n = 3)

### Reports assessed for eligibility (n = 20)

#### Reports excluded (n = 7)
- Wrong study design (n = 7)

## Included

### Studies included in review (n = 13)
id: included_other
to: total_included
!check: auto



`;

const EXAMPLE_TRIPLE = `// Three-Column PRISMA 2020 Flow Diagram
// Use when including databases, grey literature, AND citation searching.
---
# Databases and registers
!check: auto

## Identification

### Records identified (n = 1840)
- MEDLINE (n = 1020)
- Embase (n = 820)

#### Records removed before screening (n = 215)
- Duplicate records (n = 198)
- Records marked ineligible (n = 17)

## Screening

### Records screened (n = 1625)

#### Records excluded (n = 1190)

### Reports sought for retrieval (n = 435)

#### Reports not retrieved (n = 18)

### Reports assessed for eligibility (n = 417)

#### Reports excluded (n = 362)
- Wrong study design (n = 142)
- Wrong population (n = 112)
- Wrong outcomes (n = 108)

## Included

### Studies included (n = 55)
id: included_db
to: total_included
!check: auto

### Studies included in review (n = 70)
id: total_included

---

# Grey literature
color_grey: true
!check: auto

## Identification

### Records identified (n = 245)
- Websites (n = 145)
- Organisations (n = 68)
- Preprint servers (n = 32)

## Screening

### Reports sought for retrieval (n = 45)

#### Reports not retrieved (n = 8)

### Reports assessed for eligibility (n = 37)

#### Reports excluded (n = 28)
- Wrong study design (n = 12)
- Wrong outcomes (n = 16)

## Included

### Studies included (n = 9)
id: included_grey
to: total_included
!check: auto



---

# Citation searching
color_grey: true
!check: auto

## Identification

### Reference lists checked (n = 55)

## Screening

### Reports sought for retrieval (n = 22)

#### Reports not retrieved (n = 2)

### Reports assessed for eligibility (n = 20)

#### Reports excluded (n = 14)
- Already included (n = 7)
- Wrong study design (n = 7)

## Included

### Studies included (n = 6)
id: included_citation
to: total_included
!check: auto


`;

// DOM refs
let editor, preview, errorLog;
let debounceTimer = null;

// Ignore state
const ignoredErrors = new Set(); // Set of message strings the user has chosen to ignore
let currentMessages = [];        // Latest check messages (for checkbox wiring)

/**
 * Reconstruct active error sets by filtering out ignored messages.
 * Returns { boxErrors, exclErrors, arrowErrors } with ignored entries removed.
 */
function applyIgnored(checkResult) {
  const active = checkResult.messages.filter(m => !ignoredErrors.has(m.message));
  const boxErrors  = new Set();
  const exclErrors = new Set();
  const arrowErrors = [];

  for (const m of active) {
    if (m.type === 'box' || m.type === 'merge') {
      boxErrors.add(m.box);
    } else if (m.type === 'excl') {
      exclErrors.add(m.excl);
    } else if (m.type === 'flow') {
      boxErrors.add(m.boxA);
      boxErrors.add(m.boxB);
      arrowErrors.push({ from: m.boxA, to: m.boxB });
    }
  }

  return { boxErrors, exclErrors, arrowErrors };
}

/**
 * Render the error log panel. Shows ALL messages (including ignored ones),
 * each with an "Ignore" checkbox. Ignored messages are shown faded.
 */
function renderErrorLog(messages) {
  currentMessages = messages;

  if (messages.length === 0) {
    errorLog.innerHTML = '';
    errorLog.style.display = 'none';
    return;
  }

  errorLog.innerHTML = messages.map((m, i) => {
    const ignored = ignoredErrors.has(m.message);
    return `<div class="error-item${ignored ? ' error-ignored' : ''}">
      <label class="ignore-label" title="Ignore this warning">
        <input type="checkbox" class="ignore-check" data-idx="${i}"${ignored ? ' checked' : ''}>
        <span class="ignore-text">Ignore</span>
      </label>
      <span class="error-icon">\u26a0</span>
      <span class="error-text">${escapeHtml(m.message)}</span>
    </div>`;
  }).join('');

  errorLog.style.display = 'block';

  // Wire checkboxes (use closure over currentMessages snapshot)
  const snapshot = messages.slice();
  errorLog.querySelectorAll('.ignore-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const msg = snapshot[parseInt(cb.dataset.idx)].message;
      if (cb.checked) { ignoredErrors.add(msg); } else { ignoredErrors.delete(msg); }
      updateDiagram();
    });
  });
}

function init() {
  editor = document.getElementById('editor');
  preview = document.getElementById('preview');
  errorLog = document.getElementById('error-log');

  // Load double-column example by default
  editor.value = EXAMPLE_DOUBLE;

  // Auto-update on input
  editor.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateDiagram, 300);
  });

  // Example buttons — clear ignored errors when switching examples
  document.getElementById('btn-example-1').addEventListener('click', () => { ignoredErrors.clear(); editor.value = EXAMPLE_SINGLE; updateDiagram(); });
  document.getElementById('btn-example-2').addEventListener('click', () => { ignoredErrors.clear(); editor.value = EXAMPLE_DOUBLE; updateDiagram(); });
  document.getElementById('btn-example-3').addEventListener('click', () => { ignoredErrors.clear(); editor.value = EXAMPLE_TRIPLE; updateDiagram(); });

  document.getElementById('btn-export-svg').addEventListener('click', exportSVG);
  document.getElementById('btn-export-png').addEventListener('click', exportPNG);
  document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);

  // Divider drag
  setupDivider();

  // Initial render
  updateDiagram();
}

function updateDiagram() {
  const text = editor.value;
  let parsed;
  try { parsed = parseMarkdown(text); } catch(e) { showError('Parse error: ' + e.message); return; }

  let checkResult = { messages: [], boxErrors: new Set(), exclErrors: new Set(), arrowErrors: [] };
  try { checkResult = runChecks(parsed); } catch(e) { console.warn('Check error:', e); }

  // Apply ignore state: rebuild error sets excluding ignored messages
  const active = applyIgnored(checkResult);

  let svgElement;
  try {
    svgElement = renderSVG(parsed, active.boxErrors, active.exclErrors, active.arrowErrors);
  } catch(e) { showError('Render error: ' + e.message); console.error(e); return; }

  preview.innerHTML = '';
  preview.appendChild(svgElement);

  // Flash the preview to signal it updated
  preview.classList.remove('updated');
  void preview.offsetWidth; // force reflow
  preview.classList.add('updated');

  // Show ALL messages with ignore checkboxes (including already-ignored ones)
  renderErrorLog(checkResult.messages);
}

function showError(msg) {
  preview.innerHTML = `<div class="render-error">${escapeHtml(msg)}</div>`;
  errorLog.style.display = 'none';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getSVGString() {
  const svgNode = preview.querySelector('svg');
  if (!svgNode) return null;
  const serializer = new XMLSerializer();
  let str = serializer.serializeToString(svgNode);
  if (!str.includes('xmlns=')) {
    str = str.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return str;
}

function exportSVG() {
  const str = getSVGString();
  if (!str) { alert('No diagram to export.'); return; }
  const blob = new Blob([str], { type: 'image/svg+xml' });
  downloadBlob(blob, 'prisma-flowdiagram.svg');
}

function exportPDF() {
  const str = getSVGString();
  if (!str) { alert('No diagram to export.'); return; }

  const svgNode = preview.querySelector('svg');
  const w = parseInt(svgNode.getAttribute('width')) || 800;
  const h = parseInt(svgNode.getAttribute('height')) || 600;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: white; }
@media print {
  @page { size: ${w}px ${h}px; margin: 0; }
  html, body { width: ${w}px; height: ${h}px; }
}
</style>
</head><body>${str}</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Please allow pop-ups for this page.'); return; }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => { win.print(); });
}

function exportPNG() {
  const str = getSVGString();
  if (!str) { alert('No diagram to export.'); return; }

  const svgNode = preview.querySelector('svg');
  const w = parseInt(svgNode.getAttribute('width')) || 800;
  const h = parseInt(svgNode.getAttribute('height')) || 600;

  const canvas = document.createElement('canvas');
  const scale = 2; // retina
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);

  const blob = new Blob([str], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    canvas.toBlob(pngBlob => {
      downloadBlob(pngBlob, 'prisma-flowdiagram.png');
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('PNG export failed. Try SVG export instead.');
  };
  img.src = url;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Divider drag ---
function setupDivider() {
  const divider = document.getElementById('divider');
  const leftPane = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  const container = document.getElementById('main-container');

  let dragging = false;
  let startX = 0;
  let startLeftW = 0;

  divider.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startLeftW = leftPane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const containerW = container.getBoundingClientRect().width;
    const dividerW = divider.getBoundingClientRect().width;
    const delta = e.clientX - startX;
    let newLeftW = startLeftW + delta;
    const minW = 150;
    const maxW = containerW - dividerW - minW;
    newLeftW = Math.max(minW, Math.min(maxW, newLeftW));
    leftPane.style.width = newLeftW + 'px';
    rightPane.style.width = (containerW - newLeftW - dividerW) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Boot
document.addEventListener('DOMContentLoaded', init);
