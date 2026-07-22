import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  Download,
  Filter,
  ListRestart,
  MonitorSmartphone,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Usb
} from 'lucide-react';
import type { AdbDevice, CaptureRecord, DesktopState, HeadersRecord } from '../shared/protocol.js';
import { DEFAULT_WS_PORT, DEFAULT_WS_PORT_RANGE_END } from '../shared/protocol.js';
import { sampleCaptures } from './sampleCaptures.js';
import './styles.css';

type DetailTab = 'overview' | 'headers' | 'request' | 'response' | 'timing' | 'error';
type StatusFilter = 'all' | 'success' | 'error' | 'failed';

interface CaptureGroup {
  id: string;
  primary: CaptureRecord;
  records: CaptureRecord[];
}

const fallbackState: DesktopState = {
  server: {
    port: DEFAULT_WS_PORT,
    preferredPort: DEFAULT_WS_PORT,
    devicePort: DEFAULT_WS_PORT,
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

function flattenHeaders(headers: HeadersRecord) {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: Array.isArray(value) ? value.join(', ') : value
  }));
}

function bodyText(value?: string) {
  return value?.trim() ? value : '(empty)';
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="code-block">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}

function HeaderTable({ title, headers }: { title: string; headers: HeadersRecord }) {
  const rows = flattenHeaders(headers);
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="empty-text">No headers.</p>
      ) : (
        <div className="header-table">
          {rows.map((header) => (
            <React.Fragment key={`${title}-${header.name}`}>
              <div className="header-name">{header.name}</div>
              <div className="header-value">{header.value}</div>
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

function captureGroupId(capture: CaptureRecord) {
  return capture.groupId ?? capture.id;
}

function captureStageKey(capture: CaptureRecord) {
  return capture.stage ?? 'single';
}

function captureStageLabel(capture: CaptureRecord) {
  const stage = captureStageKey(capture);
  if (stage === 'plain') {
    return 'Plain';
  }
  if (stage === 'wire') {
    return 'Wire';
  }
  if (stage === 'single') {
    return 'Capture';
  }
  return stage;
}

function choosePrimary(records: CaptureRecord[]) {
  return (
    records.find((capture) => capture.stage === 'plain') ??
    records.find((capture) => capture.stage === undefined) ??
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

function App() {
  const [state, setState] = useState<DesktopState>(fallbackState);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(sampleCaptures[0] ? captureGroupId(sampleCaptures[0]) : '');
  const [selectedStageKey, setSelectedStageKey] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [adbDevices, setAdbDevices] = useState<AdbDevice[]>([]);
  const [adbMessage, setAdbMessage] = useState('');
  const [exportMessage, setExportMessage] = useState('');

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
      setState(nextState);
      setSelectedGroupId((current) => {
        if (nextState.captures.some((capture) => captureGroupId(capture) === current)) {
          return current;
        }
        setSelectedStageKey('');
        return nextState.captures[0] ? captureGroupId(nextState.captures[0]) : '';
      });
    });
  }, [api]);

  const captures = state.captures.length > 0 ? state.captures : sampleCaptures;
  const captureGroups = useMemo(() => groupCaptures(captures), [captures]);

  const filteredCaptures = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return captureGroups.filter((group) => {
      const matchesStatus = statusFilter === 'all' || captureStatus(group.primary) === statusFilter;
      if (!matchesStatus) {
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
  }, [captureGroups, query, statusFilter]);

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

  async function clearCaptures() {
    if (!api) {
      setState(fallbackState);
      return;
    }
    const nextState = await api.clearCaptures();
    setState(nextState);
  }

  async function exportJson() {
    if (!api) {
      setExportMessage('Export is available only in the Electron app.');
      return;
    }
    const result = await api.exportJson();
    if (result.canceled) {
      setExportMessage('Export canceled.');
    } else if (result.ok) {
      setExportMessage(`Exported ${result.count ?? 0} capture(s).`);
    } else {
      setExportMessage(result.error ?? 'Export failed.');
    }
  }

  const live = state.server.running && state.server.error === undefined;
  const serverLabel = state.server.starting ? 'Starting' : live ? 'Listening' : 'Offline';

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

        <section className="panel">
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
              <span>Stages</span>
              <strong>{captures.length}</strong>
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
            <button type="button" onClick={() => reversePort(adbDevices[0]?.serial)}>
              <Cable size={15} />
              Reverse
            </button>
          </div>
          <p className="hint-text">
            USB mapping keeps Android on tcp:{state.server.devicePort} and forwards to desktop tcp:{state.server.port}.
          </p>
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URL, method, tag, error" />
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
                {filter}
              </button>
            ))}
          </div>
          <button type="button" onClick={clearCaptures}>
            <Trash2 size={16} />
            Clear
          </button>
          <button type="button" onClick={exportJson}>
            <Download size={16} />
            Export
          </button>
        </header>
        {exportMessage ? <div className="notice">{exportMessage}</div> : null}

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
                    setSelectedGroupId(group.id);
                    setSelectedStageKey('');
                    setActiveTab('overview');
                  }}
                >
                  <div className="row-top">
                    <span className={methodClass(capture.request.method)}>{capture.request.method}</span>
                    <StatusPill capture={capture} />
                    {group.records.map((record) => (
                      <span key={record.id} className={`stage-pill stage-${captureStageKey(record)}`}>
                        {captureStageLabel(record)}
                      </span>
                    ))}
                    <span className="duration">{formatDuration(capture.durationMs)}</span>
                  </div>
                  <strong>{getPath(capture.request.url)}</strong>
                  <span>{getHost(capture.request.url)}</span>
                  <small>{formatTime(capture.startedAtEpochMs)}</small>
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
                  {selected.error ? <AlertTriangle className="warning-icon" size={22} /> : null}
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
                      </button>
                    ))}
                  </div>
                ) : null}

                <nav className="tabs">
                  {(['overview', 'headers', 'request', 'response', 'timing', 'error'] as DetailTab[]).map((tab) => (
                    <button key={tab} type="button" className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                      {tab}
                    </button>
                  ))}
                </nav>

                <div className="tab-panel">
                  {activeTab === 'overview' ? (
                    <div className="overview-grid">
                      <div><span>Started</span><strong>{new Date(selected.startedAtEpochMs).toLocaleString()}</strong></div>
                      <div><span>Duration</span><strong>{formatDuration(selected.durationMs)}</strong></div>
                      <div><span>Response</span><strong>{selected.response ? `${selected.response.code} ${selected.response.message}` : '-'}</strong></div>
                      <div><span>Content Type</span><strong>{selected.response?.contentType ?? selected.request.contentType ?? '-'}</strong></div>
                      <div><span>App</span><strong>{selected.source?.app?.packageName ?? '-'}</strong></div>
                      <div><span>Device</span><strong>{selected.source?.device ? `${selected.source.device.manufacturer ?? ''} ${selected.source.device.model ?? ''}` : '-'}</strong></div>
                      <div><span>Stage</span><strong>{captureStageLabel(selected)}</strong></div>
                      <div><span>Group</span><strong>{selected.groupId ?? selected.id}</strong></div>
                      <div className="wide"><span>Tags</span><JsonBlock value={selected.tags ?? {}} /></div>
                    </div>
                  ) : null}

                  {activeTab === 'headers' ? (
                    <>
                      <HeaderTable title="Request Headers" headers={selected.request.headers} />
                      {selected.response ? <HeaderTable title="Response Headers" headers={selected.response.headers} /> : null}
                    </>
                  ) : null}

                  {activeTab === 'request' ? (
                    <section className="detail-section">
                      <h3>Request Body {selected.request.bodyTruncated ? <span className="truncated">truncated</span> : null}</h3>
                      <JsonBlock value={bodyText(selected.request.body)} />
                    </section>
                  ) : null}

                  {activeTab === 'response' ? (
                    <section className="detail-section">
                      <h3>Response Body {selected.response?.bodyTruncated ? <span className="truncated">truncated</span> : null}</h3>
                      <JsonBlock value={bodyText(selected.response?.body)} />
                    </section>
                  ) : null}

                  {activeTab === 'timing' ? (
                    <section className="detail-section">
                      <h3>Timing</h3>
                      <JsonBlock value={selected.timing ?? {}} />
                    </section>
                  ) : null}

                  {activeTab === 'error' ? (
                    <section className="detail-section">
                      <h3>Error</h3>
                      {selected.error ? <JsonBlock value={selected.error} /> : <p className="empty-text">No error captured.</p>}
                    </section>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <ListRestart size={36} />
                <p>Select a capture to inspect it.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
