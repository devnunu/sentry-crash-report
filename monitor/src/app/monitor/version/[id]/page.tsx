import { notFound } from 'next/navigation';
import { db } from '@/lib/database';
import { createSentryService } from '@/lib/sentry';
import { MonitoringService } from '@/lib/monitor';
import VersionMonitorDashboard from './VersionMonitorDashboard';

export const runtime = 'nodejs';

interface PageProps {
  params: {
    id: string;
  };
}

export default async function VersionMonitorDetailPage({ params }: PageProps) {
  // Next.js 15: params를 await
  const { id } = await params;

  // 모니터 기본 정보
  const monitor = await db.getMonitorSession(id);

  if (!monitor) {
    notFound();
  }

  // 최신 스냅샷 데이터 (실시간 Sentry 데이터 수집)
  let snapshot = null;
  let error = null;

  try {
    const sentryService = createSentryService(monitor.platform);
    const monitoringService = new MonitoringService();

    const releaseStart = new Date(monitor.started_at);
    const currentTime = new Date();

    snapshot = await monitoringService.collectCumulativeData(
      monitor,
      sentryService,
      releaseStart,
      currentTime
    );
  } catch (err) {
    console.error('[Version Monitor Detail] Failed to fetch snapshot:', err);
    error = err instanceof Error ? err.message : 'Unknown error';
  }

  // 히스토리 데이터 (최근 50개)
  const history = await db.getMonitorHistory(id, 50);

  return (
    <VersionMonitorDashboard
      monitor={monitor}
      snapshot={snapshot}
      history={history}
      error={error}
    />
  );
}
