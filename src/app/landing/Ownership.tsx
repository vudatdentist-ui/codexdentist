import styles from "./landing.module.css";

type OwnershipProps = {
  sourceUrl: string;
};

export function Ownership({ sourceUrl }: OwnershipProps) {
  return (
    <section className={styles.ownership} id="ownership" aria-labelledby="ownership-title">
      <div>
        <p className={styles.kicker}>Ownership</p>
        <h2 id="ownership-title">Your clinic. Your data.</h2>
      </div>
      <ul>
        <li>Open source</li>
        <li>Self-host</li>
        <li>Portable backups</li>
        <li>Inspectable code</li>
      </ul>
      <a href={sourceUrl} data-qa="source-cta">
        GitHub ↗
      </a>
    </section>
  );
}
