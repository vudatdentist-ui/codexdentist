"use client";

import { useCallback, useState } from "react";
import { ProductAssistant } from "./ProductAssistant";
import { ProductStage } from "./ProductStage";
import { ProductStory } from "./ProductStory";
import type { ProductScene } from "./scenes";
import styles from "./landing.module.css";

type HeroExperienceProps = {
  demoUrl: string;
};

export function HeroExperience({ demoUrl }: HeroExperienceProps) {
  const [scene, setScene] = useState<ProductScene>("today");

  const changeScene = useCallback((nextScene: ProductScene) => {
    setScene(nextScene);
  }, []);

  const showOwnership = useCallback(() => {
    const ownership = document.getElementById("ownership");
    if (!ownership) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ownership.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, []);

  return (
    <section className={styles.experience} aria-labelledby="landing-title">
      <div className={styles.experienceGrid}>
        <div className={styles.firstMoment}>
          <p className={styles.kicker}>Dental clinic operating system</p>
          <h1 id="landing-title" data-qa="landing-hero-title">
            Make your clinic day easier.
          </h1>
          <ProductAssistant
            activeScene={scene}
            demoUrl={demoUrl}
            onSceneChange={changeScene}
            onOwnership={showOwnership}
          />
        </div>

        <div className={styles.stageColumn}>
          <div className={styles.stageSticky}>
            <ProductStage scene={scene} />
          </div>
        </div>

        <ProductStory onSceneChange={changeScene} />
      </div>
    </section>
  );
}
