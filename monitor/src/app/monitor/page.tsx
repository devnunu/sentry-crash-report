'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatKST, formatRelativeTime } from '@/lib/utils';
import type { MonitorSession, Platform, MonitorHistory } from '@/lib/types';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface MonitorWithHistory extends MonitorSession {
  lastHistory?: MonitorHistory;
}

interface StatusData {
  monitors: MonitorWithHistory[];
  total: number;
  active: number;
  stopped: number;
  expired: number;
}

// 상태별 스타일
const getStatusStyle = (status: string) => {
  switch (status) {
    case 'active':
      return { color: 'var(--ok)', backgroundColor: 'rgba(34, 197, 94, 0.1)' };
    case 'stopped':
      return { color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.1)' };
    case 'expired':
      return { color: 'var(--muted)', backgroundColor: 'rgba(154, 164, 178, 0.1)' };
    default:
      return { color: 'var(--muted)', backgroundColor: 'rgba(154, 164, 178, 0.1)' };
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'active': return '🟢 활성';
    case 'stopped': return '🔴 중단됨';
    case 'expired': return '⚫ 만료됨';
    default: return status;
  }
};


const thStyle: React.CSSProperties = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '12px',
  letterSpacing: '0.2px',
  background: '#0f1524',
  color: 'var(--muted)',
  borderBottom: '1px solid var(--border)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: '13px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--border)',
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  wordBreak: 'break-all',
};

export default function MonitorPage() {
  // 상태 관리
  const [monitors, setMonitors] = useState<MonitorWithHistory[]>([]);
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  
  // 새 모니터링 폼
  const [platform, setPlatform] = useState<Platform>('android');
  const [baseRelease, setBaseRelease] = useState('');
  const [days, setDays] = useState(7);
  const [startLoading, setStartLoading] = useState(false);
  const [startMessage, setStartMessage] = useState('');
  
  // 정지 중인 모니터 ID
  const [stoppingId, setStoppingId] = useState<string>('');

  // 상태 조회 함수
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/monitor/status', {
        cache: 'no-store'
      });
      
      const result: ApiResponse<StatusData> = await response.json();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || '상태 조회에 실패했습니다');
      }
      
      setMonitors(result.data.monitors);
      setStatusData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  // 컴포넌트 마운트 시 상태 조회
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 모니터링 시작
  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!baseRelease.trim()) {
      setStartMessage('❌ 베이스 릴리즈를 입력해주세요');
      return;
    }
    
    setStartLoading(true);
    setStartMessage('');
    
    try {
      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, baseRelease: baseRelease.trim(), days })
      });
      
      const result: ApiResponse<{ message: string; monitorId: string }> = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '모니터링 시작에 실패했습니다');
      }
      
      setStartMessage(`✅ ${result.data?.message}`);
      setBaseRelease(''); // 폼 리셋
      
      // 상태 새로고침
      setTimeout(() => {
        fetchStatus();
        setStartMessage('');
      }, 2000);
      
    } catch (err) {
      setStartMessage(`❌ ${err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다'}`);
    } finally {
      setStartLoading(false);
    }
  };

  // 모니터링 정지
  const handleStop = async (monitorId: string) => {
    if (stoppingId === monitorId) return;
    
    setStoppingId(monitorId);
    
    try {
      const response = await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorId })
      });
      
      const result: ApiResponse<{ message: string; monitorId: string }> = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '모니터링 정지에 실패했습니다');
      }
      
      // UI에서 즉시 제거하고 새로고침
      setMonitors(prev => prev.filter(m => m.id !== monitorId));
      setTimeout(fetchStatus, 1000);
      
    } catch (err) {
      alert(`정지 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setStoppingId('');
    }
  };

  // 최신 정렬된 모니터 목록
  const sortedMonitors = [...monitors].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 className="h1">🚀 Sentry 릴리즈 모니터링</h1>
          <p className="muted">
            특정 릴리즈 버전의 error/fatal 이슈를 7일간 자동으로 모니터링합니다.
            첫 24시간은 30분 간격, 이후는 1시간 간격으로 리포트를 제공합니다.
          </p>
        </div>
        
        {/* 페이지 네비게이션 탭 */}
        <div className="nav-tabs">
          <Link href="/monitor" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
            릴리즈 모니터링
          </Link>
          <Link href="/monitor/daily" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            일간 리포트
          </Link>
          <Link href="/monitor/weekly" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            주간 리포트
          </Link>
        </div>
      </div>

      {/* 새 모니터링 시작 카드 */}
      <div className="card">
        <h2 className="h2">▶️ 새 모니터링 시작</h2>
        
        <form onSubmit={handleStart}>
          <div className="row responsive">
            <label>플랫폼</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
            >
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </select>
            
            <label>베이스 릴리즈</label>
            <input
              type="text"
              value={baseRelease}
              onChange={(e) => setBaseRelease(e.target.value)}
              placeholder="예: 4.69.0"
              required
            />
            
            <label>기간(일)</label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value) || 7)}
              min="1"
              max="14"
              style={{ width: '90px' }}
            />
            
            <button 
              type="submit" 
              className="btn ok"
              disabled={startLoading}
            >
              {startLoading ? '시작 중...' : '모니터링 시작'}
            </button>
          </div>
          
          {startMessage && (
            <div className="row" style={{ marginTop: '6px' }}>
              <span className="muted">{startMessage}</span>
            </div>
          )}
        </form>
      </div>

      {/* 현재 상태 카드 */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2">📊 현재 모니터링 상태</h2>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="btn ghost"
          >
            {loading ? '새로고침 중...' : '새로고침'}
          </button>
        </div>

        {/* 상태 요약 */}
        {statusData && (
          <div className="kv" style={{ marginBottom: '20px' }}>
            <div className="k">전체:</div>
            <div className="v">{statusData.total}개</div>
            <div className="k">활성:</div>
            <div className="v" style={{ color: 'var(--ok)' }}>{statusData.active}개</div>
            <div className="k">중단됨:</div>
            <div className="v" style={{ color: 'var(--danger)' }}>{statusData.stopped}개</div>
            <div className="k">만료됨:</div>
            <div className="v" style={{ color: 'var(--muted)' }}>{statusData.expired}개</div>
          </div>
        )}

        {error && (
          <div className="muted" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>
        )}

        {/* 모니터 목록 */}
        {sortedMonitors.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>
            {loading ? '로딩 중...' : '모니터가 없습니다.'}
          </div>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="table-container table-mobile-cards" style={{ marginTop: '16px' }}>
              <table className="table-responsive">
                <thead>
                  <tr>
                    <th style={thStyle}>상태</th>
                    <th style={thStyle}>플랫폼</th>
                    <th style={thStyle}>베이스 릴리즈</th>
                    <th style={thStyle}>매칭 릴리즈</th>
                    <th style={thStyle}>시작일(KST)</th>
                    <th style={thStyle}>만료일(KST)</th>
                    <th style={thStyle}>남은 기간</th>
                    <th style={thStyle}>최근 실행</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMonitors.map((monitor) => {
                    const statusStyle = getStatusStyle(monitor.status);
                    return (
                      <tr
                        key={monitor.id}
                        style={{ 
                          borderBottom: '1px solid var(--border)',
                          background: monitor.status === 'active' ? 'rgba(34, 197, 94, 0.03)' : 'transparent'
                        }}
                      >
                        <td style={tdStyle}>
                          <span
                            style={{
                              ...statusStyle,
                              padding: '4px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {getStatusText(monitor.status)}
                          </span>
                        </td>
                        <td style={tdStyle}>{monitor.platform.toUpperCase()}</td>
                        <td style={tdMonoStyle}>{monitor.base_release}</td>
                        <td style={tdMonoStyle}>{monitor.matched_release || '-'}</td>
                        <td style={tdStyle}>{formatKST(monitor.started_at)}</td>
                        <td style={tdStyle}>{formatKST(monitor.expires_at)}</td>
                        <td style={tdStyle}>{formatRelativeTime(monitor.expires_at)}</td>
                        <td style={tdStyle}>
                          {monitor.lastHistory ? (
                            <div>
                              <div>{formatKST(monitor.lastHistory.executed_at)}</div>
                              <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                                E:{monitor.lastHistory.events_count} | I:{monitor.lastHistory.issues_count} | U:{monitor.lastHistory.users_count}
                              </div>
                            </div>
                          ) : (
                            <span className="muted">아직 실행 없음</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {monitor.status === 'active' && (
                            <button
                              onClick={() => handleStop(monitor.id)}
                              disabled={stoppingId === monitor.id}
                              className="btn danger"
                              style={{ fontSize: '11px', padding: '6px 12px' }}
                              title="이 모니터를 중단합니다"
                            >
                              {stoppingId === monitor.id ? '정지 중...' : '정지'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일 카드 */}
            <div className="mobile-cards" style={{ marginTop: '16px' }}>
              {sortedMonitors.map((monitor) => {
                const statusStyle = getStatusStyle(monitor.status);
                return (
                  <div key={monitor.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <span
                        style={{
                          ...statusStyle,
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}
                      >
                        {getStatusText(monitor.status)}
                      </span>
                      {monitor.status === 'active' && (
                        <button
                          onClick={() => handleStop(monitor.id)}
                          disabled={stoppingId === monitor.id}
                          className="btn danger"
                          style={{ fontSize: '11px', padding: '6px 12px' }}
                        >
                          {stoppingId === monitor.id ? '정지 중...' : '정지'}
                        </button>
                      )}
                    </div>
                    <div className="mobile-card-content">
                      <div className="mobile-field">
                        <span className="mobile-field-label">플랫폼</span>
                        <span className="mobile-field-value">{monitor.platform.toUpperCase()}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">베이스 릴리즈</span>
                        <span className="mobile-field-value mono">{monitor.base_release}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">매칭 릴리즈</span>
                        <span className="mobile-field-value mono">{monitor.matched_release || '-'}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">시작일</span>
                        <span className="mobile-field-value">{formatKST(monitor.started_at)}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">만료일</span>
                        <span className="mobile-field-value">{formatKST(monitor.expires_at)}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">남은 기간</span>
                        <span className="mobile-field-value">{formatRelativeTime(monitor.expires_at)}</span>
                      </div>
                      <div className="mobile-field">
                        <span className="mobile-field-label">최근 실행</span>
                        <span className="mobile-field-value">
                          {monitor.lastHistory ? (
                            <div>
                              <div>{formatKST(monitor.lastHistory.executed_at)}</div>
                              <div className="muted" style={{ fontSize: '11px', marginTop: '2px' }}>
                                E:{monitor.lastHistory.events_count} | I:{monitor.lastHistory.issues_count} | U:{monitor.lastHistory.users_count}
                              </div>
                            </div>
                          ) : (
                            <span className="muted">아직 실행 없음</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 도움말 */}
      <div className="muted" style={{ marginTop: '20px', fontSize: '12px' }}>
        💡 <strong>참고:</strong> 모니터링은 Vercel Cron을 통해 자동 실행되며, 
        level:[error,fatal] 이벤트만 수집합니다. 
        실행 결과는 설정된 Slack 채널로 전송됩니다.
      </div>
    </div>
  );
}