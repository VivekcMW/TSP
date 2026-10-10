import type { ReactNode } from "react";
import { IconContext } from "react-icons";

// Brand icons always sit beside the platform's name, so screen readers skip the artwork
// (Simple Icons ship role="img" with no title, which reads as an unnamed image).
const DECORATIVE = { attr: { "aria-hidden": true } };

export function DecorativeIcons({ children }: Readonly<{ children: ReactNode }>) {
  return <IconContext.Provider value={DECORATIVE}>{children}</IconContext.Provider>;
}
