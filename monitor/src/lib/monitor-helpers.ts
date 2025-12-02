// 버전 모니터링 헬퍼 함수들

import {differenceInDays, differenceInHours, format, formatDistanceToNow} from 'date-fns';
import {ko} from 'date-fns/locale';

// 진행률 계산
export function getProgress(startedAt: string, expiresAt: string): number {
  const now = new Date();
  const start = new Date(startedAt);
  const end = new Date(expiresAt);

  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();

  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;

  return Math.min(100, Math.round((elapsed / total) * 100));
}

// 경과 시간
export function getElapsedTime(startDate: string): string {
  const now = new Date();
  const start = new Date(startDate);
  const hours = differenceInHours(now, start);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) {
    return `${days}일 ${remainingHours}시간`;
  }
  return `${hours}시간`;
}

// 남은 시간
export function getTimeRemaining(endDate: string): string {
  const now = new Date();
  const end = new Date(endDate);
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return '만료됨';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) {
    return `${days}일 ${remainingHours}시간`;
  }
  return `${hours}시간`;
}

// 경과 일수
export function getDaysElapsed(startDate: string): number {
  const now = new Date();
  const start = new Date(startDate);
  const days = differenceInDays(now, start);
  return Math.max(0, days);
}

// 다음 실행 시간 계산
export function getNextRunTime(lastExecutedAt: string | null, intervalMinutes: number): string {
  if (!lastExecutedAt) return '곧 실행';

  const now = new Date();
  const lastRun = new Date(lastExecutedAt);
  const nextRun = new Date(lastRun.getTime() + intervalMinutes * 60 * 1000);
  const diff = nextRun.getTime() - now.getTime();

  if (diff <= 0) return '곧 실행';

  const minutes = Math.ceil(diff / (1000 * 60));

  if (minutes < 60) {
    return `${minutes}분 후`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}시간 ${remainingMinutes}분 후` : `${hours}시간 후`;
  }

  const days = Math.floor(hours / 24);
  return `${days}일 후`;
}

// 상태 색상
export function getStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    'active': 'blue',
    'paused': 'yellow',
    'completed': 'green',
    'stopped': 'gray',
    'expired': 'red',
    'error': 'red'
  };
  return colorMap[status] || 'gray';
}

// 상태 텍스트
export function getStatusText(status: string): string {
  const textMap: Record<string, string> = {
    'active': '진행 중',
    'paused': '일시정지',
    'completed': '완료',
    'stopped': '중단됨',
    'expired': '만료됨',
    'error': '오류'
  };
  return textMap[status] || status;
}

// 날짜 범위 포맷
export function formatDateRange(startDate: string, endDate: string): string {
  const start = format(new Date(startDate), 'yyyy.MM.dd HH:mm', { locale: ko });
  const end = format(new Date(endDate), 'yyyy.MM.dd HH:mm', { locale: ko });
  return `${start} ~ ${end}`;
}

// 날짜/시간 포맷
export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'yyyy.MM.dd HH:mm:ss', { locale: ko });
}

// 상대 시간 포맷
export function formatRelativeTime(date: string | Date): string {
  return formatDistanceToNow(new Date(date), {
    addSuffix: true,
    locale: ko
  });
}

// Sentry 이슈 URL 생성
export function getSentryIssueUrl(platform: string, issueId: string): string {
  const orgSlug = process.env.NEXT_PUBLIC_SENTRY_ORG_SLUG || 'finda';
  const projectSlug = platform === 'android' ? 'finda-android' : 'finda-ios';
  return `https://sentry.io/organizations/${orgSlug}/issues/${issueId}/?project=${projectSlug}`;
}

// 차트 메트릭 라벨
export function getMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    'crashes': '크래시 수',
    'issues': '이슈 수',
    'users': '사용자 수'
  };
  return labels[metric] || metric;
}

// 심각도 배지 색상
export function getSeverityColor(level: string): string {
  const colorMap: Record<string, string> = {
    'normal': 'green',
    'warning': 'orange',
    'critical': 'red'
  };
  return colorMap[level] || 'gray';
}

// 심각도 텍스트
export function getSeverityText(level: string): string {
  const textMap: Record<string, string> = {
    'normal': '✅ 정상',
    'warning': '⚠️ 주의',
    'critical': '🚨 긴급'
  };
  return textMap[level] || level;
}

// 숫자 포맷 (천 단위 구분)
export function formatNumber(num: number): string {
  return num.toLocaleString('ko-KR');
}

// 백분율 포맷
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// 전체 기간 계산 (일 단위)
export function getTotalDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil(differenceInDays(end, start));
}
