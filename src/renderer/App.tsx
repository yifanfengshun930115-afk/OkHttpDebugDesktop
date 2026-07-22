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
  ListRestart,
  MonitorSmartphone,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Server,
  Timer,
  Trash2,
  Usb
} from 'lucide-react';
import type { AdbDevice, CaptureRecord, DesktopState, HeadersRecord } from '../shared/protocol.js';
import { DEFAULT_WS_PORT, DEFAULT_WS_PORT_RANGE_END } from '../shared/protocol.js';
import { sampleCaptures } from './sampleCaptures.js';
import './styles.css';

type DetailTab = 'overview' | 'compare' | 'headers' | 'request' | 'response' | 'timing' | 'error';
type StatusFilter = 'all' | 'success' | 'error' | 'failed';
type StageFilter = 'all' | 'plain' | 'wire' | 'dual';
type BodyMode = 'pretty' | 'raw';

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
      message: 'USB auto reverse is ready.'
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
    return 'ERR';
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
  return `${body.length.toLocaleString()} chars`;
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

function parseJsonString(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function summarizeJson(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (value && typeof value === 'object') {
    const count = Object.keys(value).length;
    return `${count} key${count === 1 ? '' : 's'}`;
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
    return 'All';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function stageText(stage: StageFilter) {
  if (stage === 'all') {
    return 'All stages';
  }
  if (stage === 'dual') {
    return 'Paired';
  }
  return stage === 'plain' ? 'Plain' : 'Wire';
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
    return 'Plain';
  }
  if (stage === 'wire') {
    return 'Wire';
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

async function copyText(text: string, onNotify: (message: string) => void, label = 'Copied') {
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
    onNotify(error instanceof Error ? error.message : 'Copy failed.');
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
        <button type="button" className="json-toggle" onClick={() => onToggle(path)} aria-label={isCollapsed ? 'Expand JSON node' : 'Collapse JSON node'}>
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
          Expand all
        </button>
        <button type="button" onClick={() => setCollapsed(new Set(expandablePaths))}>
          Collapse all
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
          <CopyButton text={text} label={`Copied ${title}`} onNotify={onNotify} />
        </div>
      ) : null}
      <JsonTree value={value} />
    </section>
  );
}

function BodyInspector({ title, body, contentType, contentLength, truncated, onNotify }: BodyInspectorProps) {
  const parsedJson = useMemo(() => parseJsonString(body), [body]);
  const [mode, setMode] = useState<BodyMode>(parsedJson === undefined ? 'raw' : 'pretty');
  const rawText = bodyText(body);

  useEffect(() => {
    setMode(parsedJson === undefined ? 'raw' : 'pretty');
  }, [body, parsedJson]);

  return (
    <section className="detail-section body-inspector">
      <div className="section-heading">
        <div>
          <h3>
            {title}
            {truncated ? <span className="truncated">truncated</span> : null}
          </h3>
          <div className="body-meta">
            <span>{contentType ?? 'unknown content type'}</span>
            <span>{measuredBodySize(body, contentLength)}</span>
            <span>{parsedJson === undefined ? 'text/raw' : 'json parsed'}</span>
          </div>
        </div>
        <div className="section-actions">
          <div className="mini-segmented">
            <button type="button" className={mode === 'pretty' ? 'active' : ''} disabled={parsedJson === undefined} onClick={() => setMode('pretty')}>
              <FileJson size={14} />
              Pretty
            </button>
            <button type="button" className={mode === 'raw' ? 'active' : ''} onClick={() => setMode('raw')}>
              <FileText size={14} />
              Raw
            </button>
          </div>
          <CopyButton text={rawText} label={`Copied ${title}`} onNotify={onNotify} />
        </div>
      </div>
      {mode === 'pretty' && parsedJson !== undefined ? <JsonTree value={parsedJson} /> : <CodeBlock text={rawText} />}
    </section>
  );
}

function HeaderTable({ title, headers, onNotify }: { title: string; headers: HeadersRecord; onNotify: (message: string) => void }) {
  const rows = flattenHeaders(headers);
  return (
    <section className="detail-section">
      <div className="section-heading">
        <h3>{title}</h3>
        <CopyButton text={JSON.stringify(headers, null, 2)} label={`Copied ${title}`} onNotify={onNotify} />
      </div>
      {rows.length === 0 ? (
        <p className="empty-text">No headers.</p>
      ) : (
        <div className="header-table">
          {rows.map((header) => (
            <React.Fragment key={`${title}-${header.name}`}>
              <div className="header-name">{header.name}</div>
              <div className="header-value">{header.value}</div>
              <div className="header-copy">
                <CopyButton text={`${header.name}: ${header.value}`} label={`Copied ${header.name}`} onNotify={onNotify} />
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
        <h3>Query Parameters</h3>
        <p className="empty-text">No query parameters.</p>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <div className="section-heading">
        <h3>Query Parameters</h3>
        <CopyButton text={JSON.stringify(Object.fromEntries(params), null, 2)} label="Copied query parameters" onNotify={onNotify} />
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
        <CopyButton text={curl} label="Copied cURL" onNotify={onNotify} />
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
          <span>Request Body</span>
          <strong>{requestJson === undefined ? measuredBodySize(capture.request.body, capture.request.contentLength) : summarizeJson(requestJson)}</strong>
        </div>
        <div>
          <span>Response Body</span>
          <strong>
            {responseJson === undefined ? measuredBodySize(capture.response?.body, capture.response?.contentLength) : summarizeJson(responseJson)}
          </strong>
        </div>
        <div>
          <span>Content Type</span>
          <strong>{capture.response?.contentType ?? capture.request.contentType ?? '-'}</strong>
        </div>
      </div>
      <div className="preview-pair">
        <div>
          <span>Request preview</span>
          <code>{bodyText(capture.request.body).slice(0, 260)}</code>
        </div>
        <div>
          <span>Response preview</span>
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
      label: 'Request transform',
      value:
        plain?.request.body && wire?.request.body && plain.request.body !== wire.request.body
          ? 'Different bodies captured before and after app interceptors.'
          : 'Request body is unchanged across stages.'
    },
    {
      label: 'Response transform',
      value:
        plain?.response?.body && wire?.response?.body && plain.response.body !== wire.response.body
          ? 'Response body differs between wire and plain views.'
          : 'Response body is unchanged across stages.'
    },
    {
      label: 'Correlation',
      value: `${group.records.length} stage record${group.records.length === 1 ? '' : 's'} share group ${group.id}.`
    }
  ];

  return (
    <div className="compare-layout">
      <section className="detail-section insight-panel">
        <h3>Stage Insights</h3>
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
        {plain ? <StageCard capture={plain} /> : <div className="missing-stage">Plain stage missing.</div>}
        {wire ? <StageCard capture={wire} /> : <div className="missing-stage">Wire stage missing.</div>}
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
  const [selectedGroupId, setSelectedGroupId] = useState<string>(sampleCaptures[0] ? captureGroupId(sampleCaptures[0]) : '');
  const [selectedStageKey, setSelectedStageKey] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([]);
  const [adbMessage, setAdbMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');

  const api = window.okhttpDebug;

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
      setAdbMessage('ADB is available only in the Electron app.');
      return;
    }
    const result = await api.adbListDevices();
    setAdbDevices(result.devices ?? []);
    if (result.ok) {
      setAdbMessage(
        `Found ${result.devices?.length ?? 0} device(s). ADB: ${result.adb?.version ?? result.adb?.path ?? 'available'}`
      );
    } else {
      setAdbMessage(result.error ?? result.adb?.installHint ?? result.stderr);
    }
  }

  async function reversePort(serial?: string) {
    if (!api) {
      setAdbMessage('ADB reverse is available only in the Electron app.');
      return;
    }
    const result = await api.adbReverse(serial, state.server.port, state.server.devicePort);
    setAdbMessage(
      result.ok
        ? `Mapped device tcp:${state.server.devicePort} to desktop tcp:${state.server.port} for ${serial ?? 'default device'}.`
        : result.error ?? result.adb?.installHint ?? result.stderr
    );
  }

  async function repairUsbMappings() {
    if (!api) {
      setAdbMessage('ADB reverse is available only in the Electron app.');
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
      setAdbMessage('No authorized USB devices. Confirm the Android USB debugging prompt, then repair again.');
      return;
    }

    const results = await Promise.all(
      authorized.map((device) => api.adbReverse(device.serial, state.server.port, state.server.devicePort))
    );
    const okCount = results.filter((result) => result.ok).length;
    const firstFailure = results.find((result) => !result.ok);
    setAdbMessage(
      okCount === authorized.length
        ? `Repaired USB reverse for ${okCount}/${authorized.length} device(s).`
        : firstFailure?.error ?? firstFailure?.stderr ?? `Repaired USB reverse for ${okCount}/${authorized.length} device(s).`
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
      setNoticeMessage('Export is available only in the Electron app.');
      return;
    }
    const result = await api.exportJson();
    if (result.canceled) {
      setNoticeMessage('Export canceled.');
    } else if (result.ok) {
      setNoticeMessage(`Exported ${result.count ?? 0} capture(s).`);
    } else {
      setNoticeMessage(result.error ?? 'Export failed.');
    }
  }

  const live = state.server.running && state.server.error === undefined;
  const serverLabel = state.server.starting ? 'Starting' : live ? 'Listening' : 'Offline';
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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <MonitorSmartphone size={26} />
          <div>
            <h1>OkHttp Debug</h1>
            <span>Desktop Console</span>
          </div>
        </div>

        <section className="panel server-panel">
          <div className="panel-title">
            <Server size={16} />
            Server
          </div>
          <div className="server-line">
            <span className={`dot ${live ? 'dot-live' : 'dot-idle'}`} />
            <span>{serverLabel}</span>
            <strong>127.0.0.1:{state.server.port}</strong>
          </div>
          {state.server.port !== state.server.preferredPort ? (
            <p className="hint-text">
              Preferred port {state.server.preferredPort} was busy. USB clients still use device port {state.server.devicePort}.
            </p>
          ) : null}
          {state.server.error ? <p className="error-text">{state.server.error}</p> : null}
          {state.server.captureLogPath ? (
            <p className="hint-text log-path" title={state.server.captureLogPath}>
              Log {state.server.captureLogPath}
            </p>
          ) : null}
          <div className="metric-grid">
            <div>
              <span>Connections</span>
              <strong>{state.server.connectionCount}</strong>
            </div>
            <div>
              <span>Groups</span>
              <strong>{captureGroups.length}</strong>
            </div>
            <div>
              <span>Paired</span>
              <strong>{stats.paired}</strong>
            </div>
            <div>
              <span>Avg Time</span>
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
              Devices
            </button>
            <button type="button" onClick={repairUsbMappings}>
              <Cable size={15} />
              Repair
            </button>
          </div>
          <div className={`usb-auto-status usb-${usbStatusClass}`}>
            <span className="dot" />
            <strong>{usbReverse.active ? 'Checking USB mapping' : usbReverse.error ? 'USB mapping needs attention' : mappedUsbCount > 0 ? 'USB mapping ready' : 'Waiting for USB device'}</strong>
            <small>{`tcp:${usbReverse.devicePort} -> tcp:${usbReverse.hostPort}`}</small>
          </div>
          <p className="hint-text">{usbReverse.message}</p>
          {usbReverse.error ? <p className="error-text">{usbReverse.error}</p> : null}
          {usbReverse.adb ? (
            <p className="hint-text">
              ADB {usbReverse.adb.available ? 'available' : 'missing'}
              {usbReverse.adb.source ? ` via ${usbReverse.adb.source}` : ''}
              {usbReverse.lastSuccessEpochMs ? ` · last mapped ${formatTime(usbReverse.lastSuccessEpochMs)}` : ''}
            </p>
          ) : null}
          <div className="usb-summary">
            <span>{mappedUsbCount}/{authorizedUsbCount || usbReverse.devices.length} mapped</span>
            <span>{Math.round(usbReverse.intervalMs / 1000)}s auto check</span>
          </div>
          <p className="hint-text">
            Android connects to tcp:{state.server.devicePort}; ADB forwards it to desktop tcp:{state.server.port}.
          </p>
          {usbReverse.devices.length > 0 ? (
            <div className="device-list auto-device-list">
              {usbReverse.devices.map((device) => (
                <button key={`auto-${device.serial}`} type="button" onClick={() => reversePort(device.serial)}>
                  <span>{device.serial}</span>
                  <small>{device.mapped ? 'mapped' : device.error ?? device.state}</small>
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
            Sessions
          </div>
          {state.server.connections.length === 0 ? (
            <p className="empty-text">No Android client connected.</p>
          ) : (
            <div className="session-list">
              {state.server.connections.map((connection) => (
                <div key={connection.id} className="session-item">
                  <strong>{connection.app?.packageName ?? connection.id}</strong>
                  <span>{connection.device ? `${connection.device.manufacturer ?? ''} ${connection.device.model ?? ''}` : 'Waiting for hello'}</span>
                  <small>{connection.remoteAddress ?? 'local'} · {connection.tokenPresent ? 'token' : 'no token'}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <main className="workspace">
        <header className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL, body, tag, error" />
          </div>
          <div className="segmented" aria-label="Status filter">
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
            Follow
          </button>
          <button type="button" onClick={clearCaptures}>
            <Trash2 size={16} />
            Clear
          </button>
          <button type="button" onClick={exportJson}>
            <Download size={16} />
            Export
          </button>
        </header>

        <div className="sub-toolbar">
          <div className="mini-segmented" aria-label="Stage filter">
            {(['all', 'dual', 'plain', 'wire'] as StageFilter[]).map((filter) => (
              <button key={filter} type="button" className={filter === stageFilter ? 'active' : ''} onClick={() => setStageFilter(filter)}>
                <Columns3 size={14} />
                {stageText(filter)}
              </button>
            ))}
          </div>
          <label className="select-filter">
            Method
            <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
              {methodFilters.map((method) => (
                <option key={method} value={method}>
                  {method === 'all' ? 'All' : method}
                </option>
              ))}
            </select>
          </label>
          <div className="quick-stats">
            <span><Activity size={14} /> {stats.success} success</span>
            <span><AlertTriangle size={14} /> {stats.error + stats.failed} issues</span>
            <span><Timer size={14} /> Slowest {formatDuration(stats.slowest?.durationMs)}</span>
          </div>
        </div>

        {noticeMessage ? <div className="notice">{noticeMessage}</div> : null}

        <div className="content-grid">
          <section className="request-list">
            {filteredCaptures.length === 0 ? (
              <div className="empty-state">
                <ListRestart size={32} />
                <p>No captures match the current filter.</p>
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
                    <CopyButton text={selected.request.url} label="Copied URL" onNotify={setNoticeMessage} />
                    <CopyButton text={selected.groupId} label="Copied group id" onNotify={setNoticeMessage} />
                    {selected.error ? <AlertTriangle className="warning-icon" size={22} /> : null}
                  </div>
                </div>

                {selectedGroup && selectedGroup.records.length > 1 ? (
                  <div className="stage-switch" aria-label="Capture stage">
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
                      {tab}
                    </button>
                  ))}
                </nav>

                <div className="tab-panel">
                  {activeTab === 'overview' ? (
                    <>
                      <div className="overview-grid">
                        <div><span>Started</span><strong>{new Date(selected.startedAtEpochMs).toLocaleString()}</strong></div>
                        <div><span>Duration</span><strong>{formatDuration(selected.durationMs)}</strong></div>
                        <div><span>Response</span><strong>{selected.response ? `${selected.response.code} ${selected.response.message}` : '-'}</strong></div>
                        <div><span>Content Type</span><strong>{selected.response?.contentType ?? selected.request.contentType ?? '-'}</strong></div>
                        <div><span>Request Size</span><strong>{measuredBodySize(selected.request.body, selected.request.contentLength)}</strong></div>
                        <div><span>Response Size</span><strong>{measuredBodySize(selected.response?.body, selected.response?.contentLength)}</strong></div>
                        <div><span>App</span><strong>{selected.source?.app?.packageName ?? '-'}</strong></div>
                        <div><span>Device</span><strong>{selected.source?.device ? `${selected.source.device.manufacturer ?? ''} ${selected.source.device.model ?? ''}` : '-'}</strong></div>
                        <div><span>Stage</span><strong>{captureStageLabel(selected)}</strong></div>
                        <div><span>Group</span><strong>{selected.groupId}</strong></div>
                      </div>
                      <QueryParams url={selected.request.url} onNotify={setNoticeMessage} />
                      <CurlBlock capture={selected} onNotify={setNoticeMessage} />
                      <StructuredInspector title="Tags" value={selected.tags ?? {}} onNotify={setNoticeMessage} />
                    </>
                  ) : null}

                  {activeTab === 'compare' && selectedGroup ? <StageCompare group={selectedGroup} /> : null}

                  {activeTab === 'headers' ? (
                    <>
                      <HeaderTable title="Request Headers" headers={selected.request.headers} onNotify={setNoticeMessage} />
                      {selected.response ? <HeaderTable title="Response Headers" headers={selected.response.headers} onNotify={setNoticeMessage} /> : null}
                    </>
                  ) : null}

                  {activeTab === 'request' ? (
                    <BodyInspector
                      title="Request Body"
                      body={selected.request.body}
                      contentType={selected.request.contentType}
                      contentLength={selected.request.contentLength}
                      truncated={selected.request.bodyTruncated}
                      onNotify={setNoticeMessage}
                    />
                  ) : null}

                  {activeTab === 'response' ? (
                    <BodyInspector
                      title="Response Body"
                      body={selected.response?.body}
                      contentType={selected.response?.contentType}
                      contentLength={selected.response?.contentLength}
                      truncated={selected.response?.bodyTruncated}
                      onNotify={setNoticeMessage}
                    />
                  ) : null}

                  {activeTab === 'timing' ? (
                    <StructuredInspector title="Timing" value={selected.timing ?? {}} onNotify={setNoticeMessage} />
                  ) : null}

                  {activeTab === 'error' ? (
                    <section className="detail-section">
                      <div className="section-heading">
                        <h3>Error</h3>
                        {selected.error ? (
                          <CopyButton text={JSON.stringify(selected.error, null, 2)} label="Copied error" onNotify={setNoticeMessage} />
                        ) : null}
                      </div>
                      {selected.error ? <JsonTree value={selected.error} /> : <p className="empty-text">No error captured.</p>}
                    </section>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <ClipboardList size={36} />
                <p>Waiting for OkHttp captures.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
