import { db, doc, getDoc } from "./firebase.client.js";

export async function loadTemplateController() {
  const ref = doc(db, "templateSchemas", "generic_template_alignment");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Firebase template controller not found: generic_template_alignment");
  }

  const controller = snap.data();

  if (!controller.active) {
    throw new Error("Firebase template controller is inactive.");
  }

  return {
    id: snap.id,
    ...controller
  };
}
