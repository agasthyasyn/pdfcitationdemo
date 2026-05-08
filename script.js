import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/* =========================================================
   ROBUST PDF TEMPLATE FORMATTER
   =========================================================

   This replacement script creates a clean document in a standardized style:
   - Title
   - Key Information header table
   - Visual References section
   - Segregated operational sections
   - Missing common fields shown as "Not Available"
   - No system notes, source labels, audit notes, or original-source sections in output
   - Preview and PDF export are generated from the same document model
   - Best-effort visual extraction that avoids normal text/header/footer regions

   Expected HTML IDs:
   templatePdfInput, sourcePdfInput, templateFileInfo, sourceFileInfo,
   processBtn, exportPdfBtn, exportAuditBtn, resetBtn,
   statusText, detectedDetails, snapshotList, formattedPreview
*/

const els = {
  templatePdfInput: document.getElementById("templatePdfInput"),
  sourcePdfInput: document.getElementById("sourcePdfInput"),
  templateFileInfo: document.getElementById("templateFileInfo"),
  sourceFileInfo: document.getElementById("sourceFileInfo"),
  processBtn: document.getElementById("processBtn"),
  exportPdfBtn: document.getElementById("exportPdfBtn"),
  exportAuditBtn: document.getElementById("exportAuditBtn"),
  resetBtn: document.getElementById("resetBtn"),
  statusPanel: document.querySelector(".status-panel"),
  statusText: document.getElementById("statusText"),
  detectedDetails: document.getElementById("detectedDetails"),
  snapshotList: document.getElementById("snapshotList"),
  formattedPreview: document.getElementById("formattedPreview")
};

const state = {
  templateFile: null,
  sourceFiles: [],
  templateProfile: null,
  documents: [],
  auditLog: null
};

const HEADER_ROWS = [
  ["Vessel Name", "Port Name"],
  ["Country", "UNLOCODE / UNCTAD Code"],
  ["Latitude / Longitude / Position", "Time Zone"],
  ["Port Stay / Date", "Berth / Pier / Terminal"],
  ["Cargo", "Cargo Operations / Rate"],
  ["Depth / Draft / Channel", "Density"],
  ["Tidal Range", "Security Level"],
  ["VHF / Communication", "Agent / Contact"],
  ["Publications / Charts", "Additional Reference"]
];

const FIELD_ALIASES = {
  "Vessel Name": ["vessel", "vessel name", "ship", "mv", "m/v"],
  "Port Name": ["port", "port name", "location"],
  "Country": ["country"],
  "UNLOCODE / UNCTAD Code": ["unlocode", "unctad", "un/locode", "code"],
  "Latitude / Longitude / Position": ["lat", "long", "latitude", "longitude", "position"],
  "Time Zone": ["time zone", "local time", "gmt", "utc"],
  "Port Stay / Date": ["port stay", "date", "arrival", "berthing", "departure", "eta", "etb", "etd"],
  "Berth / Pier / Terminal": ["berth", "pier", "terminal", "jetty"],
  "Cargo": ["cargo", "commodity"],
  "Cargo Operations / Rate": ["loading rate", "discharging rate", "cargo operation", "cargo operations", "rate", "shore scale"],
  "Depth / Draft / Channel": ["depth", "draft", "draught", "channel", "fairway"],
  "Density": ["density", "water density"],
  "Tidal Range": ["tidal range", "tide", "average tide"],
  "Security Level": ["security level", "isps", "level"],
  "VHF / Communication": ["vhf", "channel", "communication", "radio"],
  "Agent / Contact": ["agent", "agency", "contact"],
  "Publications / Charts": ["publication", "publications", "chart", "charts", "alrs"],
  "Additional Reference": ["reference", "remarks"]
};

const STANDARD_SECTIONS = [
  "Port Overview / About",
  "Arrival / Port Stay Details",
  "Anchorage",
  "Pilotage / Approach / Navigation",
  "Berth / Terminal / Depth",
  "Cargo Operations",
  "Agents / Contacts",
  "Pre-Arrival Documents / Formalities",
  "Regulations / Security / Health",
  "Services / Supplies / Waste",
  "Publications / Charts",
  "Operational Experience / Remarks",
  "Detailed Notes"
];

const CONFIG = {
  output: {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 42,
    titleSize: 15,
    headingSize: 12,
    bodySize: 9.2,
    lineHeight: 12.2,
    tableRowHeight: 25,
    figureMaxHeight: 215
  },
  extraction: {
    yTolerance: 3.5,
    renderScale: 1.7,
    maxVisualsPerDocument: 10
  },
  blockedOutputLabels: [
    "formatted document",
    "standardized format",
    "template based standardized document",
    "template-based standardized document",
    "source preservation appendix",
    "source preservation note",
    "source page",
    "template used",
    "source file",
    "generated on",
    "generated at",
    "original source",
    "system note",
    "audit note",
    "unmapped additional source content",
    "additional source content"
  ]
};

bindEvents();
resetOutputOnly();
setStatus("Upload a template PDF and source PDF(s).");

function bindEvents() {
  els.templatePdfInput?.addEventListener("change", (event) => {
    state.templateFile = event.target.files?.[0] || null;
    els.templateFileInfo.textContent = state.templateFile
      ? `Template selected: ${state.templateFile.name}`
      : "No template uploaded yet.";
    setStatus(state.templateFile ? "Template uploaded." : "Template removed.");
  });

  els.sourcePdfInput?.addEventListener("change", (event) => {
    state.sourceFiles = Array.from(event.target.files || []);
    els.sourceFileInfo.innerHTML = state.sourceFiles.length
      ? state.sourceFiles.map((file, i) => `${i + 1}. ${escapeHtml(file.name)}`).join("<br>")
      : "No source documents uploaded yet.";
    setStatus(state.sourceFiles.length ? `${state.sourceFiles.length} source PDF(s) uploaded.` : "Source removed.");
  });

  els.processBtn?.addEventListener("click", processDocuments);
  els.exportPdfBtn?.addEventListener("click", exportPdf);
  els.exportAuditBtn?.addEventListener("click", exportAuditLog);
  els.resetBtn?.addEventListener("click", resetTool);
}

async function processDocuments() {
  if (!state.templateFile) return setStatus("Please upload a template PDF first.", "error");
  if (!state.sourceFiles.length) return setStatus("Please upload at least one source PDF.", "error");

  resetOutputOnly();

  try {
    setStatus("Reading template...");
    const templatePdf = await extractPdf(state.templateFile, { collectVisuals: false });
    state.templateProfile = buildTemplateProfile(templatePdf);

    const documents = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];
      setStatus(`Processing ${file.name} (${i + 1} of ${state.sourceFiles.length})...`);
      const sourcePdf = await extractPdf(file, { collectVisuals: true });
      documents.push(await buildDocument(sourcePdf, state.templateProfile));
    }

    state.documents = documents;
    state.auditLog = buildAuditLog();

    renderPreview();
    renderDetectedDetails();
    renderImagePreview();

    els.exportPdfBtn.disabled = false;
    els.exportAuditBtn.disabled = false;
    setStatus("Processing complete. Review the preview before export.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`, "error");
  }
}

async function extractPdf(file, { collectVisuals }) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer, useSystemFonts: true }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setStatus(`Reading ${file.name} - page ${pageNumber} of ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const items = textContent.items
      .map((item) => {
        const tr = item.transform || [1, 0, 0, 1, 0, 0];
        return {
          text: item.str || "",
          x: tr[4] || 0,
          y: tr[5] || 0,
          width: item.width || 0,
          height: Math.abs(tr[3] || item.height || 9),
          fontName: item.fontName || ""
        };
      })
      .filter((item) => item.text.trim());

    const lines = buildLines(items, viewport);
    let rendered = null;
    let visuals = [];

    if (collectVisuals) {
      rendered = await renderPage(page, CONFIG.extraction.renderScale);
      visuals = findVisualAreas({ pageNumber, viewport, lines, rendered });
    }

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      lines,
      text: cleanOutputText(lines.map((line) => line.text).join("\n")),
      rendered,
      visuals
    });
  }

  return {
    fileName: file.name,
    pageCount: pages.length,
    pages,
    fullText: cleanOutputText(pages.map((page) => page.text).join("\n\n"))
  };
}

function buildLines(items, viewport) {
  const groups = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let group = groups.find((g) => Math.abs(g.y - item.y) <= CONFIG.extraction.yTolerance);
    if (!group) {
      group = { y: item.y, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups
    .sort((a, b) => b.y - a.y)
    .map((group) => {
      const sorted = group.items.sort((a, b) => a.x - b.x);
      const text = joinItems(sorted);
      const minX = Math.min(...sorted.map((i) => i.x));
      const maxX = Math.max(...sorted.map((i) => i.x + i.width));
      const height = average(sorted.map((i) => i.height || 9));
      return {
        text: normalizeLine(text),
        x: minX,
        y: group.y,
        width: maxX - minX,
        height,
        top: viewport.height - group.y - height,
        bottom: viewport.height - group.y + 3,
        fontSize: height,
        boldish: sorted.some((i) => /bold|black|heavy/i.test(i.fontName))
      };
    })
    .filter((line) => line.text);
}

function joinItems(items) {
  let out = "";
  let prev = null;
  for (const item of items) {
    if (prev) {
      const gap = item.x - (prev.x + prev.width);
      if (gap > Math.max(2.5, prev.height * 0.55)) out += " ";
    }
    out += item.text;
    prev = item;
  }
  return out.replace(/\s+/g, " ").trim();
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { dataUrl: canvas.toDataURL("image/png", 0.95), width: canvas.width, height: canvas.height, scale };
}

function findVisualAreas({ pageNumber, viewport, lines, rendered }) {
  if (!rendered) return [];

  const bodyTop = 72;
  const bodyBottom = viewport.height - 58;
  const visualCue = /(visual reference|figure|fig\.?|image|photo|map|diagram|layout|anchorage|berth plan|terminal plan|chart)/i;

  const cueLine = lines.find((line) => visualCue.test(line.text));
  const bodyLines = lines.filter((line) => line.top >= bodyTop && line.bottom <= bodyBottom);

  const textArea = bodyLines.reduce((sum, line) => sum + line.width * Math.max(line.height, 8), 0);
  const sparsePage = textArea / (viewport.width * viewport.height) < 0.12;
  const hasCue = Boolean(cueLine);

  if (!hasCue && !sparsePage) return [];

  let cropTop = hasCue ? Math.min(cueLine.bottom + 8, viewport.height - 160) : bodyTop;
  let cropBottom = bodyBottom;

  const laterText = bodyLines.filter((line) => line.top > cropTop + 40 && !visualCue.test(line.text));
  const denseLaterText = laterText.filter((line) => line.text.length > 25 && line.width > viewport.width * 0.45);

  if (denseLaterText.length) {
    const firstDense = denseLaterText[0];
    if (firstDense.top - cropTop > 120) cropBottom = firstDense.top - 10;
  }

  const cropHeight = cropBottom - cropTop;
  if (cropHeight < 90) return [];

  const crop = {
    x: 32,
    y: cropTop,
    width: viewport.width - 64,
    height: cropHeight
  };

  return [
    {
      pageNumber,
      x: Math.round(crop.x * rendered.scale),
      y: Math.round(crop.y * rendered.scale),
      width: Math.round(crop.width * rendered.scale),
      height: Math.round(crop.height * rendered.scale),
      sourceDataUrl: rendered.dataUrl,
      renderedWidth: rendered.width,
      renderedHeight: rendered.height,
      confidence: hasCue ? 0.86 : 0.52
    }
  ];
}

async function cropVisual(visual) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = visual.width;
      canvas.height = visual.height;
      ctx.drawImage(img, visual.x, visual.y, visual.width, visual.height, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/png", 0.95), width: canvas.width, height: canvas.height, pageNumber: visual.pageNumber });
    };
    img.onerror = () => resolve(null);
    img.src = visual.sourceDataUrl;
  });
}

function buildTemplateProfile(pdf) {
  const headings = detectHeadings(pdf);
  const sections = headings.length ? headings : STANDARD_SECTIONS;
  return {
    fileName: pdf.fileName,
    pageCount: pdf.pageCount,
    sections: uniqueStrings(sections.map(cleanHeading)).filter(Boolean)
  };
}

async function buildDocument(sourcePdf, templateProfile) {
  const title = inferTitle(sourcePdf);
  const sourceSections = splitIntoSections(sourcePdf);
  const headerFacts = buildHeaderFacts(sourcePdf, title);
  const sections = mapSections(sourceSections, templateProfile.sections);
  const visuals = await collectVisuals(sourcePdf);

  const visualSection = {
    heading: "Visual References",
    blocks: visuals.map((visual, index) => ({ type: "image", ...visual, label: `Visual Reference ${index + 1}` }))
  };

  return {
    sourceFileName: sourcePdf.fileName,
    title,
    pageCount: sourcePdf.pageCount,
    headerFacts,
    sections: [visualSection, ...sections].filter((section) => section.blocks.length),
    sourceSectionCount: sourceSections.length,
    visualCount: visuals.length
  };
}

function detectHeadings(pdf) {
  const all = pdf.pages.flatMap((p) => p.lines.map((line) => ({ ...line, pageNumber: p.pageNumber })));
  const medianFont = median(all.map((line) => line.fontSize).filter(Boolean)) || 9;
  const candidates = [];

  for (const line of all) {
    const text = cleanHeading(line.text);
    if (!text || text.length < 3 || text.length > 110) continue;
    if (isBlocked(text) || looksLikeSentence(text)) continue;

    let score = 0;
    if (/^\d{1,2}(\.\d{1,2})?\s*[).:-]?\s+/.test(line.text)) score += 0.5;
    if (/^[A-Z0-9][A-Z0-9\s/&(),.'’-]{4,}$/.test(text) && text.split(/\s+/).length <= 10) score += 0.35;
    if (line.fontSize >= medianFont + 1.2) score += 0.25;
    if (line.boldish) score += 0.18;
    if (/\b(port|arrival|anchorage|pilotage|berth|cargo|agent|formalities|regulations|services|charts|remarks|notes|visual)\b/i.test(text)) score += 0.22;

    if (score >= 0.36) candidates.push(text.replace(/^\d{1,2}(\.\d{1,2})?\s*[).:-]?\s+/, ""));
  }

  return uniqueStrings(candidates).filter((h) => !isBlocked(h));
}

function splitIntoSections(pdf) {
  const headings = new Set(detectHeadings(pdf).map(comparable));
  const sections = [];
  let current = { heading: "General Details", lines: [], pages: new Set([1]) };

  for (const page of pdf.pages) {
    for (const line of page.lines) {
      const text = normalizeLine(line.text);
      if (!text || isBlocked(text)) continue;
      const clean = cleanHeading(text);
      const isHeading = headings.has(comparable(clean));

      if (isHeading && current.lines.length) {
        pushCurrent();
        current = { heading: clean, lines: [], pages: new Set([page.pageNumber]) };
      } else if (isHeading && !current.lines.length) {
        current.heading = clean;
        current.pages.add(page.pageNumber);
      } else {
        current.lines.push(text);
        current.pages.add(page.pageNumber);
      }
    }
  }
  pushCurrent();

  return sections.filter((s) => s.content || s.heading !== "General Details");

  function pushCurrent() {
    const content = cleanOutputText(current.lines.join("\n"));
    if (!content && current.heading === "General Details") return;
    sections.push({
      heading: cleanHeading(current.heading),
      content,
      pages: Array.from(current.pages).sort((a, b) => a - b)
    });
  }
}

function buildHeaderFacts(pdf, title) {
  const values = {};
  HEADER_ROWS.flat().forEach((field) => (values[field] = "Not Available"));

  const titleHints = parseTitleHints(title || pdf.fileName);
  Object.assign(values, titleHints);

  const keyValues = extractKeyValues(pdf.fullText);
  for (const item of keyValues) {
    const field = matchField(item.key);
    if (field && item.value) values[field] = cleanFact(item.value);
  }

  const inferred = inferFactsFromBody(pdf.fullText);
  for (const [field, value] of Object.entries(inferred)) {
    if (value && isUnavailable(values[field])) values[field] = cleanFact(value);
  }

  return HEADER_ROWS.map(([left, right]) => ({
    left: { label: left, value: values[left] || "Not Available" },
    right: { label: right, value: values[right] || "Not Available" }
  }));
}

function parseTitleHints(title) {
  const text = cleanHeading(removePdfExtension(title).replace(/[_-]+/g, " "));
  const result = {};
  const portCountry = text.match(/([A-Z][A-Za-z .']+),\s*([A-Z][A-Za-z .']+)/);
  const vessel = text.match(/\b([A-Z]{3,20})\b/);
  if (vessel) result["Vessel Name"] = vessel[1];
  if (portCountry) {
    result["Port Name"] = `${portCountry[1]}, ${portCountry[2]}`;
    result["Country"] = portCountry[2];
  }
  return result;
}

function extractKeyValues(text) {
  return cleanOutputText(text)
    .split("\n")
    .map((line) => line.match(/^(.{2,60}?)(?:\s*[:\-–—]\s+|\s{2,})(.{2,220})$/))
    .filter(Boolean)
    .map((m) => ({ key: cleanHeading(m[1]), value: normalizeLine(m[2]) }))
    .filter((item) => !isBlocked(item.key) && !looksLikeSentence(item.key));
}

function matchField(label) {
  const target = comparable(label);
  let best = "";
  let score = 0;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const all = [field, ...aliases];
    const local = Math.max(...all.map((a) => target.includes(comparable(a)) ? 1 : tokenOverlap(tokenize(a), tokenize(target))));
    if (local > score) {
      score = local;
      best = field;
    }
  }
  return score >= 0.42 ? best : "";
}

function inferFactsFromBody(text) {
  const t = cleanOutputText(text);
  const facts = {};
  const checks = [
    ["UNLOCODE / UNCTAD Code", /\b(?:UNCTAD|UNLOCODE|UN\/LOCODE)\s*(?:code)?\s*[:\-]?\s*([A-Z]{2}\s?[A-Z0-9]{3})/i],
    ["Latitude / Longitude / Position", /((?:\d{1,2}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[NS])\s+(?:\d{2,3}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[EW]))/i],
    ["Time Zone", /\b(?:UTC|GMT)\s*[+-]?\s*\d{1,2}\b/i],
    ["Berth / Pier / Terminal", /\b(?:Berth|Terminal|Pier|Jetty)\s*[:\-]?\s*([^\n.]{3,100})/i],
    ["Cargo", /\bCargo\s*[:\-]?\s*([^\n.]{3,80})/i],
    ["Cargo Operations / Rate", /\b(?:loading|discharging)\s+rate\s*(?:was|is|:)?\s*([^\n.]{3,90})/i],
    ["Depth / Draft / Channel", /\b(?:Depth|Draft|Draught|Channel)\s*[:\-]?\s*([^\n.]{2,80})/i],
    ["Density", /\bDensity\s*[:\-]?\s*([0-9.\-–]+)\b/i],
    ["Tidal Range", /\bTidal\s+Range\s*[:\-]?\s*([^\n.]{2,60})/i],
    ["Security Level", /\b(?:Security Level|ISPS\s*-?\s*Level)\s*[:\-]?\s*(\d+)/i],
    ["VHF / Communication", /\b(?:VHF|channels?)\b[^\n]*(\b(?:CH\s*)?\d{1,2}(?:\s*\/\s*\d{1,2})?\b)/i],
    ["Agent / Contact", /\bAgent\s*[:\-]?\s*([^\n.]{2,90})/i]
  ];
  for (const [field, regex] of checks) {
    const m = t.match(regex);
    if (m) facts[field] = m[1] || m[0];
  }
  return facts;
}

function mapSections(sourceSections, templateSections) {
  const preferred = uniqueStrings([...STANDARD_SECTIONS, ...templateSections]).filter((h) => comparable(h) !== "visual references");
  const buckets = preferred.map((heading) => ({ heading, blocks: [] }));

  for (const source of sourceSections) {
    const best = bestSection(source, buckets);
    const text = cleanOutputText(source.heading === best.heading ? source.content : `${source.heading}\n${source.content}`);
    if (text) best.blocks.push({ type: "text", text, pages: source.pages });
  }

  return buckets
    .map((bucket) => ({ ...bucket, blocks: mergeTextBlocks(bucket.blocks) }))
    .filter((bucket) => bucket.blocks.length);
}

function bestSection(source, buckets) {
  let selected = buckets[buckets.length - 1];
  let bestScore = 0;
  for (const bucket of buckets) {
    const score = sectionScore(bucket.heading, source.heading, source.content);
    if (score > bestScore) {
      bestScore = score;
      selected = bucket;
    }
  }
  return bestScore >= 0.18 ? selected : buckets[buckets.length - 1];
}

function sectionScore(target, heading, content) {
  const targetTokens = tokenize(target);
  const sourceTokens = tokenize(`${heading} ${content}`).slice(0, 140);
  const base = tokenOverlap(targetTokens, sourceTokens);
  const semantic = semanticScore(target, `${heading}\n${content}`);
  return Math.min(1, base * 0.7 + semantic * 0.3);
}

function semanticScore(target, source) {
  const t = comparable(target);
  const s = comparable(source);
  const groups = [
    [["arrival", "port stay"], ["arrival", "berthing", "departure", "eta", "etb", "etd", "anchorage"]],
    [["anchorage"], ["anchorage", "anchor", "pilot station"]],
    [["pilotage", "navigation", "approach"], ["pilot", "approach", "channel", "towage", "tug", "navigation"]],
    [["berth", "terminal", "depth"], ["berth", "terminal", "jetty", "depth", "draft", "quay"]],
    [["cargo"], ["cargo", "loading", "discharging", "shore", "scale"]],
    [["agent", "contact"], ["agent", "agency", "phone", "email", "contact"]],
    [["formalities", "documents"], ["document", "certificate", "crew list", "passport", "registry"]],
    [["regulations", "security", "health"], ["security", "isps", "health", "fine", "authority", "immigration"]],
    [["services", "supplies", "waste"], ["garbage", "bunker", "fresh water", "sludge", "stores", "provisions"]],
    [["publication", "charts"], ["chart", "publication", "alrs"]],
    [["remarks", "experience", "notes"], ["remarks", "general information", "experience", "note"]]
  ];
  let best = 0;
  for (const [labels, keys] of groups) {
    if (labels.some((x) => t.includes(x))) {
      best = Math.max(best, Math.min(0.65, keys.filter((k) => s.includes(k)).length * 0.12));
    }
  }
  return best;
}

async function collectVisuals(pdf) {
  const raw = pdf.pages.flatMap((page) => page.visuals || []).sort((a, b) => b.confidence - a.confidence);
  const limited = raw.slice(0, CONFIG.extraction.maxVisualsPerDocument);
  const result = [];
  for (const visual of limited) {
    const cropped = await cropVisual(visual);
    if (cropped) result.push(cropped);
  }
  return result;
}

function mergeTextBlocks(blocks) {
  const merged = [];
  for (const block of blocks) {
    const text = cleanOutputText(block.text);
    if (!text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.type === "text") prev.text = cleanOutputText(`${prev.text}\n\n${text}`);
    else merged.push({ ...block, text });
  }
  return merged;
}

function renderPreview() {
  els.formattedPreview.value = state.documents.map((doc) => {
    const lines = [doc.title, "", "1. Key Information", "", headerFactsToText(doc.headerFacts), ""];
    doc.sections.forEach((section, i) => {
      lines.push(`${i + 2}. ${section.heading}`, "");
      section.blocks.forEach((block) => {
        if (block.type === "text") lines.push(block.text, "");
        if (block.type === "image") lines.push(`[${block.label || "Visual Reference"} retained in PDF export]`, "");
      });
    });
    return cleanOutputText(lines.join("\n"));
  }).join("\n\n");
}

function headerFactsToText(rows) {
  return rows.map((row) => `${row.left.label}: ${row.left.value}\n${row.right.label}: ${row.right.value}`).join("\n");
}

async function exportPdf() {
  if (!state.documents.length) return setStatus("No processed document available to export.", "error");

  try {
    setStatus("Generating PDF...");
    const pdfDoc = await PDFDocument.create();
    const fonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
    };

    for (let i = 0; i < state.documents.length; i++) {
      if (i > 0) pdfDoc.addPage([CONFIG.output.pageWidth, CONFIG.output.pageHeight]);
      await drawDocument(pdfDoc, state.documents[i], fonts);
    }

    const bytes = await pdfDoc.save();
    const fileName = state.documents.length === 1 ? outputName(state.documents[0].sourceFileName) : "Updated_Documents.pdf";
    downloadBlob(bytes, fileName, "application/pdf");
    setStatus("PDF exported successfully.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Export failed: ${error.message}`, "error");
  }
}

async function drawDocument(pdfDoc, doc, fonts) {
  const pageSize = { width: CONFIG.output.pageWidth, height: CONFIG.output.pageHeight };
  const margin = CONFIG.output.margin;
  const contentWidth = pageSize.width - margin * 2;
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = drawHeader(page, doc, fonts, pageSize, margin);

  page.drawText(safe(doc.title).substring(0, 100), {
    x: margin,
    y,
    size: CONFIG.output.titleSize,
    font: fonts.bold,
    color: rgb(0.13, 0.31, 0.43)
  });
  y -= 28;

  ({ page, y } = ensureSpace(pdfDoc, page, y, 270, doc, fonts, pageSize, margin));
  y = drawSectionHeading(page, "1. Key Information", fonts, margin, contentWidth, y);
  y = drawFactsTable(page, doc.headerFacts, fonts, margin, contentWidth, y);
  y -= 18;

  for (let i = 0; i < doc.sections.length; i++) {
    const sectionTitle = `${i + 2}. ${doc.sections[i].heading}`;
    ({ page, y } = ensureSpace(pdfDoc, page, y, 70, doc, fonts, pageSize, margin));
    y = drawSectionHeading(page, sectionTitle, fonts, margin, contentWidth, y);

    for (const block of doc.sections[i].blocks) {
      if (block.type === "text") {
        const paragraphs = block.text.split(/\n+/).map(normalizeLine).filter(Boolean);
        for (const para of paragraphs) {
          const lines = wrapToWidth(para, fonts.regular, CONFIG.output.bodySize, contentWidth);
          for (const line of lines) {
            ({ page, y } = ensureSpace(pdfDoc, page, y, 45, doc, fonts, pageSize, margin));
            page.drawText(safe(line), { x: margin, y, size: CONFIG.output.bodySize, font: fonts.regular, color: rgb(0.1, 0.12, 0.16) });
            y -= CONFIG.output.lineHeight;
          }
          y -= 6;
        }
      }

      if (block.type === "image" && block.dataUrl) {
        const img = await embedImage(pdfDoc, block.dataUrl);
        if (!img) continue;
        const ratio = Math.min(contentWidth / img.width, CONFIG.output.figureMaxHeight / img.height, 1);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ({ page, y } = ensureSpace(pdfDoc, page, y, h + 42, doc, fonts, pageSize, margin));
        page.drawText(safe(block.label || "Visual Reference"), { x: margin, y, size: 9.5, font: fonts.bold, color: rgb(0.13, 0.31, 0.43) });
        y -= 12;
        page.drawImage(img.image, { x: margin, y: y - h, width: w, height: h });
        y -= h + 16;
      }
    }

    y -= 10;
  }

  drawFooter(page, doc, fonts, pageSize, margin);
}

function ensureSpace(pdfDoc, page, y, needed, doc, fonts, pageSize, margin) {
  if (y - needed > margin + 32) return { page, y };
  drawFooter(page, doc, fonts, pageSize, margin);
  const newPage = pdfDoc.addPage([pageSize.width, pageSize.height]);
  return { page: newPage, y: drawHeader(newPage, doc, fonts, pageSize, margin) };
}

function drawHeader(page, doc, fonts, pageSize, margin) {
  page.drawText(safe(doc.title).substring(0, 90), { x: margin, y: pageSize.height - 32, size: 10.5, font: fonts.bold, color: rgb(0.13, 0.31, 0.43) });
  page.drawLine({ start: { x: margin, y: pageSize.height - 42 }, end: { x: pageSize.width - margin, y: pageSize.height - 42 }, thickness: 0.75, color: rgb(0.55, 0.7, 0.8) });
  return pageSize.height - 64;
}

function drawFooter(page, doc, fonts, pageSize, margin) {
  page.drawLine({ start: { x: margin, y: 32 }, end: { x: pageSize.width - margin, y: 32 }, thickness: 0.35, color: rgb(0.84, 0.88, 0.92) });
  page.drawText(safe(doc.title).substring(0, 90), { x: margin, y: 18, size: 7.2, font: fonts.regular, color: rgb(0.45, 0.45, 0.45) });
}

function drawSectionHeading(page, heading, fonts, margin, contentWidth, y) {
  page.drawText(safe(heading).substring(0, 110), { x: margin, y, size: CONFIG.output.headingSize, font: fonts.bold, color: rgb(0.13, 0.31, 0.43) });
  y -= 9;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.55, color: rgb(0.55, 0.7, 0.8) });
  return y - 17;
}

function drawFactsTable(page, rows, fonts, margin, contentWidth, y) {
  const labelW = contentWidth * 0.245;
  const valueW = contentWidth * 0.255;
  const rowH = CONFIG.output.tableRowHeight;

  rows.forEach((row, index) => {
    const top = y - index * rowH;
    page.drawRectangle({ x: margin, y: top - rowH + 4, width: contentWidth, height: rowH, color: index % 2 ? rgb(1, 1, 1) : rgb(0.94, 0.97, 0.985), borderColor: rgb(0.78, 0.86, 0.9), borderWidth: 0.35 });
    drawCell(page, row.left.label, margin + 5, top - 10, labelW - 8, fonts.bold, 7.8, rgb(0.13, 0.31, 0.43));
    drawCell(page, row.left.value, margin + labelW + 5, top - 10, valueW - 8, fonts.regular, 7.6, rgb(0.1, 0.12, 0.16));
    drawCell(page, row.right.label, margin + labelW + valueW + 5, top - 10, labelW - 8, fonts.bold, 7.8, rgb(0.13, 0.31, 0.43));
    drawCell(page, row.right.value, margin + labelW * 2 + valueW + 5, top - 10, valueW - 8, fonts.regular, 7.6, rgb(0.1, 0.12, 0.16));
    [labelW, labelW + valueW, labelW * 2 + valueW].forEach((x) => page.drawLine({ start: { x: margin + x, y: top + 4 }, end: { x: margin + x, y: top - rowH + 4 }, thickness: 0.35, color: rgb(0.78, 0.86, 0.9) }));
  });

  return y - rows.length * rowH - 8;
}

function drawCell(page, text, x, y, width, font, size, color) {
  wrapToWidth(String(text || "Not Available"), font, size, width).slice(0, 2).forEach((line, idx) => {
    page.drawText(safe(line).substring(0, 80), { x, y: y - idx * 8.5, size, font, color });
  });
}

async function embedImage(pdfDoc, dataUrl) {
  try {
    const base64 = dataUrl.split(",")[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const image = await pdfDoc.embedPng(bytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

function renderDetectedDetails() {
  const lines = [];
  lines.push(`Template: ${state.templateProfile.fileName}`);
  lines.push(`Template Sections Detected: ${state.templateProfile.sections.length}`);
  lines.push("");
  state.templateProfile.sections.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "-----------------------------", "");
  state.documents.forEach((doc, i) => {
    lines.push(`Document ${i + 1}: ${doc.sourceFileName}`);
    lines.push(`Title: ${doc.title}`);
    lines.push(`Pages: ${doc.pageCount}`);
    lines.push(`Source Sections: ${doc.sourceSectionCount}`);
    lines.push(`Visuals Mapped: ${doc.visualCount}`);
    lines.push("");
  });
  els.detectedDetails.textContent = lines.join("\n");
}

function renderImagePreview() {
  if (!els.snapshotList) return;
  els.snapshotList.innerHTML = "";
  state.documents.forEach((doc, docIndex) => {
    doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === "image").forEach((img) => {
      const card = document.createElement("div");
      card.className = "snapshot-card";
      const image = document.createElement("img");
      image.src = img.dataUrl;
      image.alt = img.label || "Visual Reference";
      const label = document.createElement("p");
      label.textContent = `Document ${docIndex + 1} | ${img.label || "Visual Reference"}`;
      card.appendChild(image);
      card.appendChild(label);
      els.snapshotList.appendChild(card);
    });
  });
}

function buildAuditLog() {
  return {
    generatedAt: new Date().toISOString(),
    template: state.templateProfile,
    documents: state.documents.map((doc) => ({
      sourceFileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.pageCount,
      sourceSectionCount: doc.sourceSectionCount,
      visualCount: doc.visualCount,
      outputSections: doc.sections.map((s) => ({ heading: s.heading, blocks: s.blocks.length }))
    }))
  };
}

function exportAuditLog() {
  if (!state.auditLog) return setStatus("No audit log available.", "error");
  downloadBlob(JSON.stringify(state.auditLog, null, 2), "Document_Audit_Log.json", "application/json");
  setStatus("Audit log exported successfully.", "success");
}

function inferTitle(pdf) {
  const lines = pdf.pages[0]?.lines.map((l) => cleanHeading(l.text)).filter(Boolean) || [];
  const candidate = lines.find((line) => !isBlocked(line) && line.length >= 4 && line.length <= 120 && !looksLikeSentence(line));
  return cleanDocumentTitle(candidate || removePdfExtension(pdf.fileName).replace(/[_-]+/g, " "));
}

function cleanOutputText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\bSource Page\s+\d+\b/gi, "")
    .replace(/\bTemplate Used\s*:.*/gi, "")
    .replace(/\bSource File\s*:.*/gi, "")
    .replace(/\bGenerated (On|At)\s*:.*/gi, "")
    .replace(/\bOriginal Source\b/gi, "")
    .replace(/\bFormatted Document\b/gi, "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isBlocked(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanDocumentTitle(text) {
  return cleanHeading(text)
    .replace(/\bstandardized format\b/gi, "")
    .replace(/\bformatted document\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || "Document";
}

function cleanHeading(text) {
  return normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/^\d{1,3}(\.\d{1,3})?\s*[).:-]?\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .trim();
}

function isBlocked(text) {
  const value = comparable(text);
  return CONFIG.blockedOutputLabels.some((b) => value === comparable(b) || value.includes(comparable(b)));
}

function looksLikeSentence(text) {
  const words = normalizeLine(text).split(/\s+/);
  return words.length > 14 || (/[.!?]$/.test(text) && words.length > 8);
}

function cleanFact(value) {
  const clean = normalizeLine(value).replace(/^[:\-–—|]+/, "").trim();
  return clean && !isBlocked(clean) ? clean.substring(0, 180) : "Not Available";
}

function isUnavailable(value) {
  return !value || comparable(value) === "not available";
}

function tokenize(text) {
  const stop = new Set(["the", "and", "or", "of", "to", "in", "for", "on", "by", "with", "from", "as", "at", "is", "are", "was", "were", "this", "that", "details", "information", "document", "report", "section", "page", "source", "template"]);
  return comparable(text).split(" ").filter((x) => x.length > 2 && !stop.has(x));
}

function tokenOverlap(a, b) {
  const A = Array.from(new Set(a));
  const B = new Set(b);
  if (!A.length || !B.size) return 0;
  return A.filter((x) => B.has(x)).length / A.length;
}

function wrapToWidth(text, font, size, width) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function safe(text) {
  return String(text || "")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, "");
}

function outputName(sourceName) {
  const base = removePdfExtension(sourceName).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").substring(0, 90);
  return `${base || "Document"}_Updated.pdf`;
}

function downloadBlob(data, fileName, mimeType) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetTool() {
  state.templateFile = null;
  state.sourceFiles = [];
  state.templateProfile = null;
  state.documents = [];
  state.auditLog = null;
  if (els.templatePdfInput) els.templatePdfInput.value = "";
  if (els.sourcePdfInput) els.sourcePdfInput.value = "";
  if (els.templateFileInfo) els.templateFileInfo.textContent = "No template uploaded yet.";
  if (els.sourceFileInfo) els.sourceFileInfo.textContent = "No source documents uploaded yet.";
  resetOutputOnly();
  setStatus("Tool reset.");
}

function resetOutputOnly() {
  if (els.formattedPreview) els.formattedPreview.value = "";
  if (els.detectedDetails) els.detectedDetails.textContent = "No document processed yet.";
  if (els.snapshotList) els.snapshotList.innerHTML = "";
  if (els.exportPdfBtn) els.exportPdfBtn.disabled = true;
  if (els.exportAuditBtn) els.exportAuditBtn.disabled = true;
}

function setStatus(message, type = "") {
  if (!els.statusText || !els.statusPanel) return;
  els.statusText.textContent = message;
  els.statusPanel.classList.remove("success", "error");
  if (type === "success") els.statusPanel.classList.add("success");
  if (type === "error") els.statusPanel.classList.add("error");
}

function normalizeLine(text) {
  return String(text || "").replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
}

function comparable(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function removePdfExtension(name) {
  return String(name || "Document").replace(/\.pdf$/i, "");
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = comparable(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
