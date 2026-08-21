export type ProductScene = "today" | "schedule" | "patient" | "operations";

export type ProductSceneConfig = {
  label: string;
  prompt: string;
  response: string;
  image: string;
  alt: string;
  mobilePosition: string;
};

export const PRODUCT_SCENES: Record<ProductScene, ProductSceneConfig> = {
  today: {
    label: "Today",
    prompt: "What needs attention today?",
    response:
      "Start with the clinic day in one place: appointments, current work, and the context your team needs to move next.",
    image: "/marketing/dashboard-preview.png",
    alt: "Dental OS daily operations dashboard shown with demo clinic data",
    mobilePosition: "18% top",
  },
  schedule: {
    label: "Schedule",
    prompt: "What should reception see this morning?",
    response:
      "Reception can work from the schedule view to see appointments and follow the clinic day without switching tools.",
    image: "/marketing/feature-schedule.png",
    alt: "Dental OS appointment schedule shown with demo clinic data",
    mobilePosition: "12% top",
  },
  patient: {
    label: "Patient",
    prompt: "Show me a patient.",
    response:
      "Open one patient record to keep identity, appointments, and treatment context connected as care moves forward.",
    image: "/marketing/feature-patients.png",
    alt: "Dental OS patient workspace shown with demo clinic data",
    mobilePosition: "16% top",
  },
  operations: {
    label: "Operations",
    prompt: "What happens when stock is low?",
    response:
      "Inventory, medicines, equipment, and operational work live alongside the clinical workflow instead of in a separate system.",
    image: "/marketing/feature-inventory.png",
    alt: "Dental OS inventory and operations workspace shown with demo clinic data",
    mobilePosition: "10% top",
  },
};

export const SCENE_ORDER: ProductScene[] = ["today", "schedule", "patient", "operations"];
