// schema.controller.js

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit
} from "./firebase.client.js";

/*
  Purpose:
  - Load the active Firebase template schema.
  - First try direct Firestore document read using known document ID.
  - Read controllerJson from Firestore.
  - Parse controllerJson safely.
  - Merge Firebase base fields + controllerJson into one clean controller object.
  - Keep fallback defaults if Firebase is unavailable or controllerJson has an issue.
*/

const TEMPLATE_SCHEMA_DOC_ID = "EKsLu4CtBolKNKDssJNe";

const DEFAULT_CONTROLLER = {
  schemaId: "generic_template_alignment",
  schemaName: "Generic Template Alignment",
  active: true,
  version: 1,
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

    sectionRules: [],
    fieldRules: []
  }
};

export async function loadTemplateController() {
  try {
    /*
      1. Preferred method:
      Read the known Firestore document directly.
      This avoids query mismatch issues.
    */
    const directRef = doc(db, "templateSchemas", TEMPLATE_SCHEMA_DOC_ID);
    const directSnap = await getDoc(directRef);

    if (directSnap.exists()) {
      const controller = buildControllerFromSnapshot(directSnap);
      console.log("Loaded Firebase template controller by document ID:", controller);
      return controller;
    }

    /*
      2. Fallback method:
      Query by schemaId if direct document ID is not found.
    */
    const schemaQuery = query(
      collection(db, "templateSchemas"),
      where("schemaId", "==", "generic_template_alignment"),
      limit(10)
    );

    const snapshot = await getDocs(schemaQuery);

    if (!snapshot.empty) {
      const activeDoc =
        snapshot.docs.find((item) => item.data()?.active === true) ||
        snapshot.docs[0];

      const controller = buildControllerFromSnapshot(activeDoc);
      console.log("Loaded Firebase template controller by schemaId query:", controller);
      return controller;
    }

    console.warn("No Firebase template schema found. Using default controller.");
    return DEFAULT_CONTROLLER;
  } catch (error) {
    console.warn("Failed to load Firebase template controller. Using default controller.", error);
    return DEFAULT_CONTROLLER;
  }
}

function buildControllerFromSnapshot(docSnap) {
  const firebaseData = docSnap.data() || {};
  const parsedControllerJson = parseControllerJson(firebaseData.controllerJson);

  const mergedController = {
    ...DEFAULT_CONTROLLER,
    ...firebaseData,
    id: docSnap.id,
    ruleEngine: {
      ...DEFAULT_CONTROLLER.ruleEngine,
      ...parsedControllerJson,

      visuals: {
        ...DEFAULT_CONTROLLER.ruleEngine.visuals,
        ...(parsedControllerJson.visuals || {})
      },

      qualityRules: {
        ...DEFAULT_CONTROLLER.ruleEngine.qualityRules,
        ...(parsedControllerJson.qualityRules || {})
      },

      sectionRules: Array.isArray(parsedControllerJson.sectionRules)
        ? parsedControllerJson.sectionRules
        : [],

      fieldRules: Array.isArray(parsedControllerJson.fieldRules)
        ? parsedControllerJson.fieldRules
        : []
    }
  };

  return normalizeController(mergedController);
}

function parseControllerJson(value) {
  if (!value) return {};

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    console.warn("controllerJson exists, but it is not a string. Ignoring it.");
    return {};
  }

  const trimmed = value.trim();

  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    console.warn("Invalid controllerJson in Firebase. Please check the JSON string.", error);
    return {};
  }
}

function normalizeController(controller) {
  const ruleEngine = controller.ruleEngine || {};
  const visuals = ruleEngine.visuals || {};
  const qualityRules = ruleEngine.qualityRules || {};

  const fallbackValue =
    controller.fallbackValue ||
    ruleEngine.fallbackValue ||
    "Not Available";

  const detectVisuals =
    typeof visuals.enabled === "boolean"
      ? visuals.enabled
      : controller.detectionRules?.detectVisuals ?? false;

  return {
    ...controller,

    fallbackValue,

    detectionRules: {
      ...DEFAULT_CONTROLLER.detectionRules,
      ...(controller.detectionRules || {}),
      detectVisuals,
      missingValue:
        controller.detectionRules?.missingValue ||
        fallbackValue ||
        "Not Available"
    },

    outputRules: {
      ...DEFAULT_CONTROLLER.outputRules,
      ...(controller.outputRules || {})
    },

    visualRules: {
      ...DEFAULT_CONTROLLER.visualRules,
      ...(controller.visualRules || {}),

      manualReviewRequired:
        typeof visuals.manualReviewRequired === "boolean"
          ? visuals.manualReviewRequired
          : controller.visualRules?.manualReviewRequired ?? true,

      rejectTextHeavyCrops:
        typeof visuals.rejectTextHeavyCrops === "boolean"
          ? visuals.rejectTextHeavyCrops
          : controller.visualRules?.rejectTextHeavyCrops ?? true,

      rejectIfTextDensityAbovePercent:
        visuals.rejectIfTextDensityAbovePercent ??
        controller.visualRules?.rejectIfTextDensityAbovePercent ??
        18
    },

    ruleEngine: {
      ...ruleEngine,

      version: ruleEngine.version || 2,
      fallbackValue,

      visuals: {
        ...DEFAULT_CONTROLLER.ruleEngine.visuals,
        ...visuals,
        enabled: detectVisuals
      },

      qualityRules: {
        ...DEFAULT_CONTROLLER.ruleEngine.qualityRules,
        ...qualityRules
      },

      sectionRules: Array.isArray(ruleEngine.sectionRules)
        ? ruleEngine.sectionRules
        : [],

      fieldRules: Array.isArray(ruleEngine.fieldRules)
        ? ruleEngine.fieldRules
        : []
    }
  };
}
