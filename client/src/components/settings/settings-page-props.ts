import type { RouteComponentProps } from "wouter";

/** Standalone Wouter routes and embedded Settings sections share these pages. */
export type SettingsPageProps = Readonly<Partial<RouteComponentProps> & { embedded?: boolean }>;