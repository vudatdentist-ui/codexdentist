"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PRODUCT_SCENES, SCENE_ORDER, type ProductScene } from "./scenes";
import styles from "./landing.module.css";

type ProductAssistantProps = {
  activeScene: ProductScene;
  demoUrl: string;
  onSceneChange: (scene: ProductScene) => void;
  onOwnership: () => void;
};

type GuideResult =
  | { kind: "scene"; scene: ProductScene; response: string }
  | { kind: "ownership"; response: string }
  | { kind: "unsupported"; response: string };

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function resolveGuideIntent(query: string): GuideResult {
  const value = normalize(query);

  if (!value) {
    return {
      kind: "unsupported",
      response: "Try asking about today, the schedule, a patient, operations, or self-hosting.",
    };
  }

  if (
    value.includes("self-host") ||
    value.includes("self host") ||
    value.includes("open source") ||
    value.includes("source code") ||
    value.includes("data ownership") ||
    value.includes("github")
  ) {
    return {
      kind: "ownership",
      response:
        "Dental OS is open source and can be self-hosted, so your clinic can inspect the code and control the infrastructure it runs on.",
    };
  }

  if (
    value.includes("patient") ||
    value.includes("journey") ||
    value.includes("record")
  ) {
    return { kind: "scene", scene: "patient", response: PRODUCT_SCENES.patient.response };
  }

  if (
    value.includes("stock") ||
    value.includes("inventory") ||
    value.includes("medicine") ||
    value.includes("equipment") ||
    value.includes("operations")
  ) {
    return {
      kind: "scene",
      scene: "operations",
      response: PRODUCT_SCENES.operations.response,
    };
  }

  if (
    value.includes("schedule") ||
    value.includes("appointment") ||
    value.includes("reception") ||
    value.includes("front desk") ||
    value.includes("morning")
  ) {
    return {
      kind: "scene",
      scene: "schedule",
      response: PRODUCT_SCENES.schedule.response,
    };
  }

  if (
    value.includes("today") ||
    value.includes("attention") ||
    value.includes("work") ||
    value.includes("clinic day")
  ) {
    return { kind: "scene", scene: "today", response: PRODUCT_SCENES.today.response };
  }

  return {
    kind: "unsupported",
    response:
      "This product guide only answers from verified Dental OS views. Try Today, Schedule, Patient, Operations, or self-hosting.",
  };
}

export function ProductAssistant({
  activeScene,
  demoUrl,
  onSceneChange,
  onOwnership,
}: ProductAssistantProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState(PRODUCT_SCENES.today.response);

  useEffect(() => {
    setResponse(PRODUCT_SCENES[activeScene].response);
  }, [activeScene]);

  const activePrompt = useMemo(() => PRODUCT_SCENES[activeScene].prompt, [activeScene]);

  function activateScene(scene: ProductScene) {
    setQuery(PRODUCT_SCENES[scene].prompt);
    setResponse(PRODUCT_SCENES[scene].response);
    onSceneChange(scene);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = resolveGuideIntent(query);

    if (result.kind === "scene") {
      setResponse(result.response);
      onSceneChange(result.scene);
      return;
    }

    setResponse(result.response);
    if (result.kind === "ownership") onOwnership();
  }

  return (
    <div className={styles.assistant} data-qa="product-assistant">
      <div className={styles.assistantMeta}>
        <span>Interactive product guide</span>
        <span aria-hidden="true">Verified product views only</span>
      </div>

      <form className={styles.askForm} onSubmit={submit}>
        <label className={styles.srOnly} htmlFor="ask-dental-os">
          Ask Dental OS about the product
        </label>
        <input
          id="ask-dental-os"
          data-qa="assistant-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask Dental OS anything..."
          autoComplete="off"
          spellCheck="false"
        />
        <button type="submit" data-qa="assistant-submit" aria-label="Ask Dental OS">
          <span>Ask</span>
          <span aria-hidden="true">↵</span>
        </button>
      </form>

      <div className={styles.promptRow} aria-label="Product views">
        {SCENE_ORDER.map((scene) => (
          <button
            key={scene}
            type="button"
            className={styles.prompt}
            aria-pressed={activeScene === scene}
            data-scene-prompt={scene}
            onClick={() => activateScene(scene)}
          >
            {PRODUCT_SCENES[scene].label}
          </button>
        ))}
      </div>

      <div className={styles.guideResponse} data-qa="assistant-response" aria-live="polite">
        <span className={styles.responseMark} aria-hidden="true">D</span>
        <div>
          <strong>Dental OS</strong>
          <p key={response}>{response}</p>
          <a href={demoUrl}>Open the live demo ↗</a>
        </div>
      </div>

      <p className={styles.activePrompt} aria-hidden="true">
        {activePrompt}
      </p>
    </div>
  );
}
