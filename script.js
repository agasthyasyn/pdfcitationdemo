import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

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
  processedDocs: [],
  combinedOutput: "",
  auditLog: null
};

els.templatePdfInput.addEventListener("change", handleTemplateUpload);
els.sourcePdfInput.addEventListener("change", handleSourceUpload);
els.processBtn.addEventListener("click", processDocuments);
els.exportPdfBtn.addEventListener("click", exportFormattedPdf);
els.exportAuditBtn.addEventListener("click", exportAuditLog);
els.resetBtn.addEventListener("click", resetTool);

function handleTemplateUpload(event) {
  const file = event.target.files[0];

  if (!file) {
    state.templateFile = null;
    els.templateFileInfo.textContent = "No template uploaded yet.";
    return;
  }

  state.templateFile = file;
  els.templateFileInfo.textContent = `Template selected: ${file.name}`;
  setStatus("Template PDF uploaded. Now upload source PDF(s).");
}

function handleSourceUpload(event) {
  const files = Array.from(event.target.files || []);

  state.sourceFiles = files;

  if (!files.length) {
    els.sourceFileInfo.textContent = "No source documents uploaded yet.";
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
    setStatus("Please upload at least one source PDF to format.", "error");
    return;
  }

  resetOutputOnly();

  try {
    setStatus("Reading template PDF structure...");

    const templateData = await extractPdfData(state.templateFile, {
      includeSnapshots: true,
      maxSnapshotPages: 3
    });

    const processedDocs = [];

    for (let i = 0; i < state.sourceFiles.length; i++) {
      const file = state.sourceFiles[i];

      setStatus(`Processing source document ${i + 1} of ${state.sourceFiles.length}: ${file.name}`);

      const sourceData = await extractPdfData(file, {
        includeSnapshots: true,
        maxSnapshotPages: 100
      });

      const detected = detectPortInformation(sourceData.fullText, file.name);
      const sections = mapTextToStandardSections(sourceData.fullText);

      const finalDetails = applyManualOverrides(detected);

      const formattedText = buildStandardizedOutput({
        fileName: file.name,
        details: finalDetails,
        sections
      });

      processedDocs.push({
        sourceFileName: file.name,
        templateFileName: state.templateFile.name,
        detected: finalDetails,
        sections,
        formattedText,
        snapshots: sourceData.snapshots,
        pageCount: sourceData.pageCount,
        extractedCharacterCount: sourceData.fullText.length,
        templateReference: {
          templateFileName: state.templateFile.name,
          pageCount: templateData.pageCount,
          extractedCharacterCount: templateData.fullText.length
        }
      });
    }

    state.processedDocs = processedDocs;
    state.combinedOutput = processedDocs
      .map((doc, index) => {
        if (processedDocs.length === 1) return doc.formattedText;
        return `DOCUMENT ${index + 1}\n${doc.formattedText}`;
      })
      .join("\n\n\n");

    state.auditLog = buildAuditLog(templateData, processedDocs);

    els.formattedPreview.value = state.combinedOutput;
    renderDetectedDetails(processedDocs);
    renderSnapshots(processedDocs);

    els.exportPdfBtn.disabled = false;
    els.exportAuditBtn.disabled = false;

    setStatus("Processing complete. Review the formatted output before export.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed to process document: ${error.message}`, "error");
  }
}

async function extractPdfData(file, options = {}) {
  const includeSnapshots = options.includeSnapshots ?? true;
  const maxSnapshotPages = options.maxSnapshotPages ?? 100;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts = [];
  const snapshots = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);

    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map(item => item.str)
      .join(" ");

    pageTexts.push({
      pageNumber,
      text: normalizeSpacing(pageText)
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
    fullText: normalizeSpacing(fullText),
    snapshots
  };
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

function detectPortInformation(text, fileName) {
  const clean = normalizeSpacing(text);

  const yearMatch =
    clean.match(/\b(20[0-9]{2})\b/) ||
    fileName.match(/\b(20[0-9]{2})\b/);

  const vesselMatch =
    clean.match(/\b(CS\s+[A-Z][A-Z0-9-]+)\b/i) ||
    fileName.match(/\b(CS[_\s-]?[A-Z][A-Z0-9-]+)\b/i) ||
    clean.match(/\b(MV\s+[A-Z][A-Z0-9-]+)\b/i) ||
    fileName.match(/\b(MV[_\s-]?[A-Z][A-Z0-9-]+)\b/i);

  const unlocodeMatch =
    clean.match(/UNLOCODE\s*[:/]*\s*([A-Z]{2}\s?[A-Z0-9]{3})/i) ||
    clean.match(/UNCTAD\s*Code\s*[:/]*\s*([A-Z]{2}\s?[A-Z0-9]{3})/i);

  const latLongMatch =
    clean.match(/(\d{1,2}[°º]\s?\d{1,2}[.,]?\d*\s?[NS])\s+(\d{2,3}[°º]\s?\d{1,2}[.,]?\d*\s?[EW])/i);

  const timeZoneMatch =
    clean.match(/Time\s*Zone\s*[:\-]?\s*([A-Z]{2,5}\s*=?\s*GMT\s*[+\-]\s*\d+\.?\d*)/i) ||
    clean.match(/\bGMT\s*[+\-]\s*\d+\.?\d*/i);

  const cargoMatch =
    clean.match(/CARGO\s*[:\-]?\s*([^.\n]{5,120})/i) ||
    clean.match(/LOADING\s+([A-Z\s]+IN\s+BULK[^.\n]{0,80})/i);

  const berthMatch =
    clean.match(/(?:PIER|BERTH|TERMINAL)\s*[:\-]?\s*([^.\n]{3,100})/i);

  const tidalMatch =
    clean.match(/Tidal\s*Range\s*[:\-]?\s*([^.\n]{2,40})/i);

  const densityMatch =
    clean.match(/(?:Water\s*)?Density\s*[:\-]?\s*([0-9.]+\s*[-–]\s*[0-9.]+|[0-9.]+)/i);

  const agentMatch =
    clean.match(/AGENTS?\s*[:\-]?\s*([^.\n]{3,120})/i);

  const portCountryFromFile = guessPortCountryFromFileName(fileName);

  return {
    vesselName: cleanValue(vesselMatch?.[1]) || "Not Available",
    portName: portCountryFromFile.port || "Not Available",
    country: portCountryFromFile.country || "Not Available",
    year: yearMatch?.[1] || "Not Available",
    unlocode: cleanValue(unlocodeMatch?.[1]) || "Not Available",
    position: latLongMatch ? `${latLongMatch[1]} ${latLongMatch[2]}` : "Not Available",
    timeZone: cleanValue(timeZoneMatch?.[1] || timeZoneMatch?.[0]) || "Not Available",
    portStayDate: detectDateRange(clean) || "Not Available",
    berthTerminal: cleanValue(berthMatch?.[1]) || "Not Available",
    cargo: cleanValue(cargoMatch?.[1]) || "Not Available",
    cargoOperationsRate: "Not Available",
    depthDraftChannel: detectDepthDraft(clean),
    density: cleanValue(densityMatch?.[1]) || "Not Available",
    tidalRange: cleanValue(tidalMatch?.[1]) || "Not Available",
    securityLevel: detectSecurityLevel(clean),
    vhfCommunication: detectVhf(clean),
    agentContact: cleanValue(agentMatch?.[1]) || "Not Available",
    publicationsCharts: detectPublications(clean)
  };
}

function applyManualOverrides(detected) {
  const manualCountry = els.defaultCountry.value.trim();
  const manualPort = els.defaultPort.value.trim();
  const manualVessel = els.defaultVessel.value.trim();
  const manualYear = els.defaultYear.value.trim();

  return {
    ...detected,
    country: manualCountry || detected.country,
    portName: manualPort || detected.portName,
    vesselName: manualVessel || detected.vesselName,
    year: manualYear || detected.year
  };
}

function mapTextToStandardSections(text) {
  const clean = normalizeSpacing(text);

  return {
    portOverview: extractSection(clean, [
      "Port Overview",
      "About",
      "GENERAL INFORMATION",
      "PORT INFORMATION"
    ]),

    arrivalDetails: extractSection(clean, [
      "Arrival",
      "Port Stay",
      "DATE OF ARRIVAL",
      "ETA",
      "ETB",
      "ETD"
    ]),

    anchorage: extractSection(clean, [
      "ANCHORAGE",
      "ANCHORAGES",
      "ANCHORAGE AREA"
    ]),

    pilotage: extractSection(clean, [
      "PILOTAGE",
      "APPROACHES",
      "APPROACH",
      "NAVIGATION"
    ]),

    berthTerminalDepth: extractSection(clean, [
      "PIER",
      "BERTH",
      "TERMINAL",
      "DEPTH",
      "DRAFT",
      "CHANNEL"
    ]),

    cargoOperations: extractSection(clean, [
      "CARGO LOADING",
      "CARGO OPERATIONS",
      "LOADING",
      "DISCHARGING",
      "DISCHARGE"
    ]),

    agentsContacts: extractSection(clean, [
      "AGENTS",
      "CONTACTS",
      "AGENT"
    ]),

    preArrivalDocuments: extractSection(clean, [
      "PRE-ARRIVAL",
      "DOCUMENTS",
      "FORMALITIES",
      "PART ONE",
      "PART TWO"
    ]),

    regulationsSecurityHealth: extractSection(clean, [
      "REGULATIONS",
      "SECURITY",
      "SANITARY",
      "HEALTH",
      "PSC",
      "MARSEC",
      "ISPS"
    ]),

    servicesSuppliesWaste: extractSection(clean, [
      "GARBAGE",
      "WASTE",
      "FRESH WATER",
      "BUNKERS",
      "SLUDGE",
      "PROVISIONS",
      "STORES"
    ]),

    publicationsCharts: extractSection(clean, [
      "PUBLICATIONS",
      "CHARTS",
      "NAUTICAL CHART"
    ]),

    operationalRemarks: extractSection(clean, [
      "RELEVANT INFORMATIONS",
      "RELEVANT INFORMATION",
      "REMARKS",
      "OPERATIONAL EXPERIENCE",
      "SAFETY ON BOARD",
      "GANGWAY",
      "BALLAST",
      "MOORING"
    ]),

    detailedNotes: clean || "Not Available"
  };
}

function extractSection(text, keywords) {
  const upperText = text.toUpperCase();

  for (const keyword of keywords) {
    const upperKeyword = keyword.toUpperCase();
    const index = upperText.indexOf(upperKeyword);

    if (index !== -1) {
      const chunk = text.slice(index, index + 3000);
      return trimSection(chunk);
    }
  }

  return "Not Available";
}

function trimSection(text) {
  return normalizeSpacing(text)
    .replace(/--- PAGE \d+ ---/gi, "")
    .trim();
}

function buildStandardizedOutput({ fileName, details, sections }) {
  const titlePort = safeText(details.portName);
  const titleCountry = safeText(details.country);
  const vessel = safeText(details.vesselName);
  const year = safeText(details.year);

  return `${titlePort}, ${titleCountry} Port Information | Standardized Format
${vessel} | ${titlePort}, ${titleCountry} | ${year}

PORT INFORMATION REPORT
${titlePort}, ${titleCountry} - ${vessel}

Standardized layout. Missing fields are marked as Not Available.
Source File: ${fileName}


1. KEY INFORMATION

Vessel Name: ${valueOrNA(details.vesselName)}
Port Name: ${valueOrNA(details.portName)}
Country: ${valueOrNA(details.country)}
UNLOCODE / UNCTAD Code: ${valueOrNA(details.unlocode)}
Latitude / Longitude / Position: ${valueOrNA(details.position)}
Time Zone: ${valueOrNA(details.timeZone)}
Port Stay / Date: ${valueOrNA(details.portStayDate)}
Berth / Pier / Terminal: ${valueOrNA(details.berthTerminal)}
Cargo: ${valueOrNA(details.cargo)}
Cargo Operations / Rate: ${valueOrNA(details.cargoOperationsRate)}
Depth / Draft / Channel: ${valueOrNA(details.depthDraftChannel)}
Density: ${valueOrNA(details.density)}
Tidal Range: ${valueOrNA(details.tidalRange)}
Security Level: ${valueOrNA(details.securityLevel)}
VHF / Communication: ${valueOrNA(details.vhfCommunication)}
Agent / Contact: ${valueOrNA(details.agentContact)}
Publications / Charts: ${valueOrNA(details.publicationsCharts)}


2. VISUAL REFERENCES

Visual references are preserved from the original uploaded source document as page snapshots in the exported PDF appendix.
This is done to avoid missing maps, port diagrams, images, scanned tables, signatures, stamps, and layout-based information.


3. PORT OVERVIEW / ABOUT

${valueOrNA(sections.portOverview)}


4. ARRIVAL / PORT STAY DETAILS

${valueOrNA(sections.arrivalDetails)}


5. ANCHORAGE

${valueOrNA(sections.anchorage)}


6. PILOTAGE / APPROACH / NAVIGATION

${valueOrNA(sections.pilotage)}


7. BERTH / TERMINAL / DEPTH

${valueOrNA(sections.berthTerminalDepth)}


8. CARGO OPERATIONS

${valueOrNA(sections.cargoOperations)}


9. AGENTS / CONTACTS

${valueOrNA(sections.agentsContacts)}


10. PRE-ARRIVAL DOCUMENTS / FORMALITIES

${valueOrNA(sections.preArrivalDocuments)}


11. REGULATIONS / SECURITY / HEALTH

${valueOrNA(sections.regulationsSecurityHealth)}


12. SERVICES / SUPPLIES / WASTE

${valueOrNA(sections.servicesSuppliesWaste)}


13. PUBLICATIONS / CHARTS

${valueOrNA(sections.publicationsCharts)}


14. OPERATIONAL EXPERIENCE / REMARKS

${valueOrNA(sections.operationalRemarks)}


15. DETAILED NOTES

${valueOrNA(sections.detailedNotes)}


SOURCE PRESERVATION NOTE

The original PDF pages are included as visual page snapshots in the exported PDF appendix.
This preserves images, diagrams, maps, scanned content, visual tables, and any information that may not be fully extractable as plain text.
`;
}

function renderDetectedDetails(processedDocs) {
  els.detectedDetails.textContent = processedDocs
    .map((doc, index) => {
      const d = doc.detected;

      return `Document ${index + 1}: ${doc.sourceFileName}

Vessel: ${d.vesselName}
Port: ${d.portName}
Country: ${d.country}
Year: ${d.year}
UNLOCODE: ${d.unlocode}
Position: ${d.position}
Time Zone: ${d.timeZone}
Berth / Terminal: ${d.berthTerminal}
Cargo: ${d.cargo}
Pages Processed: ${doc.pageCount}
Extracted Characters: ${doc.extractedCharacterCount}`;
    })
    .join("\n\n-----------------------------\n\n");
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

    for (let docIndex = 0; docIndex < state.processedDocs.length; docIndex++) {
      const doc = state.processedDocs[docIndex];

      if (docIndex > 0) {
        addDividerPage(pdfDoc, pageSize, boldFont, `Document ${docIndex + 1}`);
      }

      addFormattedTextPages({
        pdfDoc,
        text: getCurrentTextForDoc(docIndex),
        pageSize,
        margin,
        contentWidth,
        regularFont,
        boldFont,
        italicFont,
        footer: `${doc.detected.vesselName} | ${doc.detected.portName}, ${doc.detected.country} | ${doc.detected.year}`
      });

      await addSnapshotAppendix({
        pdfDoc,
        snapshots: doc.snapshots,
        pageSize,
        margin,
        regularFont,
        boldFont,
        title: `Original Source Page Snapshots - ${doc.sourceFileName}`
      });
    }

    const bytes = await pdfDoc.save();
    const firstDoc = state.processedDocs[0];

    const outputFileName =
      state.processedDocs.length === 1
        ? buildStandardFileName(firstDoc.detected)
        : "Formatted_Port_Information_Combined.pdf";

    downloadBlob(bytes, outputFileName, "application/pdf");

    setStatus("Formatted PDF exported successfully.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed to export formatted PDF: ${error.message}`, "error");
  }
}

function getCurrentTextForDoc(docIndex) {
  if (state.processedDocs.length === 1) {
    return els.formattedPreview.value;
  }

  return state.processedDocs[docIndex].formattedText;
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

  drawHeader(page, {
    title: "PORT INFORMATION REPORT",
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
      drawFooter(page, footer, regularFont, pageSize, margin);

      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      y = pageSize.height - margin;

      drawHeader(page, {
        title: "PORT INFORMATION REPORT",
        font: boldFont,
        pageSize,
        margin
      });

      y -= 48;
    }

    const headingLevel = getHeadingLevel(trimmed);

    let selectedFont = regularFont;
    let fontSize = 9.5;
    let color = rgb(0.1, 0.12, 0.16);

    if (headingLevel === 1) {
      selectedFont = boldFont;
      fontSize = 16;
      color = rgb(0.13, 0.31, 0.43);
      y -= 4;
    } else if (headingLevel === 2) {
      selectedFont = boldFont;
      fontSize = 12.5;
      color = rgb(0.13, 0.31, 0.43);
      y -= 4;
      drawSectionLine(page, margin, y - 4, contentWidth);
    } else if (headingLevel === 3) {
      selectedFont = italicFont;
      fontSize = 10;
      color = rgb(0.35, 0.4, 0.48);
    }

    page.drawText(trimmed, {
      x: margin,
      y,
      size: fontSize,
      font: selectedFont,
      color
    });

    y -= headingLevel ? 18 : 13;
  }

  drawFooter(page, footer, regularFont, pageSize, margin);
}

function addDividerPage(pdfDoc, pageSize, boldFont, text) {
  const page = pdfDoc.addPage([pageSize.width, pageSize.height]);

  page.drawText(text, {
    x: 72,
    y: pageSize.height / 2,
    size: 22,
    font: boldFont,
    color: rgb(0.13, 0.31, 0.43)
  });
}

function drawHeader(page, { title, font, pageSize, margin }) {
  page.drawText(title, {
    x: margin,
    y: pageSize.height - 34,
    size: 15,
    font,
    color: rgb(0.13, 0.31, 0.43)
  });

  page.drawLine({
    start: { x: margin, y: pageSize.height - 42 },
    end: { x: pageSize.width - margin, y: pageSize.height - 42 },
    thickness: 1,
    color: rgb(0.45, 0.66, 0.78)
  });
}

function drawFooter(page, footer, font, pageSize, margin) {
  page.drawLine({
    start: { x: margin, y: 32 },
    end: { x: pageSize.width - margin, y: 32 },
    thickness: 0.5,
    color: rgb(0.85, 0.9, 0.94)
  });

  page.drawText(footer || "", {
    x: margin,
    y: 18,
    size: 8,
    font,
    color: rgb(0.45, 0.45, 0.45)
  });
}

function drawSectionLine(page, x, y, width) {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: 0.7,
    color: rgb(0.45, 0.66, 0.78)
  });
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
  if (!snapshots.length) return;

  const cover = pdfDoc.addPage([pageSize.width, pageSize.height]);

  cover.drawText(title, {
    x: margin,
    y: pageSize.height - margin,
    size: 16,
    font: boldFont,
    color: rgb(0.13, 0.31, 0.43)
  });

  cover.drawText("The following pages preserve the original visual source document.", {
    x: margin,
    y: pageSize.height - margin - 26,
    size: 10,
    font: regularFont,
    color: rgb(0.35, 0.4, 0.48)
  });

  cover.drawText("This helps avoid loss of images, maps, scanned sections, signatures, stamps, and complex tables.", {
    x: margin,
    y: pageSize.height - margin - 42,
    size: 10,
    font: regularFont,
    color: rgb(0.35, 0.4, 0.48)
  });

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
    const maxHeight = pageSize.height - margin * 2 - 30;

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

  downloadBlob(blob, "PDF_Modifier_Audit_Log.json", "application/json");

  setStatus("Audit log exported successfully.", "success");
}

function buildAuditLog(templateData, processedDocs) {
  return {
    generatedAt: new Date().toISOString(),
    purpose:
      "PDF source documents converted into standardized port information format using uploaded template as reference.",
    template: {
      fileName: state.templateFile.name,
      pageCount: templateData.pageCount,
      extractedCharacterCount: templateData.fullText.length,
      note:
        "Template is used as formatting reference. Current MVP uses a fixed Santos-style structure rather than fully learning layout automatically."
    },
    sourceDocuments: processedDocs.map(doc => ({
      sourceFileName: doc.sourceFileName,
      pageCount: doc.pageCount,
      extractedCharacterCount: doc.extractedCharacterCount,
      detectedFields: doc.detected,
      sectionsMapped: Object.fromEntries(
        Object.entries(doc.sections).map(([key, value]) => [
          key,
          value && value !== "Not Available"
            ? `Mapped - ${value.length} characters`
            : "Not Available"
        ])
      ),
      preservationMethod:
        "Original pages rendered as visual snapshots and attached in exported PDF appendix."
    })),
    limitations: [
      "This browser-only MVP extracts readable PDF text using PDF.js.",
      "Scanned image-only PDFs may require OCR, which is not included in this version.",
      "Individual embedded images are not separately extracted and repositioned.",
      "Visual content is preserved through full-page snapshots.",
      "Final output should be reviewed before business use."
    ]
  };
}

function prepareTextLines(text, maxCharsPerLine) {
  const result = [];

  const rawLines = text.split("\n");

  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    if (!line) {
      result.push("");
      continue;
    }

    const wrapped = wrapText(line, maxCharsPerLine);
    result.push(...wrapped);
  }

  return result;
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
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

function getHeadingLevel(line) {
  if (line === "PORT INFORMATION REPORT") return 1;

  if (/^\d+\.\s+[A-Z0-9 /&()-]+$/.test(line)) return 2;

  if (
    [
      "SOURCE PRESERVATION NOTE",
      "Standardized layout. Missing fields are marked as Not Available."
    ].includes(line)
  ) {
    return 3;
  }

  return 0;
}

function guessPortCountryFromFileName(fileName) {
  const base = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const knownCountries = [
    "Brazil",
    "India",
    "USA",
    "United States",
    "Singapore",
    "China",
    "Japan",
    "Korea",
    "Vietnam",
    "Indonesia",
    "Malaysia",
    "Philippines",
    "Thailand",
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "South Africa",
    "Australia",
    "Canada",
    "Mexico",
    "Netherlands",
    "Germany",
    "Belgium",
    "Spain",
    "Italy",
    "France"
  ];

  let country = "";

  for (const c of knownCountries) {
    const regex = new RegExp(`\\b${escapeRegex(c)}\\b`, "i");
    if (regex.test(base)) {
      country = c === "United States" ? "USA" : c;
      break;
    }
  }

  let port = "";

  const words = base.split(" ");

  if (country) {
    const countryIndex = words.findIndex(
      w => w.toLowerCase() === country.toLowerCase()
    );

    if (countryIndex > 0) {
      port = words[countryIndex - 1];
    }
  }

  const portInfoMatch = base.match(/(.+?)\s+Port\s+Information/i);

  if (portInfoMatch) {
    const before = portInfoMatch[1]
      .replace(/\bCS\s+[A-Z0-9-]+\b/gi, "")
      .replace(/\bMV\s+[A-Z0-9-]+\b/gi, "")
      .replace(/\b20[0-9]{2}\b/g, "")
      .trim();

    if (before) {
      const parts = before.split(" ");
      port = parts[0];
    }
  }

  return {
    port: titleCase(port || ""),
    country: titleCase(country || "")
  };
}

function detectDateRange(text) {
  const patterns = [
    /\b\d{1,2}(?:ST|ND|RD|TH)?\s+[A-Z]{3,9}\s+\d{2,4}\s+TO\s+\d{1,2}(?:ST|ND|RD|TH)?\s+[A-Z]{3,9}\s+\d{2,4}\b/i,
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s*(?:TO|-|–)\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i,
    /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+20[0-9]{2}\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return cleanValue(match[0]);
  }

  return "";
}

function detectDepthDraft(text) {
  const depthMatch =
    text.match(/BERTH\s+DEPTH\s*[:\-]?\s*([^.\n]{2,60})/i) ||
    text.match(/DEPTH\s*[:\-]?\s*([^.\n]{2,60})/i) ||
    text.match(/DRAFT\s*[:\-]?\s*([^.\n]{2,60})/i) ||
    text.match(/CHANNEL\s*[:\-]?\s*([^.\n]{2,60})/i);

  return cleanValue(depthMatch?.[1]) || "Not Available";
}

function detectSecurityLevel(text) {
  const marsecMatch = text.match(/MARSEC\s+LEVEL\s*[–-]?\s*([0-9])/i);
  if (marsecMatch) return `MARSEC Level ${marsecMatch[1]}`;

  const securityMatch = text.match(/Security\s+Level\s*[:\-]?\s*([0-9])/i);
  if (securityMatch) return `Security Level ${securityMatch[1]}`;

  return "Not Available";
}

function detectVhf(text) {
  const vhfMatch =
    text.match(/VHF\s*(?:CH|CHANNEL)?\s*[:\-]?\s*([0-9 /\-&]+){1,40}/i) ||
    text.match(/channels?\s+([0-9]{1,2}\s*(?:&|\/|and)\s*[0-9]{1,2})/i);

  return cleanValue(vhfMatch?.[0]) || "Not Available";
}

function detectPublications(text) {
  const chartMatch =
    text.match(/Nautical\s+Chart\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z0-9/.\- ]+)/i) ||
    text.match(/Chart\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z0-9/.\- ]+)/i);

  return cleanValue(chartMatch?.[0]) || "Not Available";
}

function buildStandardFileName(details) {
  const port = safeFilePart(details.portName);
  const country = safeFilePart(details.country);
  const vessel = safeFilePart(details.vesselName);
  const year = safeFilePart(details.year);

  return `${port}_${country}_${vessel}_${year}_Port_Information.pdf`;
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
  els.statusText.textContent = message;

  els.statusPanel.classList.remove("success", "error");

  if (type === "success") els.statusPanel.classList.add("success");
  if (type === "error") els.statusPanel.classList.add("error");
}

function resetTool() {
  state.templateFile = null;
  state.sourceFiles = [];
  state.processedDocs = [];
  state.combinedOutput = "";
  state.auditLog = null;

  els.templatePdfInput.value = "";
  els.sourcePdfInput.value = "";

  els.templateFileInfo.textContent = "No template uploaded yet.";
  els.sourceFileInfo.textContent = "No source documents uploaded yet.";

  els.defaultCountry.value = "";
  els.defaultPort.value = "";
  els.defaultVessel.value = "";
  els.defaultYear.value = "";

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

function normalizeSpacing(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanValue(value) {
  if (!value) return "";

  return normalizeSpacing(value)
    .replace(/^[:\-–]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function valueOrNA(value) {
  const cleaned = cleanValue(value);

  if (!cleaned || cleaned.toLowerCase() === "undefined") {
    return "Not Available";
  }

  return cleaned;
}

function safeText(value) {
  return valueOrNA(value);
}

function safeFilePart(value) {
  return valueOrNA(value)
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 80);
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
