"use client";

import type { CSSProperties } from "react";
import { PRODUCT_SCENES, SCENE_ORDER, type ProductScene } from "./scenes";
import styles from "./landing.module.css";

type ProductStageProps = {
  scene: ProductScene;
};

export function ProductStage({ scene }: ProductStageProps) {
  const active = PRODUCT_SCENES[scene];

  return (
    <figure className={styles.stage} data-qa="product-stage" data-scene={scene}>
      <div className={styles.stageChrome} aria-hidden="true">
        <span>Dental OS</span>
        <span className={styles.stageSceneLabel}>{active.label}</span>
        <span>Live product capture</span>
      </div>
      <div className={styles.stageViewport}>
        {SCENE_ORDER.map((sceneKey) => {
          const config = PRODUCT_SCENES[sceneKey];
          const isActive = sceneKey === scene;
          return (
            <img
              key={sceneKey}
              className={styles.stageImage}
              data-active={isActive ? "true" : "false"}
              data-qa={`product-stage-image-${sceneKey}`}
              src={config.image}
              alt={isActive ? config.alt : ""}
              aria-hidden={isActive ? undefined : true}
              decoding="async"
              loading={sceneKey === "today" ? "eager" : "lazy"}
              style={{ "--mobile-position": config.mobilePosition } as CSSProperties}
            />
          );
        })}
      </div>
      <figcaption className={styles.stageCaption} aria-live="polite">
        <strong>{active.label}</strong>
        <span>{active.response}</span>
      </figcaption>
    </figure>
  );
}
