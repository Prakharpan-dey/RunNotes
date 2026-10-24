import Link from "next/link";
import { cn } from "@/lib/utils";

/** "My journal | Your project" switch at the top of the page. */
export function ModeTabs({ active }: { active: "journal" | "workspace" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "rounded-sm px-3 py-1.5 font-display text-sm font-bold tracking-wide uppercase",
        on ? "bg-graphite text-paper" : "text-pencil hover:text-graphite",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Journal" className="mb-6 inline-flex rounded-sm border-2 border-graphite/70 p-0.5">
      {tab("/", "My journal", active === "journal")}
      {tab("/workspace", "Your project", active === "workspace")}
    </nav>
  );
}

export function PageHeader() {
  return (
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <p className="font-display text-2xl font-extrabold tracking-wide uppercase">RunNotes</p>
      <p className="text-sm text-pencil">Experiment journal · talk after every run</p>
    </header>
  );
}
