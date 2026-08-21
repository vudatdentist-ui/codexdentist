"use client";

import { useEffect, useRef } from "react";
import type { ProductScene } from "./scenes";
import styles from "./landing.module.css";

type ProductStoryProps = {
  onSceneChange: (scene: ProductScene) => void;
};

type StoryBeat = {
  scene: ProductScene;
  eyebrow: string;
  title: string;
  copy: string;
};

const storyBeats: StoryBeat[] = [
  {
    scene: "today",
    eyebrow: "Clinic day",
    title: "Know what needs attention.",
    copy: "Start with the day's operational context, then move into the work that needs you.",
  },
  {
    scene: "patient",
    eyebrow: "Patient journey",
    title: "One patient. One story.",
    copy: "Keep patient identity, appointments, and treatment context connected as care moves forward.",
  },
];

export function ProductStory({ onSceneChange }: ProductStoryProps) {
  const refs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const scene = visible.target.getAttribute("data-story-scene") as ProductScene | null;
        if (scene) onSceneChange(scene);
      },
      { rootMargin: "-38% 0px -42% 0px", threshold: [0.01, 0.2, 0.5] },
    );

    refs.current.forEach((node) => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [onSceneChange]);

  return (
    <div className={styles.storyRail} aria-label="Dental OS workflow stories">
      {storyBeats.map((beat, index) => (
        <article
          key={beat.scene}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={styles.storyBeat}
          data-story-scene={beat.scene}
        >
          <span>{beat.eyebrow}</span>
          <h2>{beat.title}</h2>
          <p>{beat.copy}</p>
        </article>
      ))}
    </div>
  );
}
