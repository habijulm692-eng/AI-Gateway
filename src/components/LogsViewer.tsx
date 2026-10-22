import React, { useState, useEffect } from 'react';
import {
  ScrollText,
  Filter,
  Search,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Repeat,
  Sparkles,
  Info,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { AIProvider, GatewayLog } from '../types/gateway';
import { clearAllLogs, trigger7DayCleanup } from '../services/api';

interface LogsViewerProps {
  logs: GatewayLog[];
  providers: AIProvider[];
  onRefresh: () => void;
  selectedLog: GatewayLog | null;
  setSelectedLog: (log: GatewayLog | null) => void;
}

export const LogsViewer: React.FC<LogsViewerProps> = ({
  logs,
  providers,
  onRefresh,
  selectedLog,
  setSelectedLog,
}) => {
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      onRefresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, onRefresh]);

  const handleClear = async () => {
    if (confirm('Clear all gateway logs?')) {
      await clearAllLogs();
      onRefresh();
    }
  };

  const handleTriggerCleanup = async () => {
    setIsCleaning(true);
    setCleanupMessage(null);
    try {
      const res = await trigger7DayCleanup();
      setCleanupMessage(res.message);
      onRefresh();
      setTimeout(() => setCleanupMessage(null), 5000);
    } catch (err: any) {
      setCleanupMessage(`Cleanup failed: ${err.message}`);
    } finally {
      setIsCleaning(false);
    }
  };

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (statusFilter === 'success' && log.status !== 'success') return false;
    if (statusFilter === 'failure' && log.status !== 'failure') return false;
    if (statusFilter === '429' && log.statusCode !== 429) return false;
    if (statusFilter === 'fallback' && !log.wasFallback) return false;
    if (providerFilter !== 'all' && log.providerId !== providerFilter) return false;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchModel = log.model?.toLowerCase().includes(query);
      const matchProvider = log.providerName?.toLowerCase().includes(query);
      const matchError = log.errorMessage?.toLowerCase().includes(query);
      if (!matchModel && !matchProvider && !matchError) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-cyan-400" />
            <span>Gateway Traffic & Telemetry Logs</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time streaming inspection with latency profiling, error diagnostics, and 7-day auto cleanup.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-colors ${
              autoRefresh
                ? 'bg-emerald-950/70 border-emerald-800 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
            <span>{autoRefresh ? 'Live (4s)' : 'Paused'}</span>
          </button>

          <button
            onClick={handleTriggerCleanup}
            disabled={isCleaning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
            title="Purge logs older than 7 days from Firebase Realtime DB"
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>{isCleaning ? 'Cleaning...' : 'Run 7-Day Purge'}</span>
          </button>

          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-900 transition-colors"
            title="Clear all logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {cleanupMessage && (
        <div className="p-3 bg-cyan-950/60 border border-cyan-800 text-cyan-300 rounded-xl text-xs flex items-center justify-between">
          <span>{cleanupMessage}</span>
          <button onClick={() => setCleanupMessage(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            {['all', 'success', 'failure', '429', 'fallback'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-slate-800 text-white font-medium shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s === '429' ? 'Rate Limit (429)' : s}
              </button>
            ))}
          </div>

          {/* Provider Filter */}
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search model, error, provider..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            <ScrollText className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
            No logs matching the current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-semibold">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Model</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Latency</th>
                  <th className="py-3 px-4">Routing</th>
                  <th className="py-3 px-4">Tokens</th>
                  <th className="py-3 px-4 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-4 font-sans font-medium text-slate-200">
                      {log.providerName}
                    </td>
                    <td className="py-3 px-4 text-cyan-400">
                      {log.model}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'success'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : log.statusCode === 429
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                            : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                        }`}
                      >
                        {log.statusCode} {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          log.latencyMs < 600
                            ? 'text-emerald-400'
                            : log.latencyMs < 1500
                            ? 'text-amber-400'
                            : 'text-orange-400'
                        }`}
                      >
                        {log.latencyMs} ms
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans">
                      {log.wasFallback ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800">
                          <Repeat className="w-2.5 h-2.5" />
                          <span>Fallback</span>
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Direct</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {log.totalTokens ? `${log.totalTokens} tok` : log.stream ? 'SSE stream' : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspect Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Log Diagnostic Inspector</h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Quick Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Status Code</span>
                <span className="font-mono font-bold text-white text-sm">
                  {selectedLog.statusCode} ({selectedLog.status})
                </span>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Roundtrip Latency</span>
                <span className="font-mono font-bold text-cyan-400 text-sm">
                  {selectedLog.latencyMs} ms
                </span>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Provider</span>
                <span className="font-bold text-white truncate block">
                  {selectedLog.providerName}
                </span>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-slate-500 block">Fallback Activated</span>
                <span className={`font-bold ${selectedLog.wasFallback ? 'text-amber-400' : 'text-slate-400'}`}>
                  {selectedLog.wasFallback ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Error Message banner if failed */}
            {selectedLog.errorMessage && (
              <div className="p-3 bg-rose-950/70 border border-rose-800 rounded-xl space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Failure Reason / Upstream Rejection</span>
                </div>
                <div className="text-xs font-mono text-rose-200 break-all">
                  {selectedLog.errorMessage}
                </div>
              </div>
            )}

            {/* Metadata & Raw Details */}
            <div className="space-y-2 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                Raw Telemetry Payload
              </div>
              <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-slate-300 text-xs overflow-x-auto max-h-60">
                {JSON.stringify(selectedLog, null, 2)}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
