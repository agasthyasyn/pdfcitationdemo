import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import { loadTemplateController } from "./schema.controller.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/* =========================================================
   CLEAN TEMPLATE-BASED PDF DOCUMENT BUILDER
   =========================================================

   Purpose:
   - Use a sample/template PDF only to understand the expected document structure.
   - Rebuild uploaded source PDFs into a clean, consistent business document.
   - Keep all useful source text.
   - Avoid system notes, source-page labels, original-source sections, and unwanted titles.
   - Keep preview and PDF export based on the same structured output.
   - Carry visual content/images as best-effort mapped figures using PDF page rendering.

   Important browser limitation:
   - Browser-side PDF.js can reliably extract text and render pages.
   - True embedded-image extraction from arbitrary PDFs is inconsistent across PDFs.
   - This script therefore uses a safer approach:
     1. Detect pages that likely contain visual content.
     2. Render those pages.
     3. Crop non-header/non-footer visual areas when possible.
     4. Attach those figures to the closest relevant document section.

   Required HTML IDs expected by this script:
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
  templateProfile: null,
  documents: [],
  auditLog: null
};

const CONFIG = {
  extraction: {
    lineYTolerance: 3.5,
    wordGapMultiplier: 0.55,
    minVisualAreaRatio: 0.08,
    maxVisualsPerDocument: 8,
    renderScale: 1.6
  },
  mapping: {
    minScore: 0.18,
    strongScore: 0.38,
    keepUnmappedContent: true
  },
  structure: {
    minHeadingLength: 3,
    maxHeadingLength: 110,
    maxTemplateSections: 45,
    fallbackSections: [
      "Port Information",
      "Vessel Details",
      "Arrival / Berthing / Departure Details",
      "Berth / Terminal Details",
      "Cargo / Operations Details",
      "Restrictions / Requirements",
      "Agency / Contact Details",
      "Additional Details"
    ]
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
    figureMaxHeight: 210
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

bindEvents();
setInitialState();

/* =========================================================
   EVENTS
   ========================================================= */

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
  setStatus("Upload a template PDF and one or more source PDFs.");
}

function handleTemplateUpload(event) {
  const file = event.target.files?.[0] || null;
  state.templateFile = file;
  state.templateProfile = null;

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

/* =========================================================
   MAIN PROCESS
   ========================================================= */

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
    setStatus("Reading template structure...");

    const templatePdf = await extractPdf(state.templateFile, {
      collectVisuals: false
    });

    const templateProfile = buildTemplateProfile(templatePdf);
    state.templateProfile = templateProfile;

    const documents = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];
      setStatus(`Processing ${file.name} (${i + 1} of ${state.sourceFiles.length})...`);

      const sourcePdf = await extractPdf(file, {
        collectVisuals: true
      });

      const sourceProfile = buildSourceProfile(sourcePdf);
      const documentModel = buildDocumentModel({
        sourcePdf,
        sourceProfile,
        templateProfile
      });

      documents.push(documentModel);
    }

    state.documents = documents;
    state.auditLog = buildAuditLog(templateProfile, documents);

    renderPreview(documents);
    renderDetectedDetails(templateProfile, documents);
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

    if (collectVisuals) {
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

function detectVisualCandidates({ pageNumber, viewport, lines, renderedPage }) {
  if (!renderedPage) return [];

  const bodyLines = lines.filter((line) => {
    const top = viewport.height - line.y;
    return top > 70 && top < viewport.height - 55;
  });

  const textCoverage = bodyLines.reduce((sum, line) => {
    return sum + Math.max(0, line.width * Math.max(line.height, 8));
  }, 0);

  const pageArea = viewport.width * viewport.height;
  const textCoverageRatio = textCoverage / pageArea;

  const hasSparseText = textCoverageRatio < 0.12;
  const hasLikelyFigureKeywords = lines.some((line) =>
    /diagram|image|photo|figure|map|berth|terminal|layout|plan|chart|table/i.test(line.text)
  );

  if (!hasSparseText && !hasLikelyFigureKeywords) return [];

  const crop = {
    x: 32,
    y: 70,
    width: viewport.width - 64,
    height: viewport.height - 135
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
      confidence: hasLikelyFigureKeywords ? 0.72 : 0.48
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
   TEMPLATE PROFILE
   ========================================================= */

function buildTemplateProfile(templatePdf) {
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

  if (!sections.length) {
    sections = CONFIG.structure.fallbackSections.map((heading, index) => ({
      id: `template-section-${index + 1}`,
      order: index + 1,
      heading,
      sourcePageNumber: 1,
      confidence: 0.2
    }));
  }

  return {
    fileName: templatePdf.fileName,
    pageCount: templatePdf.pageCount,
    title,
    sections
  };
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
  if (words.length >= 2 && words.length <= 9 && titleCaseWords.length / words.length >= 0.65) {
    return 0.36;
  }

  if (/^(port|vessel|cargo|berth|terminal|arrival|departure|agent|agency|restriction|requirement|contact|draft|loa|beam|dwt|anchorage|pilot|tug|weather|document)s?\b/i.test(clean)) {
    return 0.38;
  }

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
   SOURCE PROFILE
   ========================================================= */

function buildSourceProfile(sourcePdf) {
  const title = inferDocumentTitle(sourcePdf.fullText, sourcePdf.fileName);
  const sections = splitSourceIntoSections(sourcePdf, title);
  const keyValueFacts = extractKeyValueFacts(sourcePdf.fullText);

  return {
    title,
    sections,
    keyValueFacts
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

  return merged.map((section, index) => ({
    ...section,
    id: `source-section-${index + 1}`
  }));

  function makeSection(heading, pageNumber) {
    return {
      heading,
      pageNumber,
      pageNumbers: new Set([pageNumber]),
      lines: []
    };
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
      result.push({
        ...section,
        heading,
        content,
        tokens: tokenize(`${heading}\n${content}`)
      });
    }
  }

  return result;
}

function extractKeyValueFacts(text) {
  const facts = [];
  const lines = cleanExtractedText(text).split("\n").map(normalizeLine).filter(Boolean);

  for (const line of lines) {
    if (isBlockedText(line)) continue;

    const match = line.match(/^(.{2,55}?)(?:\s*[:\-–—]\s+|\s{2,})(.{2,180})$/);
    if (!match) continue;

    const key = cleanHeading(match[1]);
    const value = normalizeLine(match[2]);

    if (!key || !value) continue;
    if (looksLikeBodySentence(key)) continue;

    facts.push({ key, value, tokens: tokenize(`${key} ${value}`) });
  }

  return facts;
}

/* =========================================================
   DOCUMENT MODEL
   ========================================================= */

function buildDocumentModel({ sourcePdf, sourceProfile, templateProfile }) {
  const mappedSections = templateProfile.sections.map((templateSection) => ({
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

    if (best.index >= 0 && best.score >= CONFIG.mapping.minScore) {
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

  if (CONFIG.mapping.keepUnmappedContent) {
    const unmapped = sourceProfile.sections.filter((section) => !usedSourceIds.has(section.id));
    const additional = cleanAdditionalSections(unmapped);

    if (additional.length) {
      const additionalTarget = findOrCreateAdditionalSection(mappedSections);
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
    .map((section) => ({
      ...section,
      blocks: mergeTextBlocks(section.blocks)
    }))
    .filter((section) => section.blocks.some((block) => block.type === "text" && block.text.trim()));

  attachVisualsToSections({
    sourcePdf,
    sections: finalSections
  });

  return {
    sourceFileName: sourcePdf.fileName,
    title: cleanDocumentTitle(sourceProfile.title || inferDocumentTitle(sourcePdf.fullText, sourcePdf.fileName)),
    pageCount: sourcePdf.pageCount,
    sections: finalSections,
    sourceSectionCount: sourceProfile.sections.length,
    factsDetected: sourceProfile.keyValueFacts.length
  };
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

  return {
    index: bestIndex,
    score: Number(bestScore.toFixed(3))
  };
}

function scoreSectionMatch(templateHeading, sourceSection) {
  const templateTokens = tokenize(templateHeading);
  const sourceHeadingTokens = tokenize(sourceSection.heading);
  const sourceContentTokens = tokenize(sourceSection.content).slice(0, 120);
  const combinedSourceTokens = uniqueTokens([...sourceHeadingTokens, ...sourceContentTokens]);

  if (!templateTokens.length || !combinedSourceTokens.length) return 0;

  const headingScore = weightedTokenOverlap(templateTokens, sourceHeadingTokens);
  const contentScore = weightedTokenOverlap(templateTokens, sourceContentTokens);
  const semanticScore = semanticBoost(templateHeading, `${sourceSection.heading}\n${sourceSection.content}`);

  return Math.min(1, headingScore * 0.55 + contentScore * 0.25 + semanticScore * 0.2);
}

function semanticBoost(templateHeading, sourceText) {
  const h = comparable(templateHeading);
  const s = comparable(sourceText);

  const groups = [
    { keys: ["arrival", "berthing", "departure", "eta", "etb", "etd", "nor"], labels: ["arrival", "berthing", "departure", "date"] },
    { keys: ["berth", "terminal", "jetty", "draft", "depth", "loa", "beam"], labels: ["berth", "terminal", "jetty", "draft", "depth"] },
    { keys: ["vessel", "ship", "imo", "flag", "dwt", "loa", "beam"], labels: ["vessel", "ship", "particular"] },
    { keys: ["cargo", "operation", "loading", "discharging", "quantity", "mt"], labels: ["cargo", "operation"] },
    { keys: ["agent", "agency", "contact", "phone", "email", "pic"], labels: ["agent", "agency", "contact"] },
    { keys: ["restriction", "requirement", "rule", "prohibition", "allowed", "permission"], labels: ["restriction", "requirement"] },
    { keys: ["port", "country", "location", "anchorage", "pilot", "tug"], labels: ["port", "information", "location"] }
  ];

  let boost = 0;

  for (const group of groups) {
    const headingHit = group.labels.some((label) => h.includes(label));
    const sourceHits = group.keys.filter((key) => s.includes(key)).length;
    if (headingHit && sourceHits) boost = Math.max(boost, Math.min(0.45, sourceHits * 0.08));
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

  if (shouldKeepSourceHeading && content) {
    return cleanBusinessContent(`${sourceHeading}\n${content}`);
  }

  return content || sourceHeading;
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

function findOrCreateAdditionalSection(mappedSections) {
  let section = mappedSections.find((item) => comparable(item.heading) === "additional details");

  if (!section) {
    section = {
      id: `template-section-${mappedSections.length + 1}`,
      order: mappedSections.length + 1,
      heading: "Additional Details",
      blocks: [],
      matchedSourceIds: [],
      score: 0,
      pageNumbers: []
    };
    mappedSections.push(section);
  }

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

    let target = sections.find((section) => section.pageNumbers.includes(visual.pageNumber));
    if (!target && sections.length) target = sections[sections.length - 1];
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

  doc.sections.forEach((section, index) => {
    const heading = cleanHeading(section.heading);
    if (!heading || isBlockedText(heading)) return;

    lines.push(`${index + 1}. ${heading}`);
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
  const pageSize = {
    width: CONFIG.output.pageWidth,
    height: CONFIG.output.pageHeight
  };

  const margin = CONFIG.output.margin;
  const contentWidth = pageSize.width - margin * 2;
  const title = cleanDocumentTitle(doc.title);

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = drawPageHeader(page, title, fonts, pageSize, margin);

  y = drawTitle(page, title, fonts, margin, y);

  for (let s = 0; s < doc.sections.length; s++) {
    const section = doc.sections[s];
    const heading = `${s + 1}. ${cleanHeading(section.heading)}`;

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

function addBlankPageBreak(pdfDoc) {
  const pageSize = [CONFIG.output.pageWidth, CONFIG.output.pageHeight];
  pdfDoc.addPage(pageSize);
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
   UI RENDERING
   ========================================================= */

function renderDetectedDetails(templateProfile, documents) {
  const lines = [];

  lines.push(`Template: ${templateProfile.fileName}`);
  lines.push(`Template Pages: ${templateProfile.pageCount}`);
  lines.push(`Detected Template Sections: ${templateProfile.sections.length}`);
  lines.push("");

  templateProfile.sections.forEach((section) => {
    lines.push(`${section.order}. ${section.heading}`);
  });

  lines.push("");
  lines.push("-----------------------------");
  lines.push("");

  documents.forEach((doc, index) => {
    const imageCount = doc.sections.flatMap((section) => section.blocks).filter((block) => block.type === "image").length;

    lines.push(`Document ${index + 1}: ${doc.sourceFileName}`);
    lines.push(`Title: ${doc.title}`);
    lines.push(`Pages: ${doc.pageCount}`);
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

/* =========================================================
   AUDIT LOG
   ========================================================= */

function buildAuditLog(templateProfile, documents) {
  return {
    generatedAt: new Date().toISOString(),
    template: {
      fileName: templateProfile.fileName,
      pageCount: templateProfile.pageCount,
      title: templateProfile.title,
      sections: templateProfile.sections.map((section) => ({
        order: section.order,
        heading: section.heading,
        confidence: section.confidence
      }))
    },
    documents: documents.map((doc) => ({
      fileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.pageCount,
      sourceSectionCount: doc.sourceSectionCount,
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

  const blob = new Blob([JSON.stringify(state.auditLog, null, 2)], {
    type: "application/json"
  });

  downloadBlob(blob, "Document_Audit_Log.json", "application/json");
  setStatus("Audit log exported successfully.", "success");
}

/* =========================================================
   TEXT CLEANING / TITLE LOGIC
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

  if (candidates.length) return cleanDocumentTitle(candidates[0]);
  return fileTitle || "Document";
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
  if (/^(the|this|these|those|it|they|we|please|kindly)\b/i.test(value) && words.length > 7) return true;

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

/* =========================================================
   TOKEN SCORING
   ========================================================= */

function tokenize(text) {
  const stopWords = new Set([
    "the", "and", "or", "of", "to", "in", "for", "on", "by", "with", "from", "as", "at",
    "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those",
    "a", "an", "details", "information", "document", "report", "section", "page", "source",
    "template", "updated", "formatted", "general", "main"
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
