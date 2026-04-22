import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
import * as pdfjsViewer from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf_viewer.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const pdfContainer = document.getElementById("pdf-container");
const loadBtn = document.getElementById("loadBtn");
const pageInput = document.getElementById("pageInput");
const highlightInput = document.getElementById("highlightInput");
const statusEl = document.getElementById("status");
const targetTextBox = document.getElementById("targetTextBox");

const PDF_FILE = "sample.pdf";

loadBtn.addEventListener("click", () => {
  loadSinglePagePdf();
});

async function loadSinglePagePdf() {
  const pageNumber = parseInt(pageInput.value, 10);
  const highlightText = highlightInput.value.trim();

  targetTextBox.textContent = highlightText;
  statusEl.textContent = "Loading PDF...";

  pdfContainer.innerHTML = "";

  try {
    const loadingTask = pdfjsLib.getDocument(PDF_FILE);
    const pdf = await loadingTask.promise;

    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      statusEl.textContent = `Invalid page number. PDF has ${pdf.numPages} pages.`;
      return;
    }

    const page = await pdf.getPage(pageNumber);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    const pageWrapper = document.createElement("div");
    pageWrapper.className = "pdf-page";

    const pageLabel = document.createElement("div");
    pageLabel.className = "page-label";
    pageLabel.textContent = `Showing Page ${pageNumber}`;
    pageWrapper.appendChild(pageLabel);

    const canvasWrapper = document.createElement("div");
    canvasWrapper.className = "canvas-wrapper";
    canvasWrapper.style.width = `${viewport.width}px`;
    canvasWrapper.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    canvasWrapper.appendChild(canvas);

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    canvasWrapper.appendChild(textLayerDiv);

    pageWrapper.appendChild(canvasWrapper);
    pdfContainer.appendChild(pageWrapper);

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const textContent = await page.getTextContent();

    const textLayer = new pdfjsViewer.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport
    });

    await textLayer.render();

    applyHighlight(textLayerDiv, highlightText);

    statusEl.textContent = "PDF loaded";
  } catch (error) {
    console.error(error);
    statusEl.textContent = "Failed to load PDF";
  }
}

function applyHighlight(textLayerDiv, targetText) {
  if (!targetText) return;

  const spans = Array.from(textLayerDiv.querySelectorAll("span"));
  const normalizedTarget = normalizeText(targetText);

  let found = false;

  spans.forEach((span) => {
    const spanText = normalizeText(span.textContent || "");
    if (spanText && normalizedTarget.includes(spanText) && spanText.length > 2) {
      span.classList.add("highlight-match");
      found = true;
    }
  });

  if (!found) {
    const combinedText = normalizeText(
      spans.map((span) => span.textContent || "").join(" ")
    );

    if (combinedText.includes(normalizedTarget)) {
      statusEl.textContent = "Partial page-level match found";
    } else {
      statusEl.textContent = "Exact visible match not found on this page";
    }
  } else {
    statusEl.textContent = "Likely highlighted match found";
  }
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s.:]/g, "")
    .trim();
}
