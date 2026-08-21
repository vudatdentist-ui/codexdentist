import Link from "next/link";
import { FinalCTA } from "./FinalCTA";
import { HeroExperience } from "./HeroExperience";
import { Ownership } from "./Ownership";
import styles from "./landing.module.css";

type DentalOsLandingProps = {
  demoUrl: string;
  sourceUrl: string;
};

export function DentalOsLanding({ demoUrl, sourceUrl }: DentalOsLandingProps) {
  return (
    <main className={styles.landingShell}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" data-qa="landing-wordmark">
          Dental OS
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          <a href={sourceUrl} data-qa="header-source-cta">GitHub</a>
          <Link className={styles.liveDemo} href={demoUrl} data-qa="header-demo-cta">
            Live demo ↗
          </Link>
        </nav>
      </header>

      <HeroExperience demoUrl={demoUrl} />
      <Ownership sourceUrl={sourceUrl} />
      <FinalCTA demoUrl={demoUrl} sourceUrl={sourceUrl} />

      <footer className={styles.footer}>
        <span>Dental OS</span>
        <nav aria-label="Footer navigation">
          <Link href="/docs" data-qa="docs-cta">Docs</Link>
          <a href={sourceUrl}>GitHub</a>
          <Link href={demoUrl}>Live demo</Link>
        </nav>
      </footer>
    </main>
  );
}
