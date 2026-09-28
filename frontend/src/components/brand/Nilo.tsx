import { NiloSprite, type NiloState } from "./NiloSprite";

type Props = {
  className?: string;
  label?: string;
  state?: NiloState;
  /** CSS px per pixel cell. 6 (default) is the Chat-home size; use 4 for a
      compact empty state inside a narrower panel (Automate, Pull requests,
      Providers, Studio). */
  cell?: 4 | 6;
};

/** Nilo: the OpenHarness owl, animated and interactive (see NiloSprite). */
export function Nilo({ className = "", label = "Nilo, the OpenHarness owl guide", state = "idle", cell = 6 }: Props) {
  return <NiloSprite state={state} cell={cell} interactive label={label} className={`oh-nilo ${className}`} />;
}
