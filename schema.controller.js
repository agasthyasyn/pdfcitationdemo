// schema.controller.js

/*
  Local-safe controller loader.

  Why this version:
  - Firestore is currently failing in browser with:
    "Failed to get document because the client is offline."
  - This file avoids Firestore calls completely for now.
  - script.js already contains LOCAL_FALLBACK_RULE_ENGINE.
  - Returning a valid controller object allows the tool to continue processing.
  - Firebase can be reintroduced later after the connectivity issue is resolved.
*/

const LOCAL_TEMPLATE_CONTROLLER = {
  schemaId: "generic_template_alignment",
  schemaName: "Generic Template Alignment - Local Safe Mode",
  active: true,
  version: 2,
  fallbackValue: "Not Available",

  detectionRules: {
    detectHeaderTable: true,
    detectSections: true,
    detectVisuals: false,
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
  },

  ruleEngine: {
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

    /*
      Keep these empty here.
      The upgraded script.js already has the full local fallback:
      - 12 section rules
      - 10 field rules

      If Firebase is unavailable, script.js will automatically use those local rules.
    */
    sectionRules: [],
    fieldRules: []
  }
};

export async function loadTemplateController() {
  console.log("Loaded local-safe template controller. Firebase read skipped for now.");
  return LOCAL_TEMPLATE_CONTROLLER;
}
