import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { loadTemplateController } from "./schema.controller.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/* =========================================================
   FIREBASE-CONTROLLED SAMPLE ALIGNMENT PDF FORMATTER v1
   =========================================================

   What this script does:
   1. Loads your Firebase template controller.
   2. Reads the uploaded sample/template PDF.
   3. Detects header fields and section order from the sample.
   4. Reads source PDFs.
   5. Aligns source content into the sample structure.
   6. Marks missing values as "Not Available" or Firebase fallback value.
   7. Avoids hardcoded fallback sections.
   8. Uses Firebase visual rules for conservative image/crop handling.

   Required companion files:
   - firebase.client.js
   - schema.controller.js

   Required HTML IDs:
   - templatePdfInput
   - sourcePdfInput
   - templateFileInfo
   - sourceFileInfo
   - processBtn
   - exportPdfBtn
   - exportAuditBtn
   - resetBtn
   - statusText
   - detectedDetails
   - snapshotList
   - formattedPreview
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
  templateController: null,
  templateContract: null,
  documents: [],
  auditLog: null
};

const CONFIG = {
  extraction: {
    lineYTolerance: 3.5,
    wordGapMultiplier: 0.55,
    renderScale: 1.6,
    maxVisualsPerDocument: 8
  },
  mapping: {
    minSectionScore: 0.18,
    minFieldScore: 0.42
  },
  structure: {
    minHeadingLength: 3,
    maxHeadingLength: 120,
    maxTemplateSections: 50
  },
  output: {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 42,
    bodyFontSize: 9.4,
    headingFontSize: 12,
    titleFontSize: 15,
    lineHeight: 12.4,
    paragraphGap: 8,
    sectionGap: 15,
    figureMaxHeight: 210,
    tableRowHeight: 25
  },
  labelsToRemove: [
    "formatted document",
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
    "unmapped additional source content",
    "additional source content",
    "system note",
    "audit note"
  ]
};

const COMMON_HEADER_LABELS = [
  "Vessel Name",
  "Port Name",
  "Country",
  "UNLOCODE / UNCTAD Code",
  "Latitude / Longitude / Position",
  "Time Zone",
  "Port Stay / Date",
  "Berth / Pier / Terminal",
  "Cargo",
  "Cargo Operations / Rate",
  "Depth / Draft / Channel",
  "Density",
  "Tidal Range",
  "Security Level",
  "VHF / Communication",
  "Agent / Contact",
  "Publications / Charts",
  "Additional Reference",
  "Client Name",
  "Quotation Date",
  "Event Date",
  "Location",
  "Package Type",
  "Total Estimate",
  "Payment Terms",
  "Invoice Number",
  "Invoice Date",
  "Vendor",
  "Customer",
  "Project Name",
  "Prepared By",
  "Prepared For"
];

const LOCAL_FALLBACK_RULE_ENGINE = {
  version: 2,
  fallbackValue: "Not Available",
  visuals: {
    enabled: false,
    manualReviewRequired: true,
    rejectTextHeavyCrops: true,
    rejectIfTextDensityAbovePercent: 18
  },
  qualityRules: {
    minimumSectionScore: 55,
    minimumFieldScore: 62,
    minimumValueLength: 3,
    doNotGuessMissingValues: true,
    rejectWeakValues: true,
    sendWeakMatchesToReview: true
  },
  sectionRules: [
    { concept: "keyInformation", targetAliases: ["key information", "summary", "basic details", "main details"], sourceSignals: ["vessel", "port", "country", "cargo", "agent", "time zone", "arrival", "berth"], negativeSignals: ["remarks", "notes", "crew change", "shore leave"] },
    { concept: "arrivalPortStay", targetAliases: ["arrival", "port stay", "date", "eta", "etb", "etd"], sourceSignals: ["arrival", "date of arrival", "eta", "etb", "etd", "notice", "port stay", "anchored"], negativeSignals: ["agent", "invoice", "charts", "publications"] },
    { concept: "anchorage", targetAliases: ["anchorage", "anchor", "waiting area"], sourceSignals: ["anchorage", "anchor", "anchored", "waiting", "roads", "outer anchorage"], negativeSignals: ["agent", "invoice", "cargo declaration"] },
    { concept: "pilotageNavigation", targetAliases: ["pilotage", "approach", "navigation", "pilot", "vhf", "communication"], sourceSignals: ["pilot", "pilotage", "vhf", "channel", "boarding", "pilot ladder", "tug", "towage", "navigation", "approach"], negativeSignals: ["agent", "invoice", "cargo declaration", "supplier"] },
    { concept: "berthTerminalDepth", targetAliases: ["berth", "terminal", "depth", "draft", "draught", "pier", "jetty"], sourceSignals: ["berth", "terminal", "pier", "jetty", "depth", "draft", "draught", "quay", "channel", "density", "salinity"], negativeSignals: ["agent", "crew", "documents", "invoice"] },
    { concept: "cargoOperations", targetAliases: ["cargo", "operations", "loading", "discharging", "rate"], sourceSignals: ["cargo", "loading", "discharging", "operation", "rate", "shore scale", "loading rate", "discharging rate"], negativeSignals: ["agent", "pilot", "charts", "crew"] },
    { concept: "agentsContacts", targetAliases: ["agent", "agents", "contact", "agency"], sourceSignals: ["agent", "agents", "agency", "contact", "phone", "email", "mobile", "pic"], negativeSignals: ["cargo", "pilot", "berth", "depth", "draft"] },
    { concept: "documentsFormalities", targetAliases: ["documents", "formalities", "pre arrival", "requirements"], sourceSignals: ["documents", "crew list", "declaration", "certificate", "manifest", "passport", "ballast", "pre arrival", "formalities"], negativeSignals: ["agent contact", "berth depth", "cargo rate"] },
    { concept: "regulationsRestrictions", targetAliases: ["regulations", "restrictions", "security", "health", "shore leave", "crew change"], sourceSignals: ["regulations", "restriction", "security", "isps", "health", "shore leave", "crew change", "inspection", "psc", "permitted", "not permitted"], negativeSignals: ["cargo rate", "berth depth", "agent email"] },
    { concept: "servicesSupplies", targetAliases: ["services", "supplies", "waste", "fresh water", "bunkers"], sourceSignals: ["garbage", "bunker", "fresh water", "sludge", "stores", "provisions", "waste", "supply", "supplies"], negativeSignals: ["pilot", "vhf", "charts"] },
    { concept: "publicationsCharts", targetAliases: ["publications", "charts", "nautical charts", "reference"], sourceSignals: ["charts", "publications", "enc", "enp", "admiralty", "pilot vol", "sailing directions"], negativeSignals: ["agent", "cargo", "invoice"] },
    { concept: "remarksNotes", targetAliases: ["remarks", "notes", "experience", "detailed notes", "additional information"], sourceSignals: ["remarks", "note", "general information", "additional", "experience", "observed"], negativeSignals: [] }
  ],
  fieldRules: [
    { concept: "vesselName", targetAliases: ["vessel", "vessel name", "ship", "m/v", "mv"], sourcePatterns: ["Vessel: {value}", "Vessel Name: {value}", "M/V: {value}", "MV {value}"], sourceSignals: ["vessel", "vessel name", "ship", "m/v", "mv"] },
    { concept: "portName", targetAliases: ["port", "port name", "location"], sourcePatterns: ["Port: {value}", "Port Name: {value}", "Location: {value}"], sourceSignals: ["port", "port name", "location"] },
    { concept: "country", targetAliases: ["country"], sourcePatterns: ["Country: {value}"], sourceSignals: ["country"] },
    { concept: "arrivalDate", targetAliases: ["date", "arrival", "date of arrival", "eta", "etb", "etd", "port stay"], sourcePatterns: ["Date of Arrival: {value}", "Arrival: {value}", "ETA: {value}", "ETB: {value}", "ETD: {value}"], sourceSignals: ["date of arrival", "arrival", "eta", "etb", "etd", "port stay"] },
    { concept: "berthTerminal", targetAliases: ["berth", "terminal", "pier", "jetty"], sourcePatterns: ["Berth: {value}", "Berth Name: {value}", "Terminal: {value}", "Pier: {value}", "Jetty: {value}"], sourceSignals: ["berth", "berth name", "terminal", "pier", "jetty"] },
    { concept: "depthDraft", targetAliases: ["depth", "draft", "draught", "channel"], sourcePatterns: ["Depth: {value}", "Draft: {value}", "Draught: {value}", "Channel: {value}", "Berth Depth: {value}"], sourceSignals: ["depth", "draft", "draught", "channel", "berth depth"] },
    { concept: "cargo", targetAliases: ["cargo", "commodity"], sourcePatterns: ["Cargo: {value}", "Commodity: {value}"], sourceSignals: ["cargo", "commodity"] },
    { concept: "vhfCommunication", targetAliases: ["vhf", "communication", "channel", "radio"], sourcePatterns: ["VHF CHANNEL: {value}", "VHF: {value}", "Channel: {value}", "Pilot VHF: {value}"], sourceSignals: ["vhf", "channel", "radio", "communication"] },
    { concept: "agentContact", targetAliases: ["agent", "agent / contact", "agents", "agency", "contact"], sourcePatterns: ["Agent: {value}", "Agents: {value}", "Agency: {value}", "Contact: {value}"], sourceSignals: ["agent", "agents", "agency", "contact", "phone", "email", "mobile"] },
    { concept: "publicationsCharts", targetAliases: ["publications", "charts", "enc", "enp"], sourcePatterns: ["ENC: {value}", "Charts: {value}", "Publications: {value}"], sourceSignals: ["enc", "charts", "publications", "enp", "admiralty"] }
  ]
};

bindEvents();
setInitialState();

function bindEvents() {
  els.templatePdfInput?.addEventListener("change", handleTemplateUpload);
  els.sourcePdfInput?.addEventListener("change", handleSourceUpload);
  els.processBtn?.addEventListener("click", processDocuments);
  els.exportPdfBtn?.addEventListener("click", exportPdf);
  els.exportAuditBtn?.addEventListener("click", exportAuditLog);
  els.resetBtn?.addEventListener("click", resetTool);
}

function setInitialState() {
  if (els.exportPdfBtn) els.exportPdfBtn.disabled = true;
  if (els.exportAuditBtn) els.exportAuditBtn.disabled = true;
  setStatus("Upload a sample/template PDF and one or more source PDFs.");
}

function handleTemplateUpload(event) {
  const file = event.target.files?.[0] || null;
  state.templateFile = file;
  state.templateContract = null;

  if (!file) {
    els.templateFileInfo.textContent = "No template uploaded yet.";
    setStatus("Template removed.");
    return;
  }

  els.templateFileInfo.textContent = `Template selected: ${file.name}`;
  setStatus("Template PDF uploaded.");
}

function handleSourceUpload(event) {
  const files = Array.from(event.target.files || []);
  state.sourceFiles = files;
  state.documents = [];

  if (!files.length) {
    els.sourceFileInfo.textContent = "No source documents uploaded yet.";
    setStatus("Source documents removed.");
    return;
  }

  els.sourceFileInfo.innerHTML = files
    .map((file, index) => `${index + 1}. ${escapeHtml(file.name)}`)
    .join("<br>");

  setStatus(`${files.length} source PDF(s) uploaded.`);
}

function getController() {
  return state.templateController || {};
}

function getDetectionRules() {
  return getController().detectionRules || {};
}

function getOutputRules() {
  return getController().outputRules || {};
}

function getVisualRules() {
  return getController().visualRules || {};
}

function getRuleEngine() {
  const remote = getController().ruleEngine || {};
  const remoteSectionRules = Array.isArray(remote.sectionRules) ? remote.sectionRules : [];
  const remoteFieldRules = Array.isArray(remote.fieldRules) ? remote.fieldRules : [];

  return {
    ...LOCAL_FALLBACK_RULE_ENGINE,
    ...remote,
    visuals: {
      ...LOCAL_FALLBACK_RULE_ENGINE.visuals,
      ...(remote.visuals || {})
    },
    qualityRules: {
      ...LOCAL_FALLBACK_RULE_ENGINE.qualityRules,
      ...(remote.qualityRules || {})
    },
    sectionRules: remoteSectionRules.length ? remoteSectionRules : LOCAL_FALLBACK_RULE_ENGINE.sectionRules,
    fieldRules: remoteFieldRules.length ? remoteFieldRules : LOCAL_FALLBACK_RULE_ENGINE.fieldRules
  };
}

function getQualityRules() {
  return getRuleEngine().qualityRules || {};
}

function getSectionRules() {
  return Array.isArray(getRuleEngine().sectionRules) ? getRuleEngine().sectionRules : [];
}

function getFieldRules() {
  return Array.isArray(getRuleEngine().fieldRules) ? getRuleEngine().fieldRules : [];
}

function getFallbackValue() {
  return (
    getDetectionRules().missingValue ||
    getController().fallbackValue ||
    getRuleEngine().fallbackValue ||
    "Not Available"
  );
}

function boolRule(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function scoreFromPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number > 1 ? number / 100 : number;
}

function getMinimumSectionScore() {
  return scoreFromPercent(getQualityRules().minimumSectionScore, CONFIG.mapping.minSectionScore);
}

function getMinimumFieldScore() {
  return scoreFromPercent(getQualityRules().minimumFieldScore, CONFIG.mapping.minFieldScore);
}

function getMinimumValueLength() {
  const value = Number(getQualityRules().minimumValueLength);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function isVisualCaptureEnabled() {
  const detectionValue = boolRule(getDetectionRules().detectVisuals, false);
  const ruleEngineValue = boolRule(getRuleEngine().visuals?.enabled, detectionValue);
  return detectionValue && ruleEngineValue;
}

async function processDocuments() {
  if (!state.templateFile) {
    setStatus("Please upload a sample/template PDF first.", "error");
    return;
  }

  if (!state.sourceFiles.length) {
    setStatus("Please upload at least one source PDF.", "error");
    return;
  }

  resetOutputOnly();

  try {
    setStatus("Loading Firebase template controller...");
    state.templateController = await loadTemplateController();
    console.log("Firebase Template Controller:", state.templateController);

    setStatus("Reading sample/template structure...");
    const templatePdf = await extractPdf(state.templateFile, { collectVisuals: false });
    const templateContract = buildTemplateContract(templatePdf);
    validateTemplateContract(templateContract);
    state.templateContract = templateContract;

    const documents = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];
      setStatus(`Processing ${file.name} (${i + 1} of ${state.sourceFiles.length})...`);

      const sourcePdf = await extractPdf(file, { collectVisuals: isVisualCaptureEnabled() });
      const sourceProfile = buildSourceProfile(sourcePdf);
      const documentModel = await buildDocumentModel({
        sourcePdf,
        sourceProfile,
        templateContract
      });

      documents.push(documentModel);
    }

    state.documents = documents;
    state.auditLog = buildAuditLog(templateContract, documents);

    renderPreview(documents);
    renderDetectedDetails(templateContract, documents);
    renderVisualPreview(documents);

    els.exportPdfBtn.disabled = false;
    els.exportAuditBtn.disabled = false;

    setStatus("Processing complete. Review the preview before exporting.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`, "error");
  }
}

/* =========================================================
   PDF EXTRACTION
   ========================================================= */

async function extractPdf(file, options = {}) {
  const collectVisuals = options.collectVisuals ?? false;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true,
    disableFontFace: false
  }).promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setStatus(`Reading ${file.name} - page ${pageNumber} of ${pdf.numPages}`);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const items = textContent.items
      .map((item) => toTextItem(item))
      .filter((item) => item.text.trim());

    const lines = buildLines(items, viewport);
    const pageText = lines.map((line) => line.text).join("\n");

    let renderedPage = null;
    let visualCandidates = [];

    if (collectVisuals && boolRule(getDetectionRules().detectVisuals, false)) {
      renderedPage = await renderPageToDataUrl(page, CONFIG.extraction.renderScale);
      visualCandidates = detectVisualCandidates({
        pageNumber,
        viewport,
        lines,
        renderedPage
      });
    }

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      items,
      lines,
      text: cleanExtractedText(pageText),
      renderedPage,
      visualCandidates
    });
  }

  const fullText = cleanExtractedText(
    pages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n")
  );

  return {
    fileName: file.name,
    pageCount: pdf.numPages,
    pages,
    fullText
  };
}

function toTextItem(item) {
  const tx = item.transform || [1, 0, 0, 1, 0, 0];
  const x = tx[4] || 0;
  const y = tx[5] || 0;
  const height = Math.abs(tx[3] || item.height || 0) || item.height || 0;

  return {
    text: item.str || "",
    x,
    y,
    width: item.width || 0,
    height,
    fontName: item.fontName || "",
    dir: item.dir || "ltr"
  };
}

function buildLines(items, viewport) {
  if (!items.length) return [];

  const sorted = [...items].sort((a, b) => {
    const yDiff = Math.round(b.y) - Math.round(a.y);
    if (Math.abs(yDiff) > CONFIG.extraction.lineYTolerance) return yDiff;
    return a.x - b.x;
  });

  const lineGroups = [];

  for (const item of sorted) {
    let target = null;

    for (const group of lineGroups) {
      if (Math.abs(group.y - item.y) <= CONFIG.extraction.lineYTolerance) {
        target = group;
        break;
      }
    }

    if (!target) {
      target = { y: item.y, items: [] };
      lineGroups.push(target);
    }

    target.items.push(item);
  }

  return lineGroups
    .sort((a, b) => b.y - a.y)
    .map((group) => {
      const lineItems = group.items.sort((a, b) => a.x - b.x);
      const text = joinLineItems(lineItems);
      const xMin = Math.min(...lineItems.map((item) => item.x));
      const xMax = Math.max(...lineItems.map((item) => item.x + item.width));
      const avgHeight = average(lineItems.map((item) => item.height).filter(Boolean));

      return {
        text: normalizeLine(text),
        x: xMin,
        y: group.y,
        width: xMax - xMin,
        height: avgHeight || 9,
        top: viewport.height - group.y - (avgHeight || 9),
        bottom: viewport.height - group.y + 3,
        pageTopY: viewport.height - group.y,
        fontSize: avgHeight || 9,
        isBoldish: lineItems.some((item) => /bold|black|heavy/i.test(item.fontName || "")),
        itemCount: lineItems.length
      };
    })
    .filter((line) => line.text);
}

function joinLineItems(items) {
  let result = "";
  let previous = null;

  for (const item of items) {
    if (!previous) {
      result += item.text;
      previous = item;
      continue;
    }

    const gap = item.x - (previous.x + previous.width);
    const spaceThreshold = Math.max(2.2, previous.height * CONFIG.extraction.wordGapMultiplier);

    if (gap > spaceThreshold && !result.endsWith(" ")) result += " ";
    result += item.text;
    previous = item;
  }

  return result.replace(/\s+/g, " ").trim();
}

async function renderPageToDataUrl(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({ canvasContext: context, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL("image/png", 0.95),
    width: canvas.width,
    height: canvas.height,
    scale
  };
}

/* =========================================================
   VISUAL DETECTION
   ========================================================= */

function detectVisualCandidates({ pageNumber, viewport, lines, renderedPage }) {
  if (!renderedPage) return [];

  const visualRules = getVisualRules();
  const rejectPercent = visualRules.rejectIfTextDensityAbovePercent ?? visualRules.rejectIfTextDensityAbove ?? 18;
  const rejectRatio = rejectPercent / 100;
  const rejectTextHeavyCrops = boolRule(visualRules.rejectTextHeavyCrops, true);
  const minVisualHeight = visualRules.minVisualHeight ?? 95;

  const bodyLines = lines.filter((line) => {
    const top = viewport.height - line.y;
    return top > 70 && top < viewport.height - 55;
  });

  const textCoverage = bodyLines.reduce((sum, line) => {
    return sum + Math.max(0, line.width * Math.max(line.height, 8));
  }, 0);

  const pageArea = viewport.width * viewport.height;
  const textCoverageRatio = textCoverage / pageArea;

  const hasSparseText = textCoverageRatio < rejectRatio;
  const hasLikelyFigureKeywords = lines.some((line) =>
    /visual reference|diagram|image|photo|figure|map|berth plan|terminal plan|layout|plan|chart/i.test(line.text)
  );

  if (rejectTextHeavyCrops && textCoverageRatio > rejectRatio && !hasLikelyFigureKeywords) return [];
  if (!hasSparseText && !hasLikelyFigureKeywords) return [];

  const cueLine = bodyLines.find((line) =>
    /visual reference|diagram|image|photo|figure|map|layout|berth plan|terminal plan|chart/i.test(line.text)
  );

  let cropTop = cueLine ? cueLine.bottom + 6 : 70;
  let cropBottom = viewport.height - 65;

  const denseTextAfterCue = bodyLines.find(
    (line) => line.top > cropTop + 80 && line.text.length > 35 && line.width > viewport.width * 0.42
  );

  if (denseTextAfterCue && denseTextAfterCue.top - cropTop > minVisualHeight) {
    cropBottom = denseTextAfterCue.top - 8;
  }

  if (cropBottom - cropTop < minVisualHeight) return [];

  const crop = {
    x: 32,
    y: cropTop,
    width: viewport.width - 64,
    height: cropBottom - cropTop
  };

  const scaledCrop = {
    x: Math.round(crop.x * renderedPage.scale),
    y: Math.round(crop.y * renderedPage.scale),
    width: Math.round(crop.width * renderedPage.scale),
    height: Math.round(crop.height * renderedPage.scale)
  };

  return [
    {
      id: `visual-${pageNumber}-1`,
      pageNumber,
      crop,
      scaledCrop,
      fullPageDataUrl: renderedPage.dataUrl,
      renderedWidth: renderedPage.width,
      renderedHeight: renderedPage.height,
      confidence: hasLikelyFigureKeywords ? 0.78 : 0.48,
      textCoverageRatio
    }
  ];
}

async function cropRenderedVisual(visual) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { alpha: false });

      canvas.width = visual.scaledCrop.width;
      canvas.height = visual.scaledCrop.height;

      ctx.drawImage(
        image,
        visual.scaledCrop.x,
        visual.scaledCrop.y,
        visual.scaledCrop.width,
        visual.scaledCrop.height,
        0,
        0,
        canvas.width,
        canvas.height
      );

      resolve({
        ...visual,
        imageDataUrl: canvas.toDataURL("image/png", 0.95),
        imageWidth: canvas.width,
        imageHeight: canvas.height
      });
    };
    image.onerror = () => resolve(null);
    image.src = visual.fullPageDataUrl;
  });
}

/* =========================================================
   TEMPLATE CONTRACT
   ========================================================= */

function buildTemplateContract(templatePdf) {
  const title = inferDocumentTitle(templatePdf.fullText, templatePdf.fileName);
  const headings = detectStructuredHeadings(templatePdf.pages, title);

  let sections = headings
    .map((heading, index) => ({
      id: `template-section-${index + 1}`,
      order: index + 1,
      heading: cleanHeading(heading.text),
      sourcePageNumber: heading.pageNumber,
      confidence: heading.confidence
    }))
    .filter((section) => section.heading)
    .filter((section) => !isBlockedText(section.heading))
    .filter((section) => !isDuplicateTitle(section.heading, title));

  sections = dedupeSections(sections).slice(0, CONFIG.structure.maxTemplateSections);

  const headerFields = detectTemplateHeaderFields(templatePdf, sections);

  return {
    fileName: templatePdf.fileName,
    pageCount: templatePdf.pageCount,
    title,
    headerFields,
    sections
  };
}

function validateTemplateContract(contract) {
  const detectionRules = getDetectionRules();
  const outputRules = getOutputRules();

  const minimumSections = detectionRules.minimumSections ?? 2;
  const minimumHeaderFields = detectionRules.minimumHeaderFields ?? 2;
  const showSummaryTable = boolRule(outputRules.showSummaryTable, true);

  if (contract.sections.length < minimumSections) {
    throw new Error(
      `Template is too weak. Detected ${contract.sections.length} section(s), but Firebase requires at least ${minimumSections}. Upload a clearer sample/template PDF.`
    );
  }

  if (showSummaryTable && contract.headerFields.length < minimumHeaderFields) {
    throw new Error(
      `Template header table is too weak. Detected ${contract.headerFields.length} header field(s), but Firebase requires at least ${minimumHeaderFields}. Upload a sample with a clearer Key Information/header table.`
    );
  }
}

function detectTemplateHeaderFields(templatePdf, sections) {
  if (!boolRule(getDetectionRules().detectHeaderTable, true)) return [];

  const keyInfoSection = sections.find((section) =>
    /key information|summary|basic details|main details|header/i.test(section.heading)
  );

  const maxPage = Math.min(templatePdf.pageCount, keyInfoSection ? keyInfoSection.sourcePageNumber + 1 : 2);
  const sampleText = templatePdf.pages
    .filter((page) => page.pageNumber <= maxPage)
    .map((page) => page.text)
    .join("\n");

  const found = [];
  const seen = new Set();

  for (const label of COMMON_HEADER_LABELS) {
    if (containsLooseLabel(sampleText, label)) {
      const key = comparable(label).replace(/\s+/g, "_");
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          id: `field-${found.length + 1}`,
          key,
          label,
          aliases: buildAliasesForLabel(label),
          order: found.length + 1
        });
      }
    }
  }

  const colonLabels = sampleText.match(/^.{2,60}:/gm) || [];
  for (const item of colonLabels) {
    const label = cleanHeading(item.replace(/:$/, ""));
    const key = comparable(label).replace(/\s+/g, "_");
    if (!label || isBlockedText(label) || looksLikeBodySentence(label) || seen.has(key)) continue;

    seen.add(key);
    found.push({
      id: `field-${found.length + 1}`,
      key,
      label,
      aliases: buildAliasesForLabel(label),
      order: found.length + 1
    });
  }

  return found;
}

function containsLooseLabel(text, label) {
  const source = comparable(text);
  const target = comparable(label);
  if (source.includes(target)) return true;
  return weightedTokenOverlap(tokenize(label), tokenize(text)) > 0.84;
}

function buildAliasesForLabel(label) {
  const lower = comparable(label);
  const aliases = new Set([label]);

  const groups = [
    ["vessel", ["vessel", "vessel name", "ship", "mv", "m/v"]],
    ["port", ["port", "port name", "location", "puerto"]],
    ["country", ["country"]],
    ["unlocode", ["unlocode", "unctad", "un/locode", "code"]],
    ["latitude longitude position", ["lat", "long", "latitude", "longitude", "position"]],
    ["time zone", ["time zone", "timezone", "gmt", "utc", "local time", "smt"]],
    ["port stay date", ["date", "date of arrival", "arrival", "eta", "etb", "etd", "port stay"]],
    ["berth pier terminal", ["berth", "pier", "terminal", "jetty", "berth name"]],
    ["cargo operations rate", ["loading rate", "discharging rate", "cargo operation", "cargo operations", "rate", "shore scale"]],
    ["cargo", ["cargo", "commodity"]],
    ["depth draft channel", ["depth", "draft", "draught", "channel", "fairway", "depth at anchorage"]],
    ["density", ["density", "water density", "salinity"]],
    ["tidal range", ["tidal range", "tide", "average tide"]],
    ["security level", ["security level", "security", "isps", "level"]],
    ["vhf communication", ["vhf", "vhf channel", "channel", "channels", "communication", "radio"]],
    ["agent contact", ["agent", "agents", "agency", "contact", "phone", "email", "mobile"]],
    ["publications charts", ["publication", "publications", "chart", "charts", "enc", "enp", "alrs"]]
  ];

  for (const [needle, values] of groups) {
    if (lower.includes(needle) || needle.includes(lower)) {
      values.forEach((value) => aliases.add(value));
    }
  }

  return Array.from(aliases);
}

function detectStructuredHeadings(pages, title) {
  const allLines = pages.flatMap((page) =>
    page.lines.map((line) => ({ ...line, pageNumber: page.pageNumber }))
  );

  const fontSizes = allLines.map((line) => line.fontSize).filter(Boolean);
  const medianFont = median(fontSizes) || 9;
  const candidates = [];

  for (const line of allLines) {
    const text = normalizeLine(line.text);
    if (!text) continue;
    if (text.length < CONFIG.structure.minHeadingLength) continue;
    if (text.length > CONFIG.structure.maxHeadingLength) continue;
    if (isBlockedText(text)) continue;
    if (isDuplicateTitle(text, title)) continue;
    if (looksLikeBodySentence(text)) continue;

    const patternScore = headingPatternScore(text);
    const fontScore = line.fontSize >= medianFont + 1.2 ? 0.3 : 0;
    const boldScore = line.isBoldish ? 0.18 : 0;
    const shortScore = text.split(/\s+/).length <= 8 ? 0.1 : 0;
    const score = patternScore + fontScore + boldScore + shortScore;

    if (score >= 0.35) {
      candidates.push({
        text,
        pageNumber: line.pageNumber,
        confidence: Number(Math.min(score, 0.95).toFixed(2))
      });
    }
  }

  return dedupeHeadingCandidates(candidates);
}

function headingPatternScore(text) {
  const clean = normalizeLine(text);
  const words = clean.split(/\s+/);

  if (/^\d{1,2}(\.\d{1,2})?\s*[).:-]?\s+\S+/.test(clean)) return 0.55;
  if (/^[A-Z]\.?\s+\S+/.test(clean)) return 0.42;
  if (/^(section|chapter|part|appendix|article)\s+[a-z0-9]/i.test(clean)) return 0.55;
  if (/^[A-Z0-9][A-Z0-9\s/&(),.'’-]{3,}$/.test(clean) && words.length <= 10) return 0.45;

  const titleCaseWords = words.filter((word) => /^[A-Z][a-zA-Z0-9/&()'’-]*$/.test(word));
  if (words.length >= 2 && words.length <= 9 && titleCaseWords.length / words.length >= 0.65) return 0.36;

  if (/^(port|vessel|cargo|berth|terminal|arrival|departure|agent|agency|restriction|requirement|contact|draft|loa|beam|dwt|anchorage|pilot|tug|weather|document|visual|summary|key)s?\b/i.test(clean)) return 0.38;

  return 0;
}

function dedupeHeadingCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    const cleaned = cleanHeading(candidate.text);
    const key = comparable(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...candidate, text: cleaned });
  }

  return result;
}

function dedupeSections(sections) {
  const seen = new Set();
  const result = [];

  for (const section of sections) {
    const key = comparable(section.heading);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(section);
  }

  return result.map((section, index) => ({ ...section, order: index + 1 }));
}

/* =========================================================
   SOURCE PROFILE + FACTS
   ========================================================= */

function buildSourceProfile(sourcePdf) {
  const title = inferDocumentTitle(sourcePdf.fullText, sourcePdf.fileName);
  const sections = splitSourceIntoSections(sourcePdf, title);
  const keyValueFacts = extractKeyValueFacts(sourcePdf.fullText);
  const implicitFacts = inferImplicitFacts(sourcePdf.fullText, sourcePdf.fileName);

  return {
    title,
    sections,
    keyValueFacts: dedupeFacts([...keyValueFacts, ...implicitFacts])
  };
}

function splitSourceIntoSections(sourcePdf, title) {
  const detectedHeadings = detectStructuredHeadings(sourcePdf.pages, title);
  const headingByPageAndText = new Map();

  detectedHeadings.forEach((heading) => {
    headingByPageAndText.set(`${heading.pageNumber}|${comparable(heading.text)}`, heading);
  });

  const sections = [];
  let current = makeSection("General Details", 1);

  for (const page of sourcePdf.pages) {
    for (const line of page.lines) {
      const text = normalizeLine(line.text);
      if (!text || isBlockedText(text)) continue;

      const key = `${page.pageNumber}|${comparable(cleanHeading(text))}`;
      const isHeading = headingByPageAndText.has(key);

      if (isHeading && current.lines.length) {
        pushSection(current);
        current = makeSection(cleanHeading(text), page.pageNumber);
      } else if (isHeading && !current.lines.length && current.heading === "General Details") {
        current.heading = cleanHeading(text);
        current.pageNumber = page.pageNumber;
        current.pageNumbers = new Set([page.pageNumber]);
      } else {
        current.lines.push(text);
        current.pageNumbers.add(page.pageNumber);
      }
    }
  }

  pushSection(current);
  const merged = mergeWeakSections(sections);

  if (!merged.length && sourcePdf.fullText) {
    merged.push({
      id: "source-section-1",
      heading: "Main Details",
      content: cleanBusinessContent(sourcePdf.fullText),
      pageNumber: 1,
      pageNumbers: [1],
      tokens: tokenize(sourcePdf.fullText)
    });
  }

  return merged.map((section, index) => ({ ...section, id: `source-section-${index + 1}` }));

  function makeSection(heading, pageNumber) {
    return { heading, pageNumber, pageNumbers: new Set([pageNumber]), lines: [] };
  }

  function pushSection(section) {
    const content = cleanBusinessContent(section.lines.join("\n"));
    const heading = cleanHeading(section.heading || "General Details");

    if (!content && heading === "General Details") return;
    if (isBlockedText(heading)) return;

    sections.push({
      id: "",
      heading: heading || "General Details",
      content,
      pageNumber: section.pageNumber,
      pageNumbers: Array.from(section.pageNumbers).sort((a, b) => a - b),
      tokens: tokenize(`${heading}\n${content}`)
    });
  }
}

function mergeWeakSections(sections) {
  const result = [];

  for (const section of sections) {
    const content = cleanBusinessContent(section.content);
    const heading = cleanHeading(section.heading);

    if (!content && !heading) continue;

    const isTiny = content.length < 90 && heading !== "General Details";
    const shouldMerge = isTiny && result.length && !/^\d{1,2}(\.\d{1,2})?\s+/.test(heading);

    if (shouldMerge) {
      const previous = result[result.length - 1];
      previous.content = cleanBusinessContent(`${previous.content}\n\n${heading}\n${content}`);
      previous.pageNumbers = uniqueNumbers([...previous.pageNumbers, ...section.pageNumbers]);
      previous.tokens = tokenize(`${previous.heading}\n${previous.content}`);
    } else {
      result.push({ ...section, heading, content, tokens: tokenize(`${heading}\n${content}`) });
    }
  }

  return result;
}

function extractKeyValueFacts(text) {
  const facts = [];
  const lines = cleanExtractedText(text).split("\n").map(normalizeLine).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlockedText(line)) continue;

    const match = line.match(/^(.{2,65}?)(?:\s*[:\-–—]\s+|\s{2,})(.{2,220})$/);
    if (match) {
      const key = cleanHeading(match[1]);
      const value = normalizeLine(match[2]);
      if (key && value && !looksLikeBodySentence(key)) {
        facts.push({ key, value, evidence: line, tokens: tokenize(`${key} ${value}`), confidence: 0.78 });
      }
      continue;
    }

    const next = lines[i + 1] || "";
    if (looksLikeStandaloneLabel(line) && next && !looksLikeStandaloneLabel(next)) {
      facts.push({
        key: cleanHeading(line),
        value: normalizeLine(next),
        evidence: `${line} ${next}`,
        tokens: tokenize(`${line} ${next}`),
        confidence: 0.68
      });
    }
  }

  return facts;
}

function looksLikeStandaloneLabel(text) {
  const clean = cleanHeading(text);
  if (!clean || clean.length > 65 || looksLikeBodySentence(clean)) return false;
  return /^(agent|agents|documents|anchorage|berth|cargo|pilot|pilotage|charts|publications|regulations|services|contacts|port|vessel|time zone|date|arrival|location|customer|client|vendor|invoice)$/i.test(clean);
}

function inferImplicitFacts(fullText, fileName) {
  const facts = [];
  const text = cleanExtractedText(fullText);
  const fileTitle = cleanHeading(removePdfExtension(fileName).replace(/[_-]+/g, " "));

  addFactFromMatch(facts, "Latitude / Longitude / Position", text.match(/\b\d{1,2}(?:\.\d+)?\s*[\/ ,]+\s*-?\d{1,3}(?:\.\d+)?\b|\b\d{1,2}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[NS]\s+\d{2,3}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[EW]\b/i));
  addFactFromMatch(facts, "Time Zone", text.match(/\b(?:GMT|UTC|SMT)\s*[=:+\-\w\s]*-?\d{1,2}\s*(?:hrs|hours|h)?\b/i));
  addFactFromMatch(facts, "Port Stay / Date", text.match(/\bDate of Arrival\s*[:\-]?\s*([^\n]{2,80})/i), 1);
  addFactFromMatch(facts, "Cargo", text.match(/\bCargo\s*[:\-]?\s*([^\n]{2,90})/i), 1);
  addFactFromMatch(facts, "Depth / Draft / Channel", text.match(/\bDepth(?: at Anchorage)?\s*[:\-]?\s*([^\n]{2,60})/i), 1);
  addFactFromMatch(facts, "VHF / Communication", text.match(/\b(?:VHF(?: CHANNEL)?|PILOT:\s*VHF CHANNEL)\s*[:\-]?\s*(?:CH\s*)?([0-9;,/\s]{2,30})/i), 1, (value) => `CH ${normalizeChannels(value)}`);
  addFactFromMatch(facts, "Agent / Contact", text.match(/\bAgents?\s*[:\-]?\s*\n?([^\n]{2,100})/i), 1);
  addFactFromMatch(facts, "Publications / Charts", text.match(/\bENC\s*[:\-]?\s*([^\n]{2,140})/i), 1, (value) => `ENC: ${value}`);
  addFactFromMatch(facts, "Berth / Pier / Terminal", text.match(/\b(?:Berth Name|Berth|Terminal)\s*[:\-]?\s*\n?([^\n]{2,100})/i), 1);

  const portCountry = text.match(/\b([A-Z][A-Za-z.' ]{2,40}),\s*([A-Z][A-Za-z.' ]{2,40})\b/);
  if (portCountry) {
    facts.push(makeFact("Port Name", `${portCountry[1]}, ${portCountry[2]}`, portCountry[0], 0.78));
    facts.push(makeFact("Country", portCountry[2], portCountry[0], 0.76));
  }

  const year = fileTitle.match(/\b(20\d{2}|19\d{2})\b/);
  if (year) facts.push(makeFact("Year", year[1], fileTitle, 0.7));

  return facts;
}

function addFactFromMatch(facts, key, match, groupIndex = 0, transform = null) {
  if (!match) return;
  const raw = match[groupIndex] || match[0];
  const value = normalizeLine(transform ? transform(raw) : raw);
  if (!value || isBlockedText(value)) return;
  facts.push(makeFact(key, value, match[0], 0.82));
}

function makeFact(key, value, evidence, confidence = 0.75) {
  return { key, value, evidence, tokens: tokenize(`${key} ${value} ${evidence || ""}`), confidence };
}

function dedupeFacts(facts) {
  const seen = new Set();
  const result = [];

  for (const fact of facts) {
    const key = comparable(fact.key);
    const value = comparable(fact.value);
    if (!key || !value || value === "not available") continue;
    const sig = `${key}|${value}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    result.push(fact);
  }

  return result;
}

/* =========================================================
   DOCUMENT MODEL
   ========================================================= */

async function buildDocumentModel({ sourcePdf, sourceProfile, templateContract }) {
  const outputRules = getOutputRules();
  const showSummaryTable = boolRule(outputRules.showSummaryTable, true);
  const sectionNumbering = boolRule(outputRules.sectionNumbering, true);

  const summaryRows = showSummaryTable
    ? buildSummaryRows(templateContract.headerFields, sourceProfile.keyValueFacts)
    : [];

  const mappedSections = templateContract.sections.map((templateSection) => ({
    id: templateSection.id,
    order: templateSection.order,
    heading: templateSection.heading,
    blocks: [],
    matchedSourceIds: [],
    score: 0,
    pageNumbers: []
  }));

  const usedSourceIds = new Set();

  for (const sourceSection of sourceProfile.sections) {
    if (!sourceSection.content && !sourceSection.heading) continue;

    const best = findBestTemplateSection(sourceSection, mappedSections);

    if (best.index >= 0 && best.score >= getMinimumSectionScore()) {
      const target = mappedSections[best.index];
      const blockText = buildSectionBlockText(sourceSection, target.heading);

      if (blockText) {
        target.blocks.push({
          type: "text",
          text: blockText,
          sourceHeading: sourceSection.heading,
          pageNumbers: sourceSection.pageNumbers
        });
        target.matchedSourceIds.push(sourceSection.id);
        target.score = Math.max(target.score, best.score);
        target.pageNumbers = uniqueNumbers([...target.pageNumbers, ...sourceSection.pageNumbers]);
        usedSourceIds.add(sourceSection.id);
      }
    }
  }

  const unmapped = sourceProfile.sections.filter((section) => !usedSourceIds.has(section.id));
  const additional = cleanAdditionalSections(unmapped);

  if (additional.length) {
    const additionalTarget = findFallbackSection(mappedSections);

    if (additionalTarget) {
      for (const section of additional) {
        const blockText = buildSectionBlockText(section, additionalTarget.heading);
        if (!blockText) continue;

        additionalTarget.blocks.push({
          type: "text",
          text: blockText,
          sourceHeading: section.heading,
          pageNumbers: section.pageNumbers
        });
        additionalTarget.pageNumbers = uniqueNumbers([...additionalTarget.pageNumbers, ...section.pageNumbers]);
      }
    }
  }

  const finalSections = mappedSections
    .map((section) => ({ ...section, blocks: mergeTextBlocks(section.blocks) }))
    .filter((section) => section.blocks.some((block) => block.type === "text" && block.text.trim()));

  await attachVisualsToSections({ sourcePdf, sections: finalSections });

  return {
    sourceFileName: sourcePdf.fileName,
    title: buildOutputTitle(sourcePdf, sourceProfile),
    pageCount: sourcePdf.pageCount,
    summaryRows,
    sections: finalSections,
    sectionNumbering,
    sourceSectionCount: sourceProfile.sections.length,
    factsDetected: sourceProfile.keyValueFacts.length
  };
}

function buildSummaryRows(headerFields, facts) {
  return headerFields.map((field) => {
    const match = findBestFieldFact(field, facts);
    return {
      key: field.key,
      label: field.label,
      value: match ? match.value : getFallbackValue(),
      confidence: match ? match.confidence : 0,
      evidence: match ? match.evidence : ""
    };
  });
}

function findBestFieldFact(field, facts) {
  let best = null;
  let bestScore = 0;

  const aliases = [field.label, ...(field.aliases || [])];

  for (const fact of facts) {
    if (!isAcceptableFactValue(fact.value)) continue;

    const factText = `${fact.key} ${fact.value} ${fact.evidence || ""}`;
    const haystack = comparable(factText);
    let score = 0;

    for (const alias of aliases) {
      const aliasValue = comparable(alias);
      if (!aliasValue) continue;

      if (haystack.includes(aliasValue)) score = Math.max(score, 0.88);
      score = Math.max(score, weightedTokenOverlap(tokenize(alias), tokenize(factText)));
    }

    score = Math.max(score, semanticFieldScore(field.label, fact));
    score = Math.max(score, scoreFieldWithRuleEngine(field, fact));

    if (score > bestScore) {
      bestScore = score;
      best = fact;
    }
  }

  if (!best || bestScore < getMinimumFieldScore()) return null;
  return { ...best, confidence: Number(bestScore.toFixed(2)) };
}

function scoreFieldWithRuleEngine(field, fact) {
  const rules = getFieldRules();
  if (!rules.length) return 0;

  const fieldText = comparable(`${field.label} ${(field.aliases || []).join(" ")}`);
  const factText = comparable(`${fact.key} ${fact.value} ${fact.evidence || ""}`);
  let best = 0;

  for (const rule of rules) {
    const targetAliases = Array.isArray(rule.targetAliases) ? rule.targetAliases : [];
    const sourceSignals = Array.isArray(rule.sourceSignals) ? rule.sourceSignals : [];
    const sourcePatterns = Array.isArray(rule.sourcePatterns) ? rule.sourcePatterns : [];

    const targetHits = targetAliases.filter((alias) => {
      const value = comparable(alias);
      return value && fieldText.includes(value);
    }).length;

    if (!targetHits) continue;

    const signalHits = sourceSignals.filter((signal) => {
      const value = comparable(signal);
      return value && factText.includes(value);
    }).length;

    const patternHits = sourcePatterns.filter((pattern) => {
      const value = comparable(String(pattern).replace("{value}", ""));
      return value && factText.includes(value);
    }).length;

    if (!signalHits && !patternHits) continue;

    const score = Math.min(0.95, 0.42 + targetHits * 0.12 + signalHits * 0.11 + patternHits * 0.08);
    best = Math.max(best, score);
  }

  return best;
}

function isAcceptableFactValue(value) {
  const clean = normalizeLine(String(value || ""));
  const normalized = comparable(clean);
  const fallback = comparable(getFallbackValue());

  if (!clean) return false;
  if (normalized === fallback) return false;
  if (clean.length < getMinimumValueLength()) return false;
  if (/^[\W_]+$/.test(clean)) return false;
  if (/^[a-zA-Z]:?$/.test(clean)) return false;
  if (/^(n\/?a|nil|null|none|unknown)$/i.test(clean)) return false;

  return true;
}

function semanticFieldScore(label, fact) {
  const field = comparable(label);
  const text = comparable(`${fact.key} ${fact.value} ${fact.evidence || ""}`);

  const checks = [
    ["vessel", ["vessel", "ship", "m v", "mv"]],
    ["port", ["port", "puerto", "location"]],
    ["country", ["country", "colombia", "brazil", "india", "usa", "singapore"]],
    ["latitude longitude position", ["lat", "long", "position"]],
    ["time zone", ["gmt", "utc", "time zone", "smt"]],
    ["port stay date", ["date of arrival", "arrival", "eta", "etb", "etd"]],
    ["berth pier terminal", ["berth", "terminal", "pier", "jetty"]],
    ["cargo operations rate", ["loading", "discharging", "rate", "operation"]],
    ["cargo", ["cargo"]],
    ["depth draft channel", ["depth", "draft", "draught", "channel"]],
    ["density", ["density", "salinity"]],
    ["tidal range", ["tide", "tidal"]],
    ["security level", ["security", "isps"]],
    ["vhf communication", ["vhf", "channel", "ch"]],
    ["agent contact", ["agent", "agents", "agency", "contact", "email", "phone", "mobile"]],
    ["publications charts", ["chart", "charts", "publication", "enc", "enp"]]
  ];

  for (const [needle, aliases] of checks) {
    if (field.includes(needle)) {
      const hits = aliases.filter((alias) => text.includes(alias)).length;
      if (hits) return Math.min(0.94, 0.44 + hits * 0.13 + (fact.confidence || 0) * 0.15);
    }
  }

  return 0;
}

function findBestTemplateSection(sourceSection, mappedSections) {
  let bestIndex = -1;
  let bestScore = 0;

  mappedSections.forEach((templateSection, index) => {
    const score = scoreSectionMatch(templateSection.heading, sourceSection);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return { index: bestIndex, score: Number(bestScore.toFixed(3)) };
}

function scoreSectionMatch(templateHeading, sourceSection) {
  const templateTokens = tokenize(templateHeading);
  const sourceHeadingTokens = tokenize(sourceSection.heading);
  const sourceContentTokens = tokenize(sourceSection.content).slice(0, 180);

  if (!templateTokens.length) return 0;

  const sourceText = `${sourceSection.heading}\n${sourceSection.content}`;
  const headingScore = weightedTokenOverlap(templateTokens, sourceHeadingTokens);
  const contentScore = weightedTokenOverlap(templateTokens, sourceContentTokens);
  const semanticScore = semanticBoost(templateHeading, sourceText);
  const ruleEngineScore = scoreSectionWithRuleEngine(templateHeading, sourceText);

  return Math.min(
    1,
    headingScore * 0.32 +
      contentScore * 0.16 +
      semanticScore * 0.18 +
      ruleEngineScore * 0.34
  );
}

function scoreSectionWithRuleEngine(templateHeading, sourceText) {
  const rules = getSectionRules();
  if (!rules.length) return 0;

  const target = comparable(templateHeading);
  const source = comparable(sourceText);
  let best = 0;

  for (const rule of rules) {
    const targetAliases = Array.isArray(rule.targetAliases) ? rule.targetAliases : [];
    const sourceSignals = Array.isArray(rule.sourceSignals) ? rule.sourceSignals : [];
    const negativeSignals = Array.isArray(rule.negativeSignals) ? rule.negativeSignals : [];

    const targetHits = targetAliases.filter((alias) => {
      const value = comparable(alias);
      return value && target.includes(value);
    }).length;

    if (!targetHits) continue;

    const sourceHits = sourceSignals.filter((signal) => {
      const value = comparable(signal);
      return value && source.includes(value);
    }).length;

    if (!sourceHits) continue;

    const negativeHits = negativeSignals.filter((signal) => {
      const value = comparable(signal);
      return value && source.includes(value);
    }).length;

    const targetScore = Math.min(0.35, targetHits * 0.18);
    const signalScore = Math.min(0.75, sourceHits * 0.13);
    const penalty = Math.min(0.45, negativeHits * 0.15);
    const total = Math.max(0, targetScore + signalScore - penalty);

    best = Math.max(best, total);
  }

  return Math.min(1, best);
}

function semanticBoost(templateHeading, sourceText) {
  const h = comparable(templateHeading);
  const s = comparable(sourceText);

  const groups = [
    { labels: ["key information", "summary", "basic details"], keys: ["vessel", "port", "country", "cargo", "agent", "time zone"] },
    { labels: ["visual", "image", "reference"], keys: ["visual reference", "image", "figure", "map", "diagram", "photo"] },
    { labels: ["overview", "about"], keys: ["overview", "about", "located", "port is"] },
    { labels: ["arrival", "port stay", "date"], keys: ["arrival", "eta", "etb", "etd", "notice", "pilot station", "date of arrival"] },
    { labels: ["anchorage"], keys: ["anchorage", "anchor", "anchored"] },
    { labels: ["pilotage", "approach", "navigation"], keys: ["pilot", "vhf", "channel", "boarding", "ladder", "towage", "tug", "navigation"] },
    { labels: ["berth", "terminal", "depth"], keys: ["berth", "terminal", "jetty", "depth", "draft", "quay", "salinity"] },
    { labels: ["cargo", "operations"], keys: ["cargo", "loading", "discharging", "shore", "scale", "rate"] },
    { labels: ["agent", "contact"], keys: ["agent", "agents", "agency", "email", "phone", "mobile", "contact"] },
    { labels: ["document", "formalities", "pre arrival"], keys: ["documents", "crew list", "declaration", "certificate", "manifest", "passport", "ballast"] },
    { labels: ["regulation", "security", "health", "shore leave", "crew change"], keys: ["regulations", "shore leave", "crew", "security", "health", "permitted", "inspection", "psc"] },
    { labels: ["services", "supplies", "waste"], keys: ["garbage", "bunker", "fresh water", "sludge", "stores", "provisions", "waste"] },
    { labels: ["publication", "chart"], keys: ["charts", "publications", "enc", "enp", "pilot vol"] },
    { labels: ["remarks", "experience", "notes", "detailed"], keys: ["remarks", "note", "general information", "additional"] }
  ];

  let boost = 0;
  for (const group of groups) {
    const headingHit = group.labels.some((label) => h.includes(label));
    if (!headingHit) continue;
    const sourceHits = group.keys.filter((key) => s.includes(key)).length;
    if (sourceHits) boost = Math.max(boost, Math.min(0.9, 0.25 + sourceHits * 0.1));
  }

  return boost;
}

function buildSectionBlockText(sourceSection, targetHeading) {
  const content = cleanBusinessContent(sourceSection.content);
  const sourceHeading = cleanHeading(sourceSection.heading);

  if (!content && !sourceHeading) return "";

  const shouldKeepSourceHeading =
    sourceHeading &&
    sourceHeading !== "General Details" &&
    !isDuplicateTitle(sourceHeading, targetHeading) &&
    !sameMeaning(sourceHeading, targetHeading) &&
    !isBlockedText(sourceHeading);

  return shouldKeepSourceHeading && content
    ? cleanBusinessContent(`${sourceHeading}\n${content}`)
    : content || sourceHeading;
}

function cleanAdditionalSections(sections) {
  return sections
    .map((section) => ({
      ...section,
      heading: cleanHeading(section.heading),
      content: cleanBusinessContent(section.content)
    }))
    .filter((section) => section.content || section.heading)
    .filter((section) => !isBlockedText(section.heading))
    .filter((section) => !isBlockedText(section.content));
}

function findFallbackSection(mappedSections) {
  const outputRules = getOutputRules();
  const allowExtraSections = boolRule(outputRules.allowExtraSections, false);
  const fallbackSectionName = outputRules.fallbackSectionName || "Detailed Notes";

  let section = mappedSections.find(
    (item) => comparable(item.heading) === comparable(fallbackSectionName)
  );

  if (section) return section;
  if (!allowExtraSections) return null;

  section = {
    id: `template-section-${mappedSections.length + 1}`,
    order: mappedSections.length + 1,
    heading: fallbackSectionName,
    blocks: [],
    matchedSourceIds: [],
    score: 0,
    pageNumbers: []
  };

  mappedSections.push(section);
  return section;
}

function mergeTextBlocks(blocks) {
  const result = [];

  for (const block of blocks) {
    if (block.type !== "text") {
      result.push(block);
      continue;
    }

    const text = cleanBusinessContent(block.text);
    if (!text) continue;

    const previous = result[result.length - 1];
    if (previous && previous.type === "text") {
      previous.text = cleanBusinessContent(`${previous.text}\n\n${text}`);
      previous.pageNumbers = uniqueNumbers([...(previous.pageNumbers || []), ...(block.pageNumbers || [])]);
    } else {
      result.push({ ...block, text });
    }
  }

  return result;
}

async function attachVisualsToSections({ sourcePdf, sections }) {
  const candidates = sourcePdf.pages.flatMap((page) => page.visualCandidates || []);
  const limited = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, CONFIG.extraction.maxVisualsPerDocument);

  for (const visual of limited) {
    const cropped = await cropRenderedVisual(visual);
    if (!cropped?.imageDataUrl) continue;

    let target = sections.find((section) => /visual/i.test(section.heading));
    if (!target) target = sections.find((section) => section.pageNumbers.includes(visual.pageNumber));
    if (!target && sections.length) target = sections[0];
    if (!target) continue;

    target.blocks.push({
      type: "image",
      imageDataUrl: cropped.imageDataUrl,
      imageWidth: cropped.imageWidth,
      imageHeight: cropped.imageHeight,
      pageNumber: visual.pageNumber
    });
  }
}

function buildOutputTitle(sourcePdf, sourceProfile) {
  const title = cleanDocumentTitle(sourceProfile.title || inferDocumentTitle(sourcePdf.fullText, sourcePdf.fileName));
  return title || cleanDocumentTitle(removePdfExtension(sourcePdf.fileName).replace(/[_-]+/g, " "));
}

/* =========================================================
   PREVIEW / EXPORT
   ========================================================= */

function renderPreview(documents) {
  const text = documents.map(documentToPlainText).join("\n\n");
  els.formattedPreview.value = text.trim();
}

function documentToPlainText(doc) {
  const lines = [];
  lines.push(cleanDocumentTitle(doc.title));
  lines.push("");

  if (doc.summaryRows?.length) {
    lines.push("1. Key Information");
    lines.push("");
    for (const row of doc.summaryRows) {
      lines.push(`${row.label}: ${row.value || getFallbackValue()}`);
    }
    lines.push("");
  }

  const offset = doc.summaryRows?.length ? 2 : 1;

  doc.sections.forEach((section, index) => {
    const heading = cleanHeading(section.heading);
    if (!heading || isBlockedText(heading)) return;

    lines.push(`${index + offset}. ${heading}`);
    lines.push("");

    for (const block of section.blocks) {
      if (block.type === "text") {
        const text = cleanBusinessContent(block.text);
        if (text) {
          lines.push(text);
          lines.push("");
        }
      }

      if (block.type === "image") {
        lines.push("[Image/visual content retained in PDF export]");
        lines.push("");
      }
    }
  });

  return cleanBusinessContent(lines.join("\n"));
}

async function exportPdf() {
  if (!state.documents.length) {
    setStatus("No processed document available to export.", "error");
    return;
  }

  try {
    setStatus("Generating PDF...");

    const pdfDoc = await PDFDocument.create();
    const fonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    };

    for (let i = 0; i < state.documents.length; i++) {
      if (i > 0) addBlankPageBreak(pdfDoc);
      await addDocumentToPdf(pdfDoc, state.documents[i], fonts);
    }

    const bytes = await pdfDoc.save();
    const fileName =
      state.documents.length === 1
        ? buildOutputFileName(state.documents[0].sourceFileName)
        : "Updated_Documents.pdf";

    downloadBlob(bytes, fileName, "application/pdf");
    setStatus("PDF exported successfully.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Export failed: ${error.message}`, "error");
  }
}

async function addDocumentToPdf(pdfDoc, doc, fonts) {
  const pageSize = { width: CONFIG.output.pageWidth, height: CONFIG.output.pageHeight };
  const margin = CONFIG.output.margin;
  const contentWidth = pageSize.width - margin * 2;
  const title = cleanDocumentTitle(doc.title);

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = drawPageHeader(page, title, fonts, pageSize, margin);

  y = drawTitle(page, title, fonts, margin, y);

  if (doc.summaryRows?.length) {
    if (y < margin + 260) {
      drawPageFooter(page, title, fonts, pageSize, margin);
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = drawPageHeader(page, title, fonts, pageSize, margin);
    }

    y = drawSectionHeading(page, "1. Key Information", fonts, margin, contentWidth, y);
    y = drawSummaryTable(page, doc.summaryRows, fonts, margin, contentWidth, y);
    y -= CONFIG.output.sectionGap;
  }

  const offset = doc.summaryRows?.length ? 2 : 1;

  for (let s = 0; s < doc.sections.length; s++) {
    const section = doc.sections[s];
    const heading = `${s + offset}. ${cleanHeading(section.heading)}`;

    if (isBlockedText(heading)) continue;

    if (y < margin + 95) {
      drawPageFooter(page, title, fonts, pageSize, margin);
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = drawPageHeader(page, title, fonts, pageSize, margin);
    }

    y = drawSectionHeading(page, heading, fonts, margin, contentWidth, y);

    for (const block of section.blocks) {
      if (block.type === "text") {
        const paragraphs = splitParagraphs(block.text);
        for (const paragraph of paragraphs) {
          const lines = wrapTextToWidth(paragraph, fonts.regular, CONFIG.output.bodyFontSize, contentWidth);

          for (const line of lines) {
            if (y < margin + 48) {
              drawPageFooter(page, title, fonts, pageSize, margin);
              page = pdfDoc.addPage([pageSize.width, pageSize.height]);
              y = drawPageHeader(page, title, fonts, pageSize, margin);
            }

            page.drawText(sanitizeForPdf(line), {
              x: margin,
              y,
              size: CONFIG.output.bodyFontSize,
              font: fonts.regular,
              color: rgb(0.1, 0.12, 0.16)
            });

            y -= CONFIG.output.lineHeight;
          }

          y -= CONFIG.output.paragraphGap;
        }
      }

      if (block.type === "image" && block.imageDataUrl) {
        const imageResult = await embedPngFromDataUrl(pdfDoc, block.imageDataUrl);
        if (!imageResult) continue;

        const { image, width, height } = imageResult;
        const ratio = Math.min(contentWidth / width, CONFIG.output.figureMaxHeight / height, 1);
        const drawWidth = width * ratio;
        const drawHeight = height * ratio;

        if (y - drawHeight < margin + 48) {
          drawPageFooter(page, title, fonts, pageSize, margin);
          page = pdfDoc.addPage([pageSize.width, pageSize.height]);
          y = drawPageHeader(page, title, fonts, pageSize, margin);
        }

        page.drawImage(image, {
          x: margin,
          y: y - drawHeight,
          width: drawWidth,
          height: drawHeight
        });

        y -= drawHeight + 14;
      }
    }

    y -= CONFIG.output.sectionGap;
  }

  drawPageFooter(page, title, fonts, pageSize, margin);
}

function drawSummaryTable(page, rows, fonts, margin, contentWidth, y) {
  const rowHeight = CONFIG.output.tableRowHeight;
  const labelWidth = contentWidth * 0.28;
  const valueWidth = contentWidth * 0.72;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (y < margin + rowHeight + 35) break;

    const fill = i % 2 === 0 ? rgb(0.94, 0.97, 0.985) : rgb(1, 1, 1);

    page.drawRectangle({
      x: margin,
      y: y - rowHeight + 4,
      width: contentWidth,
      height: rowHeight,
      color: fill,
      borderColor: rgb(0.78, 0.86, 0.9),
      borderWidth: 0.35
    });

    drawTableCell(page, row.label, margin + 5, y - 10, labelWidth - 10, fonts.bold, 7.8, rgb(0.13, 0.31, 0.43));
    drawTableCell(page, row.value || getFallbackValue(), margin + labelWidth + 5, y - 10, valueWidth - 10, fonts.regular, 7.7, rgb(0.1, 0.12, 0.16));

    page.drawLine({
      start: { x: margin + labelWidth, y: y + 4 },
      end: { x: margin + labelWidth, y: y - rowHeight + 4 },
      thickness: 0.35,
      color: rgb(0.78, 0.86, 0.9)
    });

    y -= rowHeight;
  }

  return y - 8;
}

function drawTableCell(page, text, x, y, width, font, size, color) {
  const wrapped = wrapTextToWidth(String(text || getFallbackValue()), font, size, width).slice(0, 2);
  wrapped.forEach((line, index) => {
    page.drawText(sanitizeForPdf(line.substring(0, 90)), {
      x,
      y: y - index * 8.5,
      size,
      font,
      color
    });
  });
}

function addBlankPageBreak(pdfDoc) {
  pdfDoc.addPage([CONFIG.output.pageWidth, CONFIG.output.pageHeight]);
}

function drawPageHeader(page, title, fonts, pageSize, margin) {
  page.drawText(sanitizeForPdf(title.substring(0, 92)), {
    x: margin,
    y: pageSize.height - 32,
    size: 10.5,
    font: fonts.bold,
    color: rgb(0.13, 0.31, 0.43)
  });

  page.drawLine({
    start: { x: margin, y: pageSize.height - 42 },
    end: { x: pageSize.width - margin, y: pageSize.height - 42 },
    thickness: 0.75,
    color: rgb(0.55, 0.7, 0.8)
  });

  return pageSize.height - 64;
}

function drawTitle(page, title, fonts, margin, y) {
  page.drawText(sanitizeForPdf(title.substring(0, 95)), {
    x: margin,
    y,
    size: CONFIG.output.titleFontSize,
    font: fonts.bold,
    color: rgb(0.13, 0.31, 0.43)
  });

  return y - 30;
}

function drawSectionHeading(page, heading, fonts, margin, contentWidth, y) {
  page.drawText(sanitizeForPdf(heading.substring(0, 110)), {
    x: margin,
    y,
    size: CONFIG.output.headingFontSize,
    font: fonts.bold,
    color: rgb(0.13, 0.31, 0.43)
  });

  y -= 9;

  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + contentWidth, y },
    thickness: 0.55,
    color: rgb(0.62, 0.75, 0.83)
  });

  return y - 17;
}

function drawPageFooter(page, title, fonts, pageSize, margin) {
  page.drawLine({
    start: { x: margin, y: 32 },
    end: { x: pageSize.width - margin, y: 32 },
    thickness: 0.35,
    color: rgb(0.84, 0.88, 0.92)
  });

  page.drawText(sanitizeForPdf(title.substring(0, 92)), {
    x: margin,
    y: 18,
    size: 7.2,
    font: fonts.regular,
    color: rgb(0.45, 0.45, 0.45)
  });
}

async function embedPngFromDataUrl(pdfDoc, dataUrl) {
  try {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const image = await pdfDoc.embedPng(bytes);
    return { image, width: image.width, height: image.height };
  } catch (error) {
    console.warn("Image embed skipped:", error);
    return null;
  }
}

/* =========================================================
   UI + AUDIT
   ========================================================= */

function renderDetectedDetails(templateContract, documents) {
  const lines = [];

  const ruleEngine = getRuleEngine();
  const qualityRules = getQualityRules();

  lines.push(`Firebase Controller: ${state.templateController?.schemaId || "Not Loaded"}`);
  lines.push(`Rule Engine Version: ${ruleEngine.version || "Not Available"}`);
  lines.push(`Section Rules Available: ${getSectionRules().length}`);
  lines.push(`Field Rules Available: ${getFieldRules().length}`);
  lines.push(`Minimum Section Score: ${qualityRules.minimumSectionScore ?? "Default"}`);
  lines.push(`Minimum Field Score: ${qualityRules.minimumFieldScore ?? "Default"}`);
  lines.push(`Template: ${templateContract.fileName}`);
  lines.push(`Template Pages: ${templateContract.pageCount}`);
  lines.push(`Detected Header Fields: ${templateContract.headerFields.length}`);
  lines.push(`Detected Template Sections: ${templateContract.sections.length}`);
  lines.push("");

  if (templateContract.headerFields.length) {
    lines.push("Header Fields:");
    templateContract.headerFields.forEach((field) => {
      lines.push(`${field.order}. ${field.label}`);
    });
    lines.push("");
  }

  lines.push("Template Sections:");
  templateContract.sections.forEach((section) => {
    lines.push(`${section.order}. ${section.heading}`);
  });

  lines.push("", "-----------------------------", "");

  documents.forEach((doc, index) => {
    const imageCount = doc.sections.flatMap((section) => section.blocks).filter((block) => block.type === "image").length;

    lines.push(`Document ${index + 1}: ${doc.sourceFileName}`);
    lines.push(`Title: ${doc.title}`);
    lines.push(`Pages: ${doc.pageCount}`);
    lines.push(`Detected Facts: ${doc.factsDetected}`);
    lines.push(`Detected Source Sections: ${doc.sourceSectionCount}`);
    lines.push(`Final Output Sections: ${doc.sections.length}`);
    lines.push(`Mapped Visuals: ${imageCount}`);
    lines.push("");
  });

  els.detectedDetails.textContent = lines.join("\n");
}

function renderVisualPreview(documents) {
  if (!els.snapshotList) return;
  els.snapshotList.innerHTML = "";

  documents.forEach((doc, docIndex) => {
    doc.sections.forEach((section) => {
      section.blocks
        .filter((block) => block.type === "image")
        .forEach((block) => {
          const card = document.createElement("div");
          card.className = "snapshot-card";

          const img = document.createElement("img");
          img.src = block.imageDataUrl;
          img.alt = `${doc.sourceFileName} visual content`;

          const label = document.createElement("p");
          label.textContent = `Document ${docIndex + 1} | ${section.heading}`;

          card.appendChild(img);
          card.appendChild(label);
          els.snapshotList.appendChild(card);
        });
    });
  });
}

function buildAuditLog(templateContract, documents) {
  return {
    generatedAt: new Date().toISOString(),
    controller: state.templateController || null,
    template: {
      fileName: templateContract.fileName,
      pageCount: templateContract.pageCount,
      title: templateContract.title,
      headerFields: templateContract.headerFields,
      sections: templateContract.sections.map((section) => ({
        order: section.order,
        heading: section.heading,
        confidence: section.confidence
      }))
    },
    documents: documents.map((doc) => ({
      fileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.pageCount,
      factsDetected: doc.factsDetected,
      sourceSectionCount: doc.sourceSectionCount,
      summaryRows: doc.summaryRows,
      outputSections: doc.sections.map((section) => ({
        order: section.order,
        heading: section.heading,
        score: section.score,
        pageNumbers: section.pageNumbers,
        textBlocks: section.blocks.filter((block) => block.type === "text").length,
        imageBlocks: section.blocks.filter((block) => block.type === "image").length
      }))
    }))
  };
}

function exportAuditLog() {
  if (!state.auditLog) {
    setStatus("No audit log available.", "error");
    return;
  }

  const blob = new Blob([JSON.stringify(state.auditLog, null, 2)], { type: "application/json" });
  downloadBlob(blob, "Document_Audit_Log.json", "application/json");
  setStatus("Audit log exported successfully.", "success");
}

/* =========================================================
   CLEANING + SCORING
   ========================================================= */

function inferDocumentTitle(fullText, fileName) {
  const fileTitle = cleanDocumentTitle(removePdfExtension(fileName).replace(/[_-]+/g, " "));
  const lines = cleanExtractedText(fullText)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isBlockedText(line));

  const candidates = lines.slice(0, 30).filter((line) => {
    if (line.length < 4 || line.length > 130) return false;
    if (/^page\s+\d+/i.test(line)) return false;
    if (/^\d{1,2}\.\s+/.test(line)) return false;
    if (looksLikeBodySentence(line)) return false;
    return headingPatternScore(line) >= 0.35 || /^[A-Z][A-Za-z0-9 ,/&()'’.-]+$/.test(line);
  });

  return candidates.length ? cleanDocumentTitle(candidates[0]) : fileTitle || "Document";
}

function cleanExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\u0000/g, "")
    .split("\n")
    .map(normalizeLine)
    .filter((line) => !isBlockedText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanBusinessContent(text) {
  let value = String(text || "");

  value = value
    .replace(/\bSource Page\s+\d+\b/gi, "")
    .replace(/\bTemplate Used\s*:.*/gi, "")
    .replace(/\bSource File\s*:.*/gi, "")
    .replace(/\bGenerated (On|At)\s*:.*/gi, "")
    .replace(/\bOriginal Source\b/gi, "")
    .replace(/\bSource Preservation\b/gi, "")
    .replace(/\bTemplate[- ]Based Standardized Document\b/gi, "")
    .replace(/\bFormatted Document\b/gi, "")
    .replace(/\bSystem Note\b\s*:.*/gi, "")
    .replace(/\bAudit Note\b\s*:.*/gi, "");

  value = value
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isBlockedText(line))
    .join("\n");

  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function cleanDocumentTitle(text) {
  const value = cleanHeading(text)
    .replace(/\bformatted\s+document\b/gi, "")
    .replace(/\bupdated\s+document\b/gi, "")
    .replace(/\btemplate[- ]based\s+standardized\s+document\b/gi, "")
    .trim();

  return value || "Document";
}

function cleanHeading(text) {
  return normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/^\d{1,3}(\.\d{1,3})?\s*[).:-]?\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlockedText(text) {
  const value = comparable(text);
  if (!value) return false;

  return CONFIG.labelsToRemove.some((blocked) => {
    const cleanBlocked = comparable(blocked);
    return value === cleanBlocked || value.includes(cleanBlocked);
  });
}

function looksLikeBodySentence(text) {
  const value = normalizeLine(text);
  const words = value.split(/\s+/);

  if (words.length > 14) return true;
  if (/[.!?]$/.test(value) && words.length > 8) return true;
  if (/^(the|this|these|those|it|they|we|please|kindly|according|during)\b/i.test(value) && words.length > 7) return true;

  return false;
}

function isDuplicateTitle(heading, title) {
  const h = comparable(heading);
  const t = comparable(title);
  if (!h || !t) return false;
  return h === t || (h.length > 8 && t.includes(h)) || (t.length > 8 && h.includes(t));
}

function sameMeaning(a, b) {
  return weightedTokenOverlap(tokenize(a), tokenize(b)) > 0.68;
}

function normalizeChannels(text) {
  return String(text || "")
    .replace(/[;,]+/g, "/")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();
}

function tokenize(text) {
  const stopWords = new Set([
    "the", "and", "or", "of", "to", "in", "for", "on", "by", "with", "from", "as", "at",
    "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those",
    "a", "an", "details", "information", "document", "report", "section", "page", "source",
    "template", "updated", "formatted", "general", "main", "not", "available"
  ]);

  return comparable(text)
    .split(" ")
    .filter((token) => token.length > 2)
    .filter((token) => !stopWords.has(token));
}

function uniqueTokens(tokens) {
  return Array.from(new Set(tokens));
}

function weightedTokenOverlap(tokensA, tokensB) {
  const a = uniqueTokens(tokensA);
  const b = uniqueTokens(tokensB);
  if (!a.length || !b.length) return 0;

  const setB = new Set(b);
  let hits = 0;

  for (const token of a) {
    if (setB.has(token)) hits += 1;
  }

  return hits / Math.max(a.length, 1);
}

/* =========================================================
   TEXT WRAPPING
   ========================================================= */

function splitParagraphs(text) {
  return cleanBusinessContent(text)
    .split(/\n{1,}/)
    .map(normalizeLine)
    .filter(Boolean);
}

function wrapTextToWidth(text, font, size, maxWidth) {
  const words = sanitizeForPdf(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);

    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function sanitizeForPdf(text) {
  return String(text || "")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, "");
}

/* =========================================================
   DOWNLOAD / RESET / STATUS
   ========================================================= */

function buildOutputFileName(sourceFileName) {
  const base = removePdfExtension(sourceFileName)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 90);

  return `${base || "Document"}_Updated.pdf`;
}

function removePdfExtension(fileName) {
  return String(fileName || "Document").replace(/\.pdf$/i, "");
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
  state.templateController = null;
  state.templateContract = null;
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

  state.documents = [];
  state.auditLog = null;
}

function setStatus(message, type = "") {
  if (!els.statusText || !els.statusPanel) return;

  els.statusText.textContent = message;
  els.statusPanel.classList.remove("success", "error");

  if (type === "success") els.statusPanel.classList.add("success");
  if (type === "error") els.statusPanel.classList.add("error");
}

/* =========================================================
   GENERIC HELPERS
   ========================================================= */

function normalizeLine(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function comparable(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
}
