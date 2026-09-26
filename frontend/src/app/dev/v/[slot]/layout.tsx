import { ASSIGN } from "../assign";

/** Static export requires every dynamic segment to be enumerated at build time. */
export function generateStaticParams() {
  return Object.keys(ASSIGN).map((slot) => ({ slot }));
}

export default function SlotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
