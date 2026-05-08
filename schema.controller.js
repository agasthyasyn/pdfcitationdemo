// schema.controller.js

import { db, doc, getDoc } from "./firebase.client.js";

const FALLBACK_TEMPLATE_CONTROLLER = {
  schemaId: "generic_template_alignment",
  schemaName: "Generic Template Alignment - Local Fallback",
  active: true,
  version: 1,
  fallbackValue: "Not Available",
  templateMode: "sample_driven",
  summaryFieldsMode: "auto_from_sample",
  sectionsMode: "auto_from_sample",
  visualMode: "strict_visual_only",
  unmappedContentMode: "append_to_last_notes_section",
  removeSystemNotes: true,
  removeSourceLabels: true,
  preserveSourceContent: true,

  detectionRules: {
    detectHeaderTable: true,
    detectSections: true,
    detectVisuals: true,
    minimumHeaderFields: 2,
    minimumSections: 2,
    missingValue: "Not Available"
  },

  outputRules: {
    allowExtraSections: false,
    fallbackSectionName: "Detailed Notes",
    keepSameHeadingNames: true,
    sectionNumbering: true,
    showSummaryTable: true,
    useSampleHeaderFields: true,
    useSampleSectionOrder: true,
    preserveSourceContent: true,
    removeSourceLabels: true,
    removeSystemNotes: true
  },

  visualRules: {
    manualReviewRequired: true,
    minVisualHeight: 95,
    rejectHeadersFooters: true,
    rejectIfTextDensityAbovePercent: 18,
    rejectTextHeavyCrops: true
  }
};

export async function loadTemplateController() {
  try {
    const ref = doc(db, "templateSchemas", "generic_template_alignment");
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.warn(
        "Firebase controller document not found. Using local fallback controller."
      );
      return FALLBACK_TEMPLATE_CONTROLLER;
    }

    const controller = snap.data();

    if (!controller.active) {
      console.warn(
        "Firebase controller is inactive. Using local fallback controller."
      );
      return FALLBACK_TEMPLATE_CONTROLLER;
    }

    return {
      id: snap.id,
      ...controller
    };
  } catch (error) {
    console.warn(
      "Firebase controller could not be loaded. Using local fallback controller.",
      error
    );

    return FALLBACK_TEMPLATE_CONTROLLER;
  }
}
