import type { Selection } from '../../../scene/selection';
import { SeriesTooltip, SeriesNodeDataContext, SeriesNodePickMode, valueProperty } from '../series';
import type { ChartLegendDatum, CategoryLegendDatum } from '../../legendDatum';
import { ColorScale } from '../../../scale/colorScale';
import { LinearScale } from '../../../scale/linearScale';
import {
    CartesianSeries,
    CartesianSeriesMarker,
    CartesianSeriesNodeBaseClickEvent,
    CartesianSeriesNodeDatum,
} from './cartesianSeries';
import { ChartAxisDirection } from '../../chartAxisDirection';
import { getMarker } from '../../marker/util';
import { toTooltipHtml } from '../../tooltip/tooltip';
import { ContinuousScale } from '../../../scale/continuousScale';
import { extent } from '../../../util/array';
import { sanitizeHtml } from '../../../util/sanitize';
import { Label } from '../../label';
import type { Text } from '../../../scene/shape/text';
import { HdpiCanvas } from '../../../canvas/hdpiCanvas';
import type { Marker } from '../../marker/marker';
import type { MeasuredLabel, PointLabelDatum } from '../../../util/labelPlacement';
import { OPT_FUNCTION, OPT_STRING, OPT_NUMBER_ARRAY, COLOR_STRING_ARRAY, Validate } from '../../../util/validation';
import type {
    AgScatterSeriesLabelFormatterParams,
    AgScatterSeriesTooltipRendererParams,
    AgTooltipRendererResult,
    AgCartesianSeriesMarkerFormat,
} from '../../agChartOptions';
import type { ModuleContext } from '../../../util/moduleContext';
import type { DataController } from '../../data/dataController';

interface ScatterNodeDatum extends Required<CartesianSeriesNodeDatum> {
    readonly sizeValue: any;
    readonly label: MeasuredLabel;
    readonly fill: string | undefined;
}

class ScatterSeriesLabel extends Label {
    @Validate(OPT_FUNCTION)
    formatter?: (params: AgScatterSeriesLabelFormatterParams<any>) => string = undefined;
}

class ScatterSeriesNodeBaseClickEvent extends CartesianSeriesNodeBaseClickEvent<any> {
    readonly sizeKey?: string;

    constructor(
        sizeKey: string | undefined,
        xKey: string,
        yKey: string,
        nativeEvent: MouseEvent,
        datum: ScatterNodeDatum,
        series: ScatterSeries
    ) {
        super(xKey, yKey, nativeEvent, datum, series);
        this.sizeKey = sizeKey;
    }
}

class ScatterSeriesNodeClickEvent extends ScatterSeriesNodeBaseClickEvent {
    readonly type = 'nodeClick';
}

class ScatterSeriesNodeDoubleClickEvent extends ScatterSeriesNodeBaseClickEvent {
    readonly type = 'nodeDoubleClick';
}

class ScatterSeriesTooltip extends SeriesTooltip {
    @Validate(OPT_FUNCTION)
    renderer?: (params: AgScatterSeriesTooltipRendererParams) => string | AgTooltipRendererResult = undefined;
}

export class ScatterSeries extends CartesianSeries<SeriesNodeDataContext<ScatterNodeDatum>> {
    static className = 'ScatterSeries';
    static type = 'scatter' as const;

    private sizeScale = new LinearScale();

    readonly marker = new CartesianSeriesMarker();

    readonly label = new ScatterSeriesLabel();

    @Validate(OPT_STRING)
    title?: string = undefined;

    @Validate(OPT_STRING)
    labelKey?: string = undefined;

    @Validate(OPT_STRING)
    xName?: string = undefined;

    @Validate(OPT_STRING)
    yName?: string = undefined;

    @Validate(OPT_STRING)
    sizeName?: string = 'Size';

    @Validate(OPT_STRING)
    labelName?: string = 'Label';

    @Validate(OPT_STRING)
    xKey?: string = undefined;

    @Validate(OPT_STRING)
    yKey?: string = undefined;

    @Validate(OPT_STRING)
    sizeKey?: string = undefined;

    @Validate(OPT_STRING)
    colorKey?: string = undefined;

    @Validate(OPT_STRING)
    colorName?: string = 'Color';

    @Validate(OPT_NUMBER_ARRAY)
    colorDomain: number[] | undefined = undefined;

    @Validate(COLOR_STRING_ARRAY)
    colorRange: string[] = ['#ffff00', '#00ff00', '#0000ff'];

    colorScale = new ColorScale();

    readonly tooltip: ScatterSeriesTooltip = new ScatterSeriesTooltip();

    constructor(moduleCtx: ModuleContext) {
        super({
            moduleCtx,
            pickModes: [
                SeriesNodePickMode.NEAREST_BY_MAIN_CATEGORY_AXIS_FIRST,
                SeriesNodePickMode.NEAREST_NODE,
                SeriesNodePickMode.EXACT_SHAPE_MATCH,
            ],
            pathsPerSeries: 0,
            hasMarkers: true,
        });

        const { label } = this;

        label.enabled = false;
    }

    async processData(dataController: DataController) {
        const { xKey = '', yKey = '', sizeKey, labelKey, axes, marker, data } = this;

        const xAxis = axes[ChartAxisDirection.X];
        const yAxis = axes[ChartAxisDirection.Y];
        const isContinuousX = xAxis?.scale instanceof ContinuousScale;
        const isContinuousY = yAxis?.scale instanceof ContinuousScale;

        const { colorScale, colorDomain, colorRange, colorKey } = this;

        const { dataModel, processedData } = await dataController.request<any, any, true>(this.id, data ?? [], {
            props: [
                valueProperty(this, xKey, isContinuousX, { id: `xValue` }),
                valueProperty(this, yKey, isContinuousY, { id: `yValue` }),
                ...(sizeKey ? [valueProperty(this, sizeKey, true, { id: `sizeValue` })] : []),
                ...(colorKey ? [valueProperty(this, colorKey, true, { id: `colorValue` })] : []),
                ...(labelKey ? [valueProperty(this, labelKey, false, { id: `labelValue` })] : []),
            ],
            dataVisible: this.visible,
        });
        this.dataModel = dataModel;
        this.processedData = processedData;

        if (sizeKey) {
            const sizeKeyIdx = dataModel.resolveProcessedDataIndexById(this, `sizeValue`).index;
            const processedSize = processedData.domain.values[sizeKeyIdx] ?? [];
            this.sizeScale.domain = marker.domain ? marker.domain : processedSize;
        }

        if (colorKey) {
            const colorKeyIdx = dataModel.resolveProcessedDataIndexById(this, `colorValue`).index;
            colorScale.domain = colorDomain ?? processedData.domain.values[colorKeyIdx] ?? [];
            colorScale.range = colorRange;
            colorScale.update();
        }
    }

    getDomain(direction: ChartAxisDirection): any[] {
        const { dataModel, processedData } = this;
        if (!processedData || !dataModel) return [];

        const id = direction === ChartAxisDirection.X ? `xValue` : `yValue`;
        const dataDef = dataModel.resolveProcessedDataDefById(this, id, 'value');
        const domain = dataModel.getDomain(this, id, 'value', processedData);
        if (dataDef?.def.type === 'value' && dataDef?.def.valueType === 'category') {
            return domain;
        }
        const axis = this.axes[direction];
        return this.fixNumericExtent(extent(domain), axis);
    }

    protected getNodeClickEvent(event: MouseEvent, datum: ScatterNodeDatum): ScatterSeriesNodeClickEvent {
        return new ScatterSeriesNodeClickEvent(this.sizeKey, this.xKey ?? '', this.yKey ?? '', event, datum, this);
    }

    protected getNodeDoubleClickEvent(event: MouseEvent, datum: ScatterNodeDatum): ScatterSeriesNodeDoubleClickEvent {
        return new ScatterSeriesNodeDoubleClickEvent(
            this.sizeKey,
            this.xKey ?? '',
            this.yKey ?? '',
            event,
            datum,
            this
        );
    }

    async createNodeData() {
        const {
            visible,
            axes,
            yKey = '',
            xKey = '',
            label,
            labelKey,
            ctx: { callbackCache },
            dataModel,
            processedData,
        } = this;

        const xAxis = axes[ChartAxisDirection.X];
        const yAxis = axes[ChartAxisDirection.Y];

        if (!(dataModel && processedData && visible && xAxis && yAxis)) return [];

        const xDataIdx = dataModel.resolveProcessedDataIndexById(this, `xValue`).index;
        const yDataIdx = dataModel.resolveProcessedDataIndexById(this, `yValue`).index;
        const sizeDataIdx = this.sizeKey ? dataModel.resolveProcessedDataIndexById(this, `sizeValue`).index : -1;
        const colorDataIdx = this.colorKey ? dataModel.resolveProcessedDataIndexById(this, `colorValue`).index : -1;
        const labelDataIdx = this.labelKey ? dataModel.resolveProcessedDataIndexById(this, `labelValue`).index : -1;

        const { colorScale, sizeKey, colorKey, id: seriesId } = this;

        const xScale = xAxis.scale;
        const yScale = yAxis.scale;
        const xOffset = (xScale.bandwidth ?? 0) / 2;
        const yOffset = (yScale.bandwidth ?? 0) / 2;
        const { sizeScale, marker } = this;
        const nodeData: ScatterNodeDatum[] = new Array(this.processedData?.data.length ?? 0);

        sizeScale.range = [marker.size, marker.maxSize];

        const font = label.getFont();
        let actualLength = 0;
        for (const { values, datum } of processedData.data ?? []) {
            const xDatum = values[xDataIdx];
            const yDatum = values[yDataIdx];
            const x = xScale.convert(xDatum) + xOffset;
            const y = yScale.convert(yDatum) + yOffset;

            if (!this.checkRangeXY(x, y, xAxis, yAxis)) {
                continue;
            }

            let text;
            if (label.formatter) {
                text = callbackCache.call(label.formatter, { value: yDatum, seriesId, datum });
            }
            if (text === undefined) {
                text = labelKey ? String(values[labelDataIdx]) : '';
            }

            const size = HdpiCanvas.getTextSize(text, font);
            const markerSize = sizeKey ? sizeScale.convert(values[sizeDataIdx]) : marker.size;
            const fill = colorKey ? colorScale.convert(values[colorDataIdx]) : undefined;

            nodeData[actualLength++] = {
                series: this,
                itemId: yKey,
                yKey,
                xKey,
                datum,
                xValue: xDatum,
                yValue: yDatum,
                sizeValue: values[sizeDataIdx],
                point: { x, y, size: markerSize },
                nodeMidPoint: { x, y },
                fill,
                label: {
                    text,
                    ...size,
                },
            };
        }

        nodeData.length = actualLength;

        return [{ itemId: this.yKey ?? this.id, nodeData, labelData: nodeData }];
    }

    protected isPathOrSelectionDirty(): boolean {
        return this.marker.isDirty();
    }

    getLabelData(): PointLabelDatum[] {
        return this.contextNodeData?.reduce((r, n) => r.concat(n.labelData), [] as PointLabelDatum[]);
    }

    protected markerFactory() {
        const { shape } = this.marker;
        const MarkerShape = getMarker(shape);
        return new MarkerShape();
    }

    protected async updateMarkerSelection(opts: {
        nodeData: ScatterNodeDatum[];
        markerSelection: Selection<Marker, ScatterNodeDatum>;
    }) {
        const { nodeData, markerSelection } = opts;
        const {
            marker: { enabled },
        } = this;

        if (this.marker.isDirty()) {
            markerSelection.clear();
        }

        const data = enabled ? nodeData : [];
        return markerSelection.update(data);
    }

    protected async updateMarkerNodes(opts: {
        markerSelection: Selection<Marker, ScatterNodeDatum>;
        isHighlight: boolean;
    }) {
        const { markerSelection, isHighlight: isDatumHighlighted } = opts;
        const {
            marker,
            xKey = '',
            yKey = '',
            sizeScale,
            marker: {
                fillOpacity: markerFillOpacity,
                strokeOpacity: markerStrokeOpacity,
                strokeWidth: markerStrokeWidth,
            },
            highlightStyle: {
                item: {
                    fill: highlightedFill,
                    fillOpacity: highlightFillOpacity = markerFillOpacity,
                    stroke: highlightedStroke,
                    strokeWidth: highlightedDatumStrokeWidth,
                },
            },
            id: seriesId,
            ctx: { callbackCache },
        } = this;
        const { formatter } = marker;

        sizeScale.range = [marker.size, marker.maxSize];

        const customMarker = typeof marker.shape === 'function';

        markerSelection.each((node, datum) => {
            const fill =
                isDatumHighlighted && highlightedFill !== undefined ? highlightedFill : datum.fill ?? marker.fill;
            const fillOpacity = isDatumHighlighted ? highlightFillOpacity : markerFillOpacity;
            const stroke = isDatumHighlighted && highlightedStroke !== undefined ? highlightedStroke : marker.stroke;
            const strokeOpacity = markerStrokeOpacity;
            const strokeWidth =
                isDatumHighlighted && highlightedDatumStrokeWidth !== undefined
                    ? highlightedDatumStrokeWidth
                    : markerStrokeWidth ?? 1;
            const size = datum.point?.size ?? 0;

            let format: AgCartesianSeriesMarkerFormat | undefined = undefined;
            if (formatter) {
                format = callbackCache.call(formatter, {
                    datum: datum.datum,
                    xKey,
                    yKey,
                    fill,
                    stroke,
                    strokeWidth,
                    size,
                    highlighted: isDatumHighlighted,
                    seriesId,
                });
            }

            node.fill = format?.fill ?? fill;
            node.stroke = format?.stroke ?? stroke;
            node.strokeWidth = format?.strokeWidth ?? strokeWidth;
            node.fillOpacity = fillOpacity ?? 1;
            node.strokeOpacity = strokeOpacity ?? 1;
            node.translationX = datum.point?.x ?? 0;
            node.translationY = datum.point?.y ?? 0;
            node.visible = node.size > 0;

            if (!customMarker || node.dirtyPath) {
                return;
            }

            // Only for custom marker shapes.
            node.path.clear({ trackChanges: true });
            node.updatePath();
            node.checkPathDirty();
        });

        if (!isDatumHighlighted) {
            this.marker.markClean();
        }
    }

    protected async updateLabelSelection(opts: {
        labelData: ScatterNodeDatum[];
        labelSelection: Selection<Text, ScatterNodeDatum>;
    }) {
        const { labelSelection } = opts;
        const {
            label: { enabled },
        } = this;

        const placedLabels = enabled ? this.chart?.placeLabels().get(this) ?? [] : [];

        const placedNodeDatum = placedLabels.map(
            (v): ScatterNodeDatum => ({
                ...(v.datum as ScatterNodeDatum),
                point: {
                    x: v.x,
                    y: v.y,
                    size: v.datum.point.size,
                },
            })
        );
        return labelSelection.update(placedNodeDatum);
    }

    protected async updateLabelNodes(opts: { labelSelection: Selection<Text, ScatterNodeDatum> }) {
        const { labelSelection } = opts;
        const { label } = this;

        labelSelection.each((text, datum) => {
            text.text = datum.label.text;
            text.fill = label.color;
            text.x = datum.point?.x ?? 0;
            text.y = datum.point?.y ?? 0;
            text.fontStyle = label.fontStyle;
            text.fontWeight = label.fontWeight;
            text.fontSize = label.fontSize;
            text.fontFamily = label.fontFamily;
            text.textAlign = 'left';
            text.textBaseline = 'top';
        });
    }

    getTooltipHtml(nodeDatum: ScatterNodeDatum): string {
        const { xKey, yKey, axes } = this;

        const xAxis = axes[ChartAxisDirection.X];
        const yAxis = axes[ChartAxisDirection.Y];

        if (!xKey || !yKey || !xAxis || !yAxis) {
            return '';
        }

        const {
            marker,
            tooltip,
            xName,
            yName,
            sizeKey,
            sizeName,
            labelKey,
            labelName,
            id: seriesId,
            ctx: { callbackCache },
        } = this;

        const { stroke } = marker;
        const fill = nodeDatum.fill ?? marker.fill;
        const strokeWidth = this.getStrokeWidth(marker.strokeWidth ?? 1);

        const { formatter } = this.marker;
        let format: AgCartesianSeriesMarkerFormat | undefined = undefined;

        if (formatter) {
            format = callbackCache.call(formatter, {
                datum: nodeDatum,
                xKey,
                yKey,
                fill,
                stroke,
                strokeWidth,
                size: nodeDatum.point?.size ?? 0,
                highlighted: false,
                seriesId,
            });
        }

        const color = format?.fill ?? fill ?? 'gray';
        const title = this.title ?? yName;
        const {
            datum,
            xValue,
            yValue,
            sizeValue,
            label: { text: labelText },
        } = nodeDatum;
        const xString = sanitizeHtml(xAxis.formatDatum(xValue));
        const yString = sanitizeHtml(yAxis.formatDatum(yValue));

        let content =
            `<b>${sanitizeHtml(xName ?? xKey)}</b>: ${xString}<br>` +
            `<b>${sanitizeHtml(yName ?? yKey)}</b>: ${yString}`;

        if (sizeKey) {
            content += `<br><b>${sanitizeHtml(sizeName ?? sizeKey)}</b>: ${sanitizeHtml(sizeValue)}`;
        }

        if (labelKey) {
            content = `<b>${sanitizeHtml(labelName ?? labelKey)}</b>: ${sanitizeHtml(labelText)}<br>` + content;
        }

        const defaults: AgTooltipRendererResult = {
            title,
            backgroundColor: color,
            content,
        };

        const { renderer: tooltipRenderer } = tooltip;

        if (tooltipRenderer) {
            return toTooltipHtml(
                tooltipRenderer({
                    datum,
                    xKey,
                    xValue,
                    xName,
                    yKey,
                    yValue,
                    yName,
                    sizeKey,
                    sizeName,
                    labelKey,
                    labelName,
                    title,
                    color,
                    seriesId,
                }),
                defaults
            );
        }

        return toTooltipHtml(defaults);
    }

    getLegendData(): ChartLegendDatum[] {
        const { id, data, xKey, yKey, yName, title, visible, marker } = this;
        const { fill, stroke, fillOpacity, strokeOpacity } = marker;

        if (!(data?.length && xKey && yKey)) {
            return [];
        }

        const legendData: CategoryLegendDatum[] = [
            {
                legendType: 'category',
                id,
                itemId: yKey,
                seriesId: id,
                enabled: visible,
                label: {
                    text: title ?? yName ?? yKey,
                },
                marker: {
                    shape: marker.shape,
                    fill: marker.fill ?? fill ?? 'rgba(0, 0, 0, 0)',
                    stroke: marker.stroke ?? stroke ?? 'rgba(0, 0, 0, 0)',
                    fillOpacity: fillOpacity ?? 1,
                    strokeOpacity: strokeOpacity ?? 1,
                },
            },
        ];
        return legendData;
    }

    animateEmptyUpdateReady({
        markerSelections,
        labelSelections,
    }: {
        markerSelections: Array<Selection<Marker, ScatterNodeDatum>>;
        labelSelections: Array<Selection<Text, ScatterNodeDatum>>;
    }) {
        const duration = this.animationManager?.defaultOptions.duration ?? 1000;
        const labelDuration = 200;

        markerSelections.forEach((markerSelection) => {
            markerSelection.each((marker, datum) => {
                const format = this.animateFormatter(marker, datum);
                const size = datum.point?.size ?? 0;
                const to = format?.size ?? size;

                this.animationManager?.animate(`${this.id}_empty-update-ready_${marker.id}`, {
                    from: 0,
                    to: to,
                    duration,
                    onUpdate(size) {
                        marker.size = size;
                    },
                });
            });
        });

        labelSelections.forEach((labelSelection) => {
            labelSelection.each((label) => {
                this.animationManager?.animate(`${this.id}_empty-update-ready_${label.id}`, {
                    from: 0,
                    to: 1,
                    delay: duration,
                    duration: labelDuration,
                    onUpdate: (opacity) => {
                        label.opacity = opacity;
                    },
                });
            });
        });
    }

    animateReadyUpdate({ markerSelections }: { markerSelections: Array<Selection<Marker, ScatterNodeDatum>> }) {
        markerSelections.forEach((markerSelection) => {
            this.resetMarkers(markerSelection);
        });
    }

    animateReadyHighlightMarkers(markerSelection: Selection<Marker, ScatterNodeDatum>) {
        this.resetMarkers(markerSelection);
    }

    resetMarkers(markerSelection: Selection<Marker, ScatterNodeDatum>) {
        markerSelection.each((marker, datum) => {
            const format = this.animateFormatter(marker, datum);
            const size = datum.point?.size ?? 0;
            marker.size = format?.size ?? size;
        });
    }

    animateFormatter(marker: Marker, datum: ScatterNodeDatum) {
        const {
            xKey = '',
            yKey = '',
            marker: { strokeWidth: markerStrokeWidth },
            id: seriesId,
            ctx: { callbackCache },
        } = this;
        const { formatter } = this.marker;

        const fill = datum.fill ?? marker.fill;
        const stroke = marker.stroke;
        const strokeWidth = markerStrokeWidth ?? 1;
        const size = datum.point?.size ?? 0;

        let format: AgCartesianSeriesMarkerFormat | undefined = undefined;
        if (formatter) {
            format = callbackCache.call(formatter, {
                datum: datum.datum,
                xKey,
                yKey,
                fill,
                stroke,
                strokeWidth,
                size,
                highlighted: false,
                seriesId,
            });
        }

        return format;
    }

    protected isLabelEnabled() {
        return this.label.enabled;
    }
}
