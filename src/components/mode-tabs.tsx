import Link from "next/link";
import { cn } from "@/lib/utils";

/** "My journal | Your project" switch at the top of the page. */
export function ModeTabs({ active }: { active: "journal" | "workspace" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "-mb-0.5 inline-flex min-h-11 items-center rounded-t-sm border-2 px-4 text-note font-semibold sm:min-h-9",
        on
          ? "border-graphite/70 border-b-paper bg-paper text-graphite"
          : "border-transparent text-pencil hover:text-graphite hover:underline hover:underline-offset-4",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Journal" className="mb-6 flex gap-1 border-b-2 border-graphite/70">
      {tab("/", "My journal", active === "journal")}
      {tab("/workspace", "Your project", active === "workspace")}
    </nav>
  );
}

/** The brand line. It's the page's h1 where the page has no other main heading. */
export function PageHeader({ as: Brand = "p" }: { as?: "h1" | "p" }) {
  return (
    <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <Brand className="font-display text-2xl font-extrabold tracking-wide uppercase">RunNotes</Brand>
      <p className="text-sm text-pencil">Experiment journal · talk after every run</p>
    </header>
  );
}
