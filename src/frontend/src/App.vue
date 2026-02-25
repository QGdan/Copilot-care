<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { navItems } from './router';
import type { ThemeMode, ThemeScene } from './types/theme';

const THEME_STORAGE_KEY = 'copilot-care.theme';

const router = useRouter();
const route = useRoute();
const mobileMenuOpen = ref(false);
const isDarkTheme = ref(false);

const activeNav = computed(() =>
  navItems.find((item) => {
    if (item.path === '/') {
      return route.path === '/';
    }
    return route.path.startsWith(item.path);
  }),
);

const routeDescription = computed(
  () => activeNav.value?.description ?? '临床决策支持工作台，强调可解释与可追踪。',
);

const routeScene = computed<ThemeScene>(() => {
  return activeNav.value?.scene ?? 'consultation';
});

const routePriorityLabel = computed(() => {
  const priority = activeNav.value?.priority ?? 'support';
  if (priority === 'core') {
    return '核心流程';
  }
  if (priority === 'explore') {
    return '探索分析';
  }
  return '支持模块';
});

const routeAccentClass = computed(() => {
  return `accent-${activeNav.value?.accent ?? 'teal'}`;
});

const themeLabel = computed(() => (isDarkTheme.value ? '深色' : '浅色'));
const themeIcon = computed(() => {
  return isDarkTheme.value ? 'solar:moon-stars-bold' : 'solar:sun-bold';
});
const currentYear = new Date().getFullYear();

function resolveNavIcon(iconCode: string): string {
  if (iconCode === 'CS') return 'solar:stethoscope-bold';
  if (iconCode === 'GV') return 'solar:shield-warning-bold';
  if (iconCode === 'FH') return 'solar:code-scan-bold';
  if (iconCode === 'PT') return 'solar:heart-pulse-bold';
  return 'solar:widget-bold';
}

function resolveSceneIcon(scene: ThemeScene): string {
  if (scene === 'consultation') return 'solar:stethoscope-bold';
  if (scene === 'governance') return 'solar:shield-check-bold';
  if (scene === 'fhir') return 'solar:server-square-cloud-bold';
  return 'solar:user-heart-bold';
}

function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', mode);
}

function applyScene(scene: ThemeScene): void {
  document.body.setAttribute('data-scene', scene);
}

function navigate(path: string): void {
  void router.push(path);
  mobileMenuOpen.value = false;
}

function isActive(path: string): boolean {
  if (path === '/') {
    return route.path === '/';
  }
  return route.path.startsWith(path);
}

function toggleTheme(): void {
  isDarkTheme.value = !isDarkTheme.value;
}

onMounted(() => {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  const initialMode: ThemeMode = saved === 'light' || saved === 'dark'
    ? saved
    : preferred;

  isDarkTheme.value = initialMode === 'dark';
  applyTheme(initialMode);
  applyScene(routeScene.value);
});

watch(isDarkTheme, (value) => {
  const mode: ThemeMode = value ? 'dark' : 'light';
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyTheme(mode);
});

watch(routeScene, (scene) => {
  applyScene(scene);
}, { immediate: true });
</script>

<template>
  <div class="app-shell">
    <div class="aurora aurora-a" />
    <div class="aurora aurora-b" />

    <header
      class="app-header"
      v-motion
      :initial="{ opacity: 0, y: -10 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 320 } }"
    >
      <div class="brand-block">
        <div class="brand-mark">
          <Icon class="brand-glyph" icon="solar:medical-kit-bold-duotone" width="18" />
        </div>
        <div class="brand-copy">
          <strong>CoPilot Care</strong>
          <span>Clinical Mission Control</span>
        </div>
      </div>

      <p class="route-summary">
        {{ routeDescription }}
      </p>

      <div class="route-scene-chip" :class="routeAccentClass">
        <Icon :icon="resolveSceneIcon(routeScene)" width="14" />
        {{ routePriorityLabel }}
      </div>

      <nav class="header-nav" aria-label="主导航">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="[{ active: isActive(item.path) }, `accent-${item.accent}`]"
          @click="navigate(item.path)"
        >
          <Icon class="nav-icon" :icon="resolveNavIcon(item.icon)" width="14" />
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>

      <div class="header-actions">
        <button
          class="theme-toggle"
          :title="`切换到${isDarkTheme ? '浅色' : '深色'}模式`"
          @click="toggleTheme"
        >
          <Icon :icon="themeIcon" width="14" />
          {{ themeLabel }}
        </button>

        <button
          class="mobile-menu-btn"
          :aria-expanded="mobileMenuOpen"
          aria-label="切换菜单"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <Icon icon="solar:hamburger-menu-bold" width="14" />
          菜单
        </button>
      </div>
    </header>

    <Transition name="menu-slide">
      <nav v-if="mobileMenuOpen" class="mobile-nav" aria-label="移动端导航">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="mobile-nav-item"
          :class="{ active: isActive(item.path) }"
          @click="navigate(item.path)"
        >
          <Icon class="nav-icon" :icon="resolveNavIcon(item.icon)" width="14" />
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </nav>
    </Transition>

    <main class="app-main">
      <RouterView />
    </main>

    <footer class="app-footer">
      <span>CoPilot Care v1.0.0</span>
      <span class="divider" />
      <span>医疗指挥中枢 · 临床决策支持</span>
      <span class="divider" />
      <span>{{ currentYear }}</span>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  color: var(--color-text-primary);
}

.aurora {
  position: fixed;
  pointer-events: none;
  z-index: -1;
  filter: blur(72px);
  opacity: 0.65;
}

.aurora-a {
  width: 380px;
  height: 380px;
  top: -110px;
  left: -90px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--cc-accent-teal-500) 35%, transparent),
    transparent 72%
  );
}

.aurora-b {
  width: 420px;
  height: 420px;
  top: 180px;
  right: -120px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--cc-accent-cyan-500) 30%, transparent),
    transparent 72%
  );
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 90;
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr) auto auto auto;
  gap: 12px;
  align-items: center;
  min-height: 72px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 80%, transparent);
  backdrop-filter: blur(14px);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffffff;
  background: linear-gradient(
    135deg,
    var(--cc-accent-teal-600) 0%,
    var(--cc-accent-teal-500) 58%,
    color-mix(in srgb, var(--cc-accent-cyan-500) 45%, var(--cc-accent-teal-600))
      100%
  );
  box-shadow: 0 10px 22px rgba(15, 80, 107, 0.28);
}

.brand-glyph {
  filter: drop-shadow(0 2px 6px rgba(7, 42, 64, 0.25));
}

.brand-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-copy strong {
  font-size: 15px;
  letter-spacing: 0.02em;
}

.brand-copy span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.route-summary {
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-bg-primary) 78%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.route-scene-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--color-border-light);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-bg-primary) 88%, transparent);
  color: var(--color-text-muted);
}

.route-scene-chip.accent-teal {
  color: var(--cc-accent-teal-600);
}

.route-scene-chip.accent-cyan {
  color: var(--cc-accent-cyan-500);
}

.route-scene-chip.accent-amber {
  color: var(--cc-accent-amber-500);
}

.route-scene-chip.accent-rose {
  color: var(--cc-accent-rose-500);
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-item {
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 999px;
  padding: 7px 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  transition: all var(--cc-motion-fast) var(--cc-ease-standard);
}

.nav-item:hover {
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-bg-primary) 80%, transparent);
  color: var(--color-text-primary);
}

.nav-item.active {
  color: #ffffff;
  border-color: transparent;
  box-shadow: 0 8px 18px rgba(16, 84, 110, 0.26);
}

.nav-item.accent-teal.active {
  background: linear-gradient(130deg, #1f8d8d 0%, #146471 100%);
}

.nav-item.accent-cyan.active {
  background: linear-gradient(130deg, #3b87c2 0%, #265a95 100%);
}

.nav-item.accent-amber.active {
  background: linear-gradient(130deg, #c08a32 0%, #8f6421 100%);
}

.nav-item.accent-rose.active {
  background: linear-gradient(130deg, #c6593e 0%, #924033 100%);
}

.nav-icon {
  color: currentColor;
}

.nav-label {
  font-size: 13px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.theme-toggle,
.mobile-menu-btn {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-primary) 82%, transparent);
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 600;
  padding: 7px 12px;
  cursor: pointer;
  transition: all var(--cc-motion-fast) var(--cc-ease-standard);
}

.theme-toggle:hover,
.mobile-menu-btn:hover {
  border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
  transform: translateY(-1px);
}

.mobile-menu-btn {
  display: none;
}

.mobile-nav {
  display: none;
  margin: 8px 16px 0;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-bg-primary) 90%, transparent);
}

.mobile-nav-item {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--color-border-light);
  background: transparent;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.mobile-nav-item:last-child {
  border-bottom: none;
}

.mobile-nav-item.active {
  color: #ffffff;
  background: linear-gradient(130deg, #1d8d88 0%, #186979 55%, #0f4f62 100%);
}

.app-main {
  flex: 1;
  min-height: 0;
}

.app-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: 12px;
  background: color-mix(in srgb, var(--color-bg-primary) 84%, transparent);
}

.divider {
  width: 1px;
  height: 12px;
  background: var(--color-border);
}

.menu-slide-enter-active,
.menu-slide-leave-active {
  transition: all var(--cc-motion-fast) var(--cc-ease-standard);
}

.menu-slide-enter-from,
.menu-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1160px) {
  .app-header {
    grid-template-columns: auto minmax(100px, 1fr) auto auto;
  }

  .header-nav {
    display: none;
  }

  .mobile-menu-btn {
    display: inline-flex;
  }

  .mobile-nav {
    display: block;
  }
}

@media (max-width: 760px) {
  .app-header {
    grid-template-columns: auto auto;
    gap: 10px;
    padding: 10px 14px;
  }

  .route-summary {
    grid-column: 1 / -1;
    order: 10;
  }

  .route-scene-chip {
    display: none;
  }

  .app-footer {
    flex-wrap: wrap;
    gap: 6px;
  }

  .divider {
    display: none;
  }
}
</style>
