'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Breadcrumbs, Anchor, Text } from '@mantine/core';

interface BreadcrumbItem {
  label: string;
  href: string;
  active?: boolean;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  const breadcrumbs = useMemo(() => {
    const items: BreadcrumbItem[] = [{ label: '홈', href: '/monitor' }];

    if (segments.length === 0 || pathname === '/') {
      return items;
    }

    let path = '';
    segments.forEach((segment, index) => {
      path += `/${segment}`;

      // 특정 경로에 대한 라벨 매핑
      const labelMap: Record<string, string> = {
        monitor: '모니터링',
        version: '버전별',
        test: '테스트',
        daily: '일간 리포트',
        weekly: '주간 리포트',
        android: 'Android',
        ios: 'iOS',
        issues: '이슈',
        settings: '설정',
        'alert-rules': 'Alert Rules',
        env: '환경 변수',
        schedule: '자동 스케줄',
        report: '리포트 테스트',
        history: '실행 내역',
        'sentry-analysis': 'Sentry 이슈 분석'
      };

      let label = labelMap[segment] || segment;

      // UUID 형태면 "상세" 표시
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment
        )
      ) {
        label = '상세';
      }

      items.push({
        label,
        href: path,
        active: index === segments.length - 1
      });
    });

    return items;
  }, [pathname, segments]);

  // 홈만 있으면 breadcrumb 숨김
  if (breadcrumbs.length === 1) {
    return null;
  }

  return (
    <Breadcrumbs separator="→" mb="lg">
      {breadcrumbs.map((item, index) =>
        item.active ? (
          <Text key={index} size="sm" fw={500}>
            {item.label}
          </Text>
        ) : (
          <Anchor key={index} component={Link} href={item.href} size="sm" c="dimmed">
            {item.label}
          </Anchor>
        )
      )}
    </Breadcrumbs>
  );
}
