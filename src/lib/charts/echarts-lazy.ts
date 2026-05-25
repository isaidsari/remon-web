// ~500 KB gzipped; singleton Promise so parallel chart components share one import.

import type * as Echarts from 'echarts/core';

// Covers every chart in the app — add new chart module types here.
let promise: Promise<typeof Echarts> | null = null;

export function loadEcharts(): Promise<typeof Echarts> {
	if (promise) return promise;
	promise = (async () => {
		const [core, charts, components, renderers] = await Promise.all([
			import('echarts/core'),
			import('echarts/charts'),
			import('echarts/components'),
			import('echarts/renderers')
		]);
		core.use([
			charts.LineChart,
			components.GridComponent,
			components.TooltipComponent,
			components.LegendComponent,
			components.DataZoomComponent,
			components.AxisPointerComponent,
			components.MarkLineComponent,
			components.BrushComponent,
			components.ToolboxComponent,
			renderers.CanvasRenderer
		]);
		return core;
	})();
	return promise;
}
