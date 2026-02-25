export type ThemeMode = 'light' | 'dark';
export type ThemeScene = 'consultation' | 'governance' | 'fhir' | 'patient';
export type RouteAccent = 'teal' | 'cyan' | 'amber' | 'rose';
export type RoutePriority = 'core' | 'support' | 'explore';

export interface AppRouteMeta {
  title: string;
  icon: string;
  description: string;
  accent?: RouteAccent;
  scene?: ThemeScene;
  priority?: RoutePriority;
}

export interface ThemeSemanticToken {
  mode: ThemeMode;
  scene: ThemeScene;
  accent: RouteAccent;
  priority: RoutePriority;
}
