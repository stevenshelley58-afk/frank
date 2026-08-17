import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";

import { init, use } from "echarts/core";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([LineChart, AriaComponent, GridComponent, TooltipComponent, SVGRenderer]);

const echarts = { init };

export { GridStack, echarts };
