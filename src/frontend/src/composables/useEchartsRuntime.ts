import type { ECharts } from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { init, use } from 'echarts/core';

type EChartsInit = (element: HTMLElement) => ECharts;

let cachedInit: EChartsInit | null = null;
let initialized = false;

export async function loadEchartsInit(): Promise<EChartsInit> {
  if (cachedInit) {
    return cachedInit;
  }

  if (!initialized) {
    use([
      GraphChart,
      GridComponent,
      TooltipComponent,
      CanvasRenderer,
    ]);
    initialized = true;
  }

  cachedInit = (element: HTMLElement) => init(element);
  return cachedInit;
}
