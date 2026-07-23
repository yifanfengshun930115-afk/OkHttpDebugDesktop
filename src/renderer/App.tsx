import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Columns3,
  Copy,
  Download,
  FileJson,
  FileText,
  Filter,
  GripVertical,
  ListRestart,
  Menu,
  MonitorSmartphone,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Server,
  Timer,
  Trash2,
  Usb,
  X
} from 'lucide-react';
import type { AdbDevice, CaptureRecord, DesktopState, HeadersRecord } from '../shared/protocol.js';
import { DEFAULT_WS_PORT, DEFAULT_WS_PORT_RANGE_END } from '../shared/protocol.js';
import {
  closeTauriApp,
  minimizeDesktopWindow,
  onDesktopCloseRequested,
  resolveDesktopApi
} from './desktopApi.js';
import { sampleCaptures } from './sampleCaptures.js';
import './styles.css';

type DetailTab = 'overview' | 'compare' | 'headers' | 'request' | 'response' | 'timing' | 'error';
type StatusFilter = 'all' | 'success' | 'error' | 'failed';
type StageFilter = 'all' | 'plain' | 'wire' | 'dual';
type BodyMode = 'pretty' | 'raw';

const DETAIL_TAB_LABELS: Record<DetailTab, string> = {
  overview: '概览',
  compare: '对比',
  headers: '头信息',
  request: '请求',
  response: '响应',
  timing: '耗时',
  error: '错误'
};

interface CaptureGroup {
  id: string;
  primary: CaptureRecord;
  records: CaptureRecord[];
}

interface BodyInspectorProps {
  title: string;
  body?: string;
  contentType?: string;
  contentLength?: number;
  truncated?: boolean;
  onNotify: (message: string) => void;
}

interface ParsedBody {
  value: unknown;
  label: string;
}

interface StructuredInspectorProps {
  title?: string;
  value: unknown;
  onNotify: (message: string) => void;
}

const fallbackState: DesktopState = {
  server: {
    port: DEFAULT_WS_PORT,
    preferredPort: DEFAULT_WS_PORT,
    devicePort: DEFAULT_WS_PORT,
    usbReverse: {
      enabled: true,
      active: false,
      hostPort: DEFAULT_WS_PORT,
      devicePort: DEFAULT_WS_PORT,
      intervalMs: 15000,
      devices: [],
      message: 'USB 自动映射已就绪。'
    },
    portRange: {
      start: DEFAULT_WS_PORT,
      end: DEFAULT_WS_PORT_RANGE_END
    },
    running: false,
    connectionCount: 0,
    connections: []
  },
  captures: sampleCaptures
};

function methodClass(method: string) {
  return `method method-${method.toLowerCase()}`;
}

function statusLabel(capture: CaptureRecord) {
  if (capture.error) {
    return '错';
  }

  if (capture.response) {
    return String(capture.response.code);
  }

  return '...';
}

function captureStatus(capture: CaptureRecord): StatusFilter {
  if (capture.error) {
    return 'failed';
  }

  const code = capture.response?.code;
  if (code && code >= 200 && code < 400) {
    return 'success';
  }

  if (code && code >= 400) {
    return 'error';
  }

  return 'all';
}

function formatTime(epochMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(epochMs));
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) {
    return '-';
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${Math.round(durationMs)} ms`;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes < 0 || Number.isNaN(bytes)) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function measuredBodySize(body?: string, contentLength?: number) {
  if (contentLength !== undefined) {
    return formatBytes(contentLength);
  }
  if (body === undefined) {
    return '-';
  }
  return `${body.length.toLocaleString()} 字符`;
}

function getHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function getPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function getScheme(url: string) {
  try {
    return new URL(url).protocol.replace(':', '').toUpperCase();
  } catch {
    return 'URL';
  }
}

function flattenHeaders(headers: HeadersRecord) {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: Array.isArray(value) ? value.join(', ') : value
  }));
}

function bodyText(value?: string) {
  return value?.trim() ? value : '(empty)';
}

function parseJsonContainer(value: string) {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function decodeUrlEncodedText(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

function looksLikeFormBody(value: string, contentType?: string) {
  if (contentType?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return true;
  }
  return /^[^=&\s]+=[\s\S]*$/.test(value);
}

function parseFormFieldValue(value: string) {
  const json = parseJsonContainer(value);
  if (json !== undefined) {
    return json;
  }

  if (!/%[0-9a-f]{2}|\+/i.test(value)) {
    return value;
  }

  const decoded = decodeUrlEncodedText(value);
  if (decoded === undefined || decoded === value) {
    return value;
  }

  const decodedJson = parseJsonContainer(decoded);
  return decodedJson === undefined ? decoded : decodedJson;
}

function appendFormValue(target: Record<string, unknown>, name: string, value: unknown) {
  const current = target[name];
  if (current === undefined) {
    target[name] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    target[name] = [current, value];
  }
}

function parseFormBody(value: string): ParsedBody | undefined {
  const params = new URLSearchParams(value);
  const entries = Array.from(params.entries());
  if (entries.length === 0 || entries.every(([name]) => !name)) {
    return undefined;
  }

  const parsed: Record<string, unknown> = {};
  for (const [name, fieldValue] of entries) {
    appendFormValue(parsed, name, parseFormFieldValue(fieldValue));
  }
  return { value: parsed, label: '表单已解码' };
}

function parseInspectableBody(value?: string, contentType?: string): ParsedBody | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const json = parseJsonContainer(trimmed);
  if (json !== undefined) {
    return { value: json, label: 'JSON 已解析' };
  }

  if (looksLikeFormBody(trimmed, contentType)) {
    const form = parseFormBody(trimmed);
    if (form !== undefined) {
      return form;
    }
  }

  if (!/%[0-9a-f]{2}|\+/i.test(trimmed)) {
    return undefined;
  }

  const decoded = decodeUrlEncodedText(trimmed);
  if (decoded === undefined || decoded === trimmed) {
    return undefined;
  }

  const decodedJson = parseJsonContainer(decoded);
  if (decodedJson !== undefined) {
    return { value: decodedJson, label: 'URL 编码 JSON 已解码' };
  }

  if (looksLikeFormBody(decoded, contentType)) {
    const decodedForm = parseFormBody(decoded);
    if (decodedForm !== undefined) {
      return decodedForm;
    }
  }

  return { value: decoded, label: 'URL 编码文本已解码' };
}

function parseJsonString(value?: string) {
  return parseInspectableBody(value)?.value;
}

function printableParsedBody(parsed: ParsedBody) {
  return typeof parsed.value === 'string' ? parsed.value : JSON.stringify(parsed.value, null, 2);
}

function summarizeJson(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} 项`;
  }
  if (value && typeof value === 'object') {
    const count = Object.keys(value).length;
    return `${count} 个字段`;
  }
  if (value === null) {
    return '空值';
  }
  if (typeof value === 'string') {
    return '字符串';
  }
  if (typeof value === 'number') {
    return '数字';
  }
  if (typeof value === 'boolean') {
    return '布尔值';
  }
  return typeof value;
}

function pathKey(path: Array<string | number>) {
  return path.length === 0 ? '$' : path.join('\u001f');
}

function collectExpandablePaths(value: unknown, path: Array<string | number> = []) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const paths = [pathKey(path)];
  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item] as const)
    : Object.entries(value as Record<string, unknown>);

  for (const [key, child] of entries) {
    paths.push(...collectExpandablePaths(child, [...path, key]));
  }

  return paths;
}

function primitiveClass(value: unknown) {
  if (value === null) {
    return 'json-null';
  }
  if (typeof value === 'string') {
    return 'json-string';
  }
  if (typeof value === 'number') {
    return 'json-number';
  }
  if (typeof value === 'boolean') {
    return 'json-boolean';
  }
  return 'json-unknown';
}

function renderPrimitive(value: unknown) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return 'undefined';
  }
  return String(value);
}

function statusText(status: StatusFilter) {
  if (status === 'all') {
    return '全部';
  }
  if (status === 'success') {
    return '成功';
  }
  if (status === 'error') {
    return '异常';
  }
  if (status === 'failed') {
    return '失败';
  }
  return status;
}

function stageText(stage: StageFilter) {
  if (stage === 'all') {
    return '全阶段';
  }
  if (stage === 'dual') {
    return '已配对';
  }
  return stage === 'plain' ? '明文' : '传输';
}

function captureGroupId(capture: CaptureRecord) {
  return capture.groupId;
}

function captureStageKey(capture: CaptureRecord) {
  return capture.stage;
}

function captureStageLabel(capture: CaptureRecord) {
  const stage = captureStageKey(capture);
  if (stage === 'plain') {
    return '明文';
  }
  if (stage === 'wire') {
    return '传输';
  }
  return stage;
}

function choosePrimary(records: CaptureRecord[]) {
  return (
    records.find((capture) => capture.stage === 'plain') ??
    records.find((capture) => capture.stage === 'wire') ??
    records[0]
  );
}

function groupCaptures(captures: CaptureRecord[]): CaptureGroup[] {
  const groups = new Map<string, CaptureRecord[]>();
  for (const capture of captures) {
    const id = captureGroupId(capture);
    groups.set(id, [...(groups.get(id) ?? []), capture]);
  }

  return [...groups.entries()]
    .map(([id, records]) => ({
      id,
      records,
      primary: choosePrimary(records)
    }))
    .filter((group): group is CaptureGroup => Boolean(group.primary))
    .sort((a, b) => b.primary.startedAtEpochMs - a.primary.startedAtEpochMs);
}

async function copyText(text: string, onNotify: (message: string) => void, label = '已复制') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.append(textArea);
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    onNotify(label);
  } catch (error) {
    onNotify(error instanceof Error ? error.message : '复制失败。');
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildCurl(capture: CaptureRecord) {
  const parts = ['curl'];
  if (capture.request.method.toUpperCase() !== 'GET') {
    parts.push(`-X ${capture.request.method.toUpperCase()}`);
  }
  for (const header of flattenHeaders(capture.request.headers)) {
    parts.push(`-H ${shellQuote(`${header.name}: ${header.value}`)}`);
  }
  if (capture.request.body?.length) {
    parts.push(`--data-raw ${shellQuote(capture.request.body)}`);
  }
  parts.push(shellQuote(capture.request.url));

  return parts.map((part, index) => (index === 0 ? part : `  ${part}`)).join(' \\\n');
}

function JsonNode({
  name,
  value,
  path,
  depth,
  parentIsArray = false,
  collapsed,
  onToggle
}: {
  name?: string | number;
  value: unknown;
  path: Array<string | number>;
  depth: number;
  parentIsArray?: boolean;
  collapsed: Set<string>;
  onToggle: (path: Array<string | number>) => void;
}) {
  const isContainer = Boolean(value) && typeof value === 'object';

  if (!isContainer) {
    return (
      <div className="json-row json-leaf" style={{ paddingLeft: depth * 16 }}>
        {name !== undefined ? <span className="json-key">{parentIsArray ? `[${name}]` : JSON.stringify(String(name))}: </span> : null}
        <span className={`json-value ${primitiveClass(value)}`}>{renderPrimitive(value)}</span>
      </div>
    );
  }

  const key = pathKey(path);
  const isCollapsed = collapsed.has(key);
  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [index, item] as const)
    : Object.entries(value as Record<string, unknown>);
  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';

  return (
    <div className="json-node">
      <div className="json-row" style={{ paddingLeft: depth * 16 }}>
        <button type="button" className="json-toggle" onClick={() => onToggle(path)} aria-label={isCollapsed ? '展开 JSON 节点' : '折叠 JSON 节点'}>
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        {name !== undefined ? <span className="json-key">{parentIsArray ? `[${name}]` : JSON.stringify(String(name))}: </span> : null}
        <span className="json-brace">{open}</span>
        <span className="json-summary">{summarizeJson(value)}</span>
        {isCollapsed ? <span className="json-brace">{close}</span> : null}
      </div>
      {!isCollapsed
        ? entries.map(([childName, child]) => (
            <JsonNode
              key={`${pathKey(path)}-${childName}`}
              name={childName}
              value={child}
              path={[...path, childName]}
              depth={depth + 1}
              parentIsArray={isArray}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))
        : null}
      {!isCollapsed ? (
        <div className="json-row json-close" style={{ paddingLeft: depth * 16 }}>
          <span className="json-brace">{close}</span>
        </div>
      ) : null}
    </div>
  );
}

function JsonTree({ value }: { value: unknown }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const expandablePaths = useMemo(() => collectExpandablePaths(value), [value]);

  useEffect(() => {
    setCollapsed(new Set());
  }, [value]);

  return (
    <div className="json-viewer">
      <div className="json-toolbar">
        <span>{summarizeJson(value)}</span>
        <button type="button" onClick={() => setCollapsed(new Set())}>
          全部展开
        </button>
        <button type="button" onClick={() => setCollapsed(new Set(expandablePaths))}>
          全部折叠
        </button>
      </div>
      <div className="json-tree">
        <JsonNode
          value={value}
          path={[]}
          depth={0}
          collapsed={collapsed}
          onToggle={(path) => {
            setCollapsed((current) => {
              const next = new Set(current);
              const key = pathKey(path);
              if (next.has(key)) {
                next.delete(key);
              } else {
                next.add(key);
              }
              return next;
            });
          }}
        />
      </div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return <pre className="code-block">{text}</pre>;
}

function CopyButton({ text, label, onNotify }: { text: string; label: string; onNotify: (message: string) => void }) {
  return (
    <button type="button" className="icon-button" title={label} onClick={() => void copyText(text, onNotify, label)}>
      <Copy size={14} />
    </button>
  );
}

function StructuredInspector({ title, value, onNotify }: StructuredInspectorProps) {
  const text = JSON.stringify(value, null, 2);
  return (
    <section className="detail-section">
      {title ? (
        <div className="section-heading">
          <h3>{title}</h3>
          <CopyButton text={text} label={`已复制${title}`} onNotify={onNotify} />
        </div>
      ) : null}
      <JsonTree value={value} />
    </section>
  );
}

function BodyInspector({ title, body, contentType, contentLength, truncated, onNotify }: BodyInspectorProps) {
  const parsedBody = useMemo(() => parseInspectableBody(body, contentType), [body, contentType]);
  const [mode, setMode] = useState<BodyMode>(parsedBody === undefined ? 'raw' : 'pretty');
  const rawText = bodyText(body);
  const copyTextValue = mode === 'pretty' && parsedBody !== undefined ? printableParsedBody(parsedBody) : rawText;

  useEffect(() => {
    setMode(parsedBody === undefined ? 'raw' : 'pretty');
  }, [body, parsedBody]);

  return (
    <section className="detail-section body-inspector">
      <div className="section-heading">
        <div>
          <h3>
            {title}
            {truncated ? <span className="truncated">已截断</span> : null}
          </h3>
          <div className="body-meta">
            <span>{contentType ?? '未知内容类型'}</span>
            <span>{measuredBodySize(body, contentLength)}</span>
            <span>{parsedBody === undefined ? '原始文本' : parsedBody.label}</span>
          </div>
        </div>
        <div className="section-actions">
          <div className="mini-segmented">
            <button type="button" className={mode === 'pretty' ? 'active' : ''} disabled={parsedBody === undefined} onClick={() => setMode('pretty')}>
              <FileJson size={14} />
              美化
            </button>
            <button type="button" className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>
              <FileText size={14} />
              原文
            </button>
          </div>
          <CopyButton text={copyTextValue} label={`已复制${title}`} onNotify={onNotify} />
        </div>
      </div>
      {mode === 'pretty' && parsedBody !== undefined ? <JsonTree value={parsedBody.value} /> : <CodeBlock text={rawText} />}
    </section>
  );
}

function HeaderTable({ title, headers, onNotify }: { title: string; headers: HeadersRecord; onNotify: (message: string) => void }) {
  const rows = flattenHeaders(headers);
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <CopyButton text={JSON.stringify(headers, null, 2)} label={`已复制${title}`} onNotify={onNotify} />
      </div>
      {rows.length === 0 ? (
        <p className="empty-text">没有头信息。</p>
      ) : (
        <div className="header-table">
          {rows.map((header) => (
            <React.Fragment key={`${title}-${header.name}`}>
              <div className="header-name">{header.name}</div>
              <div className="header-value">{header.value}</div>
              <div className="header-copy">
                <CopyButton text={`${header.name}: ${header.value}`} label={`已复制 ${header.name}`} onNotify={onNotify} />
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPill({ capture }: { capture: CaptureRecord }) {
  const status = captureStatus(capture);
  return <span className={`status-pill status-${status}`}>{statusLabel(capture)}</span>;
}

function QueryParams({ url, onNotify }: { url: string; onNotify: (message: string) => void }) {
  let params: Array<[string, string]> = [];
  try {
    params = [...new URL(url).searchParams.entries()];
  } catch {
    params = [];
  }

  if (params.length === 0) {
    return (
      <section className="detail-section">
        <h3>查询参数</h3>
        <p className="empty-text">没有查询参数。</p>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <div className="section-heading">
        <h3>查询参数</h3>
        <CopyButton text={JSON.stringify(Object.fromEntries(params), null, 2)} label="已复制查询参数" onNotify={onNotify} />
      </div>
      <div className="param-table">
        {params.map(([name, value], index) => (
          <React.Fragment key={`${name}-${index}`}>
            <div className="param-name">{name}</div>
            <div className="param-value">{value}</div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function CurlBlock({ capture, onNotify }: { capture: CaptureRecord; onNotify: (message: string) => void }) {
  const curl = useMemo(() => buildCurl(capture), [capture]);
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h3>cURL</h3>
        <CopyButton text={curl} label="已复制 cURL" onNotify={onNotify} />
      </div>
      <CodeBlock text={curl} />
    </section>
  );
}

function StageCard({ capture }: { capture: CaptureRecord }) {
  const requestJson = parseJsonString(capture.request.body);
  const responseJson = parseJsonString(capture.response?.body);
  return (
    <article className={`stage-card stage-card-${capture.stage}`}>
      <div className="stage-card-header">
        <span className={`stage-pill stage-${capture.stage}`}>{captureStageLabel(capture)}</span>
        <StatusPill capture={capture} />
        <strong>{formatDuration(capture.durationMs)}</strong>
      </div>
      <div className="stage-facts">
        <div>
          <span>请求体</span>
          <strong>{requestJson === undefined ? measuredBodySize(capture.request.body, capture.request.contentLength) : summarizeJson(requestJson)}</strong>
        </div>
        <div>
          <span>响应体</span>
          <strong>
            {responseJson === undefined ? measuredBodySize(capture.response?.body, capture.response?.contentLength) : summarizeJson(responseJson)}
          </strong>
        </div>
        <div>
          <span>内容类型</span>
          <strong>{capture.response?.contentType ?? capture.request.contentType ?? '-'}</strong>
        </div>
      </div>
      <div className="preview-pair">
        <div>
          <span>请求预览</span>
          <code>{bodyText(capture.request.body).slice(0, 260)}</code>
        </div>
        <div>
          <span>响应预览</span>
          <code>{bodyText(capture.response?.body).slice(0, 260)}</code>
        </div>
      </div>
    </article>
  );
}

function StageCompare({ group }: { group: CaptureGroup }) {
  const plain = group.records.find((capture) => capture.stage === 'plain');
  const wire = group.records.find((capture) => capture.stage === 'wire');
  const insights = [
    {
      label: '请求转换',
      value:
        plain?.request.body && wire?.request.body && plain.request.body !== wire.request.body
          ? '明文阶段和传输阶段的请求体不同。'
          : '请求体在两个阶段一致。'
    },
    {
      label: '响应转换',
      value:
        plain?.response?.body && wire?.response?.body && plain.response.body !== wire.response.body
          ? '传输阶段和明文阶段的响应体不同。'
          : '响应体在两个阶段一致。'
    },
    {
      label: '关联分组',
      value: `${group.records.length} 条阶段记录共享分组 ${group.id}。`
    }
  ];

  return (
    <div className="compare-layout">
      <section className="detail-section insight-panel">
        <h3>阶段分析</h3>
        <div className="insight-grid">
          {insights.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <div className="stage-card-grid">
        {plain ? <StageCard capture={plain} /> : <div className="missing-stage">缺少明文阶段。</div>}
        {wire ? <StageCard capture={wire} /> : <div className="missing-stage">缺少传输阶段。</div>}
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<DesktopState>(fallbackState);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [followLive, setFollowLive] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [requestListWidth, setRequestListWidth] = useState(440);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(sampleCaptures[0] ? captureGroupId(sampleCaptures[0]) : '');
  const [selectedStageKey, setSelectedStageKey] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([]);
  const [adbMessage, setAdbMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [closingApp, setClosingApp] = useState(false);

  const api = useMemo(() => resolveDesktopApi(), []);

  useEffect(() => {
    if (!api) {
      return undefined;
    }

    void api.getState().then((nextState) => {
      setState(nextState);
      if (nextState.captures[0]) {
        setSelectedGroupId(captureGroupId(nextState.captures[0]));
        setSelectedStageKey('');
      }
    });

    return api.onStateChanged((nextState) => {
      const nextGroups = groupCaptures(nextState.captures);
      setState(nextState);
      setSelectedGroupId((current) => {
        if (followLive) {
          setSelectedStageKey('');
          return nextGroups[0]?.id ?? '';
        }
        if (nextGroups.some((group) => group.id === current)) {
          return current;
        }
        setSelectedStageKey('');
        return nextGroups[0]?.id ?? '';
      });
    });
  }, [api, followLive]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX - 16, 320), Math.min(760, window.innerWidth - 520));
      setRequestListWidth(nextWidth);
    };
    const onMouseUp = () => setIsResizing(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    document.body.classList.add('is-resizing');
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.classList.remove('is-resizing');
    };
  }, [isResizing]);

  useEffect(() => onDesktopCloseRequested(() => setExitConfirmOpen(true)), []);

  const captures = state.captures.length > 0 ? state.captures : api ? [] : sampleCaptures;
  const captureGroups = useMemo(() => groupCaptures(captures), [captures]);
  const methodFilters = useMemo(
    () => ['all', ...Array.from(new Set(captureGroups.map((group) => group.primary.request.method.toUpperCase()))).sort()],
    [captureGroups]
  );

  const stats = useMemo(() => {
    const primaries = captureGroups.map((group) => group.primary);
    const completed = primaries.filter((capture) => capture.durationMs !== undefined);
    const avgDuration = completed.length
      ? completed.reduce((total, capture) => total + (capture.durationMs ?? 0), 0) / completed.length
      : undefined;
    const slowest = [...completed].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
    return {
      success: primaries.filter((capture) => captureStatus(capture) === 'success').length,
      error: primaries.filter((capture) => captureStatus(capture) === 'error').length,
      failed: primaries.filter((capture) => captureStatus(capture) === 'failed').length,
      paired: captureGroups.filter((group) => group.records.some((capture) => capture.stage === 'plain') && group.records.some((capture) => capture.stage === 'wire')).length,
      avgDuration,
      slowest
    };
  }, [captureGroups]);

  const filteredCaptures = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return captureGroups.filter((group) => {
      const matchesStatus = statusFilter === 'all' || captureStatus(group.primary) === statusFilter;
      if (!matchesStatus) {
        return false;
      }

      const matchesStage =
        stageFilter === 'all' ||
        (stageFilter === 'dual'
          ? group.records.some((capture) => capture.stage === 'plain') && group.records.some((capture) => capture.stage === 'wire')
          : group.records.some((capture) => capture.stage === stageFilter));
      if (!matchesStage) {
        return false;
      }

      if (methodFilter !== 'all' && group.primary.request.method.toUpperCase() !== methodFilter) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      const stageLabels = group.records.map(captureStageLabel).join(' ');
      const haystack = [
        group.id,
        stageLabels,
        ...group.records.flatMap((capture) => [
          capture.id,
          capture.request.method,
          capture.request.url,
          capture.request.body,
          capture.response?.body,
          capture.response?.code,
          capture.error?.message,
          capture.source?.app?.packageName,
          JSON.stringify(capture.tags ?? {})
        ])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalized);
    });
  }, [captureGroups, methodFilter, query, stageFilter, statusFilter]);

  const selectedGroup = captureGroups.find((group) => group.id === selectedGroupId) ?? filteredCaptures[0] ?? captureGroups[0];
  const selected =
    selectedGroup?.records.find((capture) => selectedStageKey && captureStageKey(capture) === selectedStageKey) ??
    selectedGroup?.primary;

  async function refreshDevices() {
    if (!api) {
      setAdbMessage('ADB 仅在桌面应用中可用。');
      return;
    }
    const result = await api.adbListDevices();
    setAdbDevices(result.devices ?? []);
    if (result.ok) {
      setAdbMessage(
        `发现 ${result.devices?.length ?? 0} 台设备。ADB：${result.adb?.version ?? result.adb?.path ?? '可用'}`
      );
    } else {
      setAdbMessage(result.error ?? result.adb?.installHint ?? result.stderr);
    }
  }

  async function reversePort(serial?: string) {
    if (!api) {
      setAdbMessage('ADB reverse 仅在桌面应用中可用。');
      return;
    }
    const result = await api.adbReverse(serial, state.server.port, state.server.devicePort);
    setAdbMessage(
      result.ok
        ? `已为 ${serial ?? '默认设备'} 映射设备 tcp:${state.server.devicePort} 到桌面 tcp:${state.server.port}。`
        : result.error ?? result.adb?.installHint ?? result.stderr
    );
  }

  async function repairUsbMappings() {
    if (!api) {
      setAdbMessage('ADB reverse 仅在桌面应用中可用。');
      return;
    }

    let devices = adbDevices;
    if (devices.length === 0) {
      const result = await api.adbListDevices();
      devices = result.devices ?? [];
      setAdbDevices(devices);
      if (!result.ok) {
        setAdbMessage(result.error ?? result.adb?.installHint ?? result.stderr);
        return;
      }
    }

    const authorized = devices.filter((device) => device.state === 'device');
    if (authorized.length === 0) {
      setAdbMessage('没有已授权的 USB 设备。请在手机上确认 USB 调试授权后再修复。');
      return;
    }

    const results = await Promise.all(
      authorized.map((device) => api.adbReverse(device.serial, state.server.port, state.server.devicePort))
    );
    const okCount = results.filter((result) => result.ok).length;
    const firstFailure = results.find((result) => !result.ok);
    setAdbMessage(
      okCount === authorized.length
        ? `已修复 ${okCount}/${authorized.length} 台设备的 USB 映射。`
        : firstFailure?.error ?? firstFailure?.stderr ?? `已修复 ${okCount}/${authorized.length} 台设备的 USB 映射。`
    );
  }

  async function clearCaptures() {
    if (!api) {
      setState(fallbackState);
      return;
    }
    const nextState = await api.clearCaptures();
    setState(nextState);
    setSelectedGroupId('');
    setSelectedStageKey('');
  }

  async function exportJson() {
    if (!api) {
      setNoticeMessage('导出仅在桌面应用中可用。');
      return;
    }
    const result = await api.exportJson();
    if (result.canceled) {
      setNoticeMessage('已取消导出。');
    } else if (result.ok) {
      setNoticeMessage(`已导出 ${result.count ?? 0} 条捕获记录。`);
    } else {
      setNoticeMessage(result.error ?? '导出失败。');
    }
  }

  async function closeApp() {
    setClosingApp(true);
    try {
      await closeTauriApp(state.server.devicePort);
    } catch (error) {
      setClosingApp(false);
      setNoticeMessage(error instanceof Error ? error.message : '关闭失败。');
    }
  }

  async function minimizeApp() {
    setExitConfirmOpen(false);
    await minimizeDesktopWindow();
  }

  const live = state.server.running && state.server.error === undefined;
  const serverLabel = state.server.starting ? '启动中' : live ? '监听中' : '离线';
  const usbReverse = state.server.usbReverse;
  const mappedUsbCount = usbReverse.devices.filter((device) => device.mapped).length;
  const authorizedUsbCount = usbReverse.devices.filter((device) => device.state === 'device').length;
  const usbStatusClass = usbReverse.active
    ? 'checking'
    : usbReverse.error
      ? 'error'
      : mappedUsbCount > 0
        ? 'ready'
        : 'idle';

  return (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
      {exitConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-confirm-title">
            <div>
              <h2 id="exit-confirm-title">关闭 OkHttp Debug Desktop？</h2>
              <p>关闭前会移除当前 USB 设备的 adb reverse 映射。选择最小化会保留监听和自动映射。</p>
            </div>
            <div className="confirm-actions">
              <button type="button" className="danger-button" disabled={closingApp} onClick={() => void closeApp()}>
                {closingApp ? '正在关闭...' : '关闭'}
              </button>
              <button type="button" disabled={closingApp} onClick={() => void minimizeApp()}>
                最小化
              </button>
              <button type="button" disabled={closingApp} onClick={() => setExitConfirmOpen(false)}>
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {drawerOpen ? <button type="button" className="drawer-backdrop" aria-label="关闭连接抽屉" onClick={() => setDrawerOpen(false)} /> : null}
      <aside className={`sidebar drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <MonitorSmartphone size={26} />
          <div>
            <h1>OkHttp Debug</h1>
            <span>桌面调试台</span>
          </div>
          <button type="button" className="drawer-close" aria-label="关闭连接抽屉" onClick={() => setDrawerOpen(false)}>
            <X size={17} />
          </button>
        </div>

        <section className="panel server-panel">
          <div className="panel-title">
            <Server size={16} />
            服务
          </div>
          <div className="server-line">
            <span className={`dot ${live ? 'dot-live' : 'dot-idle'}`} />
            <span>{serverLabel}</span>
            <strong>127.0.0.1:{state.server.port}</strong>
          </div>
          {state.server.port !== state.server.preferredPort ? (
            <p className="hint-text">
              首选端口 {state.server.preferredPort} 被占用。USB 客户端仍使用设备端口 {state.server.devicePort}。
            </p>
          ) : null}
          {state.server.error ? <p className="error-text">{state.server.error}</p> : null}
          {state.server.captureLogPath ? (
            <p className="hint-text log-path" title={state.server.captureLogPath}>
              日志 {state.server.captureLogPath}
            </p>
          ) : null}
          <div className="metric-grid">
            <div>
              <span>连接数</span>
              <strong>{state.server.connectionCount}</strong>
            </div>
            <div>
              <span>分组数</span>
              <strong>{captureGroups.length}</strong>
            </div>
            <div>
              <span>已配对</span>
              <strong>{stats.paired}</strong>
            </div>
            <div>
              <span>平均耗时</span>
              <strong>{formatDuration(stats.avgDuration)}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <Usb size={16} />
            USB
          </div>
          <div className="button-row">
            <button type="button" onClick={refreshDevices}>
              <RefreshCw size={15} />
              设备
            </button>
            <button type="button" onClick={repairUsbMappings}>
              <Cable size={15} />
              修复
            </button>
          </div>
          <div className={`usb-auto-status usb-${usbStatusClass}`}>
            <span className="dot" />
            <strong>{usbReverse.active ? '正在检查 USB 映射' : usbReverse.error ? 'USB 映射需要处理' : mappedUsbCount > 0 ? 'USB 映射正常' : '等待 USB 设备'}</strong>
            <small>{`tcp:${usbReverse.devicePort} -> tcp:${usbReverse.hostPort}`}</small>
          </div>
          <p className="hint-text">{usbReverse.message}</p>
          {usbReverse.error ? <p className="error-text">{usbReverse.error}</p> : null}
          {usbReverse.adb ? (
            <p className="hint-text">
              ADB {usbReverse.adb.available ? '可用' : '缺失'}
              {usbReverse.adb.source ? ` · 来源 ${usbReverse.adb.source}` : ''}
              {usbReverse.lastSuccessEpochMs ? ` · 最近映射 ${formatTime(usbReverse.lastSuccessEpochMs)}` : ''}
            </p>
          ) : null}
          <div className="usb-summary">
            <span>{mappedUsbCount}/{authorizedUsbCount || usbReverse.devices.length} 已映射</span>
            <span>{Math.round(usbReverse.intervalMs / 1000)} 秒自动检查</span>
          </div>
          <p className="hint-text">
            Android 连接设备端口 tcp:{state.server.devicePort}；ADB 转发到桌面端口 tcp:{state.server.port}。
          </p>
          {usbReverse.devices.length > 0 ? (
            <div className="device-list auto-device-list">
              {usbReverse.devices.map((device) => (
                <button key={`auto-${device.serial}`} type="button" onClick={() => reversePort(device.serial)}>
                  <span>{device.serial}</span>
                  <small>{device.mapped ? '已映射' : device.error ?? device.state}</small>
                </button>
              ))}
            </div>
          ) : null}
          {adbDevices.length > 0 ? (
            <div className="device-list">
              {adbDevices.map((device) => (
                <button key={device.serial} type="button" onClick={() => reversePort(device.serial)}>
                  <span>{device.serial}</span>
                  <small>{device.state}</small>
                </button>
              ))}
            </div>
          ) : null}
          {adbMessage ? <p className="hint-text">{adbMessage}</p> : null}
        </section>

        <section className="panel">
          <div className="panel-title">
            <CheckCircle2 size={16} />
            会话
          </div>
          {state.server.connections.length === 0 ? (
            <p className="empty-text">暂无 Android 客户端连接。</p>
          ) : (
            <div className="session-list">
              {state.server.connections.map((connection) => (
                <div key={connection.id} className="session-item">
                  <strong>{connection.app?.packageName ?? connection.id}</strong>
                  <span>{connection.device ? `${connection.device.manufacturer ?? ''} ${connection.device.model ?? ''}` : '等待握手'}</span>
                  <small>{connection.remoteAddress ?? '本机'} · {connection.tokenPresent ? '有 token' : '无 token'}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <main className="workspace">
        <header className="toolbar">
          <button type="button" className="drawer-trigger" onClick={() => setDrawerOpen(true)}>
            <Menu size={17} />
            连接
          </button>
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 URL、正文、标签、错误" />
          </div>
          <div className="segmented" aria-label="状态筛选">
            {(['all', 'success', 'error', 'failed'] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                className={filter === statusFilter ? 'active' : ''}
                onClick={() => setStatusFilter(filter)}
              >
                <Filter size={14} />
                {statusText(filter)}
              </button>
            ))}
          </div>
          <button type="button" className={followLive ? 'toolbar-toggle active' : 'toolbar-toggle'} onClick={() => setFollowLive((value) => !value)}>
            {followLive ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
            跟随
          </button>
          <button type="button" onClick={clearCaptures}>
            <Trash2 size={16} />
            清空
          </button>
          <button type="button" onClick={exportJson}>
            <Download size={16} />
            导出
          </button>
        </header>

        <div className="sub-toolbar">
          <div className="mini-segmented" aria-label="阶段筛选">
            {(['all', 'dual', 'plain', 'wire'] as StageFilter[]).map((filter) => (
              <button key={filter} type="button" className={filter === stageFilter ? 'active' : ''} onClick={() => setStageFilter(filter)}>
                <Columns3 size={14} />
                {stageText(filter)}
              </button>
            ))}
          </div>
          <label className="select-filter">
            方法
            <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
              {methodFilters.map((method) => (
                <option key={method} value={method}>
                  {method === 'all' ? '全部' : method}
                </option>
              ))}
            </select>
          </label>
          <div className="quick-stats">
            <span><Activity size={14} /> {stats.success} 成功</span>
            <span><AlertTriangle size={14} /> {stats.error + stats.failed} 问题</span>
            <span><Timer size={14} /> 最慢 {formatDuration(stats.slowest?.durationMs)}</span>
          </div>
        </div>

        {noticeMessage ? <div className="notice">{noticeMessage}</div> : null}

        <div className="content-grid" style={{ gridTemplateColumns: `${requestListWidth}px 8px minmax(0, 1fr)` }}>
          <section className="request-list">
            {filteredCaptures.length === 0 ? (
              <div className="empty-state">
                <ListRestart size={32} />
                <p>没有符合当前筛选条件的捕获。</p>
              </div>
            ) : (
              filteredCaptures.map((group) => {
                const capture = group.primary;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`request-row ${selectedGroup?.id === group.id ? 'selected' : ''}`}
                    onClick={() => {
                      setFollowLive(false);
                      setSelectedGroupId(group.id);
                      setSelectedStageKey('');
                      setActiveTab('overview');
                    }}
                  >
                    <div className="row-top">
                      <span className={methodClass(capture.request.method)}>{capture.request.method}</span>
                      <StatusPill capture={capture} />
                      <span className="scheme-pill">{getScheme(capture.request.url)}</span>
                      <span className="duration">{formatDuration(capture.durationMs)}</span>
                    </div>
                    <strong>{getPath(capture.request.url)}</strong>
                    <span>{getHost(capture.request.url)}</span>
                    <div className="row-bottom">
                      <small>{formatTime(capture.startedAtEpochMs)}</small>
                      <div className="stage-strip">
                        {group.records.map((record) => (
                          <span key={record.id} className={`stage-pill stage-${captureStageKey(record)}`}>
                            {captureStageLabel(record)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </section>

          <div
            className="splitter"
            role="separator"
            aria-label="调整接口列表宽度"
            aria-orientation="vertical"
            onMouseDown={() => setIsResizing(true)}
          >
            <GripVertical size={16} />
          </div>

          <section className="details">
            {selected ? (
              <>
                <div className="details-header">
                  <div>
                    <div className="details-title">
                      <span className={methodClass(selected.request.method)}>{selected.request.method}</span>
                      <h2>{getPath(selected.request.url)}</h2>
                      <StatusPill capture={selected} />
                      <span className={`stage-pill stage-${captureStageKey(selected)}`}>{captureStageLabel(selected)}</span>
                    </div>
                    <p>{selected.request.url}</p>
                  </div>
                  <div className="header-actions">
                    <CopyButton text={selected.request.url} label="已复制 URL" onNotify={setNoticeMessage} />
                    <CopyButton text={selected.groupId} label="已复制分组 ID" onNotify={setNoticeMessage} />
                    {selected.error ? <AlertTriangle className="warning-icon" size={22} /> : null}
                  </div>
                </div>

                {selectedGroup && selectedGroup.records.length > 1 ? (
                  <div className="stage-switch" aria-label="捕获阶段">
                    {selectedGroup.records.map((record) => (
                      <button
                        key={record.id}
                        type="button"
                        className={selected.id === record.id ? 'active' : ''}
                        onClick={() => setSelectedStageKey(captureStageKey(record))}
                      >
                        {captureStageLabel(record)}
                        <small>{formatDuration(record.durationMs)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}

                <nav className="tabs">
                  {(['overview', 'compare', 'headers', 'request', 'response', 'timing', 'error'] as DetailTab[]).map((tab) => (
                    <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                      {DETAIL_TAB_LABELS[tab]}
                    </button>
                  ))}
                </nav>

                <div className="tab-panel">
                  {activeTab === 'overview' ? (
                    <>
                      <div className="overview-grid">
                        <div><span>开始时间</span><strong>{new Date(selected.startedAtEpochMs).toLocaleString()}</strong></div>
                        <div><span>耗时</span><strong>{formatDuration(selected.durationMs)}</strong></div>
                        <div><span>响应</span><strong>{selected.response ? `${selected.response.code} ${selected.response.message}` : '-'}</strong></div>
                        <div><span>内容类型</span><strong>{selected.response?.contentType ?? selected.request.contentType ?? '-'}</strong></div>
                        <div><span>请求大小</span><strong>{measuredBodySize(selected.request.body, selected.request.contentLength)}</strong></div>
                        <div><span>响应大小</span><strong>{measuredBodySize(selected.response?.body, selected.response?.contentLength)}</strong></div>
                        <div><span>应用</span><strong>{selected.source?.app?.packageName ?? '-'}</strong></div>
                        <div><span>设备</span><strong>{selected.source?.device ? `${selected.source.device.manufacturer ?? ''} ${selected.source.device.model ?? ''}` : '-'}</strong></div>
                        <div><span>阶段</span><strong>{captureStageLabel(selected)}</strong></div>
                        <div><span>分组</span><strong>{selected.groupId}</strong></div>
                      </div>
                      <QueryParams url={selected.request.url} onNotify={setNoticeMessage} />
                      <CurlBlock capture={selected} onNotify={setNoticeMessage} />
                      <StructuredInspector title="标签" value={selected.tags ?? {}} onNotify={setNoticeMessage} />
                    </>
                  ) : null}

                  {activeTab === 'compare' && selectedGroup ? <StageCompare group={selectedGroup} /> : null}

                  {activeTab === 'headers' ? (
                    <>
                      <HeaderTable title="请求头" headers={selected.request.headers} onNotify={setNoticeMessage} />
                      {selected.response ? <HeaderTable title="响应头" headers={selected.response.headers} onNotify={setNoticeMessage} /> : null}
                    </>
                  ) : null}

                  {activeTab === 'request' ? (
                    <BodyInspector
                      title="请求体"
                      body={selected.request.body}
                      contentType={selected.request.contentType}
                      contentLength={selected.request.contentLength}
                      truncated={selected.request.bodyTruncated}
                      onNotify={setNoticeMessage}
                    />
                  ) : null}

                  {activeTab === 'response' ? (
                    <BodyInspector
                      title="响应体"
                      body={selected.response?.body}
                      contentType={selected.response?.contentType}
                      contentLength={selected.response?.contentLength}
                      truncated={selected.response?.bodyTruncated}
                      onNotify={setNoticeMessage}
                    />
                  ) : null}

                  {activeTab === 'timing' ? (
                    <StructuredInspector title="耗时" value={selected.timing ?? {}} onNotify={setNoticeMessage} />
                  ) : null}

                  {activeTab === 'error' ? (
                    <section className="detail-section">
                      <div className="section-heading">
                        <h3>错误</h3>
                        {selected.error ? (
                          <CopyButton text={JSON.stringify(selected.error, null, 2)} label="已复制错误" onNotify={setNoticeMessage} />
                        ) : null}
                      </div>
                      {selected.error ? <JsonTree value={selected.error} /> : <p className="empty-text">没有捕获到错误。</p>}
                    </section>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <ClipboardList size={36} />
                <p>等待 OkHttp 捕获数据。</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
