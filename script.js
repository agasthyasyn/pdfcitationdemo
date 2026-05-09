import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { loadTemplateController } from "./schema.controller.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/* =========================================================
   CONTROLLED PORT INFORMATION FORMATTER v3
   =========================================================

   Main change in this version:
   - The sample/template PDF no longer controls section detection blindly.
   - The output follows a controlled Port Information contract.
   - The sample PDF is still read as a reference/validation upload, but noisy
     headings from the sample cannot distort the final structure.
   - Firebase is optional. If Firebase is unavailable, this script still works
     using the local rule engine below.
   - Visual/image capture is disabled for now.
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
    maxCharsPerChunk: 260
  },
  mapping: {
    defaultMinSectionScore: 0.28,
    defaultMinFieldScore: 0.58,
    notAvailable: "Not Available"
  },
  output: {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 42,
    bodyFontSize: 9.3,
    headingFontSize: 12,
    titleFontSize: 15,
    smallFontSize: 7.6,
    lineHeight: 12.2,
    paragraphGap: 7,
    sectionGap: 14,
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

const CONTROLLED_HEADER_FIELDS = [
  {
    key: "vesselName",
    label: "Vessel Name",
    aliases: ["vessel", "vessel name", "ship", "m/v", "mv"]
  },
  {
    key: "portName",
    label: "Port Name",
    aliases: ["port", "port name", "location", "terminal location"]
  },
  {
    key: "country",
    label: "Country",
    aliases: ["country"]
  },
  {
    key: "portStayDate",
    label: "Port Stay / Date",
    aliases: ["port stay", "date", "date of arrival", "arrival", "eta", "etb", "etd"]
  },
  {
    key: "berthTerminal",
    label: "Berth / Pier / Terminal",
    aliases: ["berth", "berth name", "pier", "terminal", "jetty", "quay"]
  },
  {
    key: "cargo",
    label: "Cargo",
    aliases: ["cargo", "commodity"]
  },
  {
    key: "depthDraftChannel",
    label: "Depth / Draft / Channel",
    aliases: ["depth", "berth depth", "draft", "draught", "channel", "fairway", "depth at anchorage"]
  },
  {
    key: "vhfCommunication",
    label: "VHF / Communication",
    aliases: ["vhf", "vhf channel", "channel", "channels", "communication", "radio"]
  },
  {
    key: "agentContact",
    label: "Agent / Contact",
    aliases: ["agent", "agents", "agency", "contact", "phone", "email", "mobile"]
  },
  {
    key: "publicationsCharts",
    label: "Publications / Charts",
    aliases: ["publication", "publications", "chart", "charts", "enc", "enp", "admiralty"]
  }
];

const CONTROLLED_SECTIONS = [
  {
    id: "portOverview",
    heading: "Port Overview",
    aliases: ["overview", "about", "port overview", "location", "general information"],
    signals: ["located", "port is", "terminal", "harbour", "harbor", "overview", "general information", "approach", "area"],
    negatives: ["agent", "email", "crew list", "invoice"]
  },
  {
    id: "arrivalPortStay",
    heading: "Arrival / Port Stay",
    aliases: ["arrival", "port stay", "date", "eta", "etb", "etd", "notice"],
    signals: ["arrival", "date of arrival", "eta", "etb", "etd", "notice", "nor", "anchored", "port stay", "sailing", "departure"],
    negatives: ["agent", "invoice", "charts", "publications"]
  },
  {
    id: "anchorage",
    heading: "Anchorage",
    aliases: ["anchorage", "anchor", "waiting area"],
    signals: ["anchorage", "anchor", "anchored", "waiting", "roads", "outer anchorage", "inner anchorage", "drifting"],
    negatives: ["agent", "invoice", "cargo declaration"]
  },
  {
    id: "pilotageNavigation",
    heading: "Pilotage / Navigation / VHF",
    aliases: ["pilotage", "approach", "navigation", "pilot", "vhf", "communication"],
    signals: ["pilot", "pilotage", "vhf", "channel", "boarding", "pilot ladder", "tug", "towage", "navigation", "approach", "radio"],
    negatives: ["agent", "invoice", "cargo declaration", "supplier"]
  },
  {
    id: "berthTerminalDepth",
    heading: "Berth / Terminal / Depth",
    aliases: ["berth", "terminal", "depth", "draft", "draught", "pier", "jetty", "quay"],
    signals: ["berth", "terminal", "pier", "jetty", "depth", "draft", "draught", "quay", "channel", "density", "salinity", "loa", "beam", "dwt", "mooring"],
    negatives: ["agent", "crew", "documents", "invoice"]
  },
  {
    id: "cargoOperations",
    heading: "Cargo Operations",
    aliases: ["cargo", "operations", "loading", "discharging", "rate"],
    signals: ["cargo", "commodity", "loading", "discharging", "operation", "rate", "shore scale", "loading rate", "discharging rate", "crane", "grab", "belt", "conveyor"],
    negatives: ["agent", "pilot", "charts", "crew"]
  },
  {
    id: "agentsContacts",
    heading: "Agents / Contacts",
    aliases: ["agent", "agents", "contact", "agency"],
    signals: ["agent", "agents", "agency", "contact", "phone", "email", "mobile", "pic", "tel", "telephone"],
    negatives: ["cargo rate", "pilot ladder", "berth depth", "draft"]
  },
  {
    id: "documentsFormalities",
    heading: "Documents / Formalities",
    aliases: ["documents", "formalities", "pre arrival", "requirements"],
    signals: ["documents", "crew list", "declaration", "certificate", "manifest", "passport", "ballast", "pre arrival", "formalities", "customs", "immigration", "port health"],
    negatives: ["agent contact", "berth depth", "cargo rate"]
  },
  {
    id: "regulationsRestrictions",
    heading: "Regulations / Restrictions",
    aliases: ["regulations", "restrictions", "security", "health", "shore leave", "crew change"],
    signals: ["regulations", "restriction", "security", "isps", "health", "shore leave", "crew change", "inspection", "psc", "permitted", "not permitted", "prohibited", "allowed"],
    negatives: ["cargo rate", "berth depth", "agent email"]
  },
  {
    id: "servicesSupplies",
    heading: "Services / Supplies",
    aliases: ["services", "supplies", "waste", "fresh water", "bunkers"],
    signals: ["garbage", "bunker", "fresh water", "sludge", "stores", "provisions", "waste", "supply", "supplies", "repair", "launch", "boat", "medical"],
    negatives: ["pilot", "vhf", "charts"]
  },
  {
    id: "publicationsCharts",
    heading: "Publications / Charts",
    aliases: ["publications", "charts", "nautical charts", "reference"],
    signals: ["charts", "publications", "enc", "enp", "admiralty", "pilot vol", "sailing directions", "alrs", "np", "ba chart"],
    negatives: ["agent", "cargo", "invoice"]
  },
  {
    id: "remarksNotes",
    heading: "Remarks / Notes",
    aliases: ["remarks", "notes", "experience", "detailed notes", "additional information"],
    signals: ["remarks", "note", "general information", "additional", "experience", "observed", "comment", "important"],
    negatives: []
  }
];

const LOCAL_FALLBACK_RULE_ENGINE = {
  version: 3,
  fallbackValue: CONFIG.mapping.notAvailable,
  visuals: {
    enabled: false,
    manualReviewRequired: true,
    rejectTextHeavyCrops: true,
    rejectIfTextDensityAbovePercent: 18
  },
  qualityRules: {
    minimumSectionScore: 28,
    minimumFieldScore: 58,
    minimumValueLength: 3,
    doNotGuessMissingValues: true,
    rejectWeakValues: true,
    sendWeakMatchesToReview: true
  },
  sectionRules: CONTROLLED_SECTIONS.map((section) => ({
    concept: section.id,
    targetAliases: section.aliases,
    sourceSignals: section.signals,
    negativeSignals: section.negatives
  })),
  fieldRules: CONTROLLED_HEADER_FIELDS.map((field) => ({
    concept: field.key,
    targetAliases: field.aliases,
    sourceSignals: field.aliases,
    sourcePatterns: field.aliases.map((alias) => `${alias}: {value}`)
  }))
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
    if (els.templateFileInfo) els.templateFileInfo.textContent = "No template uploaded yet.";
    setStatus("Template removed.");
    return;
  }
  if (els.templateFileInfo) els.templateFileInfo.textContent = `Template selected: ${file.name}`;
  setStatus("Template PDF uploaded.");
}

function handleSourceUpload(event) {
  const files = Array.from(event.target.files || []);
  state.sourceFiles = files;
  state.documents = [];
  if (!files.length) {
    if (els.sourceFileInfo) els.sourceFileInfo.textContent = "No source documents uploaded yet.";
    setStatus("Source documents removed.");
    return;
  }
  if (els.sourceFileInfo) {
    els.sourceFileInfo.innerHTML = files
      .map((file, index) => `${index + 1}. ${escapeHtml(file.name)}`)
      .join("<br>");
  }
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
  const remoteSections = Array.isArray(remote.sectionRules) ? remote.sectionRules : [];
  const remoteFields = Array.isArray(remote.fieldRules) ? remote.fieldRules : [];

  return {
    ...LOCAL_FALLBACK_RULE_ENGINE,
    ...remote,
    visuals: {
      ...LOCAL_FALLBACK_RULE_ENGINE.visuals,
      ...(remote.visuals || {}),
      enabled: false
    },
    qualityRules: {
      ...LOCAL_FALLBACK_RULE_ENGINE.qualityRules,
      ...(remote.qualityRules || {})
    },
    sectionRules: remoteSections.length ? remoteSections : LOCAL_FALLBACK_RULE_ENGINE.sectionRules,
    fieldRules: remoteFields.length ? remoteFields : LOCAL_FALLBACK_RULE_ENGINE.fieldRules
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
    CONFIG.mapping.notAvailable
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
  return scoreFromPercent(getQualityRules().minimumSectionScore, CONFIG.mapping.defaultMinSectionScore);
}

function getMinimumFieldScore() {
  return scoreFromPercent(getQualityRules().minimumFieldScore, CONFIG.mapping.defaultMinFieldScore);
}

function getMinimumValueLength() {
  const value = Number(getQualityRules().minimumValueLength);
  return Number.isFinite(value) && value > 0 ? value : 3;
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
    setStatus("Loading template controller...");
    state.templateController = await loadTemplateController();
    console.log("Template Controller:", state.templateController);

    setStatus("Reading sample/template PDF as reference...");
    const templatePdf = await extractPdf(state.templateFile);
    const templateContract = buildTemplateContract(templatePdf);
    validateTemplateContract(templateContract);
    state.templateContract = templateContract;

    const documents = [];
    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];
      setStatus(`Processing ${file.name} (${i + 1} of ${state.sourceFiles.length})...`);
      const sourcePdf = await extractPdf(file);
      const sourceProfile = buildSourceProfile(sourcePdf);
      const documentModel = buildDocumentModel({ sourcePdf, sourceProfile, templateContract });
      documents.push(documentModel);
    }

    state.documents = documents;
    state.auditLog = buildAuditLog(templateContract, documents);

    renderPreview(documents);
    renderDetectedDetails(templateContract, documents);
    renderVisualPreview();

    if (els.exportPdfBtn) els.exportPdfBtn.disabled = false;
    if (els.exportAuditBtn) els.exportAuditBtn.disabled = false;

    setStatus("Processing complete. Review the preview before exporting.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`, "error");
  }
}

/* =========================================================
   PDF EXTRACTION
   ========================================================= */

async function extractPdf(file) {
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
    const lines = buildLines(items, viewport).filter((line) => !isBlockedText(line.text));
    const pageText = lines.map((line) => line.text).join("\n");

    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      items,
      lines,
      text: cleanExtractedText(pageText),
      visualCandidates: []
    });
  }

  const fullText = cleanExtractedText(
    pages.map((page) => page.text).filter(Boolean).join("\n\n")
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

  const groups = [];
  for (const item of sorted) {
    let group = groups.find((entry) => Math.abs(entry.y - item.y) <= CONFIG.extraction.lineYTolerance);
    if (!group) {
      group = { y: item.y, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups
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
  return normalizeLine(result);
}

/* =========================================================
   CONTROLLED TEMPLATE CONTRACT
   ========================================================= */

function buildTemplateContract(templatePdf) {
  return {
    fileName: templatePdf.fileName,
    pageCount: templatePdf.pageCount,
    title: inferDocumentTitle(templatePdf.fullText, templatePdf.fileName),
    mode: "controlled_port_information_contract",
    headerFields: CONTROLLED_HEADER_FIELDS.map((field, index) => ({
      ...field,
      order: index + 1
    })),
    sections: CONTROLLED_SECTIONS.map((section, index) => ({
      ...section,
      order: index + 1
    }))
  };
}

function validateTemplateContract(contract) {
  if (!contract.headerFields.length) {
    throw new Error("Controlled template contract has no header fields.");
  }
  if (!contract.sections.length) {
    throw new Error("Controlled template contract has no sections.");
  }
}

/* =========================================================
   SOURCE PROFILE
   ========================================================= */

function buildSourceProfile(sourcePdf) {
  const title = inferDocumentTitle(sourcePdf.fullText, sourcePdf.fileName);
  const chunks = buildSourceChunks(sourcePdf);
  const keyValueFacts = extractKeyValueFacts(sourcePdf.fullText);
  const implicitFacts = inferImplicitFacts(sourcePdf.fullText, sourcePdf.fileName);

  return {
    title,
    chunks,
    keyValueFacts: dedupeFacts([...keyValueFacts, ...implicitFacts]),
    sourceLineCount: sourcePdf.pages.reduce((sum, page) => sum + page.lines.length, 0)
  };
}

function buildSourceChunks(sourcePdf) {
  const chunks = [];
  let currentHeading = "General Details";
  let order = 0;

  for (const page of sourcePdf.pages) {
    for (const line of page.lines) {
      const text = cleanBusinessContent(line.text);
      if (!text || shouldSkipLine(text)) continue;

      if (looksLikeSectionHeading(line, text)) {
        currentHeading = cleanHeading(text);
        continue;
      }

      splitLongLine(text).forEach((part) => {
        const cleanPart = cleanBusinessContent(part);
        if (!cleanPart || shouldSkipLine(cleanPart)) return;
        chunks.push({
          id: `chunk-${++order}`,
          order,
          heading: currentHeading,
          content: cleanPart,
          pageNumbers: [page.pageNumber],
          tokens: tokenize(`${currentHeading} ${cleanPart}`)
        });
      });
    }
  }

  if (!chunks.length && sourcePdf.fullText) {
    chunks.push({
      id: "chunk-1",
      order: 1,
      heading: "General Details",
      content: cleanBusinessContent(sourcePdf.fullText),
      pageNumbers: [1],
      tokens: tokenize(sourcePdf.fullText)
    });
  }

  return chunks;
}

function splitLongLine(text) {
  const clean = normalizeLine(text);
  if (clean.length <= CONFIG.extraction.maxCharsPerChunk) return [clean];
  const parts = clean
    .split(/(?<=[.;:])\s+(?=[A-Z0-9])/)
    .map(normalizeLine)
    .filter(Boolean);
  return parts.length > 1 ? parts : [clean];
}

function looksLikeSectionHeading(line, text) {
  const clean = cleanHeading(text);
  if (!clean || clean.length < 3 || clean.length > 90) return false;
  if (looksLikeBodySentence(clean)) return false;
  if (/^page\s+\d+$/i.test(clean)) return false;

  const words = clean.split(/\s+/);
  const isNumbered = /^\d{1,2}(\.\d{1,2})?\s*[).:-]?\s+\S+/.test(text);
  const isShortAndBold = words.length <= 8 && line.isBoldish;
  const isUpper = /^[A-Z0-9\s/&(),.'’-]{4,}$/.test(clean) && words.length <= 10;
  const isKnown = CONTROLLED_SECTIONS.some((section) =>
    section.aliases.some((alias) => comparable(clean).includes(comparable(alias)))
  );

  return isNumbered || isShortAndBold || isUpper || isKnown;
}

function shouldSkipLine(text) {
  const clean = normalizeLine(text);
  if (!clean) return true;
  if (isBlockedText(clean)) return true;
  if (/^page\s*\d+(\s*of\s*\d+)?$/i.test(clean)) return true;
  if (/^\d{1,4}$/.test(clean)) return true;
  if (/^[\W_]+$/.test(clean)) return true;
  return false;
}

/* =========================================================
   FACT EXTRACTION
   ========================================================= */

function extractKeyValueFacts(text) {
  const facts = [];
  const lines = cleanExtractedText(text).split("\n").map(normalizeLine).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (shouldSkipLine(line)) continue;

    const direct = line.match(/^(.{2,70}?)(?:\s*[:\-–—]\s+|\s{2,})(.{2,220})$/);
    if (direct) {
      const key = cleanHeading(direct[1]);
      const value = normalizeLine(direct[2]);
      if (isGoodFactPair(key, value)) facts.push(makeFact(key, value, line, 0.78));
      continue;
    }

    const next = lines[i + 1] || "";
    if (looksLikeStandaloneLabel(line) && next && !looksLikeStandaloneLabel(next)) {
      const key = cleanHeading(line);
      const value = normalizeLine(next);
      if (isGoodFactPair(key, value)) facts.push(makeFact(key, value, `${line} ${next}`, 0.66));
    }
  }

  return facts;
}

function isGoodFactPair(key, value) {
  if (!key || !value) return false;
  if (looksLikeBodySentence(key)) return false;
  if (!isAcceptableFactValue(value)) return false;
  if (key.length > 70) return false;
  return true;
}

function looksLikeStandaloneLabel(text) {
  const clean = comparable(cleanHeading(text));
  if (!clean || clean.length > 70) return false;
  return CONTROLLED_HEADER_FIELDS.some((field) =>
    field.aliases.some((alias) => clean === comparable(alias) || clean.includes(comparable(alias)))
  );
}

function inferImplicitFacts(fullText, fileName) {
  const facts = [];
  const text = cleanExtractedText(fullText);
  const fileTitle = cleanHeading(removePdfExtension(fileName).replace(/[_-]+/g, " "));

  addFactFromMatch(facts, "Latitude / Longitude / Position", text.match(/\b\d{1,2}(?:\.\d+)?\s*[\/ ,]+\s*-?\d{1,3}(?:\.\d+)?\b|\b\d{1,2}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[NS]\s+\d{2,3}[°.'’\s]+\d{1,2}(?:\.\d+)?\s*[EW]\b/i));
  addFactFromMatch(facts, "Time Zone", text.match(/\b(?:GMT|UTC|SMT)\s*[=:+\-\w\s]*-?\d{1,2}\s*(?:hrs|hours|h)?\b/i));
  addFactFromMatch(facts, "Port Stay / Date", text.match(/\b(?:Date of Arrival|Arrival|ETA|ETB|ETD)\s*[:\-]?\s*([^\n]{2,90})/i), 1);
  addFactFromMatch(facts, "Cargo", text.match(/\b(?:Cargo|Commodity)\s*[:\-]?\s*([^\n]{2,100})/i), 1);
  addFactFromMatch(facts, "Depth / Draft / Channel", text.match(/\b(?:Berth Depth|Depth(?: at Anchorage)?|Draft|Draught|Channel)\s*[:\-]?\s*([^\n]{2,80})/i), 1);
  addFactFromMatch(facts, "VHF / Communication", text.match(/\b(?:VHF(?: CHANNEL)?|PILOT:\s*VHF CHANNEL|Channel)\s*[:\-]?\s*(?:CH\s*)?([0-9;,/\s]{2,40})/i), 1, (value) => `CH ${normalizeChannels(value)}`);
  addFactFromMatch(facts, "Agent / Contact", text.match(/\b(?:Agent|Agents|Agency|Contact)\s*[:\-]?\s*\n?([^\n]{2,120})/i), 1);
  addFactFromMatch(facts, "Publications / Charts", text.match(/\b(?:ENC|Charts?|Publications?)\s*[:\-]?\s*([^\n]{2,160})/i), 1);
  addFactFromMatch(facts, "Berth / Pier / Terminal", text.match(/\b(?:Berth Name|Berth|Terminal|Pier|Jetty)\s*[:\-]?\s*\n?([^\n]{2,120})/i), 1);

  const filenameYear = fileTitle.match(/\b(20\d{2}|19\d{2})\b/);
  if (filenameYear) facts.push(makeFact("Year", filenameYear[1], fileTitle, 0.7));

  const portCountryFromFilename = inferPortCountryFromFileName(fileTitle);
  if (portCountryFromFilename.port) facts.push(makeFact("Port Name", portCountryFromFilename.port, fileTitle, 0.72));
  if (portCountryFromFilename.country) facts.push(makeFact("Country", portCountryFromFilename.country, fileTitle, 0.72));

  return facts;
}

function inferPortCountryFromFileName(fileTitle) {
  const cleaned = fileTitle.replace(/\b(20\d{2}|19\d{2})\b/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { port: "", country: "" };

  const commonCountries = ["brazil", "usa", "united states", "india", "singapore", "colombia", "argentina", "mexico", "canada", "chile", "peru", "spain", "china", "japan", "korea", "panama"];
  const lower = comparable(cleaned);
  const country = commonCountries.find((item) => lower.includes(comparable(item))) || "";

  if (!country) return { port: "", country: "" };
  const port = cleanHeading(cleaned.replace(new RegExp(country, "i"), ""));
  return { port, country: titleCase(country) };
}

function addFactFromMatch(facts, key, match, groupIndex = 0, transform = null) {
  if (!match) return;
  const raw = match[groupIndex] || match[0];
  const value = normalizeLine(transform ? transform(raw) : raw);
  if (!isAcceptableFactValue(value)) return;
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

function isAcceptableFactValue(value) {
  const clean = normalizeLine(String(value || ""));
  const normalized = comparable(clean);
  if (!clean) return false;
  if (normalized === comparable(getFallbackValue())) return false;
  if (clean.length < getMinimumValueLength()) return false;
  if (/^[\W_]+$/.test(clean)) return false;
  if (/^[a-zA-Z]:?$/.test(clean)) return false;
  if (/^(n\/?a|nil|null|none|unknown)$/i.test(clean)) return false;
  return true;
}

/* =========================================================
   DOCUMENT MODEL
   ========================================================= */

function buildDocumentModel({ sourcePdf, sourceProfile, templateContract }) {
  const outputRules = getOutputRules();
  const showSummaryTable = boolRule(outputRules.showSummaryTable, true);
  const sectionNumbering = boolRule(outputRules.sectionNumbering, true);
  const summaryRows = showSummaryTable
    ? buildSummaryRows(templateContract.headerFields, sourceProfile.keyValueFacts)
    : [];

  const sections = templateContract.sections.map((templateSection) => ({
    ...templateSection,
    aliases: Array.isArray(templateSection.aliases) ? templateSection.aliases : [],
    signals: Array.isArray(templateSection.signals) ? templateSection.signals : [],
    negatives: Array.isArray(templateSection.negatives) ? templateSection.negatives : [],
    blocks: [],
    score: 0,
    pageNumbers: [],
    mappedChunkIds: []
  }));

  const usedChunkIds = new Set();

  for (const chunk of sourceProfile.chunks) {
    const best = findBestSection(chunk, sections);
    if (best.index >= 0 && best.score >= getMinimumSectionScore()) {
      addChunkToSection(sections[best.index], chunk, best.score);
      usedChunkIds.add(chunk.id);
    }
  }

  const remarks = sections.find((section) => section.id === "remarksNotes") || sections[sections.length - 1];
  for (const chunk of sourceProfile.chunks) {
    if (usedChunkIds.has(chunk.id)) continue;
    addChunkToSection(remarks, chunk, 0.1);
  }

  const finalSections = sections.map((section) => {
    const mergedText = mergeSectionLines(section.blocks.map((block) => block.text));
    return {
      ...section,
      blocks: [
        {
          type: "text",
          text: mergedText || getFallbackValue(),
          pageNumbers: section.pageNumbers
        }
      ]
    };
  });

  return {
    sourceFileName: sourcePdf.fileName,
    title: buildOutputTitle(sourcePdf, sourceProfile),
    pageCount: sourcePdf.pageCount,
    summaryRows,
    sections: finalSections,
    sectionNumbering,
    sourceLineCount: sourceProfile.sourceLineCount,
    sourceChunkCount: sourceProfile.chunks.length,
    factsDetected: sourceProfile.keyValueFacts.length,
    ruleEngineVersion: getRuleEngine().version,
    sectionRulesAvailable: getSectionRules().length,
    fieldRulesAvailable: getFieldRules().length
  };
}

function addChunkToSection(section, chunk, score) {
  const text = cleanBusinessContent(chunk.content);
  if (!text) return;
  section.blocks.push({
    type: "text",
    text,
    sourceHeading: chunk.heading,
    pageNumbers: chunk.pageNumbers
  });
  section.score = Math.max(section.score, score);
  section.pageNumbers = uniqueNumbers([...section.pageNumbers, ...chunk.pageNumbers]);
  section.mappedChunkIds.push(chunk.id);
}

function mergeSectionLines(lines) {
  const result = [];
  const seen = new Set();
  for (const line of lines) {
    const clean = cleanBusinessContent(line);
    if (!clean || shouldSkipLine(clean)) continue;
    const key = comparable(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  const fieldText = comparable(`${field.label} ${(field.aliases || []).join(" ")}`);
  const factText = comparable(`${fact.key} ${fact.value} ${fact.evidence || ""}`);
  let best = 0;

  for (const rule of rules) {
    const targetAliases = Array.isArray(rule.targetAliases) ? rule.targetAliases : [];
    const sourceSignals = Array.isArray(rule.sourceSignals) ? rule.sourceSignals : [];
    const targetHits = targetAliases.filter((alias) => fieldText.includes(comparable(alias))).length;
    if (!targetHits) continue;
    const signalHits = sourceSignals.filter((signal) => factText.includes(comparable(signal))).length;
    if (!signalHits) continue;
    best = Math.max(best, Math.min(0.95, 0.44 + targetHits * 0.13 + signalHits * 0.1));
  }

  return best;
}

function findBestSection(chunk, sections) {
  let bestIndex = -1;
  let bestScore = 0;
  sections.forEach((section, index) => {
    const score = scoreSection(section, chunk);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return { index: bestIndex, score: Number(bestScore.toFixed(3)) };
}

function scoreSection(section, chunk) {
  const sourceText = `${chunk.heading}\n${chunk.content}`;
  const source = comparable(sourceText);
  const heading = comparable(chunk.heading);
  const contentTokens = tokenize(chunk.content);

  const aliases = Array.isArray(section.aliases) ? section.aliases : [];
  const signals = Array.isArray(section.signals) ? section.signals : [];
  const negatives = Array.isArray(section.negatives) ? section.negatives : [];

  const sectionTokens = tokenize(`${section.heading || ""} ${aliases.join(" ")}`);

  const aliasHits = aliases.filter((alias) => {
    const value = comparable(alias);
    return value && (source.includes(value) || heading.includes(value));
  }).length;

  const signalHits = signals.filter((signal) => {
    const value = comparable(signal);
    return value && source.includes(value);
  }).length;

  const negativeHits = negatives.filter((signal) => {
    const value = comparable(signal);
    return value && source.includes(value);
  }).length;

  const tokenScore = weightedTokenOverlap(sectionTokens, contentTokens);
  const ruleScore = scoreSectionWithRuleEngine(section.heading, sourceText);

  const score =
    Math.min(0.34, aliasHits * 0.12) +
    Math.min(0.46, signalHits * 0.075) +
    tokenScore * 0.12 +
    ruleScore * 0.22 -
    Math.min(0.35, negativeHits * 0.08);

  return Math.max(0, Math.min(1, score));
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

    const targetHits = targetAliases.filter((alias) => target.includes(comparable(alias))).length;
    if (!targetHits) continue;
    const sourceHits = sourceSignals.filter((signal) => source.includes(comparable(signal))).length;
    if (!sourceHits) continue;
    const negativeHits = negativeSignals.filter((signal) => source.includes(comparable(signal))).length;

    const total = Math.max(0, Math.min(0.35, targetHits * 0.18) + Math.min(0.75, sourceHits * 0.13) - Math.min(0.45, negativeHits * 0.15));
    best = Math.max(best, total);
  }

  return Math.min(1, best);
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
  if (els.formattedPreview) els.formattedPreview.value = text.trim();
}

function documentToPlainText(doc) {
  const lines = [];
  lines.push(cleanDocumentTitle(doc.title));
  lines.push("");
  if (doc.summaryRows?.length) {
    lines.push("1. Key Information");
    lines.push("");
    for (const row of doc.summaryRows) lines.push(`${row.label}: ${row.value || getFallbackValue()}`);
    lines.push("");
  }

  const offset = doc.summaryRows?.length ? 2 : 1;
  doc.sections.forEach((section, index) => {
    const heading = cleanHeading(section.heading);
    lines.push(`${index + offset}. ${heading}`);
    lines.push("");
    for (const block of section.blocks) {
      if (block.type === "text") {
        lines.push(cleanBusinessContent(block.text) || getFallbackValue());
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
      if (i > 0) pdfDoc.addPage([CONFIG.output.pageWidth, CONFIG.output.pageHeight]);
      await addDocumentToPdf(pdfDoc, state.documents[i], fonts);
    }

    const bytes = await pdfDoc.save();
    const fileName = state.documents.length === 1
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
    let ensured = ensureSpace(pdfDoc, page, y, 260, title, fonts, pageSize, margin);
    page = ensured.page;
    y = ensured.y;
    y = drawSectionHeading(page, "1. Key Information", fonts, margin, contentWidth, y);
    const result = drawSummaryTable(pdfDoc, page, doc.summaryRows, fonts, margin, contentWidth, y, title, pageSize);
    page = result.page;
    y = result.y - CONFIG.output.sectionGap;
  }

  const offset = doc.summaryRows?.length ? 2 : 1;
  for (let i = 0; i < doc.sections.length; i++) {
    const section = doc.sections[i];
    let ensured = ensureSpace(pdfDoc, page, y, 95, title, fonts, pageSize, margin);
    page = ensured.page;
    y = ensured.y;
    y = drawSectionHeading(page, `${i + offset}. ${cleanHeading(section.heading)}`, fonts, margin, contentWidth, y);

    for (const block of section.blocks) {
      const paragraphs = splitParagraphs(block.text || getFallbackValue());
      for (const paragraph of paragraphs) {
        const wrapped = wrapTextToWidth(paragraph, fonts.regular, CONFIG.output.bodyFontSize, contentWidth);
        for (const line of wrapped) {
          ensured = ensureSpace(pdfDoc, page, y, 48, title, fonts, pageSize, margin);
          page = ensured.page;
          y = ensured.y;
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
    y -= CONFIG.output.sectionGap;
  }

  drawPageFooter(page, title, fonts, pageSize, margin);
}

function ensureSpace(pdfDoc, page, y, required, title, fonts, pageSize, margin) {
  if (y >= margin + required) return { page, y };
  drawPageFooter(page, title, fonts, pageSize, margin);
  const newPage = pdfDoc.addPage([pageSize.width, pageSize.height]);
  return { page: newPage, y: drawPageHeader(newPage, title, fonts, pageSize, margin) };
}

function drawSummaryTable(pdfDoc, page, rows, fonts, margin, contentWidth, y, title, pageSize) {
  const rowHeight = CONFIG.output.tableRowHeight;
  const labelWidth = contentWidth * 0.3;
  const valueWidth = contentWidth * 0.7;

  for (let i = 0; i < rows.length; i++) {
    let ensured = ensureSpace(pdfDoc, page, y, rowHeight + 45, title, fonts, pageSize, margin);
    page = ensured.page;
    y = ensured.y;
    const row = rows[i];
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

  return { page, y: y - 8 };
}

function drawTableCell(page, text, x, y, width, font, size, color) {
  const wrapped = wrapTextToWidth(String(text || getFallbackValue()), font, size, width).slice(0, 2);
  wrapped.forEach((line, index) => {
    page.drawText(sanitizeForPdf(line.substring(0, 95)), { x, y: y - index * 8.5, size, font, color });
  });
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

/* =========================================================
   UI + AUDIT
   ========================================================= */

function renderDetectedDetails(templateContract, documents) {
  const lines = [];
  lines.push(`Template Mode: ${templateContract.mode}`);
  lines.push(`Template Reference: ${templateContract.fileName}`);
  lines.push(`Template Pages: ${templateContract.pageCount}`);
  lines.push(`Rule Engine Version: ${getRuleEngine().version}`);
  lines.push(`Section Rules Available: ${getSectionRules().length}`);
  lines.push(`Field Rules Available: ${getFieldRules().length}`);
  lines.push(`Minimum Section Score: ${getQualityRules().minimumSectionScore}`);
  lines.push(`Minimum Field Score: ${getQualityRules().minimumFieldScore}`);
  lines.push(`Visual Capture: Disabled`);
  lines.push("");
  lines.push("Controlled Header Fields:");
  templateContract.headerFields.forEach((field) => lines.push(`${field.order}. ${field.label}`));
  lines.push("", "Controlled Sections:");
  templateContract.sections.forEach((section) => lines.push(`${section.order}. ${section.heading}`));
  lines.push("", "-----------------------------", "");

  documents.forEach((doc, index) => {
    lines.push(`Document ${index + 1}: ${doc.sourceFileName}`);
    lines.push(`Title: ${doc.title}`);
    lines.push(`Pages: ${doc.pageCount}`);
    lines.push(`Detected Facts: ${doc.factsDetected}`);
    lines.push(`Source Lines: ${doc.sourceLineCount}`);
    lines.push(`Source Chunks: ${doc.sourceChunkCount}`);
    lines.push(`Final Output Sections: ${doc.sections.length}`);
    lines.push(`Mapped Visuals: 0`);
    lines.push("");
  });

  if (els.detectedDetails) els.detectedDetails.textContent = lines.join("\n");
}

function renderVisualPreview() {
  if (els.snapshotList) els.snapshotList.innerHTML = "";
}

function buildAuditLog(templateContract, documents) {
  return {
    generatedAt: new Date().toISOString(),
    controller: state.templateController || null,
    template: {
      mode: templateContract.mode,
      fileName: templateContract.fileName,
      pageCount: templateContract.pageCount,
      title: templateContract.title,
      headerFields: templateContract.headerFields,
      sections: templateContract.sections.map((section) => ({ order: section.order, heading: section.heading, id: section.id }))
    },
    ruleEngine: {
      version: getRuleEngine().version,
      sectionRulesAvailable: getSectionRules().length,
      fieldRulesAvailable: getFieldRules().length,
      qualityRules: getQualityRules()
    },
    documents: documents.map((doc) => ({
      fileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.pageCount,
      factsDetected: doc.factsDetected,
      sourceLineCount: doc.sourceLineCount,
      sourceChunkCount: doc.sourceChunkCount,
      summaryRows: doc.summaryRows,
      outputSections: doc.sections.map((section) => ({
        order: section.order,
        heading: section.heading,
        score: section.score,
        pageNumbers: section.pageNumbers,
        textLength: section.blocks.map((block) => block.text || "").join("\n").length
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
   CLEANING + UTILS
   ========================================================= */

function inferDocumentTitle(fullText, fileName) {
  const fileTitle = cleanDocumentTitle(removePdfExtension(fileName).replace(/[_-]+/g, " "));
  const lines = cleanExtractedText(fullText)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isBlockedText(line));

  const candidate = lines.slice(0, 25).find((line) => {
    if (line.length < 4 || line.length > 130) return false;
    if (/^page\s+\d+/i.test(line)) return false;
    if (looksLikeBodySentence(line)) return false;
    return /^[A-Z][A-Za-z0-9 ,/&()'’.-]+$/.test(line) || looksLikeSectionHeading({ isBoldish: true }, line);
  });

  return cleanDocumentTitle(candidate || fileTitle || "Document");
}

function cleanExtractedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\u0000/g, "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
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

  return value
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line) => !isBlockedText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 16) return true;
  if (/[.!?]$/.test(value) && words.length > 8) return true;
  if (/^(the|this|these|those|it|they|we|please|kindly|according|during)\b/i.test(value) && words.length > 7) return true;
  return false;
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
  return a.filter((token) => setB.has(token)).length / Math.max(a.length, 1);
}

function comparable(text) {
  return normalizeLine(text)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLine(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
}

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

function titleCase(text) {
  return String(text || "")
    .split(" ")
    .map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "")
    .join(" ");
}

function buildOutputFileName(sourceFileName) {
  const base = removePdfExtension(sourceFileName)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 90);
  return `${base || "Document"}_Updated.pdf`;
}

function removePdfExtension(fileName) {
  return String(fileName || "").replace(/\.pdf$/i, "");
}

function downloadBlob(content, fileName, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  setInitialState();
}

function resetOutputOnly() {
  state.documents = [];
  state.auditLog = null;
  if (els.formattedPreview) els.formattedPreview.value = "";
  if (els.detectedDetails) els.detectedDetails.textContent = "";
  if (els.snapshotList) els.snapshotList.innerHTML = "";
  if (els.exportPdfBtn) els.exportPdfBtn.disabled = true;
  if (els.exportAuditBtn) els.exportAuditBtn.disabled = true;
}

function setStatus(message, type = "info") {
  if (els.statusText) els.statusText.textContent = message;
  if (els.statusPanel) {
    els.statusPanel.classList.remove("status-info", "status-success", "status-error");
    els.statusPanel.classList.add(`status-${type}`);
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
