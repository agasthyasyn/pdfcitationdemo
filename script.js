import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

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
  maxHeadingLength: 95,
  minHeadingLength: 3,
  maxSnapshotPagesPerSource: 150,
  maxTemplateSnapshotPages: 5,
  includeAdditionalDetails: true,
  includeImagesInsideSections: true,
  imageMaxHeight: 360
};

bindEvents();

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

async function processDocuments() {
  if (!state.templateFile) {
    setStatus("Please upload a template PDF first.", "error");
    return;
  }

  if (!state.sourceFiles.length) {
    setStatus("Please upload at least one document to update.", "error");
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
        maxSnapshotPages: CONFIG.maxSnapshotPagesPerSource
      });

      const sourceSections = splitIntoSections(sourceData.fullText);

      const mappedResult = mapSourceToTemplate({
        templateSections: templateStructure.sections,
        sourceSections
      });

      const outputText = buildBusinessDocumentText({
        sourceData,
        templateStructure,
        mappedResult
      });

      processedDocs.push({
        sourceFileName: file.name,
        title: inferDocumentTitle(sourceData.fullText, file.name),
        sourceData,
        sourceSections,
        mappedResult,
        outputText,
        snapshots: sourceData.snapshots
      });
    }

    state.processedDocs = processedDocs;

    els.formattedPreview.value = processedDocs
      .map(doc => doc.outputText)
      .join("\n\n");

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

    setStatus("Processing complete. Review the content before export.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error.message}`, "error");
  }
}

async function extractPdfData(file, options = {}) {
  const includeSnapshots = options.includeSnapshots ?? true;
  const maxSnapshotPages = options.maxSnapshotPages ?? 100;

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

    const textItems = textContent.items.map(item => ({
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
      const imageDataUrl = await renderPageSnapshot(page, 1.5);
      snapshots.push({
        pageNumber,
        imageDataUrl
      });
    }
  }

  const fullText = pageTexts
    .map(page => `--- PAGE ${page.pageNumber} ---\n${page.text}`)
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
    .filter(item => item.text && item.text.trim())
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

  if (currentLine.length) lines.push(currentLine);

  return lines
    .map(line =>
      line
        .sort((a, b) => a.x - b.x)
        .map(item => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

async function renderPageSnapshot(page, scale = 1.5) {
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

function extractTemplateStructure(templateData) {
  const headings = detectHeadings(templateData.fullText);

  const sections = headings.map((heading, index) => ({
    id: `section-${index + 1}`,
    heading: cleanTemplateHeading(heading.text),
    pageNumber: heading.pageNumber,
    order: index + 1
  }));

  return {
    title: inferDocumentTitle(templateData.fullText, templateData.fileName),
    sections: sections.length
      ? sections
      : [
          {
            id: "section-1",
            heading: inferDocumentTitle(templateData.fullText, templateData.fileName),
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
  if (/^[-=_]{3,}$/.test(text)) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (/[.!?]$/.test(text) && text.split(/\s+/).length > 8) return false;

  if (/^\d{1,2}(\.\d{1,2})?\s*[\).:-]?\s+[A-Z]/.test(text)) return true;
  if (/^[A-Z]\.\s+[A-Z]/.test(text)) return true;
  if (/^(SECTION|CHAPTER|PART|ARTICLE|APPENDIX)\s+[A-Z0-9]/i.test(text)) return true;

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
  const titleCaseWords = words.filter(word =>
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
    const key = cleanTemplateHeading(heading.text).toLowerCase();

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(heading);
  }

  return result;
}

function splitIntoSections(fullText) {
  const lines = fullText.split("\n").map(line => normalizeLine(line));

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
      content: normalizeText(fullText),
      pageNumber: 1,
      pageNumbers: [1]
    });
  }

  return mergeTinySections(sections);

  function pushCurrentSection() {
    const content = normalizeText(current.contentLines.join("\n"));

    if (!content) return;

    sections.push({
      heading: current.heading,
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
      !/^\d{1,2}(\.\d{1,2})?\s+/.test(section.heading)
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

function mapSourceToTemplate({ templateSections, sourceSections }) {
  const mappedSections = templateSections.map(templateSection => ({
    templateHeading: templateSection.heading,
    templateOrder: templateSection.order,
    matchedSourceSections: [],
    finalContent: "",
    mappedPageNumbers: [],
    confidence: 0
  }));

  const usedSourceIndexes = new Set();

  sourceSections.forEach((sourceSection, sourceIndex) => {
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
        content: sourceSection.content,
        confidence: Number(bestScore.toFixed(3))
      });

      mappedSections[bestIndex].confidence = Math.max(
        mappedSections[bestIndex].confidence,
        Number(bestScore.toFixed(3))
      );

      usedSourceIndexes.add(sourceIndex);
    }
  });

  mappedSections.forEach(section => {
    if (!section.matchedSourceSections.length) {
      section.finalContent = "";
      section.mappedPageNumbers = [];
      return;
    }

    section.finalContent = section.matchedSourceSections
      .map(match => {
        const heading =
          match.sourceHeading &&
          match.sourceHeading !== "General Details" &&
          !sameMeaningHeading(match.sourceHeading, section.templateHeading)
            ? `${match.sourceHeading}\n`
            : "";

        return `${heading}${match.content}`;
      })
      .join("\n\n");

    section.mappedPageNumbers = Array.from(
      new Set(
        section.matchedSourceSections.flatMap(match => match.sourcePageNumbers || [])
      )
    ).sort((a, b) => a - b);
  });

  const additionalSections = sourceSections
    .map((section, index) => ({
      ...section,
      sourceIndex: index
    }))
    .filter(section => !usedSourceIndexes.has(section.sourceIndex))
    .filter(section => section.content && section.content.trim());

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
    "section"
  ]);

  return normalizeLine(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 2)
    .filter(token => !stopWords.has(token));
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

function buildBusinessDocumentText({ sourceData, mappedResult }) {
  const title = inferDocumentTitle(sourceData.fullText, sourceData.fileName);
  const lines = [];

  lines.push(title);
  lines.push("");

  mappedResult.mappedSections.forEach((section, index) => {
    const content = normalizeText(section.finalContent);

    if (!content) return;

    lines.push(`${index + 1}. ${section.templateHeading}`);
    lines.push("");
    lines.push(content);
    lines.push("");
  });

  if (CONFIG.includeAdditionalDetails && mappedResult.additionalSections.length) {
    lines.push("Additional Details");
    lines.push("");

    mappedResult.additionalSections.forEach(section => {
      if (section.heading && section.heading !== "General Details") {
        lines.push(section.heading);
        lines.push("");
      }

      lines.push(section.content);
      lines.push("");
    });
  }

  return normalizeText(lines.join("\n"));
}

async function exportPdf() {
  if (!state.processedDocs.length) {
    setStatus("No processed document available to export.", "error");
    return;
  }

  try {
    setStatus("Generating PDF...");

    const pdfDoc = await PDFDocument.create();

    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const pageSize = {
      width: 595.28,
      height: 841.89
    };

    const margin = 42;
    const contentWidth = pageSize.width - margin * 2;

    for (let docIndex = 0; docIndex < state.processedDocs.length; docIndex++) {
      const doc = state.processedDocs[docIndex];

      if (docIndex > 0) {
        addDividerPage({
          pdfDoc,
          pageSize,
          margin,
          boldFont,
          text: doc.title
        });
      }

      await addDocumentToPdf({
        pdfDoc,
        doc,
        pageSize,
        margin,
        contentWidth,
        regularFont,
        boldFont,
        italicFont
      });
    }

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

async function addDocumentToPdf({
  pdfDoc,
  doc,
  pageSize,
  margin,
  contentWidth,
  regularFont,
  boldFont,
  italicFont
}) {
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - margin;

  drawHeader(page, {
    title: doc.title,
    font: boldFont,
    pageSize,
    margin
  });

  y -= 52;

  for (let i = 0; i < doc.mappedResult.mappedSections.length; i++) {
    const section = doc.mappedResult.mappedSections[i];
    const content = normalizeText(section.finalContent);

    if (!content && !section.mappedPageNumbers.length) continue;

    const result = drawSectionText({
      pdfDoc,
      page,
      y,
      heading: `${i + 1}. ${section.templateHeading}`,
      content,
      pageSize,
      margin,
      contentWidth,
      regularFont,
      boldFont,
      italicFont,
      footer: doc.title
    });

    page = result.page;
    y = result.y;

    if (CONFIG.includeImagesInsideSections && section.mappedPageNumbers.length) {
      const imageResult = await drawSectionImages({
        pdfDoc,
        page,
        y,
        pageNumbers: section.mappedPageNumbers,
        snapshots: doc.snapshots,
        pageSize,
        margin,
        contentWidth,
        regularFont,
        boldFont,
        footer: doc.title
      });

      page = imageResult.page;
      y = imageResult.y;
    }
  }

  if (CONFIG.includeAdditionalDetails && doc.mappedResult.additionalSections.length) {
    const additionalText = doc.mappedResult.additionalSections
      .map(section => {
        const heading =
          section.heading && section.heading !== "General Details"
            ? `${section.heading}\n`
            : "";

        return `${heading}${section.content}`;
      })
      .join("\n\n");

    const result = drawSectionText({
      pdfDoc,
      page,
      y,
      heading: "Additional Details",
      content: additionalText,
      pageSize,
      margin,
      contentWidth,
      regularFont,
      boldFont,
      italicFont,
      footer: doc.title
    });

    page = result.page;
    y = result.y;

    const additionalPages = Array.from(
      new Set(
        doc.mappedResult.additionalSections.flatMap(section => section.pageNumbers || [])
      )
    ).sort((a, b) => a - b);

    const imageResult = await drawSectionImages({
      pdfDoc,
      page,
      y,
      pageNumbers: additionalPages,
      snapshots: doc.snapshots,
      pageSize,
      margin,
      contentWidth,
      regularFont,
      boldFont,
      footer: doc.title
    });

    page = imageResult.page;
    y = imageResult.y;
  }

  drawFooter(page, doc.title, regularFont, pageSize, margin);
}

function drawSectionText({
  pdfDoc,
  page,
  y,
  heading,
  content,
  pageSize,
  margin,
  contentWidth,
  regularFont,
  boldFont,
  footer
}) {
  if (y < margin + 100) {
    drawFooter(page, footer, regularFont, pageSize, margin);
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    y = pageSize.height - margin;
  }

  page.drawText(sanitizeForPdf(heading), {
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

  const lines = prepareTextLines(content, 92);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      y -= 7;
      continue;
    }

    if (y < margin + 45) {
      drawFooter(page, footer, regularFont, pageSize, margin);
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;
    }

    const isSubheading = isLikelyHeading(trimmed) && trimmed.length < 80;

    page.drawText(sanitizeForPdf(trimmed), {
      x: margin,
      y,
      size: isSubheading ? 10.3 : 9.2,
      font: isSubheading ? boldFont : regularFont,
      color: isSubheading ? rgb(0.16, 0.24, 0.32) : rgb(0.1, 0.12, 0.16)
    });

    y -= isSubheading ? 14 : 12;
  }

  y -= 12;

  return { page, y };
}

async function drawSectionImages({
  pdfDoc,
  page,
  y,
  pageNumbers,
  snapshots,
  pageSize,
  margin,
  contentWidth,
  regularFont,
  footer
}) {
  const uniquePageNumbers = Array.from(new Set(pageNumbers)).sort((a, b) => a - b);

  for (const pageNumber of uniquePageNumbers) {
    const snapshot = snapshots.find(item => item.pageNumber === pageNumber);
    if (!snapshot) continue;

    const image = await pdfDoc.embedPng(snapshot.imageDataUrl);

    const maxWidth = contentWidth;
    const maxHeight = CONFIG.imageMaxHeight;

    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);

    const imgWidth = image.width * scale;
    const imgHeight = image.height * scale;

    if (y < margin + imgHeight + 35) {
      drawFooter(page, footer, regularFont, pageSize, margin);
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;
    }

    page.drawImage(image, {
      x: margin,
      y: y - imgHeight,
      width: imgWidth,
      height: imgHeight
    });

    y -= imgHeight + 18;
  }

  return { page, y };
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

function addDividerPage({ pdfDoc, pageSize, margin, boldFont, text }) {
  const page = pdfDoc.addPage([pageSize.width, pageSize.height]);

  page.drawText(sanitizeForPdf(text.substring(0, 90)), {
    x: margin,
    y: pageSize.height / 2,
    size: 18,
    font: boldFont,
    color: rgb(0.13, 0.31, 0.43)
  });
}

function renderDetectedDetails({ templateData, templateStructure, processedDocs }) {
  const lines = [];

  lines.push(`Template: ${templateData.fileName}`);
  lines.push(`Template Pages: ${templateData.pageCount}`);
  lines.push(`Detected Sections: ${templateStructure.sections.length}`);
  lines.push("");

  templateStructure.sections.forEach(section => {
    lines.push(`${section.order}. ${section.heading}`);
  });

  lines.push("");
  lines.push("-----------------------------");
  lines.push("");

  processedDocs.forEach((doc, index) => {
    lines.push(`Document ${index + 1}: ${doc.sourceFileName}`);
    lines.push(`Pages: ${doc.sourceData.pageCount}`);
    lines.push(`Detected Sections: ${doc.sourceSections.length}`);
    lines.push(`Mapped Sections: ${doc.mappedResult.mappedSourceSectionCount}`);
    lines.push(`Additional Sections: ${doc.mappedResult.additionalSourceSectionCount}`);
    lines.push("");
  });

  els.detectedDetails.textContent = lines.join("\n");
}

function renderSnapshotPreview(processedDocs) {
  els.snapshotList.innerHTML = "";

  processedDocs.forEach((doc, docIndex) => {
    doc.snapshots.forEach(snapshot => {
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
      detectedSections: templateStructure.sections.map(section => ({
        order: section.order,
        heading: section.heading,
        pageNumber: section.pageNumber
      }))
    },
    documents: processedDocs.map(doc => ({
      fileName: doc.sourceFileName,
      title: doc.title,
      pageCount: doc.sourceData.pageCount,
      detectedSections: doc.sourceSections.length,
      mappedSections: doc.mappedResult.mappedSections.map(section => ({
        heading: section.templateHeading,
        confidence: section.confidence,
        pages: section.mappedPageNumbers,
        matches: section.matchedSourceSections.map(match => ({
          heading: match.sourceHeading,
          pages: match.sourcePageNumbers,
          confidence: match.confidence,
          characterCount: match.content.length
        }))
      })),
      additionalSections: doc.mappedResult.additionalSections.map(section => ({
        heading: section.heading,
        pages: section.pageNumbers,
        characterCount: section.content.length
      }))
    }))
  };
}

function inferDocumentTitle(fullText, fileName) {
  const cleanedFileName = removePdfExtension(fileName).replace(/[_-]+/g, " ");

  const lines = fullText
    .split("\n")
    .map(line => normalizeLine(line))
    .filter(Boolean)
    .filter(line => !/^--- PAGE \d+ ---$/i.test(line));

  const firstHeading = lines.find(line => {
    if (line.length < 4 || line.length > 120) return false;
    if (/^page\s+\d+/i.test(line)) return false;
    if (/^source\s+page\s+\d+/i.test(line)) return false;
    return isLikelyHeading(line);
  });

  if (firstHeading) return cleanSourceHeading(firstHeading);

  return cleanedFileName;
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

function sameMeaningHeading(a, b) {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  return jaccardSimilarity(aTokens, bTokens) > 0.65;
}

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

function sanitizeForPdf(text) {
  return String(text || "")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
