"use client";

import { useEffect, useState } from "react";

type Section = { id: string; label: string };
export function RecordSectionNav({ label, items }: { label: string; items: Section[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id);
  const ids = items.map(item => item.id).join(" ");
  useEffect(() => {
    const sections = ids.split(" ").map(id => document.getElementById(id)).filter((node): node is HTMLElement => !!node);
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-10% 0px -65% 0px" });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [ids]);
  return <nav className="record-section-nav" aria-label={label}>{items.map((item, index) =>
    <a href={`#${item.id}`} key={item.id} aria-current={activeId === item.id ? "location" : undefined} onClick={() => setActiveId(item.id)}>
      <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{item.label}
    </a>,
  )}</nav>;
}
