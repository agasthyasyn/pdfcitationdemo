import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/* =========================================================
   GENERIC TEMPLATE-BASED PDF DOCUMENT BUILDER
   =========================================================

   What this script does:
   - Upload one sample/template PDF.
   - Upload one or more source PDFs.
   - Read template headings.
   - Read source text.
   - Map source content into the template heading structure.
   - Show a clean preview.
   - Export the same preview into PDF.

   What this script intentionally does NOT do:
   - It does not add system notes inside the final PDF.
   - It does not add "Source Page" labels inside the final PDF.
   - It does not embed full original source page screenshots into the final PDF.
   - It does not call the document "Formatted Document."
   - It does not modify the original uploaded files.

   Important:
   This is a browser-side JavaScript implementation.
   It can extract readable PDF text.
   It cannot perfectly extract and reposition every individual embedded image
   unless a separate advanced image-extraction layer is built later.
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
  templateData: null,
  templateStructure: null,
  processedDocs: [],
  auditLog: null
};

const CONFIG = {
  mappingThreshold: 0.14,

  minHeadingLength: 3,
  maxHeadingLength: 95,

  maxTemplateSnapshotPages: 3,
  maxSourceSnapshotPagesForPreviewOnly: 10,

  includeAdditionalDetails: true,

  output: {
    pageWidth: 595.28,
    pageHeight: 841.89,
    margin: 42,
    maxLineChars: 92
  }
};

bindEvents();

/* =========================================================
   EVENT BINDING
   ========================================================= */

function bindEvents() {
  els.templatePdfInput?.addEventListener("change", handleTemplateUpload);
  els.sourcePdfInput?.addEventListener("change", handleSourceUpload);
  els.processBtn?.addEventListener("click", processDocuments);
  els.exportPdfBtn?.addEventListener("click", exportPdf);
  els.exportAuditBtn?.addEventListener("click", exportAuditLog);
  els.resetBtn?.addEventListener("click", resetTool);
}

function handleTemplateUpload(event) {
  const file = event.target.files?.[0] || null;
  state.templateFile = file;

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
    setStatus("Reading template PDF...");

    const templateData = await extractPdfData(state.templateFile, {
      includeSnapshots: true,
      maxSnapshotPages: CONFIG.maxTemplateSnapshotPages
    });

    const templateStructure = extractTemplateStructure(templateData);

    if (!templateStructure.sections.length) {
      throw new Error("No usable headings were detected in the template PDF.");
    }

    state.templateData = templateData;
    state.templateStructure = templateStructure;

    const processedDocs = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];

      setStatus(`Processing ${file.name} (${i + 1} of ${state.sourceFiles.length})...`);

      const sourceData = await extractPdfData(file, {
        includeSnapshots: true,
        maxSnapshotPages: CONFIG.maxSourceSnapshotPagesForPreviewOnly
      });

      const sourceSections = splitIntoSections(sourceData.fullText);

      const mappedResult = mapSourceToTemplate({
        templateSections: templateStructure.sections,
        sourceSections
      });

      const title = inferDocumentTitle(sourceData.fullText, sourceData.fileName);

      const outputText = buildCleanBusinessDocumentText({
        title,
        mappedResult
      });

      processedDocs.push({
        sourceFileName: file.name,
        title,
        sourceData,
        sourceSections,
        mappedResult,
        outputText,
        snapshots: sourceData.snapshots
      });
    }

    state.processedDocs = processedDocs;

    els.formattedPreview.value = buildCombinedPreview(processedDocs);

    state.auditLog = buildAuditLog({
      templateData,
      templateStructure,
      processedDocs
    });

    renderDetectedDetails({
      templateData,
      templateStructure,
      processedDocs
    });

    renderSnapshotPreview(processedDocs);

    els.exportPdfBtn.disabled = false;
    els.exportAuditBtn.disabled = false;

    setStatus("Processing complete. Review the preview before export.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`, "error");
  }
}

function buildCombinedPreview(processedDocs) {
  if (processedDocs.length === 1) {
    return processedDocs[0].outputText;
  }

  return processedDocs
    .map((doc) => doc.outputText)
    .join("\n\n");
}

/* =========================================================
   PDF EXTRACTION
   ========================================================= */

async function extractPdfData(file, options = {}) {
  const includeSnapshots = options.includeSnapshots ?? true;
  const maxSnapshotPages = options.maxSnapshotPages ?? 0;

  const buffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: buffer,
    useSystemFonts: true
  }).promise;

  const pageTexts = [];
  const snapshots = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setStatus(`Reading ${file.name} - page ${pageNumber} of ${pdf.numPages}`);

    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const textItems = textContent.items.map((item) => ({
      text: item.str || "",
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
      width: item.width || 0,
      height: item.height || 0
    }));

    const readableText = buildReadablePageText(textItems);

    pageTexts.push({
      pageNumber,
      text: normalizeText(readableText),
      rawItems: textItems
    });

    if (includeSnapshots && pageNumber <= maxSnapshotPages) {
      const imageDataUrl = await renderPageSnapshot(page, 1.25);
      snapshots.push({
        pageNumber,
        imageDataUrl
      });
    }
  }

  const fullText = pageTexts
    .map((page) => `--- PAGE ${page.pageNumber} ---\n${page.text}`)
    .join("\n\n");

  return {
    fileName: file.name,
    pageCount: pdf.numPages,
    pageTexts,
    fullText: normalizeText(fullText),
    snapshots
  };
}

function buildReadablePageText(items) {
  if (!items.length) return "";

  const cleaned = items
    .filter((item) => item.text && item.text.trim())
    .sort((a, b) => {
      const yDiff = Math.round(b.y) - Math.round(a.y);
      if (Math.abs(yDiff) > 3) return yDiff;
      return a.x - b.x;
    });

  const lines = [];
  let currentLine = [];
  let currentY = null;

  for (const item of cleaned) {
    if (currentY === null) {
      currentY = item.y;
      currentLine.push(item);
      continue;
    }

    if (Math.abs(item.y - currentY) <= 3) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }

  if (currentLine.length) {
    lines.push(currentLine);
  }

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

async function renderPageSnapshot(page, scale = 1.25) {
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  return canvas.toDataURL("image/png");
}

/* =========================================================
   TEMPLATE STRUCTURE
   ========================================================= */

function extractTemplateStructure(templateData) {
  const documentTitle = inferDocumentTitle(templateData.fullText, templateData.fileName);

  const headings = detectHeadings(templateData.fullText)
    .map((heading) => ({
      ...heading,
      text: cleanTemplateHeading(heading.text)
    }))
    .filter((heading) => heading.text)
    .filter((heading) => !isDuplicateTitleHeading(heading.text, documentTitle))
    .filter((heading) => !isBlockedHeading(heading.text));

  const sections = headings.map((heading, index) => ({
    id: `section-${index + 1}`,
    heading: heading.text,
    pageNumber: heading.pageNumber,
    order: index + 1
  }));

  return {
    title: documentTitle,
    sections: sections.length
      ? sections
      : [
          {
            id: "section-1",
            heading: "Main Details",
            pageNumber: 1,
            order: 1
          }
        ]
  };
}

function detectHeadings(fullText) {
  const result = [];
  let currentPage = 1;

  for (const rawLine of fullText.split("\n")) {
    const line = normalizeLine(rawLine);

    const pageMatch = line.match(/^--- PAGE (\d+) ---$/i);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      continue;
    }

    if (!line) continue;

    if (isLikelyHeading(line)) {
      result.push({
        text: line,
        pageNumber: currentPage
      });
    }
  }

  return dedupeHeadings(result);
}

function isLikelyHeading(line) {
  const text = normalizeLine(line);

  if (!text) return false;
  if (text.length < CONFIG.minHeadingLength) return false;
  if (text.length > CONFIG.maxHeadingLength) return false;

  if (/^page\s+\d+$/i.test(text)) return false;
  if (/^source\s+page\s+\d+$/i.test(text)) return false;
  if (/^[-=_]{3,}$/.test(text)) return false;
  if (/https?:\/\//i.test(text)) return false;

  if (/[.!?]$/.test(text) && text.split(/\s+/).length > 8) {
    return false;
  }

  if (/^\d{1,3}(\.\d{1,3})?\s*[\).:-]?\s+[A-Z]/.test(text)) {
    return true;
  }

  if (/^[A-Z]\.\s+[A-Z]/.test(text)) {
    return true;
  }

  if (/^(SECTION|CHAPTER|PART|ARTICLE|APPENDIX)\s+[A-Z0-9]/i.test(text)) {
    return true;
  }

  const lettersOnly = text.replace(/[^a-zA-Z]/g, "");
  const upperLetters = text.replace(/[^A-Z]/g, "");

  if (
    lettersOnly.length >= 4 &&
    upperLetters.length / lettersOnly.length > 0.75 &&
    text.split(/\s+/).length <= 10
  ) {
    return true;
  }

  const words = text.split(/\s+/);
  const titleCaseWords = words.filter((word) =>
    /^[A-Z][a-zA-Z0-9/&()'-]*$/.test(word)
  );

  if (
    words.length >= 2 &&
    words.length <= 8 &&
    titleCaseWords.length / words.length >= 0.65
  ) {
    return true;
  }

  return false;
}

function dedupeHeadings(headings) {
  const seen = new Set();
  const result = [];

  for (const heading of headings) {
    const key = normalizeComparableText(cleanTemplateHeading(heading.text));

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(heading);
  }

  return result;
}

/* =========================================================
   SOURCE SECTION SPLITTING
   ========================================================= */

function splitIntoSections(fullText) {
  const lines = fullText.split("\n").map((line) => normalizeLine(line));

  const sections = [];
  let currentPage = 1;

  let current = {
    heading: "General Details",
    contentLines: [],
    pageNumber: 1,
    pageNumbers: new Set([1])
  };

  for (const line of lines) {
    if (!line) {
      current.contentLines.push("");
      continue;
    }

    const pageMatch = line.match(/^--- PAGE (\d+) ---$/i);

    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      current.pageNumbers.add(currentPage);
      continue;
    }

    if (isLikelyHeading(line)) {
      pushCurrentSection();

      current = {
        heading: cleanSourceHeading(line),
        contentLines: [],
        pageNumber: currentPage,
        pageNumbers: new Set([currentPage])
      };
    } else {
      current.contentLines.push(line);
      current.pageNumbers.add(currentPage);
    }
  }

  pushCurrentSection();

  if (!sections.length && normalizeText(fullText)) {
    sections.push({
      heading: "Main Details",
      content: removeInternalMarkers(normalizeText(fullText)),
      pageNumber: 1,
      pageNumbers: [1]
    });
  }

  return mergeTinySections(sections);

  function pushCurrentSection() {
    const content = removeInternalMarkers(normalizeText(current.contentLines.join("\n")));

    if (!content) return;

    const cleanHeading = cleanSourceHeading(current.heading);

    sections.push({
      heading: cleanHeading || "General Details",
      content,
      pageNumber: current.pageNumber,
      pageNumbers: Array.from(current.pageNumbers).sort((a, b) => a - b)
    });
  }
}

function mergeTinySections(sections) {
  const result = [];

  for (const section of sections) {
    const contentLength = section.content.trim().length;

    if (
      result.length &&
      contentLength < 80 &&
      !/^\d{1,3}(\.\d{1,3})?\s+/.test(section.heading)
    ) {
      const previous = result[result.length - 1];

      previous.content = normalizeText(
        `${previous.content}\n\n${section.heading}\n${section.content}`
      );

      previous.pageNumbers = Array.from(
        new Set([...(previous.pageNumbers || []), ...(section.pageNumbers || [])])
      ).sort((a, b) => a - b);
    } else {
      result.push({ ...section });
    }
  }

  return result;
}

/* =========================================================
   SECTION MAPPING
   ========================================================= */

function mapSourceToTemplate({ templateSections, sourceSections }) {
  const mappedSections = templateSections.map((templateSection) => ({
    templateHeading: templateSection.heading,
    templateOrder: templateSection.order,
    matchedSourceSections: [],
    finalContent: "",
    mappedPageNumbers: [],
    confidence: 0
  }));

  const usedSourceIndexes = new Set();

  sourceSections.forEach((sourceSection, sourceIndex) => {
    if (!sourceSection.content?.trim()) return;
    if (isBlockedHeading(sourceSection.heading)) return;

    let bestIndex = -1;
    let bestScore = 0;

    mappedSections.forEach((templateSection, templateIndex) => {
      const score = calculateSectionSimilarity(
        templateSection.templateHeading,
        sourceSection.heading,
        sourceSection.content
      );

      if (score > bestScore) {
        bestScore = score;
        bestIndex = templateIndex;
      }
    });

    if (bestIndex !== -1 && bestScore >= CONFIG.mappingThreshold) {
      mappedSections[bestIndex].matchedSourceSections.push({
        sourceIndex,
        sourceHeading: sourceSection.heading,
        sourcePageNumber: sourceSection.pageNumber,
        sourcePageNumbers: sourceSection.pageNumbers || [sourceSection.pageNumber],
        content: cleanBusinessContent(sourceSection.content),
        confidence: Number(bestScore.toFixed(3))
      });

      mappedSections[bestIndex].confidence = Math.max(
        mappedSections[bestIndex].confidence,
        Number(bestScore.toFixed(3))
      );

      usedSourceIndexes.add(sourceIndex);
    }
  });

  mappedSections.forEach((section) => {
    if (!section.matchedSourceSections.length) {
      section.finalContent = "";
      section.mappedPageNumbers = [];
      return;
    }

    section.finalContent = section.matchedSourceSections
      .map((match) => {
        const shouldShowSourceHeading =
          match.sourceHeading &&
          match.sourceHeading !== "General Details" &&
          !sameMeaningHeading(match.sourceHeading, section.templateHeading) &&
          !isBlockedHeading(match.sourceHeading);

        const heading = shouldShowSourceHeading ? `${match.sourceHeading}\n` : "";

        return cleanBusinessContent(`${heading}${match.content}`);
      })
      .filter(Boolean)
      .join("\n\n");

    section.mappedPageNumbers = Array.from(
      new Set(
        section.matchedSourceSections.flatMap((match) => match.sourcePageNumbers || [])
      )
    ).sort((a, b) => a - b);
  });

  const additionalSections = sourceSections
    .map((section, index) => ({
      ...section,
      sourceIndex: index
    }))
    .filter((section) => !usedSourceIndexes.has(section.sourceIndex))
    .filter((section) => section.content && section.content.trim())
    .filter((section) => !isBlockedHeading(section.heading))
    .map((section) => ({
      ...section,
      heading: cleanSourceHeading(section.heading),
      content: cleanBusinessContent(section.content)
    }))
    .filter((section) => section.content);

  return {
    mappedSections,
    additionalSections,
    totalSourceSections: sourceSections.length,
    mappedSourceSectionCount: usedSourceIndexes.size,
    additionalSourceSectionCount: additionalSections.length
  };
}

function calculateSectionSimilarity(templateHeading, sourceHeading, sourceContent) {
  const templateTokens = tokenize(templateHeading);
  const sourceHeadingTokens = tokenize(sourceHeading);
  const sourceContentTokens = tokenize(sourceContent).slice(0, 90);

  if (!templateTokens.length) return 0;

  const headingScore = jaccardSimilarity(templateTokens, sourceHeadingTokens);
  const contentScore = jaccardSimilarity(templateTokens, sourceContentTokens);

  return headingScore * 0.8 + contentScore * 0.2;
}

function tokenize(text) {
  const stopWords = new Set([
    "the",
    "and",
    "or",
    "of",
    "to",
    "in",
    "for",
    "on",
    "by",
    "with",
    "from",
    "as",
    "at",
    "is",
    "are",
    "was",
    "were",
    "this",
    "that",
    "these",
    "those",
    "a",
    "an",
    "details",
    "information",
    "document",
    "report",
    "section",
    "page",
    "source",
    "template"
  ]);

  return normalizeLine(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !stopWords.has(token));
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;

  return union ? intersection / union : 0;
}

/* =========================================================
   CLEAN DOCUMENT TEXT BUILDER
   ========================================================= */

function buildCleanBusinessDocumentText({ title, mappedResult }) {
  const lines = [];

  const cleanTitle = cleanDocumentTitle(title);

  lines.push(cleanTitle);
  lines.push("");

  let visibleSectionNumber = 1;

  mappedResult.mappedSections.forEach((section) => {
    const heading = cleanTemplateHeading(section.templateHeading);
    const content = cleanBusinessContent(section.finalContent);

    if (!content) return;
    if (!heading) return;
    if (isDuplicateTitleHeading(heading, cleanTitle)) return;
    if (isBlockedHeading(heading)) return;

    lines.push(`${visibleSectionNumber}. ${heading}`);
    lines.push("");
    lines.push(content);
    lines.push("");

    visibleSectionNumber++;
  });

  if (CONFIG.includeAdditionalDetails && mappedResult.additionalSections.length) {
    const additionalText = mappedResult.additionalSections
      .map((section) => {
        const heading =
          section.heading &&
          section.heading !== "General Details" &&
          !isBlockedHeading(section.heading)
            ? `${section.heading}\n`
            : "";

        return cleanBusinessContent(`${heading}${section.content}`);
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (additionalText) {
      lines.push(`${visibleSectionNumber}. Additional Details`);
      lines.push("");
      lines.push(additionalText);
      lines.push("");
    }
  }

  return normalizeText(lines.join("\n"));
}

function cleanBusinessContent(text) {
  let value = String(text || "");

  value = removeInternalMarkers(value);

  value = value
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter((line) => !isInternalOrSystemLine(line))
    .join("\n");

  value = value
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return value;
}

function removeInternalMarkers(text) {
  return String(text || "")
    .replace(/^--- PAGE \d+ ---$/gim, "")
    .replace(/\bSource Page\s+\d+\b/gi, "")
    .replace(/\bTemplate Used\s*:.*/gi, "")
    .replace(/\bSource File\s*:.*/gi, "")
    .replace(/\bGenerated On\s*:.*/gi, "")
    .replace(/\bGenerated At\s*:.*/gi, "")
    .replace(/\bOriginal Source\b/gi, "")
    .replace(/\bSource Preservation\b/gi, "")
    .replace(/\bTemplate-Based Standardized Document\b/gi, "")
    .replace(/\bFormatted Document\b/gi, "")
    .trim();
}

function isInternalOrSystemLine(line) {
  const value = normalizeComparableText(line);

  if (!value) return false;

  const blockedExact = new Set([
    "source page",
    "original source",
    "source preservation note",
    "source preservation appendix",
    "template used",
    "source file",
    "generated on",
    "generated at",
    "formatted document",
    "template based standardized document",
    "unmapped additional source content",
    "additional source content"
  ]);

  if (blockedExact.has(value)) return true;

  if (/^source page \d+$/i.test(line)) return true;
  if (/^template used\s*:/i.test(line)) return true;
  if (/^source file\s*:/i.test(line)) return true;
  if (/^generated (on|at)\s*:/i.test(line)) return true;

  return false;
}

/* =========================================================
   PDF EXPORT
   ========================================================= */

async function exportPdf() {
  if (!state.processedDocs.length) {
    setStatus("No processed document available to export.", "error");
    return;
  }

  try {
    setStatus("Generating PDF...");

    const previewText = els.formattedPreview.value.trim();

    if (!previewText) {
      throw new Error("Preview is empty. Please process the document first.");
    }

    const pdfDoc = await PDFDocument.create();

    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageSize = {
      width: CONFIG.output.pageWidth,
      height: CONFIG.output.pageHeight
    };

    const margin = CONFIG.output.margin;
    const contentWidth = pageSize.width - margin * 2;

    const title = inferPreviewTitle(previewText);

    addPreviewTextToPdf({
      pdfDoc,
      text: previewText,
      title,
      pageSize,
      margin,
      contentWidth,
      regularFont,
      boldFont
    });

    const bytes = await pdfDoc.save();

    const fileName =
      state.processedDocs.length === 1
        ? buildOutputFileName(state.processedDocs[0].sourceFileName)
        : "Updated_Documents.pdf";

    downloadBlob(bytes, fileName, "application/pdf");

    setStatus("PDF exported successfully.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Export failed: ${error.message}`, "error");
  }
}

function addPreviewTextToPdf({
  pdfDoc,
  text,
  title,
  pageSize,
  margin,
  contentWidth,
  regularFont,
  boldFont
}) {
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - margin;

  drawHeader(page, {
    title,
    font: boldFont,
    pageSize,
    margin
  });

  y -= 52;

  const lines = prepareTextLines(text, CONFIG.output.maxLineChars);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      y -= 7;
      continue;
    }

    if (y < margin + 45) {
      drawFooter(page, title, regularFont, pageSize, margin);

      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;

      drawHeader(page, {
        title,
        font: boldFont,
        pageSize,
        margin
      });

      y -= 52;
    }

    const isMainTitle =
      normalizeComparableText(trimmed) === normalizeComparableText(title);

    const isNumberedHeading = /^\d+\.\s+/.test(trimmed);

    const isSubheading =
      !isNumberedHeading &&
      !isMainTitle &&
      isLikelyHeading(trimmed) &&
      trimmed.length < 80;

    if (isMainTitle) {
      page.drawText(sanitizeForPdf(trimmed), {
        x: margin,
        y,
        size: 15,
        font: boldFont,
        color: rgb(0.13, 0.31, 0.43)
      });

      y -= 20;
      continue;
    }

    if (isNumberedHeading) {
      page.drawText(sanitizeForPdf(trimmed), {
        x: margin,
        y,
        size: 12,
        font: boldFont,
        color: rgb(0.13, 0.31, 0.43)
      });

      y -= 10;

      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + contentWidth, y },
        thickness: 0.6,
        color: rgb(0.55, 0.7, 0.8)
      });

      y -= 18;
      continue;
    }

    page.drawText(sanitizeForPdf(trimmed), {
      x: margin,
      y,
      size: isSubheading ? 10.3 : 9.2,
      font: isSubheading ? boldFont : regularFont,
      color: isSubheading ? rgb(0.16, 0.24, 0.32) : rgb(0.1, 0.12, 0.16)
    });

    y -= isSubheading ? 14 : 12;
  }

  drawFooter(page, title, regularFont, pageSize, margin);
}

function drawHeader(page, { title, font, pageSize, margin }) {
  page.drawText(sanitizeForPdf(title.substring(0, 90)), {
    x: margin,
    y: pageSize.height - 34,
    size: 13,
    font,
    color: rgb(0.13, 0.31, 0.43)
  });

  page.drawLine({
    start: { x: margin, y: pageSize.height - 42 },
    end: { x: pageSize.width - margin, y: pageSize.height - 42 },
    thickness: 0.8,
    color: rgb(0.55, 0.7, 0.8)
  });
}

function drawFooter(page, footer, font, pageSize, margin) {
  page.drawLine({
    start: { x: margin, y: 32 },
    end: { x: pageSize.width - margin, y: 32 },
    thickness: 0.4,
    color: rgb(0.85, 0.9, 0.94)
  });

  page.drawText(sanitizeForPdf(footer.substring(0, 90)), {
    x: margin,
    y: 18,
    size: 7.5,
    font,
    color: rgb(0.45, 0.45, 0.45)
  });
}

/* =========================================================
   UI RENDERING
   ========================================================= */

function renderDetectedDetails({ templateData, templateStructure, processedDocs }) {
  const lines = [];

  lines.push(`Template: ${templateData.fileName}`);
  lines.push(`Template Pages: ${templateData.pageCount}`);
  lines.push(`Detected Sections: ${templateStructure.sections.length}`);
  lines.push("");

  templateStructure.sections.forEach((section) => {
    lines.push(`${section.order}. ${section.heading}`);
  });

  lines.push("");
  lines.push("-----------------------------");
  lines.push("");

  processedDocs.forEach((doc, index) => {
    lines.push(`Document ${index + 1}: ${doc.sourceFileName}`);
    lines.push(`Title: ${doc.title}`);
    lines.push(`Pages: ${doc.sourceData.pageCount}`);
    lines.push(`Detected Sections: ${doc.sourceSections.length}`);
    lines.push(`Mapped Sections: ${doc.mappedResult.mappedSourceSectionCount}`);
    lines.push(`Additional Sections: ${doc.mappedResult.additionalSourceSectionCount}`);
    lines.push("");
  });

  els.detectedDetails.textContent = lines.join("\n");
}

function renderSnapshotPreview(processedDocs) {
  if (!els.snapshotList) return;

  els.snapshotList.innerHTML = "";

  processedDocs.forEach((doc, docIndex) => {
    doc.snapshots.forEach((snapshot) => {
      const card = document.createElement("div");
      card.className = "snapshot-card";

      const img = document.createElement("img");
      img.src = snapshot.imageDataUrl;
      img.alt = `${doc.sourceFileName} page ${snapshot.pageNumber}`;

      const label = document.createElement("p");
      label.textContent = `Document ${docIndex + 1} | Page ${snapshot.pageNumber}`;

      card.appendChild(img);
      card.appendChild(label);
      els.snapshotList.appendChild(card);
    });
  });
}

/* =========================================================
   AUDIT LOG
   ========================================================= */

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

function buildAuditLog({ templateData, templateStructure, processedDocs }) {
  return {
    generatedAt: new Date().toISOString(),
    template: {
      fileName: templateData.fileName,
      pageCount: templateData.pageCount,
      detectedSections: templateStructure.sections.map((section) => ({
        order: section.order,
        heading: section.heading,
        pageNumber: section.pageNumber
      }))
    },
    documents: processedDocs.map((doc) => ({
      fileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.sourceData.pageCount,
      detectedSections: doc.sourceSections.length,
      mappedSections: doc.mappedResult.mappedSections.map((section) => ({
        heading: section.templateHeading,
        confidence: section.confidence,
        pages: section.mappedPageNumbers,
        matches: section.matchedSourceSections.map((match) => ({
          heading: match.sourceHeading,
          pages: match.sourcePageNumbers,
          confidence: match.confidence,
          characterCount: match.content.length
        }))
      })),
      additionalSections: doc.mappedResult.additionalSections.map((section) => ({
        heading: section.heading,
        pages: section.pageNumbers,
        characterCount: section.content.length
      }))
    }))
  };
}

/* =========================================================
   TITLE / HEADING CLEANING
   ========================================================= */

function inferDocumentTitle(fullText, fileName) {
  const cleanedFileName = removePdfExtension(fileName).replace(/[_-]+/g, " ");

  const lines = fullText
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .filter((line) => !/^--- PAGE \d+ ---$/i.test(line))
    .filter((line) => !/^source\s+page\s+\d+$/i.test(line))
    .filter((line) => !isInternalOrSystemLine(line));

  const firstGoodTitle = lines.find((line) => {
    if (line.length < 4 || line.length > 120) return false;
    if (/^page\s+\d+/i.test(line)) return false;
    if (/^\d+\.\s+/.test(line)) return false;
    if (isBlockedHeading(line)) return false;

    return isLikelyHeading(line) || /^[A-Z][A-Za-z0-9 ,/&()'’-]+$/.test(line);
  });

  if (firstGoodTitle) {
    return cleanDocumentTitle(firstGoodTitle);
  }

  return cleanDocumentTitle(cleanedFileName);
}

function inferPreviewTitle(text) {
  const firstLine = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return cleanDocumentTitle(firstLine || "Document");
}

function cleanDocumentTitle(text) {
  const cleaned = normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/^\d{1,3}\.\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .trim();

  return cleaned || "Document";
}

function cleanTemplateHeading(text) {
  return normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/^\d{1,3}\.\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .trim();
}

function cleanSourceHeading(text) {
  return normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/^source\s+page\s+\d+$/i, "")
    .replace(/^\d{1,3}\.\s*/, "")
    .replace(/[:\-–—]+$/, "")
    .trim();
}

function isDuplicateTitleHeading(heading, title) {
  const h = normalizeComparableText(heading);
  const t = normalizeComparableText(title);

  if (!h || !t) return false;

  return h === t || h.includes(t) || t.includes(h);
}

function isBlockedHeading(heading) {
  const value = normalizeComparableText(heading);

  if (!value) return false;

  const blocked = [
    "formatted document",
    "template based standardized document",
    "source preservation appendix",
    "source preservation note",
    "source page",
    "template used",
    "source file",
    "generated on",
    "generated at",
    "original source",
    "unmapped additional source content",
    "additional source content"
  ];

  return blocked.some((item) => value === item || value.includes(item));
}

function sameMeaningHeading(a, b) {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  return jaccardSimilarity(aTokens, bTokens) > 0.65;
}

/* =========================================================
   TEXT WRAPPING / PDF SANITIZATION
   ========================================================= */

function prepareTextLines(text, maxCharsPerLine) {
  const result = [];
  const rawLines = String(text || "").split("\n");

  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    if (!line) {
      result.push("");
      continue;
    }

    result.push(...wrapText(line, maxCharsPerLine));
  }

  return result;
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = `${line} ${word}`.trim();

    if (next.length > maxChars && line.length) {
      lines.push(line);
      line = word;
    } else {
      line = next;
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
   FILE / DOWNLOAD HELPERS
   ========================================================= */

function buildOutputFileName(sourceFileName) {
  const base = removePdfExtension(sourceFileName)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 90);

  return `${base}_Updated.pdf`;
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

/* =========================================================
   STATUS / RESET
   ========================================================= */

function setStatus(message, type = "") {
  if (!els.statusText || !els.statusPanel) return;

  els.statusText.textContent = message;

  els.statusPanel.classList.remove("success", "error");

  if (type === "success") els.statusPanel.classList.add("success");
  if (type === "error") els.statusPanel.classList.add("error");
}

function resetTool() {
  state.templateFile = null;
  state.sourceFiles = [];
  state.templateData = null;
  state.templateStructure = null;
  state.processedDocs = [];
  state.auditLog = null;

  els.templatePdfInput.value = "";
  els.sourcePdfInput.value = "";

  els.templateFileInfo.textContent = "No template uploaded yet.";
  els.sourceFileInfo.textContent = "No source documents uploaded yet.";

  resetOutputOnly();

  setStatus("Tool reset.");
}

function resetOutputOnly() {
  els.formattedPreview.value = "";
  els.detectedDetails.textContent = "No document processed yet.";
  els.snapshotList.innerHTML = "";

  els.exportPdfBtn.disabled = true;
  els.exportAuditBtn.disabled = true;

  state.processedDocs = [];
  state.auditLog = null;
}

/* =========================================================
   NORMALIZATION / HTML ESCAPE
   ========================================================= */

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLine(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeComparableText(text) {
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
