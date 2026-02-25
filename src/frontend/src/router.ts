import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import type { AppRouteMeta, RoutePriority } from './types/theme';

type AppRouteRecord = RouteRecordRaw & {
  meta: AppRouteMeta;
};

const NAV_PRIORITY_ORDER: Record<RoutePriority, number> = {
  core: 0,
  support: 1,
  explore: 2,
};

const routes: AppRouteRecord[] = [
  {
    path: '/',
    name: 'consultation',
    component: () => import('./views/ConsultationView.vue'),
    meta: {
      title: '会诊工作台',
      icon: 'CS',
      description: '执行实时分诊流程，并查看可追溯的临床推理链路。',
      accent: 'teal',
      scene: 'consultation',
      priority: 'core',
    },
  },
  {
    path: '/governance',
    name: 'governance',
    component: () => import('./views/GovernanceView.vue'),
    meta: {
      title: '治理看板',
      icon: 'GV',
      description: '可视化后端执行神经网络与三类核心因素：时延重试、分歧收敛、路由因果。',
      accent: 'rose',
      scene: 'governance',
      priority: 'support',
    },
  },
  {
    path: '/fhir',
    name: 'fhir',
    component: () => import('./views/FhirExplorerView.vue'),
    meta: {
      title: 'FHIR 资源浏览',
      icon: 'FH',
      description: '查看互操作资源与结构化载荷详情。',
      accent: 'cyan',
      scene: 'fhir',
      priority: 'explore',
    },
  },
  {
    path: '/patient/:id?',
    name: 'patient-dashboard',
    component: () => import('./views/PatientDashboardView.vue'),
    meta: {
      title: '患者看板',
      icon: 'PT',
      description: '查看患者纵向趋势与历史会诊记录。',
      accent: 'amber',
      scene: 'patient',
      priority: 'support',
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, _from, next) => {
  const title = to.meta.title as string;
  if (title) {
    document.title = `${title} - CoPilot Care`;
  }
  next();
});

export default router;

export const navItems = routes
  .map((route) => ({
    path: route.path,
    label: route.meta.title,
    icon: route.meta.icon,
    description: route.meta.description,
    accent: route.meta.accent ?? 'teal',
    scene: route.meta.scene ?? 'consultation',
    priority: route.meta.priority ?? 'support',
  }))
  .sort((left, right) => {
    return NAV_PRIORITY_ORDER[left.priority] - NAV_PRIORITY_ORDER[right.priority];
  });
