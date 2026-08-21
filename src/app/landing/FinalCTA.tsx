import Link from "next/link";
import styles from "./landing.module.css";

type FinalCTAProps = {
  demoUrl: string;
  sourceUrl: string;
};

export function FinalCTA({ demoUrl, sourceUrl }: FinalCTAProps) {
  return (
    <section className={styles.finalAction} aria-labelledby="final-action-title">
      <p className={styles.kicker}>Dental OS</p>
      <h2 id="final-action-title">Try Dental OS.</h2>
      <div>
        <Link className={styles.primaryAction} href={demoUrl} data-qa="demo-cta">
          Live demo ↗
        </Link>
        <a className={styles.textAction} href={sourceUrl}>
          GitHub ↗
        </a>
      </div>
    </section>
  );
}
