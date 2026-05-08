import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

/*
  Generic Template-Based PDF Formatter
  ------------------------------------
  Purpose:
  1. Upload a sample/template PDF.
  2. Upload one or more source PDFs.
  3. Extract headings/sections from the template.
  4. Extract headings/sections from the source.
  5. Match source sections to template sections using keyword similarity.
  6. Preserve unmatched content separately.
  7. Preserve original source pages as snapshots.
  8. Export formatted PDF + audit log.

  Important:
  This is a browser-only MVP. It does not perform AI-level understanding.
  It is intentionally conservative to avoid data loss.
*/

const els = {
  templatePdfInput: document.getElementById("templatePdfInput"),
  sourcePdfInput: document.getElementById("sourcePdfInput"),

  templateFileInfo: document.getElementById("templateFileInfo"),
  sourceFileInfo: document.getElementById("sourceFileInfo"),

  defaultCountry: document.getElementById("defaultCountry"),
  defaultPort: document.getElementById("defaultPort"),
  defaultVessel: document.getElementById("defaultVessel"),
  defaultYear: document.getElementById("defaultYear"),

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
  combinedOutput: "",
  auditLog: null
};

const CONFIG = {
  maxSnapshotPagesPerSource: 100,
  maxTemplateSnapshotPages: 5,

  /*
    Lower = more content gets mapped, but less accurate.
    Higher = stricter mapping, but more content goes to unmapped.
  */
  mappingThreshold: 0.16,

  /*
    Used to detect likely headings from PDF text.
    You can tune this later depending on your documents.
  */
  maxHeadingLength: 95,
  minHeadingLength: 3
};

bindEvents();

function bindEvents() {
  els.templatePdfInput?.addEventListener("change", handleTemplateUpload);
  els.sourcePdfInput?.addEventListener("change", handleSourceUpload);
  els.processBtn?.addEventListener("click", processDocuments);
  els.exportPdfBtn?.addEventListener("click", exportFormattedPdf);
  els.exportAuditBtn?.addEventListener("click", exportAuditLog);
  els.resetBtn?.addEventListener("click", resetTool);
}

function handleTemplateUpload(event) {
  const file = event.target.files?.[0];

  state.templateFile = file || null;

  if (!file) {
    els.templateFileInfo.textContent = "No template uploaded yet.";
    setStatus("Template removed.");
    return;
  }

  els.templateFileInfo.textContent = `Template selected: ${file.name}`;
  setStatus("Template PDF uploaded. Now upload the source PDF(s).");
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

  setStatus(`${files.length} source PDF(s) uploaded. Ready to process.`);
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
    setStatus("Reading sample/template PDF...");

    const templateData = await extractPdfData(state.templateFile, {
      includeSnapshots: true,
      maxSnapshotPages: CONFIG.maxTemplateSnapshotPages
    });

    const templateStructure = extractTemplateStructure(templateData);

    state.templateData = templateData;
    state.templateStructure = templateStructure;

    if (!templateStructure.sections.length) {
      throw new Error(
        "Could not detect usable headings from the sample/template PDF. Please use a cleaner template with clear headings."
      );
    }

    const processedDocs = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const sourceFile = state.sourceFiles[i];

      setStatus(
        `Processing source document ${i + 1} of ${state.sourceFiles.length}: ${sourceFile.name}`
      );

      const sourceData = await extractPdfData(sourceFile, {
        includeSnapshots: true,
        maxSnapshotPages: CONFIG.maxSnapshotPagesPerSource
      });

      const sourceSections = splitIntoSections(sourceData.fullText);
      const mappedResult = mapSourceToTemplate({
        templateSections: templateStructure.sections,
        sourceSections
      });

      const formattedText = buildTemplateBasedOutput({
        templateData,
        templateStructure,
        sourceData,
        mappedResult
      });

      processedDocs.push({
        sourceFileName: sourceFile.name,
        sourceData,
        sourceSections,
        mappedResult,
        formattedText,
        snapshots: sourceData.snapshots
      });
    }

    state.processedDocs = processedDocs;

    state.combinedOutput = processedDocs
      .map((doc, index) => {
        if (processedDocs.length === 1) return doc.formattedText;

        return [
          `============================================================`,
          `DOCUMENT ${index + 1}: ${doc.sourceFileName}`,
          `============================================================`,
          ``,
          doc.formattedText
        ].join("\n");
      })
      .join("\n\n\n");

    state.auditLog = buildAuditLog({
      templateData,
      templateStructure,
      processedDocs
    });

    els.formattedPreview.value = state.combinedOutput;

    renderDetectedDetails({
      templateData,
      templateStructure,
      processedDocs
    });

    renderSnapshots(processedDocs);

    els.exportPdfBtn.disabled = false;
    els.exportAuditBtn.disabled = false;

    setStatus(
      "Processing complete. Review the preview before exporting the final PDF.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setStatus(`Failed to process document: ${error.message}`, "error");
  }
}

async function extractPdfData(file, options = {}) {
  const includeSnapshots = options.includeSnapshots ?? true;
  const maxSnapshotPages = options.maxSnapshotPages ?? 100;

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
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
      height: item.height || 0,
      fontName: item.fontName || ""
    }));

    const pageText = buildReadablePageText(textItems);

    pageTexts.push({
      pageNumber,
      text: normalizeText(pageText),
      rawItems: textItems
    });

    if (includeSnapshots && pageNumber <= maxSnapshotPages) {
      const snapshot = await renderPageSnapshot(page, 1.5);
      snapshots.push({
        pageNumber,
        imageDataUrl: snapshot
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

/*
  Builds readable lines from PDF text items using Y-position grouping.
  This is more stable than simply joining all text fragments with spaces.
*/
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

  let sections = [];

  if (headings.length >= 2) {
    sections = headings.map((heading, index) => ({
      id: `template-section-${index + 1}`,
      heading: cleanHeading(heading.text),
      headingRaw: heading.text,
      pageNumber: heading.pageNumber,
      order: index + 1
    }));
  } else {
    /*
      Fallback if headings are not cleanly detected.
      This keeps the tool working instead of failing silently.
    */
    sections = [
      {
        id: "template-section-1",
        heading: "Formatted Document",
        headingRaw: "Formatted Document",
        pageNumber: 1,
        order: 1
      },
      {
        id: "template-section-2",
        heading: "Main Content",
        headingRaw: "Main Content",
        pageNumber: 1,
        order: 2
      },
      {
        id: "template-section-3",
        heading: "Additional Details",
        headingRaw: "Additional Details",
        pageNumber: 1,
        order: 3
      }
    ];
  }

  const title = inferDocumentTitle(templateData.fullText, templateData.fileName);

  return {
    title,
    sections,
    headingCount: sections.length,
    sourceFileName: templateData.fileName
  };
}

function detectHeadings(fullText) {
  const lines = fullText
    .split("\n")
    .map(line => normalizeLine(line))
    .filter(Boolean)
    .filter(line => !/^--- PAGE \d+ ---$/i.test(line));

  const headings = [];

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
      headings.push({
        text: line,
        pageNumber: currentPage
      });
    }
  }

  return dedupeHeadings(headings);
}

function isLikelyHeading(line) {
  const text = normalizeLine(line);

  if (!text) return false;
  if (text.length < CONFIG.minHeadingLength) return false;
  if (text.length > CONFIG.maxHeadingLength) return false;

  if (/^page\s+\d+$/i.test(text)) return false;
  if (/^[-=_]{3,}$/.test(text)) return false;
  if (/https?:\/\//i.test(text)) return false;

  /*
    Strong heading patterns:
    1. Heading
    1.1 Heading
    A. Heading
    SECTION 1
    CHAPTER 1
  */
  if (/^\d{1,2}(\.\d{1,2})?\s*[\).:-]?\s+[A-Z]/.test(text)) return true;
  if (/^[A-Z]\.\s+[A-Z]/.test(text)) return true;
  if (/^(SECTION|CHAPTER|PART|ARTICLE|APPENDIX)\s+[A-Z0-9]/i.test(text)) return true;

  /*
    All-caps headings, but avoid long paragraphs.
  */
  const lettersOnly = text.replace(/[^a-zA-Z]/g, "");
  const upperLetters = text.replace(/[^A-Z]/g, "");

  if (
    lettersOnly.length >= 4 &&
    upperLetters.length / lettersOnly.length > 0.75 &&
    text.split(/\s+/).length <= 10
  ) {
    return true;
  }

  /*
    Title Case short lines can be headings.
  */
  const words = text.split(/\s+/);
  const titleCaseWords = words.filter(word => /^[A-Z][a-zA-Z0-9/&()-]*$/.test(word));

  if (
    words.length >= 2 &&
    words.length <= 8 &&
    titleCaseWords.length / words.length >= 0.65 &&
    !/[.!?]$/.test(text)
  ) {
    return true;
  }

  return false;
}

function dedupeHeadings(headings) {
  const seen = new Set();
  const result = [];

  for (const heading of headings) {
    const key = cleanHeading(heading.text).toLowerCase();

    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(heading);
  }

  return result;
}

function splitIntoSections(fullText) {
  const lines = fullText
    .split("\n")
    .map(line => normalizeLine(line));

  const sections = [];
  let current = {
    heading: "Opening / General Content",
    contentLines: [],
    pageNumber: 1
  };

  let currentPage = 1;

  for (const line of lines) {
    if (!line) {
      current.contentLines.push("");
      continue;
    }

    const pageMatch = line.match(/^--- PAGE (\d+) ---$/i);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      continue;
    }

    if (isLikelyHeading(line)) {
      if (current.contentLines.join("\n").trim()) {
        sections.push({
          heading: current.heading,
          content: normalizeText(current.contentLines.join("\n")),
          pageNumber: current.pageNumber
        });
      }

      current = {
        heading: cleanHeading(line),
        contentLines: [],
        pageNumber: currentPage
      };
    } else {
      current.contentLines.push(line);
    }
  }

  if (current.contentLines.join("\n").trim()) {
    sections.push({
      heading: current.heading,
      content: normalizeText(current.contentLines.join("\n")),
      pageNumber: current.pageNumber
    });
  }

  if (!sections.length && normalizeText(fullText)) {
    sections.push({
      heading: "Main Content",
      content: normalizeText(fullText),
      pageNumber: 1
    });
  }

  return mergeTinySections(sections);
}

/*
  Some PDFs break text badly, causing too many small sections.
  This merges tiny sections into the previous section to reduce damage.
*/
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
    confidence: 0
  }));

  const usedSourceIndexes = new Set();

  sourceSections.forEach((sourceSection, sourceIndex) => {
    let bestMatchIndex = -1;
    let bestScore = 0;

    mappedSections.forEach((templateSection, templateIndex) => {
      const score = calculateSectionSimilarity(
        templateSection.templateHeading,
        sourceSection.heading,
        sourceSection.content
      );

      if (score > bestScore) {
        bestScore = score;
        bestMatchIndex = templateIndex;
      }
    });

    if (bestMatchIndex !== -1 && bestScore >= CONFIG.mappingThreshold) {
      mappedSections[bestMatchIndex].matchedSourceSections.push({
        sourceIndex,
        sourceHeading: sourceSection.heading,
        sourcePageNumber: sourceSection.pageNumber,
        content: sourceSection.content,
        confidence: Number(bestScore.toFixed(3))
      });

      mappedSections[bestMatchIndex].confidence = Math.max(
        mappedSections[bestMatchIndex].confidence,
        Number(bestScore.toFixed(3))
      );

      usedSourceIndexes.add(sourceIndex);
    }
  });

  mappedSections.forEach(section => {
    if (!section.matchedSourceSections.length) {
      section.finalContent = "Not Available";
      return;
    }

    section.finalContent = section.matchedSourceSections
      .map(match => {
        return [
          match.sourceHeading &&
          match.sourceHeading !== "Opening / General Content"
            ? `${match.sourceHeading}`
            : "",
          match.content
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  });

  const unmappedSections = sourceSections
    .map((section, index) => ({
      ...section,
      sourceIndex: index
    }))
    .filter(section => !usedSourceIndexes.has(section.sourceIndex))
    .filter(section => section.content && section.content.trim());

  return {
    mappedSections,
    unmappedSections,
    totalSourceSections: sourceSections.length,
    mappedSourceSectionCount: usedSourceIndexes.size,
    unmappedSourceSectionCount: unmappedSections.length
  };
}

function calculateSectionSimilarity(templateHeading, sourceHeading, sourceContent) {
  const templateTokens = tokenize(templateHeading);
  const sourceHeadingTokens = tokenize(sourceHeading);
  const sourceContentTokens = tokenize(sourceContent).slice(0, 80);

  if (!templateTokens.length) return 0;

  const headingScore = jaccardSimilarity(templateTokens, sourceHeadingTokens);
  const contentScore = jaccardSimilarity(templateTokens, sourceContentTokens);

  /*
    Heading similarity is weighted higher than content similarity.
  */
  return headingScore * 0.75 + contentScore * 0.25;
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
    "section",
    "document",
    "report"
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

function buildTemplateBasedOutput({
  templateData,
  templateStructure,
  sourceData,
  mappedResult
}) {
  const title = inferDocumentTitleFromSourceOrTemplate({
    sourceData,
    templateStructure
  });

  const lines = [];

  lines.push(title);
  lines.push("");
  lines.push("Template-Based Standardized Document");
  lines.push("");
  lines.push(`Template Used: ${templateData.fileName}`);
  lines.push(`Source File: ${sourceData.fileName}`);
  lines.push(`Generated On: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("Important Preservation Note:");
  lines.push(
    "No source content is intentionally removed. Content that cannot be confidently mapped into the template is placed under 'Unmapped / Additional Source Content'. Original source pages are also preserved as visual snapshots in the exported PDF appendix."
  );
  lines.push("");

  mappedResult.mappedSections.forEach((section, index) => {
    const heading = section.templateHeading || `Section ${index + 1}`;

    lines.push(`${index + 1}. ${heading}`);
    lines.push("");
    lines.push(section.finalContent || "Not Available");
    lines.push("");
  });

  lines.push(`${mappedResult.mappedSections.length + 1}. Unmapped / Additional Source Content`);
  lines.push("");

  if (mappedResult.unmappedSections.length) {
    mappedResult.unmappedSections.forEach((section, index) => {
      lines.push(`Unmapped Item ${index + 1}: ${section.heading}`);
      lines.push(`Source Page: ${section.pageNumber || "Unknown"}`);
      lines.push("");
      lines.push(section.content);
      lines.push("");
    });
  } else {
    lines.push("No unmapped content detected.");
    lines.push("");
  }

  lines.push(`${mappedResult.mappedSections.length + 2}. Source Preservation Appendix`);
  lines.push("");
  lines.push(
    "Original source page snapshots are included after the formatted text in the exported PDF."
  );

  return normalizeText(lines.join("\n"));
}

function inferDocumentTitleFromSourceOrTemplate({ sourceData, templateStructure }) {
  const sourceTitle = inferDocumentTitle(sourceData.fullText, sourceData.fileName);

  if (sourceTitle && sourceTitle !== "Formatted Document") {
    return sourceTitle;
  }

  return templateStructure.title || "Formatted Document";
}

function inferDocumentTitle(fullText, fileName) {
  const lines = fullText
    .split("\n")
    .map(line => normalizeLine(line))
    .filter(Boolean)
    .filter(line => !/^--- PAGE \d+ ---$/i.test(line));

  const firstStrongLine = lines.find(line => {
    if (line.length < 4 || line.length > 120) return false;
    if (/^page\s+\d+/i.test(line)) return false;
    return isLikelyHeading(line) || /^[A-Z][A-Za-z0-9 ,/&()-]+$/.test(line);
  });

  if (firstStrongLine) return cleanHeading(firstStrongLine);

  return fileName
    ? fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ")
    : "Formatted Document";
}

function renderDetectedDetails({ templateData, templateStructure, processedDocs }) {
  const details = [];

  details.push(`Template File: ${templateData.fileName}`);
  details.push(`Template Pages: ${templateData.pageCount}`);
  details.push(`Detected Template Sections: ${templateStructure.sections.length}`);
  details.push("");

  templateStructure.sections.forEach(section => {
    details.push(`${section.order}. ${section.heading}`);
  });

  details.push("");
  details.push("-----------------------------");
  details.push("");

  processedDocs.forEach((doc, index) => {
    details.push(`Source Document ${index + 1}: ${doc.sourceFileName}`);
    details.push(`Pages: ${doc.sourceData.pageCount}`);
    details.push(`Extracted Characters: ${doc.sourceData.fullText.length}`);
    details.push(`Source Sections Detected: ${doc.sourceSections.length}`);
    details.push(`Mapped Sections: ${doc.mappedResult.mappedSourceSectionCount}`);
    details.push(`Unmapped Sections: ${doc.mappedResult.unmappedSourceSectionCount}`);
    details.push("");

    doc.mappedResult.mappedSections.forEach(section => {
      details.push(
        `- ${section.templateHeading}: ${
          section.matchedSourceSections.length
            ? `Mapped (${section.matchedSourceSections.length}, confidence ${section.confidence})`
            : "Not Available"
        }`
      );
    });

    details.push("");
    details.push("-----------------------------");
    details.push("");
  });

  els.detectedDetails.textContent = details.join("\n");
}

function renderSnapshots(processedDocs) {
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

async function exportFormattedPdf() {
  if (!state.processedDocs.length) {
    setStatus("No formatted document available to export.", "error");
    return;
  }

  try {
    setStatus("Generating formatted PDF...");

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

    const previewText = els.formattedPreview.value || state.combinedOutput;

    addFormattedTextPages({
      pdfDoc,
      text: previewText,
      pageSize,
      margin,
      contentWidth,
      regularFont,
      boldFont,
      italicFont,
      footer: "Template-Based Formatted Document"
    });

    for (const doc of state.processedDocs) {
      await addSnapshotAppendix({
        pdfDoc,
        snapshots: doc.snapshots,
        pageSize,
        margin,
        regularFont,
        boldFont,
        title: `Original Source Snapshots - ${doc.sourceFileName}`
      });
    }

    const bytes = await pdfDoc.save();

    const outputFileName =
      state.processedDocs.length === 1
        ? buildGenericOutputFileName(state.processedDocs[0].sourceFileName)
        : "Template_Based_Formatted_Documents.pdf";

    downloadBlob(bytes, outputFileName, "application/pdf");

    setStatus("Formatted PDF exported successfully.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed to export formatted PDF: ${error.message}`, "error");
  }
}

function addFormattedTextPages({
  pdfDoc,
  text,
  pageSize,
  margin,
  contentWidth,
  regularFont,
  boldFont,
  italicFont,
  footer
}) {
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - margin;

  drawDocumentHeader(page, {
    title: "FORMATTED DOCUMENT",
    font: boldFont,
    pageSize,
    margin
  });

  y -= 48;

  const lines = prepareTextLines(text, 92);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      y -= 8;
      continue;
    }

    if (y < margin + 48) {
      drawDocumentFooter(page, footer, regularFont, pageSize, margin);

      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;

      drawDocumentHeader(page, {
        title: "FORMATTED DOCUMENT",
        font: boldFont,
        pageSize,
        margin
      });

      y -= 48;
    }

    const level = getTextLineLevel(trimmed);

    let selectedFont = regularFont;
    let fontSize = 9.5;
    let color = rgb(0.1, 0.12, 0.16);

    if (level === 1) {
      selectedFont = boldFont;
      fontSize = 15;
      color = rgb(0.13, 0.31, 0.43);
      y -= 4;
    } else if (level === 2) {
      selectedFont = boldFont;
      fontSize = 12;
      color = rgb(0.13, 0.31, 0.43);
      y -= 4;

      page.drawLine({
        start: { x: margin, y: y - 5 },
        end: { x: margin + contentWidth, y: y - 5 },
        thickness: 0.6,
        color: rgb(0.55, 0.7, 0.8)
      });
    } else if (level === 3) {
      selectedFont = italicFont;
      fontSize = 9.5;
      color = rgb(0.35, 0.4, 0.48);
    }

    safeDrawText(page, trimmed, {
      x: margin,
      y,
      size: fontSize,
      font: selectedFont,
      color
    });

    y -= level ? 18 : 13;
  }

  drawDocumentFooter(page, footer, regularFont, pageSize, margin);
}

async function addSnapshotAppendix({
  pdfDoc,
  snapshots,
  pageSize,
  margin,
  regularFont,
  boldFont,
  title
}) {
  if (!snapshots?.length) return;

  const cover = pdfDoc.addPage([pageSize.width, pageSize.height]);

  cover.drawText(title.substring(0, 90), {
    x: margin,
    y: pageSize.height - margin,
    size: 15,
    font: boldFont,
    color: rgb(0.13, 0.31, 0.43)
  });

  cover.drawText("The following pages preserve the original visual source document.", {
    x: margin,
    y: pageSize.height - margin - 28,
    size: 10,
    font: regularFont,
    color: rgb(0.35, 0.4, 0.48)
  });

  cover.drawText(
    "This protects images, diagrams, scanned sections, signatures, stamps, and complex tables.",
    {
      x: margin,
      y: pageSize.height - margin - 44,
      size: 10,
      font: regularFont,
      color: rgb(0.35, 0.4, 0.48)
    }
  );

  for (const snapshot of snapshots) {
    const page = pdfDoc.addPage([pageSize.width, pageSize.height]);

    page.drawText(`Original Page ${snapshot.pageNumber}`, {
      x: margin,
      y: pageSize.height - margin,
      size: 13,
      font: boldFont,
      color: rgb(0.13, 0.31, 0.43)
    });

    const image = await pdfDoc.embedPng(snapshot.imageDataUrl);

    const maxWidth = pageSize.width - margin * 2;
    const maxHeight = pageSize.height - margin * 2 - 34;

    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);

    const imgWidth = image.width * scale;
    const imgHeight = image.height * scale;

    page.drawImage(image, {
      x: (pageSize.width - imgWidth) / 2,
      y: margin,
      width: imgWidth,
      height: imgHeight
    });
  }
}

function drawDocumentHeader(page, { title, font, pageSize, margin }) {
  page.drawText(title, {
    x: margin,
    y: pageSize.height - 34,
    size: 14,
    font,
    color: rgb(0.13, 0.31, 0.43)
  });

  page.drawLine({
    start: { x: margin, y: pageSize.height - 42 },
    end: { x: pageSize.width - margin, y: pageSize.height - 42 },
    thickness: 1,
    color: rgb(0.55, 0.7, 0.8)
  });
}

function drawDocumentFooter(page, footer, font, pageSize, margin) {
  page.drawLine({
    start: { x: margin, y: 32 },
    end: { x: pageSize.width - margin, y: 32 },
    thickness: 0.5,
    color: rgb(0.85, 0.9, 0.94)
  });

  safeDrawText(page, footer || "", {
    x: margin,
    y: 18,
    size: 8,
    font,
    color: rgb(0.45, 0.45, 0.45)
  });
}

/*
  pdf-lib's standard fonts can fail on some special Unicode characters.
  This sanitizes text before drawing.
*/
function safeDrawText(page, text, options) {
  const cleaned = String(text || "")
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\x7F]/g, "");

  page.drawText(cleaned, options);
}

function exportAuditLog() {
  if (!state.auditLog) {
    setStatus("No audit log available.", "error");
    return;
  }

  const audit = {
    ...state.auditLog,
    finalEditedPreviewCharacterCount: els.formattedPreview.value.length,
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(audit, null, 2)], {
    type: "application/json"
  });

  downloadBlob(blob, "Template_Based_PDF_Audit_Log.json", "application/json");

  setStatus("Audit log exported successfully.", "success");
}

function buildAuditLog({ templateData, templateStructure, processedDocs }) {
  return {
    generatedAt: new Date().toISOString(),
    mode: "Generic template-based formatter",
    safetyRule:
      "Content that could not be confidently mapped to a template section is retained under Unmapped / Additional Source Content.",
    template: {
      fileName: templateData.fileName,
      pageCount: templateData.pageCount,
      extractedCharacterCount: templateData.fullText.length,
      detectedHeadingCount: templateStructure.sections.length,
      detectedHeadings: templateStructure.sections.map(section => ({
        order: section.order,
        heading: section.heading,
        pageNumber: section.pageNumber
      }))
    },
    sourceDocuments: processedDocs.map(doc => ({
      sourceFileName: doc.sourceFileName,
      pageCount: doc.sourceData.pageCount,
      extractedCharacterCount: doc.sourceData.fullText.length,
      detectedSourceSectionCount: doc.sourceSections.length,
      mappedSourceSectionCount: doc.mappedResult.mappedSourceSectionCount,
      unmappedSourceSectionCount: doc.mappedResult.unmappedSourceSectionCount,
      mappedSections: doc.mappedResult.mappedSections.map(section => ({
        templateHeading: section.templateHeading,
        confidence: section.confidence,
        matchedSourceSections: section.matchedSourceSections.map(match => ({
          sourceHeading: match.sourceHeading,
          sourcePageNumber: match.sourcePageNumber,
          confidence: match.confidence,
          characterCount: match.content.length
        }))
      })),
      unmappedSections: doc.mappedResult.unmappedSections.map(section => ({
        heading: section.heading,
        pageNumber: section.pageNumber,
        characterCount: section.content.length
      })),
      preservationMethod:
        "Original source PDF pages are rendered as visual page snapshots and attached to the exported PDF."
    })),
    limitations: [
      "This is a browser-based tool and does not use AI reasoning.",
      "It extracts readable PDF text using PDF.js.",
      "Image-only scanned PDFs require OCR, which is not included in this version.",
      "The sample/template PDF is used for structure detection, not perfect visual cloning.",
      "Images and complex layouts are preserved through original page snapshots.",
      "Final output should be reviewed before official/business use."
    ]
  };
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

function getTextLineLevel(line) {
  if (!line) return 0;

  if (
    line.length <= 100 &&
    /^[A-Z0-9 ,/&()-]+$/.test(line) &&
    line.split(/\s+/).length <= 10
  ) {
    return 1;
  }

  if (/^\d{1,2}\.\s+/.test(line)) return 2;

  if (
    /^(Template Used|Source File|Generated On|Important Preservation Note|Source Page):/i.test(
      line
    )
  ) {
    return 3;
  }

  return 0;
}

function buildGenericOutputFileName(sourceFileName) {
  const base = sourceFileName
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 90);

  return `${base}_Formatted.pdf`;
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
  state.combinedOutput = "";
  state.auditLog = null;

  els.templatePdfInput.value = "";
  els.sourcePdfInput.value = "";

  els.templateFileInfo.textContent = "No template uploaded yet.";
  els.sourceFileInfo.textContent = "No source documents uploaded yet.";

  if (els.defaultCountry) els.defaultCountry.value = "";
  if (els.defaultPort) els.defaultPort.value = "";
  if (els.defaultVessel) els.defaultVessel.value = "";
  if (els.defaultYear) els.defaultYear.value = "";

  resetOutputOnly();

  setStatus("Tool reset. Upload a template and source PDF to begin.");
}

function resetOutputOnly() {
  els.formattedPreview.value = "";
  els.detectedDetails.textContent = "No document processed yet.";
  els.snapshotList.innerHTML = "";

  els.exportPdfBtn.disabled = true;
  els.exportAuditBtn.disabled = true;

  state.processedDocs = [];
  state.combinedOutput = "";
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

function cleanHeading(text) {
  return normalizeLine(text)
    .replace(/^[-–—•\s]+/, "")
    .replace(/[:\-–—]+$/, "")
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
